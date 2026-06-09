export const ROUTER_ABI = [
  'function factoryRegistry() view returns (address)',
  'function defaultFactory() view returns (address)',
  'function poolFor(address tokenA,address tokenB,bool stable,address factory) view returns (address pool)',
  'function getAmountsOut(uint256 amountIn,tuple(address from,address to,bool stable,address factory)[] routes) view returns (uint256[] amounts)',
  'function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,tuple(address from,address to,bool stable,address factory)[] routes,address to,uint256 deadline) returns (uint256[] amounts)',
] as const;

export const FACTORY_REGISTRY_ABI = [
  'function isPoolFactoryApproved(address factory) view returns (bool)',
] as const;

export const POOL_FACTORY_ABI = [
  'function isPool(address pool) view returns (bool)',
  'function getPool(address tokenA,address tokenB,bool stable) view returns (address pool)',
] as const;

export const POOL_ABI = [
  'function metadata() view returns (uint256 dec0,uint256 dec1,uint256 r0,uint256 r1,bool st,address t0,address t1)',
  'function stable() view returns (bool)',
  'function tokens() view returns (address,address)',
  'function getAmountOut(uint256 amountIn,address tokenIn) view returns (uint256)',
] as const;

export const ERC20_ABI = [
  'function allowance(address owner,address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function approve(address spender,uint256 amount) returns (bool)',
] as const;
