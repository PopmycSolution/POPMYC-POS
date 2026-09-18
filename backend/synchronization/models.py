import uuid

from django.db import models


class SyncRecord(models.Model):
    STATUS_PENDING  = "pending"
    STATUS_SYNCING  = "syncing"
    STATUS_SYNCED   = "synced"
    STATUS_FAILED   = "failed"
    STATUS_CONFLICT = "conflict"

    STATUS_CHOICES = [
        (STATUS_PENDING,  "Pending"),
        (STATUS_SYNCING,  "Syncing"),
        (STATUS_SYNCED,   "Synced"),
        (STATUS_FAILED,   "Failed"),
        (STATUS_CONFLICT, "Conflict"),
    ]

    ACTION_CREATE = "create"
    ACTION_UPDATE = "update"
    ACTION_DELETE = "delete"

    ACTION_CHOICES = [
        (ACTION_CREATE, "Create"),
        (ACTION_UPDATE, "Update"),
        (ACTION_DELETE, "Delete"),
    ]

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    # The actual record being synchronized
    record_id = models.UUIDField(
        db_index=True,
    )

    # Django application/model
    app_label = models.CharField(
        max_length=100,
        db_index=True,
    )

    model_name = models.CharField(
        max_length=150,
        db_index=True,
    )

    # Device that created this synchronization record
    device_id = models.UUIDField(
        null=True,
        blank=True,
        db_index=True,
    )

    # Business and branch isolation
    business_id = models.UUIDField(
        null=True,
        blank=True,
        db_index=True,
    )

    branch_id = models.UUIDField(
        null=True,
        blank=True,
        db_index=True,
    )

    # Synchronization action
    action = models.CharField(
        max_length=20,
        choices=ACTION_CHOICES,
    )

    # Current synchronization state
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default=STATUS_PENDING,
        db_index=True,
    )

    # Record version.
    # This helps detect conflicting offline changes.
    version = models.PositiveIntegerField(
        default=1,
    )

    # The complete record data
    payload = models.JSONField(
        default=dict,
        blank=True,
    )

    # Number of synchronization attempts
    attempts = models.PositiveIntegerField(
        default=0,
    )

    # Last synchronization error
    last_error = models.TextField(
        blank=True,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    synced_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    class Meta:
        db_table = "synchronization_sync_record"

        ordering = [
            "created_at",
        ]

        indexes = [
            models.Index(
                fields=[
                    "status",
                    "created_at",
                ]
            ),
            models.Index(
                fields=[
                    "app_label",
                    "model_name",
                    "record_id",
                ]
            ),
            models.Index(
                fields=[
                    "device_id",
                    "created_at",
                ]
            ),
            models.Index(
                fields=[
                    "business_id",
                    "branch_id",
                    "created_at",
                ]
            ),
        ]

    def __str__(self):
        return (
            f"{self.app_label}."
            f"{self.model_name} "
            f"{self.record_id} - "
            f"{self.status}"
        )


class SyncDevice(models.Model):
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    # Permanent identifier for the computer/device
    device_id = models.UUIDField(
        unique=True,
        default=uuid.uuid4,
        editable=False,
    )

    name = models.CharField(
        max_length=150,
        blank=True,
    )

    business_id = models.UUIDField(
        null=True,
        blank=True,
        db_index=True,
    )

    branch_id = models.UUIDField(
        null=True,
        blank=True,
        db_index=True,
    )

    # Last successful synchronization (used as the download cursor)
    last_sync_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    # Stage 6.2C: explicit download checkpoint.
    # Stores the server_time returned by the last successful download so
    # the next download can request only newer records.
    # Distinct from last_sync_at (which tracks the upload/full-cycle cursor)
    # so upload failures do not corrupt the download cursor.
    sync_checkpoint = models.DateTimeField(
        null=True,
        blank=True,
        help_text=(
            "Timestamp of the last successfully downloaded batch. "
            "Used as the 'since' cursor for the next download request. "
            "Never advanced until the downloaded records are safely applied."
        ),
    )

    is_active = models.BooleanField(
        default=True,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    class Meta:
        db_table = "synchronization_sync_device"

    def __str__(self):
        return self.name or str(self.device_id)


class SyncConflictLog(models.Model):
    """
    Immutable record of a synchronization conflict.

    Created whenever two offline versions of the same record are
    detected and cannot be automatically resolved.  The winning
    version is recorded alongside the losing payload so it can be
    inspected or manually resolved by an administrator.

    This table is append-only — rows are never updated or deleted.
    """

    RESOLUTION_SERVER_WINS  = "server_wins"
    RESOLUTION_CLIENT_WINS  = "client_wins"
    RESOLUTION_MANUAL       = "manual"
    RESOLUTION_DEFERRED     = "deferred"

    RESOLUTION_CHOICES = [
        (RESOLUTION_SERVER_WINS, "Server version accepted"),
        (RESOLUTION_CLIENT_WINS, "Client version accepted"),
        (RESOLUTION_MANUAL,      "Manually resolved"),
        (RESOLUTION_DEFERRED,    "Deferred — awaiting manual review"),
    ]

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    # The record that conflicted
    record_id  = models.UUIDField(db_index=True)
    app_label  = models.CharField(max_length=100)
    model_name = models.CharField(max_length=150)

    # Business / branch context (raw UUIDs — same pattern as SyncRecord)
    business_id = models.UUIDField(null=True, blank=True, db_index=True)
    branch_id   = models.UUIDField(null=True, blank=True)

    # Device that uploaded the conflicting version
    device_id = models.UUIDField(null=True, blank=True, db_index=True)

    # The incoming (client) version that lost the conflict
    client_version = models.PositiveIntegerField(default=1)
    client_payload = models.JSONField(default=dict, blank=True)

    # The existing (server) version that was kept
    server_version = models.PositiveIntegerField(default=1)
    server_payload = models.JSONField(default=dict, blank=True)

    # How the conflict was resolved
    resolution = models.CharField(
        max_length=20,
        choices=RESOLUTION_CHOICES,
        default=RESOLUTION_DEFERRED,
        db_index=True,
    )

    # Link to the SyncRecord that caused the conflict (nullable — may have
    # been cleaned up already)
    sync_record_id = models.UUIDField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "synchronization_sync_conflict_log"
        verbose_name = "Sync Conflict Log"
        verbose_name_plural = "Sync Conflict Logs"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["record_id", "app_label", "model_name"]),
            models.Index(fields=["business_id", "created_at"]),
        ]

    def __str__(self):
        return (
            f"Conflict: {self.app_label}.{self.model_name} "
            f"record={self.record_id} [{self.resolution}]"
        )