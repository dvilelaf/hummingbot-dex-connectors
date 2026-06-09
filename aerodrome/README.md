# Aerodrome Gateway Connector

Router-only Aerodrome connector components for Base stable and volatile pool swaps.

This package follows Hummingbot Gateway's connector shape while staying standalone
for fast iteration. The implemented MVP supports exact-input `SELL` swaps over
Aerodrome basic pools on `ethereum/base`, with direct or bounded two-hop route
selection and native ETH Router swap planning.

```bash
pnpm install
pnpm run check
```

`pnpm run check` runs ESLint, TypeScript, Prettier, and coverage-gated tests.
