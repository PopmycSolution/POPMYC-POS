from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db import transaction
from django.utils import timezone
from decimal import Decimal
from datetime import timedelta

from common.mixins import BusinessScopedMixin

from .models import (
    CustomerGroup,
    LoyaltyTier,
    Customer,
    CustomerContact,
    CustomerCredit,
    CustomerCreditTransaction,
    CustomerStatement,
    LoyaltyTransaction,
    CustomerLoyaltyCard,
    SaleOnAccount,
    SaleOnAccountPayment,
)
from .serializers import (
    CustomerGroupSerializer,
    LoyaltyTierSerializer,
    CustomerSerializer,
    CustomerContactSerializer,
    CustomerCreditSerializer,
    CustomerCreditTransactionSerializer,
    CustomerStatementSerializer,
    LoyaltyTransactionSerializer,
    CustomerLoyaltyCardSerializer,
    SaleOnAccountSerializer,
    SaleOnAccountPaymentSerializer,
    CreditChargeSerializer,
    CreditPaySerializer,
    StatementRequestSerializer,
)


class CustomerGroupViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = CustomerGroup.objects.all()
    serializer_class = CustomerGroupSerializer
    permission_classes = [IsAuthenticated]


class LoyaltyTierViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = LoyaltyTier.objects.all()
    serializer_class = LoyaltyTierSerializer
    permission_classes = [IsAuthenticated]


class CustomerViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = Customer.objects.all()
    serializer_class = CustomerSerializer
    permission_classes = [IsAuthenticated]
    search_fields = ("first_name", "last_name", "company_name", "phone", "email", "customer_number")
    filterset_fields = ("business", "customer_group", "tier", "is_active")

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=["post"], url_path="credit/charge")
    def credit_charge(self, request, pk=None):
        customer = self.get_object()
        serializer = CreditChargeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with transaction.atomic():
            credit, created = CustomerCredit.objects.get_or_create(
                business=customer.business,
                customer=customer,
                defaults={
                    "available_credit": customer.credit_limit,
                    "used_credit": Decimal("0.00"),
                    "total_purchases_on_credit": Decimal("0.00"),
                    "total_paid": Decimal("0.00"),
                    "balance": Decimal("0.00"),
                },
            )

            amount = data["amount"]
            if credit.available_credit < amount:
                return Response(
                    {"detail": "Insufficient credit available"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            credit.used_credit += amount
            credit.available_credit -= amount
            credit.total_purchases_on_credit += amount
            credit.balance += amount
            credit.last_credit_date = timezone.now()
            if credit.total_purchases_on_credit > 0:
                credit.credit_utilization_pct = (credit.used_credit / customer.credit_limit * 100) if customer.credit_limit > 0 else Decimal("0.00")
            credit.save()

            customer.current_credit_balance += amount
            customer.total_credit_used += amount
            customer.save()

            txn = CustomerCreditTransaction.objects.create(
                business=customer.business,
                customer=customer,
                credit=credit,
                type="CREDIT_SALE",
                amount=amount,
                balance_after=credit.balance,
                reference=data.get("reference", ""),
                reference_type=data.get("reference_type", ""),
                reference_id=data.get("reference_id"),
                due_date=data.get("due_date"),
                notes=data.get("notes", ""),
                created_by=request.user,
            )

        return Response(
            {
                "credit": CustomerCreditSerializer(credit).data,
                "transaction": CustomerCreditTransactionSerializer(txn).data,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="credit/pay")
    def credit_pay(self, request, pk=None):
        customer = self.get_object()
        serializer = CreditPaySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with transaction.atomic():
            credit, created = CustomerCredit.objects.get_or_create(
                business=customer.business,
                customer=customer,
                defaults={
                    "available_credit": customer.credit_limit,
                    "used_credit": Decimal("0.00"),
                    "total_purchases_on_credit": Decimal("0.00"),
                    "total_paid": Decimal("0.00"),
                    "balance": Decimal("0.00"),
                },
            )

            amount = data["amount"]
            if credit.balance <= 0:
                return Response(
                    {"detail": "No balance to pay"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            actual_payment = min(amount, credit.balance)
            credit.used_credit -= actual_payment
            credit.available_credit += actual_payment
            credit.total_paid += actual_payment
            credit.balance -= actual_payment
            credit.last_payment_date = timezone.now()
            if customer.credit_limit > 0:
                credit.credit_utilization_pct = (credit.used_credit / customer.credit_limit * 100)
            credit.save()

            customer.current_credit_balance -= actual_payment
            customer.save()

            txn = CustomerCreditTransaction.objects.create(
                business=customer.business,
                customer=customer,
                credit=credit,
                type="PAYMENT",
                amount=actual_payment,
                balance_after=credit.balance,
                reference=data.get("reference", ""),
                reference_type=data.get("reference_type", ""),
                reference_id=data.get("reference_id"),
                notes=data.get("notes", ""),
                created_by=request.user,
            )

        return Response(
            {
                "credit": CustomerCreditSerializer(credit).data,
                "transaction": CustomerCreditTransactionSerializer(txn).data,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["get"], url_path="credit/statement")
    def credit_statement(self, request, pk=None):
        customer = self.get_object()
        serializer = StatementRequestSerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        period_end = data.get("period_end") or timezone.now().date()
        period_start = data.get("period_start") or (period_end - timedelta(days=30))

        transactions = CustomerCreditTransaction.objects.filter(
            customer=customer,
            transaction_date__date__gte=period_start,
            transaction_date__date__lte=period_end,
        ).order_by("transaction_date")

        opening_txn = CustomerCreditTransaction.objects.filter(
            customer=customer,
            transaction_date__date__lt=period_start,
        ).order_by("-transaction_date").first()
        opening_balance = opening_txn.balance_after if opening_txn else Decimal("0.00")

        closing_txn = transactions.order_by("-transaction_date").first()
        closing_balance = closing_txn.balance_after if closing_txn else opening_balance

        total_charges = sum(
            t.amount for t in transactions if t.type in ("CREDIT_SALE", "INTEREST", "WRITEOFF")
        )
        total_payments = sum(
            t.amount for t in transactions if t.type in ("PAYMENT", "CREDIT_NOTE", "REFUND")
        )

        statement = CustomerStatement(
            business=customer.business,
            customer=customer,
            statement_date=timezone.now().date(),
            period_start=period_start,
            period_end=period_end,
            opening_balance=opening_balance,
            closing_balance=closing_balance,
            total_charges=total_charges,
            total_payments=total_payments,
            generated_by=request.user,
        )

        return Response(
            {
                "statement": {
                    "customer": CustomerSerializer(customer).data,
                    "period_start": period_start,
                    "period_end": period_end,
                    "opening_balance": str(opening_balance),
                    "closing_balance": str(closing_balance),
                    "total_charges": str(total_charges),
                    "total_payments": str(total_payments),
                },
                "transactions": CustomerCreditTransactionSerializer(transactions, many=True).data,
            }
        )


class CustomerContactViewSet(viewsets.ModelViewSet):
    """
    Scoped via customer FK — no direct business FK on this model.
    Filtering by customer is enforced; superusers see all.
    """
    queryset = CustomerContact.objects.all()
    serializer_class = CustomerContactSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ("customer",)

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.is_superuser:
            return qs
        if user.business_id:
            return qs.filter(customer__business=user.business)
        return qs.none()


class CustomerCreditViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = CustomerCredit.objects.all()
    serializer_class = CustomerCreditSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ("business", "customer")


class CustomerCreditTransactionViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = CustomerCreditTransaction.objects.all()
    serializer_class = CustomerCreditTransactionSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ("business", "customer", "credit", "type")
    search_fields = ("reference",)


class CustomerStatementViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = CustomerStatement.objects.all()
    serializer_class = CustomerStatementSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ("business", "customer")


class LoyaltyTransactionViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = LoyaltyTransaction.objects.all()
    serializer_class = LoyaltyTransactionSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ("business", "customer", "type")


class CustomerLoyaltyCardViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = CustomerLoyaltyCard.objects.all()
    serializer_class = CustomerLoyaltyCardSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ("business", "customer", "card_status")
    search_fields = ("card_number",)


class SaleOnAccountViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = SaleOnAccount.objects.all()
    serializer_class = SaleOnAccountSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ("business", "customer", "sale", "status")
    search_fields = ("invoice_number",)

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class SaleOnAccountPaymentViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = SaleOnAccountPayment.objects.all()
    serializer_class = SaleOnAccountPaymentSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ("business", "customer", "credit_sale")
    search_fields = ("reference",)

    def perform_create(self, serializer):
        serializer.save(received_by=self.request.user)
