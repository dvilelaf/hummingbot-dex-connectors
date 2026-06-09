"""On-chain balance, allowance, and approval helpers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from hummingbot_cowswap.chain_config import ChainConfig
    from hummingbot_cowswap.models import CoWToken

NATIVE_TOKEN_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"  # noqa: S105


class EvmReader(Protocol):
    """Minimal EVM read interface needed before posting a CoW order."""

    def balance_of(self, token: CoWToken, owner: str) -> str:
        """Return ERC-20 balance in atomic units."""
        ...

    def allowance(self, token: CoWToken, owner: str, spender: str) -> str:
        """Return ERC-20 allowance in atomic units."""
        ...


class FakeEvmReader:
    """In-memory EVM reader used by connector tests."""

    def __init__(self, *, balance: str, allowance: str) -> None:
        """Create a fake reader with fixed balance and allowance."""
        self.balance = balance
        self.allowance_amount = allowance

    def balance_of(self, _token: CoWToken, _owner: str) -> str:
        """Return the configured fake balance."""
        return self.balance

    def allowance(self, _token: CoWToken, _owner: str, _spender: str) -> str:
        """Return the configured fake allowance."""
        return self.allowance_amount


def is_native_token(token: CoWToken) -> bool:
    """Return whether a token uses CoW's native-token marker address."""
    return token.address.casefold() == NATIVE_TOKEN_ADDRESS.casefold()


@dataclass(frozen=True)
class EthFlowPolicy:
    """Build native-token EthFlow transaction intents for Hummingbot/Gateway."""

    chain: ChainConfig

    def build_create_order_transaction(  # noqa: PLR0913
        self,
        *,
        sell_token: CoWToken,
        buy_token: CoWToken,
        owner: str,
        receiver: str,
        sell_amount: str,
        buy_amount: str,
        fee_amount: str,
        valid_to: int,
        app_data: str,
        quote_id: int,
        partially_fillable: bool,
    ) -> dict[str, object]:
        """Return a normalized EthFlow createOrder transaction intent."""
        if not is_native_token(sell_token):
            message = "EthFlow createOrder requires the native-token marker as sell token"
            raise ValueError(message)
        return {
            "chain_id": str(self.chain.chain_id),
            "from": owner,
            "method": "createOrder",
            "native_token_address": NATIVE_TOKEN_ADDRESS,
            "value": str(int(sell_amount) + int(fee_amount)),
            "signing_scheme": "eip1271",
            "onchain_order": True,
            "order": {
                "buy_token": buy_token.address,
                "receiver": receiver,
                "sell_amount": sell_amount,
                "buy_amount": buy_amount,
                "app_data": app_data,
                "fee_amount": fee_amount,
                "valid_to": str(valid_to),
                "partially_fillable": partially_fillable,
                "quote_id": str(quote_id),
            },
        }

    def build_invalidate_order_transaction(
        self,
        *,
        owner: str,
        order: dict[str, object],
    ) -> dict[str, object]:
        """Return a normalized EthFlow invalidateOrder transaction intent."""
        return {
            "chain_id": str(self.chain.chain_id),
            "from": owner,
            "method": "invalidateOrder",
            "order": order,
        }


@dataclass(frozen=True)
class ApprovalPolicy:
    """Build approval transaction intents for the configured CoW VaultRelayer."""

    chain: ChainConfig

    def build_approval_transaction(
        self,
        *,
        token: CoWToken,
        owner: str,
        amount: str,
    ) -> dict[str, str]:
        """Return a normalized ERC-20 approve transaction intent."""
        return {
            "chain_id": str(self.chain.chain_id),
            "from": owner,
            "to": token.address,
            "method": "approve",
            "spender": self.chain.vault_relayer,
            "amount": amount,
        }

    def build_revoke_transaction(self, *, token: CoWToken, owner: str) -> dict[str, str]:
        """Return an ERC-20 approve-zero transaction intent for the VaultRelayer."""
        return self.build_approval_transaction(token=token, owner=owner, amount="0")

    def build_allowance_reset_sequence(
        self,
        *,
        token: CoWToken,
        owner: str,
        amount: str,
        current_allowance: str,
        reset_first: bool,
    ) -> tuple[dict[str, str], ...]:
        """Return revoke+approve intents for tokens that require zero-first approvals."""
        approval = self.build_approval_transaction(token=token, owner=owner, amount=amount)
        if reset_first and int(current_allowance) > 0 and int(amount) > 0:
            revoke = self.build_revoke_transaction(token=token, owner=owner)
            return (revoke, approval)
        return (approval,)
