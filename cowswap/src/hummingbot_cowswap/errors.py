"""Domain errors raised by the CoW Swap connector."""

from __future__ import annotations


class CoWConnectorError(Exception):
    """Base class for connector-controlled failures."""


class UnsupportedChainError(CoWConnectorError):
    """Raised when a configured chain is not supported by the connector."""


class UnsupportedTokenError(CoWConnectorError):
    """Raised when a token is outside the connector token scope."""


class InsufficientBalanceError(CoWConnectorError):
    """Raised when the order owner does not hold enough sell-token balance."""


class InsufficientAllowanceError(CoWConnectorError):
    """Raised when the VaultRelayer allowance is lower than the sell amount."""


class StaleQuoteError(CoWConnectorError):
    """Raised when a quote is expired before the order can be posted."""


class DuplicateOrderError(CoWConnectorError):
    """Raised when a client order ID is reused."""


class CoWOrderBookAPIError(CoWConnectorError):
    """Raised when the CoW Order Book API rejects a request."""


class CoWOrderBookTransientError(CoWOrderBookAPIError):
    """Raised when the CoW Order Book API call fails transiently."""


class CoWOrderBookMalformedResponseError(CoWOrderBookAPIError):
    """Raised when cowpy returns an unexpected Order Book API response shape."""
