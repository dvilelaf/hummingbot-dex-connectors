"""EIP-712 signing boundary for CoW orders."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from hummingbot_cowswap.chain_config import chain_config
from hummingbot_cowswap.cowpy import ensure_cowpy_submodule_imports

ETHEREUM_ADDRESS_LENGTH = 42
UINT32_MAX = 2**32 - 1

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
        _validate_signer_owner(self.config, self.account)
        _validate_order_payload(self.config, order)
        ensure_cowpy_submodule_imports()
        from cowdao_cowpy.contracts.order import compute_order_uid, hash_order
        from cowdao_cowpy.contracts.sign import SigningScheme, sign_order

        domain = _signing_domain(self.config)
        cow_order = _cow_order(order)
        signature = sign_order(
            domain=domain,
            order=cow_order,
            owner=self.account,
            scheme=SigningScheme.EIP712,
        )
        order_digest = hash_order(domain, cow_order)
        expected_order_uid = compute_order_uid(domain, cow_order, self.config.owner)
        return {
            **order,
            "signature": signature.to_string(),
            "signing_scheme": signature.scheme.name.lower(),
            "verifying_contract": settlement_contract(self.config),
            "order_digest": "0x" + order_digest.hex(),
            "expected_order_uid": expected_order_uid,
        }


def settlement_contract(config: CoWConfig) -> str:
    """Resolve the CoW settlement verifying contract for a config."""
    if config.settlement_contract is not None:
        _normalize_address(config.settlement_contract)
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


def _validate_signer_owner(config: CoWConfig, account: object) -> None:
    account_address = getattr(account, "address", None)
    if account_address is None:
        message = "signer account must expose an address"
        raise ValueError(message)

    if _normalize_address(str(account_address)) != _normalize_address(config.owner):
        message = "signer account does not match config owner"
        raise ValueError(message)


def _validate_order_payload(config: CoWConfig, order: dict[str, object]) -> None:
    if int(order.get("chain_id", config.chain_id)) != config.chain_id:
        message = "order chain_id does not match config chain_id"
        raise ValueError(message)
    order_owner = _normalize_address(str(order.get("owner", config.owner)))
    config_owner = _normalize_address(config.owner)
    if order_owner != config_owner:
        message = "order owner does not match config owner"
        raise ValueError(message)
    expected_contract = _normalize_address(settlement_contract(config))
    order_contract = order.get("verifying_contract")
    if order_contract is not None and _normalize_address(str(order_contract)) != expected_contract:
        message = "order verifying_contract does not match config settlement contract"
        raise ValueError(message)
    valid_to = int(order["valid_to"])
    if valid_to <= 0 or valid_to > UINT32_MAX:
        message = "order valid_to must fit CoW uint32 validity bounds"
        raise ValueError(message)


def _cow_order(order: dict[str, object]) -> object:
    ensure_cowpy_submodule_imports()
    from cowdao_cowpy.contracts.order import Order

    return Order(
        sell_token=str(order["sell_token"]),
        buy_token=str(order["buy_token"]),
        receiver=str(order["receiver"]),
        sell_amount=str(order["sell_amount"]),
        buy_amount=str(order["buy_amount"]),
        valid_to=int(order["valid_to"]),
        app_data=str(order["app_data"]),
        fee_amount=str(order["fee_amount"]),
        kind=str(order.get("kind", "sell")),
        partially_fillable=bool(order["partially_fillable"]),
        sell_token_balance="erc20",
        buy_token_balance="erc20",
    )


def _normalize_address(address: str) -> str:
    if not address.startswith("0x") or len(address) != ETHEREUM_ADDRESS_LENGTH:
        message = f"invalid Ethereum address: {address}"
        raise ValueError(message)
    try:
        int(address, 0)
    except ValueError as exc:
        message = f"invalid Ethereum address: {address}"
        raise ValueError(message) from exc
    return address.lower()
