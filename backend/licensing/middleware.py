"""
licensing/middleware.py
=======================
LicenseCheckMiddleware

Intercepts every API request and verifies the user's business has a valid license.

Rules:
  - Superusers: always allowed through (platform admins).
  - Unauthenticated requests: passed through — auth middleware handles 401.
  - Users with no business: passed through — multi-tenancy scoping returns empty data.
  - LIFETIME license (ACTIVE): always allowed.
  - SUBSCRIPTION license (ACTIVE, not expired): allowed.
  - SUBSCRIPTION license (ACTIVE, but today > expiry_date): auto-flipped to EXPIRED, blocked.
  - EXPIRED / SUSPENDED / REVOKED: blocked with 402 / 403.
  - No license record at all: blocked with 402.

Bypass paths (always allowed regardless of license):
  - /admin/             Django admin (so POPMYC staff can manage licenses)
  - /api/v1/licensing/  so users can call /activate and /renew
  - /api/v1/auth/       login endpoints
  - /api/v1/accounts/   token refresh, password reset
  - /api/schema/        API docs
  - /api/v1/health/     health check
  - /api/sync/          sync endpoints
"""
import json
from datetime import date

from django.http import JsonResponse
from django.utils.deprecation import MiddlewareMixin

from .models import License

# Paths that bypass the license check entirely
BYPASS_PREFIXES = (
    "/admin/",
    "/api/v1/licensing/",
    "/api/v1/auth/",
    "/api/v1/accounts/",
    "/api/schema/",
    "/api/v1/health/",
    "/api/v1/ping/",
    "/api/sync/",
    "/api-auth/",
    "/api/v1/setup/",    # pre-auth first-run setup endpoints
    "/api/v1/cloud/",    # cloud endpoints do their own license verification
    "/api/v1/sync/",     # sync endpoints — also mounted at /api/sync/ (alias)
)


class LicenseCheckMiddleware(MiddlewareMixin):
    """
    Runs after AuthenticationMiddleware so request.user is populated.
    """

    def process_request(self, request):
        # 1. Always bypass certain paths
        path = request.path_info
        for prefix in BYPASS_PREFIXES:
            if path.startswith(prefix):
                return None  # pass through

        # 2. Only check authenticated API requests
        user = getattr(request, "user", None)
        if user is None or not user.is_authenticated:
            return None

        # 3. Superusers bypass the license check
        if user.is_superuser:
            return None

        # 4. Users with no business — pass through (scoping returns empty data)
        if not getattr(user, "business_id", None):
            return None

        # 5. Fetch (or check cached) license
        try:
            lic = License.objects.select_related("business").get(
                business_id=user.business_id
            )
        except License.DoesNotExist:
            return self._blocked(
                request,
                "NO_LICENSE",
                "Your business does not have a license. "
                "Please contact POPMYC support to obtain an activation code.",
                402,
            )

        # 6. Auto-flip ACTIVE → EXPIRED if past date
        lic.refresh_expiry_status()

        # 7. LIFETIME + ACTIVE: always allow
        if lic.license_type == License.LicenseType.LIFETIME and lic.status == License.Status.ACTIVE:
            return None

        # 8. SUBSCRIPTION or TRIAL + ACTIVE + not expired: allow
        if (
            lic.license_type in (License.LicenseType.SUBSCRIPTION, License.LicenseType.TRIAL)
            and lic.status == License.Status.ACTIVE
            and lic.expiry_date
            and date.today() <= lic.expiry_date
        ):
            return None

        # 9. Anything else is blocked
        status_messages = {
            License.Status.PENDING:   ("PENDING",   "Your license has not been activated yet. "
                                                    "Please enter your activation code.", 402),
            License.Status.EXPIRED:   ("EXPIRED",   "Your subscription has expired. "
                                                    "Please contact POPMYC to renew your license.", 402),
            License.Status.SUSPENDED: ("SUSPENDED", "Your license has been suspended. "
                                                    "Please contact POPMYC support.", 403),
            License.Status.REVOKED:   ("REVOKED",   "Your license has been revoked. "
                                                    "Please contact POPMYC support.", 403),
        }
        code, message, http_status = status_messages.get(
            lic.status,
            ("INVALID", "License is not valid. Please contact POPMYC support.", 402),
        )
        return self._blocked(request, code, message, http_status, lic)

    @staticmethod
    def _blocked(request, code, message, http_status, lic=None):
        payload = {
            "license_error": True,
            "code": code,
            "detail": message,
        }
        if lic:
            payload["license_type"] = lic.license_type
            payload["expiry_date"]  = str(lic.expiry_date) if lic.expiry_date else None
            payload["days_remaining"] = lic.days_remaining
        return JsonResponse(payload, status=http_status)
