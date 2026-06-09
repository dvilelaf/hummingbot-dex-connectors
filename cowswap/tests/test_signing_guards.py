"""Signing boundary guards for CoW EIP-712 orders."""

from __future__ import annotations

import pytest
from eth_account import Account

from hummingbot_cowswap import CoWConfig, CowPyEip712Signer
from hummingbot_cowswap.signing import _signing_domain


def config_for(owner: str, **overrides: object) -> CoWConfig:
    values: dict[str, object] = {
        "chain_id": 8453,
        "chain_name": "base",
        "owner": owner,
        "receiver": owner,
        "app_data": "0x" + "00" * 32,
        "slippage_bps": 50,
    }
    values.update(overrides)
    return CoWConfig(**values)


def order_payload(receiver: str) -> dict[str, object]:
    return {
        "chain_id": 8453,
        "sell_token": "0x0000000000000000000000000000000000000001",
        "buy_token": "0x0000000000000000000000000000000000000002",
        "owner": receiver,
        "receiver": receiver,
        "sell_amount": "1000000",
        "buy_amount": "500000",
        "valid_to": 1_900_000_000,
        "app_data": "0x" + "00" * 32,
        "fee_amount": "0",
        "partially_fillable": False,
    }


def test_signing_domain_binds_chain_id_and_verifying_contract_override() -> None:
    owner = Account.create().address
    settlement = "0x00000000000000000000000000000000000000bb"

    domain = _signing_domain(config_for(owner, settlement_contract=settlement))

    assert domain.chainId == 8453
    assert domain.verifyingContract == settlement


def test_signing_domain_rejects_invalid_verifying_contract_override() -> None:
    owner = Account.create().address

    with pytest.raises(ValueError, match="invalid Ethereum address"):
        _signing_domain(config_for(owner, settlement_contract="0xnot-valid"))


def test_signer_rejects_account_owner_mismatch_before_signing() -> None:
    account = Account.create()
    other_owner = Account.create().address
    signer = CowPyEip712Signer(config=config_for(other_owner), account=account)

    with pytest.raises(ValueError, match="signer account does not match config owner"):
        signer.sign_order_payload(order_payload(other_owner))


def test_signer_rejects_cross_chain_order_payload() -> None:
    account = Account.create()
    signer = CowPyEip712Signer(config=config_for(account.address), account=account)
    payload = order_payload(account.address)
    payload["chain_id"] = 1

    with pytest.raises(ValueError, match="order chain_id does not match config chain_id"):
        signer.sign_order_payload(payload)


def test_signer_attaches_expected_digest_and_uid_for_signed_order() -> None:
    account = Account.create()
    signer = CowPyEip712Signer(config=config_for(account.address), account=account)

    signed = signer.sign_order_payload(order_payload(account.address))

    assert str(signed["order_digest"]).startswith("0x")
    assert len(str(signed["order_digest"])) == 66
    assert str(signed["expected_order_uid"]).startswith(str(signed["order_digest"]))
    assert str(signed["expected_order_uid"]).endswith("713fb300")
