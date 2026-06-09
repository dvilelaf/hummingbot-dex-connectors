import type {
  AerodromeExecutionPlan,
  AerodromeExecutionPlanDto,
  AerodromeQuote,
  AerodromeQuoteDto,
} from '../types.js';

export function quoteToDto(quote: AerodromeQuote): AerodromeQuoteDto {
  const routePath = [
    quote.tokenIn.symbol,
    ...quote.routes.slice(0, -1).map((route) => route.to),
    quote.tokenOut.symbol,
  ].join(' -> ');
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
    maxAmountIn: quote.amountIn,
    price: quote.price,
    priceImpactPct: quote.priceImpactPct,
    routePath,
    poolAddress: quote.poolAddress,
    poolAddresses: quote.poolAddresses,
    routePoolTypes: quote.routePoolTypes,
    poolType: quote.poolType,
    expiresAt: quote.expiresAt,
  };
}

export function executionPlanToDto(plan: AerodromeExecutionPlan): AerodromeExecutionPlanDto {
  return {
    quote: quoteToDto(plan.quote),
    ...(plan.approval === undefined ? {} : { approval: plan.approval }),
    swap: plan.swap,
  };
}
