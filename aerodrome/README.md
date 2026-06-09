# Aerodrome Gateway Connector

Router-only Aerodrome connector components for Base stable and volatile pool swaps.

This package follows Hummingbot Gateway's connector shape while staying standalone
for fast iteration. The implemented MVP supports exact-input `SELL` swaps over a
single Aerodrome basic pool on `ethereum/base`.

```bash
pnpm install
pnpm run check
```

`pnpm run check` runs ESLint, TypeScript, Prettier, and coverage-gated tests.
