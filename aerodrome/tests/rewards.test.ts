import { Interface } from '@ethersproject/abi';
import { getAddress } from '@ethersproject/address';
import { BigNumber } from '@ethersproject/bignumber';
import { describe, expect, it } from 'vitest';

import { BASE_MAINNET, BASE_TOKENS } from '../src/config.js';
import { ERC20_ABI, GAUGE_ABI, VOTER_ABI } from '../src/contracts.js';
import { BalanceError, PoolValidationError, TransactionPreflightError } from '../src/errors.js';
import {
  planGaugeDeposit,
  planGaugeRewardClaim,
  planGaugeWithdraw,
  planVoterClaimBribes,
  planVoterClaimFees,
  planVoterClaimRewards,
} from '../src/rewards/index.js';
import type { AerodromeProvider, CallRequest, TransactionRequest } from '../src/types.js';

const OWNER = getAddress('0x00000000000000000000000000000000000000aa');
const RECIPIENT = getAddress('0x00000000000000000000000000000000000000bb');
const POOL = getAddress('0x1111111111111111111111111111111111111111');
const GAUGE = getAddress('0x2222222222222222222222222222222222222222');
const FEE_REWARD = getAddress('0x3333333333333333333333333333333333333333');
const BRIBE_REWARD = getAddress('0x4444444444444444444444444444444444444444');
const VOTER = BASE_MAINNET.contracts.voter;
const LP_TOKEN = {
  symbol: 'USDC-WETH-LP',
  address: POOL,
  decimals: 18,
};
const LIQUIDITY = BigNumber.from('1000000000000000000');

const erc20Interface = new Interface(ERC20_ABI);
const gaugeInterface = new Interface(GAUGE_ABI);
const voterInterface = new Interface(VOTER_ABI);

class RewardsProvider implements AerodromeProvider {
  public chainId = 8453;
  public allowanceAmount = BigNumber.from(0);
  public balanceAmount = LIQUIDITY;
  public gasEstimate = BigNumber.from('210000');
  public gaugeAddress = GAUGE;
  public feeRewardAddress = FEE_REWARD;
  public bribeRewardAddress = BRIBE_REWARD;
  public stakingTokenAddress = LP_TOKEN.address;
  public estimateGasError: Error | undefined;
  public readonly codeAddresses = new Set([VOTER, GAUGE]);
  public readonly registeredGauges = new Set([GAUGE]);
  public readonly calls: CallRequest[] = [];
  public readonly estimated: TransactionRequest[] = [];

  public getNetwork(): Promise<{ readonly chainId: number }> {
    return Promise.resolve({ chainId: this.chainId });
  }

  public getCode(address: string): Promise<string> {
    return Promise.resolve(this.codeAddresses.has(getAddress(address)) ? '0x6001' : '0x');
  }

  public call(transaction: Readonly<CallRequest>): Promise<string> {
    this.calls.push({ ...transaction });
    const erc20Call = parse(erc20Interface, transaction.data);
    if (erc20Call?.name === 'allowance') {
      return Promise.resolve(
        erc20Interface.encodeFunctionResult('allowance', [this.allowanceAmount]),
      );
    }
    if (erc20Call?.name === 'balanceOf') {
      return Promise.resolve(
        erc20Interface.encodeFunctionResult('balanceOf', [this.balanceAmount]),
      );
    }
    const voterCall = parse(voterInterface, transaction.data);
    if (voterCall?.name === 'gauges') {
      return Promise.resolve(voterInterface.encodeFunctionResult('gauges', [this.gaugeAddress]));
    }
    if (voterCall?.name === 'isGauge') {
      return Promise.resolve(
        voterInterface.encodeFunctionResult('isGauge', [
          this.registeredGauges.has(getAddress(String(voterCall.args[0]))),
        ]),
      );
    }
    if (voterCall?.name === 'gaugeToFees') {
      return Promise.resolve(
        voterInterface.encodeFunctionResult('gaugeToFees', [this.feeRewardAddress]),
      );
    }
    if (voterCall?.name === 'gaugeToBribe') {
      return Promise.resolve(
        voterInterface.encodeFunctionResult('gaugeToBribe', [this.bribeRewardAddress]),
      );
    }
    const gaugeCall = parse(gaugeInterface, transaction.data);
    if (gaugeCall?.name === 'stakingToken') {
      return Promise.resolve(
        gaugeInterface.encodeFunctionResult('stakingToken', [this.stakingTokenAddress]),
      );
    }
    throw new Error(`unhandled rewards call to ${transaction.to}`);
  }

  public estimateGas(transaction: Readonly<TransactionRequest>): Promise<BigNumber> {
    this.estimated.push({ ...transaction });
    if (this.estimateGasError !== undefined) {
      return Promise.reject(this.estimateGasError);
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

function args(iface: Interface, data: string): readonly unknown[] {
  return [...iface.parseTransaction({ data }).args];
}

function addressMatrix(value: unknown): readonly (readonly string[])[] {
  return (value as readonly (readonly string[])[]).map((tokens) => [...tokens]);
}

function callNames(calls: readonly CallRequest[]): readonly string[] {
  return calls.map((call) => {
    const erc20Call = parse(erc20Interface, call.data);
    const voterCall = parse(voterInterface, call.data);
    const gaugeCall = parse(gaugeInterface, call.data);
    return erc20Call?.name ?? voterCall?.name ?? gaugeCall?.name ?? 'unknown';
  });
}

describe('Aerodrome rewards transaction planning', () => {
  it('plans LP gauge deposit with LP approval to the resolved gauge', async () => {
    const provider = new RewardsProvider();

    const plan = await planGaugeDeposit(provider, {
      walletAddress: OWNER,
      lpToken: LP_TOKEN,
      poolAddress: POOL,
      liquidity: LIQUIDITY,
      recipient: RECIPIENT,
    });

    expect(plan.gaugeAddress).toBe(GAUGE);
    expect(plan.approval?.to).toBe(POOL);
    expect(plan.approval?.from).toBe(OWNER);
    expect(args(erc20Interface, plan.approval?.data ?? '0x')).toEqual([GAUGE, LIQUIDITY]);
    expect(plan.deposit.to).toBe(GAUGE);
    expect(plan.deposit.from).toBe(OWNER);
    expect(plan.deposit.value).toBe('0');
    expect(plan.deposit.gasEstimate).toBe('250000');
    expect(provider.estimated).toHaveLength(0);
    const parsedDeposit = gaugeInterface.parseTransaction({ data: plan.deposit.data });
    expect(parsedDeposit.name).toBe('deposit');
    expect([...parsedDeposit.args]).toEqual([LIQUIDITY, RECIPIENT]);
  });

  it('omits LP approval when gauge allowance already covers the deposit', async () => {
    const provider = new RewardsProvider();
    provider.allowanceAmount = LIQUIDITY;

    const plan = await planGaugeDeposit(provider, {
      walletAddress: OWNER,
      lpToken: LP_TOKEN,
      gaugeAddress: GAUGE,
      liquidity: LIQUIDITY,
    });

    expect(plan.approval).toBeUndefined();
    expect(callNames(provider.calls)).toEqual([
      'isGauge',
      'stakingToken',
      'balanceOf',
      'allowance',
    ]);
  });

  it('plans gauge withdraw and direct gauge reward claim', async () => {
    const provider = new RewardsProvider();

    const withdraw = await planGaugeWithdraw(provider, {
      walletAddress: OWNER,
      gaugeAddress: GAUGE,
      liquidity: LIQUIDITY,
    });
    const claim = await planGaugeRewardClaim(provider, {
      walletAddress: OWNER,
      gaugeAddress: GAUGE,
      accountAddress: RECIPIENT,
    });

    expect(gaugeInterface.parseTransaction({ data: withdraw.withdraw.data }).name).toBe('withdraw');
    expect(args(gaugeInterface, withdraw.withdraw.data)).toEqual([LIQUIDITY]);
    expect(gaugeInterface.parseTransaction({ data: claim.claim.data }).name).toBe('getReward');
    expect(args(gaugeInterface, claim.claim.data)).toEqual([RECIPIENT]);
  });

  it('plans voter rewards, fees, and bribes through gauge reward mappings', async () => {
    const provider = new RewardsProvider();

    const rewards = await planVoterClaimRewards(provider, {
      walletAddress: OWNER,
      pools: [POOL],
    });
    const fees = await planVoterClaimFees(provider, {
      walletAddress: OWNER,
      tokenId: BigNumber.from(123),
      claims: [
        { poolAddress: POOL, tokenAddresses: [BASE_TOKENS.USDC.address, BASE_TOKENS.WETH.address] },
      ],
    });
    const bribes = await planVoterClaimBribes(provider, {
      walletAddress: OWNER,
      tokenId: BigNumber.from(123),
      claims: [{ gaugeAddress: GAUGE, tokenAddresses: [BASE_TOKENS.AERO.address] }],
    });

    expect(rewards.gaugeAddresses).toEqual([GAUGE]);
    expect(voterInterface.parseTransaction({ data: rewards.claim.data }).name).toBe('claimRewards');
    expect(voterInterface.parseTransaction({ data: fees.claim.data }).name).toBe('claimFees');
    expect(fees.rewardAddresses).toEqual([FEE_REWARD]);
    const feeArgs = args(voterInterface, fees.claim.data);
    expect(feeArgs[0]).toEqual([FEE_REWARD]);
    expect(addressMatrix(feeArgs[1])).toEqual([
      [BASE_TOKENS.USDC.address, BASE_TOKENS.WETH.address],
    ]);
    expect(feeArgs[2]).toEqual(BigNumber.from(123));
    expect(voterInterface.parseTransaction({ data: bribes.claim.data }).name).toBe('claimBribes');
    expect(bribes.rewardAddresses).toEqual([BRIBE_REWARD]);
    const bribeArgs = args(voterInterface, bribes.claim.data);
    expect(bribeArgs[0]).toEqual([BRIBE_REWARD]);
    expect(addressMatrix(bribeArgs[1])).toEqual([[BASE_TOKENS.AERO.address]]);
    expect(bribeArgs[2]).toEqual(BigNumber.from(123));
  });

  it('rejects rewards planning when Voter has no deployed code', async () => {
    const provider = new RewardsProvider();
    provider.codeAddresses.delete(VOTER);

    await expect(
      planGaugeDeposit(provider, {
        walletAddress: OWNER,
        lpToken: LP_TOKEN,
        gaugeAddress: GAUGE,
        liquidity: LIQUIDITY,
      }),
    ).rejects.toThrow(PoolValidationError);

    expect(callNames(provider.calls)).toEqual([]);
    expect(provider.estimated).toHaveLength(0);
  });

  it('rejects spoofed Base Voter config before gauge validation', async () => {
    const provider = new RewardsProvider();
    const spoofedConfig = {
      ...BASE_MAINNET,
      contracts: {
        ...BASE_MAINNET.contracts,
        voter: getAddress('0x5555555555555555555555555555555555555555'),
      },
    };

    await expect(
      planGaugeDeposit(
        provider,
        {
          walletAddress: OWNER,
          lpToken: LP_TOKEN,
          gaugeAddress: GAUGE,
          liquidity: LIQUIDITY,
        },
        spoofedConfig,
      ),
    ).rejects.toThrow(PoolValidationError);

    expect(callNames(provider.calls)).toEqual([]);
    expect(provider.estimated).toHaveLength(0);
  });

  it('rejects resolved gauges with no deployed code', async () => {
    const provider = new RewardsProvider();
    provider.codeAddresses.delete(GAUGE);

    await expect(
      planGaugeDeposit(provider, {
        walletAddress: OWNER,
        lpToken: LP_TOKEN,
        poolAddress: POOL,
        liquidity: LIQUIDITY,
      }),
    ).rejects.toThrow(PoolValidationError);

    expect(callNames(provider.calls)).toEqual(['gauges']);
    expect(provider.estimated).toHaveLength(0);
  });

  it('rejects direct gauges with no deployed code before allowance or tx planning', async () => {
    const provider = new RewardsProvider();
    provider.codeAddresses.delete(GAUGE);

    await expect(
      planGaugeDeposit(provider, {
        walletAddress: OWNER,
        lpToken: LP_TOKEN,
        gaugeAddress: GAUGE,
        liquidity: LIQUIDITY,
      }),
    ).rejects.toThrow(PoolValidationError);

    expect(callNames(provider.calls)).toEqual([]);
    expect(provider.estimated).toHaveLength(0);
  });

  it('rejects unregistered direct gauges before allowance or tx planning', async () => {
    const provider = new RewardsProvider();
    provider.registeredGauges.clear();

    await expect(
      planGaugeDeposit(provider, {
        walletAddress: OWNER,
        lpToken: LP_TOKEN,
        gaugeAddress: GAUGE,
        liquidity: LIQUIDITY,
      }),
    ).rejects.toThrow(PoolValidationError);

    expect(callNames(provider.calls)).toEqual(['isGauge']);
    expect(provider.estimated).toHaveLength(0);
  });

  it('rejects unregistered fee and bribe gauges before reward mapping or tx planning', async () => {
    const provider = new RewardsProvider();
    provider.registeredGauges.clear();

    await expect(
      planVoterClaimFees(provider, {
        walletAddress: OWNER,
        tokenId: 1,
        claims: [{ gaugeAddress: GAUGE, tokenAddresses: [BASE_TOKENS.USDC.address] }],
      }),
    ).rejects.toThrow(PoolValidationError);
    await expect(
      planVoterClaimBribes(provider, {
        walletAddress: OWNER,
        tokenId: 1,
        claims: [{ gaugeAddress: GAUGE, tokenAddresses: [BASE_TOKENS.AERO.address] }],
      }),
    ).rejects.toThrow(PoolValidationError);

    expect(callNames(provider.calls)).toEqual(['isGauge', 'isGauge']);
    expect(provider.estimated).toHaveLength(0);
  });

  it('rejects user-supplied voter reward gauges that are not registered', async () => {
    const provider = new RewardsProvider();
    provider.registeredGauges.clear();

    await expect(
      planVoterClaimRewards(provider, {
        walletAddress: OWNER,
        gauges: [GAUGE],
      }),
    ).rejects.toThrow(PoolValidationError);

    expect(callNames(provider.calls)).toEqual(['isGauge']);
    expect(provider.estimated).toHaveLength(0);
  });

  it('rejects gauge deposits when stakingToken does not match the LP token', async () => {
    const provider = new RewardsProvider();
    provider.stakingTokenAddress = BASE_TOKENS.AERO.address;

    await expect(
      planGaugeDeposit(provider, {
        walletAddress: OWNER,
        lpToken: LP_TOKEN,
        gaugeAddress: GAUGE,
        liquidity: LIQUIDITY,
      }),
    ).rejects.toThrow(PoolValidationError);

    expect(callNames(provider.calls)).toEqual(['isGauge', 'stakingToken']);
    expect(provider.estimated).toHaveLength(0);
  });

  it('rejects gauge deposits when LP token balance is insufficient', async () => {
    const provider = new RewardsProvider();
    provider.balanceAmount = LIQUIDITY.sub(1);

    await expect(
      planGaugeDeposit(provider, {
        walletAddress: OWNER,
        lpToken: LP_TOKEN,
        gaugeAddress: GAUGE,
        liquidity: LIQUIDITY,
      }),
    ).rejects.toThrow(BalanceError);

    expect(callNames(provider.calls)).toEqual(['isGauge', 'stakingToken', 'balanceOf']);
    expect(provider.estimated).toHaveLength(0);
  });

  it('wraps rewards gas estimation failures as transaction preflight errors', async () => {
    const provider = new RewardsProvider();
    provider.allowanceAmount = LIQUIDITY;
    provider.estimateGasError = new Error('execution reverted');

    await expect(
      planGaugeWithdraw(provider, {
        walletAddress: OWNER,
        gaugeAddress: GAUGE,
        liquidity: LIQUIDITY,
      }),
    ).rejects.toThrow(TransactionPreflightError);
  });

  it('rejects invalid addresses, empty token arrays, zero tokenId, and zero liquidity', async () => {
    await expect(
      planGaugeDeposit(new RewardsProvider(), {
        walletAddress: OWNER,
        lpToken: LP_TOKEN,
        gaugeAddress: GAUGE,
        liquidity: BigNumber.from(0),
      }),
    ).rejects.toThrow(TransactionPreflightError);

    await expect(
      planVoterClaimRewards(new RewardsProvider(), {
        walletAddress: OWNER,
        gauges: ['bad'],
      }),
    ).rejects.toThrow(TransactionPreflightError);

    await expect(
      planVoterClaimFees(new RewardsProvider(), {
        walletAddress: OWNER,
        tokenId: 0,
        claims: [{ gaugeAddress: GAUGE, tokenAddresses: [] }],
      }),
    ).rejects.toThrow(TransactionPreflightError);

    await expect(
      planVoterClaimBribes(new RewardsProvider(), {
        walletAddress: OWNER,
        tokenId: 1,
        claims: [{ gaugeAddress: GAUGE, tokenAddresses: ['bad'] }],
      }),
    ).rejects.toThrow(TransactionPreflightError);
  });
});
