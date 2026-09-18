from django.db.models import Sum, Count
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters

from common.mixins import BusinessScopedMixin

from .models import (
    ExpenseCategory,
    Expense,
    RecurringExpense,
    ExpenseApproval,
)
from .serializers import (
    ExpenseCategorySerializer,
    ExpenseSerializer,
    RecurringExpenseSerializer,
    ExpenseApprovalSerializer,
)


_EXPENSE_ADMIN_ROLES = {"SUPER_ADMIN", "ADMIN", "MANAGER"}


def _can_manage_expenses(user) -> bool:
    """Only SUPER_ADMIN, ADMIN, and MANAGER may approve/reject/mark-paid expenses."""
    if user.is_superuser or user.is_staff:
        return True
    return str(getattr(user, "role", "") or "").upper() in _EXPENSE_ADMIN_ROLES


class ExpenseCategoryViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = ExpenseCategory.objects.all()
    serializer_class = ExpenseCategorySerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["business", "type", "is_active", "parent"]
    search_fields = ["name", "code", "description"]
    ordering_fields = ["name", "code", "sort_order", "created_at"]


class ExpenseViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = Expense.objects.all()
    serializer_class = ExpenseSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = [
        "business",
        "category",
        "branch",
        "warehouse",
        "payment_method",
        "status",
        "supplier",
        "customer",
        "is_tax_deductible",
    ]
    search_fields = ["reference_number", "description", "receipt_number", "notes"]
    ordering_fields = ["expense_date", "amount", "total_amount", "created_at"]

    @action(detail=False, methods=["get"])
    def summary(self, request):
        date_from = request.query_params.get("from")
        date_to = request.query_params.get("to")
        branch = request.query_params.get("branch")

        # get_queryset() already applies business scoping
        queryset = self.get_queryset()

        if date_from:
            queryset = queryset.filter(expense_date__gte=date_from)
        if date_to:
            queryset = queryset.filter(expense_date__lte=date_to)
        if branch:
            queryset = queryset.filter(branch_id=branch)

        summary = queryset.aggregate(
            total_amount=Sum("total_amount"),
            total_tax=Sum("tax_amount"),
            total_base=Sum("amount"),
            count=Count("id"),
        )

        by_category = (
            queryset.values("category__id", "category__name")
            .annotate(
                total=Sum("total_amount"),
                count=Count("id"),
            )
            .order_by("-total")
        )

        by_payment_method = (
            queryset.values("payment_method")
            .annotate(
                total=Sum("total_amount"),
                count=Count("id"),
            )
            .order_by("-total")
        )

        by_branch = (
            queryset.values("branch__id", "branch__name")
            .annotate(
                total=Sum("total_amount"),
                count=Count("id"),
            )
            .order_by("-total")
        )

        return Response(
            {
                "summary": summary,
                "by_category": by_category,
                "by_payment_method": by_payment_method,
                "by_branch": by_branch,
            }
        )

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        if not _can_manage_expenses(request.user):
            return Response(
                {"detail": "Only Managers and Admins can approve expenses."},
                status=status.HTTP_403_FORBIDDEN,
            )
        expense = self.get_object()
        expense.status = "APPROVED"
        expense.approved_by = request.user
        expense.approved_at = timezone.now()
        expense.save()
        return Response(ExpenseSerializer(expense).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        if not _can_manage_expenses(request.user):
            return Response(
                {"detail": "Only Managers and Admins can reject expenses."},
                status=status.HTTP_403_FORBIDDEN,
            )
        expense = self.get_object()
        expense.status = "REJECTED"
        expense.approved_by = request.user
        expense.approved_at = timezone.now()
        expense.save()
        return Response(ExpenseSerializer(expense).data)

    @action(detail=True, methods=["post"])
    def mark_paid(self, request, pk=None):
        if not _can_manage_expenses(request.user):
            return Response(
                {"detail": "Only Managers and Admins can mark expenses as paid."},
                status=status.HTTP_403_FORBIDDEN,
            )
        expense = self.get_object()
        expense.status = "PAID"
        expense.paid_by = request.user
        expense.paid_at = timezone.now()
        expense.save()
        return Response(ExpenseSerializer(expense).data)


class RecurringExpenseViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = RecurringExpense.objects.all()
    serializer_class = RecurringExpenseSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["business", "category", "branch", "frequency", "is_active", "payment_method"]
    search_fields = ["description"]
    ordering_fields = ["next_run_date", "total_amount", "created_at"]


class ExpenseApprovalViewSet(viewsets.ModelViewSet):
    """
    ExpenseApproval has no direct business FK — scoped via expense__business.
    """
    queryset = ExpenseApproval.objects.all()
    serializer_class = ExpenseApprovalSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["expense", "approver", "status", "approval_level"]
    search_fields = ["comment"]
    ordering_fields = ["approval_level", "decided_at", "created_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.is_superuser:
            return qs
        if user.business_id:
            return qs.filter(expense__business=user.business)
        return qs.none()

    def perform_update(self, serializer):
        instance = serializer.save()
        if instance.status in ["APPROVED", "REJECTED"] and not instance.decided_at:
            instance.decided_at = timezone.now()
            instance.save()
