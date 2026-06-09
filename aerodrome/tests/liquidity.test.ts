import { Interface } from '@ethersproject/abi';
import { getAddress } from '@ethersproject/address';
import { BigNumber } from '@ethersproject/bignumber';
import { describe, expect, it } from 'vitest';

import { BASE_MAINNET, BASE_TOKENS } from '../src/config.js';
import {
  ERC20_ABI,
  FACTORY_REGISTRY_ABI,
  POOL_ABI,
  POOL_FACTORY_ABI,
  ROUTER_ABI,
} from '../src/contracts.js';
import {
  AerodromeLiquidityPlanner,
  type AddLiquidityRequest,
  type RemoveLiquidityRequest,
} from '../src/liquidity/index.js';
import {
  AllowanceError,
  BalanceError,
  PoolValidationError,
  TransactionPreflightError,
  UnsupportedNetworkError,
} from '../src/errors.js';
import type { AerodromeProvider, CallRequest, TransactionRequest } from '../src/types.js';

const OWNER = getAddress('0x00000000000000000000000000000000000000aa');
const RECIPIENT = getAddress('0x00000000000000000000000000000000000000bb');
const POOL = getAddress('0x1111111111111111111111111111111111111111');
const ONE_USDC = BigNumber.from('1000000');
const HALF_WETH = BigNumber.from('500000000000000000');
const LP_AMOUNT = BigNumber.from('1000000000000000000');

const routerInterface = new Interface(ROUTER_ABI);
const registryInterface = new Interface(FACTORY_REGISTRY_ABI);
const factoryInterface = new Interface(POOL_FACTORY_ABI);
const poolInterface = new Interface(POOL_ABI);
const erc20Interface = new Interface(ERC20_ABI);

class LiquidityProvider implements AerodromeProvider {
  public chainId = 8453;
  public readonly code = new Set<string>([
    BASE_MAINNET.contracts.router,
    BASE_MAINNET.contracts.poolFactory,
    BASE_MAINNET.contracts.factoryRegistry,
    BASE_TOKENS.USDC.address,
    BASE_TOKENS.WETH.address,
    POOL,
  ]);
  public defaultFactory = BASE_MAINNET.contracts.poolFactory;
  public factoryRegistry = BASE_MAINNET.contracts.factoryRegistry;
  public factoryApproved = true;
  public poolAddress = POOL;
  public factoryPoolAddress = POOL;
  public isPool = true;
  public stable = false;
  public token0 = BASE_TOKENS.USDC.address;
  public token1 = BASE_TOKENS.WETH.address;
  public reserve0 = ONE_USDC.mul(1_000);
  public reserve1 = HALF_WETH.mul(1_000);
  public quotedAddA = BigNumber.from('900000');
  public quotedAddB = BigNumber.from('450000000000000000');
  public quotedLiquidity = LP_AMOUNT;
  public quotedRemoveA = BigNumber.from('800000');
  public quotedRemoveB = BigNumber.from('400000000000000000');
  public allowanceAmount = BigNumber.from(0);
  public balanceAmount = LP_AMOUNT.mul(2);
  public nativeBalanceAmount = HALF_WETH.mul(2);
  public usdcDecimals = 6;
  public wethDecimals = 18;
  public gasEstimate = BigNumber.from('210000');
  public estimateGasError: Error | undefined;
  public readonly malformedCalls = new Set<string>();
  public readonly calls: CallRequest[] = [];
  public readonly estimated: TransactionRequest[] = [];

  public getNetwork(): Promise<{ readonly chainId: number }> {
    return Promise.resolve({ chainId: this.chainId });
  }

  public getCode(address: string): Promise<string> {
    return Promise.resolve(this.code.has(getAddress(address)) ? '0x6001' : '0x');
  }

  public getBalance(): Promise<BigNumber> {
    return Promise.resolve(this.nativeBalanceAmount);
  }

  public call(transaction: Readonly<CallRequest>): Promise<string> {
    this.calls.push({ ...transaction });
    const routerCall = parse(routerInterface, transaction.data);
    if (routerCall !== undefined) {
      if (this.malformedCalls.has(`router:${routerCall.name}`)) {
        return Promise.resolve('0x');
      }
      return Promise.resolve(this.handleRouter(routerCall.name, routerCall.args));
    }
    const registryCall = parse(registryInterface, transaction.data);
    if (registryCall !== undefined) {
      if (this.malformedCalls.has(`registry:${registryCall.name}`)) {
        return Promise.resolve('0x');
      }
      return Promise.resolve(
        registryInterface.encodeFunctionResult('isPoolFactoryApproved', [this.factoryApproved]),
      );
    }
    const factoryCall = parse(factoryInterface, transaction.data);
    if (factoryCall !== undefined) {
      if (this.malformedCalls.has(`factory:${factoryCall.name}`)) {
        return Promise.resolve('0x');
      }
      return Promise.resolve(this.handleFactory(factoryCall.name));
    }
    const poolCall = parse(poolInterface, transaction.data);
    if (poolCall !== undefined) {
      if (this.malformedCalls.has(`pool:${poolCall.name}`)) {
        return Promise.resolve('0x');
      }
      return Promise.resolve(this.handlePool(poolCall.name));
    }
    const erc20Call = parse(erc20Interface, transaction.data);
    if (erc20Call !== undefined) {
      if (this.malformedCalls.has(`erc20:${erc20Call.name}`)) {
        return Promise.resolve('0x');
      }
      return Promise.resolve(this.handleErc20(erc20Call.name, transaction.to));
    }
    throw new Error(`unhandled fake provider call to ${transaction.to}`);
  }

  public estimateGas(transaction: Readonly<TransactionRequest>): Promise<BigNumber> {
    this.estimated.push({ ...transaction });
    if (this.estimateGasError !== undefined) {
      return Promise.reject(this.estimateGasError);
    }
    return Promise.resolve(this.gasEstimate);
  }

  private handleRouter(name: string, args: readonly unknown[]): string {
    if (name === 'defaultFactory') {
      return routerInterface.encodeFunctionResult(name, [this.defaultFactory]);
    }
    if (name === 'factoryRegistry') {
      return routerInterface.encodeFunctionResult(name, [this.factoryRegistry]);
    }
    if (name === 'poolFor') {
      return routerInterface.encodeFunctionResult(name, [this.poolAddress]);
    }
    if (name === 'quoteAddLiquidity') {
      return routerInterface.encodeFunctionResult(name, [
        this.quotedAddA,
        this.quotedAddB,
        this.quotedLiquidity,
      ]);
    }
    if (name === 'quoteRemoveLiquidity') {
      return routerInterface.encodeFunctionResult(name, [this.quotedRemoveA, this.quotedRemoveB]);
    }
    throw new Error(`unhandled router call ${name} with ${args.length} args`);
  }

  private handleFactory(name: string): string {
    if (name === 'isPool') {
      return factoryInterface.encodeFunctionResult(name, [this.isPool]);
    }
    if (name === 'getPool') {
      return factoryInterface.encodeFunctionResult(name, [this.factoryPoolAddress]);
    }
    throw new Error(`unhandled factory call ${name}`);
  }

  private handlePool(name: string): string {
    if (name === 'metadata') {
      return poolInterface.encodeFunctionResult(name, [
        BigNumber.from(6),
        BigNumber.from(18),
        this.reserve0,
        this.reserve1,
        this.stable,
        this.token0,
        this.token1,
      ]);
    }
    throw new Error(`unhandled pool call ${name}`);
  }

  private handleErc20(name: string, tokenAddress: string): string {
    if (name === 'allowance') {
      return erc20Interface.encodeFunctionResult(name, [this.allowanceAmount]);
    }
    if (name === 'balanceOf') {
      return erc20Interface.encodeFunctionResult(name, [this.balanceAmount]);
    }
    if (name === 'decimals') {
      return erc20Interface.encodeFunctionResult(name, [
        getAddress(tokenAddress) === BASE_TOKENS.USDC.address
          ? this.usdcDecimals
          : this.wethDecimals,
      ]);
    }
    throw new Error(`unhandled ERC20 call ${name}`);
  }
}

function parse(
  iface: Interface,
  data: string,
): { readonly name: string; readonly args: readonly unknown[] } | undefined {
  try {
    const parsed = iface.parseTransaction({ data });
    return { name: parsed.name, args: [...parsed.args] };
  } catch {
    return undefined;
  }
}

function args(iface: Interface, data: string): readonly unknown[] {
  return [...iface.parseTransaction({ data }).args];
}

function addRequest(overrides: Partial<AddLiquidityRequest> = {}): AddLiquidityRequest {
  return {
    tokenA: BASE_TOKENS.USDC,
    tokenB: BASE_TOKENS.WETH,
    amountA: '1',
    amountB: '0.5',
    poolType: 'volatile',
    walletAddress: OWNER,
    recipient: RECIPIENT,
    slippageBps: 50,
    deadline: 1_700_000_120,
    ...overrides,
  };
}

function removeRequest(overrides: Partial<RemoveLiquidityRequest> = {}): RemoveLiquidityRequest {
  return {
    tokenA: BASE_TOKENS.USDC,
    tokenB: BASE_TOKENS.WETH,
    liquidity: '1',
    poolType: 'volatile',
    walletAddress: OWNER,
    recipient: RECIPIENT,
    slippageBps: 50,
    deadline: 1_700_000_120,
    ...overrides,
  };
}

function erc20CallArgs(
  calls: readonly CallRequest[],
  functionName: 'allowance' | 'balanceOf',
): readonly (readonly unknown[])[] {
  return calls.flatMap((call) => {
    const parsed = parse(erc20Interface, call.data);
    return parsed?.name === functionName ? [parsed.args] : [];
  });
}

describe('Aerodrome liquidity planner', () => {
  it('plans basic-pool token add liquidity with Router quote, approvals, and calldata', async () => {
    const provider = new LiquidityProvider();
    const planner = new AerodromeLiquidityPlanner(provider, BASE_MAINNET, () => 1_700_000_000);

    const plan = await planner.planAddLiquidity(addRequest());

    expect(plan.quote.poolAddress).toBe(POOL);
    expect(plan.quote.amountAAtomic.toString()).toBe('900000');
    expect(plan.quote.amountBAtomic.toString()).toBe('450000000000000000');
    expect(plan.quote.amountAMinAtomic.toString()).toBe('895500');
    expect(plan.quote.amountBMinAtomic.toString()).toBe('447750000000000000');
    expect(plan.approvals).toHaveLength(2);
    expect(plan.approvals.map((approval) => approval.to)).toEqual([
      BASE_TOKENS.USDC.address,
      BASE_TOKENS.WETH.address,
    ]);
    expect(plan.approvals.map((approval) => args(erc20Interface, approval.data)[0])).toEqual([
      BASE_MAINNET.contracts.router,
      BASE_MAINNET.contracts.router,
    ]);
    expect(erc20CallArgs(provider.calls, 'allowance').map((callArgs) => callArgs[1])).toEqual([
      BASE_MAINNET.contracts.router,
      BASE_MAINNET.contracts.router,
    ]);
    expect(plan.transaction.to).toBe(BASE_MAINNET.contracts.router);
    expect(plan.transaction.from).toBe(OWNER);
    expect(plan.transaction.value).toBe('0');
    expect(plan.transaction.gasEstimate).toBe('250000');
    expect(provider.estimated).toHaveLength(0);
    const parsed = routerInterface.parseTransaction({ data: plan.transaction.data });
    expect(parsed.name).toBe('addLiquidity');
    expect(BigNumber.from(parsed.args[5]).toString()).toBe('895500');
    expect(BigNumber.from(parsed.args[6]).toString()).toBe('447750000000000000');
  });

  it('preserves native ETH sentinel semantics for add liquidity', async () => {
    const provider = new LiquidityProvider();
    provider.quotedAddA = HALF_WETH;
    provider.quotedAddB = ONE_USDC;
    const planner = new AerodromeLiquidityPlanner(provider, BASE_MAINNET, () => 1_700_000_000);

    const plan = await planner.planAddLiquidity(
      addRequest({
        tokenA: BASE_TOKENS.ETH,
        tokenB: BASE_TOKENS.USDC,
        amountA: '0.5',
        amountB: '1',
      }),
    );

    expect(plan.approvals).toHaveLength(1);
    expect(plan.approvals[0]?.to).toBe(BASE_TOKENS.USDC.address);
    expect(plan.transaction.value).toBe(HALF_WETH.toString());
    expect(plan.transaction.gasEstimate).toBe('250000');
    expect(provider.estimated).toHaveLength(0);
    const parsed = routerInterface.parseTransaction({ data: plan.transaction.data });
    expect(parsed.name).toBe('addLiquidityETH');
    expect(parsed.args[0]).toBe(BASE_TOKENS.USDC.address);
    expect(parsed.args[1]).toBe(false);
    expect(BigNumber.from(parsed.args[2]).toString()).toBe(ONE_USDC.toString());
    expect(BigNumber.from(parsed.args[3]).toString()).toBe('995000');
    expect(BigNumber.from(parsed.args[4]).toString()).toBe('497500000000000000');
    expect(parsed.args[5]).toBe(RECIPIENT);
    expect(Number(parsed.args[6])).toBe(1_700_000_120);

    const ethSecondProvider = new LiquidityProvider();
    ethSecondProvider.quotedAddA = ONE_USDC;
    ethSecondProvider.quotedAddB = HALF_WETH;
    ethSecondProvider.allowanceAmount = ONE_USDC;
    const ethSecondPlan = await new AerodromeLiquidityPlanner(
      ethSecondProvider,
      BASE_MAINNET,
      () => 1_700_000_000,
    ).planAddLiquidity(
      addRequest({
        tokenA: BASE_TOKENS.USDC,
        tokenB: BASE_TOKENS.ETH,
        amountA: '1',
        amountB: '0.5',
      }),
    );

    expect(ethSecondPlan.approvals).toHaveLength(0);
    expect(ethSecondPlan.transaction.value).toBe(HALF_WETH.toString());
    expect(ethSecondPlan.transaction.gasEstimate).toBe('210000');
    expect(ethSecondProvider.estimated).toHaveLength(1);
    const ethSecondParsed = routerInterface.parseTransaction({
      data: ethSecondPlan.transaction.data,
    });
    expect(ethSecondParsed.name).toBe('addLiquidityETH');
    expect(ethSecondParsed.args[0]).toBe(BASE_TOKENS.USDC.address);
    expect(ethSecondParsed.args[1]).toBe(false);
    expect(BigNumber.from(ethSecondParsed.args[2]).toString()).toBe(ONE_USDC.toString());
    expect(BigNumber.from(ethSecondParsed.args[3]).toString()).toBe('995000');
    expect(BigNumber.from(ethSecondParsed.args[4]).toString()).toBe('497500000000000000');
    expect(ethSecondParsed.args[5]).toBe(RECIPIENT);
    expect(Number(ethSecondParsed.args[6])).toBe(1_700_000_120);
  });

  it('plans remove liquidity through Router quote, LP approval, and calldata', async () => {
    const provider = new LiquidityProvider();
    const planner = new AerodromeLiquidityPlanner(provider, BASE_MAINNET, () => 1_700_000_000);

    const plan = await planner.planRemoveLiquidity(removeRequest());

    expect(plan.quote.poolAddress).toBe(POOL);
    expect(plan.quote.liquidityAtomic.toString()).toBe(LP_AMOUNT.toString());
    expect(plan.quote.amountAAtomic.toString()).toBe('800000');
    expect(plan.quote.amountBAtomic.toString()).toBe('400000000000000000');
    expect(plan.quote.amountAMinAtomic.toString()).toBe('796000');
    expect(plan.quote.amountBMinAtomic.toString()).toBe('398000000000000000');
    expect(plan.approvals).toHaveLength(1);
    expect(plan.approvals[0]?.to).toBe(POOL);
    expect(args(erc20Interface, plan.approvals[0]?.data ?? '0x')[0]).toBe(
      BASE_MAINNET.contracts.router,
    );
    expect(erc20CallArgs(provider.calls, 'allowance').map((callArgs) => callArgs[1])).toEqual([
      BASE_MAINNET.contracts.router,
    ]);
    expect(plan.transaction.value).toBe('0');
    expect(routerInterface.parseTransaction({ data: plan.transaction.data }).name).toBe(
      'removeLiquidity',
    );
  });

  it('preserves native ETH sentinel semantics for remove liquidity', async () => {
    const provider = new LiquidityProvider();
    const planner = new AerodromeLiquidityPlanner(provider, BASE_MAINNET, () => 1_700_000_000);

    const plan = await planner.planRemoveLiquidity(
      removeRequest({ tokenA: BASE_TOKENS.USDC, tokenB: BASE_TOKENS.ETH }),
    );

    expect(plan.approvals).toHaveLength(1);
    expect(plan.approvals[0]?.to).toBe(POOL);
    expect(plan.transaction.value).toBe('0');
    expect(plan.transaction.gasEstimate).toBe('250000');
    expect(provider.estimated).toHaveLength(0);
    const parsed = routerInterface.parseTransaction({ data: plan.transaction.data });
    expect(parsed.name).toBe('removeLiquidityETH');
    expect(parsed.args[0]).toBe(BASE_TOKENS.USDC.address);
    expect(parsed.args[1]).toBe(false);
    expect(BigNumber.from(parsed.args[2]).toString()).toBe(LP_AMOUNT.toString());
    expect(BigNumber.from(parsed.args[3]).toString()).toBe('796000');
    expect(BigNumber.from(parsed.args[4]).toString()).toBe('398000000000000000');
    expect(parsed.args[5]).toBe(RECIPIENT);
    expect(Number(parsed.args[6])).toBe(1_700_000_120);

    const ethFirstProvider = new LiquidityProvider();
    ethFirstProvider.quotedRemoveA = BigNumber.from('400000000000000000');
    ethFirstProvider.quotedRemoveB = BigNumber.from('800000');
    ethFirstProvider.allowanceAmount = LP_AMOUNT;
    const ethFirstPlan = await new AerodromeLiquidityPlanner(
      ethFirstProvider,
      BASE_MAINNET,
      () => 1_700_000_000,
    ).planRemoveLiquidity(removeRequest({ tokenA: BASE_TOKENS.ETH, tokenB: BASE_TOKENS.USDC }));

    expect(ethFirstPlan.approvals).toHaveLength(0);
    expect(ethFirstPlan.transaction.value).toBe('0');
    expect(ethFirstPlan.transaction.gasEstimate).toBe('210000');
    expect(ethFirstProvider.estimated).toHaveLength(1);
    const ethFirstParsed = routerInterface.parseTransaction({
      data: ethFirstPlan.transaction.data,
    });
    expect(ethFirstParsed.name).toBe('removeLiquidityETH');
    expect(ethFirstParsed.args[0]).toBe(BASE_TOKENS.USDC.address);
    expect(ethFirstParsed.args[1]).toBe(false);
    expect(BigNumber.from(ethFirstParsed.args[2]).toString()).toBe(LP_AMOUNT.toString());
    expect(BigNumber.from(ethFirstParsed.args[3]).toString()).toBe('796000');
    expect(BigNumber.from(ethFirstParsed.args[4]).toString()).toBe('398000000000000000');
    expect(ethFirstParsed.args[5]).toBe(RECIPIENT);
    expect(Number(ethFirstParsed.args[6])).toBe(1_700_000_120);
  });

  it('estimates liquidity router gas only when no dependent approval is planned', async () => {
    const approvalProvider = new LiquidityProvider();
    const approvalPlan = await new AerodromeLiquidityPlanner(
      approvalProvider,
      BASE_MAINNET,
      () => 1_700_000_000,
    ).planRemoveLiquidity(removeRequest());

    expect(approvalPlan.approvals).toHaveLength(1);
    expect(approvalPlan.transaction.gasEstimate).toBe('250000');
    expect(approvalProvider.estimated).toHaveLength(0);

    const noApprovalProvider = new LiquidityProvider();
    noApprovalProvider.allowanceAmount = LP_AMOUNT;
    const noApprovalPlan = await new AerodromeLiquidityPlanner(
      noApprovalProvider,
      BASE_MAINNET,
      () => 1_700_000_000,
    ).planRemoveLiquidity(removeRequest());

    expect(noApprovalPlan.approvals).toHaveLength(0);
    expect(noApprovalPlan.transaction.gasEstimate).toBe('210000');
    expect(noApprovalProvider.estimated).toHaveLength(1);
  });

  it('wraps liquidity router gas estimation failures as transaction preflight errors', async () => {
    const provider = new LiquidityProvider();
    provider.allowanceAmount = LP_AMOUNT;
    provider.estimateGasError = new Error('execution reverted: allowance');

    await expect(
      new AerodromeLiquidityPlanner(
        provider,
        BASE_MAINNET,
        () => 1_700_000_000,
      ).planRemoveLiquidity(removeRequest()),
    ).rejects.toThrow(TransactionPreflightError);

    expect(provider.estimated).toHaveLength(1);
  });

  it('rejects insufficient token, native, and LP balances before approval planning', async () => {
    const poorToken = new LiquidityProvider();
    poorToken.balanceAmount = ONE_USDC.sub(1);
    await expect(
      new AerodromeLiquidityPlanner(poorToken, BASE_MAINNET, () => 1_700_000_000).planAddLiquidity(
        addRequest(),
      ),
    ).rejects.toThrow(BalanceError);
    expect(erc20CallArgs(poorToken.calls, 'allowance')).toHaveLength(0);

    const poorNative = new LiquidityProvider();
    poorNative.nativeBalanceAmount = HALF_WETH.sub(1);
    await expect(
      new AerodromeLiquidityPlanner(poorNative, BASE_MAINNET, () => 1_700_000_000).planAddLiquidity(
        addRequest({
          tokenA: BASE_TOKENS.ETH,
          tokenB: BASE_TOKENS.USDC,
          amountA: '0.5',
          amountB: '1',
        }),
      ),
    ).rejects.toThrow(BalanceError);
    expect(erc20CallArgs(poorNative.calls, 'allowance')).toHaveLength(0);

    const poorLp = new LiquidityProvider();
    poorLp.balanceAmount = LP_AMOUNT.sub(1);
    await expect(
      new AerodromeLiquidityPlanner(poorLp, BASE_MAINNET, () => 1_700_000_000).planRemoveLiquidity(
        removeRequest(),
      ),
    ).rejects.toThrow(BalanceError);
    expect(erc20CallArgs(poorLp.calls, 'allowance')).toHaveLength(0);
  });

  it('rejects invalid liquidity planning inputs and mismatched pools', async () => {
    const planner = new AerodromeLiquidityPlanner(
      new LiquidityProvider(),
      BASE_MAINNET,
      () => 1_700_000_000,
    );

    await expect(planner.planAddLiquidity(addRequest({ amountA: '0' }))).rejects.toThrow(
      TransactionPreflightError,
    );
    await expect(planner.planAddLiquidity(addRequest({ deadline: 1_700_000_000 }))).rejects.toThrow(
      TransactionPreflightError,
    );
    await expect(
      planner.planAddLiquidity(addRequest({ poolType: 'mixed' as 'volatile' })),
    ).rejects.toThrow(TransactionPreflightError);
    await expect(
      planner.planAddLiquidity(addRequest({ tokenA: { ...BASE_TOKENS.USDC, decimals: 18 } })),
    ).rejects.toThrow(PoolValidationError);

    const stableMismatch = new LiquidityProvider();
    stableMismatch.stable = true;
    await expect(
      new AerodromeLiquidityPlanner(
        stableMismatch,
        BASE_MAINNET,
        () => 1_700_000_000,
      ).planRemoveLiquidity(removeRequest()),
    ).rejects.toThrow(PoolValidationError);
  });

  it('rejects network, pair, core contract, and pool validation failures', async () => {
    const wrongChain = new LiquidityProvider();
    wrongChain.chainId = 1;
    await expect(
      new AerodromeLiquidityPlanner(wrongChain).planAddLiquidity(addRequest()),
    ).rejects.toThrow(UnsupportedNetworkError);

    const spoofedCore = new LiquidityProvider();
    await expect(
      new AerodromeLiquidityPlanner(spoofedCore, {
        ...BASE_MAINNET,
        contracts: {
          ...BASE_MAINNET.contracts,
          router: getAddress('0x2222222222222222222222222222222222222222'),
          poolFactory: getAddress('0x3333333333333333333333333333333333333333'),
          factoryRegistry: getAddress('0x4444444444444444444444444444444444444444'),
        },
      }).planAddLiquidity(addRequest()),
    ).rejects.toThrow(PoolValidationError);
    expect(spoofedCore.calls).toHaveLength(0);
    expect(spoofedCore.estimated).toHaveLength(0);

    await expect(
      new AerodromeLiquidityPlanner(new LiquidityProvider()).planAddLiquidity(
        addRequest({ tokenB: BASE_TOKENS.USDC }),
      ),
    ).rejects.toThrow(TransactionPreflightError);

    await expect(
      new AerodromeLiquidityPlanner(new LiquidityProvider()).planAddLiquidity(
        addRequest({ tokenA: BASE_TOKENS.ETH, tokenB: BASE_TOKENS.WETH }),
      ),
    ).rejects.toThrow(TransactionPreflightError);

    const badFactory = new LiquidityProvider();
    badFactory.defaultFactory = getAddress('0x2222222222222222222222222222222222222222');
    await expect(
      new AerodromeLiquidityPlanner(badFactory).planAddLiquidity(addRequest()),
    ).rejects.toThrow(PoolValidationError);

    const badRegistry = new LiquidityProvider();
    badRegistry.factoryRegistry = getAddress('0x3333333333333333333333333333333333333333');
    await expect(
      new AerodromeLiquidityPlanner(badRegistry).planAddLiquidity(addRequest()),
    ).rejects.toThrow(PoolValidationError);

    const unapproved = new LiquidityProvider();
    unapproved.factoryApproved = false;
    await expect(
      new AerodromeLiquidityPlanner(unapproved).planAddLiquidity(addRequest()),
    ).rejects.toThrow(PoolValidationError);

    const noPoolCode = new LiquidityProvider();
    noPoolCode.code.delete(POOL);
    await expect(
      new AerodromeLiquidityPlanner(noPoolCode).planAddLiquidity(addRequest()),
    ).rejects.toThrow(PoolValidationError);

    const factoryMismatch = new LiquidityProvider();
    factoryMismatch.factoryPoolAddress = getAddress('0x4444444444444444444444444444444444444444');
    await expect(
      new AerodromeLiquidityPlanner(factoryMismatch).planAddLiquidity(addRequest()),
    ).rejects.toThrow(PoolValidationError);

    const fakePool = new LiquidityProvider();
    fakePool.isPool = false;
    await expect(
      new AerodromeLiquidityPlanner(fakePool).planAddLiquidity(addRequest()),
    ).rejects.toThrow(PoolValidationError);

    const wrongTokens = new LiquidityProvider();
    wrongTokens.token1 = BASE_TOKENS.AERO.address;
    await expect(
      new AerodromeLiquidityPlanner(wrongTokens).planAddLiquidity(addRequest()),
    ).rejects.toThrow(PoolValidationError);
  });

  it('rejects zero quote outputs, zero slippage minimums, and malformed provider responses', async () => {
    const zeroAdd = new LiquidityProvider();
    zeroAdd.quotedAddA = BigNumber.from(0);
    await expect(
      new AerodromeLiquidityPlanner(zeroAdd).planAddLiquidity(addRequest()),
    ).rejects.toThrow(TransactionPreflightError);

    const zeroRemove = new LiquidityProvider();
    zeroRemove.quotedRemoveB = BigNumber.from(0);
    await expect(
      new AerodromeLiquidityPlanner(zeroRemove).planRemoveLiquidity(removeRequest()),
    ).rejects.toThrow(TransactionPreflightError);

    const zeroMinimum = new LiquidityProvider();
    zeroMinimum.quotedAddA = BigNumber.from(1);
    await expect(
      new AerodromeLiquidityPlanner(zeroMinimum).planAddLiquidity(
        addRequest({ slippageBps: 9_999 }),
      ),
    ).rejects.toThrow(TransactionPreflightError);

    const malformedAddQuote = new LiquidityProvider();
    malformedAddQuote.malformedCalls.add('router:quoteAddLiquidity');
    await expect(
      new AerodromeLiquidityPlanner(malformedAddQuote).planAddLiquidity(addRequest()),
    ).rejects.toThrow(PoolValidationError);

    const malformedRemoveQuote = new LiquidityProvider();
    malformedRemoveQuote.malformedCalls.add('router:quoteRemoveLiquidity');
    await expect(
      new AerodromeLiquidityPlanner(malformedRemoveQuote).planRemoveLiquidity(removeRequest()),
    ).rejects.toThrow(PoolValidationError);

    const malformedAllowance = new LiquidityProvider();
    malformedAllowance.malformedCalls.add('erc20:allowance');
    await expect(
      new AerodromeLiquidityPlanner(
        malformedAllowance,
        BASE_MAINNET,
        () => 1_700_000_000,
      ).planRemoveLiquidity(removeRequest()),
    ).rejects.toThrow(AllowanceError);
  });
});
