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
from hummingbot_cowswap.onchain import (
    NATIVE_TOKEN_ADDRESS,
    ApprovalPolicy,
    EthFlowPolicy,
    FakeEvmReader,
    is_native_token,
)
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
ETH = CoWToken(
    symbol="ETH",
    address=NATIVE_TOKEN_ADDRESS,
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

    async def cancel_order(
        self,
        _order_uid: str,
        _cancellation: dict[str, object] | None = None,
    ) -> None:
        """Record no-op cancellation."""


class FakeSigner:
    """Signer fake that marks orders as signed without private key material."""

    def sign_order_payload(self, order: dict[str, object]) -> dict[str, object]:
        """Attach deterministic signature metadata."""
        valid_to = int(order["valid_to"])
        return {
            **order,
            "signature": "0x" + "11" * 65,
            "signing_scheme": "eip712",
            "expected_order_uid": f"0x{'aa' * 32}{str(order['owner'])[2:]}{valid_to:08x}",
        }

    def sign_order_cancellation(self, order_uids: list[str]) -> dict[str, object]:
        """Attach deterministic cancellation signature metadata."""
        return {
            "order_uids": tuple(order_uids),
            "signature": "0x" + "22" * 65,
            "signing_scheme": "eip712",
        }


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
        signer=FakeSigner(),
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


def test_eth_flow_policy_builds_native_sell_create_order_intent() -> None:
    """Native ETH sells use a distinct EthFlow on-chain transaction path."""
    policy = EthFlowPolicy(chain_config(8453, "prod"))

    intent = policy.build_create_order_transaction(
        sell_token=ETH,
        buy_token=USDC,
        owner=OWNER,
        receiver=OWNER,
        sell_amount="1000000000000000000",
        buy_amount="2500000000",
        fee_amount="1000000000000000",
        valid_to=1_900_000_000,
        app_data="0x" + "00" * 32,
        quote_id=123,
        partially_fillable=False,
    )

    assert is_native_token(ETH) is True
    assert intent["method"] == "createOrder"
    assert intent["signing_scheme"] == "eip1271"
    assert intent["onchain_order"] is True
    assert intent["native_token_address"] == NATIVE_TOKEN_ADDRESS
    assert intent["value"] == "1001000000000000000"
    assert intent["order"] == {
        "buy_token": USDC.address,
        "receiver": OWNER,
        "sell_amount": "1000000000000000000",
        "buy_amount": "2500000000",
        "app_data": "0x" + "00" * 32,
        "fee_amount": "1000000000000000",
        "valid_to": "1900000000",
        "partially_fillable": False,
        "quote_id": "123",
    }


def test_eth_flow_policy_rejects_erc20_sell_token_for_native_path() -> None:
    """ERC-20 sells must keep using the regular approval and signing path."""
    policy = EthFlowPolicy(chain_config(8453, "prod"))

    with pytest.raises(ValueError, match="native-token marker"):
        policy.build_create_order_transaction(
            sell_token=USDC,
            buy_token=WETH,
            owner=OWNER,
            receiver=OWNER,
            sell_amount="1000000",
            buy_amount="1",
            fee_amount="0",
            valid_to=1_900_000_000,
            app_data="0x" + "00" * 32,
            quote_id=123,
            partially_fillable=False,
        )


def test_eth_flow_policy_builds_invalidate_order_intent() -> None:
    """Native ETH cancellation uses an on-chain invalidateOrder/refund path."""
    policy = EthFlowPolicy(chain_config(8453, "prod"))
    order = {"buy_token": USDC.address, "sell_amount": "1"}

    intent = policy.build_invalidate_order_transaction(owner=OWNER, order=order)

    assert intent == {
        "chain_id": "8453",
        "from": OWNER,
        "method": "invalidateOrder",
        "order": order,
    }
