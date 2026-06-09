# CoW Swap Connector Features

## MVP: Python Hummingbot Connector

- [x] Use the CoW connector for CoW Order Book API lifecycle plus an explicit Hummingbot-managed EVM signer/RPC approval path.
- [x] Add staging/testnet integration tests for the full quote, sign, post, poll, fill or cancel path.

## Marlin Runtime Integration

- [x] Ensure the connector appears in Hummingbot API `/connectors/`.
- [x] Ensure Hummingbot API exposes connector metadata through `/connectors/{connector}/order-types`, `/connectors/{connector}/trading-rules`, and `/connectors/{connector}/config-map`.

## Trading Features

- [x] Add native ETH/Eth-flow support as a distinct feature path if required.
