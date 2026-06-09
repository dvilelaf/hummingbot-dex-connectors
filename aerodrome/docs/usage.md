# Aerodrome Usage

Minimal local checks:

```bash
cd aerodrome
pnpm install
pnpm run check
```

Supported MVP surface:

- Chain/network: `ethereum/base`, chain ID `8453`.
- Pool types: Aerodrome basic `stable` and `volatile` pools.
- Swap direction: exact-input `SELL` only.
- Route shape: `{ from, to, stable, factory }`.
- Approval spender: Aerodrome Router.
- Execution mode: transaction planning only; no private key handling and no local
  signing.

Unsupported in this package:

- Exact-output `BUY`; Aerodrome basic Router has no direct exact-output swap.
- Native ETH routes; use WETH first.
- Slipstream, Universal Router, mixed routes, AMM liquidity, CLMM positions,
  gauges, voting, bribes, and emissions.
- Fork/live swaps without a funded wallet and explicit Gateway runtime wiring.

The connector validates chain ID, deployed contract code, on-chain ERC-20
decimals, Router factory configuration, FactoryRegistry approval, PoolFactory
pool existence, pool token metadata, nonzero reserves, nonzero quoted output,
nonzero minimum output, recipient/deadline, wallet balance, allowance, and
current output before building calldata. Route helpers return JSON-safe DTOs; raw
`BigNumber` values stay internal.

`priceImpactPct` is returned as `null` because the MVP does not compute a
defensible Aerodrome stable/volatile price-impact estimate.
