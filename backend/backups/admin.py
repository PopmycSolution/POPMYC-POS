from django.contrib import admin
from backups.models import Backup


@admin.register(Backup)
class BackupAdmin(admin.ModelAdmin):
    list_display = ("filename", "backup_type", "status", "size_bytes", "business", "created_by", "created_at", "restored_at")
    list_filter = ("business", "backup_type", "status", "created_at", "restored_at")
    search_fields = ("filename", "checksum", "file_path")
    readonly_fields = ("id", "created_at", "updated_at")
    raw_id_fields = ("business", "created_by")
    date_hierarchy = "created_at"
