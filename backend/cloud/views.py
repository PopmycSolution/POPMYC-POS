"""
cloud/views.py
==============
Cloud foundation API views for POPMYC POS (Stage 6.2A + 6.2B).

Endpoint map:
  GET    /api/v1/cloud/status/                     → CloudStatusView
  GET    /api/v1/cloud/account/                    → CloudAccountView (own profile)
  PATCH  /api/v1/cloud/account/                    → CloudAccountView (update own)
  GET    /api/v1/cloud/account/businesses/         → MyBusinessesView
  GET    /api/v1/cloud/account/pwa-context/        → PWAContextView

  GET    /api/v1/cloud/business/<id>/              → CloudBusinessView
  PATCH  /api/v1/cloud/business/<id>/              → CloudBusinessView (admin-only)

  GET    /api/v1/cloud/business/<id>/members/      → MemberListView
  POST   /api/v1/cloud/business/<id>/members/      → MemberListView (admin-only)
  GET    /api/v1/cloud/business/<id>/members/<mid>/ → MemberDetailView
  PATCH  /api/v1/cloud/business/<id>/members/<mid>/ → MemberDetailView (admin-only)
  DELETE /api/v1/cloud/business/<id>/members/<mid>/ → MemberDetailView (admin-only)

  GET    /api/v1/cloud/business/<id>/members/<mid>/branches/ → MemberBranchView
  POST   /api/v1/cloud/business/<id>/members/<mid>/branches/ → MemberBranchView
  DELETE /api/v1/cloud/business/<id>/members/<mid>/branches/<bid>/ → MemberBranchDetailView

  GET    /api/v1/cloud/business/<id>/devices/      → DeviceListView
  POST   /api/v1/cloud/business/<id>/devices/register/ → DeviceRegisterView
  GET    /api/v1/cloud/business/<id>/devices/<did>/ → DeviceDetailView
  PATCH  /api/v1/cloud/business/<id>/devices/<did>/ → DeviceDetailView
  POST   /api/v1/cloud/business/<id>/devices/<did>/revoke/ → DeviceRevokeView

  GET    /api/v1/cloud/business/<id>/audit/        → AuditLogView
  GET    /api/v1/cloud/business/<id>/license/      → CloudLicenseStatusView (6.2B)

  POST   /api/v1/cloud/device/heartbeat/           → DeviceHeartbeatView (6.2B)

Every endpoint that touches a business first calls
_resolve_membership() which enforces business-level isolation.
"""

from __future__ import annotations

from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.throttling import UserRateThrottle, AnonRateThrottle

from .models import (
    CloudProfile,
    CloudBusinessProfile,
    BusinessMembership,
    UserBranchAccess,
    CloudDevice,
    CloudAuditLog,
)
from .permissions import (
    IsCloudAuthenticated,
    IsDeviceOrCloudAuthenticated,
    CloudBusinessMixin,
    get_client_ip,
    get_membership_or_403,
    require_min_role,
    require_active_license,
    verify_branch_access,
)
from .serializers import (
    CloudProfileSerializer,
    CloudProfileUpdateSerializer,
    CloudBusinessProfileSerializer,
    CloudBusinessProfileUpdateSerializer,
    BusinessMembershipSerializer,
    BusinessMembershipSummarySerializer,
    BusinessMembershipCreateSerializer,
    BusinessMembershipUpdateSerializer,
    UserBranchAccessSerializer,
    UserBranchAccessWriteSerializer,
    CloudDeviceSerializer,
    CloudDeviceRegisterSerializer,
    CloudDeviceRegisterResponseSerializer,
    CloudDeviceUpdateSerializer,
    CloudAuditLogSerializer,
    PWAAccessContextSerializer,
    CloudStatusSerializer,
    HeartbeatRequestSerializer,
    HeartbeatResponseSerializer,
    CloudLicenseStatusSerializer,
)
from .feature_flags import CloudEnabledMixin, CloudAPIView
from .authentication import DeviceTokenAuthentication, get_device_from_request
from .license_service import CloudLicenseService

# ── Throttle classes ───────────────────────────────────────────────────────────

class CloudUserThrottle(UserRateThrottle):
    rate = "120/min"


class CloudAnonThrottle(AnonRateThrottle):
    rate = "20/min"


CLOUD_THROTTLES = [CloudUserThrottle, CloudAnonThrottle]


# ══════════════════════════════════════════════════════════════════════════════
# Status
# ══════════════════════════════════════════════════════════════════════════════

class CloudStatusView(CloudAPIView):
    """
    GET /api/v1/cloud/status/
    Returns the current user's cloud access state.
    Useful for clients to check connectivity before loading the PWA.
    Returns 503 when CLOUD_ENABLED=False.
    """
    permission_classes = [IsCloudAuthenticated]
    throttle_classes   = CLOUD_THROTTLES

    def get(self, request):
        user = request.user
        profile = CloudProfile.get_or_create_for(user)
        profile.touch()

        memberships = BusinessMembership.objects.filter(
            user=user,
            status=BusinessMembership.MemberStatus.ACTIVE,
        )

        data = {
            "cloud_enabled":      True,
            "user_id":            user.id,
            "pwa_access_enabled": profile.pwa_access_enabled,
            "account_status":     profile.account_status,
            "business_count":     memberships.values("business").distinct().count(),
            "active_memberships": memberships.count(),
            "server_time":        timezone.now(),
        }
        return Response(CloudStatusSerializer(data).data)


# ══════════════════════════════════════════════════════════════════════════════
# Account
# ══════════════════════════════════════════════════════════════════════════════

class CloudAccountView(CloudAPIView):
    """
    GET  /api/v1/cloud/account/  → return own cloud profile
    PATCH /api/v1/cloud/account/ → update own pwa_access_enabled
    """
    permission_classes = [IsCloudAuthenticated]
    throttle_classes   = CLOUD_THROTTLES

    def get(self, request):
        profile = CloudProfile.get_or_create_for(request.user)
        return Response(CloudProfileSerializer(profile).data)

    def patch(self, request):
        profile    = CloudProfile.get_or_create_for(request.user)
        serializer = CloudProfileUpdateSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        # Only superusers can change account_status
        if "account_status" in serializer.validated_data and not request.user.is_superuser:
            serializer.validated_data.pop("account_status")

        serializer.save()
        return Response(CloudProfileSerializer(profile).data)


class MyBusinessesView(CloudAPIView):
    """
    GET /api/v1/cloud/account/businesses/
    Returns all active business memberships for the current user.
    This is what the PWA uses to present a business-picker on login.
    """
    permission_classes = [IsCloudAuthenticated]
    throttle_classes   = CLOUD_THROTTLES

    def get(self, request):
        memberships = (
            BusinessMembership.objects
            .filter(user=request.user, status=BusinessMembership.MemberStatus.ACTIVE)
            .select_related("business", "user")
            .prefetch_related("branch_accesses__branch")
            .order_by("business__name")
        )
        serializer = BusinessMembershipSummarySerializer(memberships, many=True)
        return Response(serializer.data)


class PWAContextView(CloudAPIView):
    """
    GET /api/v1/cloud/account/pwa-context/
    Returns the complete PWA access context: user identity, all businesses,
    roles, branch access, and pwa_modules.  The PWA consumes this on login
    to build role-aware navigation.
    """
    permission_classes = [IsCloudAuthenticated]
    throttle_classes   = CLOUD_THROTTLES

    def get(self, request):
        user    = request.user
        profile = CloudProfile.get_or_create_for(user)
        profile.touch()

        memberships = (
            BusinessMembership.objects
            .filter(user=user, status=BusinessMembership.MemberStatus.ACTIVE)
            .select_related("business")
            .prefetch_related("branch_accesses__branch")
        )

        businesses_data = []
        for m in memberships:
            # Accessible branches
            if m.branch_access_all:
                branches = [
                    {"id": str(b.id), "name": b.name, "code": b.code}
                    for b in m.business.branches.filter(is_active=True)
                ]
            else:
                branches = [
                    {"id": str(a.branch.id), "name": a.branch.name, "code": a.branch.code}
                    for a in m.branch_accesses.filter(is_active=True)
                ]

            # Cloud business profile / pwa_modules
            try:
                biz_profile = m.business.cloud_profile
                pwa_modules = biz_profile.pwa_modules
                cloud_status = biz_profile.cloud_status
            except CloudBusinessProfile.DoesNotExist:
                pwa_modules  = {}
                cloud_status = CloudBusinessProfile.CloudStatus.PENDING

            businesses_data.append({
                "business_id":    str(m.business.id),
                "business_name":  m.business.name,
                "currency":       m.business.currency,
                "currency_symbol": getattr(m.business, "currency_symbol", m.business.currency),
                "role":           m.role_label,
                "pwa_access":     m.pwa_access,
                "branch_access_all": m.branch_access_all,
                "branches":       branches,
                "pwa_modules":    pwa_modules,
                "cloud_status":   cloud_status,
            })

        data = {
            "user_id":            user.id,
            "username":           user.username,
            "pwa_access_enabled": profile.pwa_access_enabled,
            "account_status":     profile.account_status,
            "businesses":         businesses_data,
        }
        return Response(PWAAccessContextSerializer(data).data)


# ══════════════════════════════════════════════════════════════════════════════
# Business cloud profile
# ══════════════════════════════════════════════════════════════════════════════

class CloudBusinessView(CloudBusinessMixin, CloudAPIView):
    """
    GET   /api/v1/cloud/business/<business_id>/   → read cloud profile
    PATCH /api/v1/cloud/business/<business_id>/   → update (SUPER_ADMIN+ only)
    """
    permission_classes = [IsCloudAuthenticated]
    throttle_classes   = CLOUD_THROTTLES

    def get(self, request, business_id):
        self._resolve_membership(request, business_id)
        biz_profile = CloudBusinessProfile.get_or_create_for(self.cloud_business)
        return Response(CloudBusinessProfileSerializer(biz_profile).data)

    def patch(self, request, business_id):
        self._resolve_membership(request, business_id)
        if self.membership:
            require_min_role(self.membership, BusinessMembership.RoleLabel.SUPER_ADMIN)

        biz_profile = CloudBusinessProfile.get_or_create_for(self.cloud_business)
        serializer  = CloudBusinessProfileUpdateSerializer(
            biz_profile, data=request.data, partial=True
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()

        CloudAuditLog.log(
            action=CloudAuditLog.Action.BUSINESS_CLOUD_ACTIVATED
            if serializer.validated_data.get("cloud_status") == CloudBusinessProfile.CloudStatus.ACTIVE
            else CloudAuditLog.Action.BUSINESS_CLOUD_SUSPENDED,
            actor=request.user,
            business=self.cloud_business,
            metadata=dict(serializer.validated_data),
            ip_address=get_client_ip(request),
        )
        return Response(CloudBusinessProfileSerializer(biz_profile).data)


# ══════════════════════════════════════════════════════════════════════════════
# Membership management
# ══════════════════════════════════════════════════════════════════════════════

class MemberListView(CloudBusinessMixin, CloudAPIView):
    """
    GET  /api/v1/cloud/business/<business_id>/members/  → list members
    POST /api/v1/cloud/business/<business_id>/members/  → add member (ADMIN+)
    """
    permission_classes = [IsCloudAuthenticated]
    throttle_classes   = CLOUD_THROTTLES

    def get(self, request, business_id):
        self._resolve_membership(request, business_id)

        # All roles may list members (for coordination), but only MANAGER+ see full detail
        qs = (
            BusinessMembership.objects
            .filter(business_id=business_id)
            .select_related("user", "business", "invited_by")
            .prefetch_related("branch_accesses__branch")
            .exclude(status=BusinessMembership.MemberStatus.REMOVED)
            .order_by("role_label", "joined_at")
        )
        return Response(BusinessMembershipSerializer(qs, many=True).data)

    def post(self, request, business_id):
        self._resolve_membership(request, business_id)
        if self.membership:
            require_min_role(self.membership, BusinessMembership.RoleLabel.ADMIN)

        serializer = BusinessMembershipCreateSerializer(
            data=request.data,
            context={"business": self.cloud_business},
        )
        serializer.is_valid(raise_exception=True)

        membership = serializer.save(
            business=self.cloud_business,
            invited_by=request.user,
        )

        # Ensure the new member has a cloud profile
        CloudProfile.get_or_create_for(membership.user)

        CloudAuditLog.log(
            action=CloudAuditLog.Action.MEMBER_ADDED,
            actor=request.user,
            business=self.cloud_business,
            target_user=membership.user,
            metadata={"role": membership.role_label},
            ip_address=get_client_ip(request),
        )
        return Response(
            BusinessMembershipSerializer(membership).data,
            status=status.HTTP_201_CREATED,
        )


class MemberDetailView(CloudBusinessMixin, CloudAPIView):
    """
    GET    /api/v1/cloud/business/<business_id>/members/<membership_id>/
    PATCH  → update role/status/pwa_access (ADMIN+)
    DELETE → remove member (ADMIN+ cannot remove OWNER; OWNER can remove anyone)
    """
    permission_classes = [IsCloudAuthenticated]
    throttle_classes   = CLOUD_THROTTLES

    def _get_target(self, business_id, membership_id):
        try:
            return BusinessMembership.objects.select_related(
                "user", "business", "invited_by"
            ).prefetch_related("branch_accesses__branch").get(
                id=membership_id,
                business_id=business_id,
            )
        except BusinessMembership.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Membership not found.")

    def get(self, request, business_id, membership_id):
        self._resolve_membership(request, business_id)
        target = self._get_target(business_id, membership_id)
        return Response(BusinessMembershipSerializer(target).data)

    def patch(self, request, business_id, membership_id):
        self._resolve_membership(request, business_id)
        if self.membership:
            require_min_role(self.membership, BusinessMembership.RoleLabel.ADMIN)

        target     = self._get_target(business_id, membership_id)
        old_role   = target.role_label
        old_status = target.status
        old_pwa    = target.pwa_access

        serializer = BusinessMembershipUpdateSerializer(
            target, data=request.data, partial=True
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()

        # Determine which audit actions to log
        new_data = serializer.validated_data
        if new_data.get("role_label") and new_data["role_label"] != old_role:
            CloudAuditLog.log(
                action=CloudAuditLog.Action.ROLE_CHANGED,
                actor=request.user,
                business=self.cloud_business,
                target_user=target.user,
                metadata={"old_role": old_role, "new_role": target.role_label},
                ip_address=get_client_ip(request),
            )

        if "pwa_access" in new_data and new_data["pwa_access"] != old_pwa:
            CloudAuditLog.log(
                action=CloudAuditLog.Action.PWA_ENABLED
                if target.pwa_access else CloudAuditLog.Action.PWA_DISABLED,
                actor=request.user,
                business=self.cloud_business,
                target_user=target.user,
                ip_address=get_client_ip(request),
            )

        if "status" in new_data and new_data["status"] != old_status:
            action = {
                BusinessMembership.MemberStatus.SUSPENDED: CloudAuditLog.Action.MEMBER_SUSPENDED,
                BusinessMembership.MemberStatus.ACTIVE:    CloudAuditLog.Action.MEMBER_REACTIVATED,
                BusinessMembership.MemberStatus.REMOVED:   CloudAuditLog.Action.MEMBER_REMOVED,
            }.get(target.status)
            if action:
                CloudAuditLog.log(
                    action=action,
                    actor=request.user,
                    business=self.cloud_business,
                    target_user=target.user,
                    ip_address=get_client_ip(request),
                )

        return Response(BusinessMembershipSerializer(target).data)

    def delete(self, request, business_id, membership_id):
        self._resolve_membership(request, business_id)
        if self.membership:
            require_min_role(self.membership, BusinessMembership.RoleLabel.ADMIN)

        target = self._get_target(business_id, membership_id)

        # Cannot remove an OWNER unless requestor is also OWNER or superuser
        if target.role_label == BusinessMembership.RoleLabel.OWNER:
            if not request.user.is_superuser:
                if not self.membership or not self.membership.has_min_role(
                    BusinessMembership.RoleLabel.OWNER
                ):
                    from rest_framework.exceptions import PermissionDenied
                    raise PermissionDenied("Cannot remove the business owner.")

        target.status = BusinessMembership.MemberStatus.REMOVED
        target.save(update_fields=["status", "updated_at"])

        CloudAuditLog.log(
            action=CloudAuditLog.Action.MEMBER_REMOVED,
            actor=request.user,
            business=self.cloud_business,
            target_user=target.user,
            metadata={"role": target.role_label},
            ip_address=get_client_ip(request),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


# ══════════════════════════════════════════════════════════════════════════════
# Branch access management
# ══════════════════════════════════════════════════════════════════════════════

class MemberBranchView(CloudBusinessMixin, CloudAPIView):
    """
    GET  /api/v1/cloud/business/<bid>/members/<mid>/branches/
    POST → grant branch access (ADMIN+)
    """
    permission_classes = [IsCloudAuthenticated]
    throttle_classes   = CLOUD_THROTTLES

    def _get_target_membership(self, business_id, membership_id):
        try:
            return BusinessMembership.objects.get(
                id=membership_id, business_id=business_id
            )
        except BusinessMembership.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Membership not found.")

    def get(self, request, business_id, membership_id):
        self._resolve_membership(request, business_id)
        target = self._get_target_membership(business_id, membership_id)
        accesses = target.branch_accesses.select_related("branch", "granted_by").all()
        return Response(UserBranchAccessSerializer(accesses, many=True).data)

    def post(self, request, business_id, membership_id):
        self._resolve_membership(request, business_id)
        if self.membership:
            require_min_role(self.membership, BusinessMembership.RoleLabel.ADMIN)

        target = self._get_target_membership(business_id, membership_id)

        # Verify the branch belongs to this business
        branch_id = request.data.get("branch")
        from branches.models import Branch
        try:
            branch = Branch.objects.get(id=branch_id, business_id=business_id)
        except Branch.DoesNotExist:
            return Response(
                {"detail": "Branch not found in this business."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        access, created = UserBranchAccess.objects.update_or_create(
            membership=target,
            branch=branch,
            defaults={"is_active": True, "granted_by": request.user},
        )

        CloudAuditLog.log(
            action=CloudAuditLog.Action.BRANCH_ACCESS_GRANTED,
            actor=request.user,
            business=self.cloud_business,
            target_user=target.user,
            metadata={"branch_id": str(branch.id), "branch_name": branch.name},
            ip_address=get_client_ip(request),
        )
        return Response(
            UserBranchAccessSerializer(access).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class MemberBranchDetailView(CloudBusinessMixin, CloudAPIView):
    """
    DELETE /api/v1/cloud/business/<bid>/members/<mid>/branches/<branch_id>/
    Revokes branch access.
    """
    permission_classes = [IsCloudAuthenticated]
    throttle_classes   = CLOUD_THROTTLES

    def delete(self, request, business_id, membership_id, branch_id):
        self._resolve_membership(request, business_id)
        if self.membership:
            require_min_role(self.membership, BusinessMembership.RoleLabel.ADMIN)

        try:
            access = UserBranchAccess.objects.select_related("membership__user").get(
                membership_id=membership_id,
                branch_id=branch_id,
                membership__business_id=business_id,
            )
        except UserBranchAccess.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Branch access record not found.")

        target_user = access.membership.user
        access.is_active = False
        access.save(update_fields=["is_active", "updated_at"])

        CloudAuditLog.log(
            action=CloudAuditLog.Action.BRANCH_ACCESS_REVOKED,
            actor=request.user,
            business=self.cloud_business,
            target_user=target_user,
            metadata={"branch_id": str(branch_id)},
            ip_address=get_client_ip(request),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


# ══════════════════════════════════════════════════════════════════════════════
# Device management
# ══════════════════════════════════════════════════════════════════════════════

class DeviceListView(CloudBusinessMixin, CloudAPIView):
    """
    GET /api/v1/cloud/business/<business_id>/devices/
    Returns all non-revoked devices for the business.
    Requires ADMIN+ or the requesting user's own device only for CASHIER/CLERK.
    """
    permission_classes = [IsCloudAuthenticated]
    throttle_classes   = CLOUD_THROTTLES

    def get(self, request, business_id):
        self._resolve_membership(request, business_id)

        qs = CloudDevice.objects.filter(
            business_id=business_id
        ).exclude(
            status=CloudDevice.DeviceStatus.REVOKED
        ).select_related("business", "membership__user", "revoked_by")

        # Non-admins only see devices linked to their own membership
        if self.membership and not self.membership.has_min_role(
            BusinessMembership.RoleLabel.ADMIN
        ):
            qs = qs.filter(membership=self.membership)

        return Response(CloudDeviceSerializer(qs, many=True).data)


class DeviceRegisterView(CloudBusinessMixin, CloudAPIView):
    """
    POST /api/v1/cloud/business/<business_id>/devices/register/
    Register a new cloud device.  Returns the raw token ONCE.
    """
    permission_classes = [IsCloudAuthenticated]
    throttle_classes   = CLOUD_THROTTLES

    def post(self, request, business_id):
        self._resolve_membership(request, business_id)

        serializer = CloudDeviceRegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # Handle re-registration of an existing device_uuid
        device_uuid = data.get("device_uuid")
        raw_token   = CloudDevice.generate_token()

        if device_uuid:
            try:
                device = CloudDevice.objects.get(
                    device_uuid=device_uuid,
                    business_id=business_id,
                )
                if device.status == CloudDevice.DeviceStatus.REVOKED:
                    return Response(
                        {"detail": "This device has been revoked and cannot be re-registered."},
                        status=status.HTTP_403_FORBIDDEN,
                    )
                # Rotate token on re-registration
                device.set_token(raw_token)
                device.name        = data.get("name", device.name)
                device.app_version = data.get("app_version", device.app_version)
                device.os_info     = data.get("os_info", device.os_info)
                device.membership  = self.membership
                device.save()
            except CloudDevice.DoesNotExist:
                device = self._create_device(business_id, data, raw_token)
        else:
            device = self._create_device(business_id, data, raw_token)

        CloudAuditLog.log(
            action=CloudAuditLog.Action.DEVICE_REGISTERED,
            actor=request.user,
            business=self.cloud_business,
            metadata={
                "device_uuid": str(device.device_uuid),
                "device_type": device.device_type,
                "name":        device.name,
            },
            ip_address=get_client_ip(request),
        )

        response_data = {
            "device_uuid":   device.device_uuid,
            "token":         raw_token,
            "name":          device.name,
            "device_type":   device.device_type,
            "status":        device.status,
            "registered_at": device.first_registered,
        }
        return Response(
            CloudDeviceRegisterResponseSerializer(response_data).data,
            status=status.HTTP_201_CREATED,
        )

    def _create_device(self, business_id, data, raw_token) -> CloudDevice:
        device = CloudDevice(
            business_id  = business_id,
            membership   = self.membership,
            name         = data.get("name", ""),
            device_type  = data.get("device_type", CloudDevice.DeviceType.POS_TERMINAL),
            app_version  = data.get("app_version", ""),
            os_info      = data.get("os_info", ""),
        )
        if data.get("device_uuid"):
            device.device_uuid = data["device_uuid"]
        device.set_token(raw_token)
        device.save()
        return device


class DeviceDetailView(CloudBusinessMixin, CloudAPIView):
    """
    GET   /api/v1/cloud/business/<business_id>/devices/<device_id>/
    PATCH → update device metadata (name, app_version, os_info)
    """
    permission_classes = [IsCloudAuthenticated]
    throttle_classes   = CLOUD_THROTTLES

    def _get_device(self, business_id, device_id):
        try:
            return CloudDevice.objects.get(id=device_id, business_id=business_id)
        except CloudDevice.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Device not found.")

    def get(self, request, business_id, device_id):
        self._resolve_membership(request, business_id)
        device = self._get_device(business_id, device_id)
        return Response(CloudDeviceSerializer(device).data)

    def patch(self, request, business_id, device_id):
        self._resolve_membership(request, business_id)
        device = self._get_device(business_id, device_id)

        # Users can only update their own device unless they are ADMIN+
        if (
            self.membership
            and device.membership != self.membership
            and not self.membership.has_min_role(BusinessMembership.RoleLabel.ADMIN)
        ):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("You can only update your own devices.")

        serializer = CloudDeviceUpdateSerializer(device, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(CloudDeviceSerializer(device).data)


class DeviceRevokeView(CloudBusinessMixin, CloudAPIView):
    """
    POST /api/v1/cloud/business/<business_id>/devices/<device_id>/revoke/
    Revokes a device — clears token, sets status=REVOKED.
    Requires ADMIN+ (or the device owner revoking their own device).
    """
    permission_classes = [IsCloudAuthenticated]
    throttle_classes   = CLOUD_THROTTLES

    def post(self, request, business_id, device_id):
        self._resolve_membership(request, business_id)

        try:
            device = CloudDevice.objects.get(id=device_id, business_id=business_id)
        except CloudDevice.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Device not found.")

        # Only admins or the device's own membership owner can revoke
        if self.membership:
            is_own_device = (device.membership == self.membership)
            is_admin      = self.membership.has_min_role(BusinessMembership.RoleLabel.ADMIN)
            if not is_own_device and not is_admin:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied("You can only revoke your own devices.")

        device.revoke(revoked_by=request.user)

        CloudAuditLog.log(
            action=CloudAuditLog.Action.DEVICE_REVOKED,
            actor=request.user,
            business=self.cloud_business,
            metadata={"device_uuid": str(device.device_uuid), "name": device.name},
            ip_address=get_client_ip(request),
        )
        return Response({"detail": "Device revoked."}, status=status.HTTP_200_OK)


# ══════════════════════════════════════════════════════════════════════════════
# Audit log
# ══════════════════════════════════════════════════════════════════════════════

class AuditLogView(CloudBusinessMixin, CloudAPIView):
    """
    GET /api/v1/cloud/business/<business_id>/audit/
    Returns the audit log for this business.
    Requires ADMIN+ role.
    """
    permission_classes = [IsCloudAuthenticated]
    throttle_classes   = CLOUD_THROTTLES

    def get(self, request, business_id):
        self._resolve_membership(request, business_id)
        if self.membership:
            require_min_role(self.membership, BusinessMembership.RoleLabel.ADMIN)

        qs = (
            CloudAuditLog.objects
            .filter(business_id=business_id)
            .select_related("actor", "target_user", "business")
            .order_by("-created_at")[:200]
        )
        return Response(CloudAuditLogSerializer(qs, many=True).data)


# ══════════════════════════════════════════════════════════════════════════════
# Stage 6.2B — Device heartbeat
# ══════════════════════════════════════════════════════════════════════════════

class HeartbeatThrottle(UserRateThrottle):
    """
    Dedicated throttle for heartbeat — more lenient than general cloud
    endpoints since devices beat periodically, but still rate-limited
    to prevent abuse.
    """
    rate = "60/min"


class DeviceHeartbeatView(CloudAPIView):
    """
    POST /api/v1/cloud/device/heartbeat/

    Lightweight device keep-alive.  Accepts EITHER:
      • Authorization: Device <token>  (registered POS terminal)
      • Authorization: Bearer <jwt>    (PWA user with device context)

    What it does:
      1. Authenticates the device (or falls back to JWT user).
      2. Updates device.last_seen and optional metadata.
      3. Fetches the current license status for the business.
      4. Returns device status + license status + cloud_access_ok flag.

    What it does NOT do:
      • Does NOT block local POS sales.
      • Does NOT modify license state.
      • Does NOT create an audit log row (too frequent — would bloat the table).
      • Does NOT raise an error if the license has expired — returns
        cloud_access_ok=False instead, letting the client decide what to do.

    Throttled at 60/min per user/device.

    Offline safety note:
    ~~~~~~~~~~~~~~~~~~~~
    The desktop Electron app calls this endpoint periodically.  If the call
    fails (network unavailable, server down, timeout), Electron MUST continue
    POS operation normally.  This endpoint is informational only.
    """
    permission_classes = [IsDeviceOrCloudAuthenticated]
    throttle_classes   = [HeartbeatThrottle]

    def get_authenticators(self):
        from rest_framework_simplejwt.authentication import JWTAuthentication
        return [DeviceTokenAuthentication(), JWTAuthentication()]

    def post(self, request):
        # ── Parse optional metadata from body ─────────────────────────────────
        body_serializer = HeartbeatRequestSerializer(
            data=request.data if request.data else {}
        )
        body_serializer.is_valid()  # non-strict — bad body is silently ignored
        body = body_serializer.validated_data if body_serializer.is_valid() else {}

        # ── Resolve device ─────────────────────────────────────────────────────
        device = get_device_from_request(request)

        if device is None:
            # JWT-authenticated path — no device context
            # Return a reduced heartbeat for PWA users (not POS terminals)
            return self._jwt_heartbeat(request)

        # ── Device-token path ─────────────────────────────────────────────────
        # Update metadata without triggering an audit log (too frequent)
        update_fields = ["last_seen", "updated_at"]
        device.last_seen = timezone.now()

        if body.get("app_version"):
            device.app_version = body["app_version"]
            update_fields.append("app_version")
        if body.get("os_info"):
            device.os_info = body["os_info"]
            update_fields.append("os_info")
        if body.get("device_name"):
            device.name = body["device_name"]
            update_fields.append("name")

        device.save(update_fields=update_fields)

        # ── License check ──────────────────────────────────────────────────────
        cloud_ok, lic_status = CloudLicenseService.is_cloud_access_permitted(
            device.business
        )

        response_data = {
            "device_uuid":    device.device_uuid,
            "device_status":  device.status,
            "business_id":    device.business.id,
            "business_name":  device.business.name,
            "license_status": lic_status.as_dict(),
            "cloud_access_ok": cloud_ok,
            "server_time":    timezone.now(),
        }
        return Response(
            HeartbeatResponseSerializer(response_data).data,
            status=status.HTTP_200_OK,
        )

    def _jwt_heartbeat(self, request):
        """Reduced heartbeat response for JWT-only (non-device) clients."""
        user = request.user
        profile = CloudProfile.get_or_create_for(user)
        profile.touch()

        # No single device to report — return user-level cloud status
        return Response(
            {
                "device_uuid":     None,
                "device_status":   "N/A",
                "business_id":     str(user.business_id) if user.business_id else None,
                "business_name":   user.business.name if user.business_id and user.business else None,
                "license_status":  CloudLicenseService.get_status(
                    user.business
                ).as_dict() if user.business_id and user.business else {"found": False},
                "cloud_access_ok": profile.pwa_access_enabled,
                "server_time":     timezone.now(),
            },
            status=status.HTTP_200_OK,
        )


# ══════════════════════════════════════════════════════════════════════════════
# Stage 6.2B — Cloud license status
# ══════════════════════════════════════════════════════════════════════════════

class CloudLicenseStatusView(CloudBusinessMixin, CloudAPIView):
    """
    GET /api/v1/cloud/business/<business_id>/license/

    Returns the safe cloud-facing license status for the business.

    Security:
      - Requires ADMIN+ membership (MANAGER and below cannot read license info).
      - NEVER returns activation_code.
      - NEVER returns payment credentials.
      - Business isolation enforced via _resolve_membership().

    Accepts Device token OR JWT.
    """
    permission_classes = [IsDeviceOrCloudAuthenticated]
    throttle_classes   = CLOUD_THROTTLES

    def get_authenticators(self):
        from rest_framework_simplejwt.authentication import JWTAuthentication
        return [DeviceTokenAuthentication(), JWTAuthentication()]

    def get(self, request, business_id):
        self._resolve_membership(request, business_id)

        # Require ADMIN+ to read license info
        if self.membership:
            require_min_role(self.membership, BusinessMembership.RoleLabel.ADMIN)

        lic_status = CloudLicenseService.get_status(self.cloud_business)

        response_data = {
            "business_id":    self.cloud_business.id,
            "business_name":  self.cloud_business.name,
            **lic_status.as_dict(),
        }
        return Response(
            CloudLicenseStatusSerializer(response_data).data,
            status=status.HTTP_200_OK,
        )
