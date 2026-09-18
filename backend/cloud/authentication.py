"""
cloud/authentication.py
=======================
DRF Authentication backend for cloud-registered devices.

Protocol
--------
Clients send a device token in the Authorization header:

    Authorization: Device <raw_token>

The server:
  1. Extracts the raw token.
  2. Hashes it with SHA-256.
  3. Looks up a CloudDevice whose token_hash matches.
  4. Verifies device is ACTIVE and belongs to a valid business.
  5. Verifies the associated BusinessMembership is still ACTIVE.
  6. Returns (device.membership.user, device) as the DRF (user, auth) pair.

This allows cloud views to do:
    request.user          → the membership's user
    request.auth          → the authenticated CloudDevice instance
    request.cloud_device  → same CloudDevice (set by the auth backend)

Security properties
-------------------
  - Raw token is NEVER stored — only SHA-256 hash is persisted.
  - Comparison uses secrets.compare_digest (constant-time) to prevent
    timing side-channel attacks.
  - A revoked device immediately fails authentication (token_hash is
    cleared on revocation so no hash can match).
  - A device belonging to business A cannot authenticate against business B.
  - Invalid / missing tokens return HTTP 401 (not 403) so the client
    knows authentication itself failed, not an authorisation check.
  - Authentication errors never reveal which part of the check failed
    (device not found, revoked, etc.) to the outside world.
  - DEVICE_AUTH_FAILED audit records NEVER contain raw tokens, token
    hashes, passwords, or any security credential.

Audit logging
-------------
  When a Device-scheme token fails authentication, a CloudAuditLog row
  is written with:
    action   = DEVICE_AUTH_FAILED
    metadata = {
        authentication_method: "device",
        result: "failed",
        reason: <one of the constants below>,
    }
  The reason codes are safe opaque strings — they identify the category
  of failure without leaking device/business details to callers.

  No audit row is created when no Device header is present at all — that
  is a legitimate fall-through to the JWT backend, not a failure.

  To avoid flooding the audit table, failure logging is best-effort: if
  the audit write itself fails (e.g. DB error), the authentication failure
  is still raised normally — the auth failure is never swallowed.

Offline safety
--------------
  This authentication class is ONLY added to cloud endpoints via
  get_authenticators() on individual views. It is NOT inserted into
  REST_FRAMEWORK DEFAULT_AUTHENTICATION_CLASSES, so the local POS API,
  sync endpoints, and all existing views are completely unaffected.
"""

from __future__ import annotations

import logging

from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from .models import CloudDevice, BusinessMembership

logger = logging.getLogger(__name__)

# The Authorization scheme keyword — clients send:  Authorization: Device <token>
DEVICE_AUTH_SCHEME = "Device"

# ── Audit reason codes (safe, non-secret strings) ────────────────────────────
# These are written to CloudAuditLog.metadata["reason"].
# They MUST NOT contain raw tokens, hashes, passwords, or credentials.
_REASON_NO_MATCH         = "no_matching_active_device"
_REASON_INACTIVE_BIZ     = "business_inactive"
_REASON_NO_MEMBERSHIP    = "device_has_no_membership"
_REASON_INACTIVE_MEMBER  = "membership_not_active"


def _get_client_ip(request) -> str | None:
    """Extract real client IP (best-effort, for audit metadata only)."""
    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        return xff.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def _audit_device_auth_failed(reason: str, request, device=None) -> None:
    """
    Write a DEVICE_AUTH_FAILED CloudAuditLog entry.

    Safe metadata only:
      - authentication_method
      - result
      - reason  (opaque category string, never raw token/hash)
      - device_uuid  (if we got far enough to identify the device)
      - business_id  (if we got far enough to identify the business)

    This function is best-effort — any exception is logged at WARNING
    level but never propagated, so an audit DB failure never masks the
    underlying AuthenticationFailed.
    """
    from .models import CloudAuditLog
    try:
        metadata: dict = {
            "authentication_method": "device",
            "result": "failed",
            "reason": reason,
        }
        business = None
        if device is not None:
            # Safe to include device UUID and business ID — these are not secrets
            metadata["device_uuid"] = str(device.device_uuid)
            metadata["device_type"] = device.device_type
            business = device.business if device.business_id else None

        CloudAuditLog.objects.create(
            action=CloudAuditLog.Action.DEVICE_AUTH_FAILED,
            business=business,
            actor=None,          # authentication failed — no authenticated actor
            target_user=None,
            metadata=metadata,
            ip_address=_get_client_ip(request),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "DEVICE_AUTH_FAILED audit write failed (non-fatal): %s", exc
        )


class DeviceTokenAuthentication(BaseAuthentication):
    """
    DRF authentication backend for POPMYC cloud-registered devices.

    Returns (user, cloud_device) on success so DRF sets:
        request.user        → CloudDevice.membership.user
        request.auth        → CloudDevice instance

    Views that need the device context read it from request.auth.

    Usage on a view:
        def get_authenticators(self):
            from rest_framework_simplejwt.authentication import JWTAuthentication
            return [DeviceTokenAuthentication(), JWTAuthentication()]
    """

    def authenticate(self, request):
        """
        Return (user, device) if a valid Device token is present.
        Return None if no Device token header is present (allows the next
        authentication backend in the chain to run).
        Raise AuthenticationFailed on a malformed or invalid Device token.
        """
        raw_token = self._extract_token(request)
        if raw_token is None:
            return None  # no Device header — let JWT backend try next

        device = self._resolve_device(raw_token, request)
        return (device.membership.user, device)

    def authenticate_header(self, request) -> str:
        """Returned in WWW-Authenticate on 401 so clients know the scheme."""
        return DEVICE_AUTH_SCHEME

    # ── Private helpers ───────────────────────────────────────────────────────

    @staticmethod
    def _extract_token(request) -> str | None:
        """
        Parse the Authorization header.
        Returns the raw token string, or None if the header is absent
        or uses a different scheme.
        """
        auth_header = request.META.get("HTTP_AUTHORIZATION", "")
        if not auth_header:
            return None

        parts = auth_header.split()
        if len(parts) != 2:
            return None

        scheme, token = parts
        if scheme != DEVICE_AUTH_SCHEME:
            return None  # different scheme (e.g. Bearer JWT) — not our concern

        return token

    @staticmethod
    def _resolve_device(raw_token: str, request) -> CloudDevice:
        """
        Validate the raw token and return the matching active CloudDevice.
        Raises AuthenticationFailed with a safe generic message on any failure.
        Writes a DEVICE_AUTH_FAILED audit log entry on each failure.

        Steps:
          1. Scan ACTIVE devices only (revoked devices have empty token_hash
             and will never match, but filtering first avoids unnecessary work).
          2. Use CloudDevice.verify_token() for constant-time comparison.
          3. Check business.is_active.
          4. Check membership is still ACTIVE.

        The external error message is always the same generic string —
        callers never learn which specific check failed.
        """
        # Generic client-facing message — never reveals the specific failure
        _fail_msg = "Invalid or expired device credentials."

        # ── Step 1: find a matching active device ──────────────────────────────
        candidates = (
            CloudDevice.objects
            .filter(status=CloudDevice.DeviceStatus.ACTIVE)
            .select_related("business", "membership__user")
            .exclude(token_hash="")  # revoked devices always have blank hash
        )

        matched_device: CloudDevice | None = None
        for device in candidates:
            if device.verify_token(raw_token):
                matched_device = device
                break

        if matched_device is None:
            # Could not find any matching device — log with no device context
            _audit_device_auth_failed(_REASON_NO_MATCH, request, device=None)
            raise AuthenticationFailed(_fail_msg)

        # ── Step 2: business must be active ───────────────────────────────────
        if not matched_device.business.is_active:
            _audit_device_auth_failed(
                _REASON_INACTIVE_BIZ, request, device=matched_device
            )
            raise AuthenticationFailed(_fail_msg)

        # ── Step 3: membership must exist and be active ────────────────────────
        membership = matched_device.membership
        if membership is None:
            _audit_device_auth_failed(
                _REASON_NO_MEMBERSHIP, request, device=matched_device
            )
            raise AuthenticationFailed(_fail_msg)

        if membership.status != BusinessMembership.MemberStatus.ACTIVE:
            _audit_device_auth_failed(
                _REASON_INACTIVE_MEMBER, request, device=matched_device
            )
            raise AuthenticationFailed(_fail_msg)

        # ── All checks passed ──────────────────────────────────────────────────
        # Attach device to request for downstream use (see get_device_from_request)
        request.cloud_device = matched_device

        return matched_device


def get_device_from_request(request) -> CloudDevice | None:
    """
    Convenience helper: return the authenticated CloudDevice if the request
    was authenticated via DeviceTokenAuthentication, or None otherwise.

    Usage in a view:
        device = get_device_from_request(request)
        if device:
            # device-authenticated path
        else:
            # JWT-authenticated path
    """
    auth = getattr(request, "auth", None)
    if isinstance(auth, CloudDevice):
        return auth
    return None
