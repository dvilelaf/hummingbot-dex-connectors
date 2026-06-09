import { Interface } from '@ethersproject/abi';
import { getAddress } from '@ethersproject/address';
import { BigNumber } from '@ethersproject/bignumber';

import { BASE_MAINNET, aerodromeBaseConfig } from '../config.js';
import { ERC20_ABI } from '../contracts.js';
import {
  AllowanceError,
  BalanceError,
  QuoteError,
  SlipstreamConfigError,
  TransactionPreflightError,
  UnsupportedNetworkError,
  UnsupportedTokenError,
} from '../errors.js';
import type {
  AerodromeNetworkConfig,
  AerodromeProvider,
  PlannedTransaction,
  TokenInfo,
} from '../types.js';
import {
  applySlippageBps,
  atomicAmount,
  checksumAddress,
  decimalAmount,
  decimalRatio,
  hasDeployedCode,
  isNativeEth,
  nonZeroAddress,
  safeIntegerTimestamp,
  validateToken,
} from '../utils.js';
import { SLIPSTREAM_QUOTER_ABI, SLIPSTREAM_ROUTER_ABI } from './contracts.js';
import type {
  SlipstreamExecuteSwapRequest,
  SlipstreamExecutionPlan,
  SlipstreamQuote,
  SlipstreamQuoteSwapRequest,
  SlipstreamRouteLeg,
} from './types.js';

const DEFAULT_GAS = BigNumber.from('250000');
const MAX_POSITIVE_INT24 = 0x7fffff;

interface NormalizedSlipstreamContracts {
  readonly router: string;
  readonly quoter: string;
  readonly poolFactory: string;
}

export class AerodromeSlipstream {
  private readonly routerInterface = new Interface(SLIPSTREAM_ROUTER_ABI);
  private readonly quoterInterface = new Interface(SLIPSTREAM_QUOTER_ABI);
  private readonly erc20Interface = new Interface(ERC20_ABI);

  public constructor(
    private readonly provider: AerodromeProvider,
    private readonly config: AerodromeNetworkConfig = aerodromeBaseConfig(),
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  public async quoteSwap(request: SlipstreamQuoteSwapRequest): Promise<SlipstreamQuote> {
    const contracts = this.slipstreamContracts();
    await this.assertNetwork();
    await this.assertSlipstreamContracts(contracts);

    const normalized = await this.normalizeQuoteRequest(request);
    const amountInAtomic = atomicAmount(normalized.amount, normalized.tokenIn.decimals);
    if (amountInAtomic.isZero()) {
      throw new QuoteError('amount must be greater than zero');
    }

    const amountOutAtomic = await this.quoteExactInput(
      contracts,
      normalized.route,
      normalized.encodedPath,
      amountInAtomic,
    );
    if (amountOutAtomic.isZero()) {
      throw new QuoteError('Aerodrome Slipstream quote returned zero output');
    }

    const slippageBps = normalized.slippageBps ?? this.config.defaultSlippageBps;
    const minAmountOutAtomic = applySlippageBps(amountOutAtomic, slippageBps);
    if (minAmountOutAtomic.isZero()) {
      throw new QuoteError('Aerodrome Slipstream minimum output is zero');
    }

    return this.freezeQuote({
      quoteId: crypto.randomUUID(),
      tokenIn: normalized.tokenIn,
      tokenOut: normalized.tokenOut,
      amountIn: decimalAmount(amountInAtomic, normalized.tokenIn.decimals),
      amountOut: decimalAmount(amountOutAtomic, normalized.tokenOut.decimals),
      amountInAtomic,
      amountOutAtomic,
      minAmountOut: decimalAmount(minAmountOutAtomic, normalized.tokenOut.decimals),
      minAmountOutAtomic,
      price: decimalRatio(
        amountOutAtomic,
        normalized.tokenOut.decimals,
        amountInAtomic,
        normalized.tokenIn.decimals,
      ),
      priceImpactPct: null,
      route: normalized.route,
      encodedPath: normalized.encodedPath,
      router: contracts.router,
      quoter: contracts.quoter,
      expiresAt: this.now() + this.config.defaultTtlSeconds,
    });
  }

  public async executeSwap(
    request: SlipstreamExecuteSwapRequest,
  ): Promise<SlipstreamExecutionPlan> {
    const walletAddress = nonZeroAddress(request.walletAddress, 'walletAddress');
    const quote = await this.quoteSwap(request);
    const recipient = nonZeroAddress(request.recipient ?? walletAddress, 'recipient');
    const deadline = safeIntegerTimestamp(request.deadline ?? this.now() + 120, 'deadline');
    if (deadline <= this.now()) {
      throw new TransactionPreflightError('deadline must be in the future');
    }

    const currentBalance = await this.balance(walletAddress, quote.tokenIn);
    if (currentBalance.lt(quote.amountInAtomic)) {
      throw new BalanceError('wallet balance is below Aerodrome Slipstream swap amount');
    }
    const approval = await this.approvalForSwap(walletAddress, quote);
    const data = this.swapCalldata(quote, recipient, deadline);
    const transaction = {
      to: quote.router,
      from: walletAddress,
      data,
      value: BigNumber.from(0),
    };
    const gasEstimate = approval === undefined ? await this.estimateGas(transaction) : DEFAULT_GAS;
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

  public buildApprovalTransaction(
    owner: string,
    token: TokenInfo,
    amount: BigNumber,
  ): PlannedTransaction {
    const ownerAddress = nonZeroAddress(owner, 'owner');
    const normalizedToken = this.requireErc20Token(validateToken(token));
    const contracts = this.slipstreamContracts();
    this.assertOfficialBaseSlipstreamContracts(contracts);
    const data = this.erc20Interface.encodeFunctionData('approve', [contracts.router, amount]);
    return {
      to: normalizedToken.address,
      from: ownerAddress,
      data,
      value: '0',
      gasEstimate: DEFAULT_GAS.toString(),
    };
  }

  public async allowance(owner: string, token: TokenInfo): Promise<BigNumber> {
    const ownerAddress = nonZeroAddress(owner, 'owner');
    const normalizedToken = this.requireErc20Token(validateToken(token));
    const raw = await this.provider.call({
      to: normalizedToken.address,
      data: this.erc20Interface.encodeFunctionData('allowance', [
        ownerAddress,
        this.slipstreamContracts().router,
      ]),
    });
    try {
      const decoded = this.erc20Interface.decodeFunctionResult('allowance', raw);
      return BigNumber.from(decoded[0]);
    } catch {
      throw new AllowanceError('malformed ERC20 allowance response');
    }
  }

  public async balance(owner: string, token: TokenInfo): Promise<BigNumber> {
    const ownerAddress = nonZeroAddress(owner, 'owner');
    const normalizedToken = this.requireErc20Token(validateToken(token));
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

  private async normalizeQuoteRequest(request: SlipstreamQuoteSwapRequest): Promise<{
    readonly tokenIn: TokenInfo;
    readonly tokenOut: TokenInfo;
    readonly amount: string;
    readonly route: readonly SlipstreamRouteLeg[];
    readonly encodedPath: string;
    readonly slippageBps?: number;
  }> {
    if (request.side !== 'SELL') {
      throw new QuoteError('Aerodrome Slipstream supports SELL exact-input swaps only');
    }

    const tokenIn = await this.resolveToken(request.baseToken);
    const tokenOut = await this.resolveToken(request.quoteToken);
    if (tokenIn.address === tokenOut.address) {
      throw new QuoteError('Aerodrome Slipstream swap tokens must be different');
    }
    if (request.route.length === 0) {
      throw new TransactionPreflightError('Aerodrome Slipstream route must have at least one hop');
    }

    const route: SlipstreamRouteLeg[] = [];
    let currentToken = tokenIn;
    for (const hop of request.route) {
      const nextToken = await this.resolveToken(hop.tokenOut);
      if (currentToken.address === nextToken.address) {
        throw new QuoteError('Aerodrome Slipstream route hop tokens must be different');
      }
      route.push({
        tokenIn: currentToken,
        tokenOut: nextToken,
        tickSpacing: this.tickSpacing(hop.tickSpacing),
      });
      currentToken = nextToken;
    }

    if (currentToken.address !== tokenOut.address) {
      throw new QuoteError('Aerodrome Slipstream route must end at quoteToken');
    }

    const normalized: {
      readonly tokenIn: TokenInfo;
      readonly tokenOut: TokenInfo;
      readonly amount: string;
      readonly route: readonly SlipstreamRouteLeg[];
      readonly encodedPath: string;
      readonly slippageBps?: number;
    } = {
      tokenIn,
      tokenOut,
      amount: request.amount,
      route,
      encodedPath: encodeSlipstreamPath(tokenIn, route),
    };
    if (request.slippageBps === undefined) {
      return normalized;
    }
    return { ...normalized, slippageBps: request.slippageBps };
  }

  private async resolveToken(token: TokenInfo): Promise<TokenInfo> {
    const normalized = this.requireErc20Token(validateToken(token));
    await this.assertTokenCode(normalized);
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
      throw new QuoteError(`malformed ERC20 decimals response for ${normalized.symbol}`);
    }
  }

  private requireErc20Token(token: TokenInfo): TokenInfo {
    if (isNativeEth(token)) {
      throw new UnsupportedTokenError('Aerodrome Slipstream swaps require ERC20 token addresses');
    }
    return token;
  }

  private async quoteExactInput(
    contracts: NormalizedSlipstreamContracts,
    route: readonly SlipstreamRouteLeg[],
    encodedPath: string,
    amountIn: BigNumber,
  ): Promise<BigNumber> {
    const onlyHop = route[0];
    const data =
      route.length === 1 && onlyHop !== undefined
        ? this.quoterInterface.encodeFunctionData('quoteExactInputSingle', [
            {
              tokenIn: onlyHop.tokenIn.address,
              tokenOut: onlyHop.tokenOut.address,
              amountIn,
              tickSpacing: onlyHop.tickSpacing,
              sqrtPriceLimitX96: 0,
            },
          ])
        : this.quoterInterface.encodeFunctionData('quoteExactInput', [encodedPath, amountIn]);
    const functionName = route.length === 1 ? 'quoteExactInputSingle' : 'quoteExactInput';
    try {
      const raw = await this.provider.call({ to: contracts.quoter, data });
      const decoded = this.quoterInterface.decodeFunctionResult(functionName, raw);
      return BigNumber.from(decoded[0]);
    } catch {
      throw new QuoteError(
        'Aerodrome Slipstream Quoter quote call failed or returned malformed data',
      );
    }
  }

  private async approvalForSwap(
    walletAddress: string,
    quote: SlipstreamQuote,
  ): Promise<PlannedTransaction | undefined> {
    const currentAllowance = await this.allowance(walletAddress, quote.tokenIn);
    return currentAllowance.lt(quote.amountInAtomic)
      ? this.buildApprovalTransaction(walletAddress, quote.tokenIn, quote.amountInAtomic)
      : undefined;
  }

  private swapCalldata(quote: SlipstreamQuote, recipient: string, deadline: number): string {
    const onlyHop = quote.route[0];
    if (quote.route.length === 1 && onlyHop !== undefined) {
      return this.routerInterface.encodeFunctionData('exactInputSingle', [
        {
          tokenIn: onlyHop.tokenIn.address,
          tokenOut: onlyHop.tokenOut.address,
          tickSpacing: onlyHop.tickSpacing,
          recipient,
          deadline,
          amountIn: quote.amountInAtomic,
          amountOutMinimum: quote.minAmountOutAtomic,
          sqrtPriceLimitX96: 0,
        },
      ]);
    }
    return this.routerInterface.encodeFunctionData('exactInput', [
      {
        path: quote.encodedPath,
        recipient,
        deadline,
        amountIn: quote.amountInAtomic,
        amountOutMinimum: quote.minAmountOutAtomic,
      },
    ]);
  }

  private slipstreamContracts(): NormalizedSlipstreamContracts {
    const contracts = this.config.contracts.slipstream;
    if (contracts === undefined) {
      throw new SlipstreamConfigError('Aerodrome Slipstream router and quoter are not configured');
    }
    try {
      return {
        router: nonZeroAddress(contracts.router, 'Aerodrome Slipstream Router'),
        quoter: nonZeroAddress(contracts.quoter, 'Aerodrome Slipstream Quoter'),
        poolFactory: nonZeroAddress(
          contracts.poolFactory ?? '',
          'Aerodrome Slipstream PoolFactory',
        ),
      };
    } catch (error) {
      if (error instanceof TransactionPreflightError) {
        throw new SlipstreamConfigError(error.message);
      }
      throw error;
    }
  }

  private async assertNetwork(): Promise<void> {
    const network = await this.provider.getNetwork();
    if (network.chainId !== this.config.chainId) {
      throw new UnsupportedNetworkError(
        `expected chainId ${this.config.chainId}, provider returned ${network.chainId}`,
      );
    }
  }

  private async assertSlipstreamContracts(contracts: NormalizedSlipstreamContracts): Promise<void> {
    this.assertOfficialBaseSlipstreamContracts(contracts);
    await Promise.all([
      this.assertContractCode(contracts.router, 'Aerodrome Slipstream Router'),
      this.assertContractCode(contracts.quoter, 'Aerodrome Slipstream Quoter'),
      this.assertContractCode(contracts.poolFactory, 'Aerodrome Slipstream PoolFactory'),
    ]);
  }

  private assertOfficialBaseSlipstreamContracts(contracts: NormalizedSlipstreamContracts): void {
    if (this.config.chainId !== BASE_MAINNET.chainId) {
      return;
    }
    const officialContracts = BASE_MAINNET.contracts.slipstream;
    if (
      officialContracts === undefined ||
      contracts.router !== officialContracts.router ||
      contracts.quoter !== officialContracts.quoter ||
      contracts.poolFactory !== officialContracts.poolFactory
    ) {
      throw new SlipstreamConfigError(
        'Aerodrome Slipstream Base config must use official contracts',
      );
    }
  }

  private async estimateGas(transaction: {
    readonly to: string;
    readonly from: string;
    readonly data: string;
    readonly value: BigNumber;
  }): Promise<BigNumber> {
    try {
      return await this.provider.estimateGas(transaction);
    } catch {
      throw new TransactionPreflightError('Aerodrome Slipstream swap gas estimation failed');
    }
  }

  private async assertContractCode(address: string, label: string): Promise<void> {
    const code = await this.provider.getCode(checksumAddress(address, label));
    if (!hasDeployedCode(code)) {
      throw new SlipstreamConfigError(`${label} has no deployed code`);
    }
  }

  private async assertTokenCode(token: TokenInfo): Promise<void> {
    const code = await this.provider.getCode(token.address);
    if (!hasDeployedCode(code)) {
      throw new UnsupportedTokenError(`${token.symbol} token has no deployed code`);
    }
  }

  private tickSpacing(value: number): number {
    if (!Number.isInteger(value) || value <= 0 || value > MAX_POSITIVE_INT24) {
      throw new TransactionPreflightError('tickSpacing must be a positive int24 integer');
    }
    return value;
  }

  private freezeQuote(quote: SlipstreamQuote): SlipstreamQuote {
    Object.freeze(quote.tokenIn);
    Object.freeze(quote.tokenOut);
    for (const leg of quote.route) {
      Object.freeze(leg.tokenIn);
      Object.freeze(leg.tokenOut);
      Object.freeze(leg);
    }
    Object.freeze(quote.route);
    return Object.freeze(quote);
  }
}

function encodeSlipstreamPath(tokenIn: TokenInfo, route: readonly SlipstreamRouteLeg[]): string {
  const parts = [addressHex(tokenIn.address)];
  for (const leg of route) {
    parts.push(tickSpacingHex(leg.tickSpacing), addressHex(leg.tokenOut.address));
  }
  return `0x${parts.join('')}`;
}

function addressHex(address: string): string {
  return getAddress(address).slice(2).toLowerCase();
}

function tickSpacingHex(tickSpacing: number): string {
  return tickSpacing.toString(16).padStart(6, '0');
}
