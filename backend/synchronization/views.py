import logging
from uuid import UUID

from django.db import transaction
from django.utils import timezone

from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from synchronization.cloud_service import CloudSyncService
from synchronization.models import SyncDevice, SyncRecord


logger = logging.getLogger(__name__)


def _get_sync_authenticators():
    """
    Return authenticators that accept EITHER:
    - Authorization: Bearer <jwt>     (existing JWT path)
    - Authorization: Device <token>   (Stage 6.2B cloud device token)

    DeviceTokenAuthentication is imported lazily to avoid a circular import
    during Django startup (cloud app imports synchronization models).
    """
    from cloud.authentication import DeviceTokenAuthentication
    return [DeviceTokenAuthentication(), JWTAuthentication()]


class SyncRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = SyncRecord
        fields = [
            "id",
            "record_id",
            "app_label",
            "model_name",
            "device_id",
            "business_id",
            "branch_id",
            "action",
            "status",
            "version",
            "payload",
            "attempts",
            "last_error",
            "created_at",
            "updated_at",
            "synced_at",
        ]
        read_only_fields = [
            "id",
            "status",
            "attempts",
            "last_error",
            "created_at",
            "updated_at",
            "synced_at",
        ]


class SyncDeviceSerializer(serializers.ModelSerializer):
    class Meta:
        model = SyncDevice
        fields = [
            "id",
            "device_id",
            "name",
            "business_id",
            "branch_id",
            "last_sync_at",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
        ]


class SyncStatusView(APIView):
    """
    GET /api/sync/status/

    Returns a quick summary of the sync queue for the authenticated user's device.
    Used by the frontend SyncStatusIndicator to show pending/failed counts.
    """
    permission_classes = [IsAuthenticated]

    def get_authenticators(self):
        return _get_sync_authenticators()

    def get(self, request):
        device_id = request.query_params.get("device_id")
        business_id = request.query_params.get("business_id")

        filters = {}
        if device_id:
            try:
                filters["device_id"] = UUID(str(device_id))
            except (ValueError, TypeError):
                pass
        if business_id:
            try:
                filters["business_id"] = UUID(str(business_id))
            except (ValueError, TypeError):
                pass

        # Get the last synced device cursor
        device = None
        if device_id:
            try:
                device = SyncDevice.objects.filter(
                    device_id=UUID(str(device_id)), is_active=True
                ).first()
            except (ValueError, TypeError):
                pass

        counts = {}
        for s in [
            SyncRecord.STATUS_PENDING,
            SyncRecord.STATUS_SYNCING,
            SyncRecord.STATUS_SYNCED,
            SyncRecord.STATUS_FAILED,
            SyncRecord.STATUS_CONFLICT,
        ]:
            counts[s] = SyncRecord.objects.filter(status=s, **filters).count()

        return Response({
            "pending":   counts.get(SyncRecord.STATUS_PENDING,  0),
            "syncing":   counts.get(SyncRecord.STATUS_SYNCING,  0),
            "synced":    counts.get(SyncRecord.STATUS_SYNCED,   0),
            "failed":    counts.get(SyncRecord.STATUS_FAILED,   0),
            "conflict":  counts.get(SyncRecord.STATUS_CONFLICT, 0),
            "last_sync_at": device.last_sync_at.isoformat() if device and device.last_sync_at else None,
            "server_time":  timezone.now().isoformat(),
        })



class SyncUploadView(APIView):
    """
    Receives synchronization records from a local/offline POS device
    and applies them to the cloud database.
    """

    permission_classes = [IsAuthenticated]

    def get_authenticators(self):
        return _get_sync_authenticators()

    def post(self, request):
        records = request.data.get("records", [])

        if not isinstance(records, list):
            return Response(
                {
                    "success": False,
                    "error": "records must be a list.",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if len(records) > 100:
            return Response(
                {
                    "success": False,
                    "error": "A maximum of 100 records can be uploaded at once.",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        accepted = []
        duplicates = []
        conflicts = []
        errors = []

        for item in records:
            try:
                if not isinstance(item, dict):
                    raise ValueError(
                        "Each synchronization record must be an object."
                    )

                sync_id = item.get("id")
                record_id = item.get("record_id")
                app_label = item.get("app_label")
                model_name = item.get("model_name")
                device_id = item.get("device_id")
                business_id = item.get("business_id")
                branch_id = item.get("branch_id")
                action = item.get("action")
                version = item.get("version", 1)
                payload = item.get("payload", {})

                if not sync_id:
                    raise ValueError(
                        "Missing synchronization record ID."
                    )

                if not record_id:
                    raise ValueError("Missing record ID.")

                if not app_label:
                    raise ValueError("Missing app label.")

                if not model_name:
                    raise ValueError("Missing model name.")

                # ── Allowlist check (Stage 6.2C) ───────────────────────────
                # Reject unknown or disallowed model types before any DB work.
                from synchronization.model_applier import _check_allowlist
                try:
                    _check_allowlist(app_label, model_name)
                except LookupError as exc:
                    raise ValueError(str(exc)) from exc

                if not device_id:
                    raise ValueError("Missing device ID.")

                if action not in {
                    SyncRecord.ACTION_CREATE,
                    SyncRecord.ACTION_UPDATE,
                    SyncRecord.ACTION_DELETE,
                }:
                    raise ValueError(
                        f"Invalid synchronization action: {action}"
                    )

                try:
                    sync_uuid = UUID(str(sync_id))
                    record_uuid = UUID(str(record_id))
                    device_uuid = UUID(str(device_id))
                except (ValueError, TypeError):
                    raise ValueError("Invalid UUID supplied.")

                business_uuid = None
                branch_uuid = None

                if business_id:
                    try:
                        business_uuid = UUID(str(business_id))
                    except (ValueError, TypeError):
                        raise ValueError("Invalid business ID.")

                if branch_id:
                    try:
                        branch_uuid = UUID(str(branch_id))
                    except (ValueError, TypeError):
                        raise ValueError("Invalid branch ID.")

                try:
                    version = int(version)
                except (ValueError, TypeError):
                    raise ValueError("Version must be an integer.")

                if version < 1:
                    raise ValueError("Version must be at least 1.")

                if not isinstance(payload, dict):
                    raise ValueError("Payload must be an object.")

                # ---------------------------------------------------------
                # Verify that the device is registered and active.
                # ---------------------------------------------------------
                device = SyncDevice.objects.filter(
                    device_id=device_uuid,
                    is_active=True,
                ).first()

                if not device:
                    raise ValueError(
                        "Synchronization device is not registered or is inactive."
                    )

                # ---------------------------------------------------------
                # Validate business against registered device.
                # ---------------------------------------------------------
                if device.business_id and business_uuid:
                    if device.business_id != business_uuid:
                        raise ValueError(
                            "Business does not match the registered device."
                        )

                # ---------------------------------------------------------
                # Validate branch against registered device.
                # ---------------------------------------------------------
                if device.branch_id and branch_uuid:
                    if device.branch_id != branch_uuid:
                        raise ValueError(
                            "Branch does not match the registered device."
                        )

                # ---------------------------------------------------------
                # Prevent the same synchronization envelope from being
                # processed twice (primary dedup by sync envelope UUID).
                # ---------------------------------------------------------
                existing_sync = SyncRecord.objects.filter(
                    id=sync_uuid
                ).first()

                if existing_sync:
                    duplicates.append(
                        {
                            "id": str(sync_uuid),
                            "record_id": str(record_uuid),
                            "reason": (
                                "Synchronization record already exists."
                            ),
                        }
                    )
                    continue

                # ---------------------------------------------------------
                # Secondary dedup: for Sales, check offline_uuid / idempotency_key
                # so a retry with a *different* sync envelope UUID is still caught.
                # ---------------------------------------------------------
                if app_label == "sales" and model_name.lower() in ("sale",) and action == SyncRecord.ACTION_CREATE:
                    offline_uuid_val = payload.get("offline_uuid") or payload.get("idempotency_key")
                    if offline_uuid_val:
                        try:
                            from sales.models import Sale
                            existing_sale = Sale.objects.filter(
                                business_id=business_uuid,
                                offline_uuid=offline_uuid_val,
                            ).first() or Sale.objects.filter(
                                business_id=business_uuid,
                                idempotency_key=str(offline_uuid_val),
                            ).first()
                            if existing_sale:
                                duplicates.append(
                                    {
                                        "id": str(sync_uuid),
                                        "record_id": str(record_uuid),
                                        "reason": (
                                            f"Sale with offline_uuid={offline_uuid_val} "
                                            "already exists (idempotency dedup)."
                                        ),
                                    }
                                )
                                continue
                        except Exception:
                            pass  # Model import failure — continue normally

                # ---------------------------------------------------------
                # Find the latest cloud version of this record.
                # ---------------------------------------------------------
                latest = (
                    SyncRecord.objects.filter(
                        record_id=record_uuid,
                        app_label=app_label,
                        model_name=model_name,
                        business_id=business_uuid,
                        branch_id=branch_uuid,
                        status=SyncRecord.STATUS_SYNCED,
                    )
                    .order_by("-version", "-created_at")
                    .first()
                )

                # ---------------------------------------------------------
                # Ignore older or already synchronized versions.
                # ---------------------------------------------------------
                if latest and version <= latest.version:
                    duplicates.append(
                        {
                            "id": str(sync_uuid),
                            "record_id": str(record_uuid),
                            "version": version,
                            "cloud_version": latest.version,
                            "reason": (
                                "Older or already synchronized version."
                            ),
                        }
                    )
                    continue

                # ---------------------------------------------------------
                # Create the synchronization envelope and apply it to the
                # cloud database.
                # ---------------------------------------------------------
                with transaction.atomic():
                    sync_record = SyncRecord.objects.create(
                        id=sync_uuid,
                        record_id=record_uuid,
                        app_label=app_label,
                        model_name=model_name,
                        device_id=device_uuid,
                        business_id=business_uuid,
                        branch_id=branch_uuid,
                        action=action,
                        status=SyncRecord.STATUS_PENDING,
                        version=version,
                        payload=payload,
                    )

                    result = CloudSyncService.process(sync_record)

                if result["success"]:
                    accepted.append(
                        {
                            "id": str(sync_record.id),
                            "record_id": str(record_uuid),
                            "version": version,
                            "action": action,
                            "status": "synced",
                        }
                    )
                else:
                    errors.append(
                        {
                            "id": str(sync_record.id),
                            "record_id": str(record_uuid),
                            "status": result.get(
                                "status",
                                "failed",
                            ),
                            "error": result.get(
                                "error",
                                result.get(
                                    "message",
                                    "Synchronization failed.",
                                ),
                            ),
                        }
                    )

            except Exception as exc:
                logger.exception(
                    "Cloud upload processing failed."
                )

                errors.append(
                    {
                        "record_id": str(
                            item.get("record_id", "")
                        ),
                        "error": str(exc),
                    }
                )

        return Response(
            {
                "success": len(errors) == 0,
                "accepted": accepted,
                "duplicates": duplicates,
                "conflicts": conflicts,
                "errors": errors,
                "summary": {
                    "received": len(records),
                    "accepted": len(accepted),
                    "duplicates": len(duplicates),
                    "conflicts": len(conflicts),
                    "errors": len(errors),
                },
            },
            status=status.HTTP_200_OK,
        )


class SyncDownloadView(APIView):
    """
    Downloads synchronized changes from the cloud.
    """

    permission_classes = [IsAuthenticated]

    def get_authenticators(self):
        return _get_sync_authenticators()

    def get(self, request):
        since = request.query_params.get("since")
        device_id = request.query_params.get("device_id")
        business_id = request.query_params.get("business_id")
        branch_id = request.query_params.get("branch_id")

        filters = {
            "status": SyncRecord.STATUS_SYNCED,
        }

        if since:
            try:
                filters["updated_at__gt"] = timezone.datetime.fromisoformat(
                    since.replace("Z", "+00:00")
                )
            except ValueError:
                return Response(
                    {
                        "success": False,
                        "error": "Invalid since timestamp.",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        device = None

        if device_id:
            try:
                device_uuid = UUID(str(device_id))
            except (ValueError, TypeError):
                return Response(
                    {
                        "success": False,
                        "error": "Invalid device ID.",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            device = SyncDevice.objects.filter(
                device_id=device_uuid,
                is_active=True,
            ).first()

            if not device:
                return Response(
                    {
                        "success": False,
                        "error": (
                            "Synchronization device is not "
                            "registered or is inactive."
                        ),
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        if business_id:
            try:
                filters["business_id"] = UUID(str(business_id))
            except (ValueError, TypeError):
                return Response(
                    {
                        "success": False,
                        "error": "Invalid business ID.",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
        elif device and device.business_id:
            filters["business_id"] = device.business_id

        if branch_id:
            try:
                filters["branch_id"] = UUID(str(branch_id))
            except (ValueError, TypeError):
                return Response(
                    {
                        "success": False,
                        "error": "Invalid branch ID.",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
        elif device and device.branch_id:
            filters["branch_id"] = device.branch_id

        records = (
            SyncRecord.objects.filter(**filters)
            .order_by("updated_at")[:500]
        )

        serializer = SyncRecordSerializer(
            records,
            many=True,
        )

        return Response(
            {
                "success": True,
                "records": serializer.data,
                "count": len(serializer.data),
                "server_time": timezone.now(),
            },
            status=status.HTTP_200_OK,
        )


class SyncDeviceView(APIView):
    """
    Registers or updates a synchronization device.
    """

    permission_classes = [IsAuthenticated]

    def get_authenticators(self):
        return _get_sync_authenticators()

    def post(self, request):
        device_id = request.data.get("device_id")

        if not device_id:
            return Response(
                {
                    "success": False,
                    "error": "device_id is required.",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            device_uuid = UUID(str(device_id))
        except (ValueError, TypeError):
            return Response(
                {
                    "success": False,
                    "error": "Invalid device ID.",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        name = request.data.get("name", "")
        business_id = request.data.get("business_id")
        branch_id = request.data.get("branch_id")

        business_uuid = None
        branch_uuid = None

        if business_id:
            try:
                business_uuid = UUID(str(business_id))
            except (ValueError, TypeError):
                return Response(
                    {
                        "success": False,
                        "error": "Invalid business ID.",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        if branch_id:
            try:
                branch_uuid = UUID(str(branch_id))
            except (ValueError, TypeError):
                return Response(
                    {
                        "success": False,
                        "error": "Invalid branch ID.",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        with transaction.atomic():
            device, created = SyncDevice.objects.update_or_create(
                device_id=device_uuid,
                defaults={
                    "name": name,
                    "business_id": business_uuid,
                    "branch_id": branch_uuid,
                    "is_active": True,
                },
            )

        serializer = SyncDeviceSerializer(device)

        return Response(
            {
                "success": True,
                "created": created,
                "device": serializer.data,
            },
            status=status.HTTP_200_OK,
        )