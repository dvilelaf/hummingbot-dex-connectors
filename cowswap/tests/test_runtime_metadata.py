"""Tests for package-level runtime metadata used by Hummingbot API images."""

from __future__ import annotations

import json
import subprocess
import sys


def test_connector_metadata_serializes_hummingbot_api_surface() -> None:
    from hummingbot_cowswap.runtime_metadata import connector_metadata

    metadata = connector_metadata()

    assert metadata["connector"] == "cowswap"
    assert metadata["config_map"]["connector_name"] == "cowswap"
    assert metadata["config_map"]["uses_raw_private_key"] is False
    assert metadata["order_types"] == ["MARKET"]
    assert metadata["trade_types"] == ["BUY", "SELL"]
    assert metadata["supported_chains"] == [
        {"chain_id": 1, "chain_name": "ethereum"},
        {"chain_id": 56, "chain_name": "bnb"},
        {"chain_id": 100, "chain_name": "gnosis"},
        {"chain_id": 137, "chain_name": "polygon"},
        {"chain_id": 8453, "chain_name": "base"},
        {"chain_id": 42161, "chain_name": "arbitrum"},
        {"chain_id": 43114, "chain_name": "avalanche"},
    ]


def test_readiness_contract_names_dynamic_api_checks_for_marlin() -> None:
    from hummingbot_cowswap.runtime_metadata import readiness_contract

    contract = readiness_contract(symbol="USDC-WETH", account_name="cow-runtime-smoke")

    assert contract["connector"] == "cowswap"
    assert contract["symbol"] == "USDC-WETH"
    assert [check["name"] for check in contract["checks"]] == [
        "connector_discovery",
        "config_map",
        "order_types",
        "trading_rules",
        "account_connector_state",
        "active_order_guard",
    ]
    assert contract["checks"][3]["method"] == "GET"
    assert contract["checks"][3]["path"] == (
        "/connectors/cowswap/trading-rules?trading_pairs=USDC-WETH"
    )
    assert contract["checks"][4]["account_name"] == "cow-runtime-smoke"


def test_hummingbot_api_responses_cover_connector_discovery_routes() -> None:
    from hummingbot_cowswap.runtime_metadata import hummingbot_api_responses

    responses = hummingbot_api_responses(symbol="USDC-WETH")

    assert responses["/connectors/"] == ["cowswap"]
    assert responses["/connectors/cowswap/order-types"] == ["MARKET"]
    assert responses["/connectors/cowswap/config-map"]["connector"] == "cowswap"
    assert responses["/connectors/cowswap/config-map"]["uses_raw_private_key"] is False
    assert responses["/connectors/cowswap/trading-rules?trading_pairs=USDC-WETH"] == [
        {
            "trading_pair": "USDC-WETH",
            "min_order_size": "0",
            "min_price_increment": "0",
            "min_base_amount_increment": "0",
            "min_quote_amount_increment": "0",
        }
    ]


def test_evaluate_readiness_fails_closed_on_missing_runtime_facts() -> None:
    from hummingbot_cowswap.runtime_metadata import evaluate_readiness

    result = evaluate_readiness(
        connector_names=["binance"],
        config_map={"connector_name": "cowswap", "uses_raw_private_key": False},
        order_types=["LIMIT"],
        trading_rules=[],
        symbol="USDC-WETH",
        account_connector_loaded=False,
        active_orders=[{"client_order_id": "unmanaged"}],
    )

    assert result["ready"] is False
    assert result["failed_checks"] == [
        "connector_discovery",
        "order_types",
        "trading_rules",
        "account_connector_state",
        "active_order_guard",
    ]


def test_evaluate_readiness_passes_with_normalized_hummingbot_payloads() -> None:
    from hummingbot_cowswap.runtime_metadata import evaluate_readiness

    result = evaluate_readiness(
        connector_names=["cowswap"],
        config_map={"connector": "cowswap", "uses_raw_private_key": False},
        order_types=["MARKET"],
        trading_rules=[{"trading_pair": "USDC-WETH", "min_order_size": "0.000001"}],
        symbol="USDC-WETH",
        account_connector_loaded=True,
        active_orders=[],
    )

    assert result == {
        "ready": True,
        "checks": [
            {"name": "connector_discovery", "passed": True},
            {"name": "config_map", "passed": True},
            {"name": "order_types", "passed": True},
            {"name": "trading_rules", "passed": True},
            {"name": "account_connector_state", "passed": True},
            {"name": "active_order_guard", "passed": True},
        ],
        "failed_checks": [],
    }


def test_runtime_metadata_cli_supports_docker_build_smoke() -> None:
    output = subprocess.check_output(
        [sys.executable, "-m", "hummingbot_cowswap.runtime_metadata", "--metadata"],
        text=True,
    )

    assert json.loads(output)["connector"] == "cowswap"

    subprocess.check_call([sys.executable, "-m", "hummingbot_cowswap.runtime_metadata", "--check"])

    api_output = subprocess.check_output(
        [
            sys.executable,
            "-m",
            "hummingbot_cowswap.runtime_metadata",
            "--api-responses",
            "--symbol",
            "USDC-WETH",
        ],
        text=True,
    )
    assert json.loads(api_output)["/connectors/"] == ["cowswap"]
