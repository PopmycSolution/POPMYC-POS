import uuid
from django.db import models
from django.utils.translation import gettext_lazy as _


class Notification(models.Model):
    TYPE_CHOICES = (
        ("INFO", _("Info")),
        ("SUCCESS", _("Success")),
        ("WARNING", _("Warning")),
        ("ERROR", _("Error")),
        ("SYSTEM", _("System")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="notifications",
        null=True,
        blank=True,
    )
    user = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.CASCADE,
        related_name="notifications",
        null=True,
        blank=True,
    )
    title = models.CharField(max_length=255)
    message = models.TextField()
    type = models.CharField(max_length=20, choices=TYPE_CHOICES, default="INFO")
    is_read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)
    related_entity_type = models.CharField(max_length=100, blank=True)
    related_entity_id = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "notifications_notification"
        verbose_name = _("Notification")
        verbose_name_plural = _("Notifications")
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["business", "is_read"]),
            models.Index(fields=["user", "is_read"]),
            models.Index(fields=["business", "type"]),
            models.Index(fields=["user", "type"]),
            models.Index(fields=["created_at"]),
            models.Index(fields=["related_entity_type", "related_entity_id"]),
        ]

    def __str__(self):
        return f"{self.type} - {self.title}"
