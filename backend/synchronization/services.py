import logging
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from django.db import models, transaction
from django.utils import timezone

from synchronization.models import SyncRecord

logger = logging.getLogger(__name__)


class SyncService:
    """
    Creates synchronization records for local database changes.
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
            version=1,
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
        if instance is None:
            raise ValueError("A model instance is required.")

        if not instance.pk:
            raise ValueError(
                "The model instance must be saved before synchronization."
            )

        if device_id is None:
            device_id = SyncService._get_value(
                instance,
                "device_id",
            )

        if business_id is None:
            business_id = SyncService._get_related_id(
                instance,
                "business",
            )

        if branch_id is None:
            branch_id = SyncService._get_related_id(
                instance,
                "branch",
            )

        payload = {}

        if action != SyncRecord.ACTION_DELETE:
            payload = SyncService.serialize_instance(instance)

        return SyncRecord.objects.create(
            record_id=instance.pk,
            app_label=instance._meta.app_label,
            model_name=instance.__class__.__name__,
            device_id=device_id,
            business_id=business_id,
            branch_id=branch_id,
            action=action,
            status=SyncRecord.STATUS_PENDING,
            version=version,
            payload=payload,
        )

    @staticmethod
    def serialize_instance(instance):
        """
        Convert a Django model instance into JSON-safe data.

        Handles:
        - UUID
        - Decimal
        - datetime/date
        - Foreign keys
        - ImageField/FileField
        - normal primitive values
        """

        data = {}

        for field in instance._meta.fields:
            field_name = field.name

            try:
                value = getattr(instance, field_name)
            except Exception:
                logger.exception(
                    "Unable to read field %s from %s",
                    field_name,
                    instance.__class__.__name__,
                )
                continue

            data[field_name] = SyncService._serialize_value(
                field,
                value,
            )

        return data

    @staticmethod
    def _serialize_value(field, value):
        """
        Convert a Django field value into JSON-compatible data.
        """

        if value is None:
            return None

        # UUID values
        if isinstance(value, UUID):
            return str(value)

        # Decimal values
        if isinstance(value, Decimal):
            return str(value)

        # Date/time values
        if isinstance(value, datetime):
            if timezone.is_aware(value):
                return value.isoformat()

            return value.isoformat()

        if isinstance(value, date):
            return value.isoformat()

        # FileField / ImageField
        if isinstance(
            field,
            (
                models.FileField,
            ),
        ):
            try:
                return value.name or ""
            except Exception:
                return ""

        # ForeignKey
        if isinstance(
            field,
            (
                models.ForeignKey,
                models.OneToOneField,
            ),
        ):
            try:
                return str(value.pk) if value else None
            except Exception:
                return None

        # Boolean, integer, float, string, etc.
        if isinstance(
            value,
            (
                str,
                int,
                float,
                bool,
            ),
        ):
            return value

        # Django-safe fallback
        try:
            return str(value)
        except Exception:
            return None

    @staticmethod
    def _get_related_id(instance, field_name):
        """
        Safely obtain the primary key of a related object.
        """

        try:
            related_object = getattr(instance, field_name, None)

            if related_object is None:
                return None

            return related_object.pk

        except Exception:
            return None

    @staticmethod
    def _get_value(instance, field_name):
        """
        Safely obtain a direct model value.
        """

        try:
            return getattr(instance, field_name, None)
        except Exception:
            return None

    @staticmethod
    def mark_synced(sync_record):
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
        sync_record.status = SyncRecord.STATUS_CONFLICT
        sync_record.last_error = str(error)

        sync_record.save(
            update_fields=[
                "status",
                "last_error",
                "updated_at",
            ]
        )

        return sync_record

    @staticmethod
    def pending(limit=100):
        return SyncRecord.objects.filter(
            status=SyncRecord.STATUS_PENDING
        ).order_by("created_at")[:limit]