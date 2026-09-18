from django.urls import path, include
from rest_framework.routers import DefaultRouter
from purchases.views import (
    PurchaseOrderViewSet,
    GoodsReceivedNoteViewSet,
    PurchaseReturnViewSet,
    PurchasePaymentViewSet,
)

router = DefaultRouter()
router.register(r"purchase-orders",    PurchaseOrderViewSet,      basename="purchase-order")
router.register(r"grns",               GoodsReceivedNoteViewSet,  basename="grn")
router.register(r"purchase-returns",   PurchaseReturnViewSet,     basename="purchase-return")
router.register(r"purchase-payments",  PurchasePaymentViewSet,    basename="purchase-payment")

urlpatterns = [
    path("", include(router.urls)),
]
