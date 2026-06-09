# CoW Swap Connector Features

## MVP: Python Hummingbot Connector

- [ ] Use the CoW connector for CoW Order Book API lifecycle plus an explicit Hummingbot-managed EVM signer/RPC approval path.
- [ ] Add staging/testnet integration tests for the full quote, sign, post, poll, fill or cancel path.

## Marlin Runtime Integration

- [ ] Ensure the connector appears in Hummingbot API `/connectors/`.
- [ ] Ensure Hummingbot API exposes connector metadata through `/connectors/{connector}/order-types`, `/connectors/{connector}/trading-rules`, and `/connectors/{connector}/config-map`.

## Trading Features

- [ ] Add native ETH/Eth-flow support as a distinct feature path if required.
