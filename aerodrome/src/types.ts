import type { BigNumber, BigNumberish } from '@ethersproject/bignumber';

// Hummingbot-style BUY is exact-output. Aerodrome basic Router support is
// intentionally rejected until a safe exact-output ABI path exists.
export type SwapSide = 'BUY' | 'SELL';
export type PoolType = 'stable' | 'volatile';
export type SelectedPoolType = PoolType | 'mixed';

export interface TokenInfo {
  readonly symbol: string;
  readonly address: string;
  readonly decimals: number;
}

export interface AerodromeContracts {
  readonly router: string;
  readonly poolFactory: string;
  readonly factoryRegistry: string;
  readonly weth: string;
  readonly voter?: string;
  readonly votingEscrow?: string;
  readonly slipstream?: AerodromeSlipstreamContracts;
}

export interface AerodromeSlipstreamContracts {
  readonly router: string;
  readonly quoter: string;
  readonly poolFactory?: string;
  readonly mixedQuoter?: string;
  readonly positionManager?: string;
}

export interface AerodromeNetworkConfig {
  readonly chainId: number;
  readonly chain: 'ethereum';
  readonly network: 'base';
  readonly contracts: AerodromeContracts;
  readonly defaultSlippageBps: number;
  readonly defaultTtlSeconds: number;
}

export interface AerodromeRoute {
  readonly from: string;
  readonly to: string;
  readonly stable: boolean;
  readonly factory: string;
}

export interface AerodromeProvider {
  readonly getNetwork: () => Promise<{ readonly chainId: number }>;
  readonly getCode: (address: string) => Promise<string>;
  readonly getBalance?: (address: string) => Promise<BigNumber>;
  readonly call: (transaction: Readonly<CallRequest>) => Promise<string>;
  readonly estimateGas: (transaction: Readonly<TransactionRequest>) => Promise<BigNumber>;
}

export interface CallRequest {
  readonly to: string;
  readonly data: string;
}

export interface TransactionRequest extends CallRequest {
  readonly from: string;
  readonly value: BigNumber;
}

export interface QuoteSwapRequest {
  readonly baseToken: TokenInfo;
  readonly quoteToken: TokenInfo;
  readonly amount: string;
  readonly side: SwapSide;
  readonly poolType: PoolType;
  readonly maxHops?: 1 | 2;
  readonly slippageBps?: number;
  readonly walletAddress?: string;
  readonly recipient?: string;
  readonly deadline?: number;
}

export interface ExecuteSwapRequest extends QuoteSwapRequest {
  readonly walletAddress: string;
}

export interface ExecuteQuoteRequest {
  readonly quoteId: string;
  readonly walletAddress: string;
  readonly recipient?: string;
  readonly deadline?: number;
}

export interface AerodromeQuote {
  readonly quoteId: string;
  readonly tokenIn: TokenInfo;
  readonly tokenOut: TokenInfo;
  readonly amountIn: string;
  readonly amountOut: string;
  readonly amountInAtomic: BigNumber;
  readonly amountOutAtomic: BigNumber;
  readonly minAmountOutAtomic: BigNumber;
  readonly minAmountOut: string;
  readonly price: string;
  readonly priceImpactPct: string | null;
  readonly route: AerodromeRoute;
  readonly routes: readonly AerodromeRoute[];
  readonly poolAddress: string;
  readonly poolAddresses: readonly string[];
  readonly routePoolTypes: readonly PoolType[];
  readonly poolType: SelectedPoolType;
  readonly expiresAt: number;
}

export interface PlannedTransaction {
  readonly to: string;
  readonly from: string;
  readonly data: string;
  readonly value: string;
  readonly gasEstimate: string;
}

export interface AerodromeExecutionPlan {
  readonly quote: AerodromeQuote;
  readonly approval?: PlannedTransaction;
  readonly swap: PlannedTransaction;
}

export interface PoolMetadata {
  readonly decimals0: BigNumber;
  readonly decimals1: BigNumber;
  readonly reserve0: BigNumber;
  readonly reserve1: BigNumber;
  readonly stable: boolean;
  readonly token0: string;
  readonly token1: string;
}

export interface CachedQuote {
  readonly quote: AerodromeQuote;
  readonly request: QuoteSwapRequest;
}

export interface AerodromeQuoteDto {
  readonly quoteId: string;
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly amountIn: string;
  readonly amountOut: string;
  readonly amountInAtomic: string;
  readonly amountOutAtomic: string;
  readonly minAmountOut: string;
  readonly minAmountOutAtomic: string;
  readonly maxAmountIn: string;
  readonly price: string;
  readonly priceImpactPct: string | null;
  readonly routePath: string;
  readonly poolAddress: string;
  readonly poolAddresses: readonly string[];
  readonly routePoolTypes: readonly PoolType[];
  readonly poolType: SelectedPoolType;
  readonly expiresAt: number;
}

export interface AerodromeExecutionPlanDto {
  readonly quote: AerodromeQuoteDto;
  readonly approval?: PlannedTransaction;
  readonly swap: PlannedTransaction;
}

export type AerodromeGaugeSelector =
  | { readonly gaugeAddress: string; readonly poolAddress?: never }
  | { readonly poolAddress: string; readonly gaugeAddress?: never };

export interface GaugeDepositRequest {
  readonly walletAddress: string;
  readonly lpToken: TokenInfo;
  readonly liquidity: BigNumberish;
  readonly recipient?: string;
}

export type PlanGaugeDepositRequest = GaugeDepositRequest & AerodromeGaugeSelector;
export type PlanGaugeWithdrawRequest = {
  readonly walletAddress: string;
  readonly liquidity: BigNumberish;
} & AerodromeGaugeSelector;
export type PlanGaugeRewardClaimRequest = {
  readonly walletAddress: string;
  readonly accountAddress?: string;
} & AerodromeGaugeSelector;

export interface AerodromeGaugeDepositPlan {
  readonly gaugeAddress: string;
  readonly approval?: PlannedTransaction;
  readonly deposit: PlannedTransaction;
}

export interface AerodromeGaugeWithdrawPlan {
  readonly gaugeAddress: string;
  readonly withdraw: PlannedTransaction;
}

export interface AerodromeGaugeRewardClaimPlan {
  readonly gaugeAddress: string;
  readonly claim: PlannedTransaction;
}

export type AerodromeGaugeListSelector =
  | { readonly gauges: readonly string[]; readonly pools?: never }
  | { readonly pools: readonly string[]; readonly gauges?: never };

export type PlanVoterClaimRewardsRequest = {
  readonly walletAddress: string;
} & AerodromeGaugeListSelector;

export type AerodromeVoterRewardClaim = {
  readonly tokenAddresses: readonly string[];
} & AerodromeGaugeSelector;

export interface PlanVoterClaimVotingRewardsRequest {
  readonly walletAddress: string;
  readonly tokenId: BigNumberish;
  readonly claims: readonly AerodromeVoterRewardClaim[];
}

export interface AerodromeVoterClaimRewardsPlan {
  readonly voterAddress: string;
  readonly gaugeAddresses: readonly string[];
  readonly claim: PlannedTransaction;
}

export interface AerodromeVoterVotingRewardsPlan {
  readonly voterAddress: string;
  readonly gaugeAddresses: readonly string[];
  readonly rewardAddresses: readonly string[];
  readonly tokenAddresses: readonly (readonly string[])[];
  readonly claim: PlannedTransaction;
}
