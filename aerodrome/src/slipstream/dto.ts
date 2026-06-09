import type {
  SlipstreamExecutionPlan,
  SlipstreamExecutionPlanDto,
  SlipstreamQuote,
  SlipstreamQuoteDto,
} from './types.js';

export function quoteToDto(quote: SlipstreamQuote): SlipstreamQuoteDto {
  const first = quote.route[0];
  const routePath =
    first === undefined
      ? quote.tokenIn.symbol
      : [
          first.tokenIn.symbol,
          ...quote.route.map((leg) => `--${leg.tickSpacing}--> ${leg.tokenOut.symbol}`),
        ].join(' ');
  return {
    quoteId: quote.quoteId,
    tokenIn: quote.tokenIn.address,
    tokenOut: quote.tokenOut.address,
    amountIn: quote.amountIn,
    amountOut: quote.amountOut,
    amountInAtomic: quote.amountInAtomic.toString(),
    amountOutAtomic: quote.amountOutAtomic.toString(),
    minAmountOut: quote.minAmountOut,
    minAmountOutAtomic: quote.minAmountOutAtomic.toString(),
    price: quote.price,
    priceImpactPct: quote.priceImpactPct,
    routePath,
    encodedPath: quote.encodedPath,
    router: quote.router,
    quoter: quote.quoter,
    expiresAt: quote.expiresAt,
  };
}

export function executionPlanToDto(plan: SlipstreamExecutionPlan): SlipstreamExecutionPlanDto {
  return {
    quote: quoteToDto(plan.quote),
    ...(plan.approval === undefined ? {} : { approval: plan.approval }),
    swap: plan.swap,
  };
}
