import { Interface } from '@ethersproject/abi';
import { getAddress } from '@ethersproject/address';
import { BigNumber } from '@ethersproject/bignumber';
import { describe, expect, it } from 'vitest';

import { Aerodrome } from '../src/aerodrome.js';
import { BASE_MAINNET, BASE_TOKENS } from '../src/config.js';
import {
  ERC20_ABI,
  FACTORY_REGISTRY_ABI,
  POOL_ABI,
  POOL_FACTORY_ABI,
  ROUTER_ABI,
} from '../src/contracts.js';
import {
  AllowanceError,
  BalanceError,
  PoolValidationError,
  QuoteCacheError,
  QuoteError,
  TransactionPreflightError,
  UnsupportedNetworkError,
} from '../src/errors.js';
import type {
  AerodromeProvider,
  CallRequest,
  QuoteSwapRequest,
  TransactionRequest,
} from '../src/types.js';
import {
  applySlippageBps,
  atomicAmount,
  checksumAddress,
  decimalAmount,
  hasDeployedCode,
  nonZeroAddress,
  ratio,
  safeIntegerTimestamp,
  stableFlag,
  validateToken,
} from '../src/utils.js';
import {
  executeQuote as executeQuoteRoute,
  executeSwap as executeSwapRoute,
  quoteSwap as quoteSwapRoute,
} from '../src/router-routes/index.js';

const OWNER = getAddress('0x00000000000000000000000000000000000000aa');
const RECIPIENT = getAddress('0x00000000000000000000000000000000000000bb');
const POOL = getAddress('0x1111111111111111111111111111111111111111');
const AERO_POOL = getAddress('0x2222222222222222222222222222222222222222');
const WETH_POOL = getAddress('0x3333333333333333333333333333333333333333');
const ONE_USDC = BigNumber.from('1000000');
const HALF_WETH = BigNumber.from('500000000000000000');

const routerInterface = new Interface(ROUTER_ABI);
const registryInterface = new Interface(FACTORY_REGISTRY_ABI);
const factoryInterface = new Interface(POOL_FACTORY_ABI);
const poolInterface = new Interface(POOL_ABI);
const erc20Interface = new Interface(ERC20_ABI);

class FakeProvider implements AerodromeProvider {
  public chainId = 8453;
  public readonly code = new Set<string>([
    BASE_MAINNET.contracts.router,
    BASE_MAINNET.contracts.poolFactory,
    BASE_MAINNET.contracts.factoryRegistry,
    BASE_TOKENS.USDC.address,
    BASE_TOKENS.WETH.address,
    BASE_TOKENS.AERO.address,
    POOL,
    AERO_POOL,
    WETH_POOL,
  ]);
  public factoryApproved = true;
  public defaultFactory = BASE_MAINNET.contracts.poolFactory;
  public factoryRegistry = BASE_MAINNET.contracts.factoryRegistry;
  public poolAddress = POOL;
  public factoryPoolAddress = POOL;
  public isPool = true;
  public reserve0 = ONE_USDC.mul(1_000);
  public reserve1 = HALF_WETH.mul(1_000);
  public stable = false;
  public token0 = BASE_TOKENS.USDC.address;
  public token1 = BASE_TOKENS.WETH.address;
  public amountOut = HALF_WETH;
  public amountOutByRouteLength = new Map<number, BigNumber>();
  public malformedAmounts = false;
  public allowanceAmount = ONE_USDC;
  public balanceAmount = ONE_USDC;
  public nativeBalanceAmount = HALF_WETH;
  public usdcDecimals = 6;
  public wethDecimals = 18;
  public gasEstimate = BigNumber.from('180000');
  public readonly malformedCalls = new Set<string>();
  public readonly calls: CallRequest[] = [];
  public readonly estimated: TransactionRequest[] = [];

  public getNetwork(): Promise<{ readonly chainId: number }> {
    return Promise.resolve({ chainId: this.chainId });
  }

  public getCode(address: string): Promise<string> {
    return Promise.resolve(this.code.has(getAddress(address)) ? '0x6001' : '0x');
  }

  public call(transaction: Readonly<CallRequest>): Promise<string> {
    this.calls.push({ ...transaction });
    const data = transaction.data;
    const routerCall = parse(routerInterface, data);
    if (routerCall !== undefined) {
      if (this.malformedCalls.has(`router:${routerCall.name}`)) {
        return Promise.resolve('0x');
      }
      return Promise.resolve(this.handleRouter(routerCall.name, routerCall.args));
    }
    const registryCall = parse(registryInterface, data);
    if (registryCall !== undefined) {
      if (this.malformedCalls.has(`registry:${registryCall.name}`)) {
        return Promise.resolve('0x');
      }
      return Promise.resolve(
        registryInterface.encodeFunctionResult('isPoolFactoryApproved', [this.factoryApproved]),
      );
    }
    const factoryCall = parse(factoryInterface, data);
    if (factoryCall !== undefined) {
      if (this.malformedCalls.has(`factory:${factoryCall.name}`)) {
        return Promise.resolve('0x');
      }
      return Promise.resolve(this.handleFactory(factoryCall.name, factoryCall.args));
    }
    const poolCall = parse(poolInterface, data);
    if (poolCall !== undefined) {
      if (this.malformedCalls.has(`pool:${poolCall.name}`)) {
        return Promise.resolve('0x');
      }
      return Promise.resolve(this.handlePool(poolCall.name, transaction.to));
    }
    const erc20Call = parse(erc20Interface, data);
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
    return Promise.resolve(this.gasEstimate);
  }

  public getBalance(): Promise<BigNumber> {
    return Promise.resolve(this.nativeBalanceAmount);
  }

  private handleRouter(name: string, args: readonly unknown[]): string {
    if (name === 'defaultFactory') {
      return routerInterface.encodeFunctionResult(name, [this.defaultFactory]);
    }
    if (name === 'factoryRegistry') {
      return routerInterface.encodeFunctionResult(name, [this.factoryRegistry]);
    }
    if (name === 'poolFor') {
      return routerInterface.encodeFunctionResult(name, [this.poolForArgs(args, this.poolAddress)]);
    }
    if (name === 'getAmountsOut') {
      return routerInterface.encodeFunctionResult(name, [this.amountsOut(args)]);
    }
    throw new Error(`unhandled router call ${name}`);
  }

  private handleFactory(name: string, args: readonly unknown[]): string {
    if (name === 'isPool') {
      return factoryInterface.encodeFunctionResult(name, [this.isPool]);
    }
    if (name === 'getPool') {
      return factoryInterface.encodeFunctionResult(name, [
        this.poolForArgs(args, this.factoryPoolAddress),
      ]);
    }
    throw new Error(`unhandled factory call ${name}`);
  }

  private handlePool(name: string, poolAddress: string): string {
    if (name === 'metadata') {
      const pool = getAddress(poolAddress);
      if (pool === AERO_POOL) {
        return poolInterface.encodeFunctionResult(name, [
          BigNumber.from(6),
          BigNumber.from(18),
          this.reserve0,
          this.reserve1,
          false,
          BASE_TOKENS.USDC.address,
          BASE_TOKENS.AERO.address,
        ]);
      }
      if (pool === WETH_POOL) {
        return poolInterface.encodeFunctionResult(name, [
          BigNumber.from(18),
          BigNumber.from(18),
          this.reserve0,
          this.reserve1,
          false,
          BASE_TOKENS.AERO.address,
          BASE_TOKENS.WETH.address,
        ]);
      }
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
      const decimals =
        getAddress(tokenAddress) === BASE_TOKENS.USDC.address
          ? this.usdcDecimals
          : this.wethDecimals;
      return erc20Interface.encodeFunctionResult(name, [decimals]);
    }
    throw new Error(`unhandled ERC20 call ${name}`);
  }

  private amountsOut(args: readonly unknown[]): readonly BigNumber[] {
    const amountIn = BigNumber.from(args[0]);
    if (this.malformedAmounts) {
      return [amountIn];
    }
    const routes = args[1] as readonly unknown[];
    const configured = this.amountOutByRouteLength.get(routes.length);
    if (routes.length === 2) {
      return [amountIn, BigNumber.from('250000000000000000'), configured ?? this.amountOut];
    }
    return [amountIn, configured ?? this.amountOut];
  }

  private poolForArgs(args: readonly unknown[], defaultPool: string): string {
    if (defaultPool !== POOL) {
      return defaultPool;
    }
    const from = getAddress(String(args[0]));
    const to = getAddress(String(args[1]));
    if (
      (from === BASE_TOKENS.USDC.address && to === BASE_TOKENS.AERO.address) ||
      (from === BASE_TOKENS.AERO.address && to === BASE_TOKENS.USDC.address)
    ) {
      return AERO_POOL;
    }
    if (
      (from === BASE_TOKENS.AERO.address && to === BASE_TOKENS.WETH.address) ||
      (from === BASE_TOKENS.WETH.address && to === BASE_TOKENS.AERO.address)
    ) {
      return WETH_POOL;
    }
    return this.poolAddress;
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

function request(overrides: Partial<QuoteSwapRequest> = {}): QuoteSwapRequest {
  return {
    baseToken: BASE_TOKENS.USDC,
    quoteToken: BASE_TOKENS.WETH,
    amount: '1',
    side: 'SELL',
    poolType: 'volatile',
    slippageBps: 50,
    ...overrides,
  };
}

describe('Aerodrome router connector', () => {
  it('quotes Base volatile exact-input swaps through validated Aerodrome contracts', async () => {
    const provider = new FakeProvider();
    const connector = new Aerodrome(provider, BASE_MAINNET, () => 1_700_000_000);

    const quote = await connector.quoteSwap(request());

    expect(quote.tokenIn.address).toBe(BASE_TOKENS.USDC.address);
    expect(quote.tokenOut.address).toBe(BASE_TOKENS.WETH.address);
    expect(quote.amountInAtomic.toString()).toBe('1000000');
    expect(quote.amountOutAtomic.toString()).toBe('500000000000000000');
    expect(quote.minAmountOutAtomic.toString()).toBe('497500000000000000');
    expect(quote.price).toBe('0.5');
    expect(quote.priceImpactPct).toBeNull();
    expect(quote.poolAddress).toBe(POOL);
    expect(quote.route).toEqual({
      from: BASE_TOKENS.USDC.address,
      to: BASE_TOKENS.WETH.address,
      stable: false,
      factory: BASE_MAINNET.contracts.poolFactory,
    });
  });

  it('selects the best direct or two-hop exact-input route', async () => {
    const provider = new FakeProvider();
    provider.amountOutByRouteLength.set(1, BigNumber.from('400000000000000000'));
    provider.amountOutByRouteLength.set(2, HALF_WETH);
    const connector = new Aerodrome(provider, BASE_MAINNET, () => 1_700_000_000);

    const quote = await connector.quoteSwap(request());

    expect(quote.amountOutAtomic.toString()).toBe(HALF_WETH.toString());
    expect(quote.routes).toHaveLength(2);
    expect(quote.poolAddresses).toEqual([AERO_POOL, WETH_POOL]);
    expect(quote.poolType).toBe('volatile');
    expect(quote.routePoolTypes).toEqual(['volatile', 'volatile']);
  });

  it('plans native ETH input and output swaps with router ETH methods', async () => {
    const ethSellProvider = new FakeProvider();
    const ethSellConnector = new Aerodrome(ethSellProvider, BASE_MAINNET, () => 1_700_000_000);

    const ethSell = await ethSellConnector.executeSwap({
      baseToken: BASE_TOKENS.ETH,
      quoteToken: BASE_TOKENS.USDC,
      amount: '0.5',
      side: 'SELL',
      poolType: 'volatile',
      walletAddress: OWNER,
      deadline: 1_700_000_120,
    });

    expect(ethSell.approval).toBeUndefined();
    expect(ethSell.swap.value).toBe(HALF_WETH.toString());
    expect(routerInterface.parseTransaction({ data: ethSell.swap.data }).name).toBe(
      'swapExactETHForTokens',
    );

    const tokenSellProvider = new FakeProvider();
    tokenSellProvider.allowanceAmount = BigNumber.from(0);
    const tokenSellConnector = new Aerodrome(tokenSellProvider, BASE_MAINNET, () => 1_700_000_000);

    const tokenSell = await tokenSellConnector.executeSwap({
      baseToken: BASE_TOKENS.USDC,
      quoteToken: BASE_TOKENS.ETH,
      amount: '1',
      side: 'SELL',
      poolType: 'volatile',
      walletAddress: OWNER,
      deadline: 1_700_000_120,
    });

    expect(tokenSell.approval?.to).toBe(BASE_TOKENS.USDC.address);
    expect(tokenSell.swap.value).toBe('0');
    expect(routerInterface.parseTransaction({ data: tokenSell.swap.data }).name).toBe(
      'swapExactTokensForETH',
    );

    const poorEthProvider = new FakeProvider();
    poorEthProvider.nativeBalanceAmount = HALF_WETH.sub(1);
    await expect(
      new Aerodrome(poorEthProvider, BASE_MAINNET, () => 1_700_000_000).executeSwap({
        baseToken: BASE_TOKENS.ETH,
        quoteToken: BASE_TOKENS.USDC,
        amount: '0.5',
        side: 'SELL',
        poolType: 'volatile',
        walletAddress: OWNER,
      }),
    ).rejects.toThrow(BalanceError);
  });

  it('rejects unsupported BUY exact-output swaps before touching Aerodrome contracts', async () => {
    const provider = new FakeProvider();
    const connector = new Aerodrome(provider);

    await expect(connector.quoteSwap(request({ side: 'BUY' }))).rejects.toThrow(
      'Aerodrome basic Router does not support BUY exact-output swaps',
    );
    await expect(connector.quoteSwap(request({ side: 'BUY' }))).rejects.toThrow(QuoteError);
    expect(provider.calls).toHaveLength(0);
  });

  it('rejects wrong chain, same tokens, unapproved factory, and missing pool code', async () => {
    const wrongChain = new FakeProvider();
    wrongChain.chainId = 1;
    await expect(new Aerodrome(wrongChain).quoteSwap(request())).rejects.toThrow(
      UnsupportedNetworkError,
    );

    await expect(
      new Aerodrome(new FakeProvider()).quoteSwap(request({ quoteToken: BASE_TOKENS.USDC })),
    ).rejects.toThrow(QuoteError);

    const unapproved = new FakeProvider();
    unapproved.factoryApproved = false;
    await expect(new Aerodrome(unapproved).quoteSwap(request())).rejects.toThrow(
      PoolValidationError,
    );

    const noPoolCode = new FakeProvider();
    noPoolCode.code.delete(POOL);
    await expect(new Aerodrome(noPoolCode).quoteSwap(request({ maxHops: 1 }))).rejects.toThrow(
      PoolValidationError,
    );
  });

  it('rejects bad router config, zero amount, wrong pool tokens, and malformed quotes', async () => {
    const badFactory = new FakeProvider();
    badFactory.defaultFactory = getAddress('0x3333333333333333333333333333333333333333');
    await expect(new Aerodrome(badFactory).quoteSwap(request())).rejects.toThrow(
      PoolValidationError,
    );

    const badRegistry = new FakeProvider();
    badRegistry.factoryRegistry = getAddress('0x4444444444444444444444444444444444444444');
    await expect(new Aerodrome(badRegistry).quoteSwap(request())).rejects.toThrow(
      PoolValidationError,
    );

    await expect(
      new Aerodrome(new FakeProvider()).quoteSwap(request({ amount: '0' })),
    ).rejects.toThrow(QuoteError);

    const wrongTokens = new FakeProvider();
    wrongTokens.token1 = BASE_TOKENS.AERO.address;
    await expect(new Aerodrome(wrongTokens).quoteSwap(request({ maxHops: 1 }))).rejects.toThrow(
      PoolValidationError,
    );

    const malformed = new FakeProvider();
    malformed.malformedAmounts = true;
    await expect(new Aerodrome(malformed).quoteSwap(request({ maxHops: 1 }))).rejects.toThrow(
      QuoteError,
    );
  });

  it('rejects token decimal mismatches and slippage that would produce zero minimum output', async () => {
    await expect(
      new Aerodrome(new FakeProvider()).quoteSwap(
        request({ baseToken: { ...BASE_TOKENS.USDC, decimals: 18 } }),
      ),
    ).rejects.toThrow();

    await expect(
      new Aerodrome(new FakeProvider()).quoteSwap(request({ slippageBps: 10_000 })),
    ).rejects.toThrow(TransactionPreflightError);

    await expect(
      new Aerodrome(new FakeProvider()).quoteSwap(request({ maxHops: 3 as unknown as 1 })),
    ).rejects.toThrow(TransactionPreflightError);
  });

  it('wraps malformed provider responses into connector errors', async () => {
    const malformedRouter = new FakeProvider();
    malformedRouter.malformedCalls.add('router:defaultFactory');
    await expect(new Aerodrome(malformedRouter).quoteSwap(request())).rejects.toThrow(
      PoolValidationError,
    );

    const malformedPool = new FakeProvider();
    malformedPool.malformedCalls.add('pool:metadata');
    await expect(new Aerodrome(malformedPool).quoteSwap(request())).rejects.toThrow(
      PoolValidationError,
    );

    const malformedBalance = new FakeProvider();
    malformedBalance.malformedCalls.add('erc20:balanceOf');
    await expect(
      new Aerodrome(malformedBalance, BASE_MAINNET, () => 1_700_000_000).executeSwap({
        ...request(),
        walletAddress: OWNER,
      }),
    ).rejects.toThrow(BalanceError);

    const malformedAllowance = new FakeProvider();
    malformedAllowance.malformedCalls.add('erc20:allowance');
    await expect(
      new Aerodrome(malformedAllowance, BASE_MAINNET, () => 1_700_000_000).executeSwap({
        ...request(),
        walletAddress: OWNER,
      }),
    ).rejects.toThrow(AllowanceError);
  });

  it('rejects factory-pool disagreement, fake pools, wrong stable flag, zero reserves, and zero output', async () => {
    const mismatch = new FakeProvider();
    mismatch.factoryPoolAddress = getAddress('0x2222222222222222222222222222222222222222');
    await expect(new Aerodrome(mismatch).quoteSwap(request())).rejects.toThrow(PoolValidationError);

    const fakePool = new FakeProvider();
    fakePool.isPool = false;
    await expect(new Aerodrome(fakePool).quoteSwap(request())).rejects.toThrow(PoolValidationError);

    const stableMismatch = new FakeProvider();
    stableMismatch.stable = true;
    await expect(new Aerodrome(stableMismatch).quoteSwap(request({ maxHops: 1 }))).rejects.toThrow(
      PoolValidationError,
    );

    const zeroReserve = new FakeProvider();
    zeroReserve.reserve1 = BigNumber.from(0);
    await expect(new Aerodrome(zeroReserve).quoteSwap(request())).rejects.toThrow(
      PoolValidationError,
    );

    const zeroOut = new FakeProvider();
    zeroOut.amountOut = BigNumber.from(0);
    await expect(new Aerodrome(zeroOut).quoteSwap(request({ maxHops: 1 }))).rejects.toThrow(
      QuoteError,
    );
  });

  it('plans approval and swap transactions without signing or accepting client calldata', async () => {
    const provider = new FakeProvider();
    provider.allowanceAmount = BigNumber.from(0);
    const connector = new Aerodrome(provider, BASE_MAINNET, () => 1_700_000_000);

    const plan = await connector.executeSwap({
      ...request(),
      walletAddress: OWNER,
      recipient: RECIPIENT,
      deadline: 1_700_000_120,
    });

    expect(plan.approval?.to).toBe(BASE_TOKENS.USDC.address);
    expect(plan.approval?.from).toBe(OWNER);
    expect(plan.swap.to).toBe(BASE_MAINNET.contracts.router);
    expect(plan.swap.from).toBe(OWNER);
    expect(plan.swap.value).toBe('0');
    expect(plan.swap.gasEstimate).toBe('180000');
    expect(provider.estimated).toHaveLength(1);
  });

  it('rejects execution with expired deadline, stale output, or insufficient balance', async () => {
    const connector = new Aerodrome(new FakeProvider(), BASE_MAINNET, () => 1_700_000_000);
    await expect(
      connector.executeSwap({ ...request(), walletAddress: OWNER, deadline: 1_699_999_999 }),
    ).rejects.toThrow(TransactionPreflightError);

    const staleProvider = new FakeProvider();
    const staleConnector = new Aerodrome(staleProvider, BASE_MAINNET, () => 1_700_000_000);
    const staleQuote = await staleConnector.quoteSwap(request());
    staleProvider.amountOut = staleQuote.minAmountOutAtomic.sub(1);
    await expect(
      staleConnector.executeQuote({ quoteId: staleQuote.quoteId, walletAddress: OWNER }),
    ).rejects.toThrow(TransactionPreflightError);

    const poorProvider = new FakeProvider();
    poorProvider.balanceAmount = ONE_USDC.sub(1);
    await expect(
      new Aerodrome(poorProvider, BASE_MAINNET, () => 1_700_000_000).executeSwap({
        ...request(),
        walletAddress: OWNER,
      }),
    ).rejects.toThrow(BalanceError);

    const changedChain = new FakeProvider();
    const changedConnector = new Aerodrome(changedChain, BASE_MAINNET, () => 1_700_000_000);
    const changedQuote = await changedConnector.quoteSwap(request());
    changedChain.chainId = 1;
    await expect(
      changedConnector.executeQuote({ quoteId: changedQuote.quoteId, walletAddress: OWNER }),
    ).rejects.toThrow(UnsupportedNetworkError);
  });

  it('executes cached quotes and rejects missing or expired quote ids', async () => {
    const provider = new FakeProvider();
    const connector = new Aerodrome(provider, BASE_MAINNET, () => 1_700_000_000);
    const quote = await connector.quoteSwap(request());

    const plan = await connector.executeQuote({ quoteId: quote.quoteId, walletAddress: OWNER });

    expect(plan.quote.quoteId).toBe(quote.quoteId);
    expect(plan.approval).toBeUndefined();
    await expect(
      connector.executeQuote({ quoteId: 'missing', walletAddress: OWNER }),
    ).rejects.toThrow(QuoteCacheError);

    let now = 1_700_000_000;
    const expiredConnector = new Aerodrome(new FakeProvider(), BASE_MAINNET, () => now);
    const expired = await expiredConnector.quoteSwap(request());
    now = 1_700_000_031;
    await expect(
      expiredConnector.executeQuote({ quoteId: expired.quoteId, walletAddress: OWNER }),
    ).rejects.toThrow(QuoteCacheError);
  });

  it('does not expose mutable quote objects backed by the execution cache', async () => {
    const connector = new Aerodrome(new FakeProvider(), BASE_MAINNET, () => 1_700_000_000);
    const quote = await connector.quoteSwap(request());

    expect(Object.isFrozen(quote)).toBe(true);
    expect(Object.isFrozen(quote.route)).toBe(true);
    expect(() => {
      (quote as unknown as { poolAddress: string }).poolAddress = BASE_TOKENS.AERO.address;
    }).toThrow(TypeError);

    const plan = await connector.executeQuote({ quoteId: quote.quoteId, walletAddress: OWNER });

    expect(plan.quote.poolAddress).toBe(POOL);
    expect(plan.quote.route.to).toBe(BASE_TOKENS.WETH.address);
  });

  it('uses default slippage and exposes thin router-route helpers', async () => {
    const provider = new FakeProvider();
    const connector = new Aerodrome(provider, BASE_MAINNET, () => 1_700_000_000);
    const baseRequest: QuoteSwapRequest = {
      baseToken: BASE_TOKENS.USDC,
      quoteToken: BASE_TOKENS.WETH,
      amount: '1',
      side: 'SELL',
      poolType: 'volatile',
    };

    const quote = await quoteSwapRoute(connector, baseRequest);
    const executePlan = await executeSwapRoute(connector, { ...baseRequest, walletAddress: OWNER });
    const cachedPlan = await executeQuoteRoute(connector, {
      quoteId: quote.quoteId,
      walletAddress: OWNER,
    });

    expect(quote.minAmountOutAtomic).toBe('497500000000000000');
    expect(quote.amountInAtomic).toBe('1000000');
    expect(quote.routePath).toBe('USDC -> WETH');
    expect(executePlan.swap.to).toBe(BASE_MAINNET.contracts.router);
    expect(cachedPlan.quote.quoteId).toBe(quote.quoteId);
  });
});

describe('Aerodrome utilities', () => {
  it('normalizes valid utility inputs', () => {
    expect(checksumAddress(BASE_TOKENS.USDC.address.toLowerCase(), 'token')).toBe(
      BASE_TOKENS.USDC.address,
    );
    expect(validateToken({ ...BASE_TOKENS.USDC, symbol: 'usdc' }).symbol).toBe('USDC');
    expect(atomicAmount('1.25', 6).toString()).toBe('1250000');
    expect(decimalAmount(BigNumber.from('1250000'), 6)).toBe('1.25');
    expect(decimalAmount(BigNumber.from('1'), 0)).toBe('1');
    expect(applySlippageBps(BigNumber.from('10000'), 25).toString()).toBe('9975');
    expect(stableFlag('stable')).toBe(true);
    expect(stableFlag('volatile')).toBe(false);
    expect(nonZeroAddress(OWNER, 'owner')).toBe(OWNER);
    expect(hasDeployedCode('0x6001')).toBe(true);
    expect(hasDeployedCode('0x')).toBe(false);
    expect(hasDeployedCode('0X')).toBe(false);
    expect(safeIntegerTimestamp(1, 'deadline')).toBe(1);
    expect(ratio(BigNumber.from(3), BigNumber.from(2))).toBe('1.5');
    expect(ratio(BigNumber.from(3), BigNumber.from(0))).toBe('0');
  });

  it('rejects malformed utility inputs', () => {
    expect(() => checksumAddress('bad', 'token')).toThrow(TransactionPreflightError);
    expect(() => validateToken({ ...BASE_TOKENS.USDC, symbol: ' ' })).toThrow();
    expect(() => validateToken({ ...BASE_TOKENS.USDC, decimals: 37 })).toThrow();
    expect(() => atomicAmount('01', 6)).toThrow(TransactionPreflightError);
    expect(() => atomicAmount('1.0000001', 6)).toThrow(TransactionPreflightError);
    expect(() => applySlippageBps(BigNumber.from(1), 10_001)).toThrow(TransactionPreflightError);
    expect(() => stableFlag('bad' as 'stable')).toThrow(TransactionPreflightError);
    expect(() => nonZeroAddress('0x0000000000000000000000000000000000000000', 'owner')).toThrow(
      TransactionPreflightError,
    );
    expect(() => safeIntegerTimestamp(0, 'deadline')).toThrow(TransactionPreflightError);
  });
});
