from django.db.models import Sum, Count, Q, F, Value as V
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters
from decimal import Decimal

from common.mixins import BusinessScopedMixin

from .models import (
    Account,
    JournalEntry,
    JournalEntryLine,
    FinancialTransaction,
    FiscalPeriod,
)
from .serializers import (
    AccountSerializer,
    JournalEntrySerializer,
    JournalEntryLineSerializer,
    FinancialTransactionSerializer,
    FiscalPeriodSerializer,
)


class AccountViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = Account.objects.all()
    serializer_class = AccountSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = [
        "business",
        "account_type",
        "parent",
        "is_active",
        "is_contra",
        "is_control_account",
        "is_cash_account",
        "is_bank_account",
        "tax_relevant",
    ]
    search_fields = ["account_code", "name", "description"]
    ordering_fields = ["account_code", "name", "sort_order", "created_at"]


class FiscalPeriodViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = FiscalPeriod.objects.all()
    serializer_class = FiscalPeriodSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["business", "period_type", "status", "is_closed"]
    search_fields = ["name"]
    ordering_fields = ["start_date", "end_date", "created_at"]

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        period = self.get_object()
        period.status = "CLOSED"
        period.is_closed = True
        period.closed_at = timezone.now()
        period.closed_by = request.user
        period.save()
        return Response(FiscalPeriodSerializer(period).data)

    @action(detail=True, methods=["post"])
    def reopen(self, request, pk=None):
        period = self.get_object()
        period.status = "OPEN"
        period.is_closed = False
        period.closed_at = None
        period.closed_by = None
        period.save()
        return Response(FiscalPeriodSerializer(period).data)


class JournalEntryViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = JournalEntry.objects.all()
    serializer_class = JournalEntrySerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = [
        "business",
        "status",
        "source_module",
        "fiscal_period",
        "is_adjusting",
        "is_closing",
        "entry_date",
    ]
    search_fields = ["entry_number", "reference", "description", "notes"]
    ordering_fields = ["entry_number", "entry_date", "created_at"]

    def perform_create(self, serializer):
        instance = serializer.save()
        instance.total_debits = sum(
            line.debit_amount for line in instance.lines.all()
        )
        instance.total_credits = sum(
            line.credit_amount for line in instance.lines.all()
        )
        instance.save()

    @action(detail=True, methods=["post"])
    def post(self, request, pk=None):
        journal_entry = self.get_object()
        if journal_entry.status != "DRAFT":
            return Response(
                {"detail": "Only draft entries can be posted."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        lines = journal_entry.lines.all()
        total_debit = sum(line.debit_amount for line in lines)
        total_credit = sum(line.credit_amount for line in lines)
        if total_debit != total_credit:
            return Response(
                {"detail": f"Journal entry must balance. Debits: {total_debit}, Credits: {total_credit}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        journal_entry.status = "POSTED"
        journal_entry.total_debits = total_debit
        journal_entry.total_credits = total_credit
        journal_entry.posted_at = timezone.now()
        journal_entry.posted_by = request.user
        journal_entry.save()
        return Response(JournalEntrySerializer(journal_entry).data)

    @action(detail=True, methods=["post"])
    def void(self, request, pk=None):
        journal_entry = self.get_object()
        if journal_entry.status != "POSTED":
            return Response(
                {"detail": "Only posted entries can be voided."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        journal_entry.status = "VOIDED"
        journal_entry.voided_at = timezone.now()
        journal_entry.voided_by = request.user
        journal_entry.save()
        return Response(JournalEntrySerializer(journal_entry).data)


class JournalEntryLineViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = JournalEntryLine.objects.all()
    serializer_class = JournalEntryLineSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["journal_entry", "business", "account", "branch"]
    search_fields = ["line_description", "reference_type"]
    ordering_fields = ["created_at"]


class FinancialTransactionViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = FinancialTransaction.objects.all()
    serializer_class = FinancialTransactionSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = [
        "business",
        "transaction_type",
        "direction",
        "account",
        "counterparty_type",
        "journal_entry",
        "branch",
    ]
    search_fields = ["reference", "description"]
    ordering_fields = ["transaction_date", "created_at", "amount"]


class ReportViews:
    @staticmethod
    def trial_balance(request):
        period = request.query_params.get("period")
        business = request.query_params.get("business")
        date_from = request.query_params.get("from")
        date_to = request.query_params.get("to")

        queryset = JournalEntryLine.objects.filter(
            journal_entry__status="POSTED"
        )

        if business:
            queryset = queryset.filter(business_id=business)
        if period:
            queryset = queryset.filter(journal_entry__fiscal_period_id=period)
        if date_from:
            queryset = queryset.filter(journal_entry__entry_date__gte=date_from)
        if date_to:
            queryset = queryset.filter(journal_entry__entry_date__lte=date_to)

        accounts_data = (
            queryset.values(
                "account__id",
                "account__account_code",
                "account__name",
                "account__account_type",
                "account__normal_balance",
            )
            .annotate(
                total_debits=Coalesce(Sum("debit_amount"), Decimal("0.00")),
                total_credits=Coalesce(Sum("credit_amount"), Decimal("0.00")),
            )
            .order_by("account__account_code")
        )

        result = []
        total_debit = Decimal("0.00")
        total_credit = Decimal("0.00")

        for acc in accounts_data:
            balance = acc["total_debits"] - acc["total_credits"]
            if acc["account__normal_balance"] == "CREDIT":
                balance = -balance
            result.append(
                {
                    "account_id": acc["account__id"],
                    "account_code": acc["account__account_code"],
                    "account_name": acc["account__name"],
                    "account_type": acc["account__account_type"],
                    "debit": acc["total_debits"],
                    "credit": acc["total_credits"],
                    "balance": balance,
                }
            )
            total_debit += acc["total_debits"]
            total_credit += acc["total_credits"]

        return Response(
            {
                "accounts": result,
                "total_debits": total_debit,
                "total_credits": total_credit,
                "difference": total_debit - total_credit,
            }
        )

    @staticmethod
    def profit_loss(request):
        date_from = request.query_params.get("from")
        date_to = request.query_params.get("to")
        business = request.query_params.get("business")
        branch = request.query_params.get("branch")

        lines_query = JournalEntryLine.objects.filter(
            journal_entry__status="POSTED"
        )

        if business:
            lines_query = lines_query.filter(business_id=business)
        if date_from:
            lines_query = lines_query.filter(journal_entry__entry_date__gte=date_from)
        if date_to:
            lines_query = lines_query.filter(journal_entry__entry_date__lte=date_to)
        if branch:
            lines_query = lines_query.filter(branch_id=branch)

        revenue_lines = lines_query.filter(account__account_type="REVENUE")
        expense_lines = lines_query.filter(account__account_type="EXPENSE")

        revenue_total = Decimal("0.00")
        expense_total = Decimal("0.00")

        revenue_by_account = []
        for line in (
            revenue_lines.values("account__id", "account__account_code", "account__name")
            .annotate(
                credit=Coalesce(Sum("credit_amount"), Decimal("0.00")),
                debit=Coalesce(Sum("debit_amount"), Decimal("0.00")),
            )
            .order_by("account__account_code")
        ):
            amount = line["credit"] - line["debit"]
            revenue_total += amount
            revenue_by_account.append(
                {
                    "account_id": line["account__id"],
                    "code": line["account__account_code"],
                    "name": line["account__name"],
                    "amount": amount,
                }
            )

        expense_by_account = []
        for line in (
            expense_lines.values("account__id", "account__account_code", "account__name")
            .annotate(
                debit=Coalesce(Sum("debit_amount"), Decimal("0.00")),
                credit=Coalesce(Sum("credit_amount"), Decimal("0.00")),
            )
            .order_by("account__account_code")
        ):
            amount = line["debit"] - line["credit"]
            expense_total += amount
            expense_by_account.append(
                {
                    "account_id": line["account__id"],
                    "code": line["account__account_code"],
                    "name": line["account__name"],
                    "amount": amount,
                }
            )

        gross_profit = revenue_total
        net_profit = revenue_total - expense_total

        return Response(
            {
                "period": {"from": date_from, "to": date_to},
                "total_revenue": revenue_total,
                "total_expenses": expense_total,
                "gross_profit": gross_profit,
                "net_profit": net_profit,
                "revenue_breakdown": revenue_by_account,
                "expense_breakdown": expense_by_account,
            }
        )

    @staticmethod
    def balance_sheet(request):
        as_of_date = request.query_params.get("date")
        business = request.query_params.get("business")

        lines_query = JournalEntryLine.objects.filter(
            journal_entry__status="POSTED"
        )

        if business:
            lines_query = lines_query.filter(business_id=business)
        if as_of_date:
            lines_query = lines_query.filter(journal_entry__entry_date__lte=as_of_date)

        account_balances = {}
        for line in (
            lines_query.values("account__id", "account__account_type", "account__normal_balance")
            .annotate(
                debit=Coalesce(Sum("debit_amount"), Decimal("0.00")),
                credit=Coalesce(Sum("credit_amount"), Decimal("0.00")),
            )
        ):
            balance = line["debit"] - line["credit"]
            if line["account__normal_balance"] == "CREDIT":
                balance = -balance
            acc_type = line["account__account_type"]
            if acc_type not in account_balances:
                account_balances[acc_type] = Decimal("0.00")
            account_balances[acc_type] += balance

        assets = account_balances.get("ASSET", Decimal("0.00"))
        liabilities = account_balances.get("LIABILITY", Decimal("0.00"))
        equity = account_balances.get("EQUITY", Decimal("0.00"))

        accounts_detail = []
        for line in (
            lines_query.values(
                "account__id",
                "account__account_code",
                "account__name",
                "account__account_type",
                "account__normal_balance",
            )
            .annotate(
                debit=Coalesce(Sum("debit_amount"), Decimal("0.00")),
                credit=Coalesce(Sum("credit_amount"), Decimal("0.00")),
            )
            .order_by("account__account_code")
        ):
            balance = line["debit"] - line["credit"]
            if line["account__normal_balance"] == "CREDIT":
                balance = -balance
            accounts_detail.append(
                {
                    "account_id": line["account__id"],
                    "code": line["account__account_code"],
                    "name": line["account__name"],
                    "type": line["account__account_type"],
                    "balance": balance,
                }
            )

        return Response(
            {
                "as_of_date": as_of_date,
                "assets": assets,
                "liabilities": liabilities,
                "equity": equity,
                "total_liabilities_equity": liabilities + equity,
                "accounts": accounts_detail,
            }
        )

    @staticmethod
    def general_ledger(request):
        account = request.query_params.get("account")
        date_from = request.query_params.get("from")
        date_to = request.query_params.get("to")
        business = request.query_params.get("business")

        lines_query = JournalEntryLine.objects.filter(
            journal_entry__status="POSTED"
        ).select_related("journal_entry", "account")

        if business:
            lines_query = lines_query.filter(business_id=business)
        if account:
            lines_query = lines_query.filter(account_id=account)
        if date_from:
            lines_query = lines_query.filter(journal_entry__entry_date__gte=date_from)
        if date_to:
            lines_query = lines_query.filter(journal_entry__entry_date__lte=date_to)

        lines_query = lines_query.order_by("journal_entry__entry_date", "id")

        entries = []
        running_balance = Decimal("0.00")

        for line in lines_query:
            normal_balance = line.account.normal_balance
            net = line.debit_amount - line.credit_amount
            if normal_balance == "CREDIT":
                net = -net
            running_balance += net

            entries.append(
                {
                    "id": line.id,
                    "entry_date": line.journal_entry.entry_date,
                    "entry_number": line.journal_entry.entry_number,
                    "description": line.line_description or line.journal_entry.description,
                    "reference": line.journal_entry.reference,
                    "debit": line.debit_amount,
                    "credit": line.credit_amount,
                    "balance": running_balance,
                }
            )

        return Response(
            {
                "account": account,
                "period": {"from": date_from, "to": date_to},
                "entries": entries,
                "opening_balance": running_balance - sum(
                    e["debit"] - e["credit"] for e in entries
                ) if entries else Decimal("0.00"),
                "closing_balance": running_balance,
            }
        )
