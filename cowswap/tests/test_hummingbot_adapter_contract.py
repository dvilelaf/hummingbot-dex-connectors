"""Contract tests for the minimal Hummingbot-facing CoW shim."""

from __future__ import annotations

from decimal import Decimal

import pytest

from hummingbot_cowswap import BuyOrderRequest, CoWToken, OrderState, SellOrderRequest, TrackedOrder
from hummingbot_cowswap.hummingbot_adapter import (
    HummingbotCoWAdapter,
    HummingbotOrderEvent,
)

USDC = CoWToken(
    symbol="USDC",
    address="0x0000000000000000000000000000000000000001",
    decimals=6,
)
WETH = CoWToken(
    symbol="WETH",
    address="0x0000000000000000000000000000000000000002",
    decimals=18,
)


class FakeConnector:
    def __init__(self) -> None:
        self.submitted: list[BuyOrderRequest | SellOrderRequest] = []
        self.cancelled: list[str] = []

    async def submit_sell_order(self, request: SellOrderRequest) -> object:
        self.submitted.append(request)
        return {"client_order_id": request.client_order_id, "state": "open"}

    async def submit_buy_order(self, request: BuyOrderRequest) -> object:
        self.submitted.append(request)
        return {"client_order_id": request.client_order_id, "state": "open"}

    async def cancel_order(self, client_order_id: str) -> object:
        self.cancelled.append(client_order_id)
        return {"client_order_id": client_order_id, "state": "cancelled"}


def test_adapter_exposes_conservative_hummingbot_contract() -> None:
    adapter = HummingbotCoWAdapter(FakeConnector(), {"USDC-WETH": (USDC, WETH)})

    assert adapter.connector_name == "cowswap"
    assert adapter.config_map()["connector"] == "cowswap"
    assert adapter.config_map()["supported_trade_types"] == ("BUY", "SELL")
    assert adapter.order_types == ("MARKET",)
    assert adapter.supported_order_types() == ("MARKET",)
    assert adapter.in_flight_orders == {}
    assert set(adapter.trading_rules) == {"USDC-WETH"}
    assert adapter.trading_rules["USDC-WETH"].min_base_amount_increment == Decimal("0.000001")
    assert adapter.trading_rules["USDC-WETH"].min_quote_amount_increment == Decimal(
        "0.000000000000000001"
    )


def test_adapter_normalizes_hummingbot_trading_pairs() -> None:
    adapter = HummingbotCoWAdapter(FakeConnector(), {"USDC/WETH": (USDC, WETH)})

    assert adapter.trading_rules["USDC-WETH"].trading_pair == "USDC-WETH"
    assert adapter.convert_from_exchange_trading_pair("usdc/weth") == "USDC-WETH"
    assert adapter.convert_to_exchange_trading_pair("usdc_weth") == "USDC-WETH"


@pytest.mark.asyncio
async def test_sell_converts_hummingbot_params_to_sell_order_request() -> None:
    connector = FakeConnector()
    adapter = HummingbotCoWAdapter(connector, {"USDC-WETH": (USDC, WETH)})

    result = await adapter.sell(
        trading_pair="USDC-WETH",
        amount=Decimal("1.25"),
        order_type="market",
        client_order_id="cid-1",
    )

    assert result == {"client_order_id": "cid-1", "state": "open"}
    assert connector.submitted == [
        SellOrderRequest(
            client_order_id="cid-1",
            trading_pair="USDC-WETH",
            sell_token=USDC,
            buy_token=WETH,
            amount="1.25",
        )
    ]
    assert adapter.in_flight_orders == {"cid-1": result}


@pytest.mark.asyncio
async def test_buy_converts_hummingbot_params_to_buy_order_request() -> None:
    connector = FakeConnector()
    adapter = HummingbotCoWAdapter(connector, {"USDC-WETH": (USDC, WETH)})

    result = await adapter.buy(
        trading_pair="usdc/weth",
        amount=Decimal("0.5"),
        order_type="market",
        client_order_id="cid-buy-1",
    )

    assert result == {"client_order_id": "cid-buy-1", "state": "open"}
    assert connector.submitted == [
        BuyOrderRequest(
            client_order_id="cid-buy-1",
            trading_pair="USDC-WETH",
            sell_token=USDC,
            buy_token=WETH,
            amount="0.5",
        )
    ]
    assert adapter.in_flight_orders == {"cid-buy-1": result}


@pytest.mark.asyncio
async def test_adapter_rejects_private_keys_and_unsupported_runtime_surface() -> None:
    adapter = HummingbotCoWAdapter(FakeConnector(), {"USDC-WETH": (USDC, WETH)})

    with pytest.raises(ValueError, match="private key"):
        await adapter.sell("USDC-WETH", Decimal(1), private_key="0xabc")

    with pytest.raises(ValueError, match="private key"):
        await adapter.buy("USDC-WETH", Decimal(1), private_key="0xabc")

    with pytest.raises(ValueError, match="unsupported order_type"):
        await adapter.sell("USDC-WETH", Decimal(1), order_type="LIMIT")

    with pytest.raises(ValueError, match="market-style SELL"):
        await adapter.sell("USDC-WETH", Decimal(1), price=Decimal(1))

    with pytest.raises(ValueError, match="market-style BUY"):
        await adapter.buy("USDC-WETH", Decimal(1), price=Decimal(1))


@pytest.mark.asyncio
async def test_in_flight_orders_expose_hummingbot_order_states() -> None:
    order = _tracked_order("cid-filled", OrderState.FILLED)
    connector = FakeConnector()
    connector.submit_sell_order = _async_return(order)  # type: ignore[method-assign]
    adapter = HummingbotCoWAdapter(connector, {"USDC-WETH": (USDC, WETH)})

    await adapter.sell("USDC/WETH", Decimal(1), client_order_id="cid-filled")

    assert adapter.in_flight_orders["cid-filled"] == order
    assert adapter.order_statuses == {"cid-filled": "FILLED"}


@pytest.mark.asyncio
async def test_adapter_emits_hummingbot_style_create_and_cancel_events() -> None:
    connector = FakeConnector()
    adapter = HummingbotCoWAdapter(connector, {"USDC-WETH": (USDC, WETH)})
    listener_events: list[HummingbotOrderEvent] = []
    adapter.add_listener("SellOrderCreated", listener_events.append)
    adapter.add_listener("OrderCancelled", listener_events.append)

    await adapter.sell("USDC-WETH", Decimal("1.25"), client_order_id="cid-evt")
    await adapter.cancel("cid-evt")

    assert [event.event_tag for event in adapter.event_log] == [
        "SellOrderCreated",
        "OrderCancelled",
    ]
    assert listener_events == adapter.event_log
    assert adapter.event_log[0].client_order_id == "cid-evt"
    assert adapter.event_log[0].trading_pair == "USDC-WETH"
    assert adapter.event_log[0].trade_type == "SELL"
    assert adapter.event_log[0].order_type == "MARKET"
    assert adapter.event_log[0].order_state == "OPEN"
    assert adapter.event_log[1].order_state == "CANCELED"


def test_adapter_maps_order_updates_to_hummingbot_style_events() -> None:
    adapter = HummingbotCoWAdapter(FakeConnector(), {"USDC-WETH": (USDC, WETH)})

    for state in OrderState:
        adapter.record_order_update(_tracked_order(f"cid-{state.value}", state))

    assert [event.event_tag for event in adapter.event_log] == [
        "OrderCreated",
        "OrderCreated",
        "OrderFilled",
        "OrderFilled",
        "OrderCancelled",
        "OrderExpired",
        "MarketOrderFailure",
    ]
    assert adapter.order_statuses == {
        "cid-submitted": "PENDING_CREATE",
        "cid-open": "OPEN",
        "cid-partially_filled": "PARTIALLY_FILLED",
        "cid-filled": "FILLED",
        "cid-cancelled": "CANCELED",
        "cid-expired": "FAILED",
        "cid-failed": "FAILED",
    }


def _tracked_order(client_order_id: str, state: OrderState) -> TrackedOrder:
    return TrackedOrder(
        client_order_id=client_order_id,
        trading_pair="USDC-WETH",
        order_uid="0xuid",
        owner="0xowner",
        receiver="0xreceiver",
        chain_id=1,
        sell_token=USDC,
        buy_token=WETH,
        sell_amount="1000000",
        buy_amount="1",
        valid_to=1,
        quote_id=None,
        digest="0xdigest",
        signing_scheme="eip712",
        partially_fillable=False,
        state=state,
    )


def _async_return(value: object) -> object:
    async def _inner(_request: SellOrderRequest) -> object:
        return value

    return _inner
