"""Opt-in live CoW API smoke tests using generated dummy wallets."""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

import pytest
from eth_account import Account

from hummingbot_cowswap import (
    CoWConfig,
    CoWConnector,
    CowPyEip712Signer,
    CoWToken,
    SellOrderRequest,
)
from hummingbot_cowswap.persistence import JsonOrderStore

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = pytest.mark.skipif(
    os.environ.get("COWSWAP_RUN_INTEGRATION") != "1",
    reason="set COWSWAP_RUN_INTEGRATION=1 to call the live CoW API with a dummy wallet",
)


BASE_USDC = CoWToken(
    symbol="USDC",
    address="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals=6,
)
BASE_WETH = CoWToken(
    symbol="WETH",
    address="0x4200000000000000000000000000000000000006",
    decimals=18,
)


@pytest.mark.asyncio
async def test_live_quote_sign_post_reaches_cow_api_with_dummy_wallet(tmp_path: Path) -> None:
    account = Account.create()
    config = CoWConfig(
        chain_id=8453,
        chain_name="base",
        owner=account.address,
        receiver=account.address,
        app_data="0x" + "00" * 32,
        slippage_bps=50,
        env=os.environ.get("COWSWAP_ENV", "staging"),
    )
    connector = CoWConnector(
        config=config,
        store=JsonOrderStore(tmp_path / "orders.json"),
        signer=CowPyEip712Signer(config=config, account=account),
    )

    try:
        await connector.submit_sell_order(
            SellOrderRequest(
                client_order_id="dummy-live-1",
                trading_pair="USDC-WETH",
                sell_token=BASE_USDC,
                buy_token=BASE_WETH,
                amount="1",
            )
        )
    except Exception as exc:
        message = str(exc)
        assert any(
            expected in message
            for expected in ["InsufficientBalance", "InsufficientAllowance", "Quote", "balance"]
        ), message
