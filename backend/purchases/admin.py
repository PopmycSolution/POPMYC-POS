"""
purchases/admin.py
==================
Django admin for the Purchases app.

NOTE: Purchase orders and goods-received notes live on the customer's local
PC — this cloud admin shows only records synced up via SyncRecord.
On most production Render deployments the tables will be empty; that is expected.
"""

from django.contrib import admin

from .models import (
    GoodsReceivedItem,
    GoodsReceivedNote,
    PurchaseOrder,
    PurchaseOrderItem,
    PurchaseReturn,
    PurchaseReturnItem,
)


# ── Inlines ───────────────────────────────────────────────────────────────────

class PurchaseOrderItemInline(admin.TabularInline):
    model       = PurchaseOrderItem
    extra       = 0
    can_delete  = False
    max_num     = 0
    readonly_fields = (
        "product", "qty_ordered", "qty_received",
        "unit_cost", "subtotal",
    )
    fields = readonly_fields

    def has_add_permission(self, request, obj=None):
        return False


class GoodsReceivedItemInline(admin.TabularInline):
    model       = GoodsReceivedItem
    extra       = 0
    can_delete  = False
    max_num     = 0
    readonly_fields = (
        "product", "qty_received", "unit_cost",
    )
    fields = readonly_fields

    def has_add_permission(self, request, obj=None):
        return False


class PurchaseReturnItemInline(admin.TabularInline):
    model       = PurchaseReturnItem
    extra       = 0
    can_delete  = False
    max_num     = 0
    readonly_fields = ("product", "qty_returned", "unit_cost")
    fields = readonly_fields

    def has_add_permission(self, request, obj=None):
        return False


# ── PurchaseOrderAdmin ────────────────────────────────────────────────────────

@admin.register(PurchaseOrder)
class PurchaseOrderAdmin(admin.ModelAdmin):
    list_display  = (
        "po_number", "business", "supplier",
        "status", "payment_status",
        "total_amount", "order_date", "created_at",
    )
    list_filter   = ("status", "payment_status", "order_date", "created_at")
    search_fields = (
        "po_number", "business__name", "supplier__name",
    )
    readonly_fields = (
        "id", "business", "branch", "supplier", "po_number",
        "status", "payment_status",
        "order_date", "received_date",
        "subtotal", "tax_amount", "total_amount",
        "notes", "created_at", "updated_at",
    )
    ordering  = ("-created_at",)
    date_hierarchy = "order_date"
    inlines   = [PurchaseOrderItemInline]

    fieldsets = (
        ("Identity", {
            "fields": ("id", "po_number", "business", "branch", "supplier"),
        }),
        ("Status", {
            "fields": ("status", "payment_status"),
        }),
        ("Dates", {
            "fields": ("order_date", "received_date"),
        }),
        ("Totals", {
            "fields": ("subtotal", "tax_amount", "total_amount"),
        }),
        ("Notes", {
            "fields": ("notes",),
        }),
        ("Timestamps", {
            "fields": ("created_at", "updated_at"),
        }),
    )

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


# ── GoodsReceivedNoteAdmin ────────────────────────────────────────────────────

@admin.register(GoodsReceivedNote)
class GoodsReceivedNoteAdmin(admin.ModelAdmin):
    list_display  = (
        "grn_number", "business", "purchase_order",
        "status", "received_date", "created_at",
    )
    list_filter   = ("status", "received_date", "created_at")
    search_fields = ("grn_number", "business__name", "purchase_order__po_number")
    readonly_fields = (
        "id", "business", "branch", "purchase_order", "grn_number",
        "status", "received_date", "received_by",
        "notes", "created_at", "updated_at",
    )
    ordering  = ("-created_at",)
    inlines   = [GoodsReceivedItemInline]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


# ── PurchaseReturnAdmin ───────────────────────────────────────────────────────

@admin.register(PurchaseReturn)
class PurchaseReturnAdmin(admin.ModelAdmin):
    list_display  = (
        "return_number", "business",
        "status", "return_date", "created_at",
    )
    list_filter   = ("status", "return_date", "created_at")
    search_fields = ("return_number", "business__name", "purchase_order__po_number")
    readonly_fields = (
        "id", "business", "branch", "purchase_order",
        "return_number", "status", "return_date",
        "reason", "notes", "created_at", "updated_at",
    )
    ordering  = ("-created_at",)
    inlines   = [PurchaseReturnItemInline]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
