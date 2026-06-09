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
    voter: getAddress('0x16613524e02ad97eDfeF371bC883F2F5d6C480A5'),
    votingEscrow: getAddress('0xeBf418Fe2512e7E6bd9b87a8F0f294aCDC67e6B4'),
    slipstream: {
      router: getAddress('0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5'),
      poolFactory: getAddress('0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A'),
      quoter: getAddress('0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0'),
      mixedQuoter: getAddress('0xCd2A7D98e82D6107eac1828ce8DeAA6acB65b555'),
      positionManager: getAddress('0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53'),
    },
  },
  defaultSlippageBps: 50,
  defaultTtlSeconds: 30,
};

export const BASE_TOKENS = {
  ETH: {
    symbol: 'ETH',
    address: getAddress('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'),
    decimals: 18,
  },
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
} satisfies Record<'ETH' | 'USDC' | 'WETH' | 'AERO', TokenInfo>;

export function aerodromeBaseConfig(): AerodromeNetworkConfig {
  return BASE_MAINNET;
}
