"""
businesses/admin.py
===================
Enhanced Business admin for POPMYC POS cloud backend.

Defensive: every display method wraps DB access in try/except so a missing
column or unexpected schema state never causes a 500 on the changelist.

NOTE on data architecture:
  - Products, sales, customers, transactions LIVE ON THE CUSTOMER'S LOCAL PC.
  - This cloud admin shows: Business, Branch, License, CloudProfile records
    that were synced here during the customer's Setup Wizard.
  - The inline sections show users and branches that were registered here.
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
    """Branches registered for this business."""
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
    Users registered for this business.
    NOTE: Only users whose accounts were synced to the cloud appear here.
    All POS staff accounts live on the customer's local PC.
    """
    model   = User
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
    verbose_name_plural = "Users (cloud-synced)"

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
        "cloud_status_badge",
        "currency",
        "is_active",
        "created_at",
    )
    list_filter   = ("business_category", "is_active", "currency", "created_at")
    search_fields = ("name", "address", "phone", "email", "tin")
    readonly_fields = ("id", "created_at", "updated_at", "branch_list_link", "cloud_info")
    ordering  = ("-created_at",)
    inlines   = [BusinessBranchInline, BusinessUserInline]
    actions   = ["action_fix_cloud_registration"]

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
        ("Branch Links", {
            "fields": ("branch_list_link",),
        }),
        ("Cloud Registration", {
            "fields": ("cloud_info",),
            "description": (
                "ℹ️  Products, sales, customers and transactions are stored on "
                "the customer's local PC — they are not synced to this cloud database. "
                "Only the business registration, branches and license info appear here."
            ),
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
                return format_html('<a href="{}">{}</a>', url, count)
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

    @admin.display(description="Cloud")
    def cloud_status_badge(self, obj):
        try:
            profile = obj.cloudBusinessProfile
            colours = {
                "ACTIVE":    "badge-green",
                "PENDING":   "badge-gray",
                "SUSPENDED": "badge-amber",
                "CLOSED":    "badge-red",
            }
            cls = colours.get(profile.cloud_status, "badge-gray")
            return format_html('<span class="badge {}">{}</span>', cls, profile.cloud_status)
        except Exception:
            return mark_safe('<span class="badge badge-gray">Not registered</span>')

    @admin.display(description="Branches (links)")
    def branch_list_link(self, obj):
        try:
            if not obj.pk:
                return "—"
            url = reverse("admin:branches_branch_changelist") + f"?business__id__exact={obj.pk}"
            count = Branch.objects.filter(business=obj).count()
            return format_html(
                '<a href="{}">{} branch{} →</a>',
                url, count, "es" if count != 1 else ""
            )
        except Exception:
            return "—"

    @admin.display(description="Cloud Registration Info")
    def cloud_info(self, obj):
        try:
            lines = []
            # Cloud profile
            try:
                profile = obj.cloudBusinessProfile
                lines.append(f"<strong>Cloud Status:</strong> {profile.cloud_status}")
                if profile.cloud_registered_at:
                    lines.append(f"<strong>Registered:</strong> {profile.cloud_registered_at.strftime('%Y-%m-%d %H:%M')}")
            except Exception:
                lines.append("<strong>Cloud Status:</strong> Not registered on cloud yet")

            # License
            try:
                lic = obj.license
                lines.append(f"<strong>License Type:</strong> {lic.license_type}")
                lines.append(f"<strong>License Status:</strong> {lic.status}")
                if lic.expiry_date:
                    lines.append(f"<strong>Expires:</strong> {lic.expiry_date}")
            except Exception:
                lines.append("<strong>License:</strong> None on cloud")

            # Note about local data
            lines.append(
                "<br><em>ℹ️ Products, sales, customers and inventory are stored on "
                "the customer's local PC and are not visible here.</em>"
            )

            return mark_safe("<br>".join(lines))
        except Exception:
            return "—"


    @admin.action(description="🔧 Fix cloud registration (create missing Branch, License, CloudProfile)")
    def action_fix_cloud_registration(self, request, queryset):
        from branches.models import Branch
        from cloud.models import CloudBusinessProfile
        from licensing.models import License
        from django.utils import timezone
        from datetime import date, timedelta

        fixed = 0
        for biz in queryset:
            try:
                # CloudBusinessProfile
                profile, _ = CloudBusinessProfile.objects.get_or_create(
                    business=biz,
                    defaults={
                        "cloud_status":        CloudBusinessProfile.CloudStatus.ACTIVE,
                        "cloud_registered_at": timezone.now(),
                    },
                )
                if profile.cloud_status != CloudBusinessProfile.CloudStatus.ACTIVE:
                    profile.cloud_status = CloudBusinessProfile.CloudStatus.ACTIVE
                    profile.save(update_fields=["cloud_status"])

                # Branch
                if not Branch.objects.filter(business=biz).exists():
                    Branch.objects.create(
                        business=biz,
                        name="Main Branch",
                        code="MAIN",
                        is_head_office=True,
                        is_active=True,
                    )

                # License
                if not License.objects.filter(business=biz).exists():
                    today = date.today()
                    lic = License.objects.create(
                        business=biz,
                        license_type=License.LicenseType.TRIAL,
                        status=License.Status.PENDING,
                        start_date=today,
                        expiry_date=today + timedelta(days=7),
                        notes="Manually fixed from cloud admin.",
                    )
                    lic.activate()

                fixed += 1
            except Exception as exc:
                self.message_user(request, f"Error fixing {biz.name}: {exc}", level="error")

        self.message_user(request, f"✅ Fixed cloud registration for {fixed} business(es).")


# ── BusinessSettingsAdmin ─────────────────────────────────────────────────────

@admin.register(BusinessSettings)
class BusinessSettingsAdmin(admin.ModelAdmin):
    list_display    = ("business", "inventory_mode", "allow_cashier_price_negotiation", "updated_at")
    list_filter     = ("inventory_mode", "allow_cashier_price_negotiation")
    search_fields   = ("business__name",)
    readonly_fields = ("id", "created_at", "updated_at")
    raw_id_fields   = ("business",)
