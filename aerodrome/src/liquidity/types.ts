import type { BigNumber } from '@ethersproject/bignumber';

import type { PlannedTransaction, PoolType, TokenInfo } from '../types.js';

export interface AddLiquidityRequest {
  readonly tokenA: TokenInfo;
  readonly tokenB: TokenInfo;
  readonly amountA: string;
  readonly amountB: string;
  readonly poolType: PoolType;
  readonly walletAddress: string;
  readonly recipient?: string;
  readonly slippageBps?: number;
  readonly deadline?: number;
}

export interface RemoveLiquidityRequest {
  readonly tokenA: TokenInfo;
  readonly tokenB: TokenInfo;
  readonly liquidity: string;
  readonly poolType: PoolType;
  readonly walletAddress: string;
  readonly recipient?: string;
  readonly slippageBps?: number;
  readonly deadline?: number;
}

export interface AerodromeLiquidityQuote {
  readonly poolAddress: string;
  readonly tokenA: TokenInfo;
  readonly tokenB: TokenInfo;
  readonly routeTokenA: TokenInfo;
  readonly routeTokenB: TokenInfo;
  readonly poolType: PoolType;
  readonly amountA: string;
  readonly amountB: string;
  readonly amountAAtomic: BigNumber;
  readonly amountBAtomic: BigNumber;
  readonly amountAMin: string;
  readonly amountBMin: string;
  readonly amountAMinAtomic: BigNumber;
  readonly amountBMinAtomic: BigNumber;
  readonly liquidity: string;
  readonly liquidityAtomic: BigNumber;
}

export interface AerodromeLiquidityPlan {
  readonly quote: AerodromeLiquidityQuote;
  readonly approvals: readonly PlannedTransaction[];
  readonly transaction: PlannedTransaction;
}
