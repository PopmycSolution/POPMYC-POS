"""
cloud/admin.py
==============
Django admin for the cloud foundation models.

POPMYC staff can inspect and manage:
  - Cloud profiles (user PWA access, account status)
  - Cloud business profiles (cloud lifecycle state, pwa_modules)
  - Business memberships (role, pwa_access, branch access)
  - User branch access grants
  - Cloud devices (status, revocation)
  - Cloud audit log (read-only, immutable)

Security:
  - token_hash is excluded from all admin displays
  - Audit log has no add/change/delete permissions
"""

from django.contrib import admin
from django.utils.html import format_html
from django.utils.safestring import mark_safe

from .models import (
    CloudProfile,
    CloudBusinessProfile,
    BusinessMembership,
    UserBranchAccess,
    CloudDevice,
    CloudAuditLog,
)


# ── Inline: UserBranchAccess inside Membership ────────────────────────────────

class UserBranchAccessInline(admin.TabularInline):
    model         = UserBranchAccess
    extra         = 0
    fields        = ("branch", "is_active", "granted_by", "granted_at")
    readonly_fields = ("granted_at",)
    autocomplete_fields = ("branch",)
    can_delete    = True


# ── CloudProfile ──────────────────────────────────────────────────────────────

@admin.register(CloudProfile)
class CloudProfileAdmin(admin.ModelAdmin):
    list_display = (
        "user",
        "account_status_badge",
        "pwa_access_enabled",
        "email_verified",
        "phone_verified",
        "last_cloud_activity",
        "created_at",
    )
    list_filter  = ("account_status", "pwa_access_enabled", "email_verified", "phone_verified")
    search_fields = ("user__username", "user__email", "user__phone_number")
    readonly_fields = ("id", "user", "last_cloud_activity", "created_at", "updated_at")
    ordering     = ("-created_at",)

    fieldsets = (
        ("User", {"fields": ("id", "user")}),
        ("PWA Access", {"fields": ("pwa_access_enabled", "account_status")}),
        ("Verification", {"fields": ("email_verified", "phone_verified")}),
        ("Activity", {"fields": ("last_cloud_activity", "created_at", "updated_at")}),
    )

    @admin.display(description="Status")
    def account_status_badge(self, obj):
        colours = {
            "ACTIVE":    "green",
            "SUSPENDED": "orange",
            "PENDING":   "gray",
        }
        colour = colours.get(obj.account_status, "black")
        return format_html(
            '<span style="color:{};font-weight:bold">&#9679; {}</span>',
            colour,
            obj.account_status,
        )


# ── CloudBusinessProfile ──────────────────────────────────────────────────────

@admin.register(CloudBusinessProfile)
class CloudBusinessProfileAdmin(admin.ModelAdmin):
    list_display = (
        "business",
        "cloud_uid",
        "cloud_status_badge",
        "cloud_registered_at",
        "created_at",
    )
    list_filter  = ("cloud_status",)
    search_fields = ("business__name", "cloud_uid")
    readonly_fields = ("id", "cloud_uid", "cloud_registered_at", "created_at", "updated_at")
    ordering     = ("-created_at",)

    fieldsets = (
        ("Business", {"fields": ("id", "business", "cloud_uid")}),
        ("Cloud Status", {"fields": ("cloud_status", "cloud_registered_at")}),
        ("PWA Modules", {
            "fields": ("pwa_modules",),
            "description": "JSON dict of module keys → bool (e.g. {\"reports\": true})",
        }),
        ("Timestamps", {"fields": ("created_at", "updated_at")}),
    )

    @admin.display(description="Cloud Status")
    def cloud_status_badge(self, obj):
        colours = {
            "ACTIVE":    "green",
            "PENDING":   "gray",
            "SUSPENDED": "orange",
            "CLOSED":    "red",
        }
        colour = colours.get(obj.cloud_status, "black")
        return format_html(
            '<span style="color:{};font-weight:bold">&#9679; {}</span>',
            colour,
            obj.cloud_status,
        )


# ── BusinessMembership ────────────────────────────────────────────────────────

@admin.register(BusinessMembership)
class BusinessMembershipAdmin(admin.ModelAdmin):
    list_display  = (
        "user",
        "business",
        "role_label",
        "status_badge",
        "pwa_access",
        "branch_access_all",
        "joined_at",
        "last_activity",
    )
    list_filter   = ("role_label", "status", "pwa_access", "branch_access_all")
    search_fields = ("user__username", "user__email", "business__name")
    readonly_fields = (
        "id", "joined_at", "last_activity", "invited_by", "created_at", "updated_at",
    )
    ordering      = ("-joined_at",)
    inlines       = [UserBranchAccessInline]
    autocomplete_fields = ("user", "business")

    fieldsets = (
        ("Identity", {"fields": ("id", "user", "business")}),
        ("Role & Access", {
            "fields": ("role_label", "status", "pwa_access", "branch_access_all"),
        }),
        ("Invitation", {"fields": ("invited_by",)}),
        ("Activity", {"fields": ("joined_at", "last_activity", "created_at", "updated_at")}),
    )

    @admin.display(description="Status")
    def status_badge(self, obj):
        colours = {
            "ACTIVE":    "green",
            "INVITED":   "gray",
            "SUSPENDED": "orange",
            "REMOVED":   "red",
        }
        colour = colours.get(obj.status, "black")
        return format_html(
            '<span style="color:{};font-weight:bold">&#9679; {}</span>',
            colour,
            obj.status,
        )


# ── UserBranchAccess (standalone) ─────────────────────────────────────────────

@admin.register(UserBranchAccess)
class UserBranchAccessAdmin(admin.ModelAdmin):
    list_display  = ("membership", "branch", "is_active", "granted_by", "granted_at")
    list_filter   = ("is_active",)
    search_fields = ("membership__user__username", "branch__name", "branch__code")
    readonly_fields = ("id", "granted_at", "updated_at")
    ordering      = ("-granted_at",)


# ── CloudDevice ───────────────────────────────────────────────────────────────

@admin.register(CloudDevice)
class CloudDeviceAdmin(admin.ModelAdmin):
    list_display = (
        "device_uuid",
        "name",
        "business",
        "device_type",
        "status_badge",
        "app_version",
        "last_seen",
        "first_registered",
    )
    list_filter   = ("device_type", "status")
    search_fields = ("device_uuid", "name", "business__name", "app_version", "os_info")
    readonly_fields = (
        "id", "device_uuid", "first_registered",
        "revoked_by", "revoked_at", "created_at", "updated_at",
    )
    # token_hash is intentionally EXCLUDED — never displayed in admin
    exclude       = ("token_hash",)
    ordering      = ("-first_registered",)

    fieldsets = (
        ("Identity", {"fields": ("id", "device_uuid", "business", "membership")}),
        ("Details", {"fields": ("name", "device_type", "app_version", "os_info")}),
        ("Status", {"fields": ("status", "last_seen", "first_registered")}),
        ("Revocation", {
            "fields": ("revoked_by", "revoked_at"),
            "classes": ("collapse",),
        }),
        ("Timestamps", {"fields": ("created_at", "updated_at")}),
    )

    actions = ["action_revoke_devices"]

    @admin.display(description="Status")
    def status_badge(self, obj):
        colours = {
            "ACTIVE":    "green",
            "SUSPENDED": "orange",
            "REVOKED":   "red",
        }
        colour = colours.get(obj.status, "black")
        return format_html(
            '<span style="color:{};font-weight:bold">&#9679; {}</span>',
            colour,
            obj.status,
        )

    @admin.action(description="🚫 Revoke selected devices")
    def action_revoke_devices(self, request, queryset):
        count = 0
        for device in queryset.exclude(status=CloudDevice.DeviceStatus.REVOKED):
            device.revoke(revoked_by=request.user)
            count += 1
        self.message_user(request, f"Revoked {count} device(s).")


# ── CloudAuditLog ─────────────────────────────────────────────────────────────

@admin.register(CloudAuditLog)
class CloudAuditLogAdmin(admin.ModelAdmin):
    list_display = (
        "created_at",
        "business",
        "actor",
        "action",
        "target_user",
        "ip_address",
    )
    list_filter  = ("action",)
    search_fields = (
        "actor__username", "target_user__username", "business__name", "action",
    )
    readonly_fields = (
        "id", "business", "actor", "action", "target_user",
        "metadata", "ip_address", "created_at",
    )
    ordering     = ("-created_at",)
    date_hierarchy = "created_at"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
