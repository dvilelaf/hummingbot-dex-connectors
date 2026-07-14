"""Typed connector models and amount conversion helpers."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

MAX_SLIPPAGE_BPS = 10_000


class OrderSide(str, Enum):
    """Supported logical order sides."""

    BUY = "buy"
    SELL = "sell"


class OrderState(str, Enum):
    """Local order states emitted by the CoW connector."""

    SUBMITTED = "submitted"
    OPEN = "open"
    PARTIALLY_FILLED = "partially_filled"
    FILLED = "filled"
    CANCELLED = "cancelled"
    EXPIRED = "expired"
    FAILED = "failed"


class CoWToken(BaseModel):
    """ERC-20 token metadata required for amount normalization."""

    symbol: str
    address: str
    decimals: int

    @field_validator("decimals")
    @classmethod
    def validate_decimals(cls, value: int) -> int:
        """Ensure token decimal precision is a non-negative integer."""
        if value < 0:
            message = "token decimals must be non-negative"
            raise ValueError(message)
        return value


class CoWConfig(BaseModel):
    """Runtime configuration for one CoW chain/environment."""

    chain_id: int
    chain_name: str
    owner: str
    receiver: str
    app_data: str
    slippage_bps: int = 50
    env: str = "prod"
    valid_to: int | None = None
    settlement_contract: str | None = None

    @field_validator("slippage_bps")
    @classmethod
    def validate_slippage(cls, value: int) -> int:
        """Ensure slippage is expressed as valid basis points."""
        if value < 0 or value >= MAX_SLIPPAGE_BPS:
            message = "slippage_bps must be between 0 and 9999"
            raise ValueError(message)
        return value


class SellOrderRequest(BaseModel):
    """Connector-level request for a quoted CoW sell order."""

    client_order_id: str
    trading_pair: str
    sell_token: CoWToken
    buy_token: CoWToken
    amount: str
    valid_to: int | None = None
    partially_fillable: bool = False
    order_type: str = "MARKET"
    price: Decimal | None = None

    @field_validator("order_type")
    @classmethod
    def validate_order_type(cls, value: str) -> str:
        """Normalize and validate the requested Hummingbot order type."""
        normalized = value.upper()
        if normalized not in {"MARKET", "LIMIT"}:
            message = f"unsupported order_type: {value}"
            raise ValueError(message)
        return normalized

    @field_validator("price")
    @classmethod
    def validate_price(cls, value: Decimal | None) -> Decimal | None:
        """Require any supplied price to be finite and strictly positive."""
        if value is not None and (not value.is_finite() or value <= 0):
            message = "price must be a positive finite Decimal"
            raise ValueError(message)
        return value

    @model_validator(mode="after")
    def validate_limit_price(self) -> SellOrderRequest:
        """Require prices for LIMIT requests and reject them for MARKET requests."""
        if self.order_type == "LIMIT" and self.price is None:
            message = "LIMIT orders require a positive price"
            raise ValueError(message)
        if self.order_type == "MARKET" and self.price is not None:
            message = "MARKET orders do not accept a price"
            raise ValueError(message)
        return self


class BuyOrderRequest(BaseModel):
    """Connector-level request for a quoted CoW buy order."""

    client_order_id: str
    trading_pair: str
    sell_token: CoWToken
    buy_token: CoWToken
    amount: str
    valid_to: int | None = None
    partially_fillable: bool = False
    order_type: str = "MARKET"
    price: Decimal | None = None

    @field_validator("order_type")
    @classmethod
    def validate_order_type(cls, value: str) -> str:
        """Normalize and validate the requested Hummingbot order type."""
        normalized = value.upper()
        if normalized not in {"MARKET", "LIMIT"}:
            message = f"unsupported order_type: {value}"
            raise ValueError(message)
        return normalized

    @field_validator("price")
    @classmethod
    def validate_price(cls, value: Decimal | None) -> Decimal | None:
        """Require any supplied price to be finite and strictly positive."""
        if value is not None and (not value.is_finite() or value <= 0):
            message = "price must be a positive finite Decimal"
            raise ValueError(message)
        return value

    @model_validator(mode="after")
    def validate_limit_price(self) -> BuyOrderRequest:
        """Require prices for LIMIT requests and reject them for MARKET requests."""
        if self.order_type == "LIMIT" and self.price is None:
            message = "LIMIT orders require a positive price"
            raise ValueError(message)
        if self.order_type == "MARKET" and self.price is not None:
            message = "MARKET orders do not accept a price"
            raise ValueError(message)
        return self


class TrackedOrder(BaseModel):
    """Persisted local metadata needed to recover and reconcile a CoW order."""

    client_order_id: str
    trading_pair: str
    order_uid: str
    owner: str
    receiver: str
    chain_id: int
    sell_token: CoWToken
    buy_token: CoWToken
    sell_amount: str
    buy_amount: str
    valid_to: int
    quote_id: int | None
    digest: str
    signing_scheme: str
    partially_fillable: bool
    fee_amount: str = "0"
    state: OrderState = OrderState.SUBMITTED
    executed_sell: str = "0"
    executed_buy: str = "0"
    settlement_tx_hash: str | None = None
    raw_status: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


def amount_to_atomic(amount: str, decimals: int) -> str:
    """Convert a human decimal token amount into atomic units."""
    try:
        parsed = Decimal(amount)
    except InvalidOperation as exc:
        message = f"invalid decimal amount: {amount}"
        raise ValueError(message) from exc

    if parsed <= 0:
        message = "amount must be positive"
        raise ValueError(message)

    scale = Decimal(10) ** decimals
    atomic = parsed * scale
    if atomic != atomic.to_integral_value():
        message = f"amount has more precision than token decimals: {amount}"
        raise ValueError(message)
    return str(int(atomic))


def apply_slippage_bps(amount: str, slippage_bps: int) -> str:
    """Apply basis-point slippage to an atomic buy amount."""
    return str(int(amount) * (MAX_SLIPPAGE_BPS - slippage_bps) // MAX_SLIPPAGE_BPS)


def apply_buy_slippage_bps(amount: str, slippage_bps: int) -> str:
    """Apply basis-point slippage to an atomic maximum sell amount."""
    numerator = int(amount) * (MAX_SLIPPAGE_BPS + slippage_bps)
    return str((numerator + MAX_SLIPPAGE_BPS - 1) // MAX_SLIPPAGE_BPS)
