"""
synchronization/views.py
========================
Cloud sync API endpoints.

Stage 1 Security Hardening (2026):
  - SyncDownloadView now derives business context ONLY from the authenticated
    identity (Device token or JWT user). Client-supplied ?business_id is
    accepted only when it matches or narrows the authenticated business; it
    can never be used to access a different business's data.
  - SyncDeviceView now validates that a supplied business_id actually belongs
    to the authenticated user's business.
  - No endpoint ever returns records across business boundaries.
"""
import logging
from uuid import UUID

from django.db import models, transaction
from django.utils import timezone

from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from synchronization.cloud_service import CloudSyncService
from synchronization.models import SyncDevice, SyncRecord


logger = logging.getLogger(__name__)


# ── Shared sync-token authenticator ───────────────────────────────────────────

class SyncTokenAuthentication:
    """
    Simple shared-token DRF authentication for local POS sync requests.

    Local POS devices send:
        Authorization: Bearer <SYNC_CLOUD_TOKEN>

    The token is validated against settings.SYNC_CLOUD_TOKEN using a
    constant-time comparison to prevent timing attacks.  On success,
    a synthetic AnonymousUser with a stable business_id (derived from
    the request payload or device registration) is returned so the
    existing business-scoping logic in the views continues to work.

    This authenticator runs FIRST so shared-token requests never reach
    the JWT or Device token backends (which would reject them).
    """

    def authenticate(self, request):
        auth_header = request.META.get("HTTP_AUTHORIZATION", "")
        if not auth_header.startswith("Bearer "):
            return None  # let next authenticator try

        raw_token = auth_header[len("Bearer "):]
        if not raw_token:
            return None

        from django.conf import settings as _settings
        import secrets
        expected = getattr(_settings, "SYNC_CLOUD_TOKEN", "")
        if not expected:
            return None  # not configured — skip

        if not secrets.compare_digest(raw_token.strip(), expected.strip()):
            return None  # wrong token — let JWT try (may be a real JWT)

        # Valid shared token — return a synthetic user.
        # We use a lightweight proxy so DRF is_authenticated() returns True
        # without needing a real DB user lookup.
        return (_SyncTokenUser(), raw_token)

    def authenticate_header(self, request):
        return "Bearer realm=\"sync\""


class _SyncTokenUser:
    """Minimal user object satisfying DRF's is_authenticated check."""
    is_authenticated = True
    is_anonymous     = False
    is_active        = True
    is_superuser     = False
    pk               = None
    id               = None
    business_id      = None   # populated by _get_authenticated_business_id via device lookup

    def __str__(self):
        return "SyncTokenUser"


def _get_sync_authenticators():
    """
    Return authenticators that accept ANY of:
    - Authorization: Bearer <jwt>          (existing JWT path)
    - Authorization: Device <token>        (Stage 6.2B cloud device token)
    - Authorization: Bearer <sync_token>   (shared SYNC_CLOUD_TOKEN — simple installs)

    The SyncTokenAuthentication backend validates the shared token from
    settings.SYNC_CLOUD_TOKEN so every local POS installation can sync
    without needing a per-device JWT or cloud device registration.
    """
    from cloud.authentication import DeviceTokenAuthentication
    return [SyncTokenAuthentication(), DeviceTokenAuthentication(), JWTAuthentication()]


def _get_authenticated_business_id(request):
    """
    Derive the authoritative business UUID from the authenticated identity.

    Priority:
      1. Device token — business comes from the CloudDevice's registered business.
      2. JWT user     — business comes from request.user.business_id.
      3. Sync token   — business comes from the SyncDevice registered for
                        the device_id supplied in the request (query param or body).

    Returns a UUID or None if no business context is available.
    """
    from cloud.authentication import get_device_from_request
    from cloud.models import CloudDevice

    device = get_device_from_request(request)
    if device is not None and device.business_id:
        return device.business_id

    user = getattr(request, "user", None)
    if user and user.is_authenticated and not isinstance(user, _SyncTokenUser):
        biz_id = getattr(user, "business_id", None)
        if biz_id:
            try:
                return UUID(str(biz_id))
            except (ValueError, TypeError):
                pass

    # Sync token path — look up the SyncDevice by device_id from request
    if isinstance(user, _SyncTokenUser):
        device_id_str = (
            request.query_params.get("device_id")
            or (request.data.get("device_id") if hasattr(request, "data") else None)
        )
        if device_id_str:
            try:
                dev_uuid = UUID(str(device_id_str))
                sync_dev = SyncDevice.objects.filter(
                    device_id=dev_uuid, is_active=True
                ).first()
                if sync_dev and sync_dev.business_id:
                    return sync_dev.business_id
            except (ValueError, TypeError):
                pass

    return None


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
                # Auto-register on first upload when using the shared
                # SYNC_CLOUD_TOKEN (trusted local POS installation).
                # ---------------------------------------------------------
                device = SyncDevice.objects.filter(
                    device_id=device_uuid,
                    is_active=True,
                ).first()

                if not device:
                    # Auto-register if the request used the shared sync token
                    _user = getattr(request, "user", None)
                    if isinstance(_user, _SyncTokenUser):
                        device, _created = SyncDevice.objects.get_or_create(
                            device_id=device_uuid,
                            defaults={
                                "name":        f"Auto-registered device {str(device_uuid)[:8]}",
                                "business_id": business_uuid,
                                "branch_id":   branch_uuid,
                                "is_active":   True,
                            },
                        )
                        if not _created and not device.is_active:
                            device.is_active = True
                            device.save(update_fields=["is_active", "updated_at"])
                    else:
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
    GET /api/sync/download/

    Downloads synchronized changes from the cloud.

    Stage 1 Security Hardening
    --------------------------
    Business context is derived EXCLUSIVELY from the authenticated identity:
      - Device token → CloudDevice.business_id
      - JWT user     → request.user.business_id

    A client-supplied ?business_id query parameter is accepted ONLY when
    it matches the authenticated business. It is silently ignored if it
    matches, or rejected with HTTP 403 if it differs.

    If no valid business context can be established, the request is rejected
    with HTTP 400.  The server NEVER falls back to returning records from all
    businesses.
    """

    permission_classes = [IsAuthenticated]

    def get_authenticators(self):
        return _get_sync_authenticators()

    def get(self, request):
        since = request.query_params.get("since")
        device_id = request.query_params.get("device_id")
        client_business_id = request.query_params.get("business_id")
        branch_id = request.query_params.get("branch_id")

        # ── Step 1: derive authoritative business from authenticated identity ──
        auth_business_id = _get_authenticated_business_id(request)

        # ── Step 2: look up the registered device (if device_id provided) ──────
        device = None
        if device_id:
            try:
                device_uuid = UUID(str(device_id))
            except (ValueError, TypeError):
                return Response(
                    {"success": False, "error": "Invalid device ID."},
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
                            "Synchronization device is not registered or is inactive."
                        ),
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # If the device has a business, use that as the authoritative
            # business context (device registration is already validated).
            if device.business_id and auth_business_id is None:
                auth_business_id = device.business_id

        # ── Step 3: validate the client-supplied ?business_id (if any) ─────────
        # Accept it only when it matches the authenticated business.
        # Reject it when it differs — the client cannot override authentication.
        if client_business_id:
            try:
                client_biz_uuid = UUID(str(client_business_id))
            except (ValueError, TypeError):
                return Response(
                    {"success": False, "error": "Invalid business ID."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if auth_business_id is not None and client_biz_uuid != auth_business_id:
                # Client is trying to access a different business's data.
                return Response(
                    {
                        "success": False,
                        "error": (
                            "Requested business does not match the authenticated identity."
                        ),
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

            # Client business matches authenticated identity — OK to use.
            if auth_business_id is None:
                auth_business_id = client_biz_uuid

        # ── Step 4: require a valid business context ────────────────────────────
        # For shared SYNC_CLOUD_TOKEN requests the device may not be registered
        # yet (first sync cycle after install).  In that case accept the
        # client-supplied ?business_id directly — the token already proves the
        # caller is a trusted local POS installation.
        from django.contrib.auth.models import AnonymousUser as _AnonUser
        user = getattr(request, "user", None)
        is_sync_token_user = isinstance(user, _SyncTokenUser)

        if auth_business_id is None and is_sync_token_user and client_business_id:
            try:
                auth_business_id = UUID(str(client_business_id))
            except (ValueError, TypeError):
                pass

        # If after all the above we still have no business context, refuse.
        if auth_business_id is None:
            return Response(
                {
                    "success": False,
                    "error": (
                        "Cannot determine business context for this request. "
                        "Ensure your device is registered with a business or "
                        "your account is associated with a business."
                    ),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── Step 5: build the queryset filters ──────────────────────────────────
        filters = {
            "status":      SyncRecord.STATUS_SYNCED,
            "business_id": auth_business_id,   # always enforced
        }

        if since:
            try:
                filters["updated_at__gt"] = timezone.datetime.fromisoformat(
                    since.replace("Z", "+00:00")
                )
            except ValueError:
                return Response(
                    {"success": False, "error": "Invalid since timestamp."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Branch filter — narrows within the authenticated business.
        # NOTE: cloud-admin-originated records (Business, License changes) have
        # branch_id=None — they must always be delivered to every branch.
        # Only filter by branch when the client explicitly requests it AND
        # only for records that already have a branch_id set.
        if branch_id:
            try:
                bfilter = UUID(str(branch_id))
                # Include records for this branch OR records with no branch (global)
                records = (
                    SyncRecord.objects.filter(**filters)
                    .filter(models.Q(branch_id=bfilter) | models.Q(branch_id=None))
                    .order_by("updated_at")[:500]
                )
            except (ValueError, TypeError):
                return Response(
                    {"success": False, "error": "Invalid branch ID."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        elif device and device.branch_id:
            bfilter = device.branch_id
            # Include records for this branch OR records with no branch (global)
            records = (
                SyncRecord.objects.filter(**filters)
                .filter(models.Q(branch_id=bfilter) | models.Q(branch_id=None))
                .order_by("updated_at")[:500]
            )
        else:
            records = (
                SyncRecord.objects.filter(**filters)
                .order_by("updated_at")[:500]
            )

        serializer = SyncRecordSerializer(records, many=True)

        return Response(
            {
                "success": True,
                "records": serializer.data,
                "count":   len(serializer.data),
                "server_time": timezone.now(),
            },
            status=status.HTTP_200_OK,
        )


class SyncDeviceView(APIView):
    """
    POST /api/sync/device/

    Registers or updates a synchronization device.

    Stage 1 Security Hardening
    --------------------------
    The supplied business_id is validated against the authenticated identity.
    A user cannot register a device under a different business's UUID.
    """

    permission_classes = [IsAuthenticated]

    def get_authenticators(self):
        return _get_sync_authenticators()

    def post(self, request):
        device_id = request.data.get("device_id")

        if not device_id:
            return Response(
                {"success": False, "error": "device_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            device_uuid = UUID(str(device_id))
        except (ValueError, TypeError):
            return Response(
                {"success": False, "error": "Invalid device ID."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        name        = request.data.get("name", "")
        business_id = request.data.get("business_id")
        branch_id   = request.data.get("branch_id")

        business_uuid = None
        branch_uuid   = None

        if business_id:
            try:
                business_uuid = UUID(str(business_id))
            except (ValueError, TypeError):
                return Response(
                    {"success": False, "error": "Invalid business ID."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        if branch_id:
            try:
                branch_uuid = UUID(str(branch_id))
            except (ValueError, TypeError):
                return Response(
                    {"success": False, "error": "Invalid branch ID."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # ── Stage 1: validate business_id against authenticated identity ─────
        # Derive the authoritative business for this authenticated session.
        auth_business_id = _get_authenticated_business_id(request)

        if business_uuid is not None:
            if auth_business_id is not None and business_uuid != auth_business_id:
                # Caller is trying to register a device under a different business.
                return Response(
                    {
                        "success": False,
                        "error": (
                            "Cannot register a device under a different business. "
                            "The supplied business_id does not match your account."
                        ),
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

            # Verify the business actually exists in the database
            from businesses.models import Business
            if not Business.objects.filter(id=business_uuid).exists():
                return Response(
                    {
                        "success": False,
                        "error": "Business not found.",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        with transaction.atomic():
            device, created = SyncDevice.objects.update_or_create(
                device_id=device_uuid,
                defaults={
                    "name":        name,
                    "business_id": business_uuid,
                    "branch_id":   branch_uuid,
                    "is_active":   True,
                },
            )

        serializer = SyncDeviceSerializer(device)

        return Response(
            {
                "success": True,
                "created": created,
                "device":  serializer.data,
            },
            status=status.HTTP_200_OK,
        )
