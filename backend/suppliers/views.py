from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter

from common.mixins import BusinessScopedMixin

from suppliers.models import (
    Supplier,
    SupplierContact,
    SupplierProductPrice,
    SupplierBalance,
    SupplierTransaction,
)
from suppliers.serializers import (
    SupplierSerializer,
    SupplierContactSerializer,
    SupplierProductPriceSerializer,
    SupplierBalanceSerializer,
    SupplierTransactionSerializer,
)


class SupplierViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = [
        "business",
        "supplier_type",
        "is_active",
        "city",
        "country",
        "created_by",
    ]
    search_fields = [
        "name",
        "code",
        "contact_person",
        "phone",
        "email",
        "address",
        "city",
        "tin",
        "tax_number",
        "notes",
    ]
    ordering_fields = [
        "name",
        "code",
        "credit_limit",
        "credit_days",
        "created_at",
    ]


class SupplierContactViewSet(viewsets.ModelViewSet):
    """
    No direct business FK — scoped via supplier__business.
    """
    queryset = SupplierContact.objects.all()
    serializer_class = SupplierContactSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["supplier", "is_primary"]
    search_fields = ["name", "position", "phone", "email"]
    ordering_fields = ["name", "is_primary", "created_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.is_superuser:
            return qs
        if user.business_id:
            return qs.filter(supplier__business=user.business)
        return qs.none()


class SupplierProductPriceViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = SupplierProductPrice.objects.all()
    serializer_class = SupplierProductPriceSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = [
        "business",
        "supplier",
        "product",
        "variant",
        "currency",
        "is_preferred",
    ]
    search_fields = ["supplier_sku"]
    ordering_fields = [
        "unit_price",
        "moq",
        "lead_time_days",
        "valid_from",
        "valid_to",
        "is_preferred",
        "created_at",
    ]


class SupplierBalanceViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = SupplierBalance.objects.all()
    serializer_class = SupplierBalanceSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "supplier"]
    search_fields = []
    ordering_fields = [
        "total_purchases",
        "total_paid",
        "balance",
        "last_purchase_date",
        "last_payment_date",
        "updated_at",
    ]


class SupplierTransactionViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = SupplierTransaction.objects.all()
    serializer_class = SupplierTransactionSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = [
        "business",
        "supplier",
        "type",
        "reference_type",
        "created_by",
    ]
    search_fields = ["reference", "notes", "reference_type"]
    ordering_fields = [
        "amount",
        "balance_after",
        "transaction_date",
        "created_at",
    ]

    def get_queryset(self):
        qs = super().get_queryset()  # BusinessScopedMixin applies first
        date_from = self.request.query_params.get("date_from")
        date_to = self.request.query_params.get("date_to")
        if date_from:
            qs = qs.filter(transaction_date__gte=date_from)
        if date_to:
            qs = qs.filter(transaction_date__lte=date_to)
        return qs
