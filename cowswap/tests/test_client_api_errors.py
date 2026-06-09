"""Order Book API error handling tests."""

from __future__ import annotations

from types import SimpleNamespace
from typing import NoReturn

import pytest

from hummingbot_cowswap.client import CowDaoOrderBookClient
from hummingbot_cowswap.cowpy import ensure_cowpy_submodule_imports
from hummingbot_cowswap.errors import (
    CoWOrderBookAPIError,
    CoWOrderBookMalformedResponseError,
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
