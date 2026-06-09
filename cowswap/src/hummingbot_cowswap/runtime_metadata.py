"""Runtime metadata and readiness helpers for Hummingbot API packaging."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Iterable, Mapping, Sequence

from hummingbot_cowswap.chain_config import SUPPORTED_CHAINS
from hummingbot_cowswap.hummingbot_adapter import CONFIG_MAP, CONNECTOR_NAME, SUPPORTED_ORDER_TYPES

SUPPORTED_TRADE_TYPES = ("BUY", "SELL")
DEFAULT_SYMBOL = "USDC-WETH"


def connector_metadata() -> dict[str, object]:
    """Return the static connector facts expected from Hummingbot API discovery."""
    return {
        "connector": CONNECTOR_NAME,
        "config_map": _json_ready_mapping(CONFIG_MAP),
        "order_types": list(SUPPORTED_ORDER_TYPES),
        "trade_types": list(SUPPORTED_TRADE_TYPES),
        "supported_chains": [
            {"chain_id": chain_id, "chain_name": chain_name}
            for chain_id, (chain_name, _api_slug) in sorted(SUPPORTED_CHAINS.items())
        ],
    }


def readiness_contract(
    *,
    symbol: str = DEFAULT_SYMBOL,
    account_name: str | None = None,
) -> dict[str, object]:
    """Describe the dynamic Hummingbot API checks Marlin must run before trading."""
    account = account_name or "$ACCOUNT_NAME"
    return {
        "connector": CONNECTOR_NAME,
        "symbol": symbol,
        "expected_order_type": SUPPORTED_ORDER_TYPES[0],
        "expected_trade_types": list(SUPPORTED_TRADE_TYPES),
        "checks": [
            {
                "name": "connector_discovery",
                "method": "GET",
                "path": "/connectors/",
                "requires": f"response contains {CONNECTOR_NAME}",
            },
            {
                "name": "config_map",
                "method": "GET",
                "path": f"/connectors/{CONNECTOR_NAME}/config-map",
                "requires": "connector account fields are exposed without raw private-key fields",
            },
            {
                "name": "order_types",
                "method": "GET",
                "path": f"/connectors/{CONNECTOR_NAME}/order-types",
                "requires": f"response contains {SUPPORTED_ORDER_TYPES[0]}",
            },
            {
                "name": "trading_rules",
                "method": "GET",
                "path": f"/connectors/{CONNECTOR_NAME}/trading-rules?trading_pairs={symbol}",
                "requires": "exact symbol has usable trading rules or equivalent market data",
            },
            {
                "name": "account_connector_state",
                "method": "POST",
                "path": "/trading/orders/active",
                "account_name": account,
                "requires": f"account has {CONNECTOR_NAME} loaded",
            },
            {
                "name": "active_order_guard",
                "method": "POST",
                "path": "/trading/orders/active",
                "account_name": account,
                "requires": "no unmanaged active orders for connector and symbol",
            },
        ],
    }


def evaluate_readiness(
    *,
    connector_names: Iterable[object],
    config_map: Mapping[str, object],
    order_types: Iterable[object],
    trading_rules: Iterable[object],
    symbol: str,
    account_connector_loaded: bool,
    active_orders: Sequence[object],
) -> dict[str, object]:
    """Evaluate normalized Hummingbot API payloads and fail closed on missing facts."""
    checks = [
        {
            "name": "connector_discovery",
            "passed": _contains_text(connector_names, CONNECTOR_NAME),
        },
        {
            "name": "config_map",
            "passed": _config_map_is_safe(config_map),
        },
        {
            "name": "order_types",
            "passed": _contains_text(order_types, SUPPORTED_ORDER_TYPES[0]),
        },
        {
            "name": "trading_rules",
            "passed": _has_trading_rule(trading_rules, symbol),
        },
        {
            "name": "account_connector_state",
            "passed": account_connector_loaded,
        },
        {
            "name": "active_order_guard",
            "passed": len(active_orders) == 0,
        },
    ]
    failed_checks = [check["name"] for check in checks if not check["passed"]]
    return {
        "ready": len(failed_checks) == 0,
        "checks": checks,
        "failed_checks": failed_checks,
    }


def main(argv: Sequence[str] | None = None) -> int:
    """Run package metadata smoke checks used by Docker builds and operators."""
    parser = argparse.ArgumentParser(description=__doc__)
    output_group = parser.add_mutually_exclusive_group()
    output_group.add_argument(
        "--metadata",
        action="store_true",
        help="print connector metadata JSON",
    )
    output_group.add_argument(
        "--readiness-contract",
        action="store_true",
        help="print dynamic Hummingbot API readiness contract JSON",
    )
    parser.add_argument("--check", action="store_true", help="validate static metadata and exit")
    parser.add_argument(
        "--symbol",
        default=DEFAULT_SYMBOL,
        help="trading pair for readiness contract",
    )
    parser.add_argument("--account-name", default=None, help="account name for readiness contract")
    args = parser.parse_args(argv)

    if args.check:
        _validate_static_metadata()
        return 0
    if args.readiness_contract:
        _write_json(readiness_contract(symbol=args.symbol, account_name=args.account_name))
        return 0
    _write_json(connector_metadata())
    return 0


def _validate_static_metadata() -> None:
    metadata = connector_metadata()
    if metadata["connector"] != CONNECTOR_NAME:
        message = "connector metadata is inconsistent"
        raise RuntimeError(message)
    order_types = metadata.get("order_types")
    if not isinstance(order_types, list) or SUPPORTED_ORDER_TYPES[0] not in order_types:
        message = "runtime metadata does not expose the expected order type"
        raise RuntimeError(message)
    if not _config_map_is_safe(CONFIG_MAP):
        message = "runtime metadata exposes unsafe connector config"
        raise RuntimeError(message)


def _write_json(payload: Mapping[str, object]) -> None:
    sys.stdout.write(f"{json.dumps(payload, sort_keys=True)}\n")


def _json_ready_mapping(mapping: Mapping[str, object]) -> dict[str, object]:
    return {
        key: list(value) if isinstance(value, tuple) else value for key, value in mapping.items()
    }


def _contains_text(items: Iterable[object], expected: str) -> bool:
    expected_normalized = expected.casefold()
    for item in items:
        values = item.values() if isinstance(item, Mapping) else (item,)
        if any(str(value).casefold() == expected_normalized for value in values):
            return True
    return False


def _config_map_is_safe(config_map: Mapping[str, object]) -> bool:
    connector = config_map.get("connector") or config_map.get("connector_name")
    has_connector = str(connector).casefold() == CONNECTOR_NAME
    has_private_key_field = any(
        "private_key" in key.casefold() and key != "uses_raw_private_key" for key in config_map
    )
    uses_raw_private_key = config_map.get("uses_raw_private_key") is True
    return has_connector and not has_private_key_field and not uses_raw_private_key


def _has_trading_rule(trading_rules: Iterable[object], symbol: str) -> bool:
    normalized_symbol = symbol.casefold()
    for rule in trading_rules:
        trading_pair = _field_value(rule, "trading_pair")
        if str(trading_pair).casefold() == normalized_symbol:
            return _has_usable_minimum(rule)
    return False


def _has_usable_minimum(rule: object) -> bool:
    for field_name in ("min_order_size", "min_base_amount_increment", "min_quote_amount_increment"):
        value = _field_value(rule, field_name)
        if value not in {None, "", "0", 0}:
            return True
    return False


def _field_value(item: object, field_name: str) -> object:
    if isinstance(item, Mapping):
        return item.get(field_name)
    return getattr(item, field_name, None)


if __name__ == "__main__":
    raise SystemExit(main())
