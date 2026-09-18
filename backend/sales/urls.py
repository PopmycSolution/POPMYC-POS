from django.urls import path, include
from rest_framework.routers import DefaultRouter
from sales.views import (
    PaymentMethodViewSet,
    SaleViewSet,
    SaleItemViewSet,
    SaleTaxViewSet,
    SaleDiscountViewSet,
    SalePaymentViewSet,
    SaleReturnViewSet,
    SaleReturnItemViewSet,
    SaleReturnRefundViewSet,
    HeldSaleViewSet,
    ReceiptViewSet,
    ExchangeViewSet,
    PromotionViewSet,
    CouponViewSet,
    CouponRedemptionViewSet,
    CustomerLoyaltyRewardViewSet,
    LoyaltyRedemptionViewSet,
)

router = DefaultRouter()
router.register(r"payment-methods", PaymentMethodViewSet, basename="payment-method")
router.register(r"sales", SaleViewSet, basename="sale")
router.register(r"sale-items", SaleItemViewSet, basename="sale-item")
router.register(r"sale-taxes", SaleTaxViewSet, basename="sale-tax")
router.register(r"sale-discounts", SaleDiscountViewSet, basename="sale-discount")
router.register(r"sale-payments", SalePaymentViewSet, basename="sale-payment")
router.register(r"sale-returns", SaleReturnViewSet, basename="sale-return")
router.register(r"sale-return-items", SaleReturnItemViewSet, basename="sale-return-item")
router.register(r"sale-return-refunds", SaleReturnRefundViewSet, basename="sale-return-refund")
router.register(r"held-sales", HeldSaleViewSet, basename="held-sale")
router.register(r"receipts", ReceiptViewSet, basename="receipt")
router.register(r"exchanges", ExchangeViewSet, basename="exchange")
router.register(r"promotions", PromotionViewSet, basename="promotion")
router.register(r"coupons", CouponViewSet, basename="coupon")
router.register(r"coupon-redemptions", CouponRedemptionViewSet, basename="coupon-redemption")
router.register(r"loyalty-rewards", CustomerLoyaltyRewardViewSet, basename="loyalty-reward")
router.register(r"loyalty-redemptions", LoyaltyRedemptionViewSet, basename="loyalty-redemption")

urlpatterns = [
    path("", include(router.urls)),
]
