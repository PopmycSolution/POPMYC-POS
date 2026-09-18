from django.contrib import admin
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


@admin.register(StockMovement)
class StockMovementAdmin(admin.ModelAdmin):
    list_display = [
        "type",
        "product",
        "variant",
        "qty_delta",
        "branch",
        "warehouse",
        "business",
        "unit_cost",
        "batch",
        "created_by",
        "created_at",
    ]
    list_filter = [
        "business",
        "type",
        "branch",
        "warehouse",
        "product",
        "variant",
        "batch",
        "created_by",
    ]
    search_fields = ["notes", "reference_type"]
    readonly_fields = ["id", "created_at"]


@admin.register(OpeningStock)
class OpeningStockAdmin(admin.ModelAdmin):
    list_display = [
        "reference_number",
        "branch",
        "warehouse",
        "business",
        "status",
        "total_items",
        "total_value",
        "posted_at",
        "created_by",
        "created_at",
    ]
    list_filter = ["business", "branch", "warehouse", "status", "created_by"]
    search_fields = ["reference_number", "notes"]
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(OpeningStockItem)
class OpeningStockItemAdmin(admin.ModelAdmin):
    list_display = [
        "opening_stock",
        "product",
        "variant",
        "batch",
        "qty",
        "unit_cost",
        "total_value",
        "created_at",
    ]
    list_filter = ["opening_stock", "product", "variant", "batch"]
    search_fields = []
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(StockAdjustment)
class StockAdjustmentAdmin(admin.ModelAdmin):
    list_display = [
        "reference_number",
        "reason",
        "branch",
        "warehouse",
        "business",
        "status",
        "total_items",
        "total_value_change",
        "posted_at",
        "created_by",
        "created_at",
    ]
    list_filter = ["business", "branch", "warehouse", "reason", "status", "created_by"]
    search_fields = ["reference_number", "notes"]
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(StockAdjustmentItem)
class StockAdjustmentItemAdmin(admin.ModelAdmin):
    list_display = [
        "adjustment",
        "product",
        "variant",
        "batch",
        "qty_expected",
        "qty_actual",
        "qty_delta",
        "unit_cost",
        "value_delta",
        "restock",
        "created_at",
    ]
    list_filter = ["adjustment", "product", "variant", "batch", "restock"]
    search_fields = []
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(StockTransfer)
class StockTransferAdmin(admin.ModelAdmin):
    list_display = [
        "reference_number",
        "from_branch",
        "to_branch",
        "from_warehouse",
        "to_warehouse",
        "business",
        "status",
        "total_items",
        "total_value",
        "sent_at",
        "received_at",
        "created_by",
        "received_by",
        "created_at",
    ]
    list_filter = [
        "business",
        "from_branch",
        "to_branch",
        "from_warehouse",
        "to_warehouse",
        "status",
        "created_by",
        "received_by",
    ]
    search_fields = ["reference_number", "notes"]
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(StockTransferItem)
class StockTransferItemAdmin(admin.ModelAdmin):
    list_display = [
        "transfer",
        "product",
        "variant",
        "batch",
        "qty_sent",
        "qty_received",
        "unit_cost",
        "total_value",
        "created_at",
    ]
    list_filter = ["transfer", "product", "variant", "batch"]
    search_fields = []
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(StockCount)
class StockCountAdmin(admin.ModelAdmin):
    list_display = [
        "reference_number",
        "branch",
        "warehouse",
        "business",
        "status",
        "total_items_counted",
        "variance_count",
        "variance_value",
        "started_at",
        "completed_at",
        "created_by",
        "counter_user",
        "created_at",
    ]
    list_filter = [
        "business",
        "branch",
        "warehouse",
        "status",
        "created_by",
        "counter_user",
    ]
    search_fields = ["reference_number", "notes"]
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(StockCountItem)
class StockCountItemAdmin(admin.ModelAdmin):
    list_display = [
        "stock_count",
        "product",
        "variant",
        "batch",
        "system_qty",
        "counted_qty",
        "variance",
        "unit_cost",
        "variance_value",
        "created_at",
    ]
    list_filter = ["stock_count", "product", "variant", "batch"]
    search_fields = []
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(DamagedStock)
class DamagedStockAdmin(admin.ModelAdmin):
    list_display = [
        "product",
        "variant",
        "qty",
        "reason",
        "status",
        "branch",
        "warehouse",
        "business",
        "unit_cost",
        "total_value",
        "batch",
        "disposal_date",
        "created_by",
        "created_at",
    ]
    list_filter = [
        "business",
        "branch",
        "warehouse",
        "product",
        "variant",
        "batch",
        "reason",
        "status",
        "created_by",
    ]
    search_fields = ["notes"]
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(ExpiredStock)
class ExpiredStockAdmin(admin.ModelAdmin):
    list_display = [
        "product",
        "variant",
        "qty",
        "expiry_date",
        "status",
        "branch",
        "warehouse",
        "business",
        "unit_cost",
        "total_value",
        "batch",
        "disposal_date",
        "created_by",
        "created_at",
    ]
    list_filter = [
        "business",
        "branch",
        "warehouse",
        "product",
        "variant",
        "batch",
        "status",
        "created_by",
    ]
    search_fields = ["notes"]
    readonly_fields = ["id", "created_at", "updated_at"]


@admin.register(StockAlert)
class StockAlertAdmin(admin.ModelAdmin):
    list_display = [
        "type",
        "product",
        "variant",
        "branch",
        "warehouse",
        "business",
        "is_acknowledged",
        "acknowledged_by",
        "acknowledged_at",
        "created_at",
    ]
    list_filter = [
        "business",
        "type",
        "branch",
        "warehouse",
        "product",
        "variant",
        "is_acknowledged",
        "acknowledged_by",
    ]
    search_fields = ["message"]
    readonly_fields = ["id", "created_at"]
