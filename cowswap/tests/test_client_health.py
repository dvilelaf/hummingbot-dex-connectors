"""Order Book API health-check tests."""

from __future__ import annotations

import pytest

from hummingbot_cowswap.client import CowDaoOrderBookClient
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


class HealthyApi:
    """Fake cowpy API with an available version endpoint."""

    def __init__(self) -> None:
        self.calls = 0

    async def get_version(self) -> str:
        """Return a version payload."""
        self.calls += 1
        return "1.0.0"


@pytest.mark.asyncio
async def test_check_health_returns_true_when_order_book_api_responds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The health check succeeds when cowpy's version endpoint responds."""
    api = HealthyApi()
    client = CowDaoOrderBookClient(config(), retry_delay_seconds=0)
    monkeypatch.setattr(client, "_api", api)

    assert await client.check_health() is True
    assert api.calls == 1
