# CoW Swap Connector Features

## Architecture and Practices

- [ ] Follow Hummingbot Python connector architecture; do not create a standalone bot or Marlin-specific API around CoW.
- [ ] Keep the connector in the Hummingbot API/runtime layer and expose it through standard Hummingbot connector surfaces.
- [ ] Preserve Hummingbot connector semantics: connector name, trading pair, config map, trading rules, order types, balances, fees, client order IDs, order states, fills, cancellations, and order events.
- [x] Separate CoW API access, Hummingbot connector logic, order tracking, signing, persistence, and tests into clear modules.
- [x] Keep the CoW API client focused on Order Book API calls and response normalization.
- [x] Keep Hummingbot order lifecycle logic outside the low-level CoW API client.
- [x] Treat CoW orders as asynchronous intents, not synchronous swaps.
- [x] Map CoW lifecycle transitions into Hummingbot order states without losing partial fill, expiration, cancellation, or rejection information.
- [ ] Persist enough order metadata to recover after process restart before emitting terminal events.
- [ ] Use Hummingbot-managed signing and credential handling; never store, log, or pass raw private keys through connector configuration.
- [ ] Validate chain IDs, EIP-712 domains, settlement/verifying contracts, `GPv2VaultRelayer` addresses, token metadata, and allowances before signing or posting orders.
- [ ] Reuse Hummingbot connector patterns for config maps, trading rules, order trackers, polling, events, and tests.
- [x] Keep configuration deterministic and environment-driven for Docker Compose packaging.
- [x] Add unit, mocked Order Book API, lifecycle/restart, compatibility, and integration tests before considering a feature complete.
- [x] Document every supported chain, token scope, order type, limitation, and operational assumption.
- [ ] Follow the Hummingbot connector test pattern: use shared-style mocked lifecycle tests for deterministic create/cancel/status/trade behavior, and keep live exchange/API tests separate and opt-in.
- [x] Treat live CoW API tests with dummy wallets as smoke tests for quote, signing, posting, and classified API rejection; do not treat them as settlement/fill proof unless the account is funded and allowance is configured.
- [x] Keep `cowdao-cowpy` behind a narrow adapter because version `1.0.1` has package import side effects; import only required submodules and avoid executing package-level app-data network calls during Hummingbot startup.
- [x] Resolve CoW settlement and vault-relayer contract addresses by chain and environment; staging uses a different settlement domain than production.

## MVP: Python Hummingbot Connector

- [ ] Define connector boundary as a Python spot-style Hummingbot connector installed in the Hummingbot API/runtime layer, not imported directly by Marlin.
- [ ] Use the CoW connector for CoW Order Book API lifecycle plus an explicit Hummingbot-managed EVM signer/RPC approval path.
- [x] Define MVP chain as Base mainnet only.
- [x] Define MVP token scope as ERC-20/WETH only.
- [x] Decide whether `cowdao-cowpy` is acceptable as a dependency for the MVP adapter, with caveats documented.
- [x] Review `cowdao-cowpy` license compatibility.
- [x] Review `cowdao-cowpy` package provenance, maintained versions, pinned version ranges, transitive dependencies, vulnerability scan results, and fallback plan if it is unsuitable.
- [x] Add Python package structure for the CoW Swap connector.
- [x] Add connector configuration for supported chain IDs.
- [x] Add API environment configuration for production and staging.
- [ ] Add Hummingbot-managed signer integration; do not store, log, or pass raw private keys through connector configuration.
- [x] Add per-chain configuration for Order Book API, settlement/verifying contract, and `GPv2VaultRelayer`.
- [x] Implement amount normalization from configured token metadata.
- [x] Implement balance checks.
- [x] Implement ERC-20 allowance checks against the per-chain `GPv2VaultRelayer`.
- [x] Implement approval transaction intent planning to the verified `GPv2VaultRelayer` with exact allowance amount.
- [ ] Implement allowance reset/revoke behavior where token behavior requires it.
- [x] Surface insufficient allowance separately from quote, signing, and settlement failures.
- [x] Implement quote request creation for sell orders.
- [x] Implement quote response parsing.
- [ ] Implement EIP-712 order signing with per-chain domain validation, `chainId`, verifying contract, validity bounds, and replay-protection checks.
- [ ] Verify order UID, digest, quote ID, `validTo`, and signed order fields before posting.
- [x] Implement order posting.
- [x] Store and track CoW order UID.
- [ ] Map CoW order states to Hummingbot order states across quote, signed intent, posted order, accepted/open, solver settlement transaction, fills, expiration, cancellation, and rejection.
- [x] Poll order status by UID.
- [x] Poll trades/fills by order UID.
- [ ] Implement cancellation modes: off-chain signed cancellation, on-chain invalidation if needed, race handling with settlement, and post-cancel reconciliation.
- [x] Handle expired orders.
- [x] Handle rejected quotes and rejected orders.
- [x] Add unit tests for quote mapping, order mapping, and amount conversion.
- [x] Add mocked Order Book API tests for quote, post, status, trades, and cancellation.
- [ ] Add staging/testnet integration tests for the full quote, sign, post, poll, fill or cancel path.
- [x] Add opt-in staging smoke test with generated dummy EOA that verifies quote/sign/post reaches CoW API and receives a classified no-funds rejection.
- [x] Document supported chains, order types, and limitations.

## Marlin Runtime Integration

- [ ] Package CoW Swap into a custom Hummingbot API/runtime image, not into the Marlin Python image.
- [x] Keep Marlin integration API-only: Marlin calls Hummingbot API connector endpoints by connector name.
- [ ] Ensure the connector appears in Hummingbot API `/connectors/`.
- [ ] Ensure Hummingbot API exposes connector metadata through `/connectors/{connector}/order-types`, `/connectors/{connector}/trading-rules`, and `/connectors/{connector}/config-map`.
- [x] Support Compose configuration through `HUMMINGBOT_CONNECTOR`, `SYMBOL`, Hummingbot account settings, and connector-specific credential environment variables.
- [x] Add runtime documentation for the expected Compose services: `marlin`, `hummingbot-api`, `hummingbot-gateway` if approvals/RPC are delegated there, `hummingbot-postgres`, and `hummingbot-broker`.
- [ ] Add a Marlin readiness path that verifies connector availability, supported order types, trading rules, account connector state, and order book or equivalent market data availability.
- [x] Document how CoW asynchronous order evidence maps back to Marlin artifacts, ledgers, active orders, order search, and trades.
- [x] Document that CoW code is owned by the Hummingbot connector image; Marlin should only consume normalized API responses and persisted evidence.

## Order Lifecycle

- [x] Support submitted order state.
- [x] Support open/pending order state.
- [x] Support full fill state.
- [x] Support partial fill state if available through trades.
- [x] Support canceled state.
- [x] Support expired state.
- [x] Support failed/rejected state.
- [x] Reconcile locally tracked orders after process restart.
- [x] Persist order UID, `validTo`, digest, quote ID, sell token, buy token, sell amount, buy amount, executed amounts, order kind, partially-fillable flag, signing scheme, owner, receiver, chain ID, Hummingbot client order ID, and trading pair to recover tracking.
- [ ] Emit Hummingbot order events consistently.
- [ ] Add restart/reconciliation tests for persisted orders, expired orders, filled orders, canceled orders, and unknown API responses.

## Trading Features

- [x] Support `SELL` orders.
- [ ] Evaluate whether `BUY` orders are required.
- [ ] Support swap-style `SELL` orders from quotes, with slippage translated into limit price/minimum receive and success emitted only after settlement/fill reconciliation.
- [x] Defer generic limit-order support until Hummingbot order-type mapping is specified.
- [x] Support custom validity/expiration.
- [x] Support receiver address configuration.
- [x] Support app data or app code attribution.
- [ ] Support gasless fee-in-sell-token accounting.
- [ ] Add native ETH/Eth-flow support as a distinct feature path if required.

## Additional Chain Support

- [ ] Add Ethereum mainnet support.
- [ ] Add Arbitrum support if needed.
- [ ] Add Gnosis Chain support if needed.
- [ ] Add Polygon support if needed.
- [ ] Add Avalanche support if needed.
- [ ] Add BNB support if needed.
- [ ] Validate CoW API endpoints per chain.
- [ ] Validate settlement/verifying contract addresses per chain.
- [ ] Validate `GPv2VaultRelayer` addresses per chain.
- [ ] Verify configured contract addresses by chain ID, checksum, deployed code, ABI compatibility, proxy status where applicable, and official sources.

## Production Hardening

- [ ] Add rate limit handling.
- [ ] Add retry policy for transient API failures.
- [ ] Add timeout handling for quotes, posting, polling, and cancellation.
- [ ] Add structured logging.
- [x] Add clear errors for unsupported tokens and chains.
- [ ] Add health checks for Order Book API availability.
- [x] Add safeguards for stale quotes.
- [x] Add safeguards for duplicate submissions.
- [ ] Add tests for API errors, malformed responses, expired orders, rejected quotes, rejected orders, unsupported tokens, unsupported chains, stale quotes, duplicate submissions, cancellation races, and unknown order states.
- [x] Add replay-focused signing tests for chain ID, verifying contract, and signer-owner mismatches.
- [ ] Add Hummingbot compatibility tests for config, trading pair conversion, event emission, order state mapping, and connector interface expectations.
- [ ] Run lint, typecheck, unit tests, and integration tests.
- [ ] Prepare usage examples.
- [ ] Prepare upstream contribution notes if submitting to Hummingbot.
