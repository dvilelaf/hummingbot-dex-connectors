"""Preflight and on-chain safety tests for the CoW connector."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from hummingbot_cowswap import CoWConfig, CoWConnector, CoWToken, SellOrderRequest
from hummingbot_cowswap.chain_config import chain_config
from hummingbot_cowswap.errors import (
    DuplicateOrderError,
    InsufficientAllowanceError,
    InsufficientBalanceError,
    StaleQuoteError,
    UnsupportedChainError,
    UnsupportedTokenError,
)
from hummingbot_cowswap.models import BuyOrderRequest
from hummingbot_cowswap.onchain import ApprovalPolicy, FakeEvmReader
from hummingbot_cowswap.persistence import JsonOrderStore

OWNER = "0x00000000000000000000000000000000000000aa"
USDC = CoWToken(
    symbol="USDC",
    address="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals=6,
)
WETH = CoWToken(
    symbol="WETH",
    address="0x4200000000000000000000000000000000000006",
    decimals=18,
)


class FakeClient:
    """CoW client fake with configurable quote validity."""

    def __init__(self, *, valid_to: int = 1_900_000_000) -> None:
        self.quote_requests: list[dict[str, object]] = []
        self.posted_orders: list[dict[str, object]] = []
        self.valid_to = valid_to

    async def quote_sell(self, request: dict[str, object]) -> object:
        """Return a minimal cowpy-shaped quote."""
        self.quote_requests.append(request)
        return SimpleNamespace(
            id=99,
            verified=True,
            quote=SimpleNamespace(
                sellAmount=SimpleNamespace(root="1000000"),
                buyAmount=SimpleNamespace(root="500000000000000000"),
                feeAmount=SimpleNamespace(root="0"),
                validTo=self.valid_to,
            ),
        )

    async def quote_buy(self, request: dict[str, object]) -> object:
        """Return a minimal cowpy-shaped buy quote."""
        self.quote_requests.append(request)
        return SimpleNamespace(
            id=100,
            verified=True,
            quote=SimpleNamespace(
                sellAmount=SimpleNamespace(root="1000000"),
                buyAmount=SimpleNamespace(root="500000000000000000"),
                feeAmount=SimpleNamespace(root="0"),
                validTo=self.valid_to,
            ),
        )

    async def post_sell_order(self, order: dict[str, object]) -> str:
        """Capture a posted order and return a deterministic UID."""
        self.posted_orders.append(order)
        if "expected_order_uid" in order:
            return str(order["expected_order_uid"])
        valid_to = int(order["valid_to"])
        return f"0x{'aa' * 32}{str(order['owner'])[2:]}{valid_to:08x}"

    async def get_order_status(self, _order_uid: str) -> object:
        """Return an open status."""
        return SimpleNamespace(status="open", executedSellAmount="0", executedBuyAmount="0")

    async def get_trades(self, _order_uid: str) -> list[object]:
        """Return no trades."""
        return []

    async def cancel_order(self, _order_uid: str) -> None:
        """Record no-op cancellation."""


def config(chain_id: int = 8453) -> CoWConfig:
    """Build a Base connector config."""
    return CoWConfig(
        chain_id=chain_id,
        chain_name="base",
        owner=OWNER,
        receiver=OWNER,
        app_data="0x" + "00" * 32,
        slippage_bps=50,
    )


def request(client_order_id: str = "cid-1") -> SellOrderRequest:
    """Build a sell order request."""
    return SellOrderRequest(
        client_order_id=client_order_id,
        trading_pair="USDC-WETH",
        sell_token=USDC,
        buy_token=WETH,
        amount="1.0",
    )


def buy_request(client_order_id: str = "cid-buy-1") -> BuyOrderRequest:
    """Build a buy order request."""
    return BuyOrderRequest(
        client_order_id=client_order_id,
        trading_pair="USDC-WETH",
        sell_token=USDC,
        buy_token=WETH,
        amount="0.5",
    )


def connector(
    tmp_path: Path,
    *,
    evm_reader: FakeEvmReader | None = None,
    client: FakeClient | None = None,
    cfg: CoWConfig | None = None,
) -> CoWConnector:
    """Build a connector with fakes."""
    return CoWConnector(
        config=cfg or config(),
        client=client or FakeClient(),
        store=JsonOrderStore(tmp_path / "orders.json"),
        evm_reader=evm_reader,
    )


@pytest.mark.asyncio
async def test_submit_rejects_unsupported_chain_before_quote(tmp_path: Path) -> None:
    """Unsupported chains fail before CoW API interaction."""
    client = FakeClient()
    cow = connector(tmp_path, cfg=config(chain_id=10), client=client)

    with pytest.raises(UnsupportedChainError):
        await cow.submit_sell_order(request())

    assert client.quote_requests == []


@pytest.mark.asyncio
async def test_submit_rejects_insufficient_balance_before_quote(tmp_path: Path) -> None:
    """Insufficient sell-token balance fails before quoting."""
    client = FakeClient()
    reader = FakeEvmReader(balance="999999", allowance="1000000")
    cow = connector(tmp_path, evm_reader=reader, client=client)

    with pytest.raises(InsufficientBalanceError):
        await cow.submit_sell_order(request())

    assert client.quote_requests == []


@pytest.mark.asyncio
async def test_submit_rejects_insufficient_allowance_separately(tmp_path: Path) -> None:
    """Insufficient allowance is reported separately from balance and quote failures."""
    client = FakeClient()
    reader = FakeEvmReader(balance="1000000", allowance="999999")
    cow = connector(tmp_path, evm_reader=reader, client=client)

    with pytest.raises(InsufficientAllowanceError):
        await cow.submit_sell_order(request())

    assert client.quote_requests == []


@pytest.mark.asyncio
async def test_submit_rejects_invalid_token_before_quote(tmp_path: Path) -> None:
    """Invalid token metadata fails before CoW API interaction."""
    client = FakeClient()
    invalid_token = CoWToken(symbol="BAD", address="not-an-address", decimals=18)
    cow = connector(tmp_path, client=client)

    with pytest.raises(UnsupportedTokenError):
        await cow.submit_sell_order(request().model_copy(update={"buy_token": invalid_token}))

    assert client.quote_requests == []


def test_build_approval_transaction_targets_verified_vault_relayer() -> None:
    """Approval planning targets the configured CoW VaultRelayer."""
    policy = ApprovalPolicy(chain_config(8453, "prod"))

    tx = policy.build_approval_transaction(
        token=USDC,
        owner=OWNER,
        amount="1000000",
    )

    assert tx["to"] == USDC.address
    assert tx["from"] == OWNER
    assert tx["spender"] == "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110"
    assert tx["amount"] == "1000000"


def test_build_allowance_reset_sequence_revokes_before_approval_when_required() -> None:
    """Zero-first token approvals are planned as revoke then exact approval."""
    policy = ApprovalPolicy(chain_config(8453, "prod"))

    sequence = policy.build_allowance_reset_sequence(
        token=USDC,
        owner=OWNER,
        amount="1000000",
        current_allowance="5",
        reset_first=True,
    )

    assert [tx["amount"] for tx in sequence] == ["0", "1000000"]
    assert {tx["spender"] for tx in sequence} == {"0xC92E8bdf79f0507f65a392b0ab4667716BFE0110"}


def test_build_allowance_reset_sequence_skips_revoke_when_not_required() -> None:
    """Standard ERC-20 approvals remain a single exact approval intent."""
    policy = ApprovalPolicy(chain_config(8453, "prod"))

    sequence = policy.build_allowance_reset_sequence(
        token=USDC,
        owner=OWNER,
        amount="1000000",
        current_allowance="5",
        reset_first=False,
    )

    assert len(sequence) == 1
    assert sequence[0]["amount"] == "1000000"


@pytest.mark.asyncio
async def test_submit_rejects_stale_quote_before_post(tmp_path: Path) -> None:
    """Expired quotes are rejected before order posting."""
    client = FakeClient(valid_to=1)
    reader = FakeEvmReader(balance="1000000", allowance="1000000")
    cow = connector(tmp_path, evm_reader=reader, client=client)

    with pytest.raises(StaleQuoteError):
        await cow.submit_sell_order(request())

    assert client.posted_orders == []


@pytest.mark.asyncio
async def test_submit_rejects_duplicate_client_order_id(tmp_path: Path) -> None:
    """Duplicate client order IDs are rejected before submitting a second order."""
    reader = FakeEvmReader(balance="1000000", allowance="1000000")
    client = FakeClient()
    cow = connector(tmp_path, evm_reader=reader, client=client)

    await cow.submit_sell_order(request("cid-dup"))

    with pytest.raises(DuplicateOrderError):
        await cow.submit_sell_order(request("cid-dup"))

    assert len(client.posted_orders) == 1


@pytest.mark.asyncio
async def test_submit_buy_rejects_stale_quote_before_post(tmp_path: Path) -> None:
    """Expired buy quotes are rejected before order posting."""
    client = FakeClient(valid_to=1)
    reader = FakeEvmReader(balance="1005000", allowance="1005000")
    cow = connector(tmp_path, evm_reader=reader, client=client)

    with pytest.raises(StaleQuoteError):
        await cow.submit_buy_order(buy_request())

    assert client.posted_orders == []


@pytest.mark.asyncio
async def test_submit_buy_rejects_duplicate_client_order_id(tmp_path: Path) -> None:
    """Duplicate buy client order IDs are rejected before submitting a second order."""
    reader = FakeEvmReader(balance="1005000", allowance="1005000")
    client = FakeClient()
    cow = connector(tmp_path, evm_reader=reader, client=client)

    await cow.submit_buy_order(buy_request("cid-buy-dup"))

    with pytest.raises(DuplicateOrderError):
        await cow.submit_buy_order(buy_request("cid-buy-dup"))

    assert len(client.posted_orders) == 1
