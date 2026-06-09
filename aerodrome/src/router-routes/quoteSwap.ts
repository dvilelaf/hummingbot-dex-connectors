import type { Aerodrome } from '../aerodrome.js';
import type { AerodromeQuoteDto, QuoteSwapRequest } from '../types.js';
import { quoteToDto } from './dto.js';

export async function quoteSwap(
  connector: Aerodrome,
  request: QuoteSwapRequest,
): Promise<AerodromeQuoteDto> {
  return quoteToDto(await connector.quoteSwap(request));
}
