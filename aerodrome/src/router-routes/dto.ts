import type {
  AerodromeExecutionPlan,
  AerodromeExecutionPlanDto,
  AerodromeQuote,
  AerodromeQuoteDto,
} from '../types.js';

export function quoteToDto(quote: AerodromeQuote): AerodromeQuoteDto {
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
    routePath: `${quote.tokenIn.symbol} -> ${quote.tokenOut.symbol}`,
    poolAddress: quote.poolAddress,
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
