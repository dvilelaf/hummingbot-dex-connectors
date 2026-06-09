"""EIP-712 signing boundary for CoW orders."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from hummingbot_cowswap.chain_config import chain_config
from hummingbot_cowswap.cowpy import ensure_cowpy_submodule_imports

if TYPE_CHECKING:
    from hummingbot_cowswap.models import CoWConfig


class OrderSigner(Protocol):
    """Protocol for Hummingbot-managed CoW order signers."""

    def sign_order_payload(self, order: dict[str, object]) -> dict[str, object]:
        """Return a signed order payload suitable for CoW order posting."""
        ...


class CowPyEip712Signer:
    """EIP-712 signer implementation using cowdao-cowpy primitives."""

    def __init__(self, *, config: CoWConfig, account: object) -> None:
        """Create a signer for one CoW chain/environment and EOA account."""
        self.config = config
        self.account = account

    def sign_order_payload(self, order: dict[str, object]) -> dict[str, object]:
        """Sign a connector order payload and attach CoW signature metadata."""
        ensure_cowpy_submodule_imports()
        from cowdao_cowpy.contracts.order import Order
        from cowdao_cowpy.contracts.sign import SigningScheme, sign_order

        cow_order = Order(
            sell_token=str(order["sell_token"]),
            buy_token=str(order["buy_token"]),
            receiver=str(order["receiver"]),
            sell_amount=str(order["sell_amount"]),
            buy_amount=str(order["buy_amount"]),
            valid_to=int(order["valid_to"]),
            app_data=str(order["app_data"]),
            fee_amount=str(order["fee_amount"]),
            kind="sell",
            partially_fillable=bool(order["partially_fillable"]),
            sell_token_balance="erc20",
            buy_token_balance="erc20",
        )
        signature = sign_order(
            domain=_signing_domain(self.config),
            order=cow_order,
            owner=self.account,
            scheme=SigningScheme.EIP712,
        )
        return {
            **order,
            "signature": signature.to_string(),
            "signing_scheme": signature.scheme.name.lower(),
            "verifying_contract": settlement_contract(self.config),
        }


def settlement_contract(config: CoWConfig) -> str:
    """Resolve the CoW settlement verifying contract for a config."""
    if config.settlement_contract is not None:
        return config.settlement_contract
    return chain_config(config.chain_id, config.env).settlement_contract


def _signing_domain(config: CoWConfig) -> object:
    ensure_cowpy_submodule_imports()
    from cowdao_cowpy.common.chains import Chain
    from cowdao_cowpy.contracts.domain import domain

    for chain in Chain:
        if chain.chain_id.value == config.chain_id:
            return domain(chain, settlement_contract(config))
    message = f"unsupported CoW chain_id: {config.chain_id}"
    raise ValueError(message)
