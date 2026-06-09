"""Minimal Hummingbot-compatible shim for the CoW connector MVP."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from decimal import Decimal
from time import time
from typing import Protocol
from uuid import uuid4

from hummingbot_cowswap.models import BuyOrderRequest, CoWToken, OrderState, SellOrderRequest

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
HUMMINGBOT_ORDER_EVENT_TAGS = {
    OrderState.SUBMITTED: "OrderCreated",
    OrderState.OPEN: "OrderCreated",
    OrderState.PARTIALLY_FILLED: "OrderFilled",
    OrderState.FILLED: "OrderFilled",
    OrderState.CANCELLED: "OrderCancelled",
    OrderState.EXPIRED: "OrderExpired",
    OrderState.FAILED: "MarketOrderFailure",
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
RAW_COW_STATE_TO_HUMMINGBOT_ORDER_STATE = {
    "presignaturepending": "PENDING_CREATE",
    "open": "OPEN",
    "fulfilled": "FILLED",
    "cancelled": "CANCELED",
    "expired": "FAILED",
}
RAW_COW_STATE_TO_EVENT_TAG = {
    "presignaturepending": "OrderCreated",
    "open": "OrderCreated",
    "fulfilled": "OrderFilled",
    "cancelled": "OrderCancelled",
    "expired": "OrderExpired",
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

    async def poll_order(self, client_order_id: str) -> object:
        """Poll an order by Hummingbot client order ID."""
        ...


@dataclass(frozen=True)
class HummingbotTradingRule:
    """Small trading-rule representation keyed by Hummingbot trading pair."""

    trading_pair: str
    min_order_size: Decimal = Decimal(0)
    min_price_increment: Decimal = Decimal(0)
    min_base_amount_increment: Decimal = Decimal(0)
    min_quote_amount_increment: Decimal = Decimal(0)


@dataclass(frozen=True)
class HummingbotOrderEvent:
    """Compact local order event shaped like Hummingbot connector lifecycle events."""

    event_tag: str
    client_order_id: str
    trading_pair: str
    order_type: str = "MARKET"
    trade_type: str | None = None
    order_state: str = "UNKNOWN"
    timestamp: float = 0
    exchange_order_id: str | None = None
    amount: str | None = None


OrderEventListener = Callable[[HummingbotOrderEvent], None]


@dataclass(frozen=True)
class _OrderEventContext:
    client_order_id: str | None = None
    trading_pair: str | None = None
    trade_type: str | None = None
    amount: str | None = None


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
        self._event_log: list[HummingbotOrderEvent] = []
        self._listeners: dict[str, list[OrderEventListener]] = {}
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

    @property
    def event_log(self) -> list[HummingbotOrderEvent]:
        """Return local Hummingbot-style events emitted by this shim."""
        return list(self._event_log)

    def add_listener(self, event_tag: str, listener: OrderEventListener) -> None:
        """Register a callback for a local Hummingbot-style event tag."""
        self._listeners.setdefault(event_tag, []).append(listener)

    def remove_listener(self, event_tag: str, listener: OrderEventListener) -> None:
        """Remove a previously registered local event callback."""
        listeners = self._listeners.get(event_tag, [])
        if listener in listeners:
            listeners.remove(listener)

    def trigger_event(self, event_tag: str, event: HummingbotOrderEvent) -> None:
        """Record and dispatch an event using a Hummingbot-like listener surface."""
        self._event_log.append(event)
        for listener in self._listeners.get(event_tag, []):
            listener(event)

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
        wait_for_settlement = bool(kwargs.pop("wait_for_settlement", False))
        max_status_polls_value = kwargs.pop("max_status_polls", 1)
        if not isinstance(max_status_polls_value, int | str):
            message = "max_status_polls must be an integer"
            raise TypeError(message)
        max_status_polls = int(max_status_polls_value)
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
        self._emit_order_event(
            "SellOrderCreated",
            tracked,
            context=_OrderEventContext(
                client_order_id=request.client_order_id,
                trading_pair=normalized_pair,
                trade_type="SELL",
                amount=str(amount),
            ),
        )
        if wait_for_settlement:
            tracked = await self._poll_until_terminal(
                request.client_order_id,
                max_polls=max_status_polls,
            )
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
        self._emit_order_event(
            "BuyOrderCreated",
            tracked,
            context=_OrderEventContext(
                client_order_id=request.client_order_id,
                trading_pair=normalized_pair,
                trade_type="BUY",
                amount=str(amount),
            ),
        )
        return tracked

    async def cancel(self, client_order_id: str) -> object:
        """Cancel an in-flight order by Hummingbot client order ID."""
        tracked = await self._connector.cancel_order(client_order_id)
        self._in_flight_orders[client_order_id] = tracked
        self._emit_order_event(
            "OrderCancelled",
            tracked,
            context=_OrderEventContext(client_order_id=client_order_id),
        )
        return tracked

    def record_order_update(self, order: object) -> HummingbotOrderEvent:
        """Track an order update and emit the matching Hummingbot-style event."""
        client_order_id = _order_client_order_id(order)
        self._in_flight_orders[client_order_id] = order
        event_tag = _hummingbot_order_event_tag(order)
        return self._emit_order_event(
            event_tag,
            order,
            context=_OrderEventContext(client_order_id=client_order_id),
        )

    async def _poll_until_terminal(self, client_order_id: str, *, max_polls: int) -> object:
        if max_polls < 1:
            message = "max_status_polls must be at least 1"
            raise ValueError(message)

        order = self._in_flight_orders[client_order_id]
        for _ in range(max_polls):
            order = await self._connector.poll_order(client_order_id)
            self.record_order_update(order)
            if _is_terminal_order(order):
                return order

        message = f"order {client_order_id} did not reach a terminal CoW state"
        raise TimeoutError(message)

    def _tokens_for_pair(self, trading_pair: str) -> tuple[CoWToken, CoWToken]:
        normalized_pair = self.convert_from_exchange_trading_pair(trading_pair)
        try:
            return self._tokens_by_pair[normalized_pair]
        except KeyError as exc:
            message = f"unsupported trading_pair for CoW shim: {trading_pair}"
            raise ValueError(message) from exc

    def _emit_order_event(
        self,
        event_tag: str,
        order: object,
        *,
        context: _OrderEventContext | None = None,
    ) -> HummingbotOrderEvent:
        context = context or _OrderEventContext()
        event = HummingbotOrderEvent(
            event_tag=event_tag,
            client_order_id=context.client_order_id or _order_client_order_id(order),
            trading_pair=context.trading_pair or _order_trading_pair(order),
            trade_type=context.trade_type,
            order_state=_hummingbot_order_state(order),
            timestamp=time(),
            exchange_order_id=_order_exchange_order_id(order),
            amount=context.amount,
        )
        self.trigger_event(event_tag, event)
        return event


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
    state = _order_value(order, "state")
    if isinstance(state, OrderState):
        return HUMMINGBOT_ORDER_STATES[state]
    raw_status = str(state).lower() if state is not None else _hummingbot_raw_status(order)
    if raw_status in RAW_COW_STATE_TO_HUMMINGBOT_ORDER_STATE:
        return RAW_COW_STATE_TO_HUMMINGBOT_ORDER_STATE[raw_status]
    if state is not None:
        normalized = str(state).upper()
        if normalized == "CANCELLED":
            return "CANCELED"
        return normalized
    return "UNKNOWN"


def _hummingbot_order_event_tag(order: object) -> str:
    state = _order_value(order, "state")
    if isinstance(state, OrderState):
        return HUMMINGBOT_ORDER_EVENT_TAGS[state]
    raw_status = str(state).lower() if state is not None else _hummingbot_raw_status(order)
    if raw_status in RAW_COW_STATE_TO_EVENT_TAG:
        return RAW_COW_STATE_TO_EVENT_TAG[raw_status]
    normalized = str(state).lower() if state is not None else ""
    for local_state, event_tag in HUMMINGBOT_ORDER_EVENT_TAGS.items():
        if normalized == local_state.value:
            return event_tag
    return "OrderUpdated"


def _is_terminal_order(order: object) -> bool:
    state = _order_value(order, "state")
    if isinstance(state, OrderState):
        return state in {
            OrderState.FILLED,
            OrderState.CANCELLED,
            OrderState.EXPIRED,
            OrderState.FAILED,
        }
    return str(state).upper() in {"FILLED", "CANCELLED", "CANCELED", "EXPIRED", "FAILED"}


def _order_client_order_id(order: object) -> str:
    value = _order_value(order, "client_order_id")
    if value is None:
        message = "order update is missing client_order_id"
        raise ValueError(message)
    return str(value)


def _order_trading_pair(order: object) -> str:
    value = _order_value(order, "trading_pair")
    return str(value) if value is not None else ""


def _order_exchange_order_id(order: object) -> str | None:
    value = _order_value(order, "order_uid")
    return str(value) if value is not None else None


def _order_value(order: object, key: str) -> object | None:
    if isinstance(order, Mapping):
        return order.get(key)
    return getattr(order, key, None)


def _hummingbot_raw_status(order: object) -> str:
    raw_status = _order_value(order, "raw_status")
    return str(raw_status).lower() if raw_status is not None else ""


def _reject_private_key_material(kwargs: Mapping[str, object]) -> None:
    for key in kwargs:
        if "private_key" in key.lower() or "raw_private" in key.lower():
            message = "raw private key material is not accepted by the CoW Hummingbot shim"
            raise ValueError(message)
