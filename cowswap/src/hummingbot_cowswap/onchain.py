"""On-chain balance, allowance, and approval helpers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from hummingbot_cowswap.chain_config import ChainConfig
    from hummingbot_cowswap.models import CoWToken


class EvmReader(Protocol):
    """Minimal EVM read interface needed before posting a CoW order."""

    def balance_of(self, token: CoWToken, owner: str) -> str:
        """Return ERC-20 balance in atomic units."""

    def allowance(self, token: CoWToken, owner: str, spender: str) -> str:
        """Return ERC-20 allowance in atomic units."""


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
