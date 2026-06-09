# CoW Swap Runtime Integration

This connector is owned by the Hummingbot API/runtime image. Marlin must not
import `hummingbot_cowswap` directly; it should call Hummingbot API using the
same connector endpoints it already uses for other venues.

## Runtime Boundary

The package is installed into the custom Hummingbot API image. The connector
name exposed by that image should be `cowswap`.

Marlin consumes only normalized Hummingbot API responses:

- `GET /connectors/`
- `GET /connectors/cowswap/config-map`
- `GET /connectors/cowswap/order-types`
- `GET /connectors/cowswap/trading-rules`
- `POST /trading/orders`
- `POST /trading/{account_name}/cowswap/orders/{client_order_id}/cancel`
- `POST /trading/orders/active`
- historical order/trade endpoints already used by Marlin when available

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

Minimum environment contract:

- `HUMMINGBOT_CONNECTOR=cowswap`
- `SYMBOL=USDC-WETH` or another supported CoW trading pair.
- `COWSWAP_CHAIN_ID=8453`
- `COWSWAP_ENV=prod` for production, `staging` only for smoke tests.
- `COWSWAP_OWNER_ADDRESS` and optional `COWSWAP_RECEIVER_ADDRESS`.
- `COWSWAP_APP_DATA` or app-code equivalent for attribution.
- EVM RPC and signing credentials must be configured through Hummingbot or
  Gateway account handling, not through Marlin config.

Raw private keys must not be stored in connector config files, Marlin config,
logs, or artifacts.

## Connector Surface

For the MVP, Hummingbot API should report:

- connector: `cowswap`
- supported order types: `MARKET` for swap-style sell orders only, unless the
  Hummingbot connector implementation maps CoW intents to a stricter type.
- supported trade type: `SELL`
- unsupported trade type: `BUY`
- supported chain: Base mainnet, chain ID `8453`
- token scope: configured ERC-20 tokens and WETH on Base.

Trading rules should expose conservative minimums derived from token metadata
and CoW API quote constraints. Unknown limits should fail readiness rather than
letting Marlin submit an order that the connector cannot validate.

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

## MVP Limitations

- Base mainnet only.
- Sell orders only.
- ERC-20/WETH only; native ETH flow is a separate feature.
- No generic limit-order support until the Hummingbot order-type mapping is
  specified.
- Staging smoke tests prove quote/sign/post API reachability and classified
  rejection with a dummy wallet; they do not prove settlement.
