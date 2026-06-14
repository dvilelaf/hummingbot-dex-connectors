"""Per-chain CoW protocol configuration."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING
from urllib.parse import urlparse

from eth_utils.address import is_checksum_address
from eth_utils.crypto import keccak

from hummingbot_cowswap.errors import UnsupportedChainError

if TYPE_CHECKING:
    from collections.abc import Mapping

EVM_ADDRESS_LENGTH = 42
HEX_PREFIX_LENGTH = 2
PROD_SETTLEMENT_CONTRACT = "0x9008D19f58AAbD9eD0D60971565AA8510560ab41"
STAGING_SETTLEMENT_CONTRACT = "0xf553d092b50bdcbddeD1A99aF2cA29FBE5E2CB13"
PROD_VAULT_RELAYER = "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110"
STAGING_VAULT_RELAYER = PROD_VAULT_RELAYER
BASE_CHAIN_ID = 8453
SUPPORTED_CHAINS = {
    1: ("ethereum", "mainnet"),
    100: ("gnosis", "xdai"),
    137: ("polygon", "polygon"),
    8453: ("base", "base"),
    42161: ("arbitrum", "arbitrum_one"),
    43114: ("avalanche", "avalanche"),
    56: ("bnb", "bnb"),
    11155111: ("sepolia", "sepolia"),
}
SUPPORTED_CHAIN_IDS = tuple(SUPPORTED_CHAINS)
OFFICIAL_ADDRESS_SOURCE = "https://cowprotocol-cow-sdk.mintlify.app/api/config"
OFFICIAL_NETWORK_SOURCE = "https://cowswap.mintlify.app/cow-contracts/deployment/networks"
OFFICIAL_SETTLEMENT_ABI_SOURCE = (
    "https://cowswap.mintlify.app/cow-protocol/reference/contracts/core/settlement"
)
OFFICIAL_VAULT_RELAYER_ABI_SOURCE = (
    "https://cowswap.mintlify.app/cow-contracts/contracts/vault-relayer"
)
SETTLEMENT_RUNTIME_HASHES = {
    (1, "prod"): "0x744d58584e38d214eb190629f131d5cf8b8703bd68e04452f9692177c37c4bc9",
    (1, "staging"): "0xb9da0b79eac25fa06600d4f5cdd99ecea6c56c40fec47756323e607a72d9d7bd",
    (100, "prod"): "0x68963e5b27aadd4ee70ecd933fac9312fe5f527390b88ae6092c68937b80f5e2",
    (100, "staging"): "0xe49c7157f6cc80593dfc7c57ac5cbac68cd89f2365f2841b4e368316d07dcce7",
    (137, "prod"): "0xe264ecc678de6464b9365ff73e07858e2c2b07adcd5c8209cb04ebe0e9ef2c14",
    (137, "staging"): "0x74b2d81d7c3fc31f19781b41803f716f9c752a96b9ed835a68747953a0541324",
    (8453, "prod"): "0x851476c2307a7c011d2435d5e5aaae3a41c517f52461b5abefe2a4e42114cbf6",
    (8453, "staging"): "0x3f480b4e35da45d472e0d931df9dc492fc5644f1346e02a7c9cc4cf3072820a0",
    (42161, "prod"): "0xc5d94a317d3c8f717d4238b1a4bee2bc9cec18697c82e1d63865833ebdbd523c",
    (42161, "staging"): "0xc7b79b602e144a539497c7f27662bd1c365d0a454bc9ca3dc9ba4f50b29540d4",
    (43114, "prod"): "0xc5b8516d7e501ef4c79c135ba4a55b674211f5b2add786f00c89bfd2ad250f5b",
    (43114, "staging"): "0x864cc1450450e7ecb079c24aa168015279895908ca7cd02834d02d5d9d87c2b9",
    (56, "prod"): "0x681b39b3355153c3f8ff25d44d73abeca42b51e499d9c54d7354121405a004c4",
    (56, "staging"): "0x4be734a4feee4d8bf57b59e540101d18e1e9449fc8cafe57fb5288aee29079e6",
    (11155111, "prod"): "0x9fbace363dc778e25fecb202c12981d916faea80c9aab8167aeeedcaed84df53",
    (11155111, "staging"): "0x2bd5287a0e8ee6859ac371fac032caf3e193c8785a476913bc017325f83ac2aa",
}
VAULT_RELAYER_RUNTIME_HASH = "0x500097799c1379a3728ed70b17de4132de2c07f6937b041c361deaade22b6a5e"
SETTLEMENT_ABI_SELECTORS = (
    "ec6cb13f",  # setPreSignature(bytes,bool)
    "15337bc0",  # invalidateOrder(bytes)
    "f698da25",  # domainSeparator()
    "9b552cc2",  # vaultRelayer()
    "2335c76b",  # authenticator()
)


@dataclass(frozen=True)
class ContractAddressVerification:
    """Source-backed verification metadata for one configured CoW contract."""

    config_field: str
    contract_name: str
    address: str
    chain_ids: tuple[int, ...]
    envs: tuple[str, ...]
    official_source_url: str
    abi_compatibility: tuple[str, ...]
    proxy_status: str
    minimum_runtime_code_bytes: int
    required_runtime_selectors: tuple[str, ...] = ()
    expected_runtime_code_hash: str | None = None


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
        verify_configured_contract_addresses(self)


def chain_config(chain_id: int, env: str) -> ChainConfig:
    """Return connector-supported CoW configuration for a chain/environment."""
    normalized_env = env.lower()
    if normalized_env not in {"prod", "staging"}:
        message = f"unsupported CoW API env: {env}"
        raise UnsupportedChainError(message)
    chain = SUPPORTED_CHAINS.get(chain_id)
    if chain is None:
        message = f"unsupported CoW chain_id: {chain_id}"
        raise UnsupportedChainError(message)

    is_staging = normalized_env == "staging"
    chain_name, api_slug = chain
    api_host = "https://barn.api.cow.fi" if is_staging else "https://api.cow.fi"
    return ChainConfig(
        chain_id=chain_id,
        chain_name=chain_name,
        env=normalized_env,
        order_book_url=f"{api_host}/{api_slug}",
        settlement_contract=STAGING_SETTLEMENT_CONTRACT if is_staging else PROD_SETTLEMENT_CONTRACT,
        vault_relayer=STAGING_VAULT_RELAYER if is_staging else PROD_VAULT_RELAYER,
    )


def contract_address_verifications(config: ChainConfig) -> tuple[ContractAddressVerification, ...]:
    """Return source-backed verification metadata for configured CoW contracts."""
    return (
        ContractAddressVerification(
            config_field="settlement_contract",
            contract_name="GPv2Settlement",
            address=config.settlement_contract,
            chain_ids=SUPPORTED_CHAIN_IDS,
            envs=("prod", "staging"),
            official_source_url=OFFICIAL_ADDRESS_SOURCE,
            abi_compatibility=(
                f"chain ids and deterministic deployment: {OFFICIAL_NETWORK_SOURCE}",
                f"order signing, cancellation, settlement ABI: {OFFICIAL_SETTLEMENT_ABI_SOURCE}",
            ),
            proxy_status="not_proxy",
            minimum_runtime_code_bytes=16_000,
            required_runtime_selectors=SETTLEMENT_ABI_SELECTORS,
            expected_runtime_code_hash=SETTLEMENT_RUNTIME_HASHES[(config.chain_id, config.env)],
        ),
        ContractAddressVerification(
            config_field="vault_relayer",
            contract_name="GPv2VaultRelayer",
            address=config.vault_relayer,
            chain_ids=SUPPORTED_CHAIN_IDS,
            envs=("prod", "staging"),
            official_source_url=OFFICIAL_ADDRESS_SOURCE,
            abi_compatibility=(
                f"relayer creator and vault immutables: {OFFICIAL_VAULT_RELAYER_ABI_SOURCE}",
            ),
            proxy_status="not_proxy",
            minimum_runtime_code_bytes=4_500,
            expected_runtime_code_hash=VAULT_RELAYER_RUNTIME_HASH,
        ),
    )


def verify_configured_contract_addresses(
    config: ChainConfig,
    deployed_code_by_address: Mapping[str, str] | None = None,
) -> None:
    """Validate configured CoW addresses and optional live deployed bytecode."""
    for verification in contract_address_verifications(config):
        if config.chain_id not in verification.chain_ids:
            message = f"{verification.contract_name} is not verified for chain_id {config.chain_id}"
            raise UnsupportedChainError(message)
        if config.env not in verification.envs:
            message = f"{verification.contract_name} is not verified for env {config.env}"
            raise UnsupportedChainError(message)
        _validate_evm_address(verification.config_field, verification.address)

        if deployed_code_by_address is None:
            continue
        code = _code_for_address(deployed_code_by_address, verification.address)
        if code is None:
            continue
        _verify_deployed_code(verification, code)


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
    if not is_checksum_address(address):
        message = f"invalid checksum for {name}: {address}"
        raise UnsupportedChainError(message)


def _code_for_address(deployed_code_by_address: Mapping[str, str], address: str) -> str | None:
    return deployed_code_by_address.get(address) or deployed_code_by_address.get(address.lower())


def _verify_deployed_code(verification: ContractAddressVerification, code: str) -> None:
    normalized_code = code.lower()
    if not normalized_code.startswith("0x") or len(normalized_code) <= HEX_PREFIX_LENGTH:
        message = (
            f"missing deployed code for {verification.contract_name} at {verification.address}"
        )
        raise UnsupportedChainError(message)
    runtime_code = bytes.fromhex(normalized_code[HEX_PREFIX_LENGTH:])
    if len(runtime_code) < verification.minimum_runtime_code_bytes:
        message = f"short deployed code for {verification.contract_name} at {verification.address}"
        raise UnsupportedChainError(message)
    for selector in verification.required_runtime_selectors:
        if selector not in normalized_code:
            message = (
                f"missing ABI selector {selector} for "
                f"{verification.contract_name} at {verification.address}"
            )
            raise UnsupportedChainError(message)
    runtime_hash = f"0x{keccak(runtime_code).hex()}"
    if (
        verification.expected_runtime_code_hash
        and runtime_hash != verification.expected_runtime_code_hash
    ):
        message = (
            f"unexpected deployed code hash for {verification.contract_name} at "
            f"{verification.address}"
        )
        raise UnsupportedChainError(message)
