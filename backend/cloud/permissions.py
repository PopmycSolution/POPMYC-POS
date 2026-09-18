"""
cloud/permissions.py
====================
Permission classes and business/branch isolation helpers for the cloud API.

Isolation guarantees:
  1. Every cloud endpoint that touches business data calls
     get_membership_or_403() to confirm the requesting user has an
     ACTIVE membership for that business.
  2. Branch-scoped endpoints additionally call verify_branch_access()
     before returning any branch data.
  3. Role-gated actions call require_min_role() — rejected with 403 if
     the membership's role is below the required level.
  4. (Stage 6.2B) License-gated actions call require_active_license() —
     rejected with 402 if the business license is not active.

These are enforced SERVER-SIDE in views — hiding frontend buttons is
not sufficient and never substitutes for these checks.
"""

from rest_framework import permissions, status
from rest_framework.exceptions import PermissionDenied, NotFound
from rest_framework.response import Response

from .models import BusinessMembership, CloudProfile


# ── Utility functions ─────────────────────────────────────────────────────────

def get_client_ip(request) -> str | None:
    """Extract the real client IP, respecting X-Forwarded-For."""
    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        return xff.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def get_membership_or_403(user, business_id) -> BusinessMembership:
    """
    Return the user's ACTIVE BusinessMembership for business_id.
    Raises PermissionDenied (HTTP 403) if not found or inactive.

    This is the primary business-isolation gate.  Call it at the start
    of every cloud view that handles business data.
    """
    try:
        membership = BusinessMembership.objects.select_related(
            "user", "business"
        ).get(user=user, business_id=business_id)
    except BusinessMembership.DoesNotExist:
        raise PermissionDenied(
            "You do not have access to this business."
        )

    if not membership.is_active:
        raise PermissionDenied(
            f"Your membership for this business is {membership.status.lower()}."
        )
    return membership


def verify_branch_access(membership: BusinessMembership, branch_id) -> None:
    """
    Raise PermissionDenied if the membership does not grant access to branch_id.
    No-op when membership.branch_access_all is True.
    """
    if membership.branch_access_all:
        return
    if not membership.can_access_branch(branch_id):
        raise PermissionDenied(
            "You do not have access to this branch."
        )


def require_min_role(
    membership: BusinessMembership,
    min_role: str,
    detail: str | None = None,
) -> None:
    """
    Raise PermissionDenied if the membership's role is below min_role.

    Example:
        require_min_role(membership, BusinessMembership.RoleLabel.ADMIN)
    """
    if not membership.has_min_role(min_role):
        raise PermissionDenied(
            detail
            or f"This action requires {min_role} or higher. "
               f"Your role is {membership.role_label}."
        )


# ── DRF Permission classes ─────────────────────────────────────────────────────

class IsCloudAuthenticated(permissions.BasePermission):
    """
    Requires:
      1. User is authenticated (JWT or session).
      2. User has an active CloudProfile.
      3. CloudProfile.account_status == ACTIVE.

    Superusers bypass the cloud profile check.
    """

    message = "Cloud account access is not enabled for this user."

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        if request.user.is_superuser:
            return True

        try:
            profile = request.user.cloud_profile
        except CloudProfile.DoesNotExist:
            return False

        return profile.account_status == CloudProfile.AccountStatus.ACTIVE


class IsPWAEnabled(IsCloudAuthenticated):
    """
    Extends IsCloudAuthenticated:
    additionally requires CloudProfile.pwa_access_enabled == True.
    """

    message = "PWA access is not enabled for this account."

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        if request.user.is_superuser:
            return True
        try:
            return request.user.cloud_profile.pwa_access_enabled
        except CloudProfile.DoesNotExist:
            return False


class IsBusinessOwnerOrAdmin(permissions.BasePermission):
    """
    Requires the user to have OWNER, SUPER_ADMIN, or ADMIN role
    in the business identified by `view.kwargs["business_id"]`.

    Falls back gracefully if business_id is not in kwargs.
    """

    message = "Admin or Owner access is required for this action."

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.user.is_superuser:
            return True

        business_id = view.kwargs.get("business_id")
        if not business_id:
            return False

        try:
            membership = BusinessMembership.objects.get(
                user=request.user,
                business_id=business_id,
            )
        except BusinessMembership.DoesNotExist:
            return False

        if not membership.is_active:
            return False

        return membership.has_min_role(BusinessMembership.RoleLabel.ADMIN)


class IsSuperAdminOrOwner(permissions.BasePermission):
    """
    Requires OWNER or SUPER_ADMIN role in the target business.
    """

    message = "Owner or Super Admin access is required."

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.user.is_superuser:
            return True

        business_id = view.kwargs.get("business_id")
        if not business_id:
            return False

        try:
            membership = BusinessMembership.objects.get(
                user=request.user,
                business_id=business_id,
            )
        except BusinessMembership.DoesNotExist:
            return False

        if not membership.is_active:
            return False

        return membership.has_min_role(BusinessMembership.RoleLabel.SUPER_ADMIN)


# ── View mixins ───────────────────────────────────────────────────────────────

class CloudBusinessMixin:
    """
    Mixin for cloud views scoped to a business.

    Adds:
      self.membership   — the requesting user's BusinessMembership
      self.cloud_business — the Business object

    Usage:
        class MyView(CloudBusinessMixin, APIView):
            def get(self, request, business_id):
                self._resolve_membership(request, business_id)
                # self.membership is now set and verified
    """

    membership = None
    cloud_business = None

    def _resolve_membership(self, request, business_id) -> BusinessMembership:
        """
        Resolve and cache the membership.  Raises 403 if not authorised.
        Superusers get a synthetic pass-through (no membership required).
        """
        if request.user.is_superuser:
            # Superusers access all businesses — attempt to fetch business directly
            from businesses.models import Business
            try:
                self.cloud_business = Business.objects.get(pk=business_id)
            except Business.DoesNotExist:
                raise NotFound("Business not found.")
            return None

        self.membership = get_membership_or_403(request.user, business_id)
        self.cloud_business = self.membership.business
        return self.membership


class CloudBranchMixin(CloudBusinessMixin):
    """
    Extends CloudBusinessMixin with branch-level access verification.

    Usage:
        self._resolve_membership(request, business_id)
        self._verify_branch(branch_id)
    """

    def _verify_branch(self, branch_id) -> None:
        if self.membership is not None:
            verify_branch_access(self.membership, branch_id)


# ── Stage 6.2B additions ──────────────────────────────────────────────────────

class LicenseNotActive(PermissionDenied):
    """
    Custom exception for license-blocked cloud operations.
    Uses HTTP 402 (Payment Required) to signal a license/subscription issue,
    matching the convention used by LicenseCheckMiddleware.
    """
    status_code = 402
    default_code = "license_required"
    default_detail = "Your business license is not active. Please renew your subscription."


def require_active_license(business) -> None:
    """
    Raise LicenseNotActive (HTTP 402) if the business license does not
    permit cloud operations.

    Uses CloudLicenseService so the check is consistent with the service
    layer — never duplicates licensing logic.
    """
    from .license_service import CloudLicenseService
    allowed, lic_status = CloudLicenseService.is_cloud_access_permitted(business)
    if not allowed:
        raise LicenseNotActive(
            f"Cloud access denied: license is {lic_status.license_state}."
        )


class IsDeviceOrCloudAuthenticated(permissions.BasePermission):
    """
    Accepts EITHER:
      a) A valid JWT user (standard cloud authentication), OR
      b) A valid Device token (DeviceTokenAuthentication)

    This lets both PWA users (JWT) and registered POS terminals (Device token)
    reach the same heartbeat and device endpoints without duplicating views.
    """

    message = "Authentication required (JWT or Device token)."

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        # Device-token auth: request.auth is a CloudDevice
        from .authentication import get_device_from_request
        from .models import CloudDevice
        device = get_device_from_request(request)
        if device is not None:
            # Device path: device is ACTIVE (enforced by auth backend)
            return True
        # JWT path: require active cloud profile (same as IsCloudAuthenticated)
        if request.user.is_superuser:
            return True
        try:
            profile = request.user.cloud_profile
        except CloudProfile.DoesNotExist:
            return False
        return profile.account_status == CloudProfile.AccountStatus.ACTIVE
