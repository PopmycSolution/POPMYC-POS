import uuid
from django.db import models
from django.utils.translation import gettext_lazy as _
try:
    from jsonfield import JSONField
except ImportError:
    from django.db.models import JSONField


class AuditLog(models.Model):
    ACTION_CHOICES = (
        ("CREATE", _("Create")),
        ("UPDATE", _("Update")),
        ("DELETE", _("Delete")),
        ("VOID", _("Void")),
        ("REFUND", _("Refund")),
        ("DISCOUNT", _("Discount")),
        ("OVERRIDE", _("Override")),
        ("ADJUSTMENT", _("Adjustment")),
        ("LOGIN", _("Login")),
        ("LOGOUT", _("Logout")),
        ("PASSWORD_CHANGE", _("Password Change")),
        ("EXPORT", _("Export")),
        ("IMPORT", _("Import")),
        ("BACKUP", _("Backup")),
        ("RESTORE", _("Restore")),
        ("APPROVE", _("Approve")),
        ("REJECT", _("Reject")),
        ("CANCEL", _("Cancel")),
        ("CLOSE", _("Close")),
        ("OPEN", _("Open")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="audit_logs",
        null=True,
        blank=True,
    )
    user = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_logs",
    )
    action = models.CharField(max_length=30, choices=ACTION_CHOICES)
    module = models.CharField(max_length=100)
    entity_type = models.CharField(max_length=100)
    entity_id = models.UUIDField(null=True, blank=True)
    old_values = JSONField(default=dict, blank=True, null=True)
    new_values = JSONField(default=dict, blank=True, null=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "audit_audit_log"
        verbose_name = _("Audit Log")
        verbose_name_plural = _("Audit Logs")
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["business", "action"]),
            models.Index(fields=["business", "module"]),
            models.Index(fields=["business", "entity_type"]),
            models.Index(fields=["user", "action"]),
            models.Index(fields=["created_at"]),
            models.Index(fields=["entity_type", "entity_id"]),
        ]

    def __str__(self):
        return f"{self.action} - {self.module} - {self.created_at}"
