"""JSON persistence for locally tracked CoW orders."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from hummingbot_cowswap.models import CoWToken, TrackedOrder


class JsonOrderStore:
    """Small JSON-backed order store for restart recovery tests and MVP runtime."""

    def __init__(self, path: str | Path) -> None:
        """Create a store backed by the provided JSON file path."""
        self.path = Path(path)

    def save_new(
        self,
        *,
        client_order_id: str,
        trading_pair: str,
        order_uid: str,
        owner: str,
        receiver: str,
        chain_id: int,
        sell_token: CoWToken,
        buy_token: CoWToken,
        sell_amount: str,
        buy_amount: str,
        valid_to: int,
        quote_id: int | None,
        digest: str,
        signing_scheme: str,
        partially_fillable: bool,
    ) -> TrackedOrder:
        """Create, persist, and return a new tracked order record."""
        order = TrackedOrder(
            client_order_id=client_order_id,
            trading_pair=trading_pair,
            order_uid=order_uid,
            owner=owner,
            receiver=receiver,
            chain_id=chain_id,
            sell_token=sell_token,
            buy_token=buy_token,
            sell_amount=sell_amount,
            buy_amount=buy_amount,
            valid_to=valid_to,
            quote_id=quote_id,
            digest=digest,
            signing_scheme=signing_scheme,
            partially_fillable=partially_fillable,
        )
        return self.save(order)

    def save(self, order: TrackedOrder) -> TrackedOrder:
        """Persist an existing tracked order record."""
        data = self._read_all()
        data[order.client_order_id] = order.model_dump(mode="json")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return order

    def load(self, client_order_id: str) -> TrackedOrder | None:
        """Load a tracked order by Hummingbot client order ID."""
        raw_order = self._read_all().get(client_order_id)
        if raw_order is None:
            return None
        return TrackedOrder.model_validate(raw_order)

    def _read_all(self) -> dict[str, Any]:
        if not self.path.exists():
            return {}
        return json.loads(self.path.read_text(encoding="utf-8"))
