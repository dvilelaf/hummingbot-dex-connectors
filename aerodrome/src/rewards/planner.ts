import { Interface } from '@ethersproject/abi';
import { BigNumber } from '@ethersproject/bignumber';

import { BASE_MAINNET, aerodromeBaseConfig } from '../config.js';
import { ERC20_ABI, GAUGE_ABI, VOTER_ABI } from '../contracts.js';
import {
  AllowanceError,
  BalanceError,
  PoolValidationError,
  TransactionPreflightError,
  UnsupportedNetworkError,
} from '../errors.js';
import type {
  AerodromeGaugeDepositPlan,
  AerodromeGaugeListSelector,
  AerodromeGaugeRewardClaimPlan,
  AerodromeGaugeSelector,
  AerodromeGaugeWithdrawPlan,
  AerodromeNetworkConfig,
  AerodromeProvider,
  AerodromeVoterClaimRewardsPlan,
  AerodromeVoterVotingRewardsPlan,
  AerodromeVoterRewardClaim,
  PlanGaugeDepositRequest,
  PlanGaugeRewardClaimRequest,
  PlanGaugeWithdrawRequest,
  PlanVoterClaimRewardsRequest,
  PlanVoterClaimVotingRewardsRequest,
  PlannedTransaction,
  TokenInfo,
} from '../types.js';
import { checksumAddress, hasDeployedCode, nonZeroAddress, validateToken } from '../utils.js';

const DEFAULT_APPROVAL_GAS = BigNumber.from('250000');

const erc20Interface = new Interface(ERC20_ABI);
const gaugeInterface = new Interface(GAUGE_ABI);
const voterInterface = new Interface(VOTER_ABI);

export async function planGaugeDeposit(
  provider: AerodromeProvider,
  request: PlanGaugeDepositRequest,
  config: AerodromeNetworkConfig = aerodromeBaseConfig(),
): Promise<AerodromeGaugeDepositPlan> {
  await assertNetwork(provider, config);
  const walletAddress = nonZeroAddress(request.walletAddress, 'walletAddress');
  const lpToken = validateToken(request.lpToken);
  const liquidity = nonZeroBigNumber(request.liquidity, 'liquidity');
  const recipient = nonZeroAddress(request.recipient ?? walletAddress, 'recipient');
  const gaugeAddress = await resolveGaugeAddress(provider, config, request);
  await assertContractCode(provider, gaugeAddress, 'Aerodrome Gauge');
  await assertRegisteredGauge(provider, config, gaugeAddress);
  await assertGaugeStakingToken(provider, gaugeAddress, lpToken);
  await assertTokenBalance(provider, walletAddress, lpToken, liquidity);

  const currentAllowance = await allowance(provider, walletAddress, lpToken, gaugeAddress);
  const approval = currentAllowance.lt(liquidity)
    ? buildApprovalTransaction(walletAddress, lpToken, gaugeAddress, liquidity)
    : undefined;
  const data = gaugeInterface.encodeFunctionData('deposit', [liquidity, recipient]);
  const deposit = await planTransaction(
    provider,
    gaugeAddress,
    walletAddress,
    data,
    approval !== undefined,
  );

  return {
    gaugeAddress,
    ...(approval === undefined ? {} : { approval }),
    deposit,
  };
}

export async function planGaugeWithdraw(
  provider: AerodromeProvider,
  request: PlanGaugeWithdrawRequest,
  config: AerodromeNetworkConfig = aerodromeBaseConfig(),
): Promise<AerodromeGaugeWithdrawPlan> {
  await assertNetwork(provider, config);
  const walletAddress = nonZeroAddress(request.walletAddress, 'walletAddress');
  const liquidity = nonZeroBigNumber(request.liquidity, 'liquidity');
  const gaugeAddress = await resolveGaugeAddress(provider, config, request);
  await assertContractCode(provider, gaugeAddress, 'Aerodrome Gauge');
  await assertRegisteredGauge(provider, config, gaugeAddress);
  const data = gaugeInterface.encodeFunctionData('withdraw', [liquidity]);
  return {
    gaugeAddress,
    withdraw: await planTransaction(provider, gaugeAddress, walletAddress, data),
  };
}

export async function planGaugeRewardClaim(
  provider: AerodromeProvider,
  request: PlanGaugeRewardClaimRequest,
  config: AerodromeNetworkConfig = aerodromeBaseConfig(),
): Promise<AerodromeGaugeRewardClaimPlan> {
  await assertNetwork(provider, config);
  const walletAddress = nonZeroAddress(request.walletAddress, 'walletAddress');
  const accountAddress = nonZeroAddress(request.accountAddress ?? walletAddress, 'accountAddress');
  const gaugeAddress = await resolveGaugeAddress(provider, config, request);
  await assertContractCode(provider, gaugeAddress, 'Aerodrome Gauge');
  await assertRegisteredGauge(provider, config, gaugeAddress);
  const data = gaugeInterface.encodeFunctionData('getReward', [accountAddress]);
  return {
    gaugeAddress,
    claim: await planTransaction(provider, gaugeAddress, walletAddress, data),
  };
}

export async function planVoterClaimRewards(
  provider: AerodromeProvider,
  request: PlanVoterClaimRewardsRequest,
  config: AerodromeNetworkConfig = aerodromeBaseConfig(),
): Promise<AerodromeVoterClaimRewardsPlan> {
  await assertNetwork(provider, config);
  const walletAddress = nonZeroAddress(request.walletAddress, 'walletAddress');
  const voterAddress = configuredVoterAddress(config);
  await assertContractCode(provider, voterAddress, 'Aerodrome Voter');
  const gaugeAddresses = await resolveGaugeAddressList(provider, config, request);
  const data = voterInterface.encodeFunctionData('claimRewards', [gaugeAddresses]);
  return {
    voterAddress,
    gaugeAddresses,
    claim: await planTransaction(provider, voterAddress, walletAddress, data),
  };
}

export async function planVoterClaimFees(
  provider: AerodromeProvider,
  request: PlanVoterClaimVotingRewardsRequest,
  config: AerodromeNetworkConfig = aerodromeBaseConfig(),
): Promise<AerodromeVoterVotingRewardsPlan> {
  return planVoterVotingRewards(provider, request, config, 'fees');
}

export async function planVoterClaimBribes(
  provider: AerodromeProvider,
  request: PlanVoterClaimVotingRewardsRequest,
  config: AerodromeNetworkConfig = aerodromeBaseConfig(),
): Promise<AerodromeVoterVotingRewardsPlan> {
  return planVoterVotingRewards(provider, request, config, 'bribes');
}

async function planVoterVotingRewards(
  provider: AerodromeProvider,
  request: PlanVoterClaimVotingRewardsRequest,
  config: AerodromeNetworkConfig,
  rewardKind: 'fees' | 'bribes',
): Promise<AerodromeVoterVotingRewardsPlan> {
  await assertNetwork(provider, config);
  const walletAddress = nonZeroAddress(request.walletAddress, 'walletAddress');
  const tokenId = nonZeroBigNumber(request.tokenId, 'tokenId');
  const voterAddress = configuredVoterAddress(config);
  await assertContractCode(provider, voterAddress, 'Aerodrome Voter');
  const claims = nonEmptyArray(request.claims, 'claims');
  const gaugeAddresses: string[] = [];
  const rewardAddresses: string[] = [];
  const tokenAddresses: string[][] = [];

  for (const claim of claims) {
    const gaugeAddress = await resolveGaugeAddress(provider, config, claim);
    await assertRegisteredGauge(provider, config, gaugeAddress);
    const rewardAddress = await resolveVotingRewardAddress(
      provider,
      config,
      gaugeAddress,
      rewardKind,
    );
    gaugeAddresses.push(gaugeAddress);
    rewardAddresses.push(rewardAddress);
    tokenAddresses.push([...validateTokenAddresses(claim)]);
  }

  const functionName = rewardKind === 'fees' ? 'claimFees' : 'claimBribes';
  const data = voterInterface.encodeFunctionData(functionName, [
    rewardAddresses,
    tokenAddresses,
    tokenId,
  ]);
  return {
    voterAddress,
    gaugeAddresses,
    rewardAddresses,
    tokenAddresses,
    claim: await planTransaction(provider, voterAddress, walletAddress, data),
  };
}

async function resolveGaugeAddress(
  provider: AerodromeProvider,
  config: AerodromeNetworkConfig,
  selector: AerodromeGaugeSelector,
): Promise<string> {
  const directGauge = addressField(selector, 'gaugeAddress');
  const poolAddress = addressField(selector, 'poolAddress');
  if (directGauge !== undefined && poolAddress !== undefined) {
    throw new TransactionPreflightError('provide either gaugeAddress or poolAddress, not both');
  }
  if (directGauge !== undefined) {
    return nonZeroAddress(directGauge, 'gaugeAddress');
  }
  if (poolAddress === undefined) {
    throw new TransactionPreflightError('gaugeAddress or poolAddress is required');
  }
  const voterAddress = configuredVoterAddress(config);
  await assertContractCode(provider, voterAddress, 'Aerodrome Voter');
  const normalizedPool = nonZeroAddress(poolAddress, 'poolAddress');
  const raw = await provider.call({
    to: voterAddress,
    data: voterInterface.encodeFunctionData('gauges', [normalizedPool]),
  });
  try {
    const decoded = voterInterface.decodeFunctionResult('gauges', raw);
    return nonZeroAddress(String(decoded[0]), 'gaugeAddress');
  } catch {
    throw new PoolValidationError('malformed Aerodrome Voter gauges response');
  }
}

async function resolveGaugeAddressList(
  provider: AerodromeProvider,
  config: AerodromeNetworkConfig,
  selector: AerodromeGaugeListSelector,
): Promise<readonly string[]> {
  const gauges = arrayField(selector, 'gauges');
  const pools = arrayField(selector, 'pools');
  if (gauges !== undefined && pools !== undefined) {
    throw new TransactionPreflightError('provide either gauges or pools, not both');
  }
  if (gauges !== undefined) {
    const normalized = nonEmptyArray(gauges, 'gauges').map((gauge) =>
      nonZeroAddress(gauge, 'gaugeAddress'),
    );
    for (const gauge of normalized) {
      await assertRegisteredGauge(provider, config, gauge);
    }
    return normalized;
  }
  if (pools === undefined) {
    throw new TransactionPreflightError('gauges or pools is required');
  }
  const normalizedPools = nonEmptyArray(pools, 'pools');
  const resolved: string[] = [];
  for (const poolAddress of normalizedPools) {
    resolved.push(await resolveGaugeAddress(provider, config, { poolAddress }));
  }
  return resolved;
}

async function resolveVotingRewardAddress(
  provider: AerodromeProvider,
  config: AerodromeNetworkConfig,
  gaugeAddress: string,
  rewardKind: 'fees' | 'bribes',
): Promise<string> {
  const voterAddress = configuredVoterAddress(config);
  const functionName = rewardKind === 'fees' ? 'gaugeToFees' : 'gaugeToBribe';
  const raw = await provider.call({
    to: voterAddress,
    data: voterInterface.encodeFunctionData(functionName, [gaugeAddress]),
  });
  try {
    const decoded = voterInterface.decodeFunctionResult(functionName, raw);
    return nonZeroAddress(String(decoded[0]), `${rewardKind} reward`);
  } catch {
    throw new PoolValidationError(`malformed Aerodrome Voter ${functionName} response`);
  }
}

async function assertRegisteredGauge(
  provider: AerodromeProvider,
  config: AerodromeNetworkConfig,
  gaugeAddress: string,
): Promise<void> {
  const voterAddress = configuredVoterAddress(config);
  await assertContractCode(provider, voterAddress, 'Aerodrome Voter');
  const raw = await provider.call({
    to: voterAddress,
    data: voterInterface.encodeFunctionData('isGauge', [gaugeAddress]),
  });
  try {
    const decoded = voterInterface.decodeFunctionResult('isGauge', raw);
    if (decoded[0] !== true) {
      throw new PoolValidationError('Aerodrome Voter does not recognize gauge');
    }
  } catch (error) {
    if (error instanceof PoolValidationError) {
      throw error;
    }
    throw new PoolValidationError('malformed Aerodrome Voter isGauge response');
  }
}

async function assertGaugeStakingToken(
  provider: AerodromeProvider,
  gaugeAddress: string,
  lpToken: TokenInfo,
): Promise<void> {
  const raw = await provider.call({
    to: gaugeAddress,
    data: gaugeInterface.encodeFunctionData('stakingToken', []),
  });
  try {
    const decoded = gaugeInterface.decodeFunctionResult('stakingToken', raw);
    if (nonZeroAddress(String(decoded[0]), 'stakingToken') !== lpToken.address) {
      throw new PoolValidationError('gauge stakingToken does not match LP token');
    }
  } catch (error) {
    if (error instanceof PoolValidationError) {
      throw error;
    }
    throw new PoolValidationError('malformed Aerodrome Gauge stakingToken response');
  }
}

function configuredVoterAddress(config: AerodromeNetworkConfig): string {
  if (config.contracts.voter === undefined) {
    throw new TransactionPreflightError('Aerodrome Voter is not configured');
  }
  const voterAddress = nonZeroAddress(config.contracts.voter, 'Aerodrome Voter');
  if (config.chainId === BASE_MAINNET.chainId && voterAddress !== BASE_MAINNET.contracts.voter) {
    throw new PoolValidationError('Aerodrome Base Voter config must use the official contract');
  }
  return voterAddress;
}

async function assertTokenBalance(
  provider: AerodromeProvider,
  owner: string,
  token: TokenInfo,
  amount: BigNumber,
): Promise<void> {
  const raw = await provider.call({
    to: token.address,
    data: erc20Interface.encodeFunctionData('balanceOf', [owner]),
  });
  try {
    const decoded = erc20Interface.decodeFunctionResult('balanceOf', raw);
    if (BigNumber.from(decoded[0]).lt(amount)) {
      throw new BalanceError('wallet balance is below Aerodrome gauge deposit amount');
    }
  } catch (error) {
    if (error instanceof BalanceError) {
      throw error;
    }
    throw new BalanceError('malformed ERC20 balance response');
  }
}

async function allowance(
  provider: AerodromeProvider,
  owner: string,
  token: TokenInfo,
  spender: string,
): Promise<BigNumber> {
  const raw = await provider.call({
    to: token.address,
    data: erc20Interface.encodeFunctionData('allowance', [owner, spender]),
  });
  try {
    const decoded = erc20Interface.decodeFunctionResult('allowance', raw);
    return BigNumber.from(decoded[0]);
  } catch {
    throw new AllowanceError('malformed ERC20 allowance response');
  }
}

function buildApprovalTransaction(
  owner: string,
  token: TokenInfo,
  spender: string,
  amount: BigNumber,
): PlannedTransaction {
  return {
    to: token.address,
    from: owner,
    data: erc20Interface.encodeFunctionData('approve', [spender, amount]),
    value: '0',
    gasEstimate: DEFAULT_APPROVAL_GAS.toString(),
  };
}

async function planTransaction(
  provider: AerodromeProvider,
  to: string,
  from: string,
  data: string,
  useDefaultGas = false,
): Promise<PlannedTransaction> {
  const transaction = {
    to,
    from,
    data,
    value: BigNumber.from(0),
  };
  const gasEstimate = useDefaultGas
    ? DEFAULT_APPROVAL_GAS
    : await estimateGas(provider, transaction);
  return {
    ...transaction,
    value: transaction.value.toString(),
    gasEstimate: gasEstimate.toString(),
  };
}

async function estimateGas(
  provider: AerodromeProvider,
  transaction: Parameters<AerodromeProvider['estimateGas']>[0],
): Promise<BigNumber> {
  try {
    return await provider.estimateGas(transaction);
  } catch {
    throw new TransactionPreflightError('Aerodrome rewards transaction gas estimation failed');
  }
}

async function assertNetwork(
  provider: AerodromeProvider,
  config: AerodromeNetworkConfig,
): Promise<void> {
  const network = await provider.getNetwork();
  if (network.chainId !== config.chainId) {
    throw new UnsupportedNetworkError(
      `expected chainId ${config.chainId}, provider returned ${network.chainId}`,
    );
  }
}

async function assertContractCode(
  provider: AerodromeProvider,
  address: string,
  label: string,
): Promise<void> {
  const code = await provider.getCode(checksumAddress(address, label));
  if (!hasDeployedCode(code)) {
    throw new PoolValidationError(`${label} has no deployed code`);
  }
}

function validateTokenAddresses(claim: AerodromeVoterRewardClaim): readonly string[] {
  return nonEmptyArray(claim.tokenAddresses, 'tokenAddresses').map((tokenAddress) =>
    nonZeroAddress(tokenAddress, 'tokenAddress'),
  );
}

function nonZeroBigNumber(value: Parameters<typeof BigNumber.from>[0], label: string): BigNumber {
  try {
    const amount = BigNumber.from(value);
    if (amount.lt(1)) {
      throw new TransactionPreflightError(`${label} must be greater than zero`);
    }
    return amount;
  } catch (error) {
    if (error instanceof TransactionPreflightError) {
      throw error;
    }
    throw new TransactionPreflightError(`${label} must be a valid integer amount`);
  }
}

function nonEmptyArray<T>(items: readonly T[], label: string): readonly T[] {
  if (items.length === 0) {
    throw new TransactionPreflightError(`${label} must not be empty`);
  }
  return items;
}

function addressField<T extends string>(
  value: Partial<Record<T, string>>,
  key: T,
): string | undefined {
  return value[key];
}

function arrayField<T extends string>(
  value: Partial<Record<T, readonly string[]>>,
  key: T,
): readonly string[] | undefined {
  return value[key];
}
