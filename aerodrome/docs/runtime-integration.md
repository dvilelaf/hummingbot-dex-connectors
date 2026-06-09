# Aerodrome Runtime Integration

Aerodrome should run in Hummingbot Gateway, not in the Marlin Python image.
Marlin should remain API-only:

```text
marlin -> hummingbot-api -> hummingbot-gateway -> Aerodrome Router on Base
```

Expected Compose knobs from Marlin:

- `HUMMINGBOT_GATEWAY_IMAGE`: custom Gateway image containing the Aerodrome
  connector.
- `HUMMINGBOT_GATEWAY_CONNECTOR=aerodrome`
- `HUMMINGBOT_GATEWAY_NETWORK=base`
- `SYMBOL=BASE-QUOTE`

Gateway endpoint mapping for the MVP:

- `GET /connectors/aerodrome/router/quote-swap`
- `POST /connectors/aerodrome/router/execute-swap`
- `POST /connectors/aerodrome/router/execute-quote`

The current package exposes thin route helpers and connector logic that can be
copied into `src/connectors/aerodrome` in a Gateway fork. It does not modify the
Marlin repo and does not require Marlin to import Aerodrome code directly.

Smoke evidence for Marlin should verify:

- Gateway health.
- Aerodrome connector discovery.
- Quote availability for one liquid Base pair.
- No direct Marlin import of this package.
- No execution unless a funded wallet, allowance, and explicit live gate exist.
