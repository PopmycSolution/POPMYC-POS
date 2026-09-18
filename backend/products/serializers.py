from rest_framework import serializers
from products.models import (
    Category,
    Brand,
    UnitOfMeasure,
    TaxRate,
    Product,
    ProductVariant,
    ProductBarcode,
    ProductImage,
    ProductPriceList,
    ProductPrice,
    ProductBundle,
    Batch,
    ProductStockLevel,
)


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class BrandSerializer(serializers.ModelSerializer):
    class Meta:
        model = Brand
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class UnitOfMeasureSerializer(serializers.ModelSerializer):
    class Meta:
        model = UnitOfMeasure
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class TaxRateSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaxRate
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class ProductSerializer(serializers.ModelSerializer):
    """
    Serializer for Product.

    Business-type enforcement:
      - If the business does NOT support negotiable pricing (i.e. not
        PHONE_ACCESSORIES / FASHION_CLOTHING / SHOES), attempting to set
        pricing_type=NEGOTIABLE is rejected with a 400.
      - pricing_type defaults to FIXED and is always safe.
    """

    class Meta:
        model = Product
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")

    def _get_business(self, validated_data):
        """Return the Business object for the product being created/updated."""
        business = validated_data.get("business") or getattr(self.instance, "business", None)
        return business

    def validate(self, attrs):
        attrs = super().validate(attrs)

        # ── Business-scope write guard ────────────────────────────────────────
        # Prevent a user from creating/updating a product that belongs to a
        # different business than their own (i.e. cross-tenant write).
        request = self.context.get("request")
        if request and hasattr(request, "user"):
            user = request.user
            if not user.is_superuser:
                target_business = attrs.get("business") or getattr(self.instance, "business", None)
                if target_business and user.business_id:
                    if str(target_business.pk) != str(user.business_id):
                        raise serializers.ValidationError(
                            {"business": "You can only create or modify products for your own business."}
                        )

        # ── Negotiable-pricing guard ──────────────────────────────────────────
        pricing_type = attrs.get("pricing_type", None)
        if pricing_type is None and self.instance:
            pricing_type = self.instance.pricing_type

        if pricing_type == Product.PricingType.NEGOTIABLE:
            business = self._get_business(attrs)
            if business and not business.supports_negotiable_pricing:
                raise serializers.ValidationError(
                    {
                        "pricing_type": (
                            f"This business type ('{business.business_category}') does not support "
                            "NEGOTIABLE pricing. Only Phone & Accessories, Fashion / Clothing, "
                            "and Shoes businesses may mark products as negotiable."
                        )
                    }
                )
        return attrs


class ProductVariantSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductVariant
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class ProductBarcodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductBarcode
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class ProductImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductImage
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class ProductPriceListSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductPriceList
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class ProductPriceSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductPrice
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class ProductBundleSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductBundle
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class BatchSerializer(serializers.ModelSerializer):
    class Meta:
        model = Batch
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class ProductStockLevelSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductStockLevel
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")
