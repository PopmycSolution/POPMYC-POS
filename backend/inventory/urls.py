from django.urls import path, include
from rest_framework.routers import DefaultRouter
from inventory.views import (
    StockMovementViewSet,
    OpeningStockViewSet,
    OpeningStockItemViewSet,
    StockAdjustmentViewSet,
    StockAdjustmentItemViewSet,
    StockTransferViewSet,
    StockTransferItemViewSet,
    StockCountViewSet,
    StockCountItemViewSet,
    DamagedStockViewSet,
    ExpiredStockViewSet,
    StockAlertViewSet,
)

router = DefaultRouter()
router.register(r"stock-movements", StockMovementViewSet, basename="stock-movement")
router.register(r"opening-stocks", OpeningStockViewSet, basename="opening-stock")
router.register(r"opening-stock-items", OpeningStockItemViewSet, basename="opening-stock-item")
router.register(r"stock-adjustments", StockAdjustmentViewSet, basename="stock-adjustment")
router.register(r"stock-adjustment-items", StockAdjustmentItemViewSet, basename="stock-adjustment-item")
router.register(r"stock-transfers", StockTransferViewSet, basename="stock-transfer")
router.register(r"stock-transfer-items", StockTransferItemViewSet, basename="stock-transfer-item")
router.register(r"stock-counts", StockCountViewSet, basename="stock-count")
router.register(r"stock-count-items", StockCountItemViewSet, basename="stock-count-item")
router.register(r"damaged-stocks", DamagedStockViewSet, basename="damaged-stock")
router.register(r"expired-stocks", ExpiredStockViewSet, basename="expired-stock")
router.register(r"stock-alerts", StockAlertViewSet, basename="stock-alert")

urlpatterns = [
    path("", include(router.urls)),
]
