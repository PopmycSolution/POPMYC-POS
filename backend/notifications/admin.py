from django.contrib import admin
from notifications.models import Notification


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("title", "type", "is_read", "user", "business", "read_at", "created_at")
    list_filter = ("business", "type", "is_read", "created_at", "read_at")
    search_fields = ("title", "message", "related_entity_type")
    readonly_fields = ("id", "created_at")
    raw_id_fields = ("business", "user")
    date_hierarchy = "created_at"
