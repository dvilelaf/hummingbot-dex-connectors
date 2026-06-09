# CoW Swap Usage

Minimal setup and unit tests:
```bash
cd cowswap && uv sync --all-groups && uv run pytest
```

Opt-in staging API smoke with a generated dummy wallet:
```bash
COWSWAP_RUN_INTEGRATION=1 COWSWAP_ENV=staging \
  uv run pytest tests/test_cowpy_integration.py
```

This proves quote/sign/post reachability and classified CoW rejections. It does
not prove fills, settlement, approval flow, or production readiness.

Runtime variables for a Hummingbot API image:
```bash
export HUMMINGBOT_CONNECTOR=cowswap
export SYMBOL=USDC-WETH
export COWSWAP_CHAIN_ID=8453
export COWSWAP_ENV=staging
export COWSWAP_OWNER_ADDRESS=0x...
export COWSWAP_RECEIVER_ADDRESS=$COWSWAP_OWNER_ADDRESS
export COWSWAP_APP_DATA=0x0000000000000000000000000000000000000000000000000000000000000000
export HUMMINGBOT_API_USERNAME=...
export HUMMINGBOT_API_PASSWORD=...
```

Keep EVM RPC, wallet, approval, and signing credentials in Hummingbot/Gateway
account handling. Never put raw private keys in config, logs, or artifacts.

Install into the Python environment that launches Hummingbot API:
```bash
cd cowswap
uv build && python -m pip install --force-reinstall dist/hummingbot_cowswap_connector-*.whl
python -c "import hummingbot_cowswap"
```

Smoke Hummingbot API before submitting any order:

```bash
HB_API=http://localhost:8000
AUTH="-u ${HUMMINGBOT_API_USERNAME}:${HUMMINGBOT_API_PASSWORD}"
curl -fsS $AUTH "$HB_API/connectors/" | jq '.'
curl -fsS $AUTH "$HB_API/connectors/cowswap/order-types" | jq '.'
curl -fsS $AUTH \
  "$HB_API/connectors/cowswap/trading-rules?trading_pairs=${SYMBOL}" | jq '.'
```

Expected: `/connectors/` includes `cowswap`, order types include `MARKET`, and
trading rules include the exact `SYMBOL`.

Minimal Hummingbot API order payload:

```bash
curl -fsS $AUTH -X POST "$HB_API/trading/orders" \
  -H 'Content-Type: application/json' \
  -d '{
    "account_name": "cow-runtime-smoke",
    "connector_name": "cowswap",
    "trading_pair": "USDC-WETH",
    "trade_type": "SELL",
    "amount": "10",
    "order_type": "MARKET",
    "position_action": "OPEN"
  }' | jq '.'
```

Live limitations:

- Base mainnet only, chain ID `8453`.
- Sell-only ERC-20/WETH; no BUY, native ETH, or generic limit orders.
- Submitted signed intents are not fills; final ledgers need terminal
  order/trade/settlement evidence.
- Cancellation needs Hummingbot-managed signed cancellation and is not wired
  through the cowpy-backed client yet.
