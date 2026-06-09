export const ROUTER_ABI = [
  'function factoryRegistry() view returns (address)',
  'function defaultFactory() view returns (address)',
  'function poolFor(address tokenA,address tokenB,bool stable,address factory) view returns (address pool)',
  'function getAmountsOut(uint256 amountIn,tuple(address from,address to,bool stable,address factory)[] routes) view returns (uint256[] amounts)',
  'function quoteAddLiquidity(address tokenA,address tokenB,bool stable,address factory,uint256 amountADesired,uint256 amountBDesired) view returns (uint256 amountA,uint256 amountB,uint256 liquidity)',
  'function quoteRemoveLiquidity(address tokenA,address tokenB,bool stable,address factory,uint256 liquidity) view returns (uint256 amountA,uint256 amountB)',
  'function addLiquidity(address tokenA,address tokenB,bool stable,uint256 amountADesired,uint256 amountBDesired,uint256 amountAMin,uint256 amountBMin,address to,uint256 deadline) returns (uint256 amountA,uint256 amountB,uint256 liquidity)',
  'function addLiquidityETH(address token,bool stable,uint256 amountTokenDesired,uint256 amountTokenMin,uint256 amountETHMin,address to,uint256 deadline) payable returns (uint256 amountToken,uint256 amountETH,uint256 liquidity)',
  'function removeLiquidity(address tokenA,address tokenB,bool stable,uint256 liquidity,uint256 amountAMin,uint256 amountBMin,address to,uint256 deadline) returns (uint256 amountA,uint256 amountB)',
  'function removeLiquidityETH(address token,bool stable,uint256 liquidity,uint256 amountTokenMin,uint256 amountETHMin,address to,uint256 deadline) returns (uint256 amountToken,uint256 amountETH)',
  'function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,tuple(address from,address to,bool stable,address factory)[] routes,address to,uint256 deadline) returns (uint256[] amounts)',
  'function swapExactETHForTokens(uint256 amountOutMin,tuple(address from,address to,bool stable,address factory)[] routes,address to,uint256 deadline) payable returns (uint256[] amounts)',
  'function swapExactTokensForETH(uint256 amountIn,uint256 amountOutMin,tuple(address from,address to,bool stable,address factory)[] routes,address to,uint256 deadline) returns (uint256[] amounts)',
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

export const GAUGE_ABI = [
  'function stakingToken() view returns (address)',
  'function deposit(uint256 amount,address recipient)',
  'function withdraw(uint256 amount)',
  'function getReward(address account)',
] as const;

export const VOTER_ABI = [
  'function gauges(address pool) view returns (address)',
  'function poolForGauge(address gauge) view returns (address)',
  'function isGauge(address gauge) view returns (bool)',
  'function gaugeToFees(address gauge) view returns (address)',
  'function gaugeToBribe(address gauge) view returns (address)',
  'function claimRewards(address[] gauges)',
  'function claimFees(address[] fees,address[][] tokens,uint256 tokenId)',
  'function claimBribes(address[] bribes,address[][] tokens,uint256 tokenId)',
] as const;

export const SLIPSTREAM_ROUTER_ABI = [
  'function exactInputSingle(tuple(address tokenIn,address tokenOut,int24 tickSpacing,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
  'function exactInput(tuple(bytes path,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum) params) payable returns (uint256 amountOut)',
] as const;

export const SLIPSTREAM_QUOTER_ABI = [
  'function quoteExactInputSingle(tuple(address tokenIn,address tokenOut,uint256 amountIn,int24 tickSpacing,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)',
  'function quoteExactInput(bytes path,uint256 amountIn) returns (uint256 amountOut,uint160[] sqrtPriceX96AfterList,uint32[] initializedTicksCrossedList,uint256 gasEstimate)',
] as const;
