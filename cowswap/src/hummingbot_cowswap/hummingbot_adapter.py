"""Minimal Hummingbot-compatible shim for the CoW connector MVP."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING, Protocol
from uuid import uuid4

from hummingbot_cowswap.models import CoWToken, SellOrderRequest

if TYPE_CHECKING:
    from collections.abc import Mapping

CONNECTOR_NAME = "cowswap"
SUPPORTED_ORDER_TYPES = ("MARKET",)


class SellOrderConnector(Protocol):
    """Connector surface needed by the shim."""

    async def submit_sell_order(self, request: SellOrderRequest) -> object:
        """Submit a normalized CoW sell order request."""
        ...

    async def cancel_order(self, client_order_id: str) -> object:
        """Cancel an order by Hummingbot client order ID."""
        ...


@dataclass(frozen=True)
class HummingbotTradingRule:
    """Small trading-rule representation keyed by Hummingbot trading pair."""

    trading_pair: str
    min_order_size: Decimal = Decimal(0)
    min_price_increment: Decimal = Decimal(0)
    min_base_amount_increment: Decimal = Decimal(0)
    min_quote_amount_increment: Decimal = Decimal(0)


class HummingbotCoWAdapter:
    """Expose the small connector contract expected by local Hummingbot API probes."""

    connector_name = CONNECTOR_NAME

    def __init__(
        self,
        connector: SellOrderConnector,
        tokens_by_pair: Mapping[str, tuple[CoWToken, CoWToken]],
    ) -> None:
        """Create an adapter over an existing CoW connector and configured pairs."""
        self._connector = connector
        self._tokens_by_pair = dict(tokens_by_pair)
        self._in_flight_orders: dict[str, object] = {}
        self._trading_rules = {
            pair: HummingbotTradingRule(
                trading_pair=pair,
                min_base_amount_increment=_token_increment(base_token),
                min_quote_amount_increment=_token_increment(quote_token),
            )
            for pair, (base_token, quote_token) in self._tokens_by_pair.items()
        }

    @staticmethod
    def supported_order_types() -> tuple[str, ...]:
        """Return the conservative order types this shim is willing to advertise."""
        return SUPPORTED_ORDER_TYPES

    @property
    def trading_rules(self) -> dict[str, HummingbotTradingRule]:
        """Return trading rules for configured pairs."""
        return dict(self._trading_rules)

    @property
    def in_flight_orders(self) -> dict[str, object]:
        """Return orders submitted through this adapter instance."""
        return dict(self._in_flight_orders)

    async def sell(
        self,
        trading_pair: str,
        amount: Decimal | str,
        *,
        order_type: object = "MARKET",
        price: Decimal | str | None = None,
        client_order_id: str | None = None,
        **kwargs: object,
    ) -> object:
        """Convert a Hummingbot-style SELL submission into a SellOrderRequest."""
        _reject_private_key_material(kwargs)
        if _order_type_name(order_type) not in SUPPORTED_ORDER_TYPES:
            message = f"unsupported order_type for CoW shim: {order_type}"
            raise ValueError(message)
        if price is not None:
            message = "CoW shim only supports quoted market-style SELL submissions"
            raise ValueError(message)
        sell_token, buy_token = self._tokens_for_pair(trading_pair)
        request = SellOrderRequest(
            client_order_id=client_order_id or _new_client_order_id(trading_pair),
            trading_pair=trading_pair,
            sell_token=sell_token,
            buy_token=buy_token,
            amount=str(amount),
        )
        tracked = await self._connector.submit_sell_order(request)
        self._in_flight_orders[request.client_order_id] = tracked
        return tracked

    async def buy(self, *_args: object, **_kwargs: object) -> object:
        """Reject BUY submissions until CoW buy-side semantics are designed."""
        message = "CoW Hummingbot shim only supports SELL submissions"
        raise NotImplementedError(message)

    async def cancel(self, client_order_id: str) -> object:
        """Cancel an in-flight order by Hummingbot client order ID."""
        tracked = await self._connector.cancel_order(client_order_id)
        self._in_flight_orders[client_order_id] = tracked
        return tracked

    def _tokens_for_pair(self, trading_pair: str) -> tuple[CoWToken, CoWToken]:
        try:
            return self._tokens_by_pair[trading_pair]
        except KeyError as exc:
            message = f"unsupported trading_pair for CoW shim: {trading_pair}"
            raise ValueError(message) from exc


def _token_increment(token: CoWToken) -> Decimal:
    return Decimal(1).scaleb(-token.decimals)


def _order_type_name(order_type: object) -> str:
    value = getattr(order_type, "name", None) or getattr(order_type, "value", order_type)
    return str(value).upper()


def _new_client_order_id(trading_pair: str) -> str:
    return f"{CONNECTOR_NAME}-{trading_pair}-{uuid4().hex[:16]}"


def _reject_private_key_material(kwargs: Mapping[str, object]) -> None:
    for key in kwargs:
        if "private_key" in key.lower() or "raw_private" in key.lower():
            message = "raw private key material is not accepted by the CoW Hummingbot shim"
            raise ValueError(message)
