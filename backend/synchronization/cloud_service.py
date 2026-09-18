import logging

from django.db import transaction

from synchronization.model_applier import SyncModelApplier
from synchronization.models import SyncRecord


logger = logging.getLogger(__name__)


class CloudSyncService:
    """
    Handles synchronization records received by the cloud.

    This service provides one controlled entry point for applying
    synchronization records to Django models.
    """

    @staticmethod
    @transaction.atomic
    def process(sync_record):
        """
        Apply a synchronization record safely.
        """

        if sync_record.status == SyncRecord.STATUS_CONFLICT:
            return {
                "success": False,
                "status": "conflict",
                "message": "Record is already marked as a conflict.",
            }

        try:
            instance = SyncModelApplier.apply(
                sync_record
            )

            sync_record.status = SyncRecord.STATUS_SYNCED
            sync_record.synced_at = sync_record.updated_at
            sync_record.last_error = ""

            sync_record.save(
                update_fields=[
                    "status",
                    "synced_at",
                    "last_error",
                    "updated_at",
                ]
            )

            logger.info(
                "Cloud synchronization applied: %s.%s record=%s",
                sync_record.app_label,
                sync_record.model_name,
                sync_record.record_id,
            )

            return {
                "success": True,
                "status": "synced",
                "record_id": str(
                    sync_record.record_id
                ),
                "instance": instance,
            }

        except Exception as exc:
            sync_record.status = SyncRecord.STATUS_FAILED
            sync_record.attempts += 1
            sync_record.last_error = str(exc)

            sync_record.save(
                update_fields=[
                    "status",
                    "attempts",
                    "last_error",
                    "updated_at",
                ]
            )

            logger.exception(
                "Cloud synchronization failed: %s",
                sync_record.id,
            )

            return {
                "success": False,
                "status": "failed",
                "record_id": str(
                    sync_record.record_id
                ),
                "error": str(exc),
            }