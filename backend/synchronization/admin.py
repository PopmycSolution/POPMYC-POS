"""
synchronization/admin.py
========================
Django admin for the synchronization models.
"""

from django.contrib import admin
from django.utils.html import format_html
from django.utils import timezone

from .models import SyncConflictLog, SyncDevice, SyncRecord


# ── SyncRecord ────────────────────────────────────────────────────────────────

@admin.register(SyncRecord)
class SyncRecordAdmin(admin.ModelAdmin):
    list_display = (
        "id_short",
        "app_model",
        "record_id_short",
        "action",
        "status_badge",
        "version",
        "attempts",
        "business_id_short",
        "created_at",
        "updated_at",
        "synced_at",
    )
    list_filter   = ("status", "action", "app_label")
    search_fields = ("record_id", "business_id", "device_id", "app_label", "model_name")
    readonly_fields = (
        "id", "record_id", "app_label", "model_name", "device_id",
        "business_id", "branch_id", "action", "version", "payload",
        "attempts", "last_error", "created_at", "updated_at", "synced_at",
    )
    ordering       = ("-updated_at",)   # most recently touched first
    date_hierarchy = "created_at"
    actions        = ["requeue_failed", "mark_synced_now"]

    fieldsets = (
        ("Identity",   {"fields": ("id", "record_id", "app_label", "model_name", "action")}),
        ("Context",    {"fields": ("device_id", "business_id", "branch_id")}),
        ("State",      {"fields": ("status", "version", "attempts", "last_error")}),
        ("Payload",    {"fields": ("payload",), "classes": ("collapse",)}),
        ("Timestamps", {"fields": ("created_at", "updated_at", "synced_at")}),
    )

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    @admin.display(description="ID (short)")
    def id_short(self, obj):
        return str(obj.id)[:8] + "…"

    @admin.display(description="Record ID")
    def record_id_short(self, obj):
        return str(obj.record_id)[:8] + "…"

    @admin.display(description="Business")
    def business_id_short(self, obj):
        if not obj.business_id:
            return "—"
        return str(obj.business_id)[:8] + "…"

    @admin.display(description="Model")
    def app_model(self, obj):
        return f"{obj.app_label}.{obj.model_name}"

    @admin.display(description="Status")
    def status_badge(self, obj):
        colours = {
            "pending":  ("#6b7280", "⏳"),
            "syncing":  ("#3b82f6", "🔄"),
            "synced":   ("#16a34a", "✅"),
            "failed":   ("#dc2626", "❌"),
            "conflict": ("#f59e0b", "⚠️"),
        }
        colour, icon = colours.get(obj.status, ("#000", "•"))
        return format_html(
            '<span style="color:{};font-weight:700">{} {}</span>',
            colour, icon, obj.status,
        )

    @admin.action(description="🔄 Re-queue selected records (reset to pending)")
    def requeue_failed(self, request, queryset):
        updated = queryset.update(
            status=SyncRecord.STATUS_PENDING,
            attempts=0,
            last_error="",
        )
        self.message_user(request, f"✅ {updated} record(s) reset to pending — will be picked up on next sync.")

    @admin.action(description="✅ Mark selected as synced (force)")
    def mark_synced_now(self, request, queryset):
        updated = queryset.update(
            status=SyncRecord.STATUS_SYNCED,
            synced_at=timezone.now(),
        )
        self.message_user(request, f"✅ {updated} record(s) marked as synced.")


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
        "updated_at",
    )
    list_filter   = ("is_active",)
    search_fields = ("name", "device_id", "business_id")
    readonly_fields = (
        "id", "device_id", "created_at", "updated_at",
        "last_sync_at", "sync_checkpoint",
    )
    ordering = ("-updated_at",)
    actions  = ["reset_sync_cursor"]

    fieldsets = (
        ("Identity",    {"fields": ("id", "device_id", "name", "is_active")}),
        ("Scope",       {"fields": ("business_id", "branch_id")}),
        ("Sync cursor", {"fields": ("last_sync_at", "sync_checkpoint")}),
        ("Timestamps",  {"fields": ("created_at", "updated_at")}),
    )

    @admin.action(description="🔁 Reset sync cursor (force full re-download on next sync)")
    def reset_sync_cursor(self, request, queryset):
        updated = queryset.update(last_sync_at=None, sync_checkpoint=None)
        self.message_user(request, f"✅ Sync cursor reset for {updated} device(s). They will re-download all records on next sync.")


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
    list_filter   = ("resolution", "app_label")
    search_fields = ("record_id", "business_id", "device_id", "app_label", "model_name")
    readonly_fields = (
        "id", "record_id", "app_label", "model_name",
        "business_id", "branch_id", "device_id",
        "client_version", "client_payload",
        "server_version", "server_payload",
        "resolution", "sync_record_id", "created_at",
    )
    ordering       = ("-created_at",)
    date_hierarchy = "created_at"

    fieldsets = (
        ("Record",     {"fields": ("id", "record_id", "app_label", "model_name")}),
        ("Context",    {"fields": ("business_id", "branch_id", "device_id", "sync_record_id")}),
        ("Conflict",   {"fields": ("client_version", "client_payload", "server_version", "server_payload")}),
        ("Resolution", {"fields": ("resolution",)}),
        ("Timestamps", {"fields": ("created_at",)}),
    )

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return True

    def get_readonly_fields(self, request, obj=None):
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
            "server_wins": "#16a34a",
            "client_wins": "#3b82f6",
            "manual":      "#7c3aed",
            "deferred":    "#f59e0b",
        }
        return format_html(
            '<span style="color:{};font-weight:700">{}</span>',
            colours.get(obj.resolution, "#000"),
            obj.get_resolution_display(),
        )
