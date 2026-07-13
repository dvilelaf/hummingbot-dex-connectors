import { BigNumber } from '@ethersproject/bignumber';
import { describe, expect, it } from 'vitest';

import {
  executeAerodromeGatewaySwapPlan,
  type GatewayTransactionBroadcastResponse,
  type ReceiptLog,
  type TransactionReceipt,
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

const TRANSFER_EVENT_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const WALLET = '0x1111111111111111111111111111111111111111';
const POOL = '0x2222222222222222222222222222222222222222';

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

function paddedAddress(addr: string): string {
  return '0x' + '000000000000000000000000' + addr.slice(2).toLowerCase();
}

const wethTransferOut: ReceiptLog = {
  address: weth.address,
  topics: [
    TRANSFER_EVENT_TOPIC,
    paddedAddress(WALLET),
    paddedAddress(POOL),
  ],
  data: '0x00000000000000000000000000000000000000000000000014d1120d7b160000',
};

const usdcTransferIn: ReceiptLog = {
  address: usdc.address,
  topics: [
    TRANSFER_EVENT_TOPIC,
    paddedAddress(POOL),
    paddedAddress(WALLET),
  ],
  data: '0x000000000000000000000000000000000000000000000000000000010c388d00',
};

const approvalReceipt: TransactionReceipt = {
  status: 1,
  gasUsed: '50000',
  effectiveGasPrice: '1000000000',
  blockTimestamp: 1_699_999_999,
  logs: [],
};

const swapReceipt: TransactionReceipt = {
  status: 1,
  gasUsed: '200000',
  effectiveGasPrice: '1500000000',
  blockTimestamp: 1_700_000_000,
  logs: [wethTransferOut, usdcTransferIn],
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

  it('executes approval then swap, returns confirmed response with economics from receipts', async () => {
    const seen: string[] = [];
    let callIndex = 0;

    const result = await executeAerodromeGatewaySwapPlan(executionPlan(), {
      executeTransaction: async (
        transaction: PlannedTransaction,
      ): Promise<GatewayTransactionBroadcastResponse> => {
        await Promise.resolve();
        seen.push(transaction.to);
        callIndex++;
        const receipt =
          callIndex === 1 ? approvalReceipt : swapReceipt;
        return {
          status: 'CONFIRMED',
          txHash: `tx-${callIndex}`,
          receipt,
        };
      },
    });

    expect(seen).toEqual([
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '0x2222222222222222222222222222222222222222',
    ]);

    expect(result.signature).toBe('tx-2');
    expect(result.status).toBe(1);
    expect(result.executedAt).toBe('2023-11-14T22:13:20.000Z');
    expect(result.transactions).toEqual([
      { kind: 'approval', signature: 'tx-1', status: 'CONFIRMED' },
      { kind: 'swap', signature: 'tx-2', status: 'CONFIRMED' },
    ]);
    expect(result.data).toEqual({
      tokenIn: 'WETH',
      tokenOut: 'USDC',
      amountIn: '1.5',
      amountOut: '4500',
      fee: '0.00035',
      feeAsset: 'ETH',
    });
  });

  it('throws when confirmed but missing receipt evidence', async () => {
    await expect(
      executeAerodromeGatewaySwapPlan(executionPlan(), {
        executeTransaction: async (): Promise<GatewayTransactionBroadcastResponse> => {
          await Promise.resolve();
          return { status: 'CONFIRMED', txHash: 'tx-1' };
        },
      }),
    ).rejects.toThrow('missing status-1 receipt evidence');
  });

  it('throws when swap confirmed but receipt lacks Transfer events', async () => {
    const emptyReceipt: TransactionReceipt = {
      status: 1,
      gasUsed: '200000',
      effectiveGasPrice: '1500000000',
      blockTimestamp: 1_700_000_000,
      logs: [],
    };

    await expect(
      executeAerodromeGatewaySwapPlan(executionPlan(), {
        executeTransaction: async (
          transaction: PlannedTransaction,
        ): Promise<GatewayTransactionBroadcastResponse> => {
          await Promise.resolve();
          const hash =
            transaction.to === '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
              ? 'tx-approval'
              : 'tx-swap';
          const receipt =
            transaction.to === '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
              ? approvalReceipt
              : emptyReceipt;
          return { status: 'CONFIRMED', txHash: hash, receipt };
        },
      }),
    ).rejects.toThrow('missing expected Transfer events');
  });

  it('returns SUBMITTED without economics when status is not confirmed', async () => {
    const result = await executeAerodromeGatewaySwapPlan(executionPlan(), {
      executeTransaction: async (): Promise<GatewayTransactionBroadcastResponse> => {
        await Promise.resolve();
        return { status: 'SUBMITTED', txHash: 'tx-pending' };
      },
    });

    expect(result.status).toBe('SUBMITTED');
    expect(result.executedAt).toBeUndefined();
    expect(result.data).toBeUndefined();
  });

  it('returns FAILED without economics when approval fails', async () => {
    const result = await executeAerodromeGatewaySwapPlan(executionPlan(), {
      executeTransaction: async (
        transaction: PlannedTransaction,
      ): Promise<GatewayTransactionBroadcastResponse> => {
        await Promise.resolve();
        const hash =
          transaction.to === '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
            ? 'tx-approval'
            : 'tx-swap';
        const status =
          transaction.to === '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
            ? ('FAILED' as const)
            : ('CONFIRMED' as const);
        return { status, txHash: hash };
      },
    });

    expect(result.status).toBe('FAILED');
    expect(result.executedAt).toBeUndefined();
    expect(result.data).toBeUndefined();
    expect(result.transactions).toEqual([
      { kind: 'approval', signature: 'tx-approval', status: 'FAILED' },
    ]);
  });

  it('public transactions strip raw receipt evidence', async () => {
    const result = await executeAerodromeGatewaySwapPlan(executionPlan(), {
      executeTransaction: async (
        transaction: PlannedTransaction,
      ): Promise<GatewayTransactionBroadcastResponse> => {
        await Promise.resolve();
        const hash =
          transaction.to === '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
            ? 'tx-approval'
            : 'tx-swap';
        return { status: 1, txHash: hash, receipt: swapReceipt };
      },
    });

    for (const tx of result.transactions) {
      expect(tx).not.toHaveProperty('receipt');
      expect(Object.keys(tx).sort()).toEqual(['kind', 'signature', 'status']);
    }
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

  it('computes net tokenIn and net tokenOut with refunds and reverse transfers', async () => {
    const wethRefund: ReceiptLog = {
      address: weth.address,
      topics: [
        TRANSFER_EVENT_TOPIC,
        paddedAddress(POOL),
        paddedAddress(WALLET),
      ],
      data: '0x000000000000000000000000000000000000000000000000016345785d8a0000',
    };

    const usdcReverseTransfer: ReceiptLog = {
      address: usdc.address,
      topics: [
        TRANSFER_EVENT_TOPIC,
        paddedAddress(WALLET),
        paddedAddress(POOL),
      ],
      data: '0x0000000000000000000000000000000000000000000000000000000000989680',
    };

    const receiptWithRefund: TransactionReceipt = {
      ...swapReceipt,
      logs: [wethTransferOut, usdcTransferIn, wethRefund, usdcReverseTransfer],
    };

    const result = await executeAerodromeGatewaySwapPlan(executionPlan(), {
      executeTransaction: async (
        transaction: PlannedTransaction,
      ): Promise<GatewayTransactionBroadcastResponse> => {
        await Promise.resolve();
        const hash =
          transaction.to === '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
            ? 'tx-approval'
            : 'tx-swap';
        const receipt =
          transaction.to === '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
            ? approvalReceipt
            : receiptWithRefund;
        return { status: 'CONFIRMED', txHash: hash, receipt };
      },
    });

    expect(result.status).toBe(1);
    expect(result.data).toEqual({
      tokenIn: 'WETH',
      tokenOut: 'USDC',
      amountIn: '1.4',
      amountOut: '4490',
      fee: '0.00035',
      feeAsset: 'ETH',
    });
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
