"""
businesses/admin.py
===================
Enhanced Business admin for POPMYC POS cloud backend.
Shows category, owner, branch count, license/trial status, and sync state.
Includes inline user/branch management for cloud staff.

Defensive: every display method wraps DB access in try/except so a missing
column or unexpected schema state never causes a 500 on the changelist.
"""

from django.contrib import admin
from django.contrib.auth import get_user_model
from django.db.models import Count
from django.urls import reverse, NoReverseMatch
from django.utils.html import format_html
from django.utils.safestring import mark_safe

from branches.models import Branch
from businesses.models import Business, BusinessSettings

User = get_user_model()


# ── Inline: Branches inside a Business ───────────────────────────────────────

class BusinessBranchInline(admin.TabularInline):
    """Show all branches for this business inline."""
    model   = Branch
    fields  = ("name", "code", "is_head_office", "is_active", "phone", "address")
    readonly_fields = ("name", "code", "is_head_office", "is_active", "phone", "address")
    extra   = 0
    can_delete = False
    show_change_link = True
    max_num = 20
    verbose_name        = "Branch"
    verbose_name_plural = "Branches"

    def get_queryset(self, request):
        return super().get_queryset(request).order_by("-is_head_office", "name")

    def has_add_permission(self, request, obj=None):
        return False


# ── Inline: Users inside a Business ──────────────────────────────────────────

class BusinessUserInline(admin.TabularInline):
    """
    Manage all CustomUsers linked to this business directly from the Business
    change page. Useful for cloud staff who need to add or reset users without
    navigating to a separate page.
    """
    model   = User
    # All fields read-only to avoid FK dropdown queries that can fail on Render
    fields  = (
        "username", "first_name", "last_name", "email",
        "is_active", "is_staff", "is_superuser",
    )
    readonly_fields = (
        "username", "first_name", "last_name", "email",
        "is_active", "is_staff", "is_superuser",
    )
    extra   = 0
    can_delete = False
    show_change_link = True
    max_num = 50
    verbose_name        = "User"
    verbose_name_plural = "Users"

    def get_queryset(self, request):
        return super().get_queryset(request).only(
            "id", "username", "first_name", "last_name",
            "email", "is_active", "is_staff", "is_superuser",
            "business",
        )

    def has_add_permission(self, request, obj=None):
        return False


# ── BusinessAdmin ─────────────────────────────────────────────────────────────

@admin.register(Business)
class BusinessAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "business_category_badge",
        "owner_display",
        "branch_count",
        "license_status",
        "currency",
        "is_active",
        "created_at",
    )
    list_filter   = ("business_category", "is_active", "currency", "created_at")
    search_fields = ("name", "address", "phone", "email", "tin")
    readonly_fields = ("id", "created_at", "updated_at", "branch_list_link")
    ordering  = ("-created_at",)
    inlines   = [BusinessBranchInline, BusinessUserInline]

    fieldsets = (
        ("Identity", {
            "fields": ("id", "name", "business_category", "is_active"),
        }),
        ("Contact", {
            "fields": ("address", "phone", "email", "tin"),
        }),
        ("Currency & Plan", {
            "fields": ("currency", "currency_symbol"),
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
        try:
            qs = super().get_queryset(request)
            return qs.annotate(_branch_count=Count("branch", distinct=True))
        except Exception:
            return super().get_queryset(request)

    @admin.display(description="Category", ordering="business_category")
    def business_category_badge(self, obj):
        try:
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
            cls   = colour_map.get(obj.business_category or "", "badge-gray")
            label = (
                obj.get_business_category_display()
                if hasattr(obj, "get_business_category_display")
                else (obj.business_category or "—")
            )
            return format_html('<span class="badge {}">{}</span>', cls, label)
        except Exception:
            return "—"

    @admin.display(description="Owner")
    def owner_display(self, obj):
        try:
            if obj.owner:
                return obj.owner.username
        except Exception:
            pass
        return "—"

    @admin.display(description="Branches")
    def branch_count(self, obj):
        try:
            count = getattr(obj, "_branch_count", None)
            if count is None:
                count = Branch.objects.filter(business=obj).count()
            try:
                url = reverse("admin:branches_branch_changelist") + f"?business__id__exact={obj.pk}"
                return format_html('<a href="{}">{} branch{}</a>', url, count, "es" if count != 1 else "")
            except NoReverseMatch:
                return str(count)
        except Exception:
            return "—"

    @admin.display(description="License")
    def license_status(self, obj):
        try:
            lic = obj.license
            if lic.is_trial and lic.status == "ACTIVE":
                dr    = lic.days_remaining
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
        try:
            if not obj.pk:
                return "—"
            url = reverse("admin:branches_branch_changelist") + f"?business__id__exact={obj.pk}"
            return format_html('<a href="{}">View branches for {}</a>', url, obj.name)
        except Exception:
            return "—"


# ── BusinessSettingsAdmin ─────────────────────────────────────────────────────

@admin.register(BusinessSettings)
class BusinessSettingsAdmin(admin.ModelAdmin):
    list_display    = ("business", "inventory_mode", "allow_cashier_price_negotiation", "updated_at")
    list_filter     = ("inventory_mode", "allow_cashier_price_negotiation")
    search_fields   = ("business__name",)
    readonly_fields = ("id", "created_at", "updated_at")
    raw_id_fields   = ("business",)
