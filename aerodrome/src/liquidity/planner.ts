import { Interface } from '@ethersproject/abi';
import { getAddress } from '@ethersproject/address';
import { BigNumber } from '@ethersproject/bignumber';

import { BASE_MAINNET, aerodromeBaseConfig } from '../config.js';
import {
  ERC20_ABI,
  FACTORY_REGISTRY_ABI,
  POOL_ABI,
  POOL_FACTORY_ABI,
  ROUTER_ABI,
} from '../contracts.js';
import {
  AllowanceError,
  BalanceError,
  PoolValidationError,
  TransactionPreflightError,
  UnsupportedNetworkError,
  UnsupportedTokenError,
} from '../errors.js';
import type {
  AerodromeNetworkConfig,
  AerodromeProvider,
  PlannedTransaction,
  PoolMetadata,
  PoolType,
  TokenInfo,
  TransactionRequest,
} from '../types.js';
import {
  applySlippageBps,
  atomicAmount,
  checksumAddress,
  decimalAmount,
  hasDeployedCode,
  isNativeEth,
  nonZeroAddress,
  safeIntegerTimestamp,
  stableFlag,
  validateToken,
} from '../utils.js';
import type {
  AddLiquidityRequest,
  AerodromeLiquidityPlan,
  AerodromeLiquidityQuote,
  RemoveLiquidityRequest,
} from './types.js';

const DEFAULT_GAS = BigNumber.from('250000');
const LP_DECIMALS = 18;

export class AerodromeLiquidityPlanner {
  private readonly routerInterface = new Interface(ROUTER_ABI);
  private readonly registryInterface = new Interface(FACTORY_REGISTRY_ABI);
  private readonly factoryInterface = new Interface(POOL_FACTORY_ABI);
  private readonly poolInterface = new Interface(POOL_ABI);
  private readonly erc20Interface = new Interface(ERC20_ABI);

  public constructor(
    private readonly provider: AerodromeProvider,
    private readonly config: AerodromeNetworkConfig = aerodromeBaseConfig(),
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  public async planAddLiquidity(request: AddLiquidityRequest): Promise<AerodromeLiquidityPlan> {
    const normalized = await this.normalizePair(request);
    const amountADesired = atomicAmount(request.amountA, normalized.tokenA.decimals);
    const amountBDesired = atomicAmount(request.amountB, normalized.tokenB.decimals);
    this.assertNonZero(amountADesired, 'amountA');
    this.assertNonZero(amountBDesired, 'amountB');

    const poolAddress = await this.validatePool(normalized);
    const quoted = await this.quoteAddLiquidity(normalized, amountADesired, amountBDesired);
    this.assertNonZero(quoted.amountA, 'quoted amountA');
    this.assertNonZero(quoted.amountB, 'quoted amountB');
    this.assertNonZero(quoted.liquidity, 'quoted liquidity');
    const slippageBps = request.slippageBps ?? this.config.defaultSlippageBps;
    const amountAMin = applySlippageBps(quoted.amountA, slippageBps);
    const amountBMin = applySlippageBps(quoted.amountB, slippageBps);
    this.assertNonZero(amountAMin, 'amountAMin');
    this.assertNonZero(amountBMin, 'amountBMin');

    const walletAddress = nonZeroAddress(request.walletAddress, 'walletAddress');
    const recipient = nonZeroAddress(request.recipient ?? walletAddress, 'recipient');
    const deadline = this.futureDeadline(request.deadline);
    await Promise.all([
      this.assertBalance(walletAddress, normalized.tokenA, amountADesired, 'amountA'),
      this.assertBalance(walletAddress, normalized.tokenB, amountBDesired, 'amountB'),
    ]);
    const approvals = await this.addApprovals(
      walletAddress,
      normalized.tokenA,
      normalized.tokenB,
      amountADesired,
      amountBDesired,
    );
    const transaction = await this.planTransaction(
      walletAddress,
      this.addCalldata(
        normalized,
        amountADesired,
        amountBDesired,
        amountAMin,
        amountBMin,
        recipient,
        deadline,
      ),
      this.addValue(normalized, amountADesired, amountBDesired),
      approvals.length > 0,
    );

    return {
      quote: this.liquidityQuote(
        normalized,
        poolAddress,
        quoted.amountA,
        quoted.amountB,
        amountAMin,
        amountBMin,
        quoted.liquidity,
      ),
      approvals,
      transaction,
    };
  }

  public async planRemoveLiquidity(
    request: RemoveLiquidityRequest,
  ): Promise<AerodromeLiquidityPlan> {
    const normalized = await this.normalizePair(request);
    const liquidity = atomicAmount(request.liquidity, LP_DECIMALS);
    this.assertNonZero(liquidity, 'liquidity');

    const poolAddress = await this.validatePool(normalized);
    const quoted = await this.quoteRemoveLiquidity(normalized, liquidity);
    this.assertNonZero(quoted.amountA, 'quoted amountA');
    this.assertNonZero(quoted.amountB, 'quoted amountB');
    const slippageBps = request.slippageBps ?? this.config.defaultSlippageBps;
    const amountAMin = applySlippageBps(quoted.amountA, slippageBps);
    const amountBMin = applySlippageBps(quoted.amountB, slippageBps);
    this.assertNonZero(amountAMin, 'amountAMin');
    this.assertNonZero(amountBMin, 'amountBMin');

    const walletAddress = nonZeroAddress(request.walletAddress, 'walletAddress');
    const recipient = nonZeroAddress(request.recipient ?? walletAddress, 'recipient');
    const deadline = this.futureDeadline(request.deadline);
    await this.assertErc20Balance(walletAddress, poolAddress, liquidity, 'liquidity');
    const approval = await this.approvalForAddress(walletAddress, poolAddress, liquidity);
    const transaction = await this.planTransaction(
      walletAddress,
      this.removeCalldata(normalized, liquidity, amountAMin, amountBMin, recipient, deadline),
      BigNumber.from(0),
      approval !== undefined,
    );

    return {
      quote: this.liquidityQuote(
        normalized,
        poolAddress,
        quoted.amountA,
        quoted.amountB,
        amountAMin,
        amountBMin,
        liquidity,
      ),
      approvals: approval === undefined ? [] : [approval],
      transaction,
    };
  }

  private async normalizePair(request: {
    readonly tokenA: TokenInfo;
    readonly tokenB: TokenInfo;
    readonly poolType: PoolType;
  }): Promise<NormalizedPair> {
    await this.assertNetwork();
    this.assertOfficialBaseCoreContracts();
    const stable = stableFlag(request.poolType);
    const tokenA = await this.resolveToken(request.tokenA);
    const tokenB = await this.resolveToken(request.tokenB);
    if (tokenA.address === tokenB.address) {
      throw new TransactionPreflightError('Aerodrome liquidity tokens must be different');
    }
    const routeTokenA = await this.routeToken(tokenA);
    const routeTokenB = await this.routeToken(tokenB);
    if (routeTokenA.address === routeTokenB.address) {
      throw new TransactionPreflightError('Aerodrome liquidity route tokens must be different');
    }
    await this.assertCoreContracts();
    return {
      tokenA,
      tokenB,
      routeTokenA,
      routeTokenB,
      poolType: request.poolType,
      stable,
    };
  }

  private async validatePool(pair: NormalizedPair): Promise<string> {
    const poolAddress = await this.poolFor(pair);
    const factoryPool = await this.factoryPool(pair);
    if (factoryPool !== poolAddress) {
      throw new PoolValidationError('Router poolFor and PoolFactory getPool disagree');
    }
    await this.assertContractCode(poolAddress, 'Aerodrome Pool');
    const isPool = await this.isPool(poolAddress);
    if (!isPool) {
      throw new PoolValidationError('PoolFactory does not recognize liquidity pool');
    }
    const metadata = await this.poolMetadata(poolAddress);
    if (metadata.stable !== pair.stable) {
      throw new PoolValidationError('pool stable flag does not match liquidity request');
    }
    const expected = new Set([
      pair.routeTokenA.address.toLowerCase(),
      pair.routeTokenB.address.toLowerCase(),
    ]);
    const actual = new Set([metadata.token0.toLowerCase(), metadata.token1.toLowerCase()]);
    if (expected.size !== actual.size || [...expected].some((token) => !actual.has(token))) {
      throw new PoolValidationError('pool tokens do not match liquidity request');
    }
    return poolAddress;
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
    this.assertOfficialBaseCoreContracts();
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

  private assertOfficialBaseCoreContracts(): void {
    if (this.config.chainId !== BASE_MAINNET.chainId) {
      return;
    }
    if (
      this.config.contracts.router !== BASE_MAINNET.contracts.router ||
      this.config.contracts.poolFactory !== BASE_MAINNET.contracts.poolFactory ||
      this.config.contracts.factoryRegistry !== BASE_MAINNET.contracts.factoryRegistry
    ) {
      throw new PoolValidationError('Aerodrome Base core config must use official contracts');
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

  private async poolFor(pair: NormalizedPair): Promise<string> {
    const raw = await this.provider.call({
      to: this.config.contracts.router,
      data: this.routerInterface.encodeFunctionData('poolFor', [
        pair.routeTokenA.address,
        pair.routeTokenB.address,
        pair.stable,
        this.config.contracts.poolFactory,
      ]),
    });
    try {
      const decoded = this.routerInterface.decodeFunctionResult('poolFor', raw);
      return nonZeroAddress(String(decoded[0]), 'pool');
    } catch {
      throw new PoolValidationError('malformed Aerodrome Router poolFor response');
    }
  }

  private async factoryPool(pair: NormalizedPair): Promise<string> {
    const raw = await this.provider.call({
      to: this.config.contracts.poolFactory,
      data: this.factoryInterface.encodeFunctionData('getPool', [
        pair.routeTokenA.address,
        pair.routeTokenB.address,
        pair.stable,
      ]),
    });
    try {
      const decoded = this.factoryInterface.decodeFunctionResult('getPool', raw);
      return nonZeroAddress(String(decoded[0]), 'pool');
    } catch {
      throw new PoolValidationError('malformed Aerodrome PoolFactory getPool response');
    }
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

  private async resolveToken(token: TokenInfo): Promise<TokenInfo> {
    const normalized = validateToken(token);
    if (isNativeEth(normalized)) {
      if (normalized.decimals !== 18) {
        throw new UnsupportedTokenError('native ETH must use 18 decimals');
      }
      return normalized;
    }
    await this.assertContractCode(normalized.address, `${normalized.symbol} token`);
    const raw = await this.provider.call({
      to: normalized.address,
      data: this.erc20Interface.encodeFunctionData('decimals', []),
    });
    try {
      const decoded = this.erc20Interface.decodeFunctionResult('decimals', raw);
      const onChainDecimals = Number(decoded[0]);
      if (onChainDecimals !== normalized.decimals) {
        throw new PoolValidationError(`token decimals mismatch for ${normalized.symbol}`);
      }
      return normalized;
    } catch (error) {
      if (error instanceof PoolValidationError) {
        throw error;
      }
      throw new PoolValidationError(`malformed ERC20 decimals response for ${normalized.symbol}`);
    }
  }

  private async routeToken(token: TokenInfo): Promise<TokenInfo> {
    if (!isNativeEth(token)) {
      return token;
    }
    return this.resolveToken({
      symbol: 'WETH',
      address: this.config.contracts.weth,
      decimals: 18,
    });
  }

  private async quoteAddLiquidity(
    pair: NormalizedPair,
    amountADesired: BigNumber,
    amountBDesired: BigNumber,
  ): Promise<{
    readonly amountA: BigNumber;
    readonly amountB: BigNumber;
    readonly liquidity: BigNumber;
  }> {
    const raw = await this.provider.call({
      to: this.config.contracts.router,
      data: this.routerInterface.encodeFunctionData('quoteAddLiquidity', [
        pair.routeTokenA.address,
        pair.routeTokenB.address,
        pair.stable,
        this.config.contracts.poolFactory,
        amountADesired,
        amountBDesired,
      ]),
    });
    try {
      const decoded = this.routerInterface.decodeFunctionResult('quoteAddLiquidity', raw);
      return {
        amountA: BigNumber.from(decoded[0]),
        amountB: BigNumber.from(decoded[1]),
        liquidity: BigNumber.from(decoded[2]),
      };
    } catch {
      throw new PoolValidationError('malformed Aerodrome Router quoteAddLiquidity response');
    }
  }

  private async quoteRemoveLiquidity(
    pair: NormalizedPair,
    liquidity: BigNumber,
  ): Promise<{ readonly amountA: BigNumber; readonly amountB: BigNumber }> {
    const raw = await this.provider.call({
      to: this.config.contracts.router,
      data: this.routerInterface.encodeFunctionData('quoteRemoveLiquidity', [
        pair.routeTokenA.address,
        pair.routeTokenB.address,
        pair.stable,
        this.config.contracts.poolFactory,
        liquidity,
      ]),
    });
    try {
      const decoded = this.routerInterface.decodeFunctionResult('quoteRemoveLiquidity', raw);
      return {
        amountA: BigNumber.from(decoded[0]),
        amountB: BigNumber.from(decoded[1]),
      };
    } catch {
      throw new PoolValidationError('malformed Aerodrome Router quoteRemoveLiquidity response');
    }
  }

  private async addApprovals(
    walletAddress: string,
    tokenA: TokenInfo,
    tokenB: TokenInfo,
    amountA: BigNumber,
    amountB: BigNumber,
  ): Promise<readonly PlannedTransaction[]> {
    const approvals = await Promise.all([
      isNativeEth(tokenA)
        ? Promise.resolve(undefined)
        : this.approvalForToken(walletAddress, tokenA, amountA),
      isNativeEth(tokenB)
        ? Promise.resolve(undefined)
        : this.approvalForToken(walletAddress, tokenB, amountB),
    ]);
    return approvals.filter((approval): approval is PlannedTransaction => approval !== undefined);
  }

  private async approvalForToken(
    owner: string,
    token: TokenInfo,
    amount: BigNumber,
  ): Promise<PlannedTransaction | undefined> {
    return this.approvalForAddress(owner, token.address, amount);
  }

  private async approvalForAddress(
    owner: string,
    tokenAddress: string,
    amount: BigNumber,
  ): Promise<PlannedTransaction | undefined> {
    const currentAllowance = await this.allowance(owner, tokenAddress);
    return currentAllowance.lt(amount)
      ? this.buildApprovalTransaction(owner, tokenAddress, amount)
      : undefined;
  }

  private async allowance(owner: string, tokenAddress: string): Promise<BigNumber> {
    const ownerAddress = nonZeroAddress(owner, 'owner');
    const token = nonZeroAddress(tokenAddress, 'token');
    const raw = await this.provider.call({
      to: token,
      data: this.erc20Interface.encodeFunctionData('allowance', [
        ownerAddress,
        this.config.contracts.router,
      ]),
    });
    try {
      const decoded = this.erc20Interface.decodeFunctionResult('allowance', raw);
      return BigNumber.from(decoded[0]);
    } catch {
      throw new AllowanceError('malformed ERC20 allowance response');
    }
  }

  private async assertBalance(
    owner: string,
    token: TokenInfo,
    amount: BigNumber,
    label: string,
  ): Promise<void> {
    const balance = isNativeEth(token)
      ? await this.nativeBalance(owner)
      : await this.erc20Balance(owner, token.address);
    if (balance.lt(amount)) {
      throw new BalanceError(`wallet balance is below Aerodrome liquidity ${label}`);
    }
  }

  private async assertErc20Balance(
    owner: string,
    tokenAddress: string,
    amount: BigNumber,
    label: string,
  ): Promise<void> {
    const balance = await this.erc20Balance(owner, tokenAddress);
    if (balance.lt(amount)) {
      throw new BalanceError(`wallet balance is below Aerodrome liquidity ${label}`);
    }
  }

  private async erc20Balance(owner: string, tokenAddress: string): Promise<BigNumber> {
    const raw = await this.provider.call({
      to: nonZeroAddress(tokenAddress, 'token'),
      data: this.erc20Interface.encodeFunctionData('balanceOf', [nonZeroAddress(owner, 'owner')]),
    });
    try {
      const decoded = this.erc20Interface.decodeFunctionResult('balanceOf', raw);
      return BigNumber.from(decoded[0]);
    } catch {
      throw new BalanceError('malformed ERC20 balance response');
    }
  }

  private async nativeBalance(owner: string): Promise<BigNumber> {
    if (this.provider.getBalance === undefined) {
      throw new BalanceError('provider does not support native ETH balance checks');
    }
    try {
      return await this.provider.getBalance(nonZeroAddress(owner, 'owner'));
    } catch {
      throw new BalanceError('malformed native ETH balance response');
    }
  }

  private buildApprovalTransaction(
    owner: string,
    tokenAddress: string,
    amount: BigNumber,
  ): PlannedTransaction {
    return {
      to: nonZeroAddress(tokenAddress, 'token'),
      from: nonZeroAddress(owner, 'owner'),
      data: this.erc20Interface.encodeFunctionData('approve', [
        this.config.contracts.router,
        amount,
      ]),
      value: '0',
      gasEstimate: DEFAULT_GAS.toString(),
    };
  }

  private addCalldata(
    pair: NormalizedPair,
    amountADesired: BigNumber,
    amountBDesired: BigNumber,
    amountAMin: BigNumber,
    amountBMin: BigNumber,
    recipient: string,
    deadline: number,
  ): string {
    if (isNativeEth(pair.tokenA)) {
      return this.routerInterface.encodeFunctionData('addLiquidityETH', [
        pair.routeTokenB.address,
        pair.stable,
        amountBDesired,
        amountBMin,
        amountAMin,
        recipient,
        deadline,
      ]);
    }
    if (isNativeEth(pair.tokenB)) {
      return this.routerInterface.encodeFunctionData('addLiquidityETH', [
        pair.routeTokenA.address,
        pair.stable,
        amountADesired,
        amountAMin,
        amountBMin,
        recipient,
        deadline,
      ]);
    }
    return this.routerInterface.encodeFunctionData('addLiquidity', [
      pair.routeTokenA.address,
      pair.routeTokenB.address,
      pair.stable,
      amountADesired,
      amountBDesired,
      amountAMin,
      amountBMin,
      recipient,
      deadline,
    ]);
  }

  private removeCalldata(
    pair: NormalizedPair,
    liquidity: BigNumber,
    amountAMin: BigNumber,
    amountBMin: BigNumber,
    recipient: string,
    deadline: number,
  ): string {
    if (isNativeEth(pair.tokenA)) {
      return this.routerInterface.encodeFunctionData('removeLiquidityETH', [
        pair.routeTokenB.address,
        pair.stable,
        liquidity,
        amountBMin,
        amountAMin,
        recipient,
        deadline,
      ]);
    }
    if (isNativeEth(pair.tokenB)) {
      return this.routerInterface.encodeFunctionData('removeLiquidityETH', [
        pair.routeTokenA.address,
        pair.stable,
        liquidity,
        amountAMin,
        amountBMin,
        recipient,
        deadline,
      ]);
    }
    return this.routerInterface.encodeFunctionData('removeLiquidity', [
      pair.routeTokenA.address,
      pair.routeTokenB.address,
      pair.stable,
      liquidity,
      amountAMin,
      amountBMin,
      recipient,
      deadline,
    ]);
  }

  private addValue(
    pair: NormalizedPair,
    amountADesired: BigNumber,
    amountBDesired: BigNumber,
  ): BigNumber {
    if (isNativeEth(pair.tokenA)) {
      return amountADesired;
    }
    if (isNativeEth(pair.tokenB)) {
      return amountBDesired;
    }
    return BigNumber.from(0);
  }

  private async planTransaction(
    walletAddress: string,
    data: string,
    value: BigNumber,
    useDefaultGas = false,
  ): Promise<PlannedTransaction> {
    const transaction: TransactionRequest = {
      to: this.config.contracts.router,
      from: walletAddress,
      data,
      value,
    };
    const gasEstimate = useDefaultGas ? DEFAULT_GAS : await this.estimateGas(transaction);
    return {
      ...transaction,
      value: value.toString(),
      gasEstimate: gasEstimate.toString(),
    };
  }

  private async estimateGas(transaction: Readonly<TransactionRequest>): Promise<BigNumber> {
    try {
      return await this.provider.estimateGas(transaction);
    } catch {
      throw new TransactionPreflightError('Aerodrome liquidity gas estimation failed');
    }
  }

  private liquidityQuote(
    pair: NormalizedPair,
    poolAddress: string,
    amountA: BigNumber,
    amountB: BigNumber,
    amountAMin: BigNumber,
    amountBMin: BigNumber,
    liquidity: BigNumber,
  ): AerodromeLiquidityQuote {
    return Object.freeze({
      poolAddress,
      tokenA: Object.freeze({ ...pair.tokenA }),
      tokenB: Object.freeze({ ...pair.tokenB }),
      routeTokenA: Object.freeze({ ...pair.routeTokenA }),
      routeTokenB: Object.freeze({ ...pair.routeTokenB }),
      poolType: pair.poolType,
      amountA: decimalAmount(amountA, pair.tokenA.decimals),
      amountB: decimalAmount(amountB, pair.tokenB.decimals),
      amountAAtomic: amountA,
      amountBAtomic: amountB,
      amountAMin: decimalAmount(amountAMin, pair.tokenA.decimals),
      amountBMin: decimalAmount(amountBMin, pair.tokenB.decimals),
      amountAMinAtomic: amountAMin,
      amountBMinAtomic: amountBMin,
      liquidity: decimalAmount(liquidity, LP_DECIMALS),
      liquidityAtomic: liquidity,
    });
  }

  private futureDeadline(deadline: number | undefined): number {
    const normalized = safeIntegerTimestamp(deadline ?? this.now() + 120, 'deadline');
    if (normalized <= this.now()) {
      throw new TransactionPreflightError('deadline must be in the future');
    }
    return normalized;
  }

  private assertNonZero(amount: BigNumber, label: string): void {
    if (amount.isZero()) {
      throw new TransactionPreflightError(`${label} must be greater than zero`);
    }
  }
}

interface NormalizedPair {
  readonly tokenA: TokenInfo;
  readonly tokenB: TokenInfo;
  readonly routeTokenA: TokenInfo;
  readonly routeTokenB: TokenInfo;
  readonly poolType: PoolType;
  readonly stable: boolean;
}
