from decimal import Decimal
from rest_framework import serializers
from purchases.models import (
    PurchaseOrder, PurchaseOrderItem,
    GoodsReceivedNote, GoodsReceivedItem,
    PurchaseReturn, PurchaseReturnItem,
    PurchasePayment,
)


# ── Read serializers ──────────────────────────────────────────────────────────

class PurchaseOrderItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name",    read_only=True)
    product_sku  = serializers.CharField(source="product.sku",     read_only=True)
    variant_name = serializers.CharField(source="variant.variant_name", read_only=True, default=None)
    batch_number = serializers.CharField(source="batch.batch_number",   read_only=True, default=None)

    class Meta:
        model  = PurchaseOrderItem
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class PurchaseOrderSerializer(serializers.ModelSerializer):
    items           = PurchaseOrderItemSerializer(many=True, read_only=True)
    supplier_name   = serializers.CharField(source="supplier.name",  read_only=True, default=None)
    branch_name     = serializers.CharField(source="branch.name",    read_only=True, default=None)
    created_by_name = serializers.SerializerMethodField()
    status_display  = serializers.CharField(source="get_status_display",         read_only=True)
    payment_display = serializers.CharField(source="get_payment_status_display", read_only=True)
    balance_due     = serializers.DecimalField(max_digits=15, decimal_places=2,  read_only=True)

    class Meta:
        model  = PurchaseOrder
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")

    def get_created_by_name(self, obj):
        if obj.created_by:
            return f"{obj.created_by.first_name} {obj.created_by.last_name}".strip() or obj.created_by.email
        return None


class GoodsReceivedItemSerializer(serializers.ModelSerializer):
    product_name  = serializers.CharField(source="product.name", read_only=True)
    product_sku   = serializers.CharField(source="product.sku",  read_only=True)
    # Batch tracking fields surfaced for reporting
    batch_purchase_date  = serializers.DateField(source="batch.purchase_date",  read_only=True, default=None)
    batch_received_date  = serializers.DateField(source="batch.received_date",  read_only=True, default=None)
    batch_qty_purchased  = serializers.IntegerField(source="batch.qty_purchased", read_only=True, default=None)
    batch_qty_received   = serializers.IntegerField(source="batch.qty_received",  read_only=True, default=None)
    batch_qty_remaining  = serializers.IntegerField(source="batch.qty_remaining", read_only=True, default=None)
    batch_stock_out_date = serializers.DateTimeField(source="batch.stock_out_date", read_only=True, default=None)
    batch_days_to_sell   = serializers.SerializerMethodField()
    batch_days_in_stock  = serializers.SerializerMethodField()
    batch_is_sold_out    = serializers.SerializerMethodField()

    class Meta:
        model  = GoodsReceivedItem
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "batch")

    def get_batch_days_to_sell(self, obj):
        return obj.batch.days_to_sell_out if obj.batch else None

    def get_batch_days_in_stock(self, obj):
        return obj.batch.days_in_stock if obj.batch else None

    def get_batch_is_sold_out(self, obj):
        return obj.batch.is_sold_out if obj.batch else False


class GoodsReceivedNoteSerializer(serializers.ModelSerializer):
    items            = GoodsReceivedItemSerializer(many=True, read_only=True)
    branch_name      = serializers.CharField(source="branch.name",   read_only=True, default=None)
    received_by_name = serializers.SerializerMethodField()
    status_display   = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model  = GoodsReceivedNote
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")

    def get_received_by_name(self, obj):
        if obj.received_by:
            return f"{obj.received_by.first_name} {obj.received_by.last_name}".strip() or obj.received_by.email
        return None


class PurchaseReturnItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_sku  = serializers.CharField(source="product.sku",  read_only=True)

    class Meta:
        model  = PurchaseReturnItem
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class PurchaseReturnSerializer(serializers.ModelSerializer):
    items = PurchaseReturnItemSerializer(many=True, read_only=True)

    class Meta:
        model  = PurchaseReturn
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class PurchasePaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model  = PurchasePayment
        fields = "__all__"
        read_only_fields = ("id", "created_at")


# ── Write serializers ─────────────────────────────────────────────────────────

class PurchaseOrderItemWriteSerializer(serializers.Serializer):
    product     = serializers.UUIDField()
    variant     = serializers.UUIDField(required=False, allow_null=True, default=None)
    qty_ordered = serializers.IntegerField(min_value=1)
    unit_cost   = serializers.DecimalField(max_digits=15, decimal_places=2, required=False, default=Decimal("0.00"))
    expiry_date = serializers.DateField(required=False, allow_null=True, default=None)
    notes       = serializers.CharField(required=False, allow_blank=True, default="")


class PurchaseOrderCreateSerializer(serializers.Serializer):
    """
    POST /api/v1/purchases/purchase-orders/

    {
        "supplier":       "<uuid>",
        "branch":         "<uuid>",
        "warehouse":      "<uuid>",          (optional)
        "order_date":     "2026-09-14",
        "expected_date":  "2026-09-21",      (optional)
        "reference":      "INV-12345",       (optional)
        "notes":          "...",
        "items": [
            { "product": "<uuid>", "qty_ordered": 50, "unit_cost": 38.00, "expiry_date": null }
        ]
    }
    """
    supplier      = serializers.UUIDField(required=False, allow_null=True, default=None)
    branch        = serializers.UUIDField(required=False, allow_null=True, default=None)
    warehouse     = serializers.UUIDField(required=False, allow_null=True, default=None)
    order_date    = serializers.DateField()
    expected_date = serializers.DateField(required=False, allow_null=True, default=None)
    reference     = serializers.CharField(required=False, allow_blank=True, default="")
    notes         = serializers.CharField(required=False, allow_blank=True, default="")
    items         = PurchaseOrderItemWriteSerializer(many=True, min_length=1)


class GoodsReceivedItemWriteSerializer(serializers.Serializer):
    purchase_order_item = serializers.UUIDField(required=False, allow_null=True, default=None)
    product             = serializers.UUIDField()
    variant             = serializers.UUIDField(required=False, allow_null=True, default=None)
    qty_received        = serializers.IntegerField(min_value=0)
    unit_cost           = serializers.DecimalField(max_digits=15, decimal_places=2, required=False, default=Decimal("0.00"))
    expiry_date         = serializers.DateField(required=False, allow_null=True, default=None)
    batch_number        = serializers.CharField(required=False, allow_blank=True, default="")
    notes               = serializers.CharField(required=False, allow_blank=True, default="")


class ReceiveGoodsSerializer(serializers.Serializer):
    """
    POST /api/v1/purchases/purchase-orders/{id}/receive_goods/

    {
        "received_date": "2026-09-21",
        "branch":        "<uuid>",       (optional — defaults to PO branch)
        "warehouse":     "<uuid>",       (optional — defaults to PO warehouse)
        "notes":         "...",
        "items": [
            {
                "product":             "<uuid>",
                "qty_received":        48,
                "unit_cost":           38.00,
                "expiry_date":         "2027-03-01",   (optional)
                "batch_number":        "LOT-2026-001", (optional)
                "purchase_order_item": "<uuid>"        (optional)
            }
        ]
    }
    """
    received_date = serializers.DateField()
    branch        = serializers.UUIDField(required=False, allow_null=True, default=None)
    warehouse     = serializers.UUIDField(required=False, allow_null=True, default=None)
    notes         = serializers.CharField(required=False, allow_blank=True, default="")
    items         = GoodsReceivedItemWriteSerializer(many=True, min_length=1)
