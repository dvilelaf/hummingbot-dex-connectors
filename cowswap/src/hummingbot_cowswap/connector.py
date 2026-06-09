"""Hummingbot-style order lifecycle facade for CoW Swap."""

from __future__ import annotations

import re
from time import time
from typing import TYPE_CHECKING, Any, cast

from hummingbot_cowswap.chain_config import chain_config
from hummingbot_cowswap.client import CoWClient, CowDaoOrderBookClient
from hummingbot_cowswap.errors import (
    CoWOrderBookAPIError,
    DuplicateOrderError,
    InsufficientAllowanceError,
    InsufficientBalanceError,
    StaleQuoteError,
    UnsupportedTokenError,
)
from hummingbot_cowswap.models import (
    BuyOrderRequest,
    CoWConfig,
    CoWToken,
    OrderState,
    SellOrderRequest,
    TrackedOrder,
    amount_to_atomic,
    apply_buy_slippage_bps,
    apply_slippage_bps,
)
from hummingbot_cowswap.onchain import is_native_token

if TYPE_CHECKING:
    from collections.abc import Callable

    from hummingbot_cowswap.onchain import EvmReader
    from hummingbot_cowswap.persistence import JsonOrderStore
    from hummingbot_cowswap.signing import OrderSigner

ORDER_DIGEST_HEX_LENGTH = 66
ORDER_UID_HEX_LENGTH = 114
EVM_ADDRESS_PATTERN = re.compile(r"^0x[a-fA-F0-9]{40}$")
_RAW_COW_STATUS_MAP = {
    "presignaturepending": OrderState.SUBMITTED,
    "open": OrderState.OPEN,
    "fulfilled": OrderState.FILLED,
    "cancelled": OrderState.CANCELLED,
    "expired": OrderState.EXPIRED,
}
TERMINAL_ORDER_STATES = {
    OrderState.FILLED,
    OrderState.CANCELLED,
    OrderState.EXPIRED,
    OrderState.FAILED,
}


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
        _validate_order_tokens(sell_token, buy_token)
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

    async def quote_buy(
        self,
        sell_token: CoWToken,
        buy_token: CoWToken,
        amount: str,
        valid_to: int | None = None,
    ) -> tuple[object, str]:
        """Request a buy quote and return the quote plus slippage-adjusted maximum sell."""
        _validate_order_tokens(sell_token, buy_token)
        quote = await self.client.quote_buy(
            {
                "chain_id": self.config.chain_id,
                "sell_token": sell_token.address,
                "buy_token": buy_token.address,
                "owner": self.config.owner,
                "receiver": self.config.receiver,
                "buy_amount": amount_to_atomic(amount, buy_token.decimals),
                "app_data": self.config.app_data,
                "valid_to": valid_to or self.config.valid_to,
            }
        )
        return quote, apply_buy_slippage_bps(
            _quote_sell_amount_with_fee(quote),
            self.config.slippage_bps,
        )

    async def submit_sell_order(self, request: SellOrderRequest) -> TrackedOrder:
        """Quote, optionally sign, post, persist, and return a tracked sell order."""
        if self.store.load(request.client_order_id) is not None:
            message = f"duplicate client_order_id: {request.client_order_id}"
            raise DuplicateOrderError(message)

        _validate_order_tokens(request.sell_token, request.buy_token)
        _reject_native_regular_order(request.sell_token, request.buy_token)
        sell_amount = amount_to_atomic(request.amount, request.sell_token.decimals)
        self._preflight_sell(request.sell_token, sell_amount)
        quote, minimum_buy_amount = await self.quote_sell(
            request.sell_token,
            request.buy_token,
            request.amount,
            request.valid_to,
        )
        _validate_verified_quote(quote)
        quote_valid_to = _quote_valid_to(quote)
        fee_amount = _quote_fee_amount(quote)
        order_sell_amount = _quote_sell_amount_with_fee(quote)
        if quote_valid_to <= int(self.clock()):
            message = f"stale CoW quote valid_to={quote_valid_to}"
            raise StaleQuoteError(message)
        self._preflight_sell(request.sell_token, order_sell_amount)
        order_payload = {
            "chain_id": self.config.chain_id,
            "sell_token": request.sell_token.address,
            "buy_token": request.buy_token.address,
            "owner": self.config.owner,
            "receiver": self.config.receiver,
            "sell_amount": order_sell_amount,
            "buy_amount": minimum_buy_amount,
            "fee_amount": fee_amount,
            "valid_to": quote_valid_to,
            "quote_id": _quote_id(quote),
            "app_data": self.config.app_data,
            "kind": "sell",
            "partially_fillable": request.partially_fillable,
            "signing_scheme": "eip712",
        }
        expected_order_payload = dict(order_payload)
        order_payload = self._sign_order_payload(order_payload, expected_order_payload)
        order_uid = await self.client.post_sell_order(order_payload)
        _verify_posted_order_uid(order_uid, order_payload)
        tracked = self.store.save_new(
            client_order_id=request.client_order_id,
            trading_pair=request.trading_pair,
            order_uid=order_uid,
            owner=self.config.owner,
            receiver=self.config.receiver,
            chain_id=self.config.chain_id,
            sell_token=request.sell_token,
            buy_token=request.buy_token,
            sell_amount=order_sell_amount,
            buy_amount=minimum_buy_amount,
            valid_to=quote_valid_to,
            quote_id=_quote_id(quote),
            digest=_digest_from_uid(order_uid),
            signing_scheme="eip712",
            partially_fillable=request.partially_fillable,
        )
        tracked.fee_amount = fee_amount
        tracked.metadata["signing_mode"] = "hummingbot-managed"
        tracked.state = OrderState.OPEN
        return self.store.save(tracked)

    async def submit_sell_order_and_wait(
        self,
        request: SellOrderRequest,
        *,
        max_polls: int = 1,
    ) -> TrackedOrder:
        """Submit a sell order, then poll until CoW reports a terminal settlement state."""
        tracked = await self.submit_sell_order(request)
        return await self.wait_for_terminal_order(tracked.client_order_id, max_polls=max_polls)

    async def submit_buy_order(self, request: BuyOrderRequest) -> TrackedOrder:
        """Quote, optionally sign, post, persist, and return a tracked buy order."""
        if self.store.load(request.client_order_id) is not None:
            message = f"duplicate client_order_id: {request.client_order_id}"
            raise DuplicateOrderError(message)

        _validate_order_tokens(request.sell_token, request.buy_token)
        _reject_native_regular_order(request.sell_token, request.buy_token)
        _validate_chain(self.config)
        quote, maximum_sell_amount = await self.quote_buy(
            request.sell_token,
            request.buy_token,
            request.amount,
            request.valid_to,
        )
        _validate_verified_quote(quote)
        quote_valid_to = _quote_valid_to(quote)
        fee_amount = _quote_fee_amount(quote)
        if quote_valid_to <= int(self.clock()):
            message = f"stale CoW quote valid_to={quote_valid_to}"
            raise StaleQuoteError(message)
        self._preflight_sell(request.sell_token, maximum_sell_amount)
        order_payload = {
            "chain_id": self.config.chain_id,
            "sell_token": request.sell_token.address,
            "buy_token": request.buy_token.address,
            "owner": self.config.owner,
            "receiver": self.config.receiver,
            "sell_amount": maximum_sell_amount,
            "buy_amount": _quote_buy_amount(quote),
            "fee_amount": fee_amount,
            "valid_to": quote_valid_to,
            "quote_id": _quote_id(quote),
            "app_data": self.config.app_data,
            "kind": "buy",
            "partially_fillable": request.partially_fillable,
            "signing_scheme": "eip712",
        }
        expected_order_payload = dict(order_payload)
        order_payload = self._sign_order_payload(order_payload, expected_order_payload)
        order_uid = await self.client.post_sell_order(order_payload)
        _verify_posted_order_uid(order_uid, order_payload)
        tracked = self.store.save_new(
            client_order_id=request.client_order_id,
            trading_pair=request.trading_pair,
            order_uid=order_uid,
            owner=self.config.owner,
            receiver=self.config.receiver,
            chain_id=self.config.chain_id,
            sell_token=request.sell_token,
            buy_token=request.buy_token,
            sell_amount=maximum_sell_amount,
            buy_amount=_quote_buy_amount(quote),
            valid_to=quote_valid_to,
            quote_id=_quote_id(quote),
            digest=_digest_from_uid(order_uid),
            signing_scheme="eip712",
            partially_fillable=request.partially_fillable,
        )
        tracked.fee_amount = fee_amount
        tracked.metadata["signing_mode"] = "hummingbot-managed"
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

    async def wait_for_terminal_order(
        self,
        client_order_id: str,
        *,
        max_polls: int = 1,
    ) -> TrackedOrder:
        """Poll an existing order until it reaches a terminal local state."""
        if max_polls < 1:
            message = "max_polls must be at least 1"
            raise ValueError(message)

        tracked = self._load_order(client_order_id)
        for _ in range(max_polls):
            tracked = await self.poll_order(client_order_id)
            if tracked.state in TERMINAL_ORDER_STATES:
                return tracked

        message = f"order {client_order_id} did not reach a terminal CoW state"
        raise TimeoutError(message)

    async def cancel_order(self, client_order_id: str) -> TrackedOrder:
        """Request cancellation through the client and reconcile the final state."""
        tracked = self._load_order(client_order_id)
        if self.signer is None:
            message = "cancel_order requires a Hummingbot-managed signer"
            raise NotImplementedError(message)
        cancellation = self.signer.sign_order_cancellation([tracked.order_uid])
        await self.client.cancel_order(tracked.order_uid, cancellation)
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

    def _sign_order_payload(
        self,
        order_payload: dict[str, object],
        expected_order_payload: dict[str, object],
    ) -> dict[str, object]:
        if self.signer is None:
            message = "CoW order submission requires a Hummingbot-managed signer"
            raise ValueError(message)
        signed_order = self.signer.sign_order_payload(order_payload)
        _verify_signed_order_fields(signed_order, expected_order_payload)
        return signed_order


def _map_order_state(status: str, executed_sell: str, executed_buy: str) -> OrderState:
    normalized = status.lower()
    mapped = _RAW_COW_STATUS_MAP.get(normalized)
    if mapped is not None and mapped is not OrderState.OPEN:
        return mapped
    if mapped == OrderState.OPEN:
        if int(executed_sell) > 0 or int(executed_buy) > 0:
            return OrderState.PARTIALLY_FILLED
        return OrderState.OPEN
    return OrderState.FAILED


def _validate_order_tokens(sell_token: CoWToken, buy_token: CoWToken) -> None:
    _validate_token(sell_token)
    _validate_token(buy_token)


def _reject_native_regular_order(sell_token: CoWToken, buy_token: CoWToken) -> None:
    if not (is_native_token(sell_token) or is_native_token(buy_token)):
        return
    message = "native-token orders must use EthFlow planning or wrapped tokens"
    raise UnsupportedTokenError(message)


def _validate_chain(config: CoWConfig) -> None:
    chain_config(config.chain_id, config.env)


def _validate_token(token: CoWToken) -> None:
    if not token.symbol.strip():
        message = "token symbol is required"
        raise UnsupportedTokenError(message)
    if not EVM_ADDRESS_PATTERN.fullmatch(token.address):
        message = f"unsupported token address for {token.symbol}: {token.address}"
        raise UnsupportedTokenError(message)


def _first_tx_hash(trades: list[object]) -> str | None:
    for trade in trades:
        tx_hash = _field(trade, "txHash", None) or _field(trade, "tx_hash", None)
        if tx_hash:
            return str(tx_hash)
    return None


def _digest_from_uid(order_uid: str) -> str:
    if order_uid.startswith("0x") and len(order_uid) >= ORDER_DIGEST_HEX_LENGTH:
        return order_uid[:ORDER_DIGEST_HEX_LENGTH]
    return order_uid


def _verify_signed_order_fields(order: dict[str, object], expected: dict[str, object]) -> None:
    for field in (
        "chain_id",
        "sell_token",
        "buy_token",
        "owner",
        "receiver",
        "sell_amount",
        "buy_amount",
        "fee_amount",
        "valid_to",
        "quote_id",
        "app_data",
        "kind",
        "partially_fillable",
    ):
        if order.get(field) != expected.get(field):
            message = f"signed order {field} does not match quote"
            raise ValueError(message)

    if order.get("signing_scheme") != "eip712":
        message = "signed order signing_scheme must be eip712"
        raise ValueError(message)
    if "signature" not in order:
        message = "signed order signature is required"
        raise ValueError(message)


def _verify_posted_order_uid(order_uid: str, order: dict[str, object]) -> None:
    if not order_uid.startswith("0x") or len(order_uid) != ORDER_UID_HEX_LENGTH:
        message = f"invalid posted order UID: {order_uid}"
        raise ValueError(message)

    expected_uid = order.get("expected_order_uid")
    if expected_uid is not None and str(expected_uid).lower() != order_uid.lower():
        message = "posted order UID does not match signed order"
        raise ValueError(message)

    expected_digest = order.get("order_digest")
    if (
        expected_digest is not None
        and str(expected_digest).lower() != _digest_from_uid(order_uid).lower()
    ):
        message = "posted order digest does not match signed order"
        raise ValueError(message)

    valid_to = int(cast("Any", order["valid_to"]))
    uid_valid_to = int(order_uid[-8:], 16)
    if uid_valid_to != valid_to:
        message = "posted order UID validTo does not match signed order"
        raise ValueError(message)


def _quote_id(quote: object) -> int | None:
    quote_id = _field(quote, "id", None)
    return None if quote_id is None else int(cast("Any", quote_id))


def _validate_verified_quote(quote: object) -> None:
    if _field(quote, "verified", default=False) is not True:
        message = "CoW quote is not verified"
        raise CoWOrderBookAPIError(message)


def _quote_sell_amount_with_fee(quote: object) -> str:
    return str(int(_quote_sell_amount(quote)) + int(_quote_fee_amount(quote)))


def _quote_sell_amount(quote: object) -> str:
    return _root(_field(_field(quote, "quote"), "sellAmount"))


def _quote_buy_amount(quote: object) -> str:
    return _root(_field(_field(quote, "quote"), "buyAmount"))


def _quote_fee_amount(quote: object) -> str:
    return _root(_field(_field(quote, "quote"), "feeAmount"))


def _quote_valid_to(quote: object) -> int:
    return int(cast("Any", _field(_field(quote, "quote"), "validTo")))


def _order_status_values(order: object) -> tuple[str, str, str]:
    status = _field(order, "status")
    if hasattr(status, "value"):
        status = cast("Any", status).value
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
