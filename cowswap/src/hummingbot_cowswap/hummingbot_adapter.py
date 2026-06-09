"""Minimal Hummingbot-compatible shim for the CoW connector MVP."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING, Protocol
from uuid import uuid4

from hummingbot_cowswap.models import BuyOrderRequest, CoWToken, OrderState, SellOrderRequest

if TYPE_CHECKING:
    from collections.abc import Mapping

CONNECTOR_NAME = "cowswap"
SUPPORTED_ORDER_TYPES = ("MARKET",)
CONFIG_MAP = {
    "connector": CONNECTOR_NAME,
    "connector_name": CONNECTOR_NAME,
    "supported_order_types": SUPPORTED_ORDER_TYPES,
    "supported_trade_types": ("BUY", "SELL"),
    "requires_all_connector_settings": False,
    "uses_raw_private_key": False,
}
HUMMINGBOT_ORDER_STATES = {
    OrderState.SUBMITTED: "PENDING_CREATE",
    OrderState.OPEN: "OPEN",
    OrderState.PARTIALLY_FILLED: "PARTIALLY_FILLED",
    OrderState.FILLED: "FILLED",
    OrderState.CANCELLED: "CANCELED",
    OrderState.EXPIRED: "FAILED",
    OrderState.FAILED: "FAILED",
}


class OrderConnector(Protocol):
    """Connector surface needed by the shim."""

    async def submit_sell_order(self, request: SellOrderRequest) -> object:
        """Submit a normalized CoW sell order request."""
        ...

    async def submit_buy_order(self, request: BuyOrderRequest) -> object:
        """Submit a normalized CoW buy order request."""
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
        connector: OrderConnector,
        tokens_by_pair: Mapping[str, tuple[CoWToken, CoWToken]],
    ) -> None:
        """Create an adapter over an existing CoW connector and configured pairs."""
        self._connector = connector
        self._tokens_by_pair = {
            self.convert_from_exchange_trading_pair(pair): tokens
            for pair, tokens in tokens_by_pair.items()
        }
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
    def config_map() -> dict[str, object]:
        """Return compact adapter metadata without registering global Hummingbot settings."""
        return dict(CONFIG_MAP)

    @staticmethod
    def supported_order_types() -> tuple[str, ...]:
        """Return the conservative order types this shim is willing to advertise."""
        return SUPPORTED_ORDER_TYPES

    @property
    def order_types(self) -> tuple[str, ...]:
        """Alias used by some Hummingbot probes."""
        return self.supported_order_types()

    @property
    def trading_rules(self) -> dict[str, HummingbotTradingRule]:
        """Return trading rules for configured pairs."""
        return dict(self._trading_rules)

    @property
    def in_flight_orders(self) -> dict[str, object]:
        """Return orders submitted through this adapter instance."""
        return dict(self._in_flight_orders)

    @property
    def order_statuses(self) -> dict[str, str]:
        """Return Hummingbot-style order state names for tracked orders."""
        return {
            client_order_id: _hummingbot_order_state(order)
            for client_order_id, order in self._in_flight_orders.items()
        }

    @staticmethod
    def convert_from_exchange_trading_pair(trading_pair: str) -> str:
        """Normalize exchange/API trading pairs into Hummingbot BASE-QUOTE form."""
        return _normalize_trading_pair(trading_pair)

    @staticmethod
    def convert_to_exchange_trading_pair(trading_pair: str) -> str:
        """Normalize Hummingbot trading pairs for this CoW shim."""
        return _normalize_trading_pair(trading_pair)

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
        normalized_pair = self.convert_from_exchange_trading_pair(trading_pair)
        sell_token, buy_token = self._tokens_for_pair(trading_pair)
        request = SellOrderRequest(
            client_order_id=client_order_id or _new_client_order_id(normalized_pair),
            trading_pair=normalized_pair,
            sell_token=sell_token,
            buy_token=buy_token,
            amount=str(amount),
        )
        tracked = await self._connector.submit_sell_order(request)
        self._in_flight_orders[request.client_order_id] = tracked
        return tracked

    async def buy(
        self,
        trading_pair: str,
        amount: Decimal | str,
        *,
        order_type: object = "MARKET",
        price: Decimal | str | None = None,
        client_order_id: str | None = None,
        **kwargs: object,
    ) -> object:
        """Convert a Hummingbot-style BUY submission into a BuyOrderRequest."""
        _reject_private_key_material(kwargs)
        if _order_type_name(order_type) not in SUPPORTED_ORDER_TYPES:
            message = f"unsupported order_type for CoW shim: {order_type}"
            raise ValueError(message)
        if price is not None:
            message = "CoW shim only supports quoted market-style BUY submissions"
            raise ValueError(message)
        normalized_pair = self.convert_from_exchange_trading_pair(trading_pair)
        sell_token, buy_token = self._tokens_for_pair(trading_pair)
        request = BuyOrderRequest(
            client_order_id=client_order_id or _new_client_order_id(normalized_pair),
            trading_pair=normalized_pair,
            sell_token=sell_token,
            buy_token=buy_token,
            amount=str(amount),
        )
        tracked = await self._connector.submit_buy_order(request)
        self._in_flight_orders[request.client_order_id] = tracked
        return tracked

    async def cancel(self, client_order_id: str) -> object:
        """Cancel an in-flight order by Hummingbot client order ID."""
        tracked = await self._connector.cancel_order(client_order_id)
        self._in_flight_orders[client_order_id] = tracked
        return tracked

    def _tokens_for_pair(self, trading_pair: str) -> tuple[CoWToken, CoWToken]:
        normalized_pair = self.convert_from_exchange_trading_pair(trading_pair)
        try:
            return self._tokens_by_pair[normalized_pair]
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


def _normalize_trading_pair(trading_pair: str) -> str:
    return trading_pair.replace("/", "-").replace("_", "-").upper()


def _hummingbot_order_state(order: object) -> str:
    state = getattr(order, "state", None)
    if isinstance(state, OrderState):
        return HUMMINGBOT_ORDER_STATES[state]
    if state is not None:
        return str(state).upper()
    return "UNKNOWN"


def _reject_private_key_material(kwargs: Mapping[str, object]) -> None:
    for key in kwargs:
        if "private_key" in key.lower() or "raw_private" in key.lower():
            message = "raw private key material is not accepted by the CoW Hummingbot shim"
            raise ValueError(message)
