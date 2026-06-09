# Aerodrome Gateway Connector

Aerodrome connector components for Base swaps, liquidity planning, and reward
claim planning.

This package follows Hummingbot Gateway's connector shape while staying standalone
for fast iteration. The implemented MVP supports exact-input `SELL` swaps over
Aerodrome basic pools on `ethereum/base`, with direct or bounded two-hop route
selection and native ETH Router swap planning. It also includes separate modules
for Slipstream exact-input swaps, basic-pool liquidity add/remove planning, and
gauge/Voter reward claim planning.

```bash
pnpm install
pnpm run check
```

`pnpm run check` runs ESLint, TypeScript, Prettier, and coverage-gated tests.
