from django.contrib import admin
from businesses.models import Business, BusinessSettings


@admin.register(Business)
class BusinessAdmin(admin.ModelAdmin):
    list_display = ("name", "business_type", "phone", "email", "currency", "is_active", "created_at")
    list_filter = ("business_type", "is_active", "currency", "created_at")
    search_fields = ("name", "address", "phone", "email", "tin")
    readonly_fields = ("id", "created_at", "updated_at")
    fieldsets = (
        (None, {"fields": ("id", "name", "business_type", "is_active")}),
        ("Contact", {"fields": ("address", "phone", "email", "tin")}),
        ("Currency", {"fields": ("currency", "currency_symbol")}),
        ("Branding", {"fields": ("logo",)}),
        ("Timestamps", {"fields": ("created_at", "updated_at")}),
    )


@admin.register(BusinessSettings)
class BusinessSettingsAdmin(admin.ModelAdmin):
    list_display = ("business", "created_at", "updated_at")
    list_filter = ("created_at", "updated_at")
    search_fields = ("business__name",)
    readonly_fields = ("id", "created_at", "updated_at")
    raw_id_fields = ("business",)
