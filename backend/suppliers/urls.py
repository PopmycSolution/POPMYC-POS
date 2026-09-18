from django.urls import path, include
from rest_framework.routers import DefaultRouter
from suppliers.views import (
    SupplierViewSet,
    SupplierContactViewSet,
    SupplierProductPriceViewSet,
    SupplierBalanceViewSet,
    SupplierTransactionViewSet,
)

router = DefaultRouter()
router.register(r"suppliers", SupplierViewSet, basename="supplier")
router.register(r"supplier-contacts", SupplierContactViewSet, basename="supplier-contact")
router.register(r"supplier-product-prices", SupplierProductPriceViewSet, basename="supplier-product-price")
router.register(r"supplier-balances", SupplierBalanceViewSet, basename="supplier-balance")
router.register(r"supplier-transactions", SupplierTransactionViewSet, basename="supplier-transaction")

urlpatterns = [
    path("", include(router.urls)),
]
