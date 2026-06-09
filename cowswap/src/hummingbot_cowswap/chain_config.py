"""Per-chain CoW protocol configuration."""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse

from hummingbot_cowswap.errors import UnsupportedChainError

EVM_ADDRESS_LENGTH = 42
PROD_SETTLEMENT_CONTRACT = "0x9008D19f58AAbD9eD0D60971565AA8510560ab41"
STAGING_SETTLEMENT_CONTRACT = "0xf553d092b50bdcbddeD1A99aF2cA29FBE5E2CB13"
PROD_VAULT_RELAYER = "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110"
STAGING_VAULT_RELAYER = PROD_VAULT_RELAYER
BASE_CHAIN_ID = 8453


@dataclass(frozen=True)
class ChainConfig:
    """Contract and API settings for one CoW-supported chain/environment."""

    chain_id: int
    chain_name: str
    env: str
    order_book_url: str
    settlement_contract: str
    vault_relayer: str

    def __post_init__(self) -> None:
        """Validate immutable chain configuration values at construction time."""
        _validate_https_url(self.order_book_url)
        _validate_evm_address("settlement_contract", self.settlement_contract)
        _validate_evm_address("vault_relayer", self.vault_relayer)


def chain_config(chain_id: int, env: str) -> ChainConfig:
    """Return connector-supported CoW configuration for a chain/environment."""
    normalized_env = env.lower()
    if normalized_env not in {"prod", "staging"}:
        message = f"unsupported CoW API env: {env}"
        raise UnsupportedChainError(message)
    if chain_id != BASE_CHAIN_ID:
        message = f"unsupported CoW chain_id: {chain_id}"
        raise UnsupportedChainError(message)

    is_staging = normalized_env == "staging"
    base_url = "https://barn.api.cow.fi/base" if is_staging else "https://api.cow.fi/base"
    return ChainConfig(
        chain_id=BASE_CHAIN_ID,
        chain_name="base",
        env=normalized_env,
        order_book_url=base_url,
        settlement_contract=STAGING_SETTLEMENT_CONTRACT if is_staging else PROD_SETTLEMENT_CONTRACT,
        vault_relayer=STAGING_VAULT_RELAYER if is_staging else PROD_VAULT_RELAYER,
    )


def _validate_https_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc:
        message = f"unsupported CoW Order Book API URL: {url}"
        raise UnsupportedChainError(message)


def _validate_evm_address(name: str, address: str) -> None:
    if not address.startswith("0x") or len(address) != EVM_ADDRESS_LENGTH:
        message = f"invalid {name}: {address}"
        raise UnsupportedChainError(message)
    try:
        int(address, 0)
    except ValueError as exc:
        message = f"invalid {name}: {address}"
        raise UnsupportedChainError(message) from exc
