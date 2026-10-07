import uuid
from django.db import models
from django.utils.translation import gettext_lazy as _


class Backup(models.Model):
    BACKUP_TYPE_CHOICES = (
        ("MANUAL", _("Manual")),
        ("AUTO", _("Automatic")),
    )

    STATUS_CHOICES = (
        ("COMPLETED", _("Completed")),
        ("FAILED", _("Failed")),
        ("IN_PROGRESS", _("In Progress")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="backups",
    )
    backup_type = models.CharField(max_length=10, choices=BACKUP_TYPE_CHOICES, default="MANUAL")
    filename = models.CharField(max_length=255)
    file_path = models.CharField(max_length=500, blank=True)
    size_bytes = models.IntegerField(default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="IN_PROGRESS")
    checksum = models.CharField(max_length=128, blank=True)
    created_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_backups",
    )
    restored_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "backups_backup"
        verbose_name = _("Backup")
        verbose_name_plural = _("Backups")
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["business", "backup_type"]),
            models.Index(fields=["business", "status"]),
            models.Index(fields=["created_at"]),
        ]

    def __str__(self):
        return f"{self.filename} - {self.status}"


def cloud_backup_path(instance, filename):
    """Upload path: cloud_backups/<business_id>/<filename>"""
    return f"cloud_backups/{instance.business_id}/{filename}"


class CloudBackup(models.Model):
    """
    A backup file uploaded to the Render cloud for disaster recovery.
    Each business can have multiple cloud backups.
    On a fresh PC install, the customer is offered to restore their latest cloud backup.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="cloud_backups",
    )
    backup_file = models.FileField(upload_to=cloud_backup_path)
    original_filename = models.CharField(max_length=255)
    size_bytes = models.BigIntegerField(default=0)
    uploaded_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="cloud_backups",
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "backups_cloud_backup"
        ordering = ["-created_at"]
        verbose_name = "Cloud Backup"
        verbose_name_plural = "Cloud Backups"

    def __str__(self):
        return f"{self.original_filename} — {self.business.name if self.business_id else '?'}"
