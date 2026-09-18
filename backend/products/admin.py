from django.contrib import admin
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


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ["name", "code", "business", "parent", "is_active", "sort_order", "created_at"]
    list_filter = ["business", "is_active", "parent"]
    search_fields = ["name", "code", "description"]
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(Brand)
class BrandAdmin(admin.ModelAdmin):
    list_display = ["name", "code", "business", "website", "is_active", "created_at"]
    list_filter = ["business", "is_active"]
    search_fields = ["name", "code", "description", "website"]
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(UnitOfMeasure)
class UnitOfMeasureAdmin(admin.ModelAdmin):
    list_display = [
        "name",
        "code",
        "symbol",
        "business",
        "base_unit",
        "conversion_factor",
        "allow_fractional",
        "created_at",
    ]
    list_filter = ["business", "allow_fractional", "base_unit"]
    search_fields = ["name", "code", "symbol"]
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(TaxRate)
class TaxRateAdmin(admin.ModelAdmin):
    list_display = [
        "name",
        "code",
        "business",
        "rate_percent",
        "type",
        "applies_to",
        "is_compound",
        "is_active",
        "created_at",
    ]
    list_filter = ["business", "type", "applies_to", "is_compound", "is_active"]
    search_fields = ["name", "code"]
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = [
        "name",
        "sku",
        "business",
        "category",
        "brand",
        "type",
        "selling_price",
        "cost_price",
        "is_active",
        "created_at",
    ]
    list_filter = [
        "business",
        "category",
        "brand",
        "type",
        "is_active",
        "is_track_stock",
        "is_tax_exempt",
    ]
    search_fields = ["name", "sku", "description", "barcode_main", "notes"]
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(ProductVariant)
class ProductVariantAdmin(admin.ModelAdmin):
    list_display = [
        "variant_name",
        "sku",
        "product",
        "business",
        "selling_price",
        "cost_price",
        "is_default",
        "is_active",
        "created_at",
    ]
    list_filter = ["business", "product", "is_default", "is_active"]
    search_fields = ["variant_name", "sku"]
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(ProductBarcode)
class ProductBarcodeAdmin(admin.ModelAdmin):
    list_display = ["barcode", "type", "product", "variant", "business", "is_primary", "created_at"]
    list_filter = ["business", "type", "is_primary", "product", "variant"]
    search_fields = ["barcode"]
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(ProductImage)
class ProductImageAdmin(admin.ModelAdmin):
    list_display = ["product", "variant", "business", "alt_text", "sort_order", "is_primary", "created_at"]
    list_filter = ["business", "product", "variant", "is_primary"]
    search_fields = ["alt_text"]
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(ProductPriceList)
class ProductPriceListAdmin(admin.ModelAdmin):
    list_display = [
        "name",
        "code",
        "business",
        "is_active",
        "valid_from",
        "valid_to",
        "created_at",
    ]
    list_filter = ["business", "is_active"]
    search_fields = ["name", "code", "description"]
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(ProductPrice)
class ProductPriceAdmin(admin.ModelAdmin):
    list_display = [
        "price_list",
        "product",
        "variant",
        "business",
        "price",
        "min_qty",
        "max_qty",
        "created_at",
    ]
    list_filter = ["business", "price_list", "product", "variant"]
    search_fields = []
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(ProductBundle)
class ProductBundleAdmin(admin.ModelAdmin):
    list_display = [
        "bundle_product",
        "component_product",
        "variant",
        "business",
        "qty",
        "cost",
        "created_at",
    ]
    list_filter = ["business", "bundle_product", "component_product", "variant"]
    search_fields = []
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(Batch)
class BatchAdmin(admin.ModelAdmin):
    list_display = [
        "batch_number",
        "product",
        "variant",
        "business",
        "supplier",
        "manufacture_date",
        "expiry_date",
        "purchase_price",
        "created_at",
    ]
    list_filter = ["business", "product", "variant", "supplier"]
    search_fields = ["batch_number", "notes"]
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(ProductStockLevel)
class ProductStockLevelAdmin(admin.ModelAdmin):
    list_display = [
        "product",
        "variant",
        "branch",
        "warehouse",
        "business",
        "qty_on_hand",
        "qty_reserved",
        "qty_available",
        "reorder_level",
        "last_received_date",
        "created_at",
    ]
    list_filter = ["business", "product", "variant", "branch", "warehouse"]
    search_fields = []
    readonly_fields = ["id", "created_at", "updated_at"]
