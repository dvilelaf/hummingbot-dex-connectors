# Aerodrome Connector Checklist

## MVP: Swap-Only Gateway Connector

- [ ] Define connector scope: Base mainnet, Aerodrome basic pools, Slipstream, or both.
- [ ] Add Gateway connector scaffold for `aerodrome`.
- [ ] Add Aerodrome chain/network configuration for Base.
- [ ] Add contract address configuration for Router, PoolFactory, MixedQuoter, SwapRouter, UniversalRouter, and Slipstream contracts.
- [ ] Add required ABIs for Aerodrome basic pools and Slipstream contracts.
- [ ] Implement token lookup and amount normalization.
- [ ] Implement allowance checks for ERC-20 sell tokens.
- [ ] Implement approval transaction creation.
- [ ] Implement `router/quote-swap` for basic stable/volatile pools.
- [ ] Implement `router/execute-swap` for basic stable/volatile pools.
- [ ] Implement `router/execute-quote` for pre-fetched quotes.
- [ ] Implement quote error handling for missing pools, insufficient liquidity, unsupported routes, and RPC failures.
- [ ] Implement transaction error handling for reverted swaps, expired deadlines, slippage, gas estimation failure, and nonce issues.
- [ ] Add unit tests for quote parsing, route construction, slippage, and amount conversion.
- [ ] Add fork/integration tests for at least one liquid Base pair.
- [ ] Document supported chains, pool types, and known limitations.

## Slipstream Swap Support

- [ ] Map Slipstream pool discovery using token pair and tick spacing.
- [ ] Add Slipstream quoter integration.
- [ ] Add Slipstream path encoding and decoding.
- [ ] Implement `clmm/quote-swap`.
- [ ] Implement `clmm/execute-swap`.
- [ ] Handle tick spacing instead of Uniswap-style fee tier assumptions.
- [ ] Add tests for single-hop Slipstream swaps.
- [ ] Add tests for multi-hop or mixed basic/Slipstream routes if supported.

## AMM Liquidity Support

- [ ] Implement `amm/pool-info` for stable and volatile pools.
- [ ] Implement `amm/position-info` for wallet LP token balances.
- [ ] Implement `amm/quote-liquidity`.
- [ ] Implement `amm/add-liquidity`.
- [ ] Implement `amm/remove-liquidity`.
- [ ] Add tests for stable pool liquidity math using contract quotes.
- [ ] Add tests for volatile pool liquidity operations.

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
- [ ] Add tests for position NFT discovery.
- [ ] Add tests for opening, modifying, fee collection, and closing positions.

## Production Hardening

- [ ] Add structured logging for quote, approval, and swap execution paths.
- [ ] Add retry policy for transient RPC/API failures.
- [ ] Add gas estimation safeguards.
- [ ] Add deadline and slippage configuration.
- [ ] Add configuration validation at startup.
- [ ] Add negative tests for unsupported tokens and pools.
- [ ] Verify compatibility with Hummingbot Gateway connector schemas.
- [ ] Run lint, typecheck, unit tests, and fork tests.
- [ ] Prepare usage examples.
- [ ] Prepare upstream contribution notes if submitting to Hummingbot.
