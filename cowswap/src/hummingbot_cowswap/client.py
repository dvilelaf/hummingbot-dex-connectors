"""Thin adapter around cowdao-cowpy Order Book API calls."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from hummingbot_cowswap.cowpy import ensure_cowpy_submodule_imports

if TYPE_CHECKING:
    from hummingbot_cowswap.models import CoWConfig


class CoWClient(Protocol):
    """Protocol implemented by CoW API clients used by the connector."""

    async def quote_sell(self, request: dict[str, object]) -> object:
        """Request a CoW sell quote using connector-normalized fields."""
        ...

    async def post_sell_order(self, order: dict[str, object]) -> str:
        """Post a signed CoW sell order and return the CoW order UID."""
        ...

    async def get_order_status(self, order_uid: str) -> object:
        """Fetch the CoW order model for a previously posted UID."""
        ...

    async def get_trades(self, order_uid: str) -> list[object]:
        """Fetch CoW trade/fill models for a previously posted UID."""
        ...

    async def cancel_order(self, order_uid: str) -> None:
        """Request cancellation for a previously posted UID."""
        ...


class CowDaoOrderBookClient:
    """CoW Order Book API client backed by cowdao-cowpy."""

    def __init__(self, config: CoWConfig) -> None:
        """Create a cowdao-cowpy API wrapper for one chain/environment."""
        self.config = config
        self._api: object | None = None

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

        return await self._order_book_api().post_quote(
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

        order_creation = OrderCreation(
            sellToken=str(order["sell_token"]),
            buyToken=str(order["buy_token"]),
            receiver=str(order["receiver"]),
            sellAmount=str(order["sell_amount"]),
            buyAmount=str(order["buy_amount"]),
            feeAmount=str(order["fee_amount"]),
            validTo=int(order["valid_to"]),
            kind=OrderKind.sell,
            partiallyFillable=bool(order["partially_fillable"]),
            sellTokenBalance=SellTokenSource.erc20,
            buyTokenBalance=BuyTokenDestination.erc20,
            signingScheme=SigningScheme.eip712,
            signature=str(signature),
            from_=str(order["owner"]),
            quoteId=order.get("quote_id"),
            appData=str(order["app_data"]),
        )
        uid = await self._order_book_api().post_order(order_creation)
        return uid.root

    async def get_order_status(self, order_uid: str) -> object:
        """Fetch the cowdao-cowpy order status model by UID."""
        ensure_cowpy_submodule_imports()
        from cowdao_cowpy.order_book.generated.model import UID

        return await self._order_book_api().get_order_by_uid(UID(order_uid))

    async def get_trades(self, order_uid: str) -> list[object]:
        """Fetch cowdao-cowpy trade models for a CoW order UID."""
        ensure_cowpy_submodule_imports()
        from cowdao_cowpy.order_book.generated.model import UID

        return await self._order_book_api().get_trades_by_order_uid(UID(order_uid))

    async def cancel_order(self, order_uid: str) -> None:
        """Reject cancellation until signed cancellation is wired in."""
        message = "CoW cancellation requires Hummingbot-managed signed cancellation"
        raise NotImplementedError(message)

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
