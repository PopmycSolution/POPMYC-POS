"""
sales/admin.py
==============
Django admin for the Sales app.

NOTE: Products, sales and customer transactions live on the customer's local
PC database — this cloud admin shows only records that have been synced up
via the SyncRecord mechanism.  On most production Render deployments the
tables will be empty — that is expected behaviour.
"""

from django.contrib import admin
from django.utils.html import format_html

from .models import (
    Sale,
    SaleItem,
    SalePayment,
    SaleReturn,
    SaleReturnItem,
)


# ── SaleItem inline ───────────────────────────────────────────────────────────

class SaleItemInline(admin.TabularInline):
    model            = SaleItem
    extra            = 0
    can_delete       = False
    max_num          = 0
    show_change_link = False
    readonly_fields  = (
        "product", "name_snapshot", "sku_snapshot",
        "qty", "unit_price_incl", "total_line", "negotiated_unit_price",
    )
    fields = readonly_fields

    def has_add_permission(self, request, obj=None):
        return False


# ── SalePayment inline ────────────────────────────────────────────────────────

class SalePaymentInline(admin.TabularInline):
    model            = SalePayment
    extra            = 0
    can_delete       = False
    max_num          = 0
    show_change_link = False
    readonly_fields  = (
        "payment_method", "method_code", "amount",
        "tendered_amount", "change", "status",
        "transaction_reference", "created_at",
    )
    fields = readonly_fields

    def has_add_permission(self, request, obj=None):
        return False


# ── SaleAdmin ─────────────────────────────────────────────────────────────────

@admin.register(Sale)
class SaleAdmin(admin.ModelAdmin):
    list_display = (
        "invoice_number",
        "business",
        "customer",
        "grand_total_display",
        "status",
        "payment_status",
        "sync_status",
        "created_at",
    )
    list_filter   = ("status", "payment_status", "sync_status", "created_at")
    search_fields = (
        "invoice_number", "business__name",
        "customer__first_name", "customer__last_name",
    )
    readonly_fields = (
        "id", "invoice_number", "business", "branch", "customer",
        "cashier", "status", "payment_status", "refund_status",
        "grand_total", "subtotal_excl", "total_incl", "total_paid",
        "change_due", "total_qty", "sync_status", "synced_at",
        "offline_uuid", "idempotency_key",
        "created_at", "updated_at", "completed_at",
    )
    ordering      = ("-created_at",)
    date_hierarchy = "created_at"
    inlines       = [SaleItemInline, SalePaymentInline]

    fieldsets = (
        ("Identity", {
            "fields": ("id", "invoice_number", "business", "branch"),
        }),
        ("Parties", {
            "fields": ("cashier", "customer"),
        }),
        ("Status", {
            "fields": ("status", "payment_status", "refund_status", "sync_status"),
        }),
        ("Totals", {
            "fields": (
                "grand_total", "subtotal_excl", "total_incl",
                "total_paid", "change_due", "total_qty",
            ),
        }),
        ("Sync & Offline", {
            "fields": ("offline_uuid", "idempotency_key", "synced_at"),
            "classes": ("collapse",),
        }),
        ("Timestamps", {
            "fields": ("created_at", "updated_at", "completed_at"),
        }),
    )

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    @admin.display(description="Total", ordering="grand_total")
    def grand_total_display(self, obj):
        try:
            sym = obj.business.currency_symbol if obj.business_id else ""
            return f"{sym}{obj.grand_total:,.2f}"
        except Exception:
            return "—"


# ── SaleItemAdmin ─────────────────────────────────────────────────────────────

@admin.register(SaleItem)
class SaleItemAdmin(admin.ModelAdmin):
    list_display  = (
        "sale", "name_snapshot", "sku_snapshot",
        "qty", "unit_price_incl", "total_line", "created_at",
    )
    list_filter   = ("created_at",)
    search_fields = ("sale__invoice_number", "name_snapshot", "sku_snapshot")
    readonly_fields = (
        "id", "sale", "business", "product",
        "name_snapshot", "sku_snapshot",
        "qty", "unit_price_incl", "negotiated_unit_price",
        "total_line", "created_at",
    )
    ordering = ("-created_at",)

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


# ── SalePaymentAdmin ──────────────────────────────────────────────────────────

@admin.register(SalePayment)
class SalePaymentAdmin(admin.ModelAdmin):
    list_display  = (
        "sale", "method_code", "amount", "status", "created_at",
    )
    list_filter   = ("status", "method_code", "created_at")
    search_fields = ("sale__invoice_number", "transaction_reference", "method_code")
    readonly_fields = (
        "id", "sale", "business", "payment_method", "method_code",
        "amount", "tendered_amount", "change", "status",
        "transaction_reference", "gateway_reference",
        "created_at", "updated_at",
    )
    ordering = ("-created_at",)

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


# ── SaleReturnItemInline ──────────────────────────────────────────────────────

class SaleReturnItemInline(admin.TabularInline):
    model       = SaleReturnItem
    extra       = 0
    can_delete  = False
    max_num     = 0
    readonly_fields = (
        "product", "qty_returned",
        "original_unit_price", "refund_unit_price",
        "line_refund_amount", "notes",
    )
    fields = readonly_fields

    def has_add_permission(self, request, obj=None):
        return False


# ── SaleReturnAdmin ───────────────────────────────────────────────────────────

@admin.register(SaleReturn)
class SaleReturnAdmin(admin.ModelAdmin):
    list_display  = (
        "return_invoice_number", "business", "customer",
        "status", "return_type", "created_at",
    )
    list_filter   = ("status", "return_type", "created_at")
    search_fields = (
        "return_invoice_number", "business__name",
        "customer__first_name", "customer__last_name",
    )
    readonly_fields = (
        "id", "business", "branch", "original_sale",
        "customer", "return_invoice_number", "reference",
        "status", "return_type", "total_items_returned",
        "return_reason_summary", "notes",
        "created_at", "completed_at",
    )
    ordering  = ("-created_at",)
    inlines   = [SaleReturnItemInline]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
