from django.contrib import admin
from suppliers.models import (
    Supplier,
    SupplierContact,
    SupplierProductPrice,
    SupplierBalance,
    SupplierTransaction,
)


@admin.register(Supplier)
class SupplierAdmin(admin.ModelAdmin):
    list_display = [
        "name",
        "code",
        "supplier_type",
        "contact_person",
        "phone",
        "email",
        "city",
        "country",
        "credit_limit",
        "credit_days",
        "is_active",
        "business",
        "created_by",
        "created_at",
    ]
    list_filter = [
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
        "bank_name",
        "bank_account",
        "notes",
    ]
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(SupplierContact)
class SupplierContactAdmin(admin.ModelAdmin):
    list_display = [
        "supplier",
        "name",
        "position",
        "phone",
        "email",
        "is_primary",
        "created_at",
    ]
    list_filter = ["supplier", "is_primary"]
    search_fields = ["name", "position", "phone", "email"]
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(SupplierProductPrice)
class SupplierProductPriceAdmin(admin.ModelAdmin):
    list_display = [
        "supplier",
        "product",
        "variant",
        "business",
        "supplier_sku",
        "unit_price",
        "currency",
        "moq",
        "lead_time_days",
        "is_preferred",
        "valid_from",
        "valid_to",
        "created_at",
    ]
    list_filter = [
        "business",
        "supplier",
        "product",
        "variant",
        "currency",
        "is_preferred",
    ]
    search_fields = ["supplier_sku"]
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(SupplierBalance)
class SupplierBalanceAdmin(admin.ModelAdmin):
    list_display = [
        "supplier",
        "business",
        "total_purchases",
        "total_paid",
        "balance",
        "last_purchase_date",
        "last_payment_date",
        "updated_at",
    ]
    list_filter = ["business", "supplier"]
    search_fields = []
    readonly_fields = ["id", "updated_at"]


@admin.register(SupplierTransaction)
class SupplierTransactionAdmin(admin.ModelAdmin):
    list_display = [
        "type",
        "supplier",
        "business",
        "reference",
        "reference_type",
        "amount",
        "balance_after",
        "transaction_date",
        "created_by",
        "created_at",
    ]
    list_filter = [
        "business",
        "supplier",
        "type",
        "reference_type",
        "created_by",
    ]
    search_fields = ["reference", "notes", "reference_type"]
    readonly_fields = ["id", "created_at", "updated_at"]
