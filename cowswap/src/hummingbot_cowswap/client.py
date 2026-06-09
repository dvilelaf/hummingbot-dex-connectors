from __future__ import annotations

from typing import Any, Protocol

from hummingbot_cowswap.cowpy import ensure_cowpy_submodule_imports
from hummingbot_cowswap.models import CoWConfig


class CoWClient(Protocol):
    async def quote_sell(self, request: dict[str, object]) -> Any: ...

    async def post_sell_order(self, order: dict[str, object]) -> str: ...

    async def get_order_status(self, order_uid: str) -> Any: ...

    async def get_trades(self, order_uid: str) -> list[Any]: ...

    async def cancel_order(self, order_uid: str) -> None: ...


class CowDaoOrderBookClient:
    def __init__(self, config: CoWConfig) -> None:
        self.config = config
        self._api: Any | None = None

    async def quote_sell(self, request: dict[str, object]) -> Any:
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
        signature = order.get("signature")
        if signature is None:
            raise ValueError("signed order payload must include signature before posting")

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

    async def get_order_status(self, order_uid: str) -> Any:
        ensure_cowpy_submodule_imports()
        from cowdao_cowpy.order_book.generated.model import UID

        return await self._order_book_api().get_order_by_uid(UID(order_uid))

    async def get_trades(self, order_uid: str) -> list[Any]:
        ensure_cowpy_submodule_imports()
        from cowdao_cowpy.order_book.generated.model import UID

        return await self._order_book_api().get_trades_by_order_uid(UID(order_uid))

    async def cancel_order(self, order_uid: str) -> None:
        raise NotImplementedError(
            "CoW cancellation requires Hummingbot-managed signed cancellation"
        )

    def _order_book_api(self) -> Any:
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
