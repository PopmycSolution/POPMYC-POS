"""
synchronization/admin.py
========================
Django admin for the synchronization models.

Stage 6.2C: registered SyncRecord, SyncDevice, and the new SyncConflictLog.

POPMYC administrators can inspect:
  - SyncRecord queue state and errors
  - SyncDevice registrations (and their sync_checkpoint cursor)
  - SyncConflictLog entries for manual resolution

Security: SyncRecord payload is shown in read-only form. No tokens,
passwords, or activation codes should appear in payloads (enforced by
the _NEVER_SYNC_FIELDS list in model_applier.py).
"""

from django.contrib import admin
from django.utils.html import format_html

from .models import SyncConflictLog, SyncDevice, SyncRecord


# ── SyncRecord ────────────────────────────────────────────────────────────────

@admin.register(SyncRecord)
class SyncRecordAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "app_model",
        "record_id",
        "action",
        "status_badge",
        "version",
        "attempts",
        "business_id",
        "device_id",
        "created_at",
        "synced_at",
    )
    list_filter  = ("status", "action", "app_label")
    search_fields = ("record_id", "business_id", "device_id", "app_label", "model_name")
    readonly_fields = (
        "id", "record_id", "app_label", "model_name", "device_id",
        "business_id", "branch_id", "action", "version", "payload",
        "attempts", "last_error", "created_at", "updated_at", "synced_at",
    )
    ordering     = ("-created_at",)
    date_hierarchy = "created_at"

    fieldsets = (
        ("Identity", {"fields": ("id", "record_id", "app_label", "model_name", "action")}),
        ("Context",  {"fields": ("device_id", "business_id", "branch_id")}),
        ("State",    {"fields": ("status", "version", "attempts", "last_error")}),
        ("Payload",  {"fields": ("payload",), "classes": ("collapse",)}),
        ("Timestamps", {"fields": ("created_at", "updated_at", "synced_at")}),
    )

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    @admin.display(description="Model")
    def app_model(self, obj):
        return f"{obj.app_label}.{obj.model_name}"

    @admin.display(description="Status")
    def status_badge(self, obj):
        colours = {
            "pending":  "gray",
            "syncing":  "blue",
            "synced":   "green",
            "failed":   "red",
            "conflict": "orange",
        }
        return format_html(
            '<span style="color:{};font-weight:bold">&#9679; {}</span>',
            colours.get(obj.status, "black"),
            obj.status,
        )


# ── SyncDevice ────────────────────────────────────────────────────────────────

@admin.register(SyncDevice)
class SyncDeviceAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "device_id",
        "business_id",
        "branch_id",
        "is_active",
        "last_sync_at",
        "sync_checkpoint",
        "created_at",
    )
    list_filter  = ("is_active",)
    search_fields = ("name", "device_id", "business_id")
    readonly_fields = (
        "id", "device_id", "created_at", "updated_at",
        "last_sync_at", "sync_checkpoint",
    )
    ordering     = ("-created_at",)

    fieldsets = (
        ("Identity",    {"fields": ("id", "device_id", "name", "is_active")}),
        ("Scope",       {"fields": ("business_id", "branch_id")}),
        ("Sync cursor", {"fields": ("last_sync_at", "sync_checkpoint")}),
        ("Timestamps",  {"fields": ("created_at", "updated_at")}),
    )


# ── SyncConflictLog ───────────────────────────────────────────────────────────

@admin.register(SyncConflictLog)
class SyncConflictLogAdmin(admin.ModelAdmin):
    list_display = (
        "created_at",
        "app_model",
        "record_id",
        "client_version",
        "server_version",
        "resolution_badge",
        "business_id",
        "device_id",
    )
    list_filter  = ("resolution", "app_label")
    search_fields = ("record_id", "business_id", "device_id", "app_label", "model_name")
    readonly_fields = (
        "id", "record_id", "app_label", "model_name",
        "business_id", "branch_id", "device_id",
        "client_version", "client_payload",
        "server_version", "server_payload",
        "resolution", "sync_record_id", "created_at",
    )
    ordering     = ("-created_at",)
    date_hierarchy = "created_at"

    fieldsets = (
        ("Record",   {"fields": ("id", "record_id", "app_label", "model_name")}),
        ("Context",  {"fields": ("business_id", "branch_id", "device_id", "sync_record_id")}),
        ("Conflict", {
            "fields": ("client_version", "client_payload", "server_version", "server_payload"),
        }),
        ("Resolution", {"fields": ("resolution",)}),
        ("Timestamps", {"fields": ("created_at",)}),
    )

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        # Allow changing resolution status only
        return True

    def get_readonly_fields(self, request, obj=None):
        # Everything is read-only except resolution
        all_ro = list(self.readonly_fields)
        if obj:
            return [f for f in all_ro if f != "resolution"]
        return all_ro

    @admin.display(description="Model")
    def app_model(self, obj):
        return f"{obj.app_label}.{obj.model_name}"

    @admin.display(description="Resolution")
    def resolution_badge(self, obj):
        colours = {
            "server_wins": "green",
            "client_wins": "blue",
            "manual":      "purple",
            "deferred":    "orange",
        }
        return format_html(
            '<span style="color:{};font-weight:bold">{}</span>',
            colours.get(obj.resolution, "black"),
            obj.get_resolution_display(),
        )
