"""Minimal async HTTP transport for cowdao-cowpy using requests/urllib3."""

from __future__ import annotations

import asyncio
from typing import Self

import httpx as _httpx
import requests

HTTPStatusError = _httpx.HTTPStatusError
NetworkError = _httpx.NetworkError
Response = _httpx.Response


class _Response:
    """Expose the response subset consumed by cowdao-cowpy."""

    def __init__(self, response: requests.Response) -> None:
        self._response = response
        self.status_code = response.status_code
        self.text = response.text
        self.headers = response.headers

    def json(self) -> object:
        """Decode the response body as JSON."""
        return self._response.json()

    def raise_for_status(self) -> None:
        """Raise the exception type cowdao-cowpy already handles."""
        try:
            self._response.raise_for_status()
        except requests.HTTPError as exc:
            request = self._response.request
            message = f"HTTP {self.status_code}"
            raise _httpx.HTTPStatusError(
                message,
                request=_httpx.Request(request.method, request.url),
                response=self,
            ) from exc


class AsyncClient:
    """Run requests.Session calls without blocking the event loop."""

    def __init__(self, *, headers: dict[str, str] | None = None, **_: object) -> None:
        """Create an isolated requests session."""
        self._session = requests.Session()
        if headers:
            self._session.headers.update(headers)

    async def __aenter__(self) -> Self:
        """Enter the async client context."""
        return self

    async def __aexit__(self, *_: object) -> None:
        """Close the pooled connections."""
        self._session.close()

    async def request(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        **kwargs: object,
    ) -> _Response:
        """Execute one HTTP request through urllib3's TLS stack."""
        if "content" in kwargs:
            kwargs["data"] = kwargs.pop("content")
        if "follow_redirects" in kwargs:
            kwargs["allow_redirects"] = kwargs.pop("follow_redirects")
        if headers:
            kwargs["headers"] = headers
        try:
            response = await asyncio.to_thread(
                self._session.request,
                method,
                str(url),
                **kwargs,
            )
        except requests.RequestException as exc:
            raise _httpx.NetworkError(str(exc)) from exc
        return _Response(response)
