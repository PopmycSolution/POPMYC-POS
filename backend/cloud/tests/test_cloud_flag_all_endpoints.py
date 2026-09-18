"""
cloud/tests/test_cloud_flag_all_endpoints.py
============================================
Stage 6.2B.1 — Comprehensive hardening tests.

Coverage
--------
1. CLOUD_ENABLED=False  →  every /api/v1/cloud/ endpoint returns 503
2. CLOUD_ENABLED=True   →  every endpoint is reachable (existing behaviour)
3. Local POS unaffected when CLOUD_ENABLED=False
4. Device authentication auditing
   - valid token succeeds, no DEVICE_AUTH_FAILED audit row
   - invalid token → 401 + DEVICE_AUTH_FAILED audit row (safe metadata only)
   - revoked device → 401 + DEVICE_AUTH_FAILED audit row
   - inactive business → 401 + DEVICE_AUTH_FAILED audit row
   - inactive membership → 401 + DEVICE_AUTH_FAILED audit row
   - missing Device header → no audit row (JWT fall-through)
   - audit metadata never contains raw token, hash, password
5. Heartbeat does NOT create DEVICE_AUTH_FAILED or DEVICE_HEARTBEAT audit
   rows on every successful call (no flood)
6. PWA_ENABLED semantics are separate from CLOUD_ENABLED
"""

import uuid
from datetime import date, timedelta

from django.test import TestCase, override_settings
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status

from businesses.models import Business
from branches.models import Branch
from licensing.models import License
from cloud.models import (
    CloudProfile,
    CloudBusinessProfile,
    BusinessMembership,
    CloudDevice,
    CloudAuditLog,
)
from cloud.authentication import DEVICE_AUTH_SCHEME

User = get_user_model()


# ── Shared helpers ─────────────────────────────────────────────────────────────

def make_user(username, password="Pass123!", **kwargs):
    return User.objects.create_user(
        username=username, password=password,
        email=f"{username}@hardening.test", **kwargs,
    )


def make_business(name="Hardening Corp", owner=None):
    return Business.objects.create(name=name, owner=owner)


def make_license(business, lic_status=License.Status.ACTIVE,
                 ltype=License.LicenseType.SUBSCRIPTION):
    expiry = date.today() + timedelta(days=365) \
        if ltype == License.LicenseType.SUBSCRIPTION else None
    return License.objects.create(
        business=business, license_type=ltype,
        status=lic_status, expiry_date=expiry,
        start_date=date.today() if lic_status == License.Status.ACTIVE else None,
    )


def make_membership(user, business, role=BusinessMembership.RoleLabel.OWNER,
                    mem_status=BusinessMembership.MemberStatus.ACTIVE,
                    pwa_access=True):
    return BusinessMembership.objects.create(
        user=user, business=business, role_label=role,
        status=mem_status, pwa_access=pwa_access,
    )


def make_cloud_profile(user, pwa_enabled=True):
    p = CloudProfile.get_or_create_for(user)
    p.pwa_access_enabled = pwa_enabled
    p.account_status = CloudProfile.AccountStatus.ACTIVE
    p.save()
    return p


def make_device(business, membership, name="Till"):
    """Return (device, raw_token)."""
    raw = CloudDevice.generate_token()
    device = CloudDevice.objects.create(
        business=business, membership=membership,
        name=name, device_type=CloudDevice.DeviceType.POS_TERMINAL,
        status=CloudDevice.DeviceStatus.ACTIVE,
    )
    device.set_token(raw)
    device.save()
    return device, raw


def device_client(raw_token):
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"{DEVICE_AUTH_SCHEME} {raw_token}")
    return c


def jwt_client(user):
    c = APIClient()
    c.force_authenticate(user=user)
    return c


# ── Full set of cloud routes ───────────────────────────────────────────────────
# Collected from cloud/urls.py — updated here if routes change.
# Each entry: (method, url_template, needs_business_id, needs_membership_id,
#              needs_device_id, needs_branch_id)

_ROUTE_SPECS = [
    # method, path-template key, requires ids
    ("GET",    "status",          False, False, False, False),
    ("GET",    "account",         False, False, False, False),
    ("GET",    "account_biz",     False, False, False, False),
    ("GET",    "account_pwa",     False, False, False, False),
    ("POST",   "heartbeat",       False, False, False, False),
    ("GET",    "biz_detail",      True,  False, False, False),
    ("GET",    "biz_license",     True,  False, False, False),
    ("GET",    "member_list",     True,  False, False, False),
    ("GET",    "member_detail",   True,  True,  False, False),
    ("GET",    "member_branches", True,  True,  False, False),
    ("DELETE", "member_branch_d", True,  True,  False, True),
    ("GET",    "device_list",     True,  False, False, False),
    ("POST",   "device_register", True,  False, False, False),
    ("GET",    "device_detail",   True,  False, True,  False),
    ("POST",   "device_revoke",   True,  False, True,  False),
    ("GET",    "audit_log",       True,  False, False, False),
]


def _build_url(key, biz_id=None, mid=None, dev_id=None, br_id=None):
    base = "/api/v1/cloud/"
    mapping = {
        "status":          f"{base}status/",
        "account":         f"{base}account/",
        "account_biz":     f"{base}account/businesses/",
        "account_pwa":     f"{base}account/pwa-context/",
        "heartbeat":       f"{base}device/heartbeat/",
        "biz_detail":      f"{base}business/{biz_id}/",
        "biz_license":     f"{base}business/{biz_id}/license/",
        "member_list":     f"{base}business/{biz_id}/members/",
        "member_detail":   f"{base}business/{biz_id}/members/{mid}/",
        "member_branches": f"{base}business/{biz_id}/members/{mid}/branches/",
        "member_branch_d": f"{base}business/{biz_id}/members/{mid}/branches/{br_id}/",
        "device_list":     f"{base}business/{biz_id}/devices/",
        "device_register": f"{base}business/{biz_id}/devices/register/",
        "device_detail":   f"{base}business/{biz_id}/devices/{dev_id}/",
        "device_revoke":   f"{base}business/{biz_id}/devices/{dev_id}/revoke/",
        "audit_log":       f"{base}business/{biz_id}/audit/",
    }
    return mapping[key]


# ══════════════════════════════════════════════════════════════════════════════
# 1.  CLOUD_ENABLED=False → every cloud endpoint returns 503
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(CLOUD_ENABLED=False)
class TestAllCloudEndpointsReturn503WhenDisabled(TestCase):
    """
    When CLOUD_ENABLED=False every /api/v1/cloud/ URL must return 503.
    The test uses a fully authenticated client so auth is never the blocker.
    """

    def setUp(self):
        self.user = make_user("flag_off_user")
        self.biz  = make_business(owner=self.user)
        make_license(self.biz)
        self.m    = make_membership(self.user, self.biz)
        make_cloud_profile(self.user)

        # Create a branch and device so IDs are valid
        self.branch = Branch.objects.create(
            business=self.biz, name="Main", code="MAIN"
        )
        self.device, self.raw = make_device(self.biz, self.m)

        self.c = jwt_client(self.user)

    def _call(self, method, url):
        fn = getattr(self.c, method.lower())
        return fn(url, format="json")

    def test_status_returns_503(self):
        resp = self._call("GET", "/api/v1/cloud/status/")
        self.assertEqual(resp.status_code, 503, "status/")

    def test_account_returns_503(self):
        resp = self._call("GET", "/api/v1/cloud/account/")
        self.assertEqual(resp.status_code, 503, "account/")

    def test_account_businesses_returns_503(self):
        resp = self._call("GET", "/api/v1/cloud/account/businesses/")
        self.assertEqual(resp.status_code, 503, "account/businesses/")

    def test_account_pwa_context_returns_503(self):
        resp = self._call("GET", "/api/v1/cloud/account/pwa-context/")
        self.assertEqual(resp.status_code, 503, "account/pwa-context/")

    def test_heartbeat_returns_503(self):
        resp = self._call("POST", "/api/v1/cloud/device/heartbeat/")
        self.assertEqual(resp.status_code, 503, "device/heartbeat/")

    def test_business_detail_returns_503(self):
        url = f"/api/v1/cloud/business/{self.biz.id}/"
        resp = self._call("GET", url)
        self.assertEqual(resp.status_code, 503, url)

    def test_business_license_returns_503(self):
        url = f"/api/v1/cloud/business/{self.biz.id}/license/"
        resp = self._call("GET", url)
        self.assertEqual(resp.status_code, 503, url)

    def test_member_list_returns_503(self):
        url = f"/api/v1/cloud/business/{self.biz.id}/members/"
        resp = self._call("GET", url)
        self.assertEqual(resp.status_code, 503, url)

    def test_member_detail_returns_503(self):
        url = f"/api/v1/cloud/business/{self.biz.id}/members/{self.m.id}/"
        resp = self._call("GET", url)
        self.assertEqual(resp.status_code, 503, url)

    def test_member_branches_returns_503(self):
        url = f"/api/v1/cloud/business/{self.biz.id}/members/{self.m.id}/branches/"
        resp = self._call("GET", url)
        self.assertEqual(resp.status_code, 503, url)

    def test_member_branch_delete_returns_503(self):
        url = (
            f"/api/v1/cloud/business/{self.biz.id}/members/{self.m.id}"
            f"/branches/{self.branch.id}/"
        )
        resp = self._call("DELETE", url)
        self.assertEqual(resp.status_code, 503, url)

    def test_device_list_returns_503(self):
        url = f"/api/v1/cloud/business/{self.biz.id}/devices/"
        resp = self._call("GET", url)
        self.assertEqual(resp.status_code, 503, url)

    def test_device_register_returns_503(self):
        url = f"/api/v1/cloud/business/{self.biz.id}/devices/register/"
        resp = self._call("POST", url)
        self.assertEqual(resp.status_code, 503, url)

    def test_device_detail_returns_503(self):
        url = f"/api/v1/cloud/business/{self.biz.id}/devices/{self.device.id}/"
        resp = self._call("GET", url)
        self.assertEqual(resp.status_code, 503, url)

    def test_device_revoke_returns_503(self):
        url = f"/api/v1/cloud/business/{self.biz.id}/devices/{self.device.id}/revoke/"
        resp = self._call("POST", url)
        self.assertEqual(resp.status_code, 503, url)

    def test_audit_log_returns_503(self):
        url = f"/api/v1/cloud/business/{self.biz.id}/audit/"
        resp = self._call("GET", url)
        self.assertEqual(resp.status_code, 503, url)

    def test_503_response_code_field(self):
        """503 response must include a machine-readable error code."""
        resp = self._call("GET", "/api/v1/cloud/status/")
        self.assertEqual(resp.status_code, 503)
        # DRF serialises APIException as {"detail": ErrorDetail(code="cloud_unavailable")}
        # The code lives on the ErrorDetail object, not as a separate top-level key.
        detail = resp.data.get("detail")
        self.assertIsNotNone(detail, "Expected 'detail' in response")
        self.assertEqual(
            getattr(detail, "code", None), "cloud_unavailable",
            f"Expected code='cloud_unavailable', got: {detail!r}",
        )

    def test_unauthenticated_request_also_gets_503_not_401(self):
        """
        CloudEnabledMixin fires in initial() before DRF authentication runs,
        so even unauthenticated requests get 503 when the cloud is disabled.
        """
        c = APIClient()
        resp = c.get("/api/v1/cloud/status/")
        self.assertEqual(resp.status_code, 503)


# ══════════════════════════════════════════════════════════════════════════════
# 2.  CLOUD_ENABLED=True → endpoints are reachable (existing behaviour)
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(CLOUD_ENABLED=True)
class TestCloudEndpointsReachableWhenEnabled(TestCase):
    """
    Smoke-test that key endpoints return something other than 503 when enabled.
    Full behavioural tests live in test_api.py and test_stage62b.py.
    """

    def setUp(self):
        self.user = make_user("flag_on_user")
        self.biz  = make_business(owner=self.user)
        make_license(self.biz)
        self.m    = make_membership(self.user, self.biz)
        make_cloud_profile(self.user)
        self.device, self.raw = make_device(self.biz, self.m)
        self.c = jwt_client(self.user)

    def test_status_not_503(self):
        resp = self.c.get("/api/v1/cloud/status/")
        self.assertNotEqual(resp.status_code, 503)

    def test_account_not_503(self):
        resp = self.c.get("/api/v1/cloud/account/")
        self.assertNotEqual(resp.status_code, 503)

    def test_account_businesses_not_503(self):
        resp = self.c.get("/api/v1/cloud/account/businesses/")
        self.assertNotEqual(resp.status_code, 503)

    def test_business_detail_not_503(self):
        resp = self.c.get(f"/api/v1/cloud/business/{self.biz.id}/")
        self.assertNotEqual(resp.status_code, 503)

    def test_member_list_not_503(self):
        resp = self.c.get(f"/api/v1/cloud/business/{self.biz.id}/members/")
        self.assertNotEqual(resp.status_code, 503)

    def test_device_list_not_503(self):
        resp = self.c.get(f"/api/v1/cloud/business/{self.biz.id}/devices/")
        self.assertNotEqual(resp.status_code, 503)

    def test_heartbeat_not_503_with_device_token(self):
        c = device_client(self.raw)
        resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertNotEqual(resp.status_code, 503)

    def test_audit_log_not_503(self):
        resp = self.c.get(f"/api/v1/cloud/business/{self.biz.id}/audit/")
        self.assertNotEqual(resp.status_code, 503)

    def test_license_endpoint_not_503(self):
        resp = self.c.get(f"/api/v1/cloud/business/{self.biz.id}/license/")
        self.assertNotEqual(resp.status_code, 503)


# ══════════════════════════════════════════════════════════════════════════════
# 3.  Local POS endpoints unaffected when CLOUD_ENABLED=False
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(CLOUD_ENABLED=False)
class TestLocalPOSUnaffectedByCloudDisabled(TestCase):
    """
    Disabling cloud must not touch any non-cloud endpoint.
    Tests representative routes from every major local POS area.
    """

    def setUp(self):
        self.user = make_user("local_pos_user")
        self.biz  = make_business(owner=self.user)
        make_license(self.biz)
        # Attach user to business so local POS middleware is happy
        self.user.business = self.biz
        self.user.save()

    def test_health_endpoint_accessible(self):
        c = APIClient()
        resp = c.get("/api/v1/health/")
        self.assertEqual(resp.status_code, 200)

    def test_ping_endpoint_accessible(self):
        c = APIClient()
        resp = c.get("/api/v1/ping/")
        self.assertEqual(resp.status_code, 200)

    def test_auth_login_not_503(self):
        """Login must never return 503 regardless of CLOUD_ENABLED."""
        c = APIClient()
        resp = c.post(
            "/api/v1/auth/login/",
            {"username": "local_pos_user", "password": "Pass123!"},
            format="json",
        )
        self.assertNotEqual(resp.status_code, 503)

    def test_local_licensing_status_not_503(self):
        """Local licensing endpoint must work regardless of CLOUD_ENABLED."""
        c = APIClient()
        c.force_authenticate(user=self.user)
        resp = c.get("/api/v1/licensing/status/")
        self.assertNotEqual(resp.status_code, 503)

    def test_sync_status_not_503(self):
        """Sync endpoint must work regardless of CLOUD_ENABLED."""
        c = APIClient()
        c.force_authenticate(user=self.user)
        resp = c.get("/api/sync/status/")
        self.assertNotEqual(resp.status_code, 503)

    def test_businesses_endpoint_not_503(self):
        """Local business endpoint must work regardless of CLOUD_ENABLED."""
        c = APIClient()
        c.force_authenticate(user=self.user)
        resp = c.get("/api/v1/businesses/")
        self.assertNotEqual(resp.status_code, 503)

    def test_branches_endpoint_not_503(self):
        c = APIClient()
        c.force_authenticate(user=self.user)
        resp = c.get("/api/v1/branches/")
        self.assertNotEqual(resp.status_code, 503)

    def test_products_endpoint_not_503(self):
        c = APIClient()
        c.force_authenticate(user=self.user)
        resp = c.get("/api/v1/products/")
        self.assertNotEqual(resp.status_code, 503)

    def test_sales_endpoint_not_503(self):
        c = APIClient()
        c.force_authenticate(user=self.user)
        resp = c.get("/api/v1/sales/")
        self.assertNotEqual(resp.status_code, 503)

    def test_inventory_endpoint_not_503(self):
        c = APIClient()
        c.force_authenticate(user=self.user)
        resp = c.get("/api/v1/inventory/")
        self.assertNotEqual(resp.status_code, 503)

    def test_cloud_endpoints_are_503_but_others_are_not(self):
        """
        Verify the 503 is strictly contained to /api/v1/cloud/.
        """
        c = APIClient()
        c.force_authenticate(user=self.user)

        cloud_resp = c.get("/api/v1/cloud/status/")
        self.assertEqual(cloud_resp.status_code, 503)

        health_resp = c.get("/api/v1/health/")
        self.assertEqual(health_resp.status_code, 200)


# ══════════════════════════════════════════════════════════════════════════════
# 4.  Device authentication auditing
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(CLOUD_ENABLED=True)
class TestDeviceAuthenticationAuditing(TestCase):
    """
    Tests for DEVICE_AUTH_FAILED audit logging introduced in Stage 6.2B.1.
    """

    def setUp(self):
        self.user   = make_user("audit_user")
        self.biz    = make_business(owner=self.user)
        make_license(self.biz)
        self.m      = make_membership(self.user, self.biz)
        make_cloud_profile(self.user)
        self.device, self.raw = make_device(self.biz, self.m)

    def _audit_count(self):
        return CloudAuditLog.objects.filter(
            action=CloudAuditLog.Action.DEVICE_AUTH_FAILED
        ).count()

    # ── Valid token — no DEVICE_AUTH_FAILED ───────────────────────────────────

    def test_valid_token_does_not_create_auth_failed_audit(self):
        before = self._audit_count()
        c = device_client(self.raw)
        resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self._audit_count(), before)

    # ── Invalid token — audit created, 401 returned ───────────────────────────

    def test_invalid_token_returns_401(self):
        c = device_client("completely_wrong_token_xyz")
        resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertEqual(resp.status_code, 401)

    def test_invalid_token_creates_auth_failed_audit(self):
        before = self._audit_count()
        c = device_client("bad_token_abc")
        c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertEqual(self._audit_count(), before + 1)

    def test_invalid_token_audit_has_correct_action(self):
        c = device_client("invalid_token_999")
        c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        entry = CloudAuditLog.objects.filter(
            action=CloudAuditLog.Action.DEVICE_AUTH_FAILED
        ).order_by("-created_at").first()
        self.assertIsNotNone(entry)
        self.assertEqual(entry.metadata.get("authentication_method"), "device")
        self.assertEqual(entry.metadata.get("result"), "failed")
        self.assertEqual(
            entry.metadata.get("reason"), "no_matching_active_device"
        )

    def test_invalid_token_audit_never_contains_raw_token(self):
        raw = "super_secret_bad_token_do_not_log"
        c = device_client(raw)
        c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        entry = CloudAuditLog.objects.filter(
            action=CloudAuditLog.Action.DEVICE_AUTH_FAILED
        ).order_by("-created_at").first()
        self.assertIsNotNone(entry)
        meta_str = str(entry.metadata)
        self.assertNotIn(raw, meta_str)

    def test_invalid_token_audit_never_contains_token_hash(self):
        """Even the hash of the token must not appear in audit metadata."""
        import hashlib
        raw = "another_bad_token_hash_check"
        token_hash = hashlib.sha256(raw.encode()).hexdigest()
        c = device_client(raw)
        c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        entry = CloudAuditLog.objects.filter(
            action=CloudAuditLog.Action.DEVICE_AUTH_FAILED
        ).order_by("-created_at").first()
        self.assertIsNotNone(entry)
        meta_str = str(entry.metadata)
        self.assertNotIn(token_hash, meta_str)

    # ── Revoked device ────────────────────────────────────────────────────────

    def test_revoked_device_returns_401(self):
        self.device.revoke(revoked_by=self.user)
        c = device_client(self.raw)
        resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertEqual(resp.status_code, 401)

    def test_revoked_device_creates_auth_failed_audit(self):
        self.device.revoke(revoked_by=self.user)
        before = self._audit_count()
        c = device_client(self.raw)
        c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        # Revoked device has blank token_hash → falls under no_matching_active_device
        self.assertEqual(self._audit_count(), before + 1)

    # ── Inactive business ─────────────────────────────────────────────────────

    def test_inactive_business_returns_401(self):
        self.biz.is_active = False
        self.biz.save()
        c = device_client(self.raw)
        resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertEqual(resp.status_code, 401)

    def test_inactive_business_creates_auth_failed_audit_with_reason(self):
        self.biz.is_active = False
        self.biz.save()
        before = self._audit_count()
        c = device_client(self.raw)
        c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertEqual(self._audit_count(), before + 1)
        entry = CloudAuditLog.objects.filter(
            action=CloudAuditLog.Action.DEVICE_AUTH_FAILED
        ).order_by("-created_at").first()
        self.assertEqual(entry.metadata.get("reason"), "business_inactive")
        self.assertEqual(str(entry.metadata.get("device_uuid")),
                         str(self.device.device_uuid))

    def test_inactive_business_audit_never_exposes_secrets(self):
        self.biz.is_active = False
        self.biz.save()
        c = device_client(self.raw)
        c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        entry = CloudAuditLog.objects.filter(
            action=CloudAuditLog.Action.DEVICE_AUTH_FAILED
        ).order_by("-created_at").first()
        meta_str = str(entry.metadata)
        self.assertNotIn(self.raw, meta_str)
        self.assertNotIn(self.device.token_hash, meta_str)

    # ── Inactive membership ───────────────────────────────────────────────────

    def test_inactive_membership_returns_401(self):
        self.m.status = BusinessMembership.MemberStatus.SUSPENDED
        self.m.save()
        c = device_client(self.raw)
        resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertEqual(resp.status_code, 401)

    def test_inactive_membership_creates_auth_failed_audit(self):
        self.m.status = BusinessMembership.MemberStatus.SUSPENDED
        self.m.save()
        before = self._audit_count()
        c = device_client(self.raw)
        c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertEqual(self._audit_count(), before + 1)
        entry = CloudAuditLog.objects.filter(
            action=CloudAuditLog.Action.DEVICE_AUTH_FAILED
        ).order_by("-created_at").first()
        self.assertEqual(entry.metadata.get("reason"), "membership_not_active")

    # ── Missing Device header (JWT fall-through) ──────────────────────────────

    def test_missing_device_header_does_not_create_auth_failed_audit(self):
        """
        A request with no Device header is a legitimate JWT-path request,
        not an authentication failure. No DEVICE_AUTH_FAILED row must be created.
        """
        before = self._audit_count()
        # Use JWT auth (no Device header)
        c = jwt_client(self.user)
        c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertEqual(self._audit_count(), before)

    # ── Malformed authorization header ───────────────────────────────────────

    def test_malformed_device_header_returns_401(self):
        """Device header with wrong format (no token part) is rejected."""
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION="Device")   # missing token
        resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        # No Device token extracted → falls through to JWT backend → 401
        self.assertIn(resp.status_code, [401, 403])

    def test_malformed_bearer_header_does_not_trigger_device_auth(self):
        """Bearer JWT header must not trigger DeviceTokenAuthentication."""
        before = self._audit_count()
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION="Bearer not.a.real.jwt")
        c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        # No DEVICE_AUTH_FAILED — different scheme entirely
        self.assertEqual(self._audit_count(), before)

    # ── Generic error message (no info leakage) ───────────────────────────────

    def test_error_response_is_generic_regardless_of_failure_reason(self):
        """
        The client-facing 401 message must always be the same generic string,
        not reveal which check failed (revoked, inactive business, etc.).
        """
        expected = "Invalid or expired device credentials."

        # Invalid token
        r1 = device_client("wrong1").post(
            "/api/v1/cloud/device/heartbeat/", {}, format="json"
        )
        # Inactive business
        self.biz.is_active = False
        self.biz.save()
        r2 = device_client(self.raw).post(
            "/api/v1/cloud/device/heartbeat/", {}, format="json"
        )
        self.biz.is_active = True
        self.biz.save()

        for resp in (r1, r2):
            detail = str(resp.data.get("detail", ""))
            self.assertEqual(detail, expected)


# ══════════════════════════════════════════════════════════════════════════════
# 5.  Heartbeat does NOT flood audit log
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(CLOUD_ENABLED=True)
class TestHeartbeatDoesNotFloodAuditLog(TestCase):
    """
    Repeated successful heartbeats must not create DEVICE_AUTH_FAILED or
    DEVICE_HEARTBEAT audit rows every call.
    """

    def setUp(self):
        self.user   = make_user("hb_audit_user")
        self.biz    = make_business(owner=self.user)
        make_license(self.biz)
        self.m      = make_membership(self.user, self.biz)
        make_cloud_profile(self.user)
        self.device, self.raw = make_device(self.biz, self.m)

    def test_repeated_heartbeat_does_not_create_auth_failed_rows(self):
        c = device_client(self.raw)
        for _ in range(5):
            c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        count = CloudAuditLog.objects.filter(
            action=CloudAuditLog.Action.DEVICE_AUTH_FAILED
        ).count()
        self.assertEqual(count, 0)

    def test_repeated_heartbeat_does_not_create_heartbeat_audit_rows(self):
        c = device_client(self.raw)
        for _ in range(5):
            c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        count = CloudAuditLog.objects.filter(
            action=CloudAuditLog.Action.DEVICE_HEARTBEAT
        ).count()
        self.assertEqual(count, 0)

    def test_heartbeat_only_updates_last_seen(self):
        """Side-effect of heartbeat is updating last_seen — not audit rows."""
        c = device_client(self.raw)
        c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.device.refresh_from_db()
        self.assertIsNotNone(self.device.last_seen)
        total_audit = CloudAuditLog.objects.count()
        self.assertEqual(total_audit, 0)


# ══════════════════════════════════════════════════════════════════════════════
# 6.  PWA_ENABLED semantics are separate from CLOUD_ENABLED
# ══════════════════════════════════════════════════════════════════════════════

class TestPWAFlagSeparateFromCloudFlag(TestCase):
    """
    PWA_ENABLED is a future gate for PWA-specific functionality.
    Disabling it must NOT disable ordinary cloud account/device endpoints.
    """

    def setUp(self):
        self.user = make_user("pwa_flag_user")
        self.biz  = make_business(owner=self.user)
        make_license(self.biz)
        make_membership(self.user, self.biz)
        make_cloud_profile(self.user)
        self.c = jwt_client(self.user)

    @override_settings(CLOUD_ENABLED=True, PWA_ENABLED=False)
    def test_cloud_enabled_pwa_disabled_status_still_works(self):
        """Cloud-level status endpoint must work even if PWA is disabled."""
        resp = self.c.get("/api/v1/cloud/status/")
        self.assertNotEqual(resp.status_code, 503)

    @override_settings(CLOUD_ENABLED=True, PWA_ENABLED=True)
    def test_both_enabled_status_works(self):
        resp = self.c.get("/api/v1/cloud/status/")
        self.assertNotEqual(resp.status_code, 503)

    @override_settings(CLOUD_ENABLED=False, PWA_ENABLED=True)
    def test_cloud_disabled_pwa_enabled_still_returns_503(self):
        """If cloud is off, PWA_ENABLED=True can't override it."""
        resp = self.c.get("/api/v1/cloud/status/")
        self.assertEqual(resp.status_code, 503)

    @override_settings(CLOUD_ENABLED=False, PWA_ENABLED=False)
    def test_both_disabled_returns_503(self):
        resp = self.c.get("/api/v1/cloud/status/")
        self.assertEqual(resp.status_code, 503)


# ══════════════════════════════════════════════════════════════════════════════
# 7.  CloudAPIView inheritance — structural check
# ══════════════════════════════════════════════════════════════════════════════

class TestCloudAPIViewInheritance(TestCase):
    """
    Structural tests confirming every cloud view inherits CloudAPIView
    (which carries CloudEnabledMixin).
    """

    def test_all_cloud_views_inherit_cloud_api_view(self):
        from cloud.feature_flags import CloudAPIView, CloudEnabledMixin
        import cloud.views as cv

        view_classes = [
            cv.CloudStatusView,
            cv.CloudAccountView,
            cv.MyBusinessesView,
            cv.PWAContextView,
            cv.CloudBusinessView,
            cv.MemberListView,
            cv.MemberDetailView,
            cv.MemberBranchView,
            cv.MemberBranchDetailView,
            cv.DeviceListView,
            cv.DeviceRegisterView,
            cv.DeviceDetailView,
            cv.DeviceRevokeView,
            cv.AuditLogView,
            cv.DeviceHeartbeatView,
            cv.CloudLicenseStatusView,
        ]

        for view_cls in view_classes:
            self.assertTrue(
                issubclass(view_cls, CloudAPIView),
                f"{view_cls.__name__} does not inherit CloudAPIView",
            )
            self.assertTrue(
                issubclass(view_cls, CloudEnabledMixin),
                f"{view_cls.__name__} does not inherit CloudEnabledMixin "
                f"(should come via CloudAPIView)",
            )

    def test_cloud_api_view_is_also_api_view(self):
        from cloud.feature_flags import CloudAPIView
        from rest_framework.views import APIView
        self.assertTrue(issubclass(CloudAPIView, APIView))

    def test_cloud_api_view_initial_raises_503_when_disabled(self):
        """Directly test that CloudAPIView.initial() blocks when disabled."""
        from cloud.feature_flags import CloudAPIView, CloudServiceUnavailable
        from unittest.mock import MagicMock
        view = CloudAPIView()
        request = MagicMock()
        with self.settings(CLOUD_ENABLED=False):
            with self.assertRaises(CloudServiceUnavailable):
                view.initial(request)
