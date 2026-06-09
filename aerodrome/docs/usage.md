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
- Route shape: one or two `{ from, to, stable, factory }` legs.
- Route search: direct or one configured intermediate token, selecting the
  highest valid `getAmountsOut` result.
- Native ETH: supported with the standard ETH sentinel at the public boundary;
  Aerodrome routes use configured WETH internally and Router ETH swap methods
  for execution.
- Approval spender: Aerodrome Router.
- Execution mode: transaction planning only; no private key handling and no local
  signing.

Unsupported in this package:

- Exact-output `BUY`; Hummingbot-style buys require a guaranteed output amount,
  but Aerodrome basic Router only exposes exact-input swap methods such as
  `swapExactTokensForTokens` plus `getAmountsOut`.
- Slipstream, Universal Router, AMM liquidity, CLMM positions, gauges, voting,
  bribes, and emissions.
- Fork/live swaps without a funded wallet and explicit Gateway runtime wiring.

The connector validates chain ID, deployed contract code, on-chain ERC-20
decimals, Router factory configuration, FactoryRegistry approval, PoolFactory
pool existence, pool token metadata, nonzero reserves, nonzero quoted output,
nonzero minimum output, recipient/deadline, wallet balance, allowance, and
current output before building calldata. Route helpers return JSON-safe DTOs; raw
`BigNumber` values stay internal.

`priceImpactPct` is returned as `null` because the MVP does not compute a
defensible Aerodrome stable/volatile price-impact estimate.

`UNSAFE_swapExactTokensForTokens` is deliberately not used for `BUY` because it
accepts caller-provided amounts and does not provide an exact-output bound.
