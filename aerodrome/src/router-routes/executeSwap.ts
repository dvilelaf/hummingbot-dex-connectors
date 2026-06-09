import type { Aerodrome } from '../aerodrome.js';
import type { AerodromeExecutionPlanDto, ExecuteSwapRequest } from '../types.js';
import { executionPlanToDto } from './dto.js';

export async function executeSwap(
  connector: Aerodrome,
  request: ExecuteSwapRequest,
): Promise<AerodromeExecutionPlanDto> {
  return executionPlanToDto(await connector.executeSwap(request));
}
