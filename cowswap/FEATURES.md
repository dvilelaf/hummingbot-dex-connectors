# CoW Swap Connector Features

## MVP: Python Hummingbot Connector

- [ ] Confirm connector target: Hummingbot Python core connector, not Gateway.
- [ ] Decide whether `cowdao-cowpy` is acceptable as a dependency.
- [ ] Review `cowdao-cowpy` license compatibility.
- [ ] Add Python package structure for the CoW Swap connector.
- [ ] Add connector configuration for supported chain IDs.
- [ ] Add API environment configuration for production and staging.
- [ ] Add wallet/private-key or signer integration compatible with Hummingbot.
- [ ] Implement token metadata lookup and amount normalization.
- [ ] Implement balance checks.
- [ ] Implement ERC-20 allowance checks.
- [ ] Implement approval transaction flow.
- [ ] Implement quote request creation for sell orders.
- [ ] Implement quote response parsing.
- [ ] Implement EIP-712 order signing.
- [ ] Implement order posting.
- [ ] Store and track CoW order UID.
- [ ] Map CoW order states to Hummingbot order states.
- [ ] Poll order status by UID.
- [ ] Poll trades/fills by order UID.
- [ ] Implement basic cancellation.
- [ ] Handle expired orders.
- [ ] Handle rejected quotes and rejected orders.
- [ ] Add unit tests for quote mapping, order mapping, and amount conversion.
- [ ] Add integration test against a testnet or mock Order Book API.
- [ ] Document supported chains, order types, and limitations.

## Order Lifecycle

- [ ] Support submitted order state.
- [ ] Support open/pending order state.
- [ ] Support full fill state.
- [ ] Support partial fill state if available through trades.
- [ ] Support canceled state.
- [ ] Support expired state.
- [ ] Support failed/rejected state.
- [ ] Reconcile locally tracked orders after process restart.
- [ ] Persist enough order metadata to recover tracking.
- [ ] Emit Hummingbot order events consistently.

## Trading Features

- [ ] Support `SELL` orders.
- [ ] Evaluate whether `BUY` orders are required.
- [ ] Support market-like swaps with configurable slippage.
- [ ] Support limit orders if useful for strategies.
- [ ] Support custom validity/expiration.
- [ ] Support receiver address configuration.
- [ ] Support app data or app code attribution.
- [ ] Support gasless fee-in-sell-token accounting.
- [ ] Support native token wrapping behavior if required.

## Multi-Chain Support

- [ ] Add Ethereum mainnet support.
- [ ] Add Base support.
- [ ] Add Arbitrum support if needed.
- [ ] Add Gnosis Chain support if needed.
- [ ] Add Polygon support if needed.
- [ ] Add Avalanche support if needed.
- [ ] Add BNB support if needed.
- [ ] Validate CoW API endpoints per chain.
- [ ] Validate settlement contract addresses per chain.

## Production Hardening

- [ ] Add rate limit handling.
- [ ] Add retry policy for transient API failures.
- [ ] Add timeout handling for quotes, posting, polling, and cancellation.
- [ ] Add structured logging.
- [ ] Add clear errors for unsupported tokens and chains.
- [ ] Add health checks for Order Book API availability.
- [ ] Add safeguards for stale quotes.
- [ ] Add safeguards for duplicate submissions.
- [ ] Add tests for API errors and malformed responses.
- [ ] Add tests for restart/reconciliation behavior.
- [ ] Run lint, typecheck, unit tests, and integration tests.
- [ ] Prepare usage examples.
- [ ] Prepare upstream contribution notes if submitting to Hummingbot.
