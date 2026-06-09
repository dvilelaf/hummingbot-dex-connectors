# Aerodrome Upstream Notes

Implementation basis:

- Hummingbot Gateway connector architecture: TypeScript connector class, config,
  route helpers, strong types, and Router/AMM/CLMM separation.
- Aerodrome official contracts: basic Router, PoolFactory, FactoryRegistry, Pool,
  Gauge, Voter, Slipstream Router/Quoter, and ERC-20 approval flow.
- Base mainnet contracts:
  - Router: `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43`
  - PoolFactory: `0x420DD381b31aEf6683db6B902084cB0FFECe40Da`
  - FactoryRegistry: `0x5C3F18F06CC09CA1910767A34a20F771039E37C0`
  - Voter: `0x16613524e02ad97eDfeF371bC883F2F5d6C480A5`
  - Slipstream Router: `0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5`
  - Slipstream PoolFactory: `0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A`
  - Slipstream Quoter: `0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0`

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
- Slipstream liquidity NFT positions, gauge voting, veNFT creation/locking, APR
  modeling, auto-compounding, and reward swapping are out of scope.
