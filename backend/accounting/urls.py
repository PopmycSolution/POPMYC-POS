from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework.views import APIView

from .views import (
    AccountViewSet,
    JournalEntryViewSet,
    JournalEntryLineViewSet,
    FinancialTransactionViewSet,
    FiscalPeriodViewSet,
    ReportViews,
)

router = DefaultRouter()
router.register(r"accounts", AccountViewSet, basename="accounting-account")
router.register(r"fiscal-periods", FiscalPeriodViewSet, basename="fiscal-period")
router.register(r"journal-entries/lines", JournalEntryLineViewSet, basename="journal-entry-line")
router.register(r"journal-entries", JournalEntryViewSet, basename="journal-entry")
router.register(r"transactions", FinancialTransactionViewSet, basename="financial-transaction")


class TrialBalanceView(APIView):
    def get(self, request):
        return ReportViews.trial_balance(request)


class ProfitLossView(APIView):
    def get(self, request):
        return ReportViews.profit_loss(request)


class BalanceSheetView(APIView):
    def get(self, request):
        return ReportViews.balance_sheet(request)


class GeneralLedgerView(APIView):
    def get(self, request):
        return ReportViews.general_ledger(request)


urlpatterns = [
    path("", include(router.urls)),
    path("trial-balance/", TrialBalanceView.as_view(), name="trial-balance"),
    path("profit-loss/", ProfitLossView.as_view(), name="profit-loss"),
    path("balance-sheet/", BalanceSheetView.as_view(), name="balance-sheet"),
    path("general-ledger/", GeneralLedgerView.as_view(), name="general-ledger"),
]
