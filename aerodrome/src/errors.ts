export class AerodromeConnectorError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnsupportedNetworkError extends AerodromeConnectorError {}
export class UnsupportedTokenError extends AerodromeConnectorError {}
export class PoolValidationError extends AerodromeConnectorError {}
export class QuoteError extends AerodromeConnectorError {}
export class SlipstreamConfigError extends AerodromeConnectorError {}
export class TransactionPreflightError extends AerodromeConnectorError {}
export class AllowanceError extends AerodromeConnectorError {
  public constructor(message: string) {
    super(message);
  }
}

export class BalanceError extends AerodromeConnectorError {
  public constructor(message: string) {
    super(message);
  }
}
export class QuoteCacheError extends AerodromeConnectorError {}
