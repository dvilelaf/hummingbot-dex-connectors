# Aerodrome Connector Features

This file records the implemented MVP scope for the Aerodrome connector package.
It is intentionally limited to the production surface needed by the current
Marlin-style multi-connector runtime.

## Package And Runtime Shape

- [x] TypeScript package with strict `tsconfig`, ESLint, Prettier, Vitest, and pnpm.
- [x] Hummingbot Gateway-style router connector surface for `ethereum/base`.
- [x] No private key handling or local signing inside the connector.
- [x] Transaction plans return calldata, target, value, chain, and network for the runtime to sign.
- [x] Runtime integration documented for a Docker Compose service that can be mounted beside other connectors.

## Aerodrome Base Support

- [x] Base mainnet chain configuration with official Router, PoolFactory, FactoryRegistry, ETH, WETH, USDC, and AERO addresses.
- [x] Router, PoolFactory, FactoryRegistry, Pool, and ERC20 minimal ABIs kept local and narrow.
- [x] Provider chain ID validation for Base `8453`.
- [x] Deployed-code validation for core contracts and configured tokens.
- [x] Router `defaultFactory()` and `factoryRegistry()` verification against configured addresses.
- [x] FactoryRegistry approval verification for the configured factory.

## Swap And Quote Lifecycle

- [x] Exact-input `SELL` quotes through Aerodrome basic volatile and stable pools.
- [x] Exact-input `SELL` execution plans through `swapExactTokensForTokens`, `swapExactETHForTokens`, and `swapExactTokensForETH`.
- [x] `BUY` requests handled explicitly by rejecting exact-output swaps that the basic Router cannot support safely.
- [x] Bounded direct or two-hop route search over configured Base tokens.
- [x] Stable and volatile variants evaluated per route leg.
- [x] Best valid route selected by highest Router `getAmountsOut` result.
- [x] Native ETH input and output swaps planned through Aerodrome Router ETH methods while preserving WETH route validation.
- [x] Stable and volatile pool routing with pool metadata validation.
- [x] Pool existence validation through Router `poolFor`, PoolFactory `getPool`, and PoolFactory `isPool`.
- [x] Pool token-set, stable-flag, and nonzero-reserve validation.
- [x] Router `getAmountsOut` validation with nonzero output checks.
- [x] Decimal-normalized price calculation.
- [x] `priceImpactPct` represented as `null` until a defensible impact model is added.
- [x] Deadline, recipient, token amount, and slippage validation.
- [x] Slippage guard rejects values that would produce zero minimum output.
- [x] Quote cache uses frozen cloned request and response objects.
- [x] Execution revalidates the current quote against cached `minAmountOutAtomic`.
- [x] Wallet balance validation before execution planning.
- [x] ERC20 allowance validation and exact-amount approval transaction planning.
- [x] User-supplied calldata rejected; calldata is always generated from validated connector state.

## Error Handling And Data Boundaries

- [x] Connector-specific error classes for configuration, quote, execution, pool, token, and provider failures.
- [x] Malformed provider and contract responses wrapped in connector errors.
- [x] Public route helpers return JSON-safe DTOs, not ethers `BigNumber` internals.
- [x] Internal BigNumber arithmetic kept behind typed connector boundaries.
- [x] Native ETH represented with the standard sentinel address at the public boundary and WETH inside Aerodrome routes.

## Documentation

- [x] README with supported scope, limitations, commands, and runtime expectations.
- [x] Usage guide with quote, execute, approval, and failure examples.
- [x] Runtime integration notes for a shared Docker Compose deployment.
- [x] Upstream notes covering Aerodrome contract references and Hummingbot Gateway architecture alignment.

## Quality Gate

- [x] ESLint strict rules pass.
- [x] TypeScript strict typecheck passes.
- [x] Package build passes.
- [x] Prettier check passes.
- [x] Vitest coverage gate is set to at least 85 percent for statements, lines, functions, and branches.
- [x] Unit tests cover quote, execute, approvals, multi-hop selection, native ETH swaps, config validation, provider failures, slippage, BUY rejection, and cache immutability.
- [x] Multidisciplinary review completed for architecture, backend correctness, security, and test quality with no remaining findings.

## Deliberately Out Of Scope For This MVP

The following are not open tasks for this MVP. They are larger product decisions
that should only be added when the runtime needs them.

- Exact-output BUY swaps, because Aerodrome's basic Router does not provide a safe exact-output method.
- Slipstream concentrated liquidity routing.
- Liquidity provision, withdrawals, gauges, bribes, and reward claiming.
- MEV protection, private relay submission, or custom transaction broadcasting.
