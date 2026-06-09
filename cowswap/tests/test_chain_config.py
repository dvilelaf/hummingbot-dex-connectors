"""Chain configuration validation tests."""

from __future__ import annotations

import pytest

from hummingbot_cowswap.chain_config import ChainConfig, chain_config
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
