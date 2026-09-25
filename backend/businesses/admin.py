"""
businesses/admin.py
===================
Enhanced Business admin for POPMYC POS cloud backend.
Shows category, owner, branch count, license/trial status, and sync state.
"""

from django.contrib import admin
from django.db.models import Count
from django.urls import reverse
from django.utils.html import format_html
from django.utils.safestring import mark_safe

from businesses.models import Business, BusinessSettings


@admin.register(Business)
class BusinessAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "business_category_badge",
        "owner",
        "branch_count",
        "license_status",
        "subscription_tier",
        "currency",
        "is_active",
        "created_at",
    )
    list_filter  = ("business_category", "is_active", "currency", "subscription_tier", "created_at")
    search_fields = ("name", "address", "phone", "email", "tin")
    readonly_fields = ("id", "created_at", "updated_at", "branch_list_link")
    ordering = ("-created_at",)

    fieldsets = (
        ("Identity", {
            "fields": ("id", "name", "business_category", "business_type", "is_active"),
        }),
        ("Contact", {
            "fields": ("address", "phone", "email", "tin"),
        }),
        ("Currency & Plan", {
            "fields": ("currency", "currency_symbol", "subscription_tier"),
        }),
        ("Ownership", {
            "fields": ("owner",),
        }),
        ("Branding", {
            "fields": ("logo",),
        }),
        ("Branches", {
            "fields": ("branch_list_link",),
        }),
        ("Timestamps", {
            "fields": ("created_at", "updated_at"),
        }),
    )

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        return qs.annotate(_branch_count=Count("branch", distinct=True))

    @admin.display(description="Category", ordering="business_category")
    def business_category_badge(self, obj):
        colour_map = {
            "SUPERMARKET":       "badge-green",
            "PHARMACY":          "badge-blue",
            "ELECTRONICS":       "badge-blue",
            "PHONE_ACCESSORIES": "badge-purple",
            "FASHION_CLOTHING":  "badge-purple",
            "SHOES":             "badge-purple",
            "COSMETICS":         "badge-amber",
            "PROVISION_GROCERY": "badge-green",
            "GENERAL_RETAIL":    "badge-gray",
            "SERVICE":           "badge-gray",
        }
        cls   = colour_map.get(obj.business_category, "badge-gray")
        label = obj.get_business_category_display() if hasattr(obj, "get_business_category_display") else obj.business_category
        return format_html(
            '<span class="badge {}">{}</span>',
            cls, label,
        )

    @admin.display(description="Branches", ordering="_branch_count")
    def branch_count(self, obj):
        count = getattr(obj, "_branch_count", 0)
        url   = reverse("admin:branches_branch_changelist") + f"?business__id__exact={obj.pk}"
        return format_html('<a href="{}">{} branch{}</a>', url, count, "es" if count != 1 else "")

    @admin.display(description="License")
    def license_status(self, obj):
        try:
            lic = obj.license
            if lic.is_trial and lic.status == "ACTIVE":
                dr = lic.days_remaining
                label = f"Trial ({dr}d)" if dr is not None else "Trial"
                return format_html('<span class="badge badge-purple">{}</span>', label)
            colours = {
                "ACTIVE":    "badge-green",
                "EXPIRED":   "badge-red",
                "SUSPENDED": "badge-amber",
                "REVOKED":   "badge-red",
                "PENDING":   "badge-gray",
            }
            cls = colours.get(lic.status, "badge-gray")
            return format_html('<span class="badge {}">{}</span>', cls, lic.status)
        except Exception:
            return mark_safe('<span class="badge badge-gray">No license</span>')

    @admin.display(description="Branches (links)")
    def branch_list_link(self, obj):
        if not obj.pk:
            return "—"
        url = reverse("admin:branches_branch_changelist") + f"?business__id__exact={obj.pk}"
        return format_html('<a href="{}">View branches for {}</a>', url, obj.name)


@admin.register(BusinessSettings)
class BusinessSettingsAdmin(admin.ModelAdmin):
    list_display   = ("business", "inventory_mode", "allow_cashier_price_negotiation", "updated_at")
    list_filter    = ("inventory_mode", "allow_cashier_price_negotiation")
    search_fields  = ("business__name",)
    readonly_fields = ("id", "created_at", "updated_at")
    raw_id_fields  = ("business",)
