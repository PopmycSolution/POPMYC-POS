"""
cloud/serializers.py
====================
Explicit response schemas for every cloud endpoint.

Design rules:
  - Every serializer lists fields explicitly (no Meta.fields = "__all__")
  - Read-only computed fields are clearly marked
  - Write serializers are separate from read serializers where schemas differ
  - No passwords, token hashes, or activation codes are ever returned
"""

from rest_framework import serializers
from django.contrib.auth import get_user_model

from .models import (
    CloudProfile,
    CloudBusinessProfile,
    BusinessMembership,
    UserBranchAccess,
    CloudDevice,
    CloudAuditLog,
)

User = get_user_model()


# ── Shared minimal user representation ────────────────────────────────────────

class CloudUserSummarySerializer(serializers.ModelSerializer):
    """Minimal safe user representation used inside other serializers."""
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "email", "phone_number", "full_name", "is_active"]
        read_only_fields = fields

    def get_full_name(self, obj) -> str:
        name = f"{obj.first_name} {obj.last_name}".strip()
        return name or obj.username


# ══════════════════════════════════════════════════════════════════════════════
# CloudProfile serializers
# ══════════════════════════════════════════════════════════════════════════════

class CloudProfileSerializer(serializers.ModelSerializer):
    """Read representation of a user's cloud profile."""
    user = CloudUserSummarySerializer(read_only=True)
    can_access_pwa = serializers.SerializerMethodField()

    class Meta:
        model = CloudProfile
        fields = [
            "id",
            "user",
            "pwa_access_enabled",
            "email_verified",
            "phone_verified",
            "account_status",
            "last_cloud_activity",
            "can_access_pwa",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id", "user", "email_verified", "phone_verified",
            "last_cloud_activity", "can_access_pwa", "created_at", "updated_at",
        ]

    def get_can_access_pwa(self, obj) -> bool:
        return obj.pwa_access_enabled and obj.account_status == CloudProfile.AccountStatus.ACTIVE


class CloudProfileUpdateSerializer(serializers.ModelSerializer):
    """Allow users to update their own cloud profile settings."""
    class Meta:
        model = CloudProfile
        fields = ["pwa_access_enabled", "account_status"]
        # account_status is admin-only; handled in view logic


# ══════════════════════════════════════════════════════════════════════════════
# CloudBusinessProfile serializers
# ══════════════════════════════════════════════════════════════════════════════

class CloudBusinessProfileSerializer(serializers.ModelSerializer):
    """Read representation of a business's cloud profile."""
    business_name = serializers.CharField(source="business.name", read_only=True)
    business_id   = serializers.UUIDField(source="business.id", read_only=True)
    is_cloud_active = serializers.BooleanField(read_only=True)

    class Meta:
        model = CloudBusinessProfile
        fields = [
            "id",
            "business_id",
            "business_name",
            "cloud_uid",
            "cloud_status",
            "cloud_registered_at",
            "pwa_modules",
            "is_cloud_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id", "business_id", "business_name", "cloud_uid",
            "cloud_registered_at", "is_cloud_active", "created_at", "updated_at",
        ]


class CloudBusinessProfileUpdateSerializer(serializers.ModelSerializer):
    """Admin-only: update cloud status or PWA modules."""
    class Meta:
        model = CloudBusinessProfile
        fields = ["cloud_status", "pwa_modules"]


# ══════════════════════════════════════════════════════════════════════════════
# UserBranchAccess serializers
# ══════════════════════════════════════════════════════════════════════════════

class UserBranchAccessSerializer(serializers.ModelSerializer):
    branch_name    = serializers.CharField(source="branch.name", read_only=True)
    branch_code    = serializers.CharField(source="branch.code", read_only=True)
    granted_by_name = serializers.SerializerMethodField()

    class Meta:
        model = UserBranchAccess
        fields = [
            "id",
            "branch",
            "branch_name",
            "branch_code",
            "is_active",
            "granted_by",
            "granted_by_name",
            "granted_at",
        ]
        read_only_fields = ["id", "branch_name", "branch_code", "granted_by_name", "granted_at"]

    def get_granted_by_name(self, obj) -> str | None:
        if obj.granted_by:
            return obj.granted_by.username
        return None


class UserBranchAccessWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserBranchAccess
        fields = ["branch", "is_active"]


# ══════════════════════════════════════════════════════════════════════════════
# BusinessMembership serializers
# ══════════════════════════════════════════════════════════════════════════════

class BusinessMembershipSerializer(serializers.ModelSerializer):
    """Full membership read representation (for admins and owners)."""
    user        = CloudUserSummarySerializer(read_only=True)
    business_id = serializers.UUIDField(source="business.id", read_only=True)
    business_name = serializers.CharField(source="business.name", read_only=True)
    invited_by_name = serializers.SerializerMethodField()
    can_access_pwa  = serializers.BooleanField(read_only=True)
    branch_accesses = UserBranchAccessSerializer(many=True, read_only=True)

    class Meta:
        model = BusinessMembership
        fields = [
            "id",
            "user",
            "business_id",
            "business_name",
            "role_label",
            "status",
            "pwa_access",
            "branch_access_all",
            "can_access_pwa",
            "invited_by_name",
            "joined_at",
            "last_activity",
            "branch_accesses",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id", "user", "business_id", "business_name",
            "can_access_pwa", "invited_by_name",
            "joined_at", "last_activity", "branch_accesses",
            "created_at", "updated_at",
        ]

    def get_invited_by_name(self, obj) -> str | None:
        if obj.invited_by:
            return obj.invited_by.username
        return None


class BusinessMembershipSummarySerializer(serializers.ModelSerializer):
    """Lightweight membership view returned to the member themselves."""
    business_id   = serializers.UUIDField(source="business.id", read_only=True)
    business_name = serializers.CharField(source="business.name", read_only=True)
    business_currency = serializers.CharField(source="business.currency", read_only=True)
    can_access_pwa = serializers.BooleanField(read_only=True)

    class Meta:
        model = BusinessMembership
        fields = [
            "id",
            "business_id",
            "business_name",
            "business_currency",
            "role_label",
            "status",
            "pwa_access",
            "branch_access_all",
            "can_access_pwa",
            "joined_at",
        ]
        read_only_fields = fields


class BusinessMembershipCreateSerializer(serializers.ModelSerializer):
    """Used by admins/owners to add a new member."""
    user = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(is_active=True),
    )

    class Meta:
        model = BusinessMembership
        fields = [
            "user",
            "role_label",
            "pwa_access",
            "branch_access_all",
        ]

    def validate(self, attrs):
        business = self.context["business"]
        user     = attrs["user"]
        if BusinessMembership.objects.filter(user=user, business=business).exists():
            raise serializers.ValidationError(
                "This user already has a membership for this business."
            )
        return attrs


class BusinessMembershipUpdateSerializer(serializers.ModelSerializer):
    """Partial update: role, status, pwa_access, branch_access_all."""
    class Meta:
        model = BusinessMembership
        fields = ["role_label", "status", "pwa_access", "branch_access_all"]


# ══════════════════════════════════════════════════════════════════════════════
# CloudDevice serializers
# ══════════════════════════════════════════════════════════════════════════════

class CloudDeviceSerializer(serializers.ModelSerializer):
    """Read representation — NEVER includes token_hash."""
    business_name  = serializers.CharField(source="business.name", read_only=True)
    revoked_by_name = serializers.SerializerMethodField()

    class Meta:
        model = CloudDevice
        fields = [
            "id",
            "device_uuid",
            "business",
            "business_name",
            "membership",
            "name",
            "device_type",
            "status",
            "app_version",
            "os_info",
            "last_seen",
            "first_registered",
            "revoked_by_name",
            "revoked_at",
        ]
        read_only_fields = [
            "id", "device_uuid", "business_name", "last_seen",
            "first_registered", "revoked_by_name", "revoked_at",
        ]
        # token_hash is NEVER included — enforced here

    def get_revoked_by_name(self, obj) -> str | None:
        if obj.revoked_by:
            return obj.revoked_by.username
        return None


class CloudDeviceRegisterSerializer(serializers.Serializer):
    """
    Input for POST /api/v1/cloud/devices/register/

    The caller may supply an existing device_uuid (for re-registration)
    or omit it to get a server-assigned UUID.
    """
    device_uuid  = serializers.UUIDField(required=False, allow_null=True)
    name         = serializers.CharField(max_length=150, required=False, allow_blank=True)
    device_type  = serializers.ChoiceField(
        choices=CloudDevice.DeviceType.choices,
        default=CloudDevice.DeviceType.POS_TERMINAL,
    )
    app_version  = serializers.CharField(max_length=50, required=False, allow_blank=True)
    os_info      = serializers.CharField(max_length=150, required=False, allow_blank=True)


class CloudDeviceRegisterResponseSerializer(serializers.Serializer):
    """
    Response from POST /api/v1/cloud/devices/register/

    token is returned ONCE here and is NEVER stored in plaintext.
    The client must securely store this token.
    """
    device_uuid  = serializers.UUIDField()
    token        = serializers.CharField()   # raw token — shown once only
    name         = serializers.CharField()
    device_type  = serializers.CharField()
    status       = serializers.CharField()
    registered_at = serializers.DateTimeField()


class CloudDeviceUpdateSerializer(serializers.ModelSerializer):
    """Allow updating non-sensitive device metadata."""
    class Meta:
        model = CloudDevice
        fields = ["name", "app_version", "os_info"]


# ══════════════════════════════════════════════════════════════════════════════
# CloudAuditLog serializers
# ══════════════════════════════════════════════════════════════════════════════

class CloudAuditLogSerializer(serializers.ModelSerializer):
    actor_name      = serializers.SerializerMethodField()
    target_user_name = serializers.SerializerMethodField()
    business_name   = serializers.SerializerMethodField()

    class Meta:
        model = CloudAuditLog
        fields = [
            "id",
            "business",
            "business_name",
            "actor",
            "actor_name",
            "action",
            "target_user",
            "target_user_name",
            "metadata",
            "ip_address",
            "created_at",
        ]
        read_only_fields = fields

    def get_actor_name(self, obj) -> str | None:
        return obj.actor.username if obj.actor else None

    def get_target_user_name(self, obj) -> str | None:
        return obj.target_user.username if obj.target_user else None

    def get_business_name(self, obj) -> str | None:
        return obj.business.name if obj.business else None


# ══════════════════════════════════════════════════════════════════════════════
# PWA access context — returned on login / me endpoint
# ══════════════════════════════════════════════════════════════════════════════

class PWAAccessContextSerializer(serializers.Serializer):
    """
    Returned to the PWA after authentication to tell it:
      - which businesses this user can access
      - what role they have in each
      - which branches they can see

    This is the shape the future PWA will consume to build its navigation.
    """
    user_id            = serializers.UUIDField()
    username           = serializers.CharField()
    pwa_access_enabled = serializers.BooleanField()
    account_status     = serializers.CharField()
    businesses         = serializers.ListField(child=serializers.DictField())


class CloudStatusSerializer(serializers.Serializer):
    """
    Response for GET /api/v1/cloud/status/
    Used by clients to check their cloud connectivity and access state.
    """
    cloud_enabled      = serializers.BooleanField()
    user_id            = serializers.UUIDField()
    pwa_access_enabled = serializers.BooleanField()
    account_status     = serializers.CharField()
    business_count     = serializers.IntegerField()
    active_memberships = serializers.IntegerField()
    server_time        = serializers.DateTimeField()


# ══════════════════════════════════════════════════════════════════════════════
# Stage 6.2B — Heartbeat + License status serializers
# ══════════════════════════════════════════════════════════════════════════════

class HeartbeatRequestSerializer(serializers.Serializer):
    """
    Optional metadata a device may include in the heartbeat body.
    All fields are optional — a bare POST with no body is valid.
    """
    app_version = serializers.CharField(max_length=50,  required=False, allow_blank=True)
    os_info     = serializers.CharField(max_length=150, required=False, allow_blank=True)
    device_name = serializers.CharField(max_length=150, required=False, allow_blank=True)


class HeartbeatResponseSerializer(serializers.Serializer):
    """
    Response body for POST /api/v1/cloud/device/heartbeat/

    Tells the client whether its device and business license are still valid.
    Safe to call frequently — contains no secrets.
    """
    device_uuid     = serializers.UUIDField()
    device_status   = serializers.CharField()
    business_id     = serializers.UUIDField()
    business_name   = serializers.CharField()
    license_status  = serializers.DictField()   # LicenseStatus.as_dict()
    cloud_access_ok = serializers.BooleanField()
    server_time     = serializers.DateTimeField()


class CloudLicenseStatusSerializer(serializers.Serializer):
    """
    Response for GET /api/v1/cloud/business/<id>/license/

    Safe cloud-facing license state.  NEVER includes activation_code.
    """
    business_id     = serializers.UUIDField()
    business_name   = serializers.CharField()
    found           = serializers.BooleanField()
    is_active       = serializers.BooleanField()
    is_lifetime     = serializers.BooleanField()
    license_type    = serializers.CharField(allow_null=True)
    license_state   = serializers.CharField()
    expires_at      = serializers.DateField(allow_null=True)
    days_remaining  = serializers.IntegerField(allow_null=True)
    start_date      = serializers.DateField(allow_null=True)
    activated_at    = serializers.DateTimeField(allow_null=True)
    last_checked_at = serializers.DateTimeField()
