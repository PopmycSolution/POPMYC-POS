"""
cloud/sync_views.py
===================
Stage 6.2C — Cloud-side synchronization endpoints.

These views live under /api/v1/cloud/sync/ and extend the existing
/api/sync/ infrastructure with cloud-device authentication and
business-level isolation.

Endpoints
---------
POST   /api/v1/cloud/sync/register-device/
    Links an authenticated CloudDevice to a SyncDevice so the cloud
    can correlate sync uploads with their authenticated device identity.

GET    /api/v1/cloud/sync/status/
    Returns the sync queue state for the authenticated cloud device.

Architecture notes
------------------
- Upload and download are handled by the EXISTING /api/sync/upload/ and
  /api/sync/download/ views, which now also accept Device token auth
  (Stage 6.2C upgrade in synchronization/views.py).

- These views add the CloudDevice→SyncDevice bridge and a cloud-aware
  status endpoint on top of that existing infrastructure.

- All views inherit CloudAPIView (CLOUD_ENABLED gate) and require either
  a valid Device token or a JWT with an active CloudProfile.

- Business isolation is enforced from the authenticated CloudDevice's
  business — clients cannot supply a different business_id.

Offline safety
--------------
These views are only reachable when CLOUD_ENABLED=True.
The local POS, /api/sync/ endpoints, and SyncManager are unaffected.
"""

from __future__ import annotations

import logging
from uuid import UUID

from django.db import transaction
from django.utils import timezone

from rest_framework import status
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from cloud.authentication import DeviceTokenAuthentication, get_device_from_request
from cloud.feature_flags import CloudAPIView
from cloud.license_service import CloudLicenseService
from cloud.models import CloudAuditLog, CloudDevice
from cloud.permissions import IsDeviceOrCloudAuthenticated
from synchronization.models import SyncDevice, SyncRecord

logger = logging.getLogger(__name__)


class CloudSyncThrottle(UserRateThrottle):
    """Sync-specific throttle — more generous than general cloud endpoints."""
    rate = "120/min"


# ── Shared authenticator factory ───────────────────────────────────────────────

def _sync_authenticators():
    from rest_framework_simplejwt.authentication import JWTAuthentication
    return [DeviceTokenAuthentication(), JWTAuthentication()]


# ══════════════════════════════════════════════════════════════════════════════
# Device Bridge Registration
# ══════════════════════════════════════════════════════════════════════════════

class CloudSyncDeviceBridgeView(CloudAPIView):
    """
    POST /api/v1/cloud/sync/register-device/

    Links an authenticated CloudDevice to a SyncDevice (or creates the
    SyncDevice if it doesn't exist yet) so that:

        CloudDevice  →  SyncDevice  →  SyncRecord queue

    This must be called once by a POS terminal after:
      1. Registering via POST /api/v1/cloud/business/<id>/devices/register/
      2. Receiving its Device token.

    Request body (all optional — values derived from the authenticated device
    when absent):

        {
          "sync_device_id": "<UUID>",   // existing SyncDevice.device_id to link
          "branch_id":      "<UUID>",   // branch to associate with the SyncDevice
          "name":           "Till 1"    // human name for the SyncDevice
        }

    Business isolation:
    - business_id is taken from the authenticated CloudDevice.
    - Clients cannot supply a different business_id.
    - If sync_device_id is supplied, the SyncDevice must belong to the same
      business as the CloudDevice.

    Response:
        {
          "cloud_device_uuid": "...",
          "sync_device_id": "...",
          "business_id": "...",
          "branch_id": "...",
          "created": true/false,
          "linked": true/false
        }
    """

    permission_classes = [IsDeviceOrCloudAuthenticated]
    throttle_classes   = [CloudSyncThrottle]

    def get_authenticators(self):
        return _sync_authenticators()

    def post(self, request):
        # ── Resolve the authenticated cloud device ─────────────────────────
        cloud_device = get_device_from_request(request)
        if cloud_device is None:
            # JWT path — device context not available
            return Response(
                {"detail": "Device token authentication required for sync registration."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        business_id  = cloud_device.business_id
        business     = cloud_device.business
        branch_id    = request.data.get("branch_id")
        device_name  = request.data.get("name", cloud_device.name or str(cloud_device.device_uuid))

        # Validate and parse optional branch_id
        branch_uuid = None
        if branch_id:
            try:
                branch_uuid = UUID(str(branch_id))
            except (ValueError, TypeError):
                return Response(
                    {"detail": "Invalid branch_id — must be a UUID."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # Branch must belong to the same business (server-side check)
            from branches.models import Branch
            if not Branch.objects.filter(id=branch_uuid, business_id=business_id).exists():
                return Response(
                    {"detail": "Branch does not belong to this business."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # ── Check license permits cloud operations ─────────────────────────
        allowed, lic_status = CloudLicenseService.is_cloud_access_permitted(business)
        if not allowed:
            return Response(
                {
                    "detail": f"Cloud access denied: license is {lic_status.license_state}.",
                    "license_state": lic_status.license_state,
                },
                status=status.HTTP_402_PAYMENT_REQUIRED,
            )

        # ── Resolve the SyncDevice ─────────────────────────────────────────
        supplied_sync_id = request.data.get("sync_device_id")
        existing_sync_device = None

        if supplied_sync_id:
            try:
                supplied_uuid = UUID(str(supplied_sync_id))
            except (ValueError, TypeError):
                return Response(
                    {"detail": "Invalid sync_device_id — must be a UUID."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            existing_sync_device = SyncDevice.objects.filter(
                device_id=supplied_uuid
            ).first()
            if existing_sync_device:
                # Verify it belongs to the same business
                if (existing_sync_device.business_id and
                        existing_sync_device.business_id != business_id):
                    return Response(
                        {"detail": "SyncDevice belongs to a different business."},
                        status=status.HTTP_403_FORBIDDEN,
                    )

        with transaction.atomic():
            # Already linked? Update metadata but don't create a duplicate.
            if cloud_device.sync_device is not None and existing_sync_device is None:
                existing_sync_device = cloud_device.sync_device

            if existing_sync_device:
                # Update the SyncDevice with current context
                updated = False
                if branch_uuid and existing_sync_device.branch_id != branch_uuid:
                    existing_sync_device.branch_id = branch_uuid
                    updated = True
                if not existing_sync_device.business_id:
                    existing_sync_device.business_id = business_id
                    updated = True
                if device_name and existing_sync_device.name != device_name:
                    existing_sync_device.name = device_name
                    updated = True
                if updated:
                    existing_sync_device.save(
                        update_fields=["business_id", "branch_id", "name", "updated_at"]
                    )
                sync_device = existing_sync_device
                created     = False
            else:
                # Create a new SyncDevice using the CloudDevice's UUID as device_id
                sync_device, created = SyncDevice.objects.update_or_create(
                    device_id=cloud_device.device_uuid,
                    defaults={
                        "name":        device_name,
                        "business_id": business_id,
                        "branch_id":   branch_uuid,
                        "is_active":   True,
                    },
                )

            # Link CloudDevice → SyncDevice
            linked = False
            if cloud_device.sync_device_id != sync_device.pk:
                cloud_device.sync_device = sync_device
                cloud_device.save(update_fields=["sync_device", "updated_at"])
                linked = True

        # Audit
        CloudAuditLog.log(
            action  = CloudAuditLog.Action.DEVICE_REGISTERED,
            actor   = request.user,
            business= business,
            metadata= {
                "cloud_device_uuid": str(cloud_device.device_uuid),
                "sync_device_id":    str(sync_device.device_id),
                "created":           created,
                "linked":            linked,
            },
        )

        return Response(
            {
                "cloud_device_uuid": str(cloud_device.device_uuid),
                "sync_device_id":    str(sync_device.device_id),
                "business_id":       str(business_id),
                "branch_id":         str(branch_uuid) if branch_uuid else None,
                "name":              sync_device.name,
                "created":           created,
                "linked":            linked,
            },
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


# ══════════════════════════════════════════════════════════════════════════════
# Cloud Sync Status
# ══════════════════════════════════════════════════════════════════════════════

class CloudSyncStatusView(CloudAPIView):
    """
    GET /api/v1/cloud/sync/status/

    Returns the sync queue state for the authenticated cloud device.
    Derives business_id / device context from the authenticated CloudDevice
    so the client cannot inject a different business.

    Response mirrors /api/sync/status/ but is scoped to the cloud device's
    business and linked SyncDevice.
    """

    permission_classes = [IsDeviceOrCloudAuthenticated]
    throttle_classes   = [CloudSyncThrottle]

    def get_authenticators(self):
        return _sync_authenticators()

    def get(self, request):
        cloud_device = get_device_from_request(request)
        business_id  = None
        sync_device  = None

        if cloud_device:
            business_id = cloud_device.business_id
            sync_device = cloud_device.sync_device
        elif request.user and request.user.is_authenticated:
            # JWT path — use user's business
            business_id = getattr(request.user, "business_id", None)

        filters: dict = {}
        if business_id:
            filters["business_id"] = business_id
        if sync_device:
            filters["device_id"] = sync_device.device_id

        counts = {}
        for s in [
            SyncRecord.STATUS_PENDING,
            SyncRecord.STATUS_SYNCING,
            SyncRecord.STATUS_SYNCED,
            SyncRecord.STATUS_FAILED,
            SyncRecord.STATUS_CONFLICT,
        ]:
            counts[s] = SyncRecord.objects.filter(status=s, **filters).count()

        lic_status = None
        if cloud_device:
            lic_status = CloudLicenseService.get_status(cloud_device.business).as_dict()

        return Response(
            {
                "pending":          counts.get(SyncRecord.STATUS_PENDING,  0),
                "syncing":          counts.get(SyncRecord.STATUS_SYNCING,  0),
                "synced":           counts.get(SyncRecord.STATUS_SYNCED,   0),
                "failed":           counts.get(SyncRecord.STATUS_FAILED,   0),
                "conflict":         counts.get(SyncRecord.STATUS_CONFLICT, 0),
                "last_sync_at":     sync_device.last_sync_at.isoformat()
                                    if sync_device and sync_device.last_sync_at else None,
                "sync_checkpoint":  sync_device.sync_checkpoint.isoformat()
                                    if sync_device and sync_device.sync_checkpoint else None,
                "business_id":      str(business_id) if business_id else None,
                "device_linked":    sync_device is not None,
                "license_status":   lic_status,
                "server_time":      timezone.now().isoformat(),
            }
        )
