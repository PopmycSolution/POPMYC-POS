from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    ExpenseCategoryViewSet,
    ExpenseViewSet,
    RecurringExpenseViewSet,
    ExpenseApprovalViewSet,
)

router = DefaultRouter()
router.register(r"categories", ExpenseCategoryViewSet, basename="expense-category")
router.register(r"approvals", ExpenseApprovalViewSet, basename="expense-approval")
router.register(r"recurring", RecurringExpenseViewSet, basename="recurring-expense")
router.register(r"", ExpenseViewSet, basename="expense")

urlpatterns = [
    path("", include(router.urls)),
]
