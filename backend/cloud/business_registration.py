"""
cloud/business_registration.py
================================
Non-blocking cloud registration for a newly-created local Business.

Called by SetupRunView after successful local setup. Two layers of resilience:

  Layer 1 — immediate push:
    Try to POST the business to the Render cloud backend immediately.
    Uses CLOUD_SETUP_URL (the same base URL used for trial activation).
    If it succeeds the business appears in Render admin instantly.

  Layer 2 — SyncRecord queue:
    Always queue a SyncRecord for the Business regardless of Layer 1's
    outcome. The SyncWorker background thread will retry on its next
    cycle (up to every 60 s) if the immediate push failed or if
    CLOUD_ENABLED / SYNC_CLOUD_URL is not yet configured.
    This guarantees eventual delivery even through temporary outages.

Security notes:
  - No secrets, passwords, or DB credentials are sent to the cloud.
  - The business UUID and public fields (name, category, currency) are sent.
  - The cloud endpoint is AllowAny pre-login (same as trial activation).
  - Failures are logged but never raise — local setup must always succeed.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import TYPE_CHECKING

from django.conf import settings

if TYPE_CHECKING:
    from businesses.models import Business
    from branches.models import Branch

logger = logging.getLogger(__name__)

# Endpoint path on the Render cloud backend for business registration.
REGISTER_ENDPOINT = "/api/v1/cloud/trial/register-business/"


def register_business_with_cloud(
    business: "Business",
    branch: "Branch",
    cloud_token: str = "",
    admin_user=None,
) -> bool:
    """
    Post the newly-created Business + Branch to the Render cloud backend.

    Returns True if the cloud accepted the registration, False otherwise.
    Never raises — all exceptions are caught.

    Args:
        business:    The local Business instance just created by SetupRunView.
        branch:      The head-office Branch created alongside the business.
        cloud_token: Optional cloud ActivationReservation token (from trial
                     setup flow) — included for idempotency on the cloud side.
        admin_user:  Optional CustomUser (the admin created during setup) so
                     the cloud admin can show and manage the business owner.
    """
    cloud_url = getattr(settings, "CLOUD_SETUP_URL", "").rstrip("/")
    if not cloud_url:
        logger.info(
            "[CloudReg] CLOUD_SETUP_URL not configured — skipping immediate push "
            "(SyncRecord queue will retry when configured). business=%s",
            business.id,
        )
        return False

    endpoint = cloud_url + REGISTER_ENDPOINT

    # Admin user info — only safe public fields, never password
    admin_info = {}
    if admin_user is not None:
        try:
            admin_info = {
                "admin_id":         str(admin_user.id),
                "admin_username":   admin_user.username,
                "admin_email":      admin_user.email or "",
                "admin_first_name": admin_user.first_name or "",
                "admin_last_name":  admin_user.last_name or "",
            }
        except Exception:
            pass  # non-fatal — user info is best-effort

    payload = json.dumps({
        "business_id":        str(business.id),
        "name":               business.name,
        "business_category":  business.business_category,
        "address":            business.address or "",
        "phone":              business.phone or "",
        "email":              business.email or "",
        "currency":           business.currency or "GHS",
        "currency_symbol":    business.currency_symbol or "GH₵",
        "branch_id":          str(branch.id),
        "branch_name":        branch.name,
        "branch_code":        branch.code,
        "cloud_token_prefix": cloud_token[:8] + "…" if cloud_token else "",
        **admin_info,
    }).encode("utf-8")

    req = urllib.request.Request(
        endpoint,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Accept":       "application/json",
        },
        method="POST",
    )

    logger.info(
        "[CloudReg] Registering business with cloud. "
        "endpoint=%s business_id=%s business_name=%r",
        endpoint,
        business.id,
        business.name,
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read().decode())
            cloud_biz_id = body.get("cloud_business_id") or body.get("business_id", "")
            logger.info(
                "[CloudReg] Cloud registration successful. "
                "business_id=%s cloud_business_id=%s http_status=%d",
                business.id,
                cloud_biz_id,
                resp.status,
            )
            return True

    except urllib.error.HTTPError as exc:
        body_text = ""
        try:
            body_text = exc.read().decode()[:200]
        except Exception:
            pass
        logger.warning(
            "[CloudReg] Cloud registration HTTP error. "
            "business_id=%s http_status=%d reason=%s",
            business.id,
            exc.code,
            body_text or exc.reason,
        )
        return False

    except (urllib.error.URLError, OSError) as exc:
        logger.warning(
            "[CloudReg] Cloud registration network error. "
            "business_id=%s error_type=%s",
            business.id,
            type(exc).__name__,
        )
        return False

    except Exception as exc:
        logger.error(
            "[CloudReg] Cloud registration unexpected error. "
            "business_id=%s error_type=%s",
            business.id,
            type(exc).__name__,
        )
        return False


def queue_business_sync_record(business: "Business", branch: "Branch") -> None:
    """
    Create a SyncRecord for the new Business so the SyncWorker can push it
    to the cloud on its next cycle.

    This is Layer 2 — the offline/retry safety net. It runs regardless of
    whether the immediate cloud push (Layer 1) succeeded, so that the
    SyncRecord also updates the cloud if the business is modified later.

    Safe to call inside or outside a transaction — uses a separate
    try/except block and never raises.
    """
    try:
        from synchronization.services import SyncService
        SyncService.queue_create(
            instance=business,
            business_id=business.id,
        )
        logger.info(
            "[CloudReg] SyncRecord queued for business. business_id=%s",
            business.id,
        )
    except Exception as exc:
        # Non-fatal — SyncRecord queue is best-effort
        logger.warning(
            "[CloudReg] Could not queue SyncRecord for business. "
            "business_id=%s error_type=%s",
            business.id,
            type(exc).__name__,
        )


def sync_business_to_cloud(
    business: "Business",
    branch: "Branch",
    cloud_token: str = "",
    admin_user=None,
) -> None:
    """
    Top-level entry point called from SetupRunView after successful setup.

    Executes both layers:
      1. Immediate cloud push (best-effort, non-blocking on failure)
      2. SyncRecord queue (always, for retry via SyncWorker)

    This function never raises.
    """
    # Layer 1: immediate push
    pushed = register_business_with_cloud(business, branch, cloud_token, admin_user=admin_user)
    if not pushed:
        logger.info(
            "[CloudReg] Immediate push skipped or failed — "
            "SyncRecord will deliver on next sync cycle. business_id=%s",
            business.id,
        )

    # Layer 2: always queue regardless of Layer 1 outcome
    queue_business_sync_record(business, branch)
