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

Opt-in funded lifecycle smoke:
```bash
COWSWAP_RUN_INTEGRATION=1 \
COWSWAP_RUN_FULL_LIFECYCLE=1 \
COWSWAP_ENV=staging \
COWSWAP_TEST_PRIVATE_KEY=... \
COWSWAP_FULL_LIFECYCLE_AMOUNT=... \
  uv run pytest tests/test_cowpy_integration.py::test_live_full_lifecycle_posts_polls_and_cancels_or_settles
```

Use a low-value test account with ERC-20 balance and CoW VaultRelayer allowance.
The private key is consumed only by the injected test signer and is not part of
connector configuration.

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

Signer/cancel boundary for production runtime:
- `CoWConnector` accepts an injected signer object for request signing and cancellation.
- Runtime API calls must provide a Hummingbot-managed signer path; without it,
  cancellation is rejected before reaching the CoW API.

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

Use `"trade_type": "BUY"` with the same shape for a market-style buy intent.

Supported chains:

- Ethereum mainnet `1`
- Gnosis Chain `100`
- Polygon `137`
- Base `8453`
- Arbitrum One `42161`
- Avalanche C-Chain `43114`
- BNB Smart Chain `56`

Order-state mapping currently implemented:
- `presignaturePending` (off-chain signing path) → `PENDING_CREATE` / `OrderCreated`
- `open` with no executed amount → `OPEN` / `OrderCreated`
- `open` with partial executed amounts → `PARTIALLY_FILLED` / `OrderFilled`
- `fulfilled` → `FILLED` / `OrderFilled`
- `cancelled` → `CANCELED` / `OrderCancelled`
- `expired` → `FAILED` / `OrderExpired`
- unknown API status → `FAILED` / `OrderUpdated`

Live limitations:

- Buy/sell ERC-20/WETH only; no native ETH or generic limit orders.
- Submitted signed intents are not fills; final ledgers need terminal
  order/trade/settlement evidence.
- Cancellation uses signed off-chain cancellation when the runtime signer is
  configured; production smoke still needs funded-account settlement evidence.
