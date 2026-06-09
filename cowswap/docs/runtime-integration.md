# CoW Swap Runtime Integration

This connector is owned by the Hummingbot API/runtime image. Marlin must not
import `hummingbot_cowswap` directly; it should call Hummingbot API using the
same connector endpoints it already uses for other venues.

See `usage.md` for minimal commands and `upstream-notes.md` for PR gaps.

## Runtime Contract

The package is installed into the custom Hummingbot API image. The connector
name exposed by that image must be `cowswap`. Marlin consumes only normalized
Hummingbot API responses and must not import `hummingbot_cowswap`.

Required Hummingbot API surface:

- `GET /connectors/`
- `GET /connectors/cowswap/config-map`
- `GET /connectors/cowswap/order-types`
- `GET /connectors/cowswap/trading-rules?trading_pairs=USDC-WETH`
- `POST /trading/orders`
- `POST /trading/{account_name}/cowswap/orders/{client_order_id}/cancel`
- `POST /trading/orders/active`
- `POST /trading/orders/search`
- `POST /trading/trades`

CoW-specific quote IDs, order UIDs, settlement transaction hashes, and raw
Order Book API responses stay inside the connector evidence model. Marlin may
store them as external evidence, but it should not build CoW API payloads.

## Compose Services

The expected Compose stack is:

- `marlin`: strategy, readiness, evidence, ledgers, and operator gates.
- `hummingbot-api`: owns the CoW connector package and exposes connector API.
- `hummingbot-gateway`: optional EVM RPC and wallet/approval delegation layer.
- `hummingbot-postgres`: Hummingbot API persistence.
- `hummingbot-broker`: Hummingbot API broker service.

Minimum shared environment contract:

- `HUMMINGBOT_CONNECTOR=cowswap`
- `SYMBOL=USDC-WETH` or another supported CoW trading pair.
- `COWSWAP_CHAIN_ID=8453`
- `COWSWAP_ENV=prod` for production, `staging` only for smoke tests.
- `COWSWAP_OWNER_ADDRESS` and optional `COWSWAP_RECEIVER_ADDRESS`.
- `COWSWAP_APP_DATA` or app-code equivalent for attribution.
- `HUMMINGBOT_API_USERNAME` and `HUMMINGBOT_API_PASSWORD` for Marlin API auth,
  when Hummingbot API is deployed with Basic Auth.
- EVM RPC and signing credentials must be configured through Hummingbot or
  Gateway account handling, not through Marlin config.

Raw private keys must not be stored in connector config files, Marlin config,
logs, or artifacts.

### Hummingbot API Image Contract

Compose must run a custom `hummingbot-api` image that installs this package into
the same Python environment used by `uvicorn`. Acceptable patterns are:

- build this repository with `cowswap/docker/hummingbot-api.Dockerfile`, which
  copies the `cowswap` package into the Hummingbot API image and runs
  `pip install ./cowswap`;
- a read-only bind mount provides `cowswap`, and container startup installs it
  before launching `uvicorn`.

The Dockerfile validates the package at build time with:

```bash
python -m hummingbot_cowswap.runtime_metadata --check
```

That check proves the package exposes static connector metadata without a Marlin
dependency. The full install is valid only when the same command succeeds
inside the `hummingbot-api` container and `GET /connectors/` includes
`cowswap`. Marlin must use a container-reachable base URL such as
`http://hummingbot-api:8000`, not `localhost`.

Build the local custom image from the repository root:

```bash
docker build \
  -f cowswap/docker/hummingbot-api.Dockerfile \
  -t hummingbot-api-cowswap:local \
  .
```

Marlin Compose should then override the `hummingbot-api` image with that custom
image, while leaving the `marlin` service image unchanged.

### Local Runtime Packaging Smoke

Until the final Docker image exists, validate the package artifact and runtime
registration with the same Python environment that launches Hummingbot API.
From this repository worktree:

```bash
cd cowswap
uv build
python -m pip install --force-reinstall dist/hummingbot_cowswap_connector-*.whl
python -c "import hummingbot_cowswap; print(hummingbot_cowswap.__all__)"
python -m hummingbot_cowswap.runtime_metadata --metadata
python -m hummingbot_cowswap.runtime_metadata --readiness-contract \
  --symbol "${SYMBOL:-USDC-WETH}" \
  --account-name cow-runtime-smoke
```

For an editable local Hummingbot API checkout or container shell, install the
package there instead:

```bash
python -m pip install -e /path/to/hummingbot-dex-connectors/cowswap
export HUMMINGBOT_CONNECTOR=cowswap
export SYMBOL=USDC-WETH
python -c "import hummingbot_cowswap"
hummingbot-cowswap-runtime --api-responses --symbol USDC-WETH
```

With Hummingbot API running, smoke the connector discovery surface before any
order submission:

```bash
HB_API=http://localhost:8000
AUTH="-u ${HUMMINGBOT_API_USERNAME}:${HUMMINGBOT_API_PASSWORD}"
curl -fsS $AUTH "$HB_API/connectors/" | jq '.'
curl -fsS $AUTH "$HB_API/connectors/cowswap/order-types" | jq '.'
curl -fsS $AUTH \
  "$HB_API/connectors/cowswap/trading-rules?trading_pairs=${SYMBOL}" | jq '.'
```

`/connectors/` must include `cowswap`; order types must include `MARKET`; and
the trading-rules response must include the exact `SYMBOL`. If Basic Auth is
disabled, omit `AUTH` from the `curl` commands.

Minimal market-style order payload shape for Hummingbot API:

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

Use `"trade_type": "BUY"` with the same shape for the minimal buy path.
Use staging or a deliberately low funded test account for smoke submissions.
The response is acceptable only if it returns a Hummingbot client order ID and
the connector records the CoW order UID or a classified rejection as evidence.

## Connector Surface

For the MVP, Hummingbot API should report:

- connector: `cowswap`
- supported order types: `MARKET` for swap-style buy/sell orders only, unless the
  Hummingbot connector implementation maps CoW intents to a stricter type.
- supported trade types: `BUY`, `SELL`
- supported chains: Ethereum `1`, Gnosis `100`, Polygon `137`, Base `8453`,
  Arbitrum One `42161`, Avalanche C-Chain `43114`, and BNB Smart Chain `56`.
- token scope: configured ERC-20 tokens and WETH on the selected chain.

Trading rules should expose conservative minimums derived from token metadata
and CoW API quote constraints. Unknown limits should fail readiness rather than
letting Marlin submit an order that the connector cannot validate.

## Readiness Checks

Marlin readiness for `cowswap` is blocked unless all checks pass:

- `GET /connectors/` contains `cowswap`.
- `GET /connectors/cowswap/config-map` exposes required account fields without
  raw private-key fields in Marlin-owned config.
- `GET /connectors/cowswap/order-types` includes the order type Marlin will
  submit; MVP expectation is `MARKET` plus `BUY`/`SELL`.
- `GET /connectors/cowswap/trading-rules?trading_pairs=$SYMBOL` returns a rule
  for the exact symbol with usable minimum size and amount increment data.
- The configured Hummingbot account has the `cowswap` connector loaded.
- `POST /trading/orders/active` for account, connector, and symbol returns no
  unmanaged active orders before submit, unless the run is explicitly configured
  to cancel and wait for them to clear.

The package also exposes a static readiness contract for operators and image
smokes:

```bash
python -m hummingbot_cowswap.runtime_metadata --readiness-contract \
  --symbol "$SYMBOL" \
  --account-name "$HUMMINGBOT_ACCOUNT_NAME"
```

This command does not call Marlin or Hummingbot API. It serializes the endpoint
checks and expected connector facts that an external readiness probe must
verify. The helper `hummingbot_cowswap.runtime_metadata.evaluate_readiness()`
can evaluate already-normalized Hummingbot API payloads and fails closed when
connector discovery, config-map safety, order types, trading rules, account
connector state, or active-order guard data is missing.

The package-level check cannot prove that Hummingbot API has registered the
connector routes, that an account has loaded the connector, or that live market
data is reachable. Those remain runtime checks against Hummingbot API.

## Contract Address Verification

`hummingbot_cowswap.chain_config` verifies configured CoW core addresses before
use. The checks cover supported chain ID, environment, EIP-55 checksum, official
source metadata, ABI expectations, non-proxy status for the configured
contracts, and optional deployed runtime bytecode.

Official sources used by the verifier:

- CoW SDK config contract addresses:
  https://cowprotocol-cow-sdk.mintlify.app/api/config
- CoW supported networks and deterministic core deployments:
  https://cowswap.mintlify.app/cow-contracts/deployment/networks
- `GPv2Settlement` ABI behavior:
  https://cowswap.mintlify.app/cow-protocol/reference/contracts/core/settlement
- `GPv2VaultRelayer` ABI behavior:
  https://cowswap.mintlify.app/cow-contracts/contracts/vault-relayer

For live deployed-code verification, fetch bytecode with any trusted RPC for
the configured chain and pass the result into
`verify_configured_contract_addresses`. Example:

```bash
cd cowswap
RPC_URL=https://base-rpc.publicnode.com
uv run python - <<'PY'
import json
import os
import urllib.request

from hummingbot_cowswap.chain_config import chain_config, verify_configured_contract_addresses

config = chain_config(8453, "prod")
code_by_address = {}
for address in (config.settlement_contract, config.vault_relayer):
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_getCode",
        "params": [address, "latest"],
    }
    request = urllib.request.Request(
        os.environ["RPC_URL"],
        data=json.dumps(payload).encode(),
        headers={
            "content-type": "application/json",
            "user-agent": "hummingbot-cowswap-verifier/0.1",
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        code_by_address[address] = json.load(response)["result"]

verify_configured_contract_addresses(config, code_by_address)
print("verified")
PY
```

The optional live check validates non-empty runtime code, minimum code size,
known runtime code hashes for the selected chain/environment, and required
`GPv2Settlement` ABI selectors. It intentionally does not add an RPC framework
to the connector runtime.

## Asynchronous Order Evidence

CoW orders are signed intents submitted to an off-chain order book. A submitted
order is not a fill and should not create final Marlin ledger evidence.

The connector should persist and expose:

- Hummingbot client order ID.
- CoW order UID and digest.
- quote ID and `validTo`.
- owner, receiver, chain ID, sell token, buy token.
- sell amount, minimum buy amount, executed sell amount, executed buy amount.
- CoW raw status mapped to Hummingbot order state.
- settlement transaction hash when trades are returned by the CoW API.

Marlin should create final ledger rows only after terminal reconciliation:
filled, cancelled with no fill, expired, or failed/rejected with external
evidence. Open or partially filled orders remain active evidence.

Ledger rules:

- Submitted orders are lifecycle evidence, not fills.
- Filled ledger rows require matching order evidence plus trade or settlement
  evidence from `/trading/trades`, `/trading/orders/search`, or connector
  evidence fields.
- Cancel, expire, reject, and fail rows must preserve the Hummingbot state and
  CoW external identifiers when present.
- Evidence artifacts and logs must redact auth headers, credentials, raw private
  keys, and signer secrets.

## MVP Limitations

- Supported chains are Ethereum, Gnosis, Polygon, Base, Arbitrum One,
  Avalanche C-Chain, and BNB Smart Chain.
- Buy and sell orders only.
- ERC-20/WETH regular orders plus native ETH sell planning through EthFlow.
  Native-token buys should target wrapped tokens first.
- No generic limit-order support until the Hummingbot order-type mapping is
  specified.
- Staging dummy-wallet smoke tests prove quote API reachability only; they do
  not prove signing, posting, or settlement. Use the funded lifecycle smoke for
  quote/sign/post/poll/cancel coverage.
