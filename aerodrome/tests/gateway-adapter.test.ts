import { BigNumber } from '@ethersproject/bignumber';
import { describe, expect, it } from 'vitest';

import {
  executeAerodromeGatewaySwapPlan,
  type GatewayTransactionBroadcastResponse,
  planAerodromeGatewaySwap,
  quoteAerodromeForGateway,
} from '../src/gateway-adapter.js';
import type { Aerodrome } from '../src/aerodrome.js';
import type {
  AerodromeExecutionPlan,
  AerodromeQuote,
  ExecuteSwapRequest,
  PlannedTransaction,
  QuoteSwapRequest,
  TokenInfo,
} from '../src/types.js';

const weth: TokenInfo = {
  address: '0x4200000000000000000000000000000000000006',
  decimals: 18,
  symbol: 'WETH',
};
const usdc: TokenInfo = {
  address: '0x833589fCD6eDb6E08f4c7C32D4f71B54bdA02913',
  decimals: 6,
  symbol: 'USDC',
};

describe('Aerodrome Gateway adapter', () => {
  it('maps Gateway quote requests to Aerodrome requests and normalizes response', async () => {
    const connector = fakeAerodrome({
      quoteSwap: async (request: QuoteSwapRequest): Promise<AerodromeQuote> => {
        await Promise.resolve();
        expect(request).toMatchObject({
          amount: '1.5',
          baseToken: weth,
          maxHops: 1,
          poolType: 'stable',
          quoteToken: usdc,
          side: 'SELL',
          slippageBps: 75,
          walletAddress: '0x1111111111111111111111111111111111111111',
        });
        return quote();
      },
    });

    const response = await quoteAerodromeForGateway(
      connector,
      {
        amount: 1.5,
        baseToken: 'WETH',
        poolType: 'stable',
        quoteToken: 'USDC',
        side: 'SELL',
        slippagePct: 0.75,
        walletAddress: '0x1111111111111111111111111111111111111111',
      },
      resolveToken,
    );

    expect(response).toEqual({
      amountIn: 1.5,
      amountOut: 4500,
      maxAmountIn: 1.5,
      minAmountOut: 4450,
      poolAddress: '0x3333333333333333333333333333333333333333',
      price: 3000,
      priceImpactPct: 0,
      quoteId: 'quote-1',
      routePath:
        '0x4200000000000000000000000000000000000006->0x833589fCD6eDb6E08f4c7C32D4f71B54bdA02913',
      slippagePct: 0.75,
      tokenIn: weth.address,
      tokenOut: usdc.address,
    });
  });

  it('coerces Gateway maxHops query values', async () => {
    const connector = fakeAerodrome({
      quoteSwap: async (request: QuoteSwapRequest): Promise<AerodromeQuote> => {
        await Promise.resolve();
        expect(request.maxHops).toBe(2);
        return quote();
      },
    });

    await quoteAerodromeForGateway(
      connector,
      {
        amount: 1,
        baseToken: 'WETH',
        maxHops: '2',
        quoteToken: 'USDC',
        side: 'SELL',
      },
      resolveToken,
    );
  });

  it('rejects BUY because Aerodrome exact-output swaps are not implemented', async () => {
    await expect(
      quoteAerodromeForGateway(
        fakeAerodrome({
          quoteSwap: async (): Promise<AerodromeQuote> => {
            await Promise.resolve();
            return quote();
          },
        }),
        {
          amount: 1,
          baseToken: 'WETH',
          quoteToken: 'USDC',
          side: 'BUY',
        },
        resolveToken,
      ),
    ).rejects.toThrow('SELL swaps only');
  });

  it('plans execution through Aerodrome without sending transactions itself', async () => {
    const connector = fakeAerodrome({
      executeSwap: async (request: ExecuteSwapRequest): Promise<AerodromeExecutionPlan> => {
        await Promise.resolve();
        expect(request.walletAddress).toBe('0x1111111111111111111111111111111111111111');
        return executionPlan();
      },
    });

    const plan = await planAerodromeGatewaySwap(
      connector,
      {
        amount: 1,
        baseToken: 'WETH',
        quoteToken: 'USDC',
        side: 'SELL',
        walletAddress: '0x1111111111111111111111111111111111111111',
      },
      resolveToken,
    );

    expect(plan.swap.to).toBe('0x2222222222222222222222222222222222222222');
  });

  it('executes approval then swap through injected Gateway executor', async () => {
    const seen: string[] = [];
    const result = await executeAerodromeGatewaySwapPlan(executionPlan(), {
      executeTransaction: async (
        transaction: PlannedTransaction,
      ): Promise<GatewayTransactionBroadcastResponse> => {
        await Promise.resolve();
        seen.push(transaction.to);
        return { status: 'CONFIRMED', txHash: `tx-${seen.length}` };
      },
    });

    expect(seen).toEqual([
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '0x2222222222222222222222222222222222222222',
    ]);
    expect(result).toEqual({
      signature: 'tx-2',
      status: 'CONFIRMED',
      transactions: [
        { kind: 'approval', signature: 'tx-1', status: 'CONFIRMED' },
        { kind: 'swap', signature: 'tx-2', status: 'CONFIRMED' },
      ],
    });
  });

  it('rejects execution responses without transaction evidence', async () => {
    await expect(
      executeAerodromeGatewaySwapPlan(executionPlan(), {
        executeTransaction: async (): Promise<GatewayTransactionBroadcastResponse> => {
          await Promise.resolve();
          return { status: 'SUBMITTED' };
        },
      }),
    ).rejects.toThrow('returned no hash');
  });
});

function fakeAerodrome(
  overrides: Partial<Pick<Aerodrome, 'executeSwap' | 'quoteSwap'>>,
): Aerodrome {
  return overrides as Aerodrome;
}

function resolveToken(symbol: string): TokenInfo {
  if (symbol === 'WETH') {
    return weth;
  }
  if (symbol === 'USDC') {
    return usdc;
  }
  throw new Error(`unknown token ${symbol}`);
}

function quote(): AerodromeQuote {
  return {
    amountIn: '1.5',
    amountInAtomic: BigNumber.from('1500000000000000000'),
    amountOut: '4500',
    amountOutAtomic: BigNumber.from('4500000000'),
    expiresAt: 1_800_000_000,
    minAmountOut: '4450',
    minAmountOutAtomic: BigNumber.from('4450000000'),
    poolAddress: '0x3333333333333333333333333333333333333333',
    poolAddresses: ['0x3333333333333333333333333333333333333333'],
    poolType: 'stable',
    price: '3000',
    priceImpactPct: null,
    quoteId: 'quote-1',
    route: {
      factory: '0x4444444444444444444444444444444444444444',
      from: weth.address,
      stable: true,
      to: usdc.address,
    },
    routePoolTypes: ['stable'],
    routes: [
      {
        factory: '0x4444444444444444444444444444444444444444',
        from: weth.address,
        stable: true,
        to: usdc.address,
      },
    ],
    tokenIn: weth,
    tokenOut: usdc,
  };
}

function executionPlan(): AerodromeExecutionPlan {
  return {
    approval: {
      data: '0xapprove',
      from: '0x1111111111111111111111111111111111111111',
      gasEstimate: '250000',
      to: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      value: '0',
    },
    quote: quote(),
    swap: {
      data: '0xswap',
      from: '0x1111111111111111111111111111111111111111',
      gasEstimate: '250000',
      to: '0x2222222222222222222222222222222222222222',
      value: '0',
    },
  };
}
