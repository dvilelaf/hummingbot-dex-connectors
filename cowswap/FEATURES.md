# CoW Swap Connector Features

## Architecture and Practices

- [ ] Use Hummingbot-managed signing and credential handling; never store, log, or pass raw private keys through connector configuration.

## MVP: Python Hummingbot Connector

- [ ] Use the CoW connector for CoW Order Book API lifecycle plus an explicit Hummingbot-managed EVM signer/RPC approval path.
- [ ] Add Hummingbot-managed signer integration; do not store, log, or pass raw private keys through connector configuration.
- [ ] Map CoW order states to Hummingbot order states across quote, signed intent, posted order, accepted/open, solver settlement transaction, fills, expiration, cancellation, and rejection.
- [ ] Add staging/testnet integration tests for the full quote, sign, post, poll, fill or cancel path.

## Marlin Runtime Integration

- [ ] Ensure the connector appears in Hummingbot API `/connectors/`.
- [ ] Ensure Hummingbot API exposes connector metadata through `/connectors/{connector}/order-types`, `/connectors/{connector}/trading-rules`, and `/connectors/{connector}/config-map`.

## Trading Features

- [ ] Support swap-style `SELL` orders from quotes, with slippage translated into limit price/minimum receive and success emitted only after settlement/fill reconciliation.
- [ ] Add native ETH/Eth-flow support as a distinct feature path if required.
