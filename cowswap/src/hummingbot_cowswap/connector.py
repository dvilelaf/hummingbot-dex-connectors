"""Hummingbot-style order lifecycle facade for CoW Swap."""

from __future__ import annotations

from time import time
from typing import TYPE_CHECKING

from hummingbot_cowswap.chain_config import chain_config
from hummingbot_cowswap.client import CoWClient, CowDaoOrderBookClient
from hummingbot_cowswap.errors import (
    DuplicateOrderError,
    InsufficientAllowanceError,
    InsufficientBalanceError,
    StaleQuoteError,
)
from hummingbot_cowswap.models import (
    CoWConfig,
    CoWToken,
    OrderState,
    SellOrderRequest,
    TrackedOrder,
    amount_to_atomic,
    apply_slippage_bps,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    from hummingbot_cowswap.onchain import EvmReader
    from hummingbot_cowswap.persistence import JsonOrderStore
    from hummingbot_cowswap.signing import OrderSigner

ORDER_DIGEST_HEX_LENGTH = 66


class CoWConnector:
    """Coordinate quote, sign, post, poll, cancel, and persistence flows."""

    def __init__(
        self,
        *,
        config: CoWConfig,
        store: JsonOrderStore,
        client: CoWClient | None = None,
        signer: OrderSigner | None = None,
        evm_reader: EvmReader | None = None,
        clock: Callable[[], float] = time,
    ) -> None:
        """Create a connector with injected API client, store, and optional signer."""
        self.config = config
        self.client = client or CowDaoOrderBookClient(config)
        self.store = store
        self.signer = signer
        self.evm_reader = evm_reader
        self.clock = clock

    async def quote_sell(
        self,
        sell_token: CoWToken,
        buy_token: CoWToken,
        amount: str,
        valid_to: int | None = None,
    ) -> tuple[object, str]:
        """Request a sell quote and return the quote plus slippage-adjusted minimum buy."""
        quote = await self.client.quote_sell(
            {
                "chain_id": self.config.chain_id,
                "sell_token": sell_token.address,
                "buy_token": buy_token.address,
                "owner": self.config.owner,
                "receiver": self.config.receiver,
                "sell_amount": amount_to_atomic(amount, sell_token.decimals),
                "app_data": self.config.app_data,
                "valid_to": valid_to or self.config.valid_to,
            }
        )
        return quote, apply_slippage_bps(_quote_buy_amount(quote), self.config.slippage_bps)

    async def submit_sell_order(self, request: SellOrderRequest) -> TrackedOrder:
        """Quote, optionally sign, post, persist, and return a tracked sell order."""
        if self.store.load(request.client_order_id) is not None:
            message = f"duplicate client_order_id: {request.client_order_id}"
            raise DuplicateOrderError(message)

        sell_amount = amount_to_atomic(request.amount, request.sell_token.decimals)
        self._preflight_sell(request.sell_token, sell_amount)
        quote, minimum_buy_amount = await self.quote_sell(
            request.sell_token,
            request.buy_token,
            request.amount,
            request.valid_to,
        )
        quote_valid_to = _quote_valid_to(quote)
        if quote_valid_to <= int(self.clock()):
            message = f"stale CoW quote valid_to={quote_valid_to}"
            raise StaleQuoteError(message)
        order_payload = {
            "chain_id": self.config.chain_id,
            "sell_token": request.sell_token.address,
            "buy_token": request.buy_token.address,
            "owner": self.config.owner,
            "receiver": self.config.receiver,
            "sell_amount": _quote_sell_amount(quote),
            "buy_amount": minimum_buy_amount,
            "fee_amount": "0",
            "valid_to": quote_valid_to,
            "quote_id": _quote_id(quote),
            "app_data": self.config.app_data,
            "kind": "sell",
            "partially_fillable": request.partially_fillable,
            "signing_scheme": "eip712",
        }
        if self.signer is not None:
            order_payload = self.signer.sign_order_payload(order_payload)
        order_uid = await self.client.post_sell_order(order_payload)
        tracked = self.store.save_new(
            client_order_id=request.client_order_id,
            trading_pair=request.trading_pair,
            order_uid=order_uid,
            owner=self.config.owner,
            receiver=self.config.receiver,
            chain_id=self.config.chain_id,
            sell_token=request.sell_token,
            buy_token=request.buy_token,
            sell_amount=_quote_sell_amount(quote),
            buy_amount=minimum_buy_amount,
            valid_to=quote_valid_to,
            quote_id=_quote_id(quote),
            digest=_digest_from_uid(order_uid),
            signing_scheme="eip712",
            partially_fillable=request.partially_fillable,
        )
        tracked.state = OrderState.OPEN
        return self.store.save(tracked)

    async def poll_order(self, client_order_id: str) -> TrackedOrder:
        """Poll CoW status/trades and persist the mapped local order state."""
        tracked = self._load_order(client_order_id)
        status = await self.client.get_order_status(tracked.order_uid)
        trades = await self.client.get_trades(tracked.order_uid)

        raw_status, executed_sell, executed_buy = _order_status_values(status)
        tracked.raw_status = raw_status
        tracked.executed_sell = executed_sell
        tracked.executed_buy = executed_buy
        tracked.state = _map_order_state(raw_status, executed_sell, executed_buy)
        tracked.settlement_tx_hash = _first_tx_hash(trades)
        return self.store.save(tracked)

    async def cancel_order(self, client_order_id: str) -> TrackedOrder:
        """Request cancellation through the client and reconcile the final state."""
        tracked = self._load_order(client_order_id)
        await self.client.cancel_order(tracked.order_uid)
        return await self.poll_order(client_order_id)

    def _load_order(self, client_order_id: str) -> TrackedOrder:
        tracked = self.store.load(client_order_id)
        if tracked is None:
            message = f"unknown client_order_id: {client_order_id}"
            raise KeyError(message)
        return tracked

    def _preflight_sell(self, sell_token: CoWToken, sell_amount: str) -> None:
        chain = chain_config(self.config.chain_id, self.config.env)
        if self.evm_reader is None:
            return

        balance = self.evm_reader.balance_of(sell_token, self.config.owner)
        if int(balance) < int(sell_amount):
            message = f"insufficient {sell_token.symbol} balance"
            raise InsufficientBalanceError(message)

        allowance = self.evm_reader.allowance(sell_token, self.config.owner, chain.vault_relayer)
        if int(allowance) < int(sell_amount):
            message = f"insufficient {sell_token.symbol} allowance for CoW VaultRelayer"
            raise InsufficientAllowanceError(message)


def _map_order_state(status: str, executed_sell: str, executed_buy: str) -> OrderState:
    normalized = status.lower()
    if normalized == "fulfilled":
        return OrderState.FILLED
    if normalized == "cancelled":
        return OrderState.CANCELLED
    if normalized == "expired":
        return OrderState.EXPIRED
    if normalized in {"open", "presignaturepending"}:
        if int(executed_sell) > 0 or int(executed_buy) > 0:
            return OrderState.PARTIALLY_FILLED
        return OrderState.OPEN
    return OrderState.FAILED


def _first_tx_hash(trades: list[object]) -> str | None:
    for trade in trades:
        tx_hash = _field(trade, "txHash", None) or _field(trade, "tx_hash", None)
        if tx_hash:
            return tx_hash
    return None


def _digest_from_uid(order_uid: str) -> str:
    if order_uid.startswith("0x") and len(order_uid) >= ORDER_DIGEST_HEX_LENGTH:
        return order_uid[:ORDER_DIGEST_HEX_LENGTH]
    return order_uid


def _quote_id(quote: object) -> int | None:
    return _field(quote, "id", None)


def _quote_sell_amount(quote: object) -> str:
    return _root(_field(_field(quote, "quote"), "sellAmount"))


def _quote_buy_amount(quote: object) -> str:
    return _root(_field(_field(quote, "quote"), "buyAmount"))


def _quote_valid_to(quote: object) -> int:
    return int(_field(_field(quote, "quote"), "validTo"))


def _order_status_values(order: object) -> tuple[str, str, str]:
    status = _field(order, "status")
    if hasattr(status, "value"):
        status = status.value
    return (
        str(status),
        str(_field(order, "executedSellAmount", "0")),
        str(_field(order, "executedBuyAmount", "0")),
    )


def _root(value: object) -> str:
    return str(_field(value, "root", value))


def _field(value: object, name: str, default: object = None) -> object:
    if isinstance(value, dict):
        return value.get(name, default)
    return getattr(value, name, default)
