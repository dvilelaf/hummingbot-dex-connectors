import type { BigNumber } from '@ethersproject/bignumber';

import type { PlannedTransaction, SwapSide, TokenInfo } from '../types.js';

export interface SlipstreamPathHop {
  readonly tokenOut: TokenInfo;
  readonly tickSpacing: number;
}

export interface SlipstreamQuoteSwapRequest {
  readonly baseToken: TokenInfo;
  readonly quoteToken: TokenInfo;
  readonly amount: string;
  readonly side: SwapSide;
  readonly route: readonly SlipstreamPathHop[];
  readonly slippageBps?: number;
  readonly walletAddress?: string;
  readonly recipient?: string;
  readonly deadline?: number;
}

export interface SlipstreamExecuteSwapRequest extends SlipstreamQuoteSwapRequest {
  readonly walletAddress: string;
}

export interface SlipstreamRouteLeg {
  readonly tokenIn: TokenInfo;
  readonly tokenOut: TokenInfo;
  readonly tickSpacing: number;
}

export interface SlipstreamQuote {
  readonly quoteId: string;
  readonly tokenIn: TokenInfo;
  readonly tokenOut: TokenInfo;
  readonly amountIn: string;
  readonly amountOut: string;
  readonly amountInAtomic: BigNumber;
  readonly amountOutAtomic: BigNumber;
  readonly minAmountOut: string;
  readonly minAmountOutAtomic: BigNumber;
  readonly price: string;
  readonly priceImpactPct: string | null;
  readonly route: readonly SlipstreamRouteLeg[];
  readonly encodedPath: string;
  readonly router: string;
  readonly quoter: string;
  readonly expiresAt: number;
}

export interface SlipstreamExecutionPlan {
  readonly quote: SlipstreamQuote;
  readonly approval?: PlannedTransaction;
  readonly swap: PlannedTransaction;
}

export interface SlipstreamQuoteDto {
  readonly quoteId: string;
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly amountIn: string;
  readonly amountOut: string;
  readonly amountInAtomic: string;
  readonly amountOutAtomic: string;
  readonly minAmountOut: string;
  readonly minAmountOutAtomic: string;
  readonly price: string;
  readonly priceImpactPct: string | null;
  readonly routePath: string;
  readonly encodedPath: string;
  readonly router: string;
  readonly quoter: string;
  readonly expiresAt: number;
}

export interface SlipstreamExecutionPlanDto {
  readonly quote: SlipstreamQuoteDto;
  readonly approval?: PlannedTransaction;
  readonly swap: PlannedTransaction;
}
