import logging

from django.db import transaction
from django.utils import timezone

from synchronization.models import SyncRecord


logger = logging.getLogger(__name__)


class SyncService:
    """
    Central service for creating and managing local synchronization records.

    This service does not modify the existing POS/Sales logic.
    It only records changes that should later be synchronized.
    """

    @staticmethod
    def queue_create(
        instance,
        device_id=None,
        business_id=None,
        branch_id=None,
    ):
        return SyncService._queue(
            instance=instance,
            action=SyncRecord.ACTION_CREATE,
            device_id=device_id,
            business_id=business_id,
            branch_id=branch_id,
        )

    @staticmethod
    def queue_update(
        instance,
        device_id=None,
        business_id=None,
        branch_id=None,
        version=1,
    ):
        return SyncService._queue(
            instance=instance,
            action=SyncRecord.ACTION_UPDATE,
            device_id=device_id,
            business_id=business_id,
            branch_id=branch_id,
            version=version,
        )

    @staticmethod
    def queue_delete(
        instance,
        device_id=None,
        business_id=None,
        branch_id=None,
        version=1,
    ):
        return SyncService._queue(
            instance=instance,
            action=SyncRecord.ACTION_DELETE,
            device_id=device_id,
            business_id=business_id,
            branch_id=branch_id,
            version=version,
        )

    @staticmethod
    @transaction.atomic
    def _queue(
        instance,
        action,
        device_id=None,
        business_id=None,
        branch_id=None,
        version=1,
    ):
        """
        Create a synchronization record for a model instance.
        """

        payload = SyncService.serialize_instance(instance)

        # Automatically discover business/branch from the model
        # when they are available.
        if business_id is None:
            business = getattr(instance, "business", None)

            if business is not None:
                business_id = getattr(
                    business,
                    "id",
                    business,
                )

        if branch_id is None:
            branch = getattr(instance, "branch", None)

            if branch is not None:
                branch_id = getattr(
                    branch,
                    "id",
                    branch,
                )

        # Some models may store IDs directly.
        if business_id is None:
            business_id = getattr(
                instance,
                "business_id",
                None,
            )

        if branch_id is None:
            branch_id = getattr(
                instance,
                "branch_id",
                None,
            )

        sync_record = SyncRecord.objects.create(
            record_id=instance.pk,
            app_label=instance._meta.app_label,
            model_name=instance._meta.model_name,
            device_id=device_id,
            business_id=business_id,
            branch_id=branch_id,
            action=action,
            status=SyncRecord.STATUS_PENDING,
            version=version,
            payload=payload,
        )

        logger.info(
            "Sync record queued: %s.%s [%s] record=%s",
            sync_record.app_label,
            sync_record.model_name,
            action,
            sync_record.record_id,
        )

        return sync_record

    @staticmethod
    def serialize_instance(instance):
        """
        Convert a Django model instance into JSON-safe data.
        """

        data = {}

        for field in instance._meta.fields:
            value = getattr(
                instance,
                field.name,
                None,
            )

            # Convert UUID objects to strings.
            if hasattr(value, "hex"):
                value = str(value)

            # Convert date/time values to ISO format.
            elif hasattr(value, "isoformat"):
                value = value.isoformat()

            # Foreign-key IDs are already represented by
            # <field>_id when using Django's model field name.
            data[field.name] = value

        return data

    @staticmethod
    def mark_synced(sync_record):
        """
        Mark a synchronization record as successfully synced.
        """

        sync_record.status = SyncRecord.STATUS_SYNCED
        sync_record.synced_at = timezone.now()
        sync_record.last_error = ""

        sync_record.save(
            update_fields=[
                "status",
                "synced_at",
                "last_error",
                "updated_at",
            ]
        )

        return sync_record

    @staticmethod
    def mark_failed(sync_record, error):
        """
        Mark a synchronization record as failed.
        """

        sync_record.status = SyncRecord.STATUS_FAILED
        sync_record.attempts += 1
        sync_record.last_error = str(error)

        sync_record.save(
            update_fields=[
                "status",
                "attempts",
                "last_error",
                "updated_at",
            ]
        )

        return sync_record

    @staticmethod
    def mark_conflict(sync_record, error="Synchronization conflict"):
        """
        Mark a synchronization record as a conflict.
        """

        sync_record.status = SyncRecord.STATUS_CONFLICT
        sync_record.attempts += 1
        sync_record.last_error = str(error)

        sync_record.save(
            update_fields=[
                "status",
                "attempts",
                "last_error",
                "updated_at",
            ]
        )

        return sync_record

    @staticmethod
    def pending(limit=100):
        """
        Return records waiting to be synchronized.

        Failed records are included so the sync engine can retry them.
        """

        return SyncRecord.objects.filter(
            status__in=[
                SyncRecord.STATUS_PENDING,
                SyncRecord.STATUS_FAILED,
            ]
        ).order_by(
            "created_at"
        )[:limit]