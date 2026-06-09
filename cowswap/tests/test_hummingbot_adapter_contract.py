"""Contract tests for the minimal Hummingbot-facing CoW shim."""

from __future__ import annotations

from decimal import Decimal

import pytest

from hummingbot_cowswap import CoWToken, SellOrderRequest
from hummingbot_cowswap.hummingbot_adapter import HummingbotCoWAdapter

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
        self.submitted: list[SellOrderRequest] = []
        self.cancelled: list[str] = []

    async def submit_sell_order(self, request: SellOrderRequest) -> object:
        self.submitted.append(request)
        return {"client_order_id": request.client_order_id, "state": "open"}

    async def cancel_order(self, client_order_id: str) -> object:
        self.cancelled.append(client_order_id)
        return {"client_order_id": client_order_id, "state": "cancelled"}


def test_adapter_exposes_conservative_hummingbot_contract() -> None:
    adapter = HummingbotCoWAdapter(FakeConnector(), {"USDC-WETH": (USDC, WETH)})

    assert adapter.connector_name == "cowswap"
    assert adapter.supported_order_types() == ("MARKET",)
    assert adapter.in_flight_orders == {}
    assert set(adapter.trading_rules) == {"USDC-WETH"}
    assert adapter.trading_rules["USDC-WETH"].min_base_amount_increment == Decimal("0.000001")


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
async def test_adapter_rejects_private_keys_and_unsupported_runtime_surface() -> None:
    adapter = HummingbotCoWAdapter(FakeConnector(), {"USDC-WETH": (USDC, WETH)})

    with pytest.raises(ValueError, match="private key"):
        await adapter.sell("USDC-WETH", Decimal(1), private_key="0xabc")

    with pytest.raises(NotImplementedError, match="SELL"):
        await adapter.buy("USDC-WETH", Decimal(1))
