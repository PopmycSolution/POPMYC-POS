"""
synchronization/cloud_signals.py
=================================
Django signals that queue SyncRecords on the Render (cloud) side when an
admin changes Business, BusinessSettings, License, or Branch data.

These queued records are then downloaded by the local POS on its next sync
cycle (via SyncDownloadView → SyncManager.download_changes()), making cloud
admin changes automatically take effect on the customer's local POS.

What gets queued:
  - Business: name, address, phone, email, currency, is_active, business_category
  - BusinessSettings: branch_mode, inventory_mode, allow_cashier_price_negotiation
  - License: status, expiry_date, license_type (renewal, suspension, revocation)
  - Branch: name, code, is_active, is_head_office, phone, address

Security:
  - Only models in SYNC_ENTITY_ALLOWLIST are queued.
  - No passwords, tokens, SECRET_KEY, or DB credentials are ever included.
  - device_id is None — these are cloud-originated records, not device-originated.

Connected in: synchronization/apps.py SynchronizationConfig.ready()
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# ── Excluded fields — never sent to local POS ─────────────────────────────────
# Passwords, activation codes, internal keys must stay server-side only.
_EXCLUDED_FIELDS: frozenset[str] = frozenset({
    "activation_code",     # License activation code — POPMYC internal only
    "password",
    "token_hash",
    "secret_key",
})


def _queue_sync_record(instance, action: str) -> None:
    """
    Serialize the given model instance and queue a SyncRecord for download
    by the local POS.

    business_id is derived from the instance itself so the download endpoint
    scopes the record to the correct business.

    Never raises — sync queuing failures must not interrupt admin saves.
    """
    try:
        from synchronization.services import SyncService
        from synchronization.model_applier import SYNC_ENTITY_ALLOWLIST

        app_label  = instance._meta.app_label
        model_name = instance._meta.model_name  # always lowercase

        if (app_label, model_name) not in SYNC_ENTITY_ALLOWLIST:
            return  # not syncable — skip silently

        # Resolve business_id from the instance — try every common pattern.
        business_id = None
        try:
            # Direct business_id attribute (most models)
            val = getattr(instance, "business_id", None)
            if val:
                business_id = val
        except Exception:
            pass

        if business_id is None:
            try:
                # Related object .business.id (fallback for unusual mappings)
                biz = getattr(instance, "business", None)
                if biz is not None:
                    business_id = getattr(biz, "id", None) or getattr(biz, "pk", None)
            except Exception:
                pass

        # Serialize — exclude sensitive fields
        if action != "delete":
            payload = SyncService.serialize_instance(instance)
            for field in _EXCLUDED_FIELDS:
                payload.pop(field, None)
        else:
            payload = {"id": str(instance.pk)}

        # Use a version derived from updated_at so the local POS can detect
        # whether it already has the latest version of this record.
        version = 1
        try:
            if hasattr(instance, "updated_at") and instance.updated_at:
                import time
                from datetime import datetime, timezone as dt_tz
                ut = instance.updated_at
                if ut.tzinfo is None:
                    from django.utils import timezone
                    ut = timezone.make_aware(ut)
                version = int(ut.timestamp())
        except Exception:
            pass

        from synchronization.models import SyncRecord
        action_map = {"create": SyncRecord.ACTION_CREATE,
                      "update": SyncRecord.ACTION_UPDATE,
                      "delete": SyncRecord.ACTION_DELETE}
        db_action = action_map.get(action, SyncRecord.ACTION_UPDATE)

        SyncRecord.objects.create(
            record_id   = instance.pk,
            app_label   = app_label,
            model_name  = instance.__class__.__name__,  # matches SyncService convention
            device_id   = None,   # cloud-originated — no device
            business_id = business_id,
            branch_id   = None,
            action      = db_action,
            status      = SyncRecord.STATUS_SYNCED,  # already on cloud — ready to download
            version     = version,
            payload     = payload,
        )
        logger.debug(
            "[CloudSignal] Queued %s.%s pk=%s action=%s for local POS download",
            app_label, model_name, instance.pk, action,
        )
    except Exception as exc:
        # Never crash an admin save because of a sync error
        logger.warning(
            "[CloudSignal] Failed to queue %s pk=%s for sync: %s",
            instance.__class__.__name__, getattr(instance, "pk", "?"),
            type(exc).__name__,
        )


# ── Signal handlers ────────────────────────────────────────────────────────────

def on_business_saved(sender, instance, created, **kwargs):
    _queue_sync_record(instance, "create" if created else "update")


def on_business_settings_saved(sender, instance, created, **kwargs):
    _queue_sync_record(instance, "create" if created else "update")


def on_license_saved(sender, instance, created, **kwargs):
    _queue_sync_record(instance, "create" if created else "update")


def on_license_renewal_log_saved(sender, instance, created, **kwargs):
    if created:
        _queue_sync_record(instance, "create")


def on_branch_saved(sender, instance, created, **kwargs):
    _queue_sync_record(instance, "create" if created else "update")


def on_user_saved(sender, instance, created, **kwargs):
    """
    Queue a SyncRecord when an Admin or SuperAdmin user is saved.
    Only syncs users that belong to a business (POS staff).
    Password is always excluded by _EXCLUDED_FIELDS.
    Cashiers/Managers are NOT synced — only is_staff and is_superuser users
    so the cloud admin shows the business owner and their admin team.
    """
    # Only sync users that belong to a business and are Admin/SuperAdmin
    if not instance.business_id:
        return
    if not (instance.is_staff or instance.is_superuser):
        return
    _queue_sync_record(instance, "create" if created else "update")


def connect_signals() -> None:
    """
    Connect all cloud-push signals.
    Called from SynchronizationConfig.ready() so signals are only connected
    once the app registry is fully initialised.
    """
    from django.db.models.signals import post_save

    try:
        from businesses.models import Business, BusinessSettings
        post_save.connect(on_business_saved,          sender=Business,         weak=False)
        post_save.connect(on_business_settings_saved, sender=BusinessSettings, weak=False)
        logger.debug("[CloudSignal] Connected Business/BusinessSettings signals")
    except Exception as exc:
        logger.warning("[CloudSignal] Could not connect business signals: %s", exc)

    try:
        from licensing.models import License, LicenseRenewalLog
        post_save.connect(on_license_saved,            sender=License,            weak=False)
        post_save.connect(on_license_renewal_log_saved, sender=LicenseRenewalLog, weak=False)
        logger.debug("[CloudSignal] Connected License/LicenseRenewalLog signals")
    except Exception as exc:
        logger.warning("[CloudSignal] Could not connect licensing signals: %s", exc)

    try:
        from branches.models import Branch
        post_save.connect(on_branch_saved, sender=Branch, weak=False)
        logger.debug("[CloudSignal] Connected Branch signals")
    except Exception as exc:
        logger.warning("[CloudSignal] Could not connect branch signals: %s", exc)

    try:
        from django.contrib.auth import get_user_model
        User = get_user_model()
        post_save.connect(on_user_saved, sender=User, weak=False)
        logger.debug("[CloudSignal] Connected CustomUser signals (Admin/SuperAdmin only)")
    except Exception as exc:
        logger.warning("[CloudSignal] Could not connect user signals: %s", exc)
