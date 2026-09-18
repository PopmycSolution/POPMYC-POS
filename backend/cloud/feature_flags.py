"""
cloud/feature_flags.py
======================
CLOUD_ENABLED and PWA_ENABLED enforcement for the cloud app.

These flags let operators disable cloud features without touching code.
They default to False so the local desktop POS works with no cloud config.

Offline safety
--------------
These checks ONLY run on /api/v1/cloud/ endpoints.
The local POS, sync, licensing, auth, and all other existing endpoints are
completely unaffected — they never import or reference anything in this file.

Usage
-----
In any cloud view method:

    from cloud.feature_flags import require_cloud_enabled, require_pwa_enabled

    class MyView(APIView):
        def get(self, request):
            require_cloud_enabled()   # raises 503 if CLOUD_ENABLED=False
            ...

Or as a mixin applied at the class level:

    class MyView(CloudEnabledMixin, APIView):
        ...

For PWA-specific views additionally call require_pwa_enabled().
"""

from __future__ import annotations

from django.conf import settings
from rest_framework.exceptions import APIException
from rest_framework import status as drf_status


# ── Custom 503 exception ──────────────────────────────────────────────────────

class CloudServiceUnavailable(APIException):
    """
    HTTP 503 — returned when CLOUD_ENABLED=False or PWA_ENABLED=False.
    This communicates to the client that the feature is temporarily/
    permanently disabled, not that the request was wrong.
    """
    status_code = drf_status.HTTP_503_SERVICE_UNAVAILABLE
    default_code = "cloud_unavailable"
    default_detail = (
        "The cloud service is not currently available. "
        "Please try again later or contact your administrator."
    )


class PWAServiceUnavailable(APIException):
    status_code = drf_status.HTTP_503_SERVICE_UNAVAILABLE
    default_code = "pwa_unavailable"
    default_detail = (
        "PWA access is not currently enabled. "
        "Please contact your administrator."
    )


# ── Guard functions ───────────────────────────────────────────────────────────

def is_cloud_enabled() -> bool:
    """Return True if CLOUD_ENABLED=True in Django settings."""
    return bool(getattr(settings, "CLOUD_ENABLED", False))


def is_pwa_enabled() -> bool:
    """Return True if PWA_ENABLED=True in Django settings."""
    return bool(getattr(settings, "PWA_ENABLED", False))


def require_cloud_enabled() -> None:
    """
    Raise CloudServiceUnavailable (HTTP 503) if CLOUD_ENABLED is False.

    Call at the start of any cloud view that must be gated by CLOUD_ENABLED.
    """
    if not is_cloud_enabled():
        raise CloudServiceUnavailable()


def require_pwa_enabled() -> None:
    """
    Raise PWAServiceUnavailable (HTTP 503) if PWA_ENABLED is False.
    Also requires CLOUD_ENABLED.
    """
    require_cloud_enabled()
    if not is_pwa_enabled():
        raise PWAServiceUnavailable()


# ── View mixins ───────────────────────────────────────────────────────────────

class CloudEnabledMixin:
    """
    Mixin for APIView subclasses that require CLOUD_ENABLED=True.

    Calls require_cloud_enabled() before any dispatch so all HTTP methods
    are covered without adding the check to each handler individually.

    Usage:
        class MyView(CloudEnabledMixin, IsCloudAuthenticated, APIView):
            ...
    """

    def initial(self, request, *args, **kwargs):
        # DRF calls initial() before dispatch → correct place for the check
        require_cloud_enabled()
        super().initial(request, *args, **kwargs)


class PWAEnabledMixin(CloudEnabledMixin):
    """
    Mixin for views that require BOTH CLOUD_ENABLED and PWA_ENABLED.
    """

    def initial(self, request, *args, **kwargs):
        require_pwa_enabled()     # also checks cloud
        # Skip CloudEnabledMixin.initial — pwa check covers it
        # Call grandparent directly to avoid double check
        from rest_framework.views import APIView
        APIView.initial(self, request, *args, **kwargs)


# ── CloudAPIView — base class for ALL cloud API views ─────────────────────────
# Defined after the imports it needs, using a factory so DRF's metaclass
# sees a normal class declaration with the correct bases.

def _make_cloud_api_view():
    from rest_framework.views import APIView

    class CloudAPIView(CloudEnabledMixin, APIView):
        """
        Base class for every /api/v1/cloud/ view.

        Combines CloudEnabledMixin with DRF's APIView so that:
          - CLOUD_ENABLED is checked before ANY cloud endpoint dispatches.
          - Future views inherit the gate automatically.
          - Local POS views (which never inherit this) are unaffected.

        Usage — swap APIView for CloudAPIView on every cloud view:

            # Before:
            class MyCloudView(SomeMixin, APIView): ...

            # After:
            class MyCloudView(SomeMixin, CloudAPIView): ...

        Views that explicitly inherit CloudEnabledMixin already (e.g.
        CloudStatusView) are safe to convert too — the MRO ensures
        CloudEnabledMixin.initial() fires exactly once.
        """

    return CloudAPIView


CloudAPIView = _make_cloud_api_view()
