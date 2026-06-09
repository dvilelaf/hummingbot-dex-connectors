import { getAddress } from '@ethersproject/address';

import type { AerodromeNetworkConfig, TokenInfo } from './types.js';

export const BASE_MAINNET: AerodromeNetworkConfig = {
  chainId: 8453,
  chain: 'ethereum',
  network: 'base',
  contracts: {
    router: getAddress('0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43'),
    poolFactory: getAddress('0x420DD381b31aEf6683db6B902084cB0FFECe40Da'),
    factoryRegistry: getAddress('0x5C3F18F06CC09CA1910767A34a20F771039E37C0'),
    weth: getAddress('0x4200000000000000000000000000000000000006'),
  },
  defaultSlippageBps: 50,
  defaultTtlSeconds: 30,
};

export const BASE_TOKENS = {
  USDC: {
    symbol: 'USDC',
    address: getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),
    decimals: 6,
  },
  WETH: {
    symbol: 'WETH',
    address: getAddress('0x4200000000000000000000000000000000000006'),
    decimals: 18,
  },
  AERO: {
    symbol: 'AERO',
    address: getAddress('0x940181a94A35A4569E4529A3CDfB74e38FD98631'),
    decimals: 18,
  },
} satisfies Record<'USDC' | 'WETH' | 'AERO', TokenInfo>;

export function aerodromeBaseConfig(): AerodromeNetworkConfig {
  return BASE_MAINNET;
}
