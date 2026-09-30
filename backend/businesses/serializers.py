from rest_framework import serializers
from businesses.models import Business, BusinessSettings


class BusinessSerializer(serializers.ModelSerializer):
    # Computed read-only flag so the frontend knows immediately whether to show
    # the Negotiable pricing option in the product form.
    supports_negotiable_pricing = serializers.BooleanField(read_only=True)

    class Meta:
        model = Business
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class BusinessSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = BusinessSettings
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class TaxConfigWriteSerializer(serializers.ModelSerializer):
    tax_config = serializers.JSONField(required=True)

    class Meta:
        model = BusinessSettings
        fields = ("id", "tax_config")
        read_only_fields = ("id",)


class PricingConfigWriteSerializer(serializers.ModelSerializer):
    """Update only pricing-related settings (Admin/SuperAdmin only)."""
    class Meta:
        model = BusinessSettings
        fields = ("id", "allow_cashier_price_negotiation")
        read_only_fields = ("id",)


class InventoryModeWriteSerializer(serializers.ModelSerializer):
    """Update only inventory_mode / operating mode (Admin/SuperAdmin only)."""
    class Meta:
        model = BusinessSettings
        fields = ("id", "inventory_mode")
        read_only_fields = ("id",)


class BranchModeWriteSerializer(serializers.ModelSerializer):
    """Update only branch_mode (Admin/SuperAdmin only)."""
    class Meta:
        model = BusinessSettings
        fields = ("id", "branch_mode")
        read_only_fields = ("id",)


class BusinessSettingsPublicSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer returned to all authenticated users so the frontend
    knows the current operating mode without exposing internal config blobs.
    Includes the fields the UI needs to gate stock-related and POS controls.
    """
    stock_enabled        = serializers.SerializerMethodField()
    pos_enabled          = serializers.SerializerMethodField()
    inventory_enabled    = serializers.SerializerMethodField()
    effective_operating_mode = serializers.SerializerMethodField()

    class Meta:
        model = BusinessSettings
        fields = (
            "id",
            "inventory_mode",
            "effective_operating_mode",
            "allow_cashier_price_negotiation",
            "branch_mode",
            "stock_enabled",
            "pos_enabled",
            "inventory_enabled",
        )
        read_only_fields = fields

    def get_stock_enabled(self, obj) -> bool:
        return obj.inventory_enabled

    def get_pos_enabled(self, obj) -> bool:
        return obj.pos_enabled

    def get_inventory_enabled(self, obj) -> bool:
        return obj.inventory_enabled

    def get_effective_operating_mode(self, obj) -> str:
        return obj.effective_operating_mode
