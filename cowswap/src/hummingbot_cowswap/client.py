"""Thin adapter around cowdao-cowpy Order Book API calls."""
# pyright: reportAttributeAccessIssue=false, reportArgumentType=false, reportCallIssue=false

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any, Protocol, TypeVar, cast

from hummingbot_cowswap.cowpy import ensure_cowpy_submodule_imports
from hummingbot_cowswap.errors import (
    CoWOrderBookAPIError,
    CoWOrderBookMalformedResponseError,
    CoWOrderBookRateLimitError,
    CoWOrderBookTransientError,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from hummingbot_cowswap.models import CoWConfig

T = TypeVar("T")
DEFAULT_TIMEOUT_SECONDS = 10.0
DEFAULT_MAX_ATTEMPTS = 3
DEFAULT_RETRY_DELAY_SECONDS = 0.25
HTTP_TOO_MANY_REQUESTS = 429
HTTP_SERVER_ERROR_MIN = 500
HTTP_SERVER_ERROR_MAX = 600
LOGGER = logging.getLogger(__name__)


class CoWClient(Protocol):
    """Protocol implemented by CoW API clients used by the connector."""

    async def quote_sell(self, request: dict[str, object]) -> object:
        """Request a CoW sell quote using connector-normalized fields."""
        ...

    async def quote_buy(self, request: dict[str, object]) -> object:
        """Request a CoW buy quote using connector-normalized fields."""
        ...

    async def post_sell_order(self, order: dict[str, object]) -> str:
        """Post a signed CoW order and return the CoW order UID."""
        ...

    async def get_order_status(self, order_uid: str) -> object:
        """Fetch the CoW order model for a previously posted UID."""
        ...

    async def get_trades(self, order_uid: str) -> list[object]:
        """Fetch CoW trade/fill models for a previously posted UID."""
        ...

    async def cancel_order(
        self,
        order_uid: str,
        cancellation: dict[str, object] | None = None,
    ) -> None:
        """Request cancellation for a previously posted UID."""
        ...

    async def check_health(self) -> bool:
        """Return whether the CoW Order Book API is reachable."""
        ...


class CowDaoOrderBookClient:
    """CoW Order Book API client backed by cowdao-cowpy."""

    def __init__(
        self,
        config: CoWConfig,
        *,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
        max_attempts: int = DEFAULT_MAX_ATTEMPTS,
        retry_delay_seconds: float = DEFAULT_RETRY_DELAY_SECONDS,
    ) -> None:
        """Create a cowdao-cowpy API wrapper for one chain/environment."""
        self.config = config
        self._api: object | None = None
        self._timeout_seconds = timeout_seconds
        self._max_attempts = max(1, max_attempts)
        self._retry_delay_seconds = max(0.0, retry_delay_seconds)

    async def quote_sell(self, request: dict[str, object]) -> object:
        """Build and submit a cowdao-cowpy sell quote request."""
        ensure_cowpy_submodule_imports()
        from cowdao_cowpy.order_book.generated.model import (
            BuyTokenDestination,
            OrderQuoteRequest,
            OrderQuoteSide1,
            OrderQuoteSideKindSell,
            OrderQuoteValidity1,
            PriceQuality,
            SellTokenSource,
            SigningScheme,
            TokenAmount,
        )

        return await _call_order_book(
            "quote_sell",
            lambda: self._order_book_api().post_quote(
                OrderQuoteRequest(
                    sellToken=str(request["sell_token"]),
                    buyToken=str(request["buy_token"]),
                    receiver=str(request["receiver"]),
                    from_=str(request["owner"]),
                    appData=str(request["app_data"]),
                    sellTokenBalance=SellTokenSource.erc20,
                    buyTokenBalance=BuyTokenDestination.erc20,
                    priceQuality=PriceQuality.verified,
                    signingScheme=SigningScheme.eip712,
                ),
                OrderQuoteSide1(
                    kind=OrderQuoteSideKindSell.sell,
                    sellAmountBeforeFee=TokenAmount(str(request["sell_amount"])),
                ),
                OrderQuoteValidity1(validTo=request["valid_to"]),
            ),
            timeout_seconds=self._timeout_seconds,
            max_attempts=self._max_attempts,
            retry_delay_seconds=self._retry_delay_seconds,
        )

    async def quote_buy(self, request: dict[str, object]) -> object:
        """Build and submit a cowdao-cowpy buy quote request."""
        ensure_cowpy_submodule_imports()
        from cowdao_cowpy.order_book.generated.model import (
            BuyTokenDestination,
            OrderQuoteRequest,
            OrderQuoteSide3,
            OrderQuoteSideKindBuy,
            OrderQuoteValidity1,
            PriceQuality,
            SellTokenSource,
            SigningScheme,
            TokenAmount,
        )

        return await _call_order_book(
            "quote_buy",
            lambda: self._order_book_api().post_quote(
                OrderQuoteRequest(
                    sellToken=str(request["sell_token"]),
                    buyToken=str(request["buy_token"]),
                    receiver=str(request["receiver"]),
                    from_=str(request["owner"]),
                    appData=str(request["app_data"]),
                    sellTokenBalance=SellTokenSource.erc20,
                    buyTokenBalance=BuyTokenDestination.erc20,
                    priceQuality=PriceQuality.verified,
                    signingScheme=SigningScheme.eip712,
                ),
                OrderQuoteSide3(
                    kind=OrderQuoteSideKindBuy.buy,
                    buyAmountAfterFee=TokenAmount(str(request["buy_amount"])),
                ),
                OrderQuoteValidity1(validTo=request["valid_to"]),
            ),
            timeout_seconds=self._timeout_seconds,
            max_attempts=self._max_attempts,
            retry_delay_seconds=self._retry_delay_seconds,
        )

    async def post_sell_order(self, order: dict[str, object]) -> str:
        """Build and submit a cowdao-cowpy signed order request."""
        signature = order.get("signature")
        if signature is None:
            message = "signed order payload must include signature before posting"
            raise ValueError(message)

        ensure_cowpy_submodule_imports()
        from cowdao_cowpy.order_book.generated.model import (
            BuyTokenDestination,
            OrderCreation,
            OrderKind,
            SellTokenSource,
            SigningScheme,
        )

        order_kind = _order_kind(OrderKind, str(order.get("kind", "sell")))
        order_creation = OrderCreation(
            sellToken=str(order["sell_token"]),
            buyToken=str(order["buy_token"]),
            receiver=str(order["receiver"]),
            sellAmount=str(order["sell_amount"]),
            buyAmount=str(order["buy_amount"]),
            feeAmount=str(order["fee_amount"]),
            validTo=int(order["valid_to"]),
            kind=order_kind,
            partiallyFillable=bool(order["partially_fillable"]),
            sellTokenBalance=SellTokenSource.erc20,
            buyTokenBalance=BuyTokenDestination.erc20,
            signingScheme=SigningScheme.eip712,
            signature=str(signature),
            from_=str(order["owner"]),
            quoteId=order.get("quote_id"),
            appData=str(order["app_data"]),
        )
        uid = await _call_order_book(
            "post_sell_order",
            lambda: self._order_book_api().post_order(order_creation),
            timeout_seconds=self._timeout_seconds,
            max_attempts=self._max_attempts,
            retry_delay_seconds=self._retry_delay_seconds,
        )
        try:
            return str(uid.root)
        except AttributeError as exc:
            message = (
                "malformed CoW Order Book API response during post_sell_order: missing UID root"
            )
            raise CoWOrderBookMalformedResponseError(message) from exc

    async def get_order_status(self, order_uid: str) -> object:
        """Fetch the cowdao-cowpy order status model by UID."""
        ensure_cowpy_submodule_imports()
        from cowdao_cowpy.order_book.generated.model import UID

        return await _call_order_book(
            "get_order_status",
            lambda: self._order_book_api().get_order_by_uid(UID(order_uid)),
            timeout_seconds=self._timeout_seconds,
            max_attempts=self._max_attempts,
            retry_delay_seconds=self._retry_delay_seconds,
        )

    async def get_trades(self, order_uid: str) -> list[object]:
        """Fetch cowdao-cowpy trade models for a CoW order UID."""
        ensure_cowpy_submodule_imports()
        from cowdao_cowpy.order_book.generated.model import UID

        return await _call_order_book(
            "get_trades",
            lambda: self._order_book_api().get_trades_by_order_uid(UID(order_uid)),
            timeout_seconds=self._timeout_seconds,
            max_attempts=self._max_attempts,
            retry_delay_seconds=self._retry_delay_seconds,
        )

    async def cancel_order(
        self,
        order_uid: str,
        cancellation: dict[str, object] | None = None,
    ) -> None:
        """Submit a signed off-chain cancellation for a CoW order UID."""
        if cancellation is None:
            message = "CoW cancellation requires Hummingbot-managed signed cancellation"
            raise NotImplementedError(message)
        ensure_cowpy_submodule_imports()
        from cowdao_cowpy.order_book.generated.model import (
            UID,
            EcdsaSigningScheme,
            OrderCancellations,
        )

        await _call_order_book(
            "cancel_order",
            lambda: self._order_book_api().delete_order(
                OrderCancellations(
                    orderUids=[UID(order_uid)],
                    signature=str(cancellation["signature"]),
                    signingScheme=EcdsaSigningScheme.eip712,
                )
            ),
            timeout_seconds=self._timeout_seconds,
            max_attempts=self._max_attempts,
            retry_delay_seconds=self._retry_delay_seconds,
        )

    async def check_health(self) -> bool:
        """Return whether the cowdao-cowpy Order Book API responds."""
        await _call_order_book(
            "check_health",
            lambda: self._order_book_api().get_version(),
            timeout_seconds=self._timeout_seconds,
            max_attempts=self._max_attempts,
            retry_delay_seconds=self._retry_delay_seconds,
        )
        return True

    def _order_book_api(self) -> object:
        """Return the lazily initialized cowdao-cowpy OrderBookApi instance."""
        if self._api is None:
            ensure_cowpy_submodule_imports()
            from cowdao_cowpy.common.config import SupportedChainId
            from cowdao_cowpy.order_book.api import OrderBookApi
            from cowdao_cowpy.order_book.config import OrderBookAPIConfigFactory

            self._api = OrderBookApi(
                OrderBookAPIConfigFactory.get_config(
                    self.config.env,
                    SupportedChainId(self.config.chain_id),
                )
            )
        return self._api


async def _call_order_book(
    operation: str,
    request_factory: Callable[[], Awaitable[T]],
    *,
    timeout_seconds: float,
    max_attempts: int,
    retry_delay_seconds: float,
) -> T:
    """Convert cowpy API failures into connector-controlled exceptions."""
    ensure_cowpy_submodule_imports()
    from cowdao_cowpy.common.api.errors import (
        ApiResponseError,
        NetworkError,
        SerializationError,
        UnexpectedResponseError,
    )

    max_attempts = max(1, max_attempts)
    for attempt in range(1, max_attempts + 1):
        cause: Exception
        try:
            return await asyncio.wait_for(request_factory(), timeout=timeout_seconds)
        except (
            TimeoutError,
            NetworkError,
            UnexpectedResponseError,
            SerializationError,
            ApiResponseError,
        ) as exc:
            cause = exc
            error = _map_order_book_error(operation, exc)

        if attempt >= max_attempts:
            raise error from cause
        LOGGER.warning(
            "retrying CoW Order Book API operation",
            extra={
                "cow_operation": operation,
                "cow_attempt": attempt,
                "cow_max_attempts": max_attempts,
                "cow_error_type": cause.__class__.__name__,
            },
        )
        if retry_delay_seconds:
            await asyncio.sleep(retry_delay_seconds)

    message = f"transient CoW Order Book API failure during {operation}: exhausted retries"
    raise CoWOrderBookTransientError(message)


def _map_order_book_error(operation: str, exc: Exception) -> CoWOrderBookAPIError:
    """Map a cowpy or asyncio failure into the connector error hierarchy."""
    ensure_cowpy_submodule_imports()
    from cowdao_cowpy.common.api.errors import (
        ApiResponseError,
        NetworkError,
        SerializationError,
        UnexpectedResponseError,
    )

    if isinstance(exc, TimeoutError | NetworkError):
        message = f"transient CoW Order Book API failure during {operation}: {exc}"
        return CoWOrderBookTransientError(message)
    if isinstance(exc, UnexpectedResponseError):
        if _looks_like_timeout(exc):
            message = f"transient CoW Order Book API failure during {operation}: {exc}"
            return CoWOrderBookTransientError(message)
        message = f"malformed CoW Order Book API response during {operation}: {exc}"
        raise CoWOrderBookMalformedResponseError(message) from exc
    if isinstance(exc, SerializationError):
        message = f"malformed CoW Order Book API response during {operation}: {exc}"
        raise CoWOrderBookMalformedResponseError(message) from exc
    if isinstance(exc, ApiResponseError):
        if _is_rate_limit(exc):
            message = f"rate-limited by CoW Order Book API during {operation}: {exc}"
            return CoWOrderBookRateLimitError(message)
        if _is_server_error(exc):
            message = f"transient CoW Order Book API failure during {operation}: {exc}"
            return CoWOrderBookTransientError(message)
        message = f"CoW Order Book API rejected {operation}: {exc}"
        raise CoWOrderBookAPIError(message) from exc
    message = f"CoW Order Book API rejected {operation}: {exc}"
    raise CoWOrderBookAPIError(message) from exc


def _looks_like_timeout(exc: Exception) -> bool:
    """Return whether cowpy wrapped a timeout as an unexpected response."""
    message = str(exc).lower()
    return "timeout" in message or "timed out" in message


def _is_rate_limit(exc: Exception) -> bool:
    """Return whether cowpy exposed an Order Book API rate limit."""
    message = str(exc).lower()
    return (
        _api_status(exc) == HTTP_TOO_MANY_REQUESTS
        or "rate limit" in message
        or "too many" in message
    )


def _is_server_error(exc: Exception) -> bool:
    """Return whether cowpy exposed a retryable server-side API failure."""
    status = _api_status(exc)
    return status is not None and HTTP_SERVER_ERROR_MIN <= status < HTTP_SERVER_ERROR_MAX


def _api_status(exc: Exception) -> int | None:
    """Extract an HTTP status code from cowpy's ApiResponseError shapes."""
    response = getattr(exc, "response", None)
    status = getattr(response, "status_code", None)
    if status is None and isinstance(response, dict):
        status = response.get("status") or response.get("status_code")
    try:
        return int(cast("Any", status))
    except (TypeError, ValueError):
        return None


def _order_kind(order_kind_enum: object, kind: str) -> object:
    """Resolve connector string kind into cowpy's generated OrderKind enum."""
    try:
        return getattr(order_kind_enum, kind)
    except AttributeError as exc:
        message = f"unsupported CoW order kind: {kind}"
        raise ValueError(message) from exc
