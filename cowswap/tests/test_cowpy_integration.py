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
    OrderState,
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
async def test_live_quote_reaches_cow_api_with_dummy_wallet(tmp_path: Path) -> None:
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

    quote, minimum_buy_amount = await connector.quote_sell(BASE_USDC, BASE_WETH, "1")

    assert quote is not None
    assert int(minimum_buy_amount) > 0


@pytest.mark.skipif(
    os.environ.get("COWSWAP_RUN_FULL_LIFECYCLE") != "1",
    reason=(
        "set COWSWAP_RUN_FULL_LIFECYCLE=1 with a funded test account and allowance "
        "to run the live quote/sign/post/poll/cancel lifecycle"
    ),
)
@pytest.mark.asyncio
async def test_live_full_lifecycle_posts_polls_and_cancels_or_settles(tmp_path: Path) -> None:
    private_key = os.environ.get("COWSWAP_TEST_PRIVATE_KEY")
    amount = os.environ.get("COWSWAP_FULL_LIFECYCLE_AMOUNT")
    if not private_key or not amount:
        pytest.skip("COWSWAP_TEST_PRIVATE_KEY and COWSWAP_FULL_LIFECYCLE_AMOUNT are required")

    account = Account.from_key(private_key)
    config = CoWConfig(
        chain_id=int(os.environ.get("COWSWAP_CHAIN_ID", "8453")),
        chain_name=os.environ.get("COWSWAP_CHAIN_NAME", "base"),
        owner=account.address,
        receiver=os.environ.get("COWSWAP_RECEIVER_ADDRESS", account.address),
        app_data=os.environ.get("COWSWAP_APP_DATA", "0x" + "00" * 32),
        slippage_bps=int(os.environ.get("COWSWAP_SLIPPAGE_BPS", "50")),
        env=os.environ.get("COWSWAP_ENV", "staging"),
    )
    connector = CoWConnector(
        config=config,
        store=JsonOrderStore(tmp_path / "full-lifecycle-orders.json"),
        signer=CowPyEip712Signer(config=config, account=account),
    )

    posted = await connector.submit_sell_order(
        SellOrderRequest(
            client_order_id="funded-live-1",
            trading_pair=os.environ.get("COWSWAP_SYMBOL", "USDC-WETH"),
            sell_token=BASE_USDC,
            buy_token=BASE_WETH,
            amount=amount,
        )
    )
    polled = await connector.poll_order(posted.client_order_id)
    if polled.state in {OrderState.FILLED, OrderState.CANCELLED, OrderState.EXPIRED}:
        terminal = polled
    else:
        terminal = await connector.cancel_order(posted.client_order_id)

    assert terminal.order_uid == posted.order_uid
    assert terminal.state in {
        OrderState.FILLED,
        OrderState.CANCELLED,
        OrderState.EXPIRED,
        OrderState.FAILED,
    }
