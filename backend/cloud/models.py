"""
cloud/models.py
===============
POPMYC POS — Cloud Foundation models (Stage 6.2A).

Architecture
------------
This module provides the cloud/PWA multi-user foundation WITHOUT replacing
or duplicating any existing model.

Relationship to existing models:
  CustomUser       ← extended via CloudProfile (OneToOne)
  Business         ← extended via CloudBusinessProfile (OneToOne)
  Branch           ← referenced via UserBranchAccess (FK, no field changes)
  SyncDevice       ← separate concern (local offline sync); NOT replaced or
                     extended here.  CloudDevice covers authenticated cloud
                     devices only.

New models:
  CloudProfile         — per-user cloud/PWA settings (extends CustomUser)
  CloudBusinessProfile — per-business cloud lifecycle state (extends Business)
  BusinessMembership   — user ↔ business relationship with role + PWA access
  UserBranchAccess     — branch-level access scoping for a membership
  CloudDevice          — cloud-registered device (POS, mobile, web)
  CloudAuditLog        — immutable audit trail for cloud management events

Offline-first guarantee:
  None of these models are required for local POS operation.
  No existing middleware reads from them.
  The desktop POS continues working with no internet connection.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone
from django.utils.translation import gettext_lazy as _


# ── Helper ─────────────────────────────────────────────────────────────────────

def _generate_device_token() -> str:
    """Generate a 48-char URL-safe device token."""
    return secrets.token_urlsafe(36)  # 36 bytes → 48 char base64url


def _hash_token(raw_token: str) -> str:
    """One-way SHA-256 hash of a device token for safe DB storage."""
    return hashlib.sha256(raw_token.encode()).hexdigest()


# ══════════════════════════════════════════════════════════════════════════════
# CloudProfile — per-user cloud/PWA extension
# ══════════════════════════════════════════════════════════════════════════════

class CloudProfile(models.Model):
    """
    Extends CustomUser with cloud and PWA-specific attributes.

    One row per CustomUser, created on demand (not at user creation) so
    that existing POS users without cloud access are unaffected.

    PWA access is controlled at two levels:
      1. CloudProfile.pwa_access_enabled  — the user's global PWA gate
      2. BusinessMembership.pwa_access    — per-business PWA access

    Both must be True for a user to access a business via the PWA.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="cloud_profile",
        verbose_name=_("User"),
    )

    # ── PWA / Cloud access ────────────────────────────────────────────────────
    pwa_access_enabled = models.BooleanField(
        default=False,
        verbose_name=_("PWA Access Enabled"),
        help_text=_(
            "Global gate for PWA access. Must also have an active "
            "BusinessMembership with pwa_access=True."
        ),
    )

    # ── Verification ──────────────────────────────────────────────────────────
    email_verified = models.BooleanField(
        default=False,
        verbose_name=_("Email Verified"),
    )
    phone_verified = models.BooleanField(
        default=False,
        verbose_name=_("Phone Verified"),
    )

    # ── Activity tracking ─────────────────────────────────────────────────────
    last_cloud_activity = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name=_("Last Cloud Activity"),
    )

    # ── Cloud account status ──────────────────────────────────────────────────
    class AccountStatus(models.TextChoices):
        ACTIVE    = "ACTIVE",    _("Active")
        SUSPENDED = "SUSPENDED", _("Suspended")
        PENDING   = "PENDING",   _("Pending Verification")

    account_status = models.CharField(
        max_length=20,
        choices=AccountStatus.choices,
        default=AccountStatus.ACTIVE,
        verbose_name=_("Cloud Account Status"),
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "cloud_profile"
        verbose_name = _("Cloud Profile")
        verbose_name_plural = _("Cloud Profiles")

    def __str__(self) -> str:
        return f"CloudProfile({self.user.username})"

    def touch(self) -> None:
        """Update last_cloud_activity to now."""
        self.last_cloud_activity = timezone.now()
        self.save(update_fields=["last_cloud_activity", "updated_at"])

    @classmethod
    def get_or_create_for(cls, user) -> "CloudProfile":
        """Retrieve or create the cloud profile for a user."""
        profile, _ = cls.objects.get_or_create(user=user)
        return profile


# ══════════════════════════════════════════════════════════════════════════════
# CloudBusinessProfile — per-business cloud lifecycle extension
# ══════════════════════════════════════════════════════════════════════════════

class CloudBusinessProfile(models.Model):
    """
    Extends the existing Business model with cloud-specific lifecycle state.

    cloud_status drives cloud-side availability (PWA access, device sync, etc.)
    but has NO effect on local POS operation — the desktop POS reads only
    Business.is_active, not this model.

    cloud_uid is intentionally the same UUID as Business.id so there is a
    single stable global identifier for every business — no secondary key needed.
    """

    class CloudStatus(models.TextChoices):
        PENDING   = "PENDING",   _("Pending Setup")
        ACTIVE    = "ACTIVE",    _("Active")
        SUSPENDED = "SUSPENDED", _("Suspended")
        CLOSED    = "CLOSED",    _("Closed")

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    business = models.OneToOneField(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="cloud_profile",
        verbose_name=_("Business"),
    )

    # cloud_uid mirrors Business.id — stable across environments/sync
    cloud_uid = models.UUIDField(
        unique=True,
        editable=False,
        verbose_name=_("Cloud UID"),
        help_text=_("Stable cloud identifier — same value as Business.id."),
    )

    cloud_status = models.CharField(
        max_length=20,
        choices=CloudStatus.choices,
        default=CloudStatus.PENDING,
        verbose_name=_("Cloud Status"),
    )

    cloud_registered_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name=_("Cloud Registered At"),
    )

    # ── PWA module access flags (what modules this business unlocks in PWA) ───
    # Stored as a JSON dict so future stages can toggle modules without migrations.
    # Example: {"dashboard": true, "reports": true, "staff": false}
    pwa_modules = models.JSONField(
        default=dict,
        blank=True,
        verbose_name=_("PWA Modules"),
        help_text=_(
            "Dict of module keys → bool.  Controls which PWA modules are "
            "available for this business's subscription tier."
        ),
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "cloud_business_profile"
        verbose_name = _("Cloud Business Profile")
        verbose_name_plural = _("Cloud Business Profiles")

    def __str__(self) -> str:
        return f"CloudBiz({self.business.name} — {self.cloud_status})"

    def save(self, *args, **kwargs):
        # Mirror business.id into cloud_uid on first save
        if not self.cloud_uid:
            self.cloud_uid = self.business_id
        super().save(*args, **kwargs)

    @property
    def is_cloud_active(self) -> bool:
        return self.cloud_status == self.CloudStatus.ACTIVE

    @classmethod
    def get_or_create_for(cls, business) -> "CloudBusinessProfile":
        profile, created = cls.objects.get_or_create(
            business=business,
            defaults={"cloud_uid": business.id},
        )
        return profile


# ══════════════════════════════════════════════════════════════════════════════
# BusinessMembership — user ↔ business relationship
# ══════════════════════════════════════════════════════════════════════════════

class BusinessMembership(models.Model):
    """
    The central access-control object for the cloud/PWA.

    Every cloud action is validated against the requesting user's
    BusinessMembership for the target business.

    Role hierarchy:
      OWNER > SUPER_ADMIN > ADMIN > MANAGER > CASHIER / INVENTORY_CLERK

    Role names deliberately mirror the serializer alias_map in accounts/serializers.py
    so cloud roles align with existing POS roles.

    branch_access_all=True  → the member can access ALL branches of this business.
    branch_access_all=False → access is limited to UserBranchAccess rows.
    """

    class RoleLabel(models.TextChoices):
        OWNER           = "OWNER",           _("Owner")
        SUPER_ADMIN     = "SUPER_ADMIN",     _("Super Admin")
        ADMIN           = "ADMIN",           _("Admin")
        MANAGER         = "MANAGER",         _("Manager")
        CASHIER         = "CASHIER",         _("Cashier")
        INVENTORY_CLERK = "INVENTORY_CLERK", _("Inventory Clerk")

    class MemberStatus(models.TextChoices):
        ACTIVE    = "ACTIVE",    _("Active")
        SUSPENDED = "SUSPENDED", _("Suspended")
        REMOVED   = "REMOVED",   _("Removed")
        INVITED   = "INVITED",   _("Invited")

    # Role → minimum level index for quick comparison
    ROLE_LEVEL = {
        RoleLabel.OWNER:           5,
        RoleLabel.SUPER_ADMIN:     4,
        RoleLabel.ADMIN:           3,
        RoleLabel.MANAGER:         2,
        RoleLabel.CASHIER:         1,
        RoleLabel.INVENTORY_CLERK: 1,
    }

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="cloud_memberships",
        verbose_name=_("User"),
    )

    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="cloud_memberships",
        verbose_name=_("Business"),
    )

    role_label = models.CharField(
        max_length=20,
        choices=RoleLabel.choices,
        default=RoleLabel.CASHIER,
        verbose_name=_("Role"),
    )

    status = models.CharField(
        max_length=20,
        choices=MemberStatus.choices,
        default=MemberStatus.ACTIVE,
        verbose_name=_("Status"),
    )

    # PWA access for this specific business membership
    pwa_access = models.BooleanField(
        default=False,
        verbose_name=_("PWA Access"),
        help_text=_(
            "Allows this user to access this business via the PWA. "
            "The user's CloudProfile.pwa_access_enabled must also be True."
        ),
    )

    # Branch scoping
    branch_access_all = models.BooleanField(
        default=True,
        verbose_name=_("All Branch Access"),
        help_text=_(
            "True → access all branches of this business. "
            "False → limited to UserBranchAccess records."
        ),
    )

    # Timestamps and activity
    joined_at = models.DateTimeField(
        auto_now_add=True,
        verbose_name=_("Joined At"),
    )
    last_activity = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name=_("Last Activity"),
    )

    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cloud_invitations_sent",
        verbose_name=_("Invited By"),
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "cloud_business_membership"
        verbose_name = _("Business Membership")
        verbose_name_plural = _("Business Memberships")
        unique_together = ("user", "business")
        indexes = [
            models.Index(fields=["business", "status"]),
            models.Index(fields=["user", "status"]),
        ]

    def __str__(self) -> str:
        return f"{self.user.username} @ {self.business.name} [{self.role_label}]"

    # ── Helpers ───────────────────────────────────────────────────────────────

    @property
    def is_active(self) -> bool:
        return self.status == self.MemberStatus.ACTIVE

    @property
    def can_access_pwa(self) -> bool:
        """Full PWA access check — both user and membership gates must be open."""
        if not self.is_active:
            return False
        if not self.pwa_access:
            return False
        try:
            return self.user.cloud_profile.pwa_access_enabled
        except CloudProfile.DoesNotExist:
            return False

    @property
    def role_level(self) -> int:
        return self.ROLE_LEVEL.get(self.role_label, 0)

    def has_min_role(self, min_role: str) -> bool:
        """True if this membership's role is >= min_role in the hierarchy."""
        return self.role_level >= self.ROLE_LEVEL.get(min_role, 0)

    def touch(self) -> None:
        self.last_activity = timezone.now()
        self.save(update_fields=["last_activity", "updated_at"])

    def can_access_branch(self, branch_id) -> bool:
        """Check whether this membership grants access to a specific branch."""
        if self.branch_access_all:
            return True
        return self.branch_accesses.filter(
            branch_id=branch_id,
            is_active=True,
        ).exists()


# ══════════════════════════════════════════════════════════════════════════════
# UserBranchAccess — branch-level scoping for a membership
# ══════════════════════════════════════════════════════════════════════════════

class UserBranchAccess(models.Model):
    """
    Grants a specific BusinessMembership access to a specific Branch.

    Only consulted when membership.branch_access_all = False.
    When branch_access_all = True this table is ignored.

    Security: every cloud view that returns branch-scoped data must call
    membership.can_access_branch(branch_id) before responding.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    membership = models.ForeignKey(
        BusinessMembership,
        on_delete=models.CASCADE,
        related_name="branch_accesses",
        verbose_name=_("Membership"),
    )

    branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.CASCADE,
        related_name="cloud_access_grants",
        verbose_name=_("Branch"),
    )

    is_active = models.BooleanField(default=True)

    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        verbose_name=_("Granted By"),
    )

    granted_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "cloud_user_branch_access"
        verbose_name = _("User Branch Access")
        verbose_name_plural = _("User Branch Accesses")
        unique_together = ("membership", "branch")

    def __str__(self) -> str:
        return (
            f"{self.membership.user.username} → "
            f"{self.branch.name} [{self.membership.business.name}]"
        )


# ══════════════════════════════════════════════════════════════════════════════
# CloudDevice — cloud-authenticated device registration
# ══════════════════════════════════════════════════════════════════════════════

class CloudDevice(models.Model):
    """
    Represents a device registered to use the cloud API / PWA.

    Distinct from synchronization.SyncDevice which tracks local offline sync.
    CloudDevice handles authenticated cloud sessions for POS terminals,
    mobile devices, and PWA browser sessions.

    Security:
      - Raw token is NEVER stored. Only token_hash (SHA-256) is persisted.
      - The caller receives the raw token exactly once at registration time.
      - A compromised device can be revoked by setting status=REVOKED.
      - device_uuid is a stable per-device UUID generated by the device itself
        (or by this server on first registration).

    Authentication flow (future):
      POST /api/v1/cloud/devices/register/
        → returns {device_uuid, token}  (token shown once)
      Subsequent requests include Device-Token header
        → server hashes + compares against token_hash
    """

    class DeviceType(models.TextChoices):
        POS_TERMINAL = "POS_TERMINAL", _("POS Terminal")
        MOBILE       = "MOBILE",       _("Mobile Device")
        WEB          = "WEB",          _("Web / PWA Browser")
        DESKTOP_APP  = "DESKTOP_APP",  _("Desktop App")
        OTHER        = "OTHER",        _("Other")

    class DeviceStatus(models.TextChoices):
        ACTIVE    = "ACTIVE",    _("Active")
        SUSPENDED = "SUSPENDED", _("Suspended")
        REVOKED   = "REVOKED",   _("Revoked")

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Stable per-device identifier (supplied by client or generated here)
    device_uuid = models.UUIDField(
        unique=True,
        default=uuid.uuid4,
        verbose_name=_("Device UUID"),
        help_text=_("Stable UUID identifying this device across sessions."),
    )

    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="cloud_devices",
        verbose_name=_("Business"),
    )

    membership = models.ForeignKey(
        BusinessMembership,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cloud_devices",
        verbose_name=_("Membership"),
        help_text=_("The business membership that registered this device."),
    )

    name = models.CharField(
        max_length=150,
        blank=True,
        verbose_name=_("Device Name"),
    )

    device_type = models.CharField(
        max_length=20,
        choices=DeviceType.choices,
        default=DeviceType.POS_TERMINAL,
        verbose_name=_("Device Type"),
    )

    status = models.CharField(
        max_length=20,
        choices=DeviceStatus.choices,
        default=DeviceStatus.ACTIVE,
        verbose_name=_("Status"),
    )

    # ── Authentication token (hashed) ─────────────────────────────────────────
    token_hash = models.CharField(
        max_length=64,
        blank=True,
        verbose_name=_("Token Hash"),
        help_text=_("SHA-256 hash of the device token. Raw token is never stored."),
    )

    # ── Device metadata ───────────────────────────────────────────────────────
    app_version = models.CharField(
        max_length=50,
        blank=True,
        verbose_name=_("App Version"),
    )

    os_info = models.CharField(
        max_length=150,
        blank=True,
        verbose_name=_("OS Info"),
        help_text=_("e.g. Windows 11, Android 14, iOS 17 — customer-supplied, not verified."),
    )

    last_seen = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name=_("Last Seen"),
    )

    first_registered = models.DateTimeField(auto_now_add=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    revoked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        verbose_name=_("Revoked By"),
    )

    revoked_at = models.DateTimeField(null=True, blank=True)

    # ── Stage 6.2C preparation: optional link to the local SyncDevice ─────────
    # When a POS terminal registers both a CloudDevice (cloud auth) and a
    # SyncDevice (local offline sync), this FK lets Stage 6.2C correlate
    # cloud requests with their offline sync queues.
    # null=True — not required; existing devices and cloud-only devices work fine.
    sync_device = models.ForeignKey(
        "synchronization.SyncDevice",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cloud_devices",
        verbose_name=_("Sync Device"),
        help_text=_(
            "Optional link to the corresponding SyncDevice for offline sync. "
            "Populated by Stage 6.2C sync registration."
        ),
    )

    class Meta:
        db_table = "cloud_device"
        verbose_name = _("Cloud Device")
        verbose_name_plural = _("Cloud Devices")
        indexes = [
            models.Index(fields=["business", "status"]),
            models.Index(fields=["device_uuid"]),
        ]

    def __str__(self) -> str:
        return f"{self.name or str(self.device_uuid)} ({self.business.name})"

    # ── Token helpers ─────────────────────────────────────────────────────────

    def set_token(self, raw_token: str) -> None:
        """Hash and store a raw token. Call save() after."""
        self.token_hash = _hash_token(raw_token)

    def verify_token(self, raw_token: str) -> bool:
        """Return True if raw_token matches the stored hash."""
        if not self.token_hash:
            return False
        return secrets.compare_digest(
            self.token_hash,
            _hash_token(raw_token),
        )

    @classmethod
    def generate_token(cls) -> str:
        """Generate a fresh raw device token (call once at registration)."""
        return _generate_device_token()

    def revoke(self, revoked_by=None) -> None:
        """Revoke this device. Clears the token hash."""
        self.status = self.DeviceStatus.REVOKED
        self.token_hash = ""
        self.revoked_by = revoked_by
        self.revoked_at = timezone.now()
        self.save(update_fields=[
            "status", "token_hash", "revoked_by", "revoked_at", "updated_at",
        ])

    def touch(self) -> None:
        self.last_seen = timezone.now()
        self.save(update_fields=["last_seen", "updated_at"])


# ══════════════════════════════════════════════════════════════════════════════
# CloudAuditLog — immutable audit trail
# ══════════════════════════════════════════════════════════════════════════════

class CloudAuditLog(models.Model):
    """
    Append-only audit log for cloud management actions.

    Every significant management event that modifies access, roles,
    devices, or business status must create an entry here.

    Security rules:
      - NEVER log passwords, JWT secrets, activation codes, or payment data.
      - metadata stores only safe supplementary info (role names, IDs, etc.)
      - actor may be null for system-generated events.
    """

    class Action(models.TextChoices):
        # Membership events
        MEMBER_ADDED             = "MEMBER_ADDED",             _("Member Added")
        MEMBER_REMOVED           = "MEMBER_REMOVED",           _("Member Removed")
        MEMBER_SUSPENDED         = "MEMBER_SUSPENDED",         _("Member Suspended")
        MEMBER_REACTIVATED       = "MEMBER_REACTIVATED",       _("Member Reactivated")
        ROLE_CHANGED             = "ROLE_CHANGED",             _("Role Changed")
        # PWA access events
        PWA_ENABLED              = "PWA_ENABLED",              _("PWA Access Enabled")
        PWA_DISABLED             = "PWA_DISABLED",             _("PWA Access Disabled")
        # Branch access events
        BRANCH_ACCESS_GRANTED    = "BRANCH_ACCESS_GRANTED",    _("Branch Access Granted")
        BRANCH_ACCESS_REVOKED    = "BRANCH_ACCESS_REVOKED",    _("Branch Access Revoked")
        BRANCH_ACCESS_ALL_SET    = "BRANCH_ACCESS_ALL_SET",    _("All-Branch Access Set")
        # Device events
        DEVICE_REGISTERED        = "DEVICE_REGISTERED",        _("Device Registered")
        DEVICE_SUSPENDED         = "DEVICE_SUSPENDED",         _("Device Suspended")
        DEVICE_REVOKED           = "DEVICE_REVOKED",           _("Device Revoked")
        DEVICE_REACTIVATED       = "DEVICE_REACTIVATED",       _("Device Reactivated")
        DEVICE_AUTH_FAILED       = "DEVICE_AUTH_FAILED",       _("Device Auth Failed")
        DEVICE_HEARTBEAT         = "DEVICE_HEARTBEAT",         _("Device Heartbeat")
        # Business cloud status events
        BUSINESS_CLOUD_ACTIVATED  = "BUSINESS_CLOUD_ACTIVATED", _("Business Cloud Activated")
        BUSINESS_CLOUD_SUSPENDED  = "BUSINESS_CLOUD_SUSPENDED", _("Business Cloud Suspended")
        BUSINESS_CLOUD_CLOSED     = "BUSINESS_CLOUD_CLOSED",    _("Business Cloud Closed")
        # License events
        LICENSE_VERIFIED_OK      = "LICENSE_VERIFIED_OK",      _("License Verified OK")
        LICENSE_VERIFIED_FAIL    = "LICENSE_VERIFIED_FAIL",    _("License Verification Failed")
        # Access events
        CLOUD_ACCESS_DENIED      = "CLOUD_ACCESS_DENIED",      _("Cloud Access Denied")
        # User cloud account events
        USER_CLOUD_ENABLED       = "USER_CLOUD_ENABLED",       _("User Cloud Account Enabled")
        USER_CLOUD_SUSPENDED     = "USER_CLOUD_SUSPENDED",     _("User Cloud Account Suspended")
        # Synchronization events (Stage 6.2C)
        SYNC_UPLOAD_OK           = "SYNC_UPLOAD_OK",           _("Sync Upload Accepted")
        SYNC_UPLOAD_FAIL         = "SYNC_UPLOAD_FAIL",         _("Sync Upload Failed")
        SYNC_DOWNLOAD            = "SYNC_DOWNLOAD",            _("Sync Download")
        SYNC_CONFLICT            = "SYNC_CONFLICT",            _("Sync Conflict Detected")
        SYNC_RECOVERY            = "SYNC_RECOVERY",            _("Sync Recovery: SYNCING→PENDING")

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # The business this event relates to (null for system-level events)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cloud_audit_logs",
        verbose_name=_("Business"),
    )

    # Who performed the action (null = system/automated)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cloud_audit_actions",
        verbose_name=_("Actor"),
    )

    action = models.CharField(
        max_length=40,
        choices=Action.choices,
        verbose_name=_("Action"),
        db_index=True,
    )

    # Affected user (may be the same as actor for self-service actions)
    target_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cloud_audit_events",
        verbose_name=_("Target User"),
    )

    # Safe supplementary data — no secrets, no passwords
    metadata = models.JSONField(
        default=dict,
        blank=True,
        verbose_name=_("Metadata"),
        help_text=_(
            "Safe supplementary data (role names, branch names, device IDs, etc.). "
            "Never store passwords, tokens, or activation codes here."
        ),
    )

    ip_address = models.GenericIPAddressField(
        null=True,
        blank=True,
        verbose_name=_("IP Address"),
    )

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "cloud_audit_log"
        verbose_name = _("Cloud Audit Log")
        verbose_name_plural = _("Cloud Audit Logs")
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["business", "created_at"]),
            models.Index(fields=["actor", "created_at"]),
            models.Index(fields=["action", "created_at"]),
        ]

    def __str__(self) -> str:
        actor_name = self.actor.username if self.actor else "system"
        return f"{actor_name} → {self.action} [{self.created_at:%Y-%m-%d %H:%M}]"

    # ── Factory ───────────────────────────────────────────────────────────────

    @classmethod
    def log(
        cls,
        action: str,
        actor=None,
        business=None,
        target_user=None,
        metadata: dict | None = None,
        ip_address: str | None = None,
    ) -> "CloudAuditLog":
        """
        Convenience factory.  Call this instead of CloudAuditLog.objects.create()
        to ensure the no-secrets contract is enforced in one place.

        Usage:
            CloudAuditLog.log(
                action=CloudAuditLog.Action.MEMBER_ADDED,
                actor=request.user,
                business=business,
                target_user=new_member,
                metadata={"role": "CASHIER"},
                ip_address=get_client_ip(request),
            )
        """
        return cls.objects.create(
            action=action,
            actor=actor,
            business=business,
            target_user=target_user,
            metadata=metadata or {},
            ip_address=ip_address,
        )

# ══════════════════════════════════════════════════════════════════════════════
# ActivationReservation — short-lived cloud trial activation token
# ══════════════════════════════════════════════════════════════════════════════

RESERVATION_EXPIRY_MINUTES = 10


class ActivationReservation(models.Model):
    """
    Short-lived reservation created during Phase 1 of the two-phase
    cloud TrialCode activation handshake.

    Lifecycle
    ---------
    1.  Desktop calls POST /api/v1/cloud/trial/validate/
        → Cloud verifies TrialCode is PENDING
        → Cloud creates ActivationReservation (status=PENDING, expires in 10 min)
        → Cloud returns reservation_token to the desktop (raw, shown ONCE)

    2.  Desktop sends reservation_token + setup payload to the local
        POST /api/v1/setup/run/
        → Local SetupRunView contacts the cloud to confirm the reservation
          is still valid (Phase 1.5 — inline verify call)
        → Local creates Business, Branch, Admin, TRIAL License
        → Only AFTER local commit, desktop calls
          POST /api/v1/cloud/trial/complete/

    3.  Cloud atomically marks TrialCode as USED and reservation as COMPLETED.

    Security properties
    -------------------
    - Raw token is never stored.  Only the SHA-256 hash is persisted.
    - Token is URL-safe base64, 48 chars (36 random bytes).
    - Reservation expires after RESERVATION_EXPIRY_MINUTES from creation.
    - A completed or expired reservation cannot be reused.
    - trial_code_id is a FK (not the raw code string) — never exposed to client.
    - No cloud DB credentials, SECRET_KEY, or Django internals are returned.

    Offline safety
    --------------
    This model lives only in the cloud (Supabase) database.
    The local POS database never has this table.
    Local POS operation does not read or write this model.
    """

    class ReservationStatus(models.TextChoices):
        PENDING   = "PENDING",   _("Pending — awaiting completion")
        COMPLETED = "COMPLETED", _("Completed — TrialCode consumed")
        EXPIRED   = "EXPIRED",   _("Expired — timed out before completion")
        CANCELLED = "CANCELLED", _("Cancelled — abandoned")

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # FK to the TrialCode being reserved.  We store the ID, not the raw code.
    trial_code = models.ForeignKey(
        "licensing.TrialCode",
        on_delete=models.CASCADE,
        related_name="reservations",
        verbose_name=_("Trial Code"),
        help_text=_("The TrialCode voucher that this reservation holds."),
    )

    # SHA-256 hash of the raw reservation token (raw token shown ONCE on creation).
    token_hash = models.CharField(
        max_length=64,
        unique=True,
        verbose_name=_("Token Hash"),
        help_text=_("SHA-256 of the raw one-time reservation token."),
    )

    status = models.CharField(
        max_length=20,
        choices=ReservationStatus.choices,
        default=ReservationStatus.PENDING,
        verbose_name=_("Status"),
        db_index=True,
    )

    expires_at = models.DateTimeField(
        verbose_name=_("Expires At"),
        help_text=_("Reservation is invalid after this timestamp."),
        db_index=True,
    )

    # Audit metadata — never contains secrets
    ip_address = models.GenericIPAddressField(
        null=True,
        blank=True,
        verbose_name=_("Client IP"),
    )

    # Populated when status→COMPLETED
    completed_at = models.DateTimeField(null=True, blank=True, verbose_name=_("Completed At"))

    created_at = models.DateTimeField(auto_now_add=True, verbose_name=_("Created At"))
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "cloud_activation_reservation"
        verbose_name = _("Activation Reservation")
        verbose_name_plural = _("Activation Reservations")
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "expires_at"]),
        ]

    def __str__(self) -> str:
        return f"Reservation({self.trial_code.code[:8]}… [{self.status}] exp={self.expires_at:%Y-%m-%d %H:%M})"

    # ── Class helpers ──────────────────────────────────────────────────────────

    @classmethod
    def make_token(cls) -> str:
        """
        Generate a fresh URL-safe reservation token (48 chars, 36 random bytes).
        Returns the raw token — caller must store only the hash.
        """
        return secrets.token_urlsafe(36)

    @classmethod
    def hash_token(cls, raw_token: str) -> str:
        """Return the SHA-256 hex digest of a raw token."""
        return hashlib.sha256(raw_token.encode()).hexdigest()

    @classmethod
    def create_for(
        cls,
        trial_code,
        ip_address: str | None = None,
    ) -> tuple["ActivationReservation", str]:
        """
        Create a new PENDING reservation for the given TrialCode.

        Returns (reservation, raw_token).
        The raw_token must be returned to the caller and NEVER stored anywhere.

        The trial_code's other PENDING reservations are not cancelled here —
        expired ones are silently ignored.  Only one reservation can be
        COMPLETED per trial_code (enforced by TrialCode.status = USED).
        """
        raw_token = secrets.token_urlsafe(36)
        reservation = cls.objects.create(
            trial_code=trial_code,
            token_hash=cls.hash_token(raw_token),
            status=cls.ReservationStatus.PENDING,
            expires_at=timezone.now() + timezone.timedelta(
                minutes=RESERVATION_EXPIRY_MINUTES
            ),
            ip_address=ip_address,
        )
        return reservation, raw_token

    @classmethod
    def get_valid_by_token(cls, raw_token: str) -> "ActivationReservation | None":
        """
        Look up a PENDING, non-expired reservation by raw token.
        Returns None if the token is unknown, expired, or already used.
        """
        token_hash = cls.hash_token(raw_token)
        try:
            res = cls.objects.select_related("trial_code").get(
                token_hash=token_hash,
                status=cls.ReservationStatus.PENDING,
            )
        except cls.DoesNotExist:
            return None

        if timezone.now() > res.expires_at:
            # Auto-mark as expired (best-effort; non-atomic is fine here)
            cls.objects.filter(pk=res.pk).update(
                status=cls.ReservationStatus.EXPIRED
            )
            return None

        return res

    # ── Instance helpers ───────────────────────────────────────────────────────

    @property
    def is_valid(self) -> bool:
        """True if this reservation is PENDING and has not yet expired."""
        return (
            self.status == self.ReservationStatus.PENDING
            and timezone.now() <= self.expires_at
        )

    def complete(self) -> None:
        """
        Mark the reservation as COMPLETED and stamp completed_at.
        Caller is responsible for also marking the TrialCode as USED
        within the same atomic block.
        """
        self.status = self.ReservationStatus.COMPLETED
        self.completed_at = timezone.now()
        self.save(update_fields=["status", "completed_at", "updated_at"])
