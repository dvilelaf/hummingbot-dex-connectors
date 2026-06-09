"""Unit tests for the CoW connector MVP lifecycle."""

from __future__ import annotations

from types import SimpleNamespace
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
from hummingbot_cowswap.models import BuyOrderRequest
from hummingbot_cowswap.persistence import JsonOrderStore
from hummingbot_cowswap.signing import settlement_contract

if TYPE_CHECKING:
    from pathlib import Path

BASE_USDC = CoWToken(
    symbol="USDC",
    address="0x0000000000000000000000000000000000000001",
    decimals=6,
)
BASE_WETH = CoWToken(
    symbol="WETH",
    address="0x0000000000000000000000000000000000000002",
    decimals=18,
)


class FakeCoWClient:
    def __init__(self) -> None:
        self.quote_requests: list[dict[str, object]] = []
        self.posted_orders: list[dict[str, object]] = []
        self.cancelled_uids: list[str] = []
        self.status = cow_order(status="open", executed_sell="0", executed_buy="0")
        self.trades: list[object] = []

    async def quote_sell(self, request: dict[str, object]) -> object:
        self.quote_requests.append(request)
        return cow_quote(
            quote_id=99,
            sell_amount="1000000",
            buy_amount="500000000000000000",
            fee_amount="0",
            valid_to=1_900_000_000,
            verified=True,
        )

    async def quote_buy(self, request: dict[str, object]) -> object:
        self.quote_requests.append(request)
        return cow_quote(
            quote_id=100,
            sell_amount="1000000",
            buy_amount="500000000000000000",
            fee_amount="0",
            valid_to=1_900_000_000,
            verified=True,
        )

    async def post_sell_order(self, order: dict[str, object]) -> str:
        self.posted_orders.append(order)
        return (
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
            "714fb300"
        )

    async def get_order_status(self, order_uid: str) -> object:
        assert order_uid
        return self.status

    async def get_trades(self, order_uid: str) -> list[object]:
        assert order_uid
        return self.trades

    async def cancel_order(self, order_uid: str) -> None:
        self.cancelled_uids.append(order_uid)


def connector(tmp_path: Path, client: FakeCoWClient) -> CoWConnector:
    return CoWConnector(
        config=CoWConfig(
            chain_id=8453,
            chain_name="base",
            owner="0x00000000000000000000000000000000000000aa",
            receiver="0x00000000000000000000000000000000000000aa",
            app_data="0x" + "00" * 32,
            slippage_bps=50,
        ),
        client=client,
        store=JsonOrderStore(tmp_path / "orders.json"),
    )


@pytest.mark.asyncio
async def test_quote_sell_normalizes_amounts_and_translates_slippage(tmp_path: Path) -> None:
    client = FakeCoWClient()
    cow = connector(tmp_path, client)

    quote, minimum_buy_amount = await cow.quote_sell(BASE_USDC, BASE_WETH, "1.0")

    assert client.quote_requests == [
        {
            "chain_id": 8453,
            "sell_token": BASE_USDC.address,
            "buy_token": BASE_WETH.address,
            "owner": "0x00000000000000000000000000000000000000aa",
            "receiver": "0x00000000000000000000000000000000000000aa",
            "sell_amount": "1000000",
            "app_data": "0x" + "00" * 32,
            "valid_to": None,
        }
    ]
    assert quote.quote.sellAmount.root == "1000000"
    assert quote.quote.buyAmount.root == "500000000000000000"
    assert minimum_buy_amount == "497500000000000000"


@pytest.mark.asyncio
async def test_quote_buy_normalizes_amounts_and_translates_slippage(tmp_path: Path) -> None:
    client = FakeCoWClient()
    cow = connector(tmp_path, client)

    quote, maximum_sell_amount = await cow.quote_buy(BASE_USDC, BASE_WETH, "0.5")

    assert client.quote_requests == [
        {
            "chain_id": 8453,
            "sell_token": BASE_USDC.address,
            "buy_token": BASE_WETH.address,
            "owner": "0x00000000000000000000000000000000000000aa",
            "receiver": "0x00000000000000000000000000000000000000aa",
            "buy_amount": "500000000000000000",
            "app_data": "0x" + "00" * 32,
            "valid_to": None,
        }
    ]
    assert quote.quote.sellAmount.root == "1000000"
    assert quote.quote.buyAmount.root == "500000000000000000"
    assert maximum_sell_amount == "1005000"


@pytest.mark.asyncio
async def test_submit_sell_order_posts_quote_derived_order_and_tracks_open_state(
    tmp_path: Path,
) -> None:
    client = FakeCoWClient()
    cow = connector(tmp_path, client)

    tracked = await cow.submit_sell_order(
        SellOrderRequest(
            client_order_id="cid-1",
            trading_pair="USDC-WETH",
            sell_token=BASE_USDC,
            buy_token=BASE_WETH,
            amount="1.0",
        )
    )

    assert tracked.state is OrderState.OPEN
    assert tracked.client_order_id == "cid-1"
    assert tracked.order_uid.startswith("0xaaaa")
    assert client.posted_orders[0]["buy_amount"] == "497500000000000000"
    assert client.posted_orders[0]["fee_amount"] == "0"
    assert client.posted_orders[0]["quote_id"] == 99

    recovered = JsonOrderStore(tmp_path / "orders.json").load("cid-1")
    assert recovered is not None
    assert recovered.order_uid == tracked.order_uid
    assert recovered.state is OrderState.OPEN


@pytest.mark.asyncio
async def test_submit_buy_order_posts_quote_derived_order_and_tracks_open_state(
    tmp_path: Path,
) -> None:
    client = FakeCoWClient()
    cow = connector(tmp_path, client)

    tracked = await cow.submit_buy_order(
        BuyOrderRequest(
            client_order_id="cid-buy-1",
            trading_pair="USDC-WETH",
            sell_token=BASE_USDC,
            buy_token=BASE_WETH,
            amount="0.5",
        )
    )

    assert tracked.state is OrderState.OPEN
    assert tracked.client_order_id == "cid-buy-1"
    assert tracked.order_uid.startswith("0xaaaa")
    assert client.posted_orders[0]["kind"] == "buy"
    assert client.posted_orders[0]["sell_amount"] == "1005000"
    assert client.posted_orders[0]["buy_amount"] == "500000000000000000"
    assert client.posted_orders[0]["quote_id"] == 100

    recovered = JsonOrderStore(tmp_path / "orders.json").load("cid-buy-1")
    assert recovered is not None
    assert recovered.order_uid == tracked.order_uid
    assert recovered.state is OrderState.OPEN


@pytest.mark.asyncio
async def test_submit_sell_order_signs_with_cowpy_eip712_dummy_account(tmp_path: Path) -> None:
    client = FakeCoWClient()
    account = Account.create()
    config = CoWConfig(
        chain_id=8453,
        chain_name="base",
        owner=account.address,
        receiver=account.address,
        app_data="0x" + "00" * 32,
        slippage_bps=50,
    )
    cow = CoWConnector(
        config=config,
        client=client,
        store=JsonOrderStore(tmp_path / "orders.json"),
        signer=CowPyEip712Signer(config=config, account=account),
    )

    await cow.submit_sell_order(
        SellOrderRequest(
            client_order_id="cid-signed",
            trading_pair="USDC-WETH",
            sell_token=BASE_USDC,
            buy_token=BASE_WETH,
            amount="1.0",
        )
    )

    posted = client.posted_orders[0]
    assert posted["signing_scheme"] == "eip712"
    assert posted["signature"].startswith("0x")
    assert len(posted["signature"]) == 132


@pytest.mark.asyncio
async def test_submit_buy_order_signs_with_cowpy_eip712_dummy_account(tmp_path: Path) -> None:
    client = FakeCoWClient()
    account = Account.create()
    config = CoWConfig(
        chain_id=8453,
        chain_name="base",
        owner=account.address,
        receiver=account.address,
        app_data="0x" + "00" * 32,
        slippage_bps=50,
    )
    cow = CoWConnector(
        config=config,
        client=client,
        store=JsonOrderStore(tmp_path / "orders.json"),
        signer=CowPyEip712Signer(config=config, account=account),
    )

    await cow.submit_buy_order(
        BuyOrderRequest(
            client_order_id="cid-buy-signed",
            trading_pair="USDC-WETH",
            sell_token=BASE_USDC,
            buy_token=BASE_WETH,
            amount="0.5",
        )
    )

    posted = client.posted_orders[0]
    assert posted["kind"] == "buy"
    assert posted["signing_scheme"] == "eip712"
    assert posted["signature"].startswith("0x")
    assert len(posted["signature"]) == 132


def test_settlement_contract_uses_staging_domain_when_configured() -> None:
    assert (
        settlement_contract(
            CoWConfig(
                chain_id=8453,
                chain_name="base",
                owner="0x00000000000000000000000000000000000000aa",
                receiver="0x00000000000000000000000000000000000000aa",
                app_data="0x" + "00" * 32,
                env="staging",
            )
        )
        == "0xf553d092b50bdcbddeD1A99aF2cA29FBE5E2CB13"
    )


@pytest.mark.asyncio
async def test_poll_order_maps_fulfilled_status_and_trade_amounts_to_filled_state(
    tmp_path: Path,
) -> None:
    client = FakeCoWClient()
    cow = connector(tmp_path, client)
    tracked = await cow.submit_sell_order(
        SellOrderRequest(
            client_order_id="cid-2",
            trading_pair="USDC-WETH",
            sell_token=BASE_USDC,
            buy_token=BASE_WETH,
            amount="1.0",
        )
    )
    client.status = cow_order(
        status="fulfilled",
        executed_sell="1000000",
        executed_buy="500000000000000000",
    )
    client.trades = [cow_trade(tx_hash="0xabc")]

    updated = await cow.poll_order(tracked.client_order_id)

    assert updated.state is OrderState.FILLED
    assert updated.executed_sell == "1000000"
    assert updated.executed_buy == "500000000000000000"
    assert updated.settlement_tx_hash == "0xabc"


@pytest.mark.asyncio
async def test_cancel_order_reconciles_cancelled_state(tmp_path: Path) -> None:
    client = FakeCoWClient()
    cow = connector(tmp_path, client)
    tracked = await cow.submit_sell_order(
        SellOrderRequest(
            client_order_id="cid-3",
            trading_pair="USDC-WETH",
            sell_token=BASE_USDC,
            buy_token=BASE_WETH,
            amount="1.0",
        )
    )
    client.status = cow_order(status="cancelled", executed_sell="0", executed_buy="0")

    cancelled = await cow.cancel_order(tracked.client_order_id)

    assert client.cancelled_uids == [tracked.order_uid]
    assert cancelled.state is OrderState.CANCELLED


@pytest.mark.asyncio
async def test_poll_order_maps_partial_expired_and_failed_states(tmp_path: Path) -> None:
    client = FakeCoWClient()
    cow = connector(tmp_path, client)
    tracked = await cow.submit_sell_order(
        SellOrderRequest(
            client_order_id="cid-states",
            trading_pair="USDC-WETH",
            sell_token=BASE_USDC,
            buy_token=BASE_WETH,
            amount="1.0",
            partially_fillable=True,
        )
    )

    client.status = cow_order(
        status="open",
        executed_sell="500000",
        executed_buy="250000000000000000",
    )
    partial = await cow.poll_order(tracked.client_order_id)
    assert partial.state is OrderState.PARTIALLY_FILLED

    client.status = cow_order(
        status="expired",
        executed_sell="500000",
        executed_buy="250000000000000000",
    )
    expired = await cow.poll_order(tracked.client_order_id)
    assert expired.state is OrderState.EXPIRED

    client.status = cow_order(status="rejected", executed_sell="0", executed_buy="0")
    failed = await cow.poll_order(tracked.client_order_id)
    assert failed.state is OrderState.FAILED


@pytest.mark.parametrize(
    ("raw_status", "executed_sell", "executed_buy", "trades", "expected_state", "expected_tx"),
    [
        (
            "fulfilled",
            "1000000",
            "500000000000000000",
            [SimpleNamespace(txHash="0xrestart")],
            OrderState.FILLED,
            "0xrestart",
        ),
        ("expired", "0", "0", [], OrderState.EXPIRED, None),
        ("cancelled", "0", "0", [], OrderState.CANCELLED, None),
        ("unknown-api-status", "0", "0", [], OrderState.FAILED, None),
    ],
)
@pytest.mark.asyncio
async def test_new_connector_instance_reconciles_persisted_order_states_after_restart(
    tmp_path: Path,
    raw_status: str,
    executed_sell: str,
    executed_buy: str,
    trades: list[object],
    expected_state: OrderState,
    expected_tx: str | None,
) -> None:
    client = FakeCoWClient()
    store_path = tmp_path / "orders.json"
    first = CoWConnector(
        config=CoWConfig(
            chain_id=8453,
            chain_name="base",
            owner="0x00000000000000000000000000000000000000aa",
            receiver="0x00000000000000000000000000000000000000aa",
            app_data="0x" + "00" * 32,
            slippage_bps=50,
        ),
        client=client,
        store=JsonOrderStore(store_path),
    )
    await first.submit_sell_order(
        SellOrderRequest(
            client_order_id="cid-restart",
            trading_pair="USDC-WETH",
            sell_token=BASE_USDC,
            buy_token=BASE_WETH,
            amount="1.0",
        )
    )

    client.status = cow_order(
        status=raw_status,
        executed_sell=executed_sell,
        executed_buy=executed_buy,
    )
    client.trades = trades
    restarted = CoWConnector(
        config=first.config,
        client=client,
        store=JsonOrderStore(store_path),
    )

    reconciled = await restarted.poll_order("cid-restart")
    recovered = JsonOrderStore(store_path).load("cid-restart")

    assert reconciled.state is expected_state
    assert reconciled.raw_status == raw_status
    assert reconciled.executed_sell == executed_sell
    assert reconciled.executed_buy == executed_buy
    assert reconciled.settlement_tx_hash == expected_tx
    assert recovered == reconciled


def test_json_order_store_round_trips_tracked_order(tmp_path: Path) -> None:
    store = JsonOrderStore(tmp_path / "orders.json")
    order = store.save_new(
        client_order_id="cid-4",
        trading_pair="USDC-WETH",
        order_uid="0xuid",
        owner="0xowner",
        receiver="0xreceiver",
        chain_id=8453,
        sell_token=BASE_USDC,
        buy_token=BASE_WETH,
        sell_amount="1000000",
        buy_amount="497500000000000000",
        valid_to=1_900_000_000,
        quote_id=99,
        digest="0xdigest",
        signing_scheme="eip712",
        partially_fillable=False,
    )

    loaded = JsonOrderStore(tmp_path / "orders.json").load("cid-4")

    assert order.state is OrderState.SUBMITTED
    assert loaded == order


def cow_quote(
    *,
    quote_id: int,
    sell_amount: str,
    buy_amount: str,
    fee_amount: str,
    valid_to: int,
    verified: bool,
) -> object:
    return SimpleNamespace(
        id=quote_id,
        verified=verified,
        quote=SimpleNamespace(
            sellAmount=SimpleNamespace(root=sell_amount),
            buyAmount=SimpleNamespace(root=buy_amount),
            feeAmount=SimpleNamespace(root=fee_amount),
            validTo=valid_to,
        ),
    )


def cow_order(*, status: str, executed_sell: str, executed_buy: str) -> object:
    return SimpleNamespace(
        status=status,
        executedSellAmount=executed_sell,
        executedBuyAmount=executed_buy,
    )


def cow_trade(*, tx_hash: str) -> object:
    return SimpleNamespace(txHash=tx_hash)
