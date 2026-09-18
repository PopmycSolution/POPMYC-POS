from django.contrib import admin
from .models import (
    PhoneBrand,
    PhoneModel,
    PhoneVariant,
    PhoneIMEI,
    PhoneWarranty,
    PhoneHistory,
)


@admin.register(PhoneBrand)
class PhoneBrandAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "country", "business", "is_active")
    list_filter = ("business", "is_active")
    search_fields = ("name", "code", "country")
    ordering = ("name",)
    readonly_fields = ("created_at", "updated_at")


class PhoneVariantInline(admin.TabularInline):
    model = PhoneVariant
    extra = 1
    readonly_fields = ("created_at", "updated_at")


@admin.register(PhoneModel)
class PhoneModelAdmin(admin.ModelAdmin):
    list_display = (
        "brand",
        "model_name",
        "model_code",
        "release_year",
        "ram_gb",
        "storage_gb",
        "sim_type",
        "business",
        "is_active",
    )
    list_filter = (
        "business",
        "brand",
        "sim_type",
        "has_5g",
        "is_active",
    )
    search_fields = ("model_name", "model_code", "operating_system", "processor")
    ordering = ("brand__name", "model_name")
    readonly_fields = ("created_at", "updated_at")
    inlines = [PhoneVariantInline]


@admin.register(PhoneVariant)
class PhoneVariantAdmin(admin.ModelAdmin):
    list_display = (
        "phone_model",
        "color",
        "storage_gb",
        "ram_gb",
        "sku_suffix",
        "business",
        "is_active",
    )
    list_filter = ("business", "phone_model", "color", "is_active")
    search_fields = ("color", "sku_suffix")
    readonly_fields = ("created_at", "updated_at")


@admin.register(PhoneIMEI)
class PhoneIMEIAdmin(admin.ModelAdmin):
    list_display = (
        "phone_model",
        "imei_1",
        "serial_number",
        "grade_condition",
        "status",
        "branch",
        "warehouse",
        "business",
    )
    list_filter = (
        "business",
        "phone_model",
        "sim_lock_status",
        "grade_condition",
        "status",
        "branch",
        "warehouse",
    )
    search_fields = (
        "imei_1",
        "imei_2",
        "serial_number",
        "carrier",
        "physical_condition_notes",
    )
    ordering = ("-created_at",)
    readonly_fields = ("created_at", "updated_at", "last_status_change")


@admin.register(PhoneWarranty)
class PhoneWarrantyAdmin(admin.ModelAdmin):
    list_display = (
        "warranty_number",
        "imei",
        "customer",
        "start_date",
        "end_date",
        "warranty_type",
        "status",
        "claim_count",
        "business",
    )
    list_filter = (
        "business",
        "warranty_type",
        "status",
        "start_date",
        "end_date",
    )
    search_fields = ("warranty_number", "terms", "notes")
    ordering = ("-created_at",)
    readonly_fields = ("created_at", "updated_at")


@admin.register(PhoneHistory)
class PhoneHistoryAdmin(admin.ModelAdmin):
    list_display = (
        "imei",
        "event_type",
        "status_from",
        "status_to",
        "done_by",
        "event_date",
        "business",
    )
    list_filter = (
        "business",
        "event_type",
        "status_from",
        "status_to",
        "done_by",
    )
    search_fields = ("notes", "reference_type")
    ordering = ("-event_date",)
    readonly_fields = ("created_at",)
