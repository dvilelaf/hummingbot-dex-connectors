# CoW Python SDK Dependency Review

Reviewed dependency: `cowdao-cowpy>=1.0.1,<2`.

## Decision

`cowdao-cowpy` is acceptable for the MVP behind the existing narrow adapter:

- `hummingbot_cowswap.client.CowDaoOrderBookClient`
- `hummingbot_cowswap.signing.CowPyEip712Signer`
- `hummingbot_cowswap.cowpy`

Connector lifecycle, persistence, preflight checks, and Hummingbot-facing
behavior must remain outside cowpy so the SDK can be replaced if needed.

## Provenance

Sources checked on June 9, 2026:

- PyPI: https://pypi.org/project/cowdao-cowpy/
- GitHub: https://github.com/cowdao-grants/cow-py
- SDK docs: https://cowdao-grants-cow-py.mintlify.app/

PyPI lists version `1.0.1`, uploaded August 13, 2025, with trusted publishing
provenance from `cowdao-grants/cow-py` tag `v1.0.1`.

Local installed metadata:

- package: `cowdao-cowpy`
- version: `1.0.1`
- Python: `>=3.10,<4.0`
- direct high-impact dependencies include `httpx`, `pydantic`, `web3`,
  `eth-abi`, `eth-typing`, `pycryptodomex`, and `backoff`.

## License

PyPI and the GitHub organization list the project as GNU/GPL licensed. That is
compatible with an internal/custom Hummingbot runtime image as long as license
and source obligations are preserved. Before proprietary distribution or
upstream packaging, re-check the exact repository `LICENSE` text and distribution
requirements with legal review.

## Vulnerability Scan

Command run:

```bash
uvx pip-audit --path .venv/lib/python3.12/site-packages --desc --progress-spinner off
```

Result: no known vulnerabilities found in installed third-party dependencies.
The local editable package `hummingbot-cowswap-connector` was skipped because it
is not published on PyPI.

## Fallback Plan

If cowpy becomes unsuitable, keep the package boundary and replace only the
adapter layer:

- Generate or hand-maintain minimal Pydantic models for quote, order post,
  status, trades, and cancellation payloads.
- Keep CoW Order Book API access in `client.py`.
- Keep EIP-712 signing in `signing.py` using `eth-account`.
- Keep existing connector lifecycle tests as compatibility tests for the
  replacement adapter.

The fallback should not change Marlin or the Hummingbot API runtime contract.
