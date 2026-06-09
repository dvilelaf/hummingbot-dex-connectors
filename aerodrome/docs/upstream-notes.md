# Aerodrome Upstream Notes

Implementation basis:

- Hummingbot Gateway connector architecture: TypeScript connector class, config,
  route helpers, strong types, and Router/AMM/CLMM separation.
- Aerodrome official contracts: basic Router, PoolFactory, FactoryRegistry, Pool,
  and ERC-20 approval flow.
- Base mainnet contracts:
  - Router: `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43`
  - PoolFactory: `0x420DD381b31aEf6683db6B902084cB0FFECe40Da`
  - FactoryRegistry: `0x5C3F18F06CC09CA1910767A34a20F771039E37C0`

Before upstreaming to Hummingbot Gateway:

- Move files into `src/connectors/aerodrome`.
- Wire Fastify route schemas to Gateway's shared Router schema.
- Keep DTO serialization at the route boundary so Gateway responses do not leak
  ethers `BigNumber` instances.
- Register `aerodrome.router` in connector routes.
- Add token/pool templates if Gateway requires static pool metadata.
- Add fork smoke evidence against a funded Base test wallet before claiming live
  execution readiness.

Known deliberate MVP limits:

- `BUY` exact-output is unsupported. Aerodrome's basic Router interface exposes
  exact-input quote and swap methods (`getAmountsOut`,
  `swapExactTokensForTokens`, `swapExactETHForTokens`, and
  `swapExactTokensForETH`) but no `getAmountsIn` or `swapTokensForExactTokens`
  equivalent. Do not expose Hummingbot `BUY` until a safe exact-output ABI path
  is selected and tested.
- `UNSAFE_swapExactTokensForTokens` is not a `BUY` fallback because it relies on
  caller-supplied amount arrays and does not guarantee exact-output semantics.
- `priceImpactPct` is unavailable in the MVP and is exposed as `null`.
- Slipstream, AMM liquidity, CLMM positions, gauges, voting, and emissions are
  out of scope for this router-only MVP.
