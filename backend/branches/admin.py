from django.contrib import admin
from branches.models import Branch, Warehouse, Register


@admin.register(Branch)
class BranchAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "business", "is_head_office", "is_active", "created_at")
    list_filter = ("business", "is_head_office", "is_active", "created_at")
    search_fields = ("name", "code", "address", "phone")
    readonly_fields = ("id", "created_at", "updated_at")
    raw_id_fields = ("business",)


@admin.register(Warehouse)
class WarehouseAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "business", "branch", "is_active", "created_at")
    list_filter = ("business", "branch", "is_active", "created_at")
    search_fields = ("name", "code", "address")
    readonly_fields = ("id", "created_at", "updated_at")
    raw_id_fields = ("business", "branch")


@admin.register(Register)
class RegisterAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "business", "branch", "is_active", "current_balance", "created_at")
    list_filter = ("business", "branch", "is_active", "created_at")
    search_fields = ("name", "code")
    readonly_fields = ("id", "created_at", "updated_at")
    raw_id_fields = ("business", "branch")
