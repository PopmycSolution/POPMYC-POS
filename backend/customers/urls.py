from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    CustomerGroupViewSet,
    LoyaltyTierViewSet,
    CustomerViewSet,
    CustomerContactViewSet,
    CustomerCreditViewSet,
    CustomerCreditTransactionViewSet,
    CustomerStatementViewSet,
    LoyaltyTransactionViewSet,
    CustomerLoyaltyCardViewSet,
    SaleOnAccountViewSet,
    SaleOnAccountPaymentViewSet,
)

router = DefaultRouter()
router.register(r"customer-groups", CustomerGroupViewSet, basename="customer-group")
router.register(r"loyalty-tiers", LoyaltyTierViewSet, basename="loyalty-tier")
router.register(r"customers", CustomerViewSet, basename="customer")
router.register(r"customer-contacts", CustomerContactViewSet, basename="customer-contact")
router.register(r"customer-credits", CustomerCreditViewSet, basename="customer-credit")
router.register(r"credit-transactions", CustomerCreditTransactionViewSet, basename="credit-transaction")
router.register(r"customer-statements", CustomerStatementViewSet, basename="customer-statement")
router.register(r"loyalty-transactions", LoyaltyTransactionViewSet, basename="loyalty-transaction")
router.register(r"loyalty-cards", CustomerLoyaltyCardViewSet, basename="loyalty-card")
router.register(r"sales-on-account", SaleOnAccountViewSet, basename="sale-on-account")
router.register(r"account-payments", SaleOnAccountPaymentViewSet, basename="account-payment")

urlpatterns = [
    path("", include(router.urls)),
]
