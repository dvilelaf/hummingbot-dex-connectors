import { Interface } from '@ethersproject/abi';
import { getAddress } from '@ethersproject/address';
import { BigNumber } from '@ethersproject/bignumber';

import { aerodromeBaseConfig } from './config.js';
import {
  ERC20_ABI,
  FACTORY_REGISTRY_ABI,
  POOL_ABI,
  POOL_FACTORY_ABI,
  ROUTER_ABI,
} from './contracts.js';
import {
  AllowanceError,
  BalanceError,
  PoolValidationError,
  QuoteCacheError,
  QuoteError,
  TransactionPreflightError,
  UnsupportedNetworkError,
  UnsupportedTokenError,
} from './errors.js';
import type {
  AerodromeExecutionPlan,
  AerodromeNetworkConfig,
  AerodromeProvider,
  AerodromeQuote,
  AerodromeRoute,
  CachedQuote,
  ExecuteQuoteRequest,
  ExecuteSwapRequest,
  PlannedTransaction,
  PoolMetadata,
  QuoteSwapRequest,
  TokenInfo,
} from './types.js';
import {
  applySlippageBps,
  atomicAmount,
  checksumAddress,
  decimalRatio,
  decimalAmount,
  hasDeployedCode,
  nonZeroAddress,
  safeIntegerTimestamp,
  stableFlag,
  validateToken,
} from './utils.js';

const DEFAULT_GAS = BigNumber.from('250000');

export class Aerodrome {
  private readonly routerInterface = new Interface(ROUTER_ABI);
  private readonly registryInterface = new Interface(FACTORY_REGISTRY_ABI);
  private readonly factoryInterface = new Interface(POOL_FACTORY_ABI);
  private readonly poolInterface = new Interface(POOL_ABI);
  private readonly erc20Interface = new Interface(ERC20_ABI);
  private readonly quoteCache = new Map<string, CachedQuote>();

  public constructor(
    private readonly provider: AerodromeProvider,
    private readonly config: AerodromeNetworkConfig = aerodromeBaseConfig(),
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  public async quoteSwap(request: QuoteSwapRequest): Promise<AerodromeQuote> {
    await this.assertNetwork();
    const normalized = await this.normalizeQuoteRequest(request);
    await this.assertCoreContracts();

    const amountInAtomic = atomicAmount(normalized.amount, normalized.tokenIn.decimals);
    if (amountInAtomic.isZero()) {
      throw new QuoteError('amount must be greater than zero');
    }

    const route = this.route(normalized.tokenIn, normalized.tokenOut, normalized.poolType);
    const poolAddress = await this.poolFor(route);
    const factoryPool = await this.factoryPool(route);
    if (factoryPool !== poolAddress) {
      throw new PoolValidationError('Router poolFor and PoolFactory getPool disagree');
    }
    await this.validatePool(poolAddress, route);

    const amountOutAtomic = await this.getAmountsOut(amountInAtomic, route);
    if (amountOutAtomic.isZero()) {
      throw new QuoteError('Aerodrome quote returned zero output');
    }

    const slippageBps = normalized.slippageBps ?? this.config.defaultSlippageBps;
    const minAmountOutAtomic = applySlippageBps(amountOutAtomic, slippageBps);
    if (minAmountOutAtomic.isZero()) {
      throw new QuoteError('Aerodrome minimum output is zero');
    }
    const quote: AerodromeQuote = {
      quoteId: crypto.randomUUID(),
      tokenIn: normalized.tokenIn,
      tokenOut: normalized.tokenOut,
      amountIn: decimalAmount(amountInAtomic, normalized.tokenIn.decimals),
      amountOut: decimalAmount(amountOutAtomic, normalized.tokenOut.decimals),
      amountInAtomic,
      amountOutAtomic,
      minAmountOutAtomic,
      minAmountOut: decimalAmount(minAmountOutAtomic, normalized.tokenOut.decimals),
      price: decimalRatio(
        amountOutAtomic,
        normalized.tokenOut.decimals,
        amountInAtomic,
        normalized.tokenIn.decimals,
      ),
      priceImpactPct: null,
      route,
      poolAddress,
      poolType: normalized.poolType,
      expiresAt: this.now() + this.config.defaultTtlSeconds,
    };
    this.quoteCache.set(quote.quoteId, {
      quote: this.freezeQuote(this.cloneQuote(quote)),
      request: this.freezeQuoteRequest(request),
    });
    return this.freezeQuote(this.cloneQuote(quote));
  }

  public async executeSwap(request: ExecuteSwapRequest): Promise<AerodromeExecutionPlan> {
    const walletAddress = nonZeroAddress(request.walletAddress, 'walletAddress');
    const quote = await this.quoteSwap(request);
    return this.executionPlanFromQuote(quote, request, walletAddress);
  }

  public async executeQuote(request: ExecuteQuoteRequest): Promise<AerodromeExecutionPlan> {
    const cached = this.quoteCache.get(request.quoteId);
    if (cached === undefined) {
      throw new QuoteCacheError(`unknown Aerodrome quoteId: ${request.quoteId}`);
    }
    if (cached.quote.expiresAt <= this.now()) {
      this.quoteCache.delete(request.quoteId);
      throw new QuoteCacheError(`expired Aerodrome quoteId: ${request.quoteId}`);
    }

    const walletAddress = nonZeroAddress(request.walletAddress, 'walletAddress');
    const optionalOverrides: { deadline?: number; recipient?: string } = {};
    const recipient = request.recipient ?? cached.request.recipient;
    if (recipient !== undefined) {
      optionalOverrides.recipient = recipient;
    }
    const deadline = request.deadline ?? cached.request.deadline;
    if (deadline !== undefined) {
      optionalOverrides.deadline = deadline;
    }
    const mergedRequest: ExecuteSwapRequest = {
      ...cached.request,
      walletAddress,
      ...optionalOverrides,
    };
    return this.executionPlanFromQuote(cached.quote, mergedRequest, walletAddress);
  }

  public async allowance(owner: string, token: TokenInfo): Promise<BigNumber> {
    const ownerAddress = nonZeroAddress(owner, 'owner');
    const normalizedToken = validateToken(token);
    const encoded = this.erc20Interface.encodeFunctionData('allowance', [
      ownerAddress,
      this.config.contracts.router,
    ]);
    const raw = await this.provider.call({ to: normalizedToken.address, data: encoded });
    try {
      const decoded = this.erc20Interface.decodeFunctionResult('allowance', raw);
      return BigNumber.from(decoded[0]);
    } catch {
      throw new AllowanceError('malformed ERC20 allowance response');
    }
  }

  public async balance(owner: string, token: TokenInfo): Promise<BigNumber> {
    const ownerAddress = nonZeroAddress(owner, 'owner');
    const normalizedToken = validateToken(token);
    const raw = await this.provider.call({
      to: normalizedToken.address,
      data: this.erc20Interface.encodeFunctionData('balanceOf', [ownerAddress]),
    });
    try {
      const decoded = this.erc20Interface.decodeFunctionResult('balanceOf', raw);
      return BigNumber.from(decoded[0]);
    } catch {
      throw new BalanceError('malformed ERC20 balance response');
    }
  }

  public buildApprovalTransaction(
    owner: string,
    token: TokenInfo,
    amount: BigNumber,
  ): PlannedTransaction {
    const ownerAddress = nonZeroAddress(owner, 'owner');
    const normalizedToken = validateToken(token);
    const data = this.erc20Interface.encodeFunctionData('approve', [
      this.config.contracts.router,
      amount,
    ]);
    return {
      to: normalizedToken.address,
      from: ownerAddress,
      data,
      value: '0',
      gasEstimate: DEFAULT_GAS.toString(),
    };
  }

  private async executionPlanFromQuote(
    quote: AerodromeQuote,
    request: ExecuteSwapRequest,
    walletAddress: string,
  ): Promise<AerodromeExecutionPlan> {
    await this.assertNetwork();
    await this.assertCoreContracts();
    await this.validateCachedQuoteRoute(quote);

    const recipient = nonZeroAddress(request.recipient ?? walletAddress, 'recipient');
    const deadline = safeIntegerTimestamp(request.deadline ?? this.now() + 120, 'deadline');
    if (deadline <= this.now()) {
      throw new TransactionPreflightError('deadline must be in the future');
    }
    const currentAmountOut = await this.getAmountsOut(quote.amountInAtomic, quote.route);
    if (currentAmountOut.lt(quote.minAmountOutAtomic)) {
      throw new TransactionPreflightError('current Aerodrome output is below quoted minimum');
    }
    const currentBalance = await this.balance(walletAddress, quote.tokenIn);
    if (currentBalance.lt(quote.amountInAtomic)) {
      throw new BalanceError('wallet balance is below Aerodrome swap amount');
    }
    const currentAllowance = await this.allowance(walletAddress, quote.tokenIn);
    const approval = currentAllowance.lt(quote.amountInAtomic)
      ? this.buildApprovalTransaction(walletAddress, quote.tokenIn, quote.amountInAtomic)
      : undefined;

    const data = this.routerInterface.encodeFunctionData('swapExactTokensForTokens', [
      quote.amountInAtomic,
      quote.minAmountOutAtomic,
      [quote.route],
      recipient,
      deadline,
    ]);
    const transaction = {
      to: this.config.contracts.router,
      from: walletAddress,
      data,
      value: BigNumber.from(0),
    };
    const gasEstimate = await this.provider.estimateGas(transaction);
    return {
      quote,
      ...(approval === undefined ? {} : { approval }),
      swap: {
        ...transaction,
        value: transaction.value.toString(),
        gasEstimate: gasEstimate.toString(),
      },
    };
  }

  private async normalizeQuoteRequest(request: QuoteSwapRequest): Promise<{
    readonly tokenIn: TokenInfo;
    readonly tokenOut: TokenInfo;
    readonly amount: string;
    readonly poolType: QuoteSwapRequest['poolType'];
    readonly slippageBps?: number;
  }> {
    if (request.side !== 'SELL') {
      throw new QuoteError('Aerodrome basic Router MVP supports SELL exact-input swaps only');
    }
    const baseToken = await this.resolveToken(request.baseToken);
    const quoteToken = await this.resolveToken(request.quoteToken);
    if (baseToken.address === quoteToken.address) {
      throw new QuoteError('Aerodrome swap tokens must be different');
    }
    const normalized: {
      readonly tokenIn: TokenInfo;
      readonly tokenOut: TokenInfo;
      readonly amount: string;
      readonly poolType: QuoteSwapRequest['poolType'];
      readonly slippageBps?: number;
    } = {
      tokenIn: baseToken,
      tokenOut: quoteToken,
      amount: request.amount,
      poolType: request.poolType,
    };
    if (request.slippageBps === undefined) {
      return normalized;
    }
    return { ...normalized, slippageBps: request.slippageBps };
  }

  private route(
    tokenIn: TokenInfo,
    tokenOut: TokenInfo,
    poolType: QuoteSwapRequest['poolType'],
  ): AerodromeRoute {
    return {
      from: tokenIn.address,
      to: tokenOut.address,
      stable: stableFlag(poolType),
      factory: this.config.contracts.poolFactory,
    };
  }

  private async assertNetwork(): Promise<void> {
    const network = await this.provider.getNetwork();
    if (network.chainId !== this.config.chainId) {
      throw new UnsupportedNetworkError(
        `expected chainId ${this.config.chainId}, provider returned ${network.chainId}`,
      );
    }
  }

  private async assertCoreContracts(): Promise<void> {
    await Promise.all([
      this.assertContractCode(this.config.contracts.router, 'Aerodrome Router'),
      this.assertContractCode(this.config.contracts.poolFactory, 'Aerodrome PoolFactory'),
      this.assertContractCode(this.config.contracts.factoryRegistry, 'Aerodrome FactoryRegistry'),
    ]);

    const defaultFactory = await this.routerAddress('defaultFactory');
    if (defaultFactory !== this.config.contracts.poolFactory) {
      throw new PoolValidationError('configured PoolFactory does not match Router defaultFactory');
    }
    const registry = await this.routerAddress('factoryRegistry');
    if (registry !== this.config.contracts.factoryRegistry) {
      throw new PoolValidationError(
        'configured FactoryRegistry does not match Router factoryRegistry',
      );
    }
    const approved = await this.factoryApproved(this.config.contracts.poolFactory);
    if (!approved) {
      throw new PoolValidationError('configured PoolFactory is not approved by FactoryRegistry');
    }
  }

  private async assertContractCode(address: string, label: string): Promise<void> {
    const code = await this.provider.getCode(checksumAddress(address, label));
    if (!hasDeployedCode(code)) {
      throw new PoolValidationError(`${label} has no deployed code`);
    }
  }

  private async routerAddress(functionName: 'defaultFactory' | 'factoryRegistry'): Promise<string> {
    const raw = await this.provider.call({
      to: this.config.contracts.router,
      data: this.routerInterface.encodeFunctionData(functionName, []),
    });
    try {
      const decoded = this.routerInterface.decodeFunctionResult(functionName, raw);
      return getAddress(String(decoded[0]));
    } catch {
      throw new PoolValidationError(`malformed Aerodrome Router ${functionName} response`);
    }
  }

  private async factoryApproved(factory: string): Promise<boolean> {
    const raw = await this.provider.call({
      to: this.config.contracts.factoryRegistry,
      data: this.registryInterface.encodeFunctionData('isPoolFactoryApproved', [factory]),
    });
    try {
      const decoded = this.registryInterface.decodeFunctionResult('isPoolFactoryApproved', raw);
      return Boolean(decoded[0]);
    } catch {
      throw new PoolValidationError('malformed Aerodrome FactoryRegistry response');
    }
  }

  private async poolFor(route: AerodromeRoute): Promise<string> {
    const raw = await this.provider.call({
      to: this.config.contracts.router,
      data: this.routerInterface.encodeFunctionData('poolFor', [
        route.from,
        route.to,
        route.stable,
        route.factory,
      ]),
    });
    try {
      const decoded = this.routerInterface.decodeFunctionResult('poolFor', raw);
      return nonZeroAddress(String(decoded[0]), 'pool');
    } catch {
      throw new PoolValidationError('malformed Aerodrome Router poolFor response');
    }
  }

  private async factoryPool(route: AerodromeRoute): Promise<string> {
    const raw = await this.provider.call({
      to: this.config.contracts.poolFactory,
      data: this.factoryInterface.encodeFunctionData('getPool', [
        route.from,
        route.to,
        route.stable,
      ]),
    });
    try {
      const decoded = this.factoryInterface.decodeFunctionResult('getPool', raw);
      return nonZeroAddress(String(decoded[0]), 'pool');
    } catch {
      throw new PoolValidationError('malformed Aerodrome PoolFactory getPool response');
    }
  }

  private async validatePool(poolAddress: string, route: AerodromeRoute): Promise<PoolMetadata> {
    await this.assertContractCode(poolAddress, 'Aerodrome Pool');

    const isPool = await this.isPool(poolAddress);
    if (!isPool) {
      throw new PoolValidationError('PoolFactory does not recognize route pool');
    }

    const metadata = await this.poolMetadata(poolAddress);
    if (metadata.stable !== route.stable) {
      throw new PoolValidationError('pool stable flag does not match route');
    }
    if (metadata.reserve0.isZero() || metadata.reserve1.isZero()) {
      throw new PoolValidationError('pool has no liquidity');
    }
    const expected = new Set([route.from.toLowerCase(), route.to.toLowerCase()]);
    const actual = new Set([metadata.token0.toLowerCase(), metadata.token1.toLowerCase()]);
    if (expected.size !== actual.size || [...expected].some((token) => !actual.has(token))) {
      throw new PoolValidationError('pool tokens do not match route tokens');
    }
    return metadata;
  }

  private async isPool(poolAddress: string): Promise<boolean> {
    const raw = await this.provider.call({
      to: this.config.contracts.poolFactory,
      data: this.factoryInterface.encodeFunctionData('isPool', [poolAddress]),
    });
    try {
      const decoded = this.factoryInterface.decodeFunctionResult('isPool', raw);
      return Boolean(decoded[0]);
    } catch {
      throw new PoolValidationError('malformed Aerodrome PoolFactory isPool response');
    }
  }

  private async poolMetadata(poolAddress: string): Promise<PoolMetadata> {
    const raw = await this.provider.call({
      to: poolAddress,
      data: this.poolInterface.encodeFunctionData('metadata', []),
    });
    try {
      const decoded = this.poolInterface.decodeFunctionResult('metadata', raw);
      return {
        decimals0: BigNumber.from(decoded[0]),
        decimals1: BigNumber.from(decoded[1]),
        reserve0: BigNumber.from(decoded[2]),
        reserve1: BigNumber.from(decoded[3]),
        stable: Boolean(decoded[4]),
        token0: getAddress(String(decoded[5])),
        token1: getAddress(String(decoded[6])),
      };
    } catch {
      throw new PoolValidationError('malformed Aerodrome Pool metadata response');
    }
  }

  private async getAmountsOut(amountIn: BigNumber, route: AerodromeRoute): Promise<BigNumber> {
    const raw = await this.provider.call({
      to: this.config.contracts.router,
      data: this.routerInterface.encodeFunctionData('getAmountsOut', [amountIn, [route]]),
    });
    try {
      const decoded = this.routerInterface.decodeFunctionResult('getAmountsOut', raw);
      const amounts = decoded[0] as readonly BigNumber[];
      const amountOut = amounts[1];
      if (amountOut === undefined) {
        throw new QuoteError('Aerodrome Router returned malformed amounts');
      }
      return BigNumber.from(amountOut);
    } catch (error) {
      if (error instanceof QuoteError) {
        throw error;
      }
      throw new QuoteError('Aerodrome Router returned malformed amounts');
    }
  }

  private async resolveToken(token: TokenInfo): Promise<TokenInfo> {
    const normalized = validateToken(token);
    await this.assertContractCode(normalized.address, `${normalized.symbol} token`);
    const raw = await this.provider.call({
      to: normalized.address,
      data: this.erc20Interface.encodeFunctionData('decimals', []),
    });
    try {
      const decoded = this.erc20Interface.decodeFunctionResult('decimals', raw);
      const onChainDecimals = Number(decoded[0]);
      if (onChainDecimals !== normalized.decimals) {
        throw new UnsupportedTokenError(`token decimals mismatch for ${normalized.symbol}`);
      }
      return normalized;
    } catch (error) {
      if (error instanceof UnsupportedTokenError) {
        throw error;
      }
      throw new PoolValidationError(`malformed ERC20 decimals response for ${normalized.symbol}`);
    }
  }

  private async validateCachedQuoteRoute(quote: AerodromeQuote): Promise<void> {
    const poolAddress = await this.poolFor(quote.route);
    const factoryPool = await this.factoryPool(quote.route);
    if (poolAddress !== quote.poolAddress || factoryPool !== quote.poolAddress) {
      throw new PoolValidationError('cached Aerodrome quote pool no longer matches route');
    }
    await this.validatePool(quote.poolAddress, quote.route);
  }

  private cloneQuote(quote: AerodromeQuote): AerodromeQuote {
    return {
      ...quote,
      tokenIn: { ...quote.tokenIn },
      tokenOut: { ...quote.tokenOut },
      route: { ...quote.route },
    };
  }

  private freezeQuote(quote: AerodromeQuote): AerodromeQuote {
    Object.freeze(quote.tokenIn);
    Object.freeze(quote.tokenOut);
    Object.freeze(quote.route);
    return Object.freeze(quote);
  }

  private freezeQuoteRequest(request: QuoteSwapRequest): QuoteSwapRequest {
    const clone: QuoteSwapRequest = {
      ...request,
      baseToken: { ...request.baseToken },
      quoteToken: { ...request.quoteToken },
    };
    Object.freeze(clone.baseToken);
    Object.freeze(clone.quoteToken);
    return Object.freeze(clone);
  }
}
