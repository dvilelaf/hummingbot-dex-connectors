# CoW Swap Upstream Notes

What is missing for a real Hummingbot PR:

- Move the shim into Hummingbot's connector layout and register `cowswap`
  discovery, config maps, trading rules, order types, and API routes.
- Wire account, signer, allowance, and optional Gateway ownership without raw
  private keys in connector or Marlin configuration.
- Prove the status, trades, expiry, rejection, partial fill, fill, and signed
  cancellation reconciliation paths in a real Hummingbot API runtime.
- Define the exact Hummingbot order-type mapping for CoW intents before
  claiming limit-order support.
- Add packaging/runtime image steps so import smoke succeeds inside Hummingbot
  API.

Do not sell yet:

- No claim of production readiness, settlement proof, or autonomous execution.
- No claim of generic limit orders, native ETH flow, or funded-account
  settlement coverage.
- No claim that dummy-wallet staging smoke tests prove fills, signing, or order
  posting; they only prove quote API reachability.

License note:

- `cowdao-cowpy>=1.0.1,<2` is listed locally as GNU/GPL. Internal/custom
  runtime use must preserve license and source obligations. Before proprietary
  distribution or upstream packaging, re-check the exact `LICENSE` text and get
  legal review.

Tests needed before upstreaming:

- Unit tests for config maps, trading rules, order types, and API payload
  conversion.
- Lifecycle tests for quote, sign, post, status, trades, cancellation, expiry,
  reject, partial fill, and fill mapping.
- Integration smoke against CoW staging with redacted evidence artifacts.
- Readiness tests proving unsupported chains, native ETH, limit orders, bad
  token metadata, missing allowance, and missing signer fail closed.
- Runtime image smoke proving connector discovery from the Hummingbot API
  container, not only local package imports.
