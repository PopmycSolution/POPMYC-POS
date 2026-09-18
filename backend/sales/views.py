from rest_framework import viewsets
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter

from common.mixins import BusinessScopedMixin
from sales.models import (
    PaymentMethod, Sale, SaleItem, SaleTax, SaleDiscount, SalePayment,
    SaleReturn, SaleReturnItem, SaleReturnRefund, HeldSale, Receipt,
    Exchange, Promotion, Coupon, CouponRedemption,
    CustomerLoyaltyReward, LoyaltyRedemption,
)
from sales.serializers import (
    PaymentMethodSerializer, SaleSerializer, SaleItemSerializer,
    SaleTaxSerializer, SaleDiscountSerializer, SalePaymentSerializer,
    SaleReturnSerializer, SaleReturnItemSerializer, SaleReturnRefundSerializer,
    HeldSaleSerializer, ReceiptSerializer, ExchangeSerializer,
    PromotionSerializer, CouponSerializer, CouponRedemptionSerializer,
    CustomerLoyaltyRewardSerializer, LoyaltyRedemptionSerializer,
)


class PaymentMethodViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = PaymentMethod.objects.all()
    serializer_class = PaymentMethodSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "code", "type", "is_active"]
    search_fields = ["name", "code"]
    ordering_fields = ["sort_order", "name", "created_at"]


class SaleViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = Sale.objects.all()
    serializer_class = SaleSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = [
        "business", "branch", "warehouse", "register", "shift",
        "cashier", "customer", "sale_type", "dining_option",
        "status", "payment_status", "refund_status", "sync_status", "currency",
    ]
    search_fields = ["invoice_number", "reference", "notes"]
    ordering_fields = [
        "invoice_number", "total_qty", "subtotal_excl",
        "grand_total", "total_paid", "created_at", "completed_at",
    ]

    def get_queryset(self):
        queryset = super().get_queryset()
        date_from = self.request.query_params.get("date_from")
        date_to   = self.request.query_params.get("date_to")
        if date_from:
            queryset = queryset.filter(created_at__date__gte=date_from)
        if date_to:
            queryset = queryset.filter(created_at__date__lte=date_to)
        return queryset

    def create(self, request, *args, **kwargs):
        """
        Block new sale creation when the business is in INVENTORY_ONLY mode.
        Historical sales remain readable; only new ones are prevented.
        """
        from businesses.models import BusinessSettings
        from rest_framework.response import Response
        from rest_framework import status as drf_status

        user = request.user
        if user and getattr(user, "business_id", None):
            try:
                settings = BusinessSettings.objects.get(business_id=user.business_id)
                if settings.is_inventory_only:
                    return Response(
                        {
                            "detail": (
                                "This business is configured for Inventory Only mode. "
                                "New sales cannot be created. "
                                "Switch to Full POS or POS Only in Business Settings to enable checkout."
                            ),
                            "code": "OPERATING_MODE_RESTRICTION",
                            "operating_mode": settings.effective_operating_mode,
                        },
                        status=drf_status.HTTP_403_FORBIDDEN,
                    )
            except BusinessSettings.DoesNotExist:
                pass  # no settings row → allow (safe default is FULL_POS)

        return super().create(request, *args, **kwargs)


class SaleItemViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = SaleItem.objects.all()
    serializer_class = SaleItemSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["sale", "business", "product", "variant", "batch", "is_taxable"]
    search_fields = ["name_snapshot", "sku_snapshot"]
    ordering_fields = ["line_number", "qty", "unit_price_incl", "total_line", "created_at"]


class SaleTaxViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = SaleTax.objects.all()
    serializer_class = SaleTaxSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["sale", "business", "sale_item", "tax_rate"]
    search_fields = ["tax_code", "tax_name"]
    ordering_fields = ["tax_rate_pct", "tax_amount", "created_at"]


class SaleDiscountViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = SaleDiscount.objects.all()
    serializer_class = SaleDiscountSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["sale", "business", "sale_item", "discount_type", "discount_scope"]
    search_fields = ["code", "name"]
    ordering_fields = ["percentage", "amount", "created_at"]


class SalePaymentViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = SalePayment.objects.all()
    serializer_class = SalePaymentSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["sale", "business", "payment_method", "method_code", "status", "currency"]
    search_fields = ["transaction_reference", "gateway_reference"]
    ordering_fields = ["amount", "tendered_amount", "paid_at", "created_at"]


class SaleReturnViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = SaleReturn.objects.all()
    serializer_class = SaleReturnSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = [
        "business", "original_sale", "branch", "cashier",
        "customer", "status", "return_type",
    ]
    search_fields = ["return_invoice_number", "reference", "notes"]
    ordering_fields = [
        "return_invoice_number", "total_items_returned",
        "total_refund_amount", "created_at", "completed_at",
    ]

    def get_queryset(self):
        queryset = super().get_queryset()
        date_from = self.request.query_params.get("date_from")
        date_to   = self.request.query_params.get("date_to")
        if date_from:
            queryset = queryset.filter(created_at__date__gte=date_from)
        if date_to:
            queryset = queryset.filter(created_at__date__lte=date_to)
        return queryset


class SaleReturnItemViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = SaleReturnItem.objects.all()
    serializer_class = SaleReturnItemSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["sale_return", "business", "product", "variant", "restock"]
    ordering_fields = ["qty_returned", "line_refund_amount", "created_at"]


class SaleReturnRefundViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = SaleReturnRefund.objects.all()
    serializer_class = SaleReturnRefundSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["sale_return", "business", "payment_method", "method_code", "status"]
    search_fields = ["transaction_reference"]
    ordering_fields = ["amount", "created_at"]


class HeldSaleViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = HeldSale.objects.all()
    serializer_class = HeldSaleSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "branch", "cashier", "customer", "status"]
    search_fields = ["held_reference", "customer_name_ref"]
    ordering_fields = ["item_count", "total_amount", "created_at"]


class ReceiptViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = Receipt.objects.all()
    serializer_class = ReceiptSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "sale", "receipt_type", "format_type"]
    search_fields = ["receipt_number"]
    ordering_fields = ["receipt_number", "print_count", "created_at"]


class ExchangeViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = Exchange.objects.all()
    serializer_class = ExchangeSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "customer", "status"]
    search_fields = ["exchange_number"]
    ordering_fields = ["exchange_number", "difference_amount", "created_at"]


class PromotionViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = Promotion.objects.all()
    serializer_class = PromotionSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "type", "scope", "is_active"]
    search_fields = ["name", "code", "description"]
    ordering_fields = ["sort_order", "discount_value", "created_at"]


class CouponViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = Coupon.objects.all()
    serializer_class = CouponSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "type", "is_active", "customer"]
    search_fields = ["code", "description"]
    ordering_fields = ["discount_value", "total_used", "created_at"]


class CouponRedemptionViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = CouponRedemption.objects.all()
    serializer_class = CouponRedemptionSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["coupon", "business", "customer", "sale"]
    ordering_fields = ["discount_applied", "redeemed_at"]


class CustomerLoyaltyRewardViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = CustomerLoyaltyReward.objects.all()
    serializer_class = CustomerLoyaltyRewardSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "reward_type", "is_active"]
    search_fields = ["name", "description"]
    ordering_fields = ["sort_order", "points_required", "created_at"]


class LoyaltyRedemptionViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = LoyaltyRedemption.objects.all()
    serializer_class = LoyaltyRedemptionSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "customer", "status"]
    search_fields = ["reference"]
    ordering_fields = ["points_used", "discount_applied", "created_at"]
