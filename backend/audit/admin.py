from django.contrib import admin
from audit.models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("action", "module", "entity_type", "user", "business", "ip_address", "created_at")
    list_filter = ("business", "action", "module", "entity_type", "created_at")
    search_fields = ("reason", "entity_type", "module", "ip_address", "user_agent")
    readonly_fields = ("id", "created_at")
    raw_id_fields = ("business", "user")
    date_hierarchy = "created_at"
