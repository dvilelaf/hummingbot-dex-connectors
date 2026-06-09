import type { Aerodrome } from '../aerodrome.js';
import type { AerodromeExecutionPlanDto, ExecuteQuoteRequest } from '../types.js';
import { executionPlanToDto } from './dto.js';

export async function executeQuote(
  connector: Aerodrome,
  request: ExecuteQuoteRequest,
): Promise<AerodromeExecutionPlanDto> {
  return executionPlanToDto(await connector.executeQuote(request));
}
