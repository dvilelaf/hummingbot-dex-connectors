from __future__ import annotations

from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator


class OrderSide(str, Enum):
    BUY = "buy"
    SELL = "sell"


class OrderState(str, Enum):
    SUBMITTED = "submitted"
    OPEN = "open"
    PARTIALLY_FILLED = "partially_filled"
    FILLED = "filled"
    CANCELLED = "cancelled"
    EXPIRED = "expired"
    FAILED = "failed"


class CoWToken(BaseModel):
    symbol: str
    address: str
    decimals: int

    @field_validator("decimals")
    @classmethod
    def validate_decimals(cls, value: int) -> int:
        if value < 0:
            raise ValueError("token decimals must be non-negative")
        return value


class CoWConfig(BaseModel):
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
        if value < 0 or value >= 10_000:
            raise ValueError("slippage_bps must be between 0 and 9999")
        return value


class SellOrderRequest(BaseModel):
    client_order_id: str
    trading_pair: str
    sell_token: CoWToken
    buy_token: CoWToken
    amount: str
    valid_to: int | None = None
    partially_fillable: bool = False


class TrackedOrder(BaseModel):
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
    state: OrderState = OrderState.SUBMITTED
    executed_sell: str = "0"
    executed_buy: str = "0"
    settlement_tx_hash: str | None = None
    raw_status: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


def amount_to_atomic(amount: str, decimals: int) -> str:
    try:
        parsed = Decimal(amount)
    except InvalidOperation as exc:
        raise ValueError(f"invalid decimal amount: {amount}") from exc

    if parsed <= 0:
        raise ValueError("amount must be positive")

    scale = Decimal(10) ** decimals
    atomic = parsed * scale
    if atomic != atomic.to_integral_value():
        raise ValueError(f"amount has more precision than token decimals: {amount}")
    return str(int(atomic))


def apply_slippage_bps(amount: str, slippage_bps: int) -> str:
    return str(int(amount) * (10_000 - slippage_bps) // 10_000)
