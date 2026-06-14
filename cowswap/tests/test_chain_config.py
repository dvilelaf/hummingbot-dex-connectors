"""Chain configuration validation tests."""

from __future__ import annotations

import pytest

from hummingbot_cowswap.chain_config import (
    ChainConfig,
    chain_config,
    contract_address_verifications,
    verify_configured_contract_addresses,
)
from hummingbot_cowswap.errors import UnsupportedChainError


def test_base_prod_chain_config_uses_https_and_verified_contracts() -> None:
    """Base prod config exposes the expected CoW endpoint and contracts."""
    config = chain_config(8453, "prod")

    assert config.order_book_url == "https://api.cow.fi/base"
    assert config.settlement_contract == "0x9008D19f58AAbD9eD0D60971565AA8510560ab41"
    assert config.vault_relayer == "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110"


def test_base_staging_chain_config_uses_barn_endpoint_and_staging_domain() -> None:
    """Base staging config separates API/domain from production."""
    config = chain_config(8453, "staging")

    assert config.order_book_url == "https://barn.api.cow.fi/base"
    assert config.settlement_contract == "0xf553d092b50bdcbddeD1A99aF2cA29FBE5E2CB13"
    assert config.vault_relayer == "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110"


@pytest.mark.parametrize(
    ("chain_id", "chain_name", "api_slug"),
    [
        (1, "ethereum", "mainnet"),
        (100, "gnosis", "xdai"),
        (137, "polygon", "polygon"),
        (8453, "base", "base"),
        (42161, "arbitrum", "arbitrum_one"),
        (43114, "avalanche", "avalanche"),
        (56, "bnb", "bnb"),
        (11155111, "sepolia", "sepolia"),
    ],
)
def test_supported_prod_chain_configs_use_verified_core_addresses(
    chain_id: int,
    chain_name: str,
    api_slug: str,
) -> None:
    """Supported prod chains use CoW API slugs and deterministic core addresses."""
    config = chain_config(chain_id, "prod")

    assert config.chain_name == chain_name
    assert config.order_book_url == f"https://api.cow.fi/{api_slug}"
    assert config.settlement_contract == "0x9008D19f58AAbD9eD0D60971565AA8510560ab41"
    assert config.vault_relayer == "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110"


def test_chain_config_rejects_invalid_contract_addresses() -> None:
    """Malformed configured contracts fail at config construction time."""
    with pytest.raises(UnsupportedChainError, match="settlement_contract"):
        ChainConfig(
            chain_id=8453,
            chain_name="base",
            env="prod",
            order_book_url="https://api.cow.fi/base",
            settlement_contract="0xnot-valid",
            vault_relayer="0xC92E8bdf79f0507f65a392b0ab4667716BFE0110",
        )


def test_chain_config_rejects_non_checksum_contract_addresses() -> None:
    """Configured contract addresses must preserve EIP-55 checksums."""
    with pytest.raises(UnsupportedChainError, match="checksum"):
        ChainConfig(
            chain_id=8453,
            chain_name="base",
            env="prod",
            order_book_url="https://api.cow.fi/base",
            settlement_contract="0x9008d19f58aabd9ed0d60971565aa8510560ab41",
            vault_relayer="0xC92E8bdf79f0507f65a392b0ab4667716BFE0110",
        )


def test_contract_verification_metadata_covers_supported_config() -> None:
    """Each configured core contract carries source, ABI, code, and proxy evidence."""
    config = chain_config(8453, "prod")

    verifications = contract_address_verifications(config)

    assert {verification.config_field for verification in verifications} == {
        "settlement_contract",
        "vault_relayer",
    }
    for verification in verifications:
        assert config.chain_id in verification.chain_ids
        assert config.env in verification.envs
        assert verification.official_source_url.startswith("https://")
        assert verification.proxy_status == "not_proxy"
        assert verification.minimum_runtime_code_bytes > 0
        assert verification.abi_compatibility


def test_live_code_verification_rejects_missing_deployment() -> None:
    """Optional deployed-code verification fails if RPC returns empty bytecode."""
    config = chain_config(8453, "prod")

    with pytest.raises(UnsupportedChainError, match="deployed code"):
        verify_configured_contract_addresses(
            config,
            deployed_code_by_address={config.settlement_contract: "0x"},
        )


def test_live_code_verification_rejects_incompatible_settlement_abi() -> None:
    """Optional deployed-code verification checks required settlement selectors."""
    config = chain_config(8453, "prod")
    settlement_code_without_selectors = "0x" + ("00" * 16_165)

    with pytest.raises(UnsupportedChainError, match="ABI selector"):
        verify_configured_contract_addresses(
            config,
            deployed_code_by_address={
                config.settlement_contract: settlement_code_without_selectors
            },
        )


def test_chain_config_rejects_non_https_order_book_url() -> None:
    """Order Book API endpoints must be HTTPS."""
    with pytest.raises(UnsupportedChainError, match="Order Book API URL"):
        ChainConfig(
            chain_id=8453,
            chain_name="base",
            env="prod",
            order_book_url="http://api.cow.fi/base",
            settlement_contract="0x9008D19f58AAbD9eD0D60971565AA8510560ab41",
            vault_relayer="0xC92E8bdf79f0507f65a392b0ab4667716BFE0110",
        )
