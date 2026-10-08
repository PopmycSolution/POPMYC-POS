"""
cloud/urls.py
=============
Mounted at /api/v1/cloud/ in config/urls.py
"""

from django.urls import path
from . import views
from . import sync_views
from . import trial_views

app_name = "cloud"

urlpatterns = [
    # ── Trial activation (two-phase cloud TrialCode bridge) ───────────────────
    # These are AllowAny — no prior auth needed (pre-login first-run flow).
    # Mounted under /api/v1/cloud/ which is already in LicenseCheckMiddleware
    # BYPASS_PREFIXES, so no additional bypass configuration is needed.
    path("trial/validate/",
         trial_views.TrialValidateView.as_view(),
         name="trial-validate"),
    path("trial/verify-reservation/",
         trial_views.TrialVerifyReservationView.as_view(),
         name="trial-verify-reservation"),
    path("trial/complete/",
         trial_views.TrialCompleteView.as_view(),
         name="trial-complete"),
    path("trial/register-business/",
         trial_views.BusinessRegistrationView.as_view(),
         name="trial-register-business"),

    # ── Status ──────────────────────────────────────────────────────────────
    path("status/",
         views.CloudStatusView.as_view(),
         name="status"),

    # ── Account ──────────────────────────────────────────────────────────────
    path("account/",
         views.CloudAccountView.as_view(),
         name="account"),
    path("account/businesses/",
         views.MyBusinessesView.as_view(),
         name="account-businesses"),
    path("account/pwa-context/",
         views.PWAContextView.as_view(),
         name="pwa-context"),

    # ── Device heartbeat (Stage 6.2B) ─────────────────────────────────────────
    path("device/heartbeat/",
         views.DeviceHeartbeatView.as_view(),
         name="device-heartbeat"),

    # ── Sync — device bridge + cloud-side status (Stage 6.2C) ────────────────
    path("sync/register-device/",
         sync_views.CloudSyncDeviceBridgeView.as_view(),
         name="sync-register-device"),
    path("sync/status/",
         sync_views.CloudSyncStatusView.as_view(),
         name="sync-status"),

    # ── Business cloud profile ────────────────────────────────────────────────
    path("business/<uuid:business_id>/",
         views.CloudBusinessView.as_view(),
         name="business-detail"),

    # ── Business license status (Stage 6.2B) ─────────────────────────────────
    path("business/<uuid:business_id>/license/",
         views.CloudLicenseStatusView.as_view(),
         name="business-license"),

    # ── Members ───────────────────────────────────────────────────────────────
    path("business/<uuid:business_id>/members/",
         views.MemberListView.as_view(),
         name="member-list"),
    path("business/<uuid:business_id>/members/<uuid:membership_id>/",
         views.MemberDetailView.as_view(),
         name="member-detail"),
    path("business/<uuid:business_id>/members/<uuid:membership_id>/branches/",
         views.MemberBranchView.as_view(),
         name="member-branches"),
    path("business/<uuid:business_id>/members/<uuid:membership_id>/branches/<uuid:branch_id>/",
         views.MemberBranchDetailView.as_view(),
         name="member-branch-detail"),

    # ── Devices ───────────────────────────────────────────────────────────────
    path("business/<uuid:business_id>/devices/",
         views.DeviceListView.as_view(),
         name="device-list"),
    path("business/<uuid:business_id>/devices/register/",
         views.DeviceRegisterView.as_view(),
         name="device-register"),
    path("business/<uuid:business_id>/devices/<uuid:device_id>/",
         views.DeviceDetailView.as_view(),
         name="device-detail"),
    path("business/<uuid:business_id>/devices/<uuid:device_id>/revoke/",
         views.DeviceRevokeView.as_view(),
         name="device-revoke"),

    # ── Audit log ─────────────────────────────────────────────────────────────
    path("business/<uuid:business_id>/audit/",
         views.AuditLogView.as_view(),
         name="audit-log"),
]
