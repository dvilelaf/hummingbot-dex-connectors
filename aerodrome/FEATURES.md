# Aerodrome Connector Features

## MVP: Swap-Only Gateway Connector

- [ ] Define MVP scope as Base mainnet swap support for Aerodrome basic stable/volatile pools only.
- [ ] Use Hummingbot Gateway Router schema for swap endpoints; reserve AMM schema for basic-pool liquidity and CLMM schema for Slipstream positions.
- [ ] Add Gateway connector scaffold for `aerodrome`.
- [ ] Add Aerodrome chain/network configuration for Base.
- [ ] Add contract address configuration for global contracts: Router, PoolFactory, and FactoryRegistry.
- [ ] Verify configured contract addresses by chain ID, checksum, deployed code, ABI compatibility, proxy status where applicable, and official sources.
- [ ] Add Pool and PoolFees ABIs for per-pool discovery, validation, and compatibility checks.
- [ ] Implement token lookup and amount normalization.
- [ ] Implement allowance checks for ERC-20 sell tokens.
- [ ] Implement approval transaction creation with verified spender addresses and exact or configurable capped allowances.
- [ ] Implement allowance reset/revoke behavior where token behavior requires it.
- [ ] Validate approved factory, real pool existence, nonzero liquidity, and route `stable`/`factory` metadata before quoting or executing.
- [ ] Use Router/Pool contract quotes for stable pools; do not approximate stable pricing with constant-product math.
- [ ] Handle token decimals, quote rounding, and minimum-output calculation.
- [ ] Implement `router/quote-swap` for basic stable/volatile pools.
- [ ] Implement `router/execute-swap` for basic stable/volatile pools.
- [ ] Implement `router/execute-quote` for pre-fetched quotes.
- [ ] Validate transaction preflight before signing: chain ID, recipient, target contract, calldata route, ETH value, deadline, slippage bounds, and expected token amounts.
- [ ] Track approval and swap transaction lifecycle: hash persistence, submitted, pending, mined, reverted, replaced, and confirmed.
- [ ] Implement quote error handling for missing pools, insufficient liquidity, unsupported routes, and RPC failures.
- [ ] Implement transaction error handling for reverted swaps, expired deadlines, slippage, gas estimation failure, Base RPC lag, reorgs, nonce replacement, and nonce issues.
- [ ] Add unit tests for quote parsing, route construction, slippage, and amount conversion.
- [ ] Add mocked provider/Gateway-contract tests for quote, execute, approval, retry/error mapping, gas estimation, and malformed provider responses.
- [ ] Add fork/integration tests for at least one liquid Base pair.
- [ ] Add compatibility tests against Hummingbot Gateway Router schema for quote, execute, approval, error, and config payloads.
- [ ] Document supported chains, pool types, and known limitations.

## Marlin Runtime Integration

- [ ] Package Aerodrome into a custom `hummingbot-gateway` image, not into the Marlin Python image.
- [ ] Keep Marlin integration API-only: Marlin calls Hummingbot API, and Hummingbot API calls Gateway.
- [ ] Ensure the connector is available to Marlin through Hummingbot API Gateway endpoints, starting with `/gateway/swap/quote`.
- [ ] Support Compose configuration through `HUMMINGBOT_GATEWAY_IMAGE`, `HUMMINGBOT_GATEWAY_CONNECTOR=aerodrome`, `HUMMINGBOT_GATEWAY_NETWORK`, and `SYMBOL`.
- [ ] Add runtime documentation for the expected Compose services: `marlin`, `hummingbot-api`, `hummingbot-gateway`, `hummingbot-postgres`, and `hummingbot-broker`.
- [ ] Add a Marlin smoke path that verifies Gateway status, connector quote availability, and no direct Marlin import of Aerodrome code.
- [ ] Document that Aerodrome execution remains Gateway-owned; Marlin should consume normalized quote/execution evidence through Hummingbot API.

## Slipstream Swap Support

- [ ] Add contract address configuration for MixedQuoter, SwapRouter, and required Slipstream contracts.
- [ ] Add required ABIs for Slipstream contracts.
- [ ] Keep UniversalRouter and mixed basic/Slipstream routing out of scope until explicitly implemented and tested.
- [ ] Map Slipstream pool discovery using token pair and tick spacing.
- [ ] Add Slipstream quoter integration.
- [ ] Add Slipstream path encoding and decoding.
- [ ] Extend `router/quote-swap` for Slipstream routes.
- [ ] Extend `router/execute-swap` for Slipstream routes.
- [ ] Handle tick spacing instead of Uniswap-style fee tier assumptions.
- [ ] Add unit and fork/integration tests for single-hop Slipstream swaps.
- [ ] Add unit and fork/integration tests for multi-hop or mixed basic/Slipstream routes if supported.

## AMM Liquidity Support

- [ ] Implement `amm/pool-info` for stable and volatile pools.
- [ ] Implement `amm/position-info` for wallet LP token balances.
- [ ] Implement `amm/quote-liquidity`.
- [ ] Implement `amm/add-liquidity`.
- [ ] Implement `amm/remove-liquidity`.
- [ ] Add unit and fork/integration tests for stable pool liquidity math using contract quotes.
- [ ] Add unit and fork/integration tests for volatile pool liquidity operations.

## CLMM Liquidity Support

- [ ] Implement `clmm/pool-info`.
- [ ] Implement `clmm/positions-owned`.
- [ ] Implement `clmm/position-info`.
- [ ] Implement `clmm/quote-position`.
- [ ] Implement `clmm/open-position`.
- [ ] Implement `clmm/add-liquidity`.
- [ ] Implement `clmm/remove-liquidity`.
- [ ] Implement `clmm/collect-fees`.
- [ ] Implement `clmm/close-position`.
- [ ] Add unit and fork/integration tests for position NFT discovery.
- [ ] Add unit and fork/integration tests for opening, modifying, fee collection, and closing positions.

## Production Hardening

- [ ] Add structured logging for quote, approval, and swap execution paths.
- [ ] Add retry policy for transient RPC/API failures.
- [ ] Add gas estimation safeguards.
- [ ] Add deadline and slippage configuration.
- [ ] Add configuration validation at startup.
- [ ] Add lifecycle/restart tests for startup config reload, connector initialization, allowance/cache recovery, and pending transaction handling.
- [ ] Add negative tests for unsupported tokens, unsupported pools, insufficient liquidity, unsupported routes, RPC failures, reverted swaps, expired deadlines, slippage failures, gas estimation failures, and nonce issues.
- [ ] Add malicious/stale quote execution tests for transaction preflight validation.
- [ ] Run lint, typecheck, unit tests, and fork tests.
- [ ] Prepare usage examples.
- [ ] Prepare upstream contribution notes if submitting to Hummingbot.
