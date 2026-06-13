import type { Aerodrome } from './aerodrome.js';
import type {
  AerodromeExecutionPlan,
  AerodromeQuote,
  PlannedTransaction,
  PoolType,
  QuoteSwapRequest,
  TokenInfo,
} from './types.js';

export type GatewaySwapSide = 'BUY' | 'SELL';
export type GatewayExecutionStatus = -1 | 0 | 1 | 'FAILED' | 'SUBMITTED' | 'PENDING' | 'CONFIRMED';

export interface AerodromeGatewayQuoteRequest {
  readonly baseToken: string;
  readonly quoteToken: string;
  readonly amount: number;
  readonly side: GatewaySwapSide;
  readonly slippagePct?: number;
  readonly walletAddress?: string;
  readonly poolType?: PoolType;
  readonly maxHops?: 1 | 2 | '1' | '2';
}

export interface AerodromeGatewayExecuteSwapRequest extends AerodromeGatewayQuoteRequest {
  readonly walletAddress: string;
}

export interface AerodromeGatewayQuoteResponse {
  readonly quoteId: string;
  readonly poolAddress: string;
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly amountIn: number;
  readonly amountOut: number;
  readonly price: number;
  readonly slippagePct: number;
  readonly minAmountOut: number;
  readonly maxAmountIn: number;
  readonly priceImpactPct: number;
  readonly routePath: string;
}

export interface AerodromeGatewayExecutedTransaction {
  readonly kind: 'approval' | 'swap';
  readonly signature: string;
  readonly status: GatewayExecutionStatus;
}

export interface AerodromeGatewaySwapExecutionResponse {
  readonly signature: string;
  readonly status: GatewayExecutionStatus;
  readonly transactions: readonly AerodromeGatewayExecutedTransaction[];
}

export interface AerodromeGatewayTransactionExecutor {
  readonly executeTransaction: (
    transaction: PlannedTransaction,
  ) => Promise<GatewayTransactionBroadcastResponse>;
}

export interface GatewayTransactionBroadcastResponse {
  readonly signature?: string;
  readonly txHash?: string;
  readonly tx_hash?: string;
  readonly hash?: string;
  readonly transactionHash?: string;
  readonly transaction_hash?: string;
  readonly status?: GatewayExecutionStatus;
  readonly txStatus?: GatewayExecutionStatus;
}

export type AerodromeGatewayTokenResolver = (symbol: string) => Promise<TokenInfo> | TokenInfo;

export async function quoteAerodromeForGateway(
  connector: Aerodrome,
  request: AerodromeGatewayQuoteRequest,
  resolveToken: AerodromeGatewayTokenResolver,
): Promise<AerodromeGatewayQuoteResponse> {
  const quote = await connector.quoteSwap(
    await gatewayQuoteRequestToAerodromeRequest(request, resolveToken),
  );
  return quoteToGatewayResponse(quote, request.slippagePct);
}

export async function planAerodromeGatewaySwap(
  connector: Aerodrome,
  request: AerodromeGatewayExecuteSwapRequest,
  resolveToken: AerodromeGatewayTokenResolver,
): Promise<AerodromeExecutionPlan> {
  const quoteRequest = await gatewayQuoteRequestToAerodromeRequest(request, resolveToken);
  return connector.executeSwap({ ...quoteRequest, walletAddress: request.walletAddress });
}

export async function executeAerodromeGatewaySwapPlan(
  plan: AerodromeExecutionPlan,
  executor: AerodromeGatewayTransactionExecutor,
): Promise<AerodromeGatewaySwapExecutionResponse> {
  const transactions: AerodromeGatewayExecutedTransaction[] = [];

  if (plan.approval !== undefined) {
    transactions.push(
      await executePlannedTransaction('approval', plan.approval, executor),
    );
    const lastTransaction = transactions[transactions.length - 1];
    if (lastTransaction !== undefined && isFailedStatus(lastTransaction.status)) {
      return swapExecutionResponse(transactions);
    }
  }

  transactions.push(await executePlannedTransaction('swap', plan.swap, executor));
  return swapExecutionResponse(transactions);
}

async function gatewayQuoteRequestToAerodromeRequest(
  request: AerodromeGatewayQuoteRequest,
  resolveToken: AerodromeGatewayTokenResolver,
): Promise<QuoteSwapRequest> {
  if (request.side === 'BUY') {
    throw new Error('Aerodrome Gateway adapter supports SELL swaps only');
  }
  if (!Number.isFinite(request.amount) || request.amount <= 0) {
    throw new Error('Aerodrome swap amount must be positive');
  }

  const slippageBps = slippagePctToBps(request.slippagePct);
  return {
    amount: String(request.amount),
    baseToken: await resolveToken(request.baseToken),
    maxHops: gatewayMaxHops(request.maxHops),
    poolType: request.poolType ?? 'volatile',
    quoteToken: await resolveToken(request.quoteToken),
    side: request.side,
    ...(slippageBps === undefined ? {} : { slippageBps }),
    ...(request.walletAddress === undefined
      ? {}
      : { walletAddress: request.walletAddress }),
  };
}

function gatewayMaxHops(maxHops: AerodromeGatewayQuoteRequest['maxHops']): 1 | 2 {
  if (maxHops === undefined) {
    return 1;
  }
  if (maxHops === 1 || maxHops === '1') {
    return 1;
  }
  if (maxHops === 2 || maxHops === '2') {
    return 2;
  }
  throw new Error('Aerodrome maxHops must be 1 or 2');
}

function quoteToGatewayResponse(
  quote: AerodromeQuote,
  slippagePct: number | undefined,
): AerodromeGatewayQuoteResponse {
  return {
    amountIn: numberFromDecimalString(quote.amountIn, 'amountIn'),
    amountOut: numberFromDecimalString(quote.amountOut, 'amountOut'),
    maxAmountIn: numberFromDecimalString(quote.amountIn, 'maxAmountIn'),
    minAmountOut: numberFromDecimalString(quote.minAmountOut, 'minAmountOut'),
    poolAddress: quote.poolAddress,
    price: numberFromDecimalString(quote.price, 'price'),
    priceImpactPct:
      quote.priceImpactPct === null
        ? 0
        : numberFromDecimalString(quote.priceImpactPct, 'priceImpactPct'),
    quoteId: quote.quoteId,
    routePath: quote.routes.map((route) => `${route.from}->${route.to}`).join('|'),
    slippagePct: slippagePct ?? 0,
    tokenIn: quote.tokenIn.address,
    tokenOut: quote.tokenOut.address,
  };
}

async function executePlannedTransaction(
  kind: AerodromeGatewayExecutedTransaction['kind'],
  transaction: PlannedTransaction,
  executor: AerodromeGatewayTransactionExecutor,
): Promise<AerodromeGatewayExecutedTransaction> {
  const response = await executor.executeTransaction(transaction);
  const signature = transactionSignature(response);
  return {
    kind,
    signature,
    status: response.status ?? response.txStatus ?? 0,
  };
}

function swapExecutionResponse(
  transactions: readonly AerodromeGatewayExecutedTransaction[],
): AerodromeGatewaySwapExecutionResponse {
  const last = transactions[transactions.length - 1];
  if (last === undefined) {
    throw new Error('Aerodrome swap execution produced no transactions');
  }
  return {
    signature: last.signature,
    status: executionStatus(transactions),
    transactions,
  };
}

function transactionSignature(response: GatewayTransactionBroadcastResponse): string {
  const signature =
    response.signature ??
    response.txHash ??
    response.tx_hash ??
    response.hash ??
    response.transactionHash ??
    response.transaction_hash;
  if (signature === undefined || signature.trim() === '') {
    throw new Error('Aerodrome transaction execution returned no hash');
  }
  return signature;
}

function executionStatus(
  transactions: readonly AerodromeGatewayExecutedTransaction[],
): GatewayExecutionStatus {
  if (transactions.some((transaction) => isFailedStatus(transaction.status))) {
    return 'FAILED';
  }
  if (transactions.every((transaction) => isConfirmedStatus(transaction.status))) {
    return 'CONFIRMED';
  }
  return 'SUBMITTED';
}

function isFailedStatus(status: GatewayExecutionStatus): boolean {
  return status === -1 || (typeof status === 'string' && status.toUpperCase() === 'FAILED');
}

function isConfirmedStatus(status: GatewayExecutionStatus): boolean {
  return status === 1 || (typeof status === 'string' && status.toUpperCase() === 'CONFIRMED');
}

function slippagePctToBps(slippagePct: number | undefined): number | undefined {
  if (slippagePct === undefined) {
    return undefined;
  }
  if (!Number.isFinite(slippagePct) || slippagePct < 0 || slippagePct > 100) {
    throw new Error('Aerodrome slippagePct must be between 0 and 100');
  }
  return Math.round(slippagePct * 100);
}

function numberFromDecimalString(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Aerodrome quote ${label} is not numeric`);
  }
  return parsed;
}
