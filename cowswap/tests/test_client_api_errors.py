"""Order Book API error handling tests."""

from __future__ import annotations

import logging
from types import SimpleNamespace
from typing import NoReturn

import pytest

from hummingbot_cowswap.client import CowDaoOrderBookClient
from hummingbot_cowswap.cowpy import ensure_cowpy_submodule_imports
from hummingbot_cowswap.errors import (
    CoWOrderBookAPIError,
    CoWOrderBookMalformedResponseError,
    CoWOrderBookRateLimitError,
    CoWOrderBookTransientError,
)
from hummingbot_cowswap.models import CoWConfig


def config() -> CoWConfig:
    """Build a minimal client config."""
    return CoWConfig(
        chain_id=8453,
        chain_name="base",
        owner="0x00000000000000000000000000000000000000aa",
        receiver="0x00000000000000000000000000000000000000aa",
        app_data="0x" + "00" * 32,
    )


def quote_request() -> dict[str, object]:
    """Build a connector-normalized quote request."""
    return {
        "sell_token": "0x0000000000000000000000000000000000000001",
        "buy_token": "0x0000000000000000000000000000000000000002",
        "receiver": "0x00000000000000000000000000000000000000aa",
        "owner": "0x00000000000000000000000000000000000000aa",
        "app_data": "0x" + "00" * 32,
        "sell_amount": "1000000",
        "valid_to": None,
    }


def signed_order() -> dict[str, object]:
    """Build a connector-normalized signed sell order."""
    return {
        "sell_token": "0x0000000000000000000000000000000000000001",
        "buy_token": "0x0000000000000000000000000000000000000002",
        "receiver": "0x00000000000000000000000000000000000000aa",
        "owner": "0x00000000000000000000000000000000000000aa",
        "sell_amount": "1000000",
        "buy_amount": "497500000000000000",
        "fee_amount": "0",
        "valid_to": 1_900_000_000,
        "partially_fillable": False,
        "quote_id": 99,
        "app_data": "0x" + "00" * 32,
        "signature": "0x" + "11" * 65,
    }


class TimeoutQuoteApi:
    """Fake cowpy API that times out while quoting."""

    async def post_quote(self, *_args: object) -> NoReturn:
        """Raise the timeout shape produced by cowpy's generic wrapper."""
        ensure_cowpy_submodule_imports()
        from cowdao_cowpy.common.api.errors import UnexpectedResponseError

        message = "An unexpected error occurred: timed out"
        raise UnexpectedResponseError(message)


class RejectedOrderApi:
    """Fake cowpy API that rejects order posting."""

    async def post_quote(self, *_args: object) -> NoReturn:
        """Raise a generic cowpy/API failure."""
        ensure_cowpy_submodule_imports()
        from cowdao_cowpy.common.api.errors import ApiResponseError

        message = "unsupported token"
        raise ApiResponseError(message, "UnsupportedToken", {})

    async def post_order(self, _order: object) -> NoReturn:
        """Raise a generic cowpy/API failure."""
        ensure_cowpy_submodule_imports()
        from cowdao_cowpy.common.api.errors import ApiResponseError

        message = "insufficient balance"
        raise ApiResponseError(message, "InsufficientBalance", {})


class MalformedUidApi:
    """Fake cowpy API that returns an unexpected post_order payload."""

    async def post_order(self, _order: object) -> object:
        """Return a payload without the cowpy UID root field."""
        return SimpleNamespace(uid="0xabc")


class CancellationApi:
    """Fake cowpy API that captures signed cancellations."""

    def __init__(self) -> None:
        self.cancellations: list[object] = []

    async def delete_order(self, cancellation: object) -> str:
        """Capture cancellation payload."""
        self.cancellations.append(cancellation)
        return "ok"


class FlakyQuoteApi:
    """Fake cowpy API that succeeds after a transient quote failure."""

    def __init__(self) -> None:
        self.calls = 0

    async def post_quote(self, *_args: object) -> object:
        """Fail transiently once, then return a quote payload."""
        self.calls += 1
        if self.calls == 1:
            ensure_cowpy_submodule_imports()
            from cowdao_cowpy.common.api.errors import NetworkError

            message = "connection reset"
            raise NetworkError(message)
        return SimpleNamespace(quote=SimpleNamespace(validTo=1_900_000_000))


class RateLimitedQuoteApi:
    """Fake cowpy API that returns a rate-limit rejection."""

    def __init__(self) -> None:
        self.calls = 0

    async def post_quote(self, *_args: object) -> NoReturn:
        """Raise cowpy's API response error with a 429 shape."""
        self.calls += 1
        ensure_cowpy_submodule_imports()
        from cowdao_cowpy.common.api.errors import ApiResponseError

        message = "rate limit exceeded"
        raise ApiResponseError(message, "TooManyRequests", {"status": 429})


@pytest.mark.asyncio
async def test_quote_sell_wraps_timeout_as_transient_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """Quote timeouts surface as connector-controlled transient errors."""
    client = CowDaoOrderBookClient(config())
    monkeypatch.setattr(client, "_api", TimeoutQuoteApi())

    with pytest.raises(CoWOrderBookTransientError, match="quote_sell") as exc_info:
        await client.quote_sell(quote_request())

    assert exc_info.value.__cause__.__class__.__name__ == "UnexpectedResponseError"


@pytest.mark.asyncio
async def test_quote_sell_wraps_api_rejection(monkeypatch: pytest.MonkeyPatch) -> None:
    """CoW quote rejections surface as connector-controlled API errors."""
    client = CowDaoOrderBookClient(config())
    monkeypatch.setattr(client, "_api", RejectedOrderApi())

    with pytest.raises(CoWOrderBookAPIError, match="quote_sell") as exc_info:
        await client.quote_sell(quote_request())

    assert "unsupported token" in str(exc_info.value)
    assert exc_info.value.__cause__.__class__.__name__ == "ApiResponseError"


@pytest.mark.asyncio
async def test_post_sell_order_wraps_api_rejection(monkeypatch: pytest.MonkeyPatch) -> None:
    """CoW API rejections surface as connector-controlled API errors."""
    client = CowDaoOrderBookClient(config())
    monkeypatch.setattr(client, "_api", RejectedOrderApi())

    with pytest.raises(CoWOrderBookAPIError, match="post_sell_order") as exc_info:
        await client.post_sell_order(signed_order())

    assert "insufficient balance" in str(exc_info.value)
    assert exc_info.value.__cause__.__class__.__name__ == "ApiResponseError"


@pytest.mark.asyncio
async def test_post_sell_order_rejects_malformed_uid(monkeypatch: pytest.MonkeyPatch) -> None:
    """Unexpected cowpy post_order responses fail before reaching persistence."""
    client = CowDaoOrderBookClient(config())
    monkeypatch.setattr(client, "_api", MalformedUidApi())

    with pytest.raises(CoWOrderBookMalformedResponseError, match="post_sell_order"):
        await client.post_sell_order(signed_order())


@pytest.mark.asyncio
async def test_cancel_order_posts_signed_cancellation(monkeypatch: pytest.MonkeyPatch) -> None:
    """Signed cancellations are sent through cowpy delete_order."""
    api = CancellationApi()
    client = CowDaoOrderBookClient(config(), retry_delay_seconds=0)
    monkeypatch.setattr(client, "_api", api)
    order_uid = "0x" + ("aa" * 32) + "00000000000000000000000000000000000000aa" + "713fb300"

    await client.cancel_order(order_uid, {"signature": "0x" + "11" * 65})

    assert len(api.cancellations) == 1
    assert api.cancellations[0].orderUids[0].root == order_uid


@pytest.mark.asyncio
async def test_cancel_order_requires_signed_cancellation() -> None:
    """The cowpy-backed client does not invent cancellation signatures."""
    client = CowDaoOrderBookClient(config(), retry_delay_seconds=0)

    with pytest.raises(NotImplementedError, match="signed cancellation"):
        await client.cancel_order("0x" + "aa" * 56)


@pytest.mark.asyncio
async def test_quote_sell_retries_transient_failures(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Transient Order Book API failures are retried before surfacing."""
    api = FlakyQuoteApi()
    client = CowDaoOrderBookClient(config(), retry_delay_seconds=0)
    monkeypatch.setattr(client, "_api", api)
    caplog.set_level(logging.WARNING, logger="hummingbot_cowswap.client")

    quote = await client.quote_sell(quote_request())

    assert quote.quote.validTo == 1_900_000_000
    assert api.calls == 2
    assert caplog.records[0].cow_operation == "quote_sell"
    assert caplog.records[0].cow_attempt == 1


@pytest.mark.asyncio
async def test_quote_sell_wraps_rate_limit_after_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    """Rate limits surface as a specific transient connector error."""
    api = RateLimitedQuoteApi()
    client = CowDaoOrderBookClient(config(), retry_delay_seconds=0)
    monkeypatch.setattr(client, "_api", api)

    with pytest.raises(CoWOrderBookRateLimitError, match="quote_sell"):
        await client.quote_sell(quote_request())

    assert api.calls == 3
