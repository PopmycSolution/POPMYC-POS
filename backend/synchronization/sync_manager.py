import logging

import requests
from django.conf import settings
from django.utils import timezone

from synchronization.model_applier import SyncModelApplier
from synchronization.models import SyncDevice, SyncRecord


logger = logging.getLogger(__name__)


class SyncManager:
    """
    Handles two-way synchronization between the local POS database
    and the cloud database.

    Flow:

        Local changes
            ↓
        Upload
            ↓
        Cloud

        Cloud changes
            ↓
        Download
            ↓
        Local database
    """

    def __init__(self, base_url=None, token=None):
        self.base_url = (
            base_url
            if base_url is not None
            else getattr(settings, "SYNC_CLOUD_URL", "")
        ).rstrip("/")

        self.token = (
            token
            if token is not None
            else getattr(settings, "SYNC_CLOUD_TOKEN", "")
        )

    def headers(self):
        """
        Headers used for communication with the cloud API.
        """
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        return headers

    def is_configured(self):
        """
        Returns True when a cloud synchronization URL is configured.
        """
        return bool(self.base_url)

    def upload_pending(self, limit=100):
        """
        Upload pending and previously failed synchronization records
        to the cloud.
        """

        if not self.is_configured():
            return {
                "success": False,
                "status": "not_configured",
                "message": "Cloud synchronization is not configured.",
            }

        records = list(
            SyncRecord.objects.filter(
                status__in=[
                    SyncRecord.STATUS_PENDING,
                    SyncRecord.STATUS_FAILED,
                ]
            )
            .order_by("created_at")[:limit]
        )

        if not records:
            return {
                "success": True,
                "status": "nothing_to_upload",
                "uploaded": 0,
                "records": [],
            }

        # ── Mark all selected records as SYNCING before the network call ──────
        # This prevents the same records from being picked up by a concurrent
        # sync attempt and makes the in-flight state visible in the status API.
        record_ids = [r.id for r in records]
        SyncRecord.objects.filter(id__in=record_ids).update(
            status=SyncRecord.STATUS_SYNCING
        )
        # Refresh in-memory status so the serializer returns accurate data
        for r in records:
            r.status = SyncRecord.STATUS_SYNCING

        payload = {
            "records": [
                self._serialize_sync_record(record)
                for record in records
            ]
        }

        url = f"{self.base_url}/upload/"

        try:
            response = requests.post(
                url,
                json=payload,
                headers=self.headers(),
                timeout=30,
            )

            response.raise_for_status()
            data = response.json()

            accepted_ids = {
                item.get("id")
                for item in data.get("accepted", [])
                if item.get("id")
            }

            duplicate_ids = {
                item.get("id")
                for item in data.get("duplicates", [])
                if item.get("id")
            }

            # Mark records accepted by the cloud as synchronized.
            for record in records:
                record_id = str(record.id)

                if record_id in accepted_ids:
                    record.status = SyncRecord.STATUS_SYNCED
                    record.synced_at = timezone.now()
                    record.last_error = ""
                    record.save(
                        update_fields=[
                            "status",
                            "synced_at",
                            "last_error",
                            "updated_at",
                        ]
                    )

                elif record_id in duplicate_ids:
                    record.status = SyncRecord.STATUS_SYNCED
                    record.synced_at = timezone.now()
                    record.last_error = ""
                    record.save(
                        update_fields=[
                            "status",
                            "synced_at",
                            "last_error",
                            "updated_at",
                        ]
                    )

            return {
                "success": True,
                "status": "uploaded",
                "uploaded": len(accepted_ids),
                "duplicates": len(duplicate_ids),
                "response": data,
            }

        except requests.RequestException as exc:
            logger.exception(
                "Cloud synchronization upload failed."
            )

            for record in records:
                record.status = SyncRecord.STATUS_FAILED
                record.attempts += 1
                record.last_error = str(exc)
                record.save(
                    update_fields=[
                        "status",
                        "attempts",
                        "last_error",
                        "updated_at",
                    ]
                )

            return {
                "success": False,
                "status": "network_error",
                "error": str(exc),
            }

        except Exception as exc:
            logger.exception(
                "Unexpected synchronization upload error."
            )

            # Reset SYNCING → FAILED so records are not permanently stuck.
            # This covers unexpected exceptions (JSON decode, timeout, etc.)
            # that are NOT requests.RequestException subclasses.
            for record in records:
                if record.status == SyncRecord.STATUS_SYNCING:
                    record.status = SyncRecord.STATUS_FAILED
                    record.attempts += 1
                    record.last_error = f"Unexpected error: {exc}"
                    record.save(
                        update_fields=[
                            "status",
                            "attempts",
                            "last_error",
                            "updated_at",
                        ]
                    )

            return {
                "success": False,
                "status": "failed",
                "error": str(exc),
            }

    def download_changes(self, since=None, device_id=None):
        """
        Download synchronized changes from the cloud and apply them
        to the local database.
        """

        if not self.is_configured():
            return {
                "success": False,
                "status": "not_configured",
                "message": "Cloud synchronization is not configured.",
            }

        params = {}

        if since:
            params["since"] = since

        if device_id:
            params["device_id"] = str(device_id)

        url = f"{self.base_url}/download/"

        try:
            response = requests.get(
                url,
                params=params,
                headers=self.headers(),
                timeout=30,
            )

            response.raise_for_status()
            data = response.json()

            cloud_records = data.get("records", [])

            applied = []
            skipped = []
            failed = []

            for item in cloud_records:
                result = self._apply_downloaded_record(item)

                if result["status"] == "applied":
                    applied.append(result)

                elif result["status"] == "skipped":
                    skipped.append(result)

                else:
                    failed.append(result)

            return {
                "success": len(failed) == 0,
                "status": "downloaded",
                "downloaded": len(cloud_records),
                "applied": len(applied),
                "skipped": len(skipped),
                "failed": len(failed),
                "records": cloud_records,
                "applied_records": applied,
                "skipped_records": skipped,
                "failed_records": failed,
                "server_time": data.get("server_time"),
            }

        except requests.RequestException as exc:
            logger.exception(
                "Cloud synchronization download failed."
            )

            return {
                "success": False,
                "status": "network_error",
                "error": str(exc),
            }

        except Exception as exc:
            logger.exception(
                "Unexpected synchronization download error."
            )

            return {
                "success": False,
                "status": "failed",
                "error": str(exc),
            }

    def _apply_downloaded_record(self, item):
        """
        Apply one cloud synchronization record to the local database.
        """

        try:
            sync_id = item.get("id")

            if not sync_id:
                raise ValueError(
                    "Downloaded synchronization record has no ID."
                )

            # ---------------------------------------------------------
            # Prevent the same cloud event from being applied twice.
            # ---------------------------------------------------------
            existing = SyncRecord.objects.filter(
                id=sync_id
            ).first()

            if existing:
                return {
                    "status": "skipped",
                    "id": str(sync_id),
                    "reason": "Synchronization record already exists locally.",
                }

            record_id = item.get("record_id")
            app_label = item.get("app_label")
            model_name = item.get("model_name")
            device_id = item.get("device_id")
            business_id = item.get("business_id")
            branch_id = item.get("branch_id")
            action = item.get("action")
            version = item.get("version", 1)
            payload = item.get("payload", {})

            if not record_id:
                raise ValueError("Missing record ID.")

            if not app_label:
                raise ValueError("Missing app label.")

            if not model_name:
                raise ValueError("Missing model name.")

            if not action:
                raise ValueError("Missing synchronization action.")

            if not isinstance(payload, dict):
                raise ValueError("Synchronization payload must be an object.")

            # ---------------------------------------------------------
            # Store the downloaded cloud event locally first.
            # ---------------------------------------------------------
            sync_record = SyncRecord.objects.create(
                id=sync_id,
                record_id=record_id,
                app_label=app_label,
                model_name=model_name,
                device_id=device_id,
                business_id=business_id,
                branch_id=branch_id,
                action=action,
                status=SyncRecord.STATUS_PENDING,
                version=version,
                payload=payload,
            )

            # ---------------------------------------------------------
            # Apply the actual business data to the local database.
            # ---------------------------------------------------------
            try:
                instance = SyncModelApplier.apply(sync_record)

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

                logger.info(
                    "Cloud record applied locally: %s.%s record=%s",
                    app_label,
                    model_name,
                    record_id,
                )

                return {
                    "status": "applied",
                    "id": str(sync_id),
                    "record_id": str(record_id),
                    "action": action,
                    "version": version,
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

                raise

        except Exception as exc:
            logger.exception(
                "Failed to apply downloaded synchronization record."
            )

            return {
                "status": "failed",
                "id": str(item.get("id", "")),
                "record_id": str(item.get("record_id", "")),
                "error": str(exc),
            }

    def synchronize_device(
        self,
        device_id,
        name="",
        business_id=None,
        branch_id=None,
    ):
        """
        Register or update a device on the cloud.
        """

        if not self.is_configured():
            return {
                "success": False,
                "status": "not_configured",
                "message": "Cloud synchronization is not configured.",
            }

        payload = {
            "device_id": str(device_id),
            "name": name,
            "business_id": (
                str(business_id)
                if business_id
                else None
            ),
            "branch_id": (
                str(branch_id)
                if branch_id
                else None
            ),
        }

        url = f"{self.base_url}/device/"

        try:
            response = requests.post(
                url,
                json=payload,
                headers=self.headers(),
                timeout=30,
            )

            response.raise_for_status()

            return {
                "success": True,
                "status": "registered",
                "response": response.json(),
            }

        except requests.RequestException as exc:
            logger.exception(
                "Cloud device registration failed."
            )

            return {
                "success": False,
                "status": "network_error",
                "error": str(exc),
            }

        except Exception as exc:
            logger.exception(
                "Unexpected device registration error."
            )

            return {
                "success": False,
                "status": "failed",
                "error": str(exc),
            }

    def run(self, device_id=None):
        """
        Perform a complete synchronization cycle:

            1. Upload local pending changes.
            2. Download cloud changes.
            3. Apply cloud changes locally.
            4. Update the device's last sync timestamp.
        """

        if not self.is_configured():
            return {
                "success": False,
                "status": "not_configured",
                "message": "Cloud synchronization is not configured.",
            }

        device = None

        if device_id:
            device = SyncDevice.objects.filter(
                device_id=device_id,
                is_active=True,
            ).first()
        else:
            device = (
                SyncDevice.objects.filter(
                    is_active=True
                )
                .order_by("created_at")
                .first()
            )

        if not device:
            return {
                "success": False,
                "status": "no_device",
                "message": "No active synchronization device found.",
            }

        upload_result = self.upload_pending()

        since = None

        if device.last_sync_at:
            since = device.last_sync_at.isoformat()

        download_result = self.download_changes(
            since=since,
            device_id=device.device_id,
        )

        # -------------------------------------------------------------
        # Only move the sync cursor forward after the download
        # successfully completed.
        # -------------------------------------------------------------
        if download_result.get("success"):
            server_time = download_result.get("server_time")

            if server_time:
                try:
                    last_sync = timezone.datetime.fromisoformat(
                        server_time.replace("Z", "+00:00")
                    )
                except (ValueError, TypeError):
                    last_sync = timezone.now()
            else:
                last_sync = timezone.now()

            device.last_sync_at = last_sync
            device.save(
                update_fields=[
                    "last_sync_at",
                    "updated_at",
                ]
            )

        return {
            "success": (
                upload_result.get("success", False)
                and download_result.get("success", False)
            ),
            "device_id": str(device.device_id),
            "upload": upload_result,
            "download": download_result,
        }

    @staticmethod
    def _serialize_sync_record(record):
        """
        Convert a local SyncRecord into the JSON format expected
        by the cloud synchronization API.
        """

        return {
            "id": str(record.id),
            "record_id": str(record.record_id),
            "app_label": record.app_label,
            "model_name": record.model_name,
            "device_id": (
                str(record.device_id)
                if record.device_id
                else None
            ),
            "business_id": (
                str(record.business_id)
                if record.business_id
                else None
            ),
            "branch_id": (
                str(record.branch_id)
                if record.branch_id
                else None
            ),
            "action": record.action,
            "status": record.status,
            "version": record.version,
            "payload": record.payload,
            "attempts": record.attempts,
            "last_error": record.last_error,
            "created_at": (
                record.created_at.isoformat()
                if record.created_at
                else None
            ),
            "updated_at": (
                record.updated_at.isoformat()
                if record.updated_at
                else None
            ),
            "synced_at": (
                record.synced_at.isoformat()
                if record.synced_at
                else None
            ),
        }