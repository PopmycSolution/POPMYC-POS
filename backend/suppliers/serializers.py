from rest_framework import serializers
from suppliers.models import (
    Supplier,
    SupplierContact,
    SupplierProductPrice,
    SupplierBalance,
    SupplierTransaction,
)


class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")

    def validate(self, attrs):
        attrs = super().validate(attrs)
        request = self.context.get("request")
        if request and hasattr(request, "user"):
            user = request.user
            if not user.is_superuser:
                target_business = attrs.get("business") or getattr(self.instance, "business", None)
                if target_business and user.business_id:
                    if str(target_business.pk) != str(user.business_id):
                        raise serializers.ValidationError(
                            {"business": "You can only create or modify suppliers for your own business."}
                        )
        return attrs


class SupplierContactSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplierContact
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class SupplierProductPriceSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplierProductPrice
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class SupplierBalanceSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplierBalance
        fields = "__all__"
        read_only_fields = ("id", "updated_at")


class SupplierTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplierTransaction
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")
