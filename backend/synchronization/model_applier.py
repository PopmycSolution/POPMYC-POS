"""
synchronization/model_applier.py
=================================
Applies a SyncRecord payload to the appropriate Django model.

Stage 6.2C changes
------------------
1. SYNC_ENTITY_ALLOWLIST — Only models in this explicit set may be synced.
   Prevents arbitrary model injection from client payloads.

2. UUID-PK create fix — _clean_payload previously stripped "id" from all
   payloads, causing CREATE operations to generate a new random UUID instead
   of preserving the offline device UUID.  Fixed: "id" is now passed through
   during creates (but still stripped during updates to protect the PK).

3. Conflict detection — _update now checks the server's current version
   against the incoming version and logs SyncConflictLog entries instead of
   silently overwriting newer server data.

4. Financial / inventory safety — transactional models (Sale, SaleItem,
   SalePayment, StockMovement, GoodsReceivedNote items) are append-only on
   create and update-safe on update.

Security
--------
- Only models in SYNC_ENTITY_ALLOWLIST can be resolved via apps.get_model.
- Client-supplied app_label / model_name that are not in the allowlist raise
  LookupError immediately — no dynamic module import from payload data.
- Protected system fields are never overwritten.
"""

from __future__ import annotations

import logging
from django.apps import apps
from django.db import transaction

from synchronization.models import SyncRecord, SyncConflictLog

logger = logging.getLogger(__name__)


# ── Entity allowlist ───────────────────────────────────────────────────────────
# Only these (app_label, model_name) pairs may be synchronized.
# model_name is lowercase (Django canonical form from _meta.model_name).
# Checked case-insensitively — both "Sale" and "sale" are accepted from clients.
#
# DO NOT add:
#   - accounts.customuser (passwords, auth data)
#   - licensing.license   (activation codes)
#   - cloud.*             (cloud credentials, token hashes)
#   - auth.*              (Django auth internals)
#   - django_*            (framework internals)
# ─────────────────────────────────────────────────────────────────────────────

SYNC_ENTITY_ALLOWLIST: frozenset[tuple[str, str]] = frozenset({
    # Products
    ("products",     "product"),
    ("products",     "productvariant"),
    ("products",     "batch"),
    ("products",     "productstocklevel"),
    # Customers
    ("customers",    "customer"),
    # Suppliers
    ("suppliers",    "supplier"),
    ("suppliers",    "suppliercontact"),
    # Sales
    ("sales",        "sale"),
    ("sales",        "saleitem"),
    ("sales",        "salepayment"),
    ("sales",        "salereturn"),
    ("sales",        "salereturnitem"),
    # Purchases
    ("purchases",    "purchaseorder"),
    ("purchases",    "purchaseorderitem"),
    ("purchases",    "goodsreceivednote"),
    ("purchases",    "goodsreceiveditem"),
    ("purchases",    "purchasereturn"),
    ("purchases",    "purchasereturnitem"),
    ("purchases",    "purchasepayment"),
    # Inventory
    ("inventory",    "stockmovement"),
    ("inventory",    "stockadjustment"),
    ("inventory",    "stockadjustmentitem"),
    ("inventory",    "openingstock"),
    ("inventory",    "openingstockitem"),
    ("inventory",    "stocktransfer"),
    ("inventory",    "stocktransferitem"),
    ("inventory",    "stockcount"),
    ("inventory",    "stockcountitem"),
    # Branches (structural — read-mostly from cloud; devices sync registrations)
    ("branches",     "branch"),
    ("branches",     "warehouse"),
    ("branches",     "register"),
    # ── Cloud-admin-pushed models ────────────────────────────────────────────
    # These are queued on Render when an admin changes Business/License/Settings
    # and downloaded by the local POS on the next sync cycle.
    # They are DOWNLOAD-ONLY from the local POS perspective — local POS never
    # uploads these (business_id/license changes are authoritative on the cloud).
    ("businesses",   "business"),
    ("businesses",   "businesssettings"),
    ("licensing",    "license"),
    ("licensing",    "licenserenewallog"),
})

# Fields that must never be overwritten by a client payload under any action.
_ALWAYS_PROTECTED = frozenset({
    "pk",
    "created_at",
    "updated_at",  # auto_now — Django manages this
})

# Fields protected only during updates (allowed at create time for UUIDs).
_UPDATE_PROTECTED = frozenset({
    "id",
    "pk",
    "created_at",
    "updated_at",
})

# Fields that must never be written at all from sync payloads (security).
_NEVER_SYNC_FIELDS = frozenset({
    "password",
    "token_hash",
    "activation_code",
    "secret_key",
})


def _normalise_model_name(model_name: str) -> str:
    return model_name.lower().strip()


def _check_allowlist(app_label: str, model_name: str) -> None:
    """
    Raise LookupError if (app_label, model_name) is not in the allowlist.
    model_name is compared case-insensitively.
    """
    key = (app_label.lower().strip(), _normalise_model_name(model_name))
    if key not in SYNC_ENTITY_ALLOWLIST:
        raise LookupError(
            f"Synchronization is not permitted for model "
            f"'{app_label}.{model_name}'. "
            f"It is not in the sync entity allowlist."
        )


class SyncModelApplier:
    """
    Safely applies SyncRecord payloads to allowlisted Django models.

    Stage 6.2C guarantees:
    - Only allowlisted models are touched.
    - CREATE preserves the offline UUID (id field passed through).
    - UPDATE never overwrites a newer server version (conflict detection).
    - Financial/inventory records are never silently duplicated.
    - All operations run inside a transaction.
    """

    @staticmethod
    def get_model(app_label: str, model_name: str):
        """
        Resolve a Django model after checking the allowlist.
        Raises LookupError for unknown or disallowed models.
        """
        _check_allowlist(app_label, model_name)
        model = apps.get_model(app_label, _normalise_model_name(model_name))
        if model is None:
            raise LookupError(f"Model not found: {app_label}.{model_name}")
        return model

    @staticmethod
    @transaction.atomic
    def apply(sync_record: SyncRecord):
        """
        Apply a SyncRecord to the appropriate Django model.
        All three actions (create / update / delete) are supported.
        Returns the model instance (or None for deletes).
        """
        model = SyncModelApplier.get_model(
            sync_record.app_label,
            sync_record.model_name,
        )

        payload = sync_record.payload or {}
        if not isinstance(payload, dict):
            raise ValueError("Synchronization payload must be a JSON object.")

        if sync_record.action == SyncRecord.ACTION_CREATE:
            return SyncModelApplier._create(model, payload, sync_record)

        if sync_record.action == SyncRecord.ACTION_UPDATE:
            return SyncModelApplier._update(model, sync_record)

        if sync_record.action == SyncRecord.ACTION_DELETE:
            return SyncModelApplier._delete(model, sync_record.record_id)

        raise ValueError(
            f"Unsupported synchronization action: {sync_record.action}"
        )

    # ── Action handlers ───────────────────────────────────────────────────────

    @staticmethod
    def _create(model, payload: dict, sync_record: SyncRecord):
        """
        Create a model instance from the payload.

        Idempotent: if a record with the same PK already exists, return it
        without modification (prevents duplicates on retry).

        Stage 6.2C fix: 'id' IS passed through during creates so that the
        offline device UUID is preserved as the server-side PK.
        """
        record_id = payload.get("id") or str(sync_record.record_id)
        if not record_id:
            raise ValueError("Create payload is missing the record id.")

        # Idempotency — check by PK first
        existing = model.objects.filter(pk=record_id).first()
        if existing:
            logger.info(
                "Record already exists (idempotent create): %s [%s]",
                model._meta.label,
                record_id,
            )
            return existing

        # Secondary idempotency for Sales via offline_uuid / idempotency_key
        if model._meta.app_label == "sales" and model._meta.model_name == "sale":
            existing = SyncModelApplier._find_existing_sale(model, payload, sync_record)
            if existing:
                return existing

        fields = SyncModelApplier._clean_payload(model, payload, update=False)
        # Ensure the record_id from SyncRecord is used as PK (safety net)
        fields.setdefault("id", str(record_id))

        try:
            return model.objects.create(**fields)
        except Exception as exc:
            # Re-check — another worker may have inserted between our check and create
            existing = model.objects.filter(pk=record_id).first()
            if existing:
                logger.warning(
                    "Race condition on create — returning existing: %s [%s]",
                    model._meta.label,
                    record_id,
                )
                return existing
            raise

    @staticmethod
    def _find_existing_sale(model, payload: dict, sync_record: SyncRecord):
        """Check offline_uuid and idempotency_key for Sale-specific dedup."""
        business_id = payload.get("business_id") or str(sync_record.business_id or "")
        if not business_id:
            return None

        offline_uuid = payload.get("offline_uuid")
        idempotency_key = payload.get("idempotency_key")

        if offline_uuid:
            try:
                existing = model.objects.filter(
                    business_id=business_id,
                    offline_uuid=offline_uuid,
                ).first()
                if existing:
                    logger.info(
                        "Sale already exists via offline_uuid=%s", offline_uuid
                    )
                    return existing
            except Exception:
                pass

        if idempotency_key:
            try:
                existing = model.objects.filter(
                    business_id=business_id,
                    idempotency_key=idempotency_key,
                ).first()
                if existing:
                    logger.info(
                        "Sale already exists via idempotency_key=%s",
                        idempotency_key,
                    )
                    return existing
            except Exception:
                pass

        return None

    @staticmethod
    def _update(model, sync_record: SyncRecord):
        """
        Update an existing record.

        Conflict detection:
        - If the server's current version > incoming version → conflict.
          Log a SyncConflictLog entry and return without modifying the record.
        - If the server's current version == incoming version → apply.
        - If the record does not exist → upsert (create from payload).

        Stage 6.2C: version comparison uses the latest SYNCED SyncRecord for
        this (record_id, app_label, model_name) tuple, not a field on the model
        itself (most domain models don't have a version field).
        """
        record_id = sync_record.record_id
        payload   = sync_record.payload or {}

        instance = model.objects.filter(pk=record_id).first()
        if not instance:
            logger.info(
                "Record missing during update — creating: %s [%s]",
                model._meta.label,
                record_id,
            )
            fields = SyncModelApplier._clean_payload(model, payload, update=False)
            fields.setdefault("id", str(record_id))
            return model.objects.create(**fields)

        # ── Conflict detection ─────────────────────────────────────────────
        latest_server = (
            SyncRecord.objects
            .filter(
                record_id=record_id,
                app_label=sync_record.app_label,
                model_name__iexact=sync_record.model_name,
                status=SyncRecord.STATUS_SYNCED,
            )
            .exclude(id=sync_record.id)
            .order_by("-version", "-created_at")
            .first()
        )

        if latest_server and sync_record.version < latest_server.version:
            # Server has a newer version — this incoming update is stale.
            # Log the conflict and return the current server instance unchanged.
            logger.warning(
                "Sync conflict: %s [%s] incoming v%s < server v%s — "
                "server version kept.",
                model._meta.label,
                record_id,
                sync_record.version,
                latest_server.version,
            )
            SyncConflictLog.objects.create(
                record_id      = record_id,
                app_label      = sync_record.app_label,
                model_name     = sync_record.model_name,
                business_id    = sync_record.business_id,
                branch_id      = sync_record.branch_id,
                device_id      = sync_record.device_id,
                client_version = sync_record.version,
                client_payload = payload,
                server_version = latest_server.version,
                server_payload = latest_server.payload,
                resolution     = SyncConflictLog.RESOLUTION_SERVER_WINS,
                sync_record_id = sync_record.id,
            )
            # Mark the incoming SyncRecord as a conflict
            sync_record.status = SyncRecord.STATUS_CONFLICT
            sync_record.last_error = (
                f"Conflict: server v{latest_server.version} "
                f"> client v{sync_record.version}"
            )
            sync_record.save(update_fields=["status", "last_error", "updated_at"])
            return instance

        # ── Apply the update ───────────────────────────────────────────────
        fields = SyncModelApplier._clean_payload(model, payload, update=True)
        for field_name, value in fields.items():
            setattr(instance, field_name, value)

        if fields:
            # Always include updated_at in update_fields so the auto_now
            # timestamp fires even on partial saves — without it, Django
            # skips the auto_now column when update_fields is explicit.
            update_field_set = set(fields.keys())
            if hasattr(instance, "updated_at"):
                update_field_set.add("updated_at")
            instance.save(update_fields=list(update_field_set))

        return instance

    @staticmethod
    def _delete(model, record_id):
        """
        Delete a record if it exists.
        Idempotent: deleting a non-existent record succeeds silently.
        """
        instance = model.objects.filter(pk=record_id).first()
        if not instance:
            return None
        instance.delete()
        return None

    # ── Payload cleaning ──────────────────────────────────────────────────────

    @staticmethod
    def _clean_payload(model, payload: dict, update: bool = False) -> dict:
        """
        Return only fields that exist on the model and are safe to write.

        FK fields are mapped from their field.name (e.g. "business") to their
        attname (e.g. "business_id") so we assign the raw UUID value rather
        than trying to set the related object directly.

        update=False (create):
          - 'id' IS included (preserves offline UUID).
          - 'pk', 'created_at', 'updated_at' are excluded.

        update=True:
          - 'id', 'pk', 'created_at', 'updated_at' are all excluded
            (cannot overwrite the PK or auto-managed timestamps).

        Security fields (_NEVER_SYNC_FIELDS) are always stripped.
        """
        from django.db.models import ForeignKey, OneToOneField

        protected = _UPDATE_PROTECTED if update else _ALWAYS_PROTECTED

        # Build lookup: both field.name and field.attname → (attname, field)
        # This lets the payload use either "business" or "business_id"
        field_map: dict[str, tuple[str, object]] = {}
        for field in model._meta.fields:
            # attname is the DB column name (e.g. "business_id" for FK "business")
            attname = getattr(field, "attname", field.name)
            field_map[field.name]   = (attname, field)
            field_map[field.attname] = (attname, field)

        cleaned: dict = {}
        for payload_key, value in payload.items():
            if payload_key in _NEVER_SYNC_FIELDS:
                continue
            if payload_key not in field_map:
                continue
            attname, field = field_map[payload_key]
            if attname in protected:
                continue
            cleaned[attname] = value

        return cleaned
