import { Interface } from '@ethersproject/abi';
import { getAddress } from '@ethersproject/address';
import { BigNumber } from '@ethersproject/bignumber';
import { describe, expect, it } from 'vitest';

import { BASE_MAINNET, BASE_TOKENS } from '../src/config.js';
import { ERC20_ABI } from '../src/contracts.js';
import {
  AllowanceError,
  BalanceError,
  QuoteError,
  SlipstreamConfigError,
  TransactionPreflightError,
  UnsupportedNetworkError,
  UnsupportedTokenError,
} from '../src/errors.js';
import { SLIPSTREAM_QUOTER_ABI, SLIPSTREAM_ROUTER_ABI } from '../src/slipstream/contracts.js';
import { executionPlanToDto, quoteToDto } from '../src/slipstream/dto.js';
import { AerodromeSlipstream } from '../src/slipstream/index.js';
import type { SlipstreamQuoteSwapRequest } from '../src/slipstream/types.js';
import type { AerodromeNetworkConfig, AerodromeProvider, CallRequest } from '../src/types.js';

const OWNER = getAddress('0x00000000000000000000000000000000000000aa');
const RECIPIENT = getAddress('0x00000000000000000000000000000000000000bb');
const SLIPSTREAM_ROUTER = getAddress('0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5');
const SLIPSTREAM_QUOTER = getAddress('0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0');
const SLIPSTREAM_POOL_FACTORY = getAddress('0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A');
const ONE_USDC = BigNumber.from('1000000');
const HALF_WETH = BigNumber.from('500000000000000000');
const DEFAULT_GAS = '250000';
const MULTIHOP_PATH = `0x${BASE_TOKENS.USDC.address.slice(2).toLowerCase()}000064${BASE_TOKENS.AERO.address.slice(2).toLowerCase()}0000c8${BASE_TOKENS.WETH.address.slice(2).toLowerCase()}`;

const routerInterface = new Interface(SLIPSTREAM_ROUTER_ABI);
const quoterInterface = new Interface(SLIPSTREAM_QUOTER_ABI);
const erc20Interface = new Interface(ERC20_ABI);

interface ExactInputSingleParams {
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly tickSpacing: number;
  readonly recipient: string;
  readonly amountIn: BigNumber;
  readonly amountOutMinimum: BigNumber;
}

interface ExactInputParams {
  readonly path: string;
  readonly recipient: string;
  readonly amountIn: BigNumber;
  readonly amountOutMinimum: BigNumber;
}

class FakeSlipstreamProvider implements AerodromeProvider {
  public chainId = 8453;
  public allowanceAmount = BigNumber.from(0);
  public balanceAmount = ONE_USDC;
  public gasEstimate = BigNumber.from('210000');
  public estimateGasFailure?: Error;
  public quoteAmountOut = HALF_WETH;
  public readonly malformedCalls = new Set<string>();
  public readonly calls: CallRequest[] = [];
  public readonly estimated: Parameters<AerodromeProvider['estimateGas']>[0][] = [];
  public readonly code = new Set([
    SLIPSTREAM_ROUTER,
    SLIPSTREAM_QUOTER,
    SLIPSTREAM_POOL_FACTORY,
    BASE_TOKENS.USDC.address,
    BASE_TOKENS.WETH.address,
    BASE_TOKENS.AERO.address,
  ]);

  public getNetwork(): Promise<{ readonly chainId: number }> {
    return Promise.resolve({ chainId: this.chainId });
  }

  public getCode(address: string): Promise<string> {
    return Promise.resolve(this.code.has(getAddress(address)) ? '0x6001' : '0x');
  }

  public call(transaction: Readonly<CallRequest>): Promise<string> {
    this.calls.push({ ...transaction });
    const quoterCall = parse(quoterInterface, transaction.data);
    if (quoterCall?.name === 'quoteExactInputSingle') {
      if (getAddress(transaction.to) !== SLIPSTREAM_QUOTER) {
        throw new Error(`unexpected quoter call target ${transaction.to}`);
      }
      const params = quoterCall.args[0] as {
        readonly tokenIn: string;
        readonly tokenOut: string;
        readonly amountIn: BigNumber;
        readonly tickSpacing: number;
      };
      expect(params.tokenIn).toBe(BASE_TOKENS.USDC.address);
      expect(params.tokenOut).toBe(BASE_TOKENS.WETH.address);
      expect(params.amountIn.toString()).toBe(ONE_USDC.toString());
      expect(params.tickSpacing).toBe(100);
      if (this.malformedCalls.has('quoter:quoteExactInputSingle')) {
        return Promise.resolve('0x');
      }
      return Promise.resolve(
        quoterInterface.encodeFunctionResult('quoteExactInputSingle', [
          this.quoteAmountOut,
          BigNumber.from(0),
          0,
          BigNumber.from('125000'),
        ]),
      );
    }
    if (quoterCall?.name === 'quoteExactInput') {
      if (getAddress(transaction.to) !== SLIPSTREAM_QUOTER) {
        throw new Error(`unexpected quoter call target ${transaction.to}`);
      }
      expect(quoterCall.args[0]).toBe(MULTIHOP_PATH);
      expect(BigNumber.from(quoterCall.args[1]).toString()).toBe(ONE_USDC.toString());
      if (this.malformedCalls.has('quoter:quoteExactInput')) {
        return Promise.resolve('0x');
      }
      return Promise.resolve(
        quoterInterface.encodeFunctionResult('quoteExactInput', [
          this.quoteAmountOut,
          [BigNumber.from(0)],
          [0],
          BigNumber.from('125000'),
        ]),
      );
    }

    const erc20Call = parse(erc20Interface, transaction.data);
    if (erc20Call?.name === 'decimals') {
      if (this.malformedCalls.has('erc20:decimals')) {
        return Promise.resolve('0x');
      }
      return Promise.resolve(
        erc20Interface.encodeFunctionResult('decimals', [
          getAddress(transaction.to) === BASE_TOKENS.USDC.address ? 6 : 18,
        ]),
      );
    }
    if (erc20Call?.name === 'allowance') {
      if (this.malformedCalls.has('erc20:allowance')) {
        return Promise.resolve('0x');
      }
      return Promise.resolve(
        erc20Interface.encodeFunctionResult('allowance', [this.allowanceAmount]),
      );
    }
    if (erc20Call?.name === 'balanceOf') {
      if (this.malformedCalls.has('erc20:balanceOf')) {
        return Promise.resolve('0x');
      }
      return Promise.resolve(
        erc20Interface.encodeFunctionResult('balanceOf', [this.balanceAmount]),
      );
    }
    throw new Error(`unhandled fake provider call to ${transaction.to}`);
  }

  public estimateGas(
    transaction: Parameters<AerodromeProvider['estimateGas']>[0],
  ): Promise<BigNumber> {
    this.estimated.push({ ...transaction });
    if (this.estimateGasFailure !== undefined) {
      return Promise.reject(this.estimateGasFailure);
    }
    return Promise.resolve(this.gasEstimate);
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

function slipstreamConfig(): AerodromeNetworkConfig {
  return {
    ...BASE_MAINNET,
    contracts: {
      ...BASE_MAINNET.contracts,
      slipstream: {
        router: SLIPSTREAM_ROUTER,
        quoter: SLIPSTREAM_QUOTER,
        poolFactory: SLIPSTREAM_POOL_FACTORY,
      },
    },
  };
}

function request(overrides: Partial<SlipstreamQuoteSwapRequest> = {}): SlipstreamQuoteSwapRequest {
  return {
    baseToken: BASE_TOKENS.USDC,
    quoteToken: BASE_TOKENS.WETH,
    amount: '1',
    side: 'SELL',
    route: [{ tokenOut: BASE_TOKENS.WETH, tickSpacing: 100 }],
    slippageBps: 50,
    ...overrides,
  };
}

describe('Aerodrome Slipstream connector', () => {
  it('fails closed with a typed config error when Slipstream contracts are missing', async () => {
    const provider = new FakeSlipstreamProvider();
    const baseContracts = slipstreamConfig().contracts;
    const connector = new AerodromeSlipstream(provider, {
      ...slipstreamConfig(),
      contracts: {
        router: baseContracts.router,
        poolFactory: baseContracts.poolFactory,
        factoryRegistry: baseContracts.factoryRegistry,
        weth: baseContracts.weth,
      },
    });

    await expect(connector.quoteSwap(request())).rejects.toThrow(SlipstreamConfigError);
    expect(provider.calls).toHaveLength(0);
  });

  it('returns an exact-input quote DTO through the configured quoter', async () => {
    const connector = new AerodromeSlipstream(
      new FakeSlipstreamProvider(),
      slipstreamConfig(),
      () => 1_700_000_000,
    );

    const dto = quoteToDto(await connector.quoteSwap(request()));

    expect(dto.tokenIn).toBe(BASE_TOKENS.USDC.address);
    expect(dto.tokenOut).toBe(BASE_TOKENS.WETH.address);
    expect(dto.amountInAtomic).toBe('1000000');
    expect(dto.amountOutAtomic).toBe('500000000000000000');
    expect(dto.minAmountOutAtomic).toBe('497500000000000000');
    expect(dto.routePath).toBe('USDC --100--> WETH');
    expect(dto.router).toBe(SLIPSTREAM_ROUTER);
    expect(dto.quoter).toBe(SLIPSTREAM_QUOTER);
    expect(dto.expiresAt).toBe(1_700_000_030);
  });

  it('keeps the Base Slipstream official address regression fixture current', () => {
    const contracts = slipstreamConfig().contracts.slipstream;

    expect(contracts?.router).toBe(SLIPSTREAM_ROUTER);
    expect(contracts?.quoter).toBe(SLIPSTREAM_QUOTER);
    expect(contracts?.poolFactory).toBe(SLIPSTREAM_POOL_FACTORY);
  });

  it('rejects spoofed Base Slipstream config before quoting', async () => {
    const provider = new FakeSlipstreamProvider();
    const connector = new AerodromeSlipstream(provider, {
      ...slipstreamConfig(),
      contracts: {
        ...slipstreamConfig().contracts,
        slipstream: {
          router: getAddress('0x1111111111111111111111111111111111111111'),
          quoter: SLIPSTREAM_QUOTER,
          poolFactory: SLIPSTREAM_POOL_FACTORY,
        },
      },
    });

    await expect(connector.quoteSwap(request())).rejects.toThrow(SlipstreamConfigError);
    expect(() => connector.buildApprovalTransaction(OWNER, BASE_TOKENS.USDC, ONE_USDC)).toThrow(
      SlipstreamConfigError,
    );
    expect(provider.calls).toHaveLength(0);
  });

  it('requires deployed code at the official Slipstream poolFactory', async () => {
    const provider = new FakeSlipstreamProvider();
    provider.code.delete(SLIPSTREAM_POOL_FACTORY);
    const connector = new AerodromeSlipstream(provider, slipstreamConfig());

    await expect(connector.quoteSwap(request())).rejects.toThrow(SlipstreamConfigError);
    expect(provider.calls).toHaveLength(0);
  });

  it('plans approval and exactInputSingle calldata without signing or broadcasting', async () => {
    const provider = new FakeSlipstreamProvider();
    const connector = new AerodromeSlipstream(provider, slipstreamConfig(), () => 1_700_000_000);

    const plan = await connector.executeSwap({
      ...request(),
      walletAddress: OWNER,
      recipient: RECIPIENT,
      deadline: 1_700_000_120,
    });

    expect(plan.approval?.to).toBe(BASE_TOKENS.USDC.address);
    expect(plan.approval?.from).toBe(OWNER);
    expect(plan.swap.to).toBe(SLIPSTREAM_ROUTER);
    expect(plan.swap.from).toBe(OWNER);
    expect(plan.swap.value).toBe('0');
    expect(plan.swap.gasEstimate).toBe(DEFAULT_GAS);
    expect(provider.estimated).toHaveLength(0);

    const parsedSwap = routerInterface.parseTransaction({ data: plan.swap.data });
    const swapParams = parsedSwap.args[0] as ExactInputSingleParams;
    expect(parsedSwap.name).toBe('exactInputSingle');
    expect(swapParams.tokenIn).toBe(BASE_TOKENS.USDC.address);
    expect(swapParams.tokenOut).toBe(BASE_TOKENS.WETH.address);
    expect(swapParams.tickSpacing).toBe(100);
    expect(swapParams.recipient).toBe(RECIPIENT);
    expect(swapParams.amountIn.toString()).toBe('1000000');
    expect(swapParams.amountOutMinimum.toString()).toBe('497500000000000000');
  });

  it('plans multi-hop exactInput calldata and DTOs without an approval when allowance is enough', async () => {
    const provider = new FakeSlipstreamProvider();
    provider.allowanceAmount = ONE_USDC;
    const connector = new AerodromeSlipstream(provider, slipstreamConfig(), () => 1_700_000_000);

    const plan = await connector.executeSwap({
      ...request({
        route: [
          { tokenOut: BASE_TOKENS.AERO, tickSpacing: 100 },
          { tokenOut: BASE_TOKENS.WETH, tickSpacing: 200 },
        ],
      }),
      walletAddress: OWNER,
      deadline: 1_700_000_120,
    });
    const dto = executionPlanToDto(plan);

    expect(dto.approval).toBeUndefined();
    expect(dto.quote.routePath).toBe('USDC --100--> AERO --200--> WETH');
    const parsedSwap = routerInterface.parseTransaction({ data: plan.swap.data });
    const swapParams = parsedSwap.args[0] as ExactInputParams;
    expect(parsedSwap.name).toBe('exactInput');
    expect(swapParams.path).toBe(plan.quote.encodedPath);
    expect(swapParams.recipient).toBe(OWNER);
    expect(swapParams.amountIn.toString()).toBe('1000000');
    expect(swapParams.amountOutMinimum.toString()).toBe('497500000000000000');
    expect(provider.estimated).toHaveLength(1);
    expect(plan.swap.gasEstimate).toBe('210000');
  });

  it('uses the canonical QuoterV2 array ABI for multi-hop fake responses', () => {
    const encoded = quoterInterface.encodeFunctionResult('quoteExactInput', [
      HALF_WETH,
      [BigNumber.from('123')],
      [7],
      BigNumber.from('125000'),
    ]);
    const decoded = quoterInterface.decodeFunctionResult('quoteExactInput', encoded);
    const sqrtPriceX96AfterList = Array.from(decoded[1] as readonly BigNumber[], (value) =>
      value.toString(),
    );
    const initializedTicksCrossedList = Array.from(decoded[2] as readonly number[], (value) =>
      value.toString(),
    );

    expect(BigNumber.from(decoded[0]).toString()).toBe(HALF_WETH.toString());
    expect(sqrtPriceX96AfterList).toEqual(['123']);
    expect(initializedTicksCrossedList).toEqual(['7']);
  });

  it('wraps swap gas estimation failures only when no approval is needed', async () => {
    const approvedProvider = new FakeSlipstreamProvider();
    approvedProvider.allowanceAmount = ONE_USDC;
    approvedProvider.estimateGasFailure = new Error('node rejected estimate');
    await expect(
      new AerodromeSlipstream(approvedProvider, slipstreamConfig()).executeSwap({
        ...request(),
        walletAddress: OWNER,
      }),
    ).rejects.toThrow(TransactionPreflightError);
    expect(approvedProvider.estimated).toHaveLength(1);

    const needsApprovalProvider = new FakeSlipstreamProvider();
    needsApprovalProvider.estimateGasFailure = new Error(
      'dependent swap would fail before approve',
    );
    const plan = await new AerodromeSlipstream(
      needsApprovalProvider,
      slipstreamConfig(),
    ).executeSwap({
      ...request(),
      walletAddress: OWNER,
    });

    expect(plan.approval).toBeDefined();
    expect(plan.swap.gasEstimate).toBe(DEFAULT_GAS);
    expect(needsApprovalProvider.estimated).toHaveLength(0);
  });

  it('rejects bad config, network, routes, tokens, quotes, and execution preflight failures', async () => {
    await expect(
      new AerodromeSlipstream(new FakeSlipstreamProvider(), {
        ...slipstreamConfig(),
        contracts: {
          ...slipstreamConfig().contracts,
          slipstream: {
            router: '0x0000000000000000000000000000000000000000',
            quoter: SLIPSTREAM_QUOTER,
            poolFactory: SLIPSTREAM_POOL_FACTORY,
          },
        },
      }).quoteSwap(request()),
    ).rejects.toThrow(SlipstreamConfigError);

    const missingRouterCode = new FakeSlipstreamProvider();
    missingRouterCode.code.delete(SLIPSTREAM_ROUTER);
    await expect(
      new AerodromeSlipstream(missingRouterCode, slipstreamConfig()).quoteSwap(request()),
    ).rejects.toThrow(SlipstreamConfigError);

    const wrongChain = new FakeSlipstreamProvider();
    wrongChain.chainId = 1;
    await expect(
      new AerodromeSlipstream(wrongChain, slipstreamConfig()).quoteSwap(request()),
    ).rejects.toThrow(UnsupportedNetworkError);

    const connector = new AerodromeSlipstream(
      new FakeSlipstreamProvider(),
      slipstreamConfig(),
      () => 1_700_000_000,
    );
    await expect(connector.quoteSwap(request({ side: 'BUY' }))).rejects.toThrow(QuoteError);
    await expect(connector.quoteSwap(request({ amount: '0' }))).rejects.toThrow(QuoteError);
    await expect(connector.quoteSwap(request({ route: [] }))).rejects.toThrow(
      TransactionPreflightError,
    );
    await expect(connector.quoteSwap(request({ quoteToken: BASE_TOKENS.USDC }))).rejects.toThrow(
      QuoteError,
    );
    await expect(
      connector.quoteSwap(request({ route: [{ tokenOut: BASE_TOKENS.AERO, tickSpacing: 100 }] })),
    ).rejects.toThrow(QuoteError);
    await expect(
      connector.quoteSwap(request({ route: [{ tokenOut: BASE_TOKENS.WETH, tickSpacing: 0 }] })),
    ).rejects.toThrow(TransactionPreflightError);
    await expect(connector.quoteSwap(request({ baseToken: BASE_TOKENS.ETH }))).rejects.toThrow(
      UnsupportedTokenError,
    );
    await expect(
      connector.quoteSwap(request({ baseToken: { ...BASE_TOKENS.USDC, decimals: 18 } })),
    ).rejects.toThrow(UnsupportedTokenError);

    const zeroQuote = new FakeSlipstreamProvider();
    zeroQuote.quoteAmountOut = BigNumber.from(0);
    await expect(
      new AerodromeSlipstream(zeroQuote, slipstreamConfig()).quoteSwap(request()),
    ).rejects.toThrow(QuoteError);

    const malformedQuote = new FakeSlipstreamProvider();
    malformedQuote.malformedCalls.add('quoter:quoteExactInputSingle');
    await expect(
      new AerodromeSlipstream(malformedQuote, slipstreamConfig()).quoteSwap(request()),
    ).rejects.toThrow(QuoteError);

    await expect(
      connector.executeSwap({
        ...request(),
        walletAddress: OWNER,
        deadline: 1_699_999_999,
      }),
    ).rejects.toThrow(TransactionPreflightError);

    const poorProvider = new FakeSlipstreamProvider();
    poorProvider.balanceAmount = ONE_USDC.sub(1);
    await expect(
      new AerodromeSlipstream(poorProvider, slipstreamConfig()).executeSwap({
        ...request(),
        walletAddress: OWNER,
      }),
    ).rejects.toThrow(BalanceError);

    const malformedBalance = new FakeSlipstreamProvider();
    malformedBalance.malformedCalls.add('erc20:balanceOf');
    await expect(
      new AerodromeSlipstream(malformedBalance, slipstreamConfig()).executeSwap({
        ...request(),
        walletAddress: OWNER,
      }),
    ).rejects.toThrow(BalanceError);

    const malformedAllowance = new FakeSlipstreamProvider();
    malformedAllowance.malformedCalls.add('erc20:allowance');
    await expect(
      new AerodromeSlipstream(malformedAllowance, slipstreamConfig()).executeSwap({
        ...request(),
        walletAddress: OWNER,
      }),
    ).rejects.toThrow(AllowanceError);
  });
});
