import { getAddress, isAddress } from '@ethersproject/address';
import { BigNumber } from '@ethersproject/bignumber';

import { UnsupportedTokenError, TransactionPreflightError } from './errors.js';
import type { PoolType, TokenInfo } from './types.js';

const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/u;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function checksumAddress(address: string, label: string): string {
  if (!isAddress(address)) {
    throw new TransactionPreflightError(`${label} is not a valid EVM address`);
  }
  return getAddress(address);
}

export function validateToken(token: TokenInfo): TokenInfo {
  if (!token.symbol.trim()) {
    throw new UnsupportedTokenError('token symbol is required');
  }
  if (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 36) {
    throw new UnsupportedTokenError(`unsupported decimals for ${token.symbol}`);
  }
  return {
    symbol: token.symbol.toUpperCase(),
    address: checksumAddress(token.address, `${token.symbol} address`),
    decimals: token.decimals,
  };
}

export function atomicAmount(amount: string, decimals: number): BigNumber {
  if (!DECIMAL_PATTERN.test(amount)) {
    throw new TransactionPreflightError(`invalid decimal amount: ${amount}`);
  }
  const [whole, fractional = ''] = amount.split('.');
  if (fractional.length > decimals) {
    throw new TransactionPreflightError(`amount has more than ${decimals} decimals`);
  }
  const paddedFraction = fractional.padEnd(decimals, '0');
  return BigNumber.from(`${whole}${paddedFraction}`.replace(/^0+(?=\d)/u, '') || '0');
}

export function decimalAmount(amount: BigNumber, decimals: number): string {
  if (decimals === 0) {
    return amount.toString();
  }
  const raw = amount.toString().padStart(decimals + 1, '0');
  const whole = raw.slice(0, -decimals) || '0';
  const fraction = raw.slice(-decimals).replace(/0+$/u, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

export function applySlippageBps(amount: BigNumber, slippageBps: number): BigNumber {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) {
    throw new TransactionPreflightError('slippageBps must be an integer between 0 and 9999');
  }
  return amount.mul(10_000 - slippageBps).div(10_000);
}

export function stableFlag(poolType: PoolType): boolean {
  if (poolType === 'stable') {
    return true;
  }
  if (poolType === 'volatile') {
    return false;
  }
  throw new TransactionPreflightError('unsupported pool type');
}

export function nonZeroAddress(address: string, label: string): string {
  const checksummed = checksumAddress(address, label);
  if (checksummed === ZERO_ADDRESS) {
    throw new TransactionPreflightError(`${label} must not be zero address`);
  }
  return checksummed;
}

export function hasDeployedCode(code: string): boolean {
  return code !== '0x' && code !== '0X' && code.length > 2;
}

export function safeIntegerTimestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TransactionPreflightError(`${label} must be a positive safe integer`);
  }
  return value;
}

export function ratio(numerator: BigNumber, denominator: BigNumber, precision = 18): string {
  if (denominator.isZero()) {
    return '0';
  }
  const scale = BigNumber.from(10).pow(precision);
  return decimalAmount(numerator.mul(scale).div(denominator), precision);
}

export function decimalRatio(
  numerator: BigNumber,
  numeratorDecimals: number,
  denominator: BigNumber,
  denominatorDecimals: number,
  precision = 18,
): string {
  if (denominator.isZero()) {
    return '0';
  }
  const scale = BigNumber.from(10).pow(precision);
  const normalizedNumerator = numerator.mul(BigNumber.from(10).pow(denominatorDecimals));
  const normalizedDenominator = denominator.mul(BigNumber.from(10).pow(numeratorDecimals));
  return decimalAmount(normalizedNumerator.mul(scale).div(normalizedDenominator), precision);
}
