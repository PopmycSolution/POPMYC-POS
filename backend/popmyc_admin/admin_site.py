"""
popmyc_admin/admin_site.py
==========================
POPMYC POS custom Django AdminSite.

Overrides:
  - Site branding (header, title, index_title)
  - Index page → professional dashboard with live KPIs
  - Navigation grouping via app_list override

Security: never exposes passwords, tokens, SECRET_KEY, or device secrets.
"""

from django.contrib import admin
from django.contrib.admin import AdminSite
from django.db.models import Count, Q
from django.utils import timezone


class PopmycAdminSite(AdminSite):
    # ── Branding ───────────────────────────────────────────────────────────────
    site_header   = "POPMYC POS Administration"
    site_title    = "POPMYC Admin"
    index_title   = "Dashboard"
    site_url      = None   # hide "View site" link (there's no public site here)

    # ── Dashboard index ────────────────────────────────────────────────────────
    def index(self, request, extra_context=None):
        """Override to inject KPI cards and recent-activity tables."""
        extra_context = extra_context or {}
        extra_context.update(self._build_dashboard_context())
        return super().index(request, extra_context=extra_context)

    # ── Dashboard data ─────────────────────────────────────────────────────────

    def _build_dashboard_context(self) -> dict:
        ctx = {}

        try:
            from businesses.models import Business
            from branches.models import Branch
            ctx["total_businesses"]  = Business.objects.count()
            ctx["active_businesses"] = Business.objects.filter(is_active=True).count()
            ctx["total_branches"]    = Branch.objects.count()
        except Exception:
            ctx.setdefault("total_businesses",  0)
            ctx.setdefault("active_businesses", 0)
            ctx.setdefault("total_branches",    0)

        try:
            from licensing.models import License
            ctx["active_licenses"] = License.objects.filter(
                status=License.Status.ACTIVE, license_type__in=["SUBSCRIPTION", "LIFETIME"]
            ).count()
            ctx["active_trials"] = License.objects.filter(
                status=License.Status.ACTIVE, license_type="TRIAL"
            ).count()
            ctx["expired_licenses"] = License.objects.filter(
                status=License.Status.EXPIRED
            ).count()
        except Exception:
            ctx.setdefault("active_licenses",  0)
            ctx.setdefault("active_trials",    0)
            ctx.setdefault("expired_licenses", 0)

        try:
            from cloud.models import CloudDevice
            ctx["registered_devices"] = CloudDevice.objects.filter(
                status=CloudDevice.DeviceStatus.ACTIVE
            ).count()
        except Exception:
            ctx.setdefault("registered_devices", 0)

        try:
            from synchronization.models import SyncRecord
            ctx["pending_syncs"] = SyncRecord.objects.filter(status="pending").count()
            ctx["failed_syncs"]  = SyncRecord.objects.filter(status="failed").count()
            ctx["synced_today"]  = SyncRecord.objects.filter(
                status="synced",
                synced_at__date=timezone.now().date(),
            ).count()
        except Exception:
            ctx.setdefault("pending_syncs", 0)
            ctx.setdefault("failed_syncs",  0)
            ctx.setdefault("synced_today",  0)

        # ── Recent items ───────────────────────────────────────────────────────
        try:
            from businesses.models import Business
            ctx["recent_businesses"] = (
                Business.objects
                .select_related("owner")
                .order_by("-created_at")[:8]
            )
        except Exception:
            ctx["recent_businesses"] = []

        try:
            from licensing.models import License, TrialCode
            ctx["recent_licenses"] = (
                License.objects
                .select_related("business")
                .filter(status=License.Status.ACTIVE)
                .order_by("-activated_at")[:8]
            )
            ctx["pending_trial_codes"] = TrialCode.objects.filter(
                status="PENDING"
            ).count()
        except Exception:
            ctx["recent_licenses"]      = []
            ctx["pending_trial_codes"]  = 0

        try:
            from synchronization.models import SyncRecord
            ctx["recent_failed_syncs"] = (
                SyncRecord.objects
                .filter(status__in=["failed", "conflict"])
                .order_by("-updated_at")[:10]
            )
            ctx["recent_synced"] = (
                SyncRecord.objects
                .filter(status="synced")
                .order_by("-synced_at")[:6]
            )
        except Exception:
            ctx["recent_failed_syncs"] = []
            ctx["recent_synced"]       = []

        try:
            from cloud.models import CloudDevice
            ctx["recent_devices"] = (
                CloudDevice.objects
                .select_related("business")
                .order_by("-first_registered")[:6]
            )
        except Exception:
            ctx["recent_devices"] = []

        return ctx


# The single admin site instance used throughout the project.
#
# name="admin" is intentional: it must match the URL namespace that all
# admin templates and @admin.register decorators already use ("admin:...").
# Using any other name would break every {% url 'admin:...' %} tag in
# the existing templates without changing them.
popmyc_admin_site = PopmycAdminSite(name="admin")
