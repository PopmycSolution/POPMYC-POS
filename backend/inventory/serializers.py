from rest_framework import serializers
from inventory.models import (
    StockMovement,
    OpeningStock,
    OpeningStockItem,
    StockAdjustment,
    StockAdjustmentItem,
    StockTransfer,
    StockTransferItem,
    StockCount,
    StockCountItem,
    DamagedStock,
    ExpiredStock,
    StockAlert,
)


class StockMovementSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockMovement
        fields = "__all__"
        read_only_fields = ("id", "created_at")


class OpeningStockSerializer(serializers.ModelSerializer):
    class Meta:
        model = OpeningStock
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class OpeningStockItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = OpeningStockItem
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


# ── Read serializer (list / retrieve) ─────────────────────────────────────────

class StockAdjustmentItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_sku  = serializers.CharField(source="product.sku",  read_only=True)
    variant_name = serializers.CharField(source="variant.variant_name", read_only=True, default=None)

    class Meta:
        model = StockAdjustmentItem
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class StockAdjustmentSerializer(serializers.ModelSerializer):
    items        = StockAdjustmentItemSerializer(many=True, read_only=True)
    created_by_name = serializers.SerializerMethodField()
    branch_name  = serializers.CharField(source="branch.name", read_only=True)
    reason_display = serializers.CharField(source="get_reason_display", read_only=True)

    class Meta:
        model = StockAdjustment
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")

    def get_created_by_name(self, obj):
        if obj.created_by:
            return f"{obj.created_by.first_name} {obj.created_by.last_name}".strip() or obj.created_by.email
        return None


# ── Write serializer (create adjustment with nested items) ────────────────────

class StockAdjustmentItemWriteSerializer(serializers.Serializer):
    """One line item in a new adjustment."""
    product    = serializers.UUIDField()
    variant    = serializers.UUIDField(required=False, allow_null=True, default=None)
    batch      = serializers.UUIDField(required=False, allow_null=True, default=None)
    qty        = serializers.IntegerField(min_value=1)
    unit_cost  = serializers.DecimalField(max_digits=15, decimal_places=2, required=False, default=0)
    serial_number = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    notes      = serializers.CharField(required=False, allow_blank=True, default="")


class StockAdjustmentCreateSerializer(serializers.Serializer):
    """
    Full payload to create a stock adjustment and immediately post it.

    POST /api/v1/inventory/stock-adjustments/post_adjustment/
    {
        "branch":    "<uuid>",
        "warehouse": "<uuid>",
        "reason":    "DAMAGED",          // one of StockAdjustment.REASON_CHOICES
        "notes":     "Optional notes",
        "items": [
            { "product": "<uuid>", "qty": 2, "serial_number": "IMEI123", "unit_cost": 150.00 }
        ]
    }
    """
    branch    = serializers.UUIDField()
    warehouse = serializers.UUIDField()
    reason    = serializers.ChoiceField(choices=[c[0] for c in StockAdjustment.REASON_CHOICES])
    notes     = serializers.CharField(required=False, allow_blank=True, default="")
    items     = StockAdjustmentItemWriteSerializer(many=True, min_length=1)

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError("At least one item is required.")
        return value


class StockTransferItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_sku  = serializers.CharField(source="product.sku",  read_only=True)
    variant_name = serializers.CharField(source="variant.variant_name", read_only=True, default=None)
    discrepancy  = serializers.SerializerMethodField()

    class Meta:
        model = StockTransferItem
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")

    def get_discrepancy(self, obj):
        return obj.qty_sent - obj.qty_received


class StockTransferSerializer(serializers.ModelSerializer):
    items               = StockTransferItemSerializer(many=True, read_only=True)
    from_branch_name    = serializers.CharField(source="from_branch.name",    read_only=True)
    to_branch_name      = serializers.CharField(source="to_branch.name",      read_only=True)
    from_branch_code    = serializers.CharField(source="from_branch.code",    read_only=True)
    to_branch_code      = serializers.CharField(source="to_branch.code",      read_only=True)
    created_by_name     = serializers.SerializerMethodField()
    approved_by_name    = serializers.SerializerMethodField()
    released_by_name    = serializers.SerializerMethodField()
    received_by_name    = serializers.SerializerMethodField()
    status_display      = serializers.CharField(source="get_status_display",          read_only=True)
    method_display      = serializers.CharField(source="get_transfer_method_display", read_only=True)
    total_discrepancy   = serializers.SerializerMethodField()

    class Meta:
        model = StockTransfer
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")

    def _user_name(self, user):
        if not user:
            return None
        return f"{user.first_name} {user.last_name}".strip() or user.email

    def get_created_by_name(self, obj):  return self._user_name(obj.created_by)
    def get_approved_by_name(self, obj): return self._user_name(obj.approved_by)
    def get_released_by_name(self, obj): return self._user_name(obj.released_by)
    def get_received_by_name(self, obj): return self._user_name(obj.received_by)

    def get_total_discrepancy(self, obj):
        return sum(
            (item.qty_sent - item.qty_received)
            for item in obj.items.all()
        )


# ── Write serializers ─────────────────────────────────────────────────────────

class StockTransferItemWriteSerializer(serializers.Serializer):
    product       = serializers.UUIDField()
    variant       = serializers.UUIDField(required=False, allow_null=True, default=None)
    batch         = serializers.UUIDField(required=False, allow_null=True, default=None)
    qty           = serializers.IntegerField(min_value=1)
    unit_cost     = serializers.DecimalField(max_digits=15, decimal_places=2, required=False, default=0)
    serial_number = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    condition     = serializers.CharField(max_length=30,  required=False, allow_blank=True, default="")
    notes         = serializers.CharField(required=False, allow_blank=True, default="")


class StockTransferCreateSerializer(serializers.Serializer):
    """
    POST /api/v1/inventory/stock-transfers/create_transfer/

    {
        "from_branch":    "<uuid>",
        "to_branch":      "<uuid>",
        "from_warehouse": "<uuid>",
        "to_warehouse":   "<uuid>",
        "transfer_method": "DELIVERY",
        "notes": "",
        "items": [{"product": "<uuid>", "qty": 5, ...}]
    }
    """
    from_branch    = serializers.UUIDField()
    to_branch      = serializers.UUIDField()
    from_warehouse = serializers.UUIDField()
    to_warehouse   = serializers.UUIDField()
    transfer_method = serializers.ChoiceField(
        choices=[c[0] for c in StockTransfer.TRANSFER_METHOD_CHOICES],
        default="DELIVERY",
    )
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    items = StockTransferItemWriteSerializer(many=True, min_length=1)

    def validate(self, data):
        if str(data["from_branch"]) == str(data["to_branch"]):
            raise serializers.ValidationError(
                {"to_branch": "Cannot transfer stock from a branch to itself."}
            )
        return data


class StockTransferReceiveSerializer(serializers.Serializer):
    """
    POST /api/v1/inventory/stock-transfers/{id}/receive_transfer/

    items: [{transfer_item_id, qty_received}]
    notes: optional
    """
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    items = serializers.ListField(
        child=serializers.DictField(),
        min_length=1,
    )

    def validate_items(self, value):
        for entry in value:
            if "transfer_item_id" not in entry:
                raise serializers.ValidationError("Each item must have transfer_item_id.")
            if "qty_received" not in entry:
                raise serializers.ValidationError("Each item must have qty_received.")
            try:
                int(entry["qty_received"])
            except (TypeError, ValueError):
                raise serializers.ValidationError("qty_received must be an integer.")
        return value


class StockCountSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockCount
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class StockCountItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockCountItem
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class DamagedStockSerializer(serializers.ModelSerializer):
    class Meta:
        model = DamagedStock
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class ExpiredStockSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExpiredStock
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class StockAlertSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockAlert
        fields = "__all__"
        read_only_fields = ("id", "created_at")
