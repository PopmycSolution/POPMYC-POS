"""
cloud/trial_views.py
====================
Two-phase cloud TrialCode activation endpoints.

These endpoints are CLOUD-ONLY — they run on Render and talk to the Supabase
database where POPMYC staff store TrialCode records.

They are NEVER called during ordinary POS operation.  The local POS database
does not contain this data.  No cloud DB credential is returned to the client.

Endpoints
---------
  POST /api/v1/cloud/trial/validate/
      Phase 1 — validate a PENDING TrialCode and return a short-lived
      reservation token.  Does NOT consume the code yet.

  POST /api/v1/cloud/trial/complete/
      Phase 2 — atomically consume the TrialCode exactly once.
      Called by the desktop AFTER the local setup has committed successfully.

  POST /api/v1/cloud/trial/verify-reservation/
      Internal endpoint called by the local SetupRunView to confirm that a
      reservation token is still valid before committing the local setup.
      Returns {valid: bool, trial_code_display: str}.
      This endpoint is deliberately narrow — it returns the minimum
      information the local setup needs without leaking cloud internals.

Security guarantees
-------------------
- Raw TrialCode is normalised to UPPERCASE before lookup.
- ActivationReservation.token_hash (SHA-256) is stored; raw token returned ONCE.
- Completed/expired reservations cannot be reused.
- TrialCode.status=USED update is atomic (select_for_update + transaction.atomic).
- No database credential, SECRET_KEY, or Django internal is returned.
- All endpoints require CLOUD_ENABLED=True via CloudAPIView.
- AllowAny permission — no prior authentication needed (pre-login flow).
- Rate-limited to prevent brute-force guessing of trial codes.

Offline safety
--------------
These views are not imported or called from any local POS path.
The LicenseCheckMiddleware already bypasses /api/v1/cloud/* entirely.
"""

from __future__ import annotations

import logging

from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle

from .feature_flags import CloudAPIView
from .models import ActivationReservation
from .permissions import get_client_ip

logger = logging.getLogger(__name__)


# ── Throttle: tighter limit for unauthenticated activation endpoints ──────────

class TrialActivationThrottle(AnonRateThrottle):
    """
    10 requests per minute per IP for trial activation endpoints.
    Prevents automated brute-force guessing of trial codes.
    """
    scope = "trial_activation"
    rate = "10/min"


# ══════════════════════════════════════════════════════════════════════════════
# Phase 1 — Validate + Reserve
# ══════════════════════════════════════════════════════════════════════════════

class TrialValidateView(CloudAPIView):
    """
    POST /api/v1/cloud/trial/validate/

    Validates that a TrialCode is PENDING and creates a short-lived
    ActivationReservation.  Returns a one-time reservation token.

    The TrialCode is NOT consumed here.  If local setup later fails,
    the reservation expires after 10 minutes and the code remains usable.

    Request
    -------
    {
        "activation_code": "XXXX-XXXX-XXXX-XXXX-XXXX"
    }

    Responses
    ---------
    200 OK:
    {
        "valid": true,
        "reservation_token": "<48-char URL-safe token>",
        "expires_in_seconds": 600,
        "trial_days": 7,
        "message": "Code validated. Complete setup within 10 minutes."
    }

    400 Bad Request (invalid / used / revoked):
    {
        "valid": false,
        "error": "invalid_code" | "already_used" | "revoked",
        "message": "<human-readable message>"
    }
    """

    permission_classes = [AllowAny]
    throttle_classes = [TrialActivationThrottle]

    def post(self, request):
        raw_code = request.data.get("activation_code", "")

        if not raw_code or not isinstance(raw_code, str):
            return Response(
                {
                    "valid": False,
                    "error": "missing_code",
                    "message": "activation_code is required.",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Normalise — always uppercase and strip whitespace
        normalised = raw_code.strip().upper()

        # Lazy import to avoid circular dependency at module load
        from licensing.models import TrialCode

        try:
            trial_code = TrialCode.objects.get(code=normalised)
        except TrialCode.DoesNotExist:
            logger.warning(
                "Trial validate: code not found [ip=%s]",
                get_client_ip(request),
            )
            return Response(
                {
                    "valid": False,
                    "error": "invalid_code",
                    "message": (
                        "The activation code is not valid. "
                        "Please check the code provided by POPMYC."
                    ),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if trial_code.status == TrialCode.TrialStatus.USED:
            return Response(
                {
                    "valid": False,
                    "error": "already_used",
                    "message": (
                        "This activation code has already been used. "
                        "Please contact POPMYC support if you believe this is an error."
                    ),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if trial_code.status == TrialCode.TrialStatus.REVOKED:
            return Response(
                {
                    "valid": False,
                    "error": "revoked",
                    "message": (
                        "This activation code has been revoked. "
                        "Please contact POPMYC support."
                    ),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if trial_code.status != TrialCode.TrialStatus.PENDING:
            # Catch any future statuses defensively
            return Response(
                {
                    "valid": False,
                    "error": "invalid_code",
                    "message": "This activation code cannot be used.",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Code is PENDING — create the reservation
        ip = get_client_ip(request)
        try:
            reservation, raw_token = ActivationReservation.create_for(
                trial_code=trial_code,
                ip_address=ip,
            )
        except Exception:
            logger.exception(
                "Trial validate: failed to create reservation for code=%s",
                normalised,
            )
            return Response(
                {
                    "valid": False,
                    "error": "server_error",
                    "message": "Could not create activation reservation. Please try again.",
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        from licensing.models import TRIAL_DAYS

        logger.info(
            "Trial reservation created: reservation_id=%s ip=%s",
            reservation.id,
            ip,
        )

        return Response(
            {
                "valid": True,
                "reservation_token": raw_token,
                "expires_in_seconds": 60 * 10,  # 10 minutes
                "trial_days": TRIAL_DAYS,
                "message": (
                    "Code validated. Complete your setup within 10 minutes "
                    "to activate your 7-day trial."
                ),
            },
            status=status.HTTP_200_OK,
        )


# ══════════════════════════════════════════════════════════════════════════════
# Phase 1.5 — Verify reservation (called by local SetupRunView)
# ══════════════════════════════════════════════════════════════════════════════

class TrialVerifyReservationView(CloudAPIView):
    """
    POST /api/v1/cloud/trial/verify-reservation/

    Called by the local SetupRunView BEFORE committing local setup.
    Confirms the reservation token is still PENDING and not expired.

    Returns the minimum information needed — nothing leaks cloud internals.

    Request
    -------
    {
        "reservation_token": "<token>"
    }

    Responses
    ---------
    200 OK  (always — valid or not, to avoid timing oracles):
    {
        "valid": true | false,
        "trial_days": 7,           // only when valid=true
        "expires_in_seconds": 420  // only when valid=true
    }
    """

    permission_classes = [AllowAny]
    throttle_classes = [TrialActivationThrottle]

    def post(self, request):
        raw_token = request.data.get("reservation_token", "")

        if not raw_token or not isinstance(raw_token, str):
            return Response(
                {"valid": False},
                status=status.HTTP_200_OK,
            )

        reservation = ActivationReservation.get_valid_by_token(raw_token.strip())

        if reservation is None:
            return Response(
                {"valid": False},
                status=status.HTTP_200_OK,
            )

        from licensing.models import TRIAL_DAYS

        remaining = int(
            (reservation.expires_at - timezone.now()).total_seconds()
        )

        return Response(
            {
                "valid": True,
                "trial_days": TRIAL_DAYS,
                "expires_in_seconds": max(remaining, 0),
            },
            status=status.HTTP_200_OK,
        )


# ══════════════════════════════════════════════════════════════════════════════
# Phase 2 — Complete (consume the TrialCode)
# ══════════════════════════════════════════════════════════════════════════════

class TrialCompleteView(CloudAPIView):
    """
    POST /api/v1/cloud/trial/complete/

    Atomically marks the TrialCode as USED and the reservation as COMPLETED.
    Called by the desktop AFTER the local setup has successfully committed
    the TRIAL License to the local database.

    Idempotent: if the reservation is already COMPLETED (e.g., a retry after
    a network failure), returns 200 with completed=True without failing.

    Request
    -------
    {
        "reservation_token": "<token>"
    }

    Responses
    ---------
    200 OK (success or idempotent repeat):
    {
        "completed": true,
        "trial_days": 7,
        "message": "Trial activation recorded."
    }

    400 Bad Request (expired or invalid token):
    {
        "completed": false,
        "error": "expired_reservation" | "invalid_token",
        "message": "<human-readable message>",
        "retry": false   // do NOT retry — reservation is gone
    }

    409 Conflict (code was already used by a *different* reservation):
    {
        "completed": false,
        "error": "already_used",
        "message": "...",
        "retry": false
    }
    """

    permission_classes = [AllowAny]
    throttle_classes = [TrialActivationThrottle]

    def post(self, request):
        raw_token = request.data.get("reservation_token", "")

        if not raw_token or not isinstance(raw_token, str):
            return Response(
                {
                    "completed": False,
                    "error": "missing_token",
                    "message": "reservation_token is required.",
                    "retry": False,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        raw_token = raw_token.strip()
        token_hash = ActivationReservation.hash_token(raw_token)

        # ── Idempotency: check if this reservation is already COMPLETED ───────
        try:
            already_done = ActivationReservation.objects.select_related(
                "trial_code"
            ).get(token_hash=token_hash, status=ActivationReservation.ReservationStatus.COMPLETED)
            # It's already done — idempotent success
            from licensing.models import TRIAL_DAYS
            logger.info(
                "Trial complete (idempotent): reservation already completed for code=%s",
                already_done.trial_code.code[:8] + "…",
            )
            return Response(
                {
                    "completed": True,
                    "trial_days": TRIAL_DAYS,
                    "message": "Trial activation already recorded.",
                },
                status=status.HTTP_200_OK,
            )
        except ActivationReservation.DoesNotExist:
            pass

        # ── Look up the PENDING reservation ───────────────────────────────────
        reservation = ActivationReservation.get_valid_by_token(raw_token)

        if reservation is None:
            # Could be expired or unknown token
            try:
                expired_res = ActivationReservation.objects.get(
                    token_hash=token_hash,
                    status=ActivationReservation.ReservationStatus.EXPIRED,
                )
                return Response(
                    {
                        "completed": False,
                        "error": "expired_reservation",
                        "message": (
                            "The activation reservation has expired. "
                            "Please start the activation process again."
                        ),
                        "retry": False,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            except ActivationReservation.DoesNotExist:
                pass

            return Response(
                {
                    "completed": False,
                    "error": "invalid_token",
                    "message": (
                        "The reservation token is not valid or has expired. "
                        "Please start the activation process again."
                    ),
                    "retry": False,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── Atomically consume the TrialCode + complete the reservation ───────
        try:
            with transaction.atomic():
                # Re-select with lock to prevent race conditions
                from licensing.models import TrialCode
                trial_code = (
                    TrialCode.objects.select_for_update()
                    .get(pk=reservation.trial_code_id)
                )

                if trial_code.status == TrialCode.TrialStatus.USED:
                    # Already used by a different reservation (shouldn't normally happen
                    # but guard against race conditions)
                    return Response(
                        {
                            "completed": False,
                            "error": "already_used",
                            "message": (
                                "This trial code has already been used. "
                                "Contact POPMYC support if you believe this is an error."
                            ),
                            "retry": False,
                        },
                        status=status.HTTP_409_CONFLICT,
                    )

                if trial_code.status == TrialCode.TrialStatus.REVOKED:
                    return Response(
                        {
                            "completed": False,
                            "error": "revoked",
                            "message": (
                                "This trial code has been revoked. "
                                "Contact POPMYC support."
                            ),
                            "retry": False,
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                if trial_code.status != TrialCode.TrialStatus.PENDING:
                    return Response(
                        {
                            "completed": False,
                            "error": "invalid_code",
                            "message": "Trial code is no longer usable.",
                            "retry": False,
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                # Mark the TrialCode as USED — the 7-day clock started locally
                # when the local License was created; we just record the consumption.
                trial_code.status = TrialCode.TrialStatus.USED
                trial_code.activated_at = timezone.now()
                trial_code.save(
                    update_fields=["status", "activated_at", "updated_at"]
                )

                # Mark the reservation as COMPLETED
                reservation.complete()

        except Exception:
            logger.exception(
                "Trial complete: failed to complete reservation_id=%s",
                reservation.id,
            )
            return Response(
                {
                    "completed": False,
                    "error": "server_error",
                    "message": (
                        "The activation could not be recorded due to a server error. "
                        "Your local license is still active. "
                        "The system will retry automatically."
                    ),
                    "retry": True,
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        from licensing.models import TRIAL_DAYS

        logger.info(
            "Trial complete: code=%s reservation_id=%s ip=%s",
            trial_code.code[:8] + "…",
            reservation.id,
            get_client_ip(request),
        )

        return Response(
            {
                "completed": True,
                "trial_days": TRIAL_DAYS,
                "message": "Trial activation recorded successfully.",
            },
            status=status.HTTP_200_OK,
        )
