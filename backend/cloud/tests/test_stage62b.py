"""
cloud/tests/test_stage62b.py
============================
Comprehensive Stage 6.2B tests covering:

  - Device token authentication (valid, invalid, missing, revoked, wrong business)
  - Device registration security (token returned once, hash stored, not plaintext)
  - Device revocation (token unusable, heartbeat rejected)
  - Device heartbeat (updates last_seen, returns license status, invalid rejected)
  - License integration (active, expired, lifetime, unactivated, no license)
  - Cloud flag enforcement (CLOUD_ENABLED=False → 503, does not break local POS)
  - Business isolation (cross-business device/license access rejected)
  - Offline safety (local POS endpoints unaffected by cloud layer)
  - Middleware bypass (cloud endpoints bypass LicenseCheckMiddleware)
"""

from datetime import date, timedelta
from unittest import mock

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
from cloud.authentication import DeviceTokenAuthentication, DEVICE_AUTH_SCHEME
from cloud.license_service import CloudLicenseService
from cloud.feature_flags import (
    is_cloud_enabled, require_cloud_enabled, CloudServiceUnavailable,
)

User = get_user_model()


# ── Shared helpers ─────────────────────────────────────────────────────────────

def make_user(username, password="Pass123!", **kwargs):
    return User.objects.create_user(
        username=username, password=password,
        email=f"{username}@test.com", **kwargs,
    )


def make_business(name="Test Corp", owner=None):
    return Business.objects.create(name=name, owner=owner)


def make_license(business, license_type=License.LicenseType.SUBSCRIPTION,
                 lic_status=License.Status.ACTIVE,
                 days_ahead=365):
    expiry = date.today() + timedelta(days=days_ahead) \
             if license_type == License.LicenseType.SUBSCRIPTION else None
    return License.objects.create(
        business=business,
        license_type=license_type,
        status=lic_status,
        expiry_date=expiry,
        start_date=date.today() if lic_status == License.Status.ACTIVE else None,
    )


def make_membership(user, business, role=BusinessMembership.RoleLabel.OWNER,
                    mem_status=BusinessMembership.MemberStatus.ACTIVE,
                    pwa_access=True):
    return BusinessMembership.objects.create(
        user=user, business=business, role_label=role,
        status=mem_status, pwa_access=pwa_access,
    )


def make_cloud_profile(user, pwa_enabled=True,
                       acct_status=CloudProfile.AccountStatus.ACTIVE):
    p = CloudProfile.get_or_create_for(user)
    p.pwa_access_enabled = pwa_enabled
    p.account_status = acct_status
    p.save()
    return p


def make_device(business, membership, name="Till 1"):
    """Create a CloudDevice and return (device, raw_token)."""
    raw = CloudDevice.generate_token()
    device = CloudDevice.objects.create(
        business=business,
        membership=membership,
        name=name,
        device_type=CloudDevice.DeviceType.POS_TERMINAL,
        status=CloudDevice.DeviceStatus.ACTIVE,
    )
    device.set_token(raw)
    device.save()
    return device, raw


def device_client(raw_token):
    """APIClient pre-configured with Device auth header."""
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"{DEVICE_AUTH_SCHEME} {raw_token}")
    return c


def jwt_client(user):
    """APIClient authenticated via force_authenticate."""
    c = APIClient()
    c.force_authenticate(user=user)
    return c


# ══════════════════════════════════════════════════════════════════════════════
# 1. Device Token Authentication
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(CLOUD_ENABLED=True)
class TestDeviceTokenAuthentication(TestCase):

    def setUp(self):
        self.user = make_user("auth_user")
        self.biz  = make_business(owner=self.user)
        make_license(self.biz)
        self.m    = make_membership(self.user, self.biz)
        make_cloud_profile(self.user)
        self.device, self.raw = make_device(self.biz, self.m)

    def test_valid_device_token_authenticates(self):
        c = device_client(self.raw)
        resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(str(resp.data["device_uuid"]), str(self.device.device_uuid))

    def test_missing_token_returns_401(self):
        c = APIClient()  # no auth
        resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_invalid_token_returns_401(self):
        c = device_client("completelyWrongToken")
        resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_revoked_device_token_returns_401(self):
        self.device.revoke(revoked_by=self.user)
        c = device_client(self.raw)
        resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_suspended_device_token_returns_401(self):
        self.device.status = CloudDevice.DeviceStatus.SUSPENDED
        self.device.save()
        c = device_client(self.raw)
        resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_inactive_membership_blocks_device_auth(self):
        self.m.status = BusinessMembership.MemberStatus.SUSPENDED
        self.m.save()
        c = device_client(self.raw)
        resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_inactive_business_blocks_device_auth(self):
        self.biz.is_active = False
        self.biz.save()
        c = device_client(self.raw)
        resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_token_not_stored_as_plaintext(self):
        """token_hash must NOT equal the raw token."""
        self.assertNotEqual(self.device.token_hash, self.raw)
        self.assertTrue(len(self.device.token_hash) == 64)  # SHA-256 hex

    def test_device_authentication_does_not_expose_token_hash(self):
        """Heartbeat response must never include token_hash or raw token."""
        c = device_client(self.raw)
        resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        resp_str = str(resp.data)
        self.assertNotIn(self.raw, resp_str)
        self.assertNotIn(self.device.token_hash, resp_str)

    def test_device_from_business_a_cannot_authenticate_against_business_b(self):
        """Device A must only work for the business it was registered to."""
        user_b = make_user("biz_b_owner")
        biz_b  = make_business(name="Biz B", owner=user_b)
        make_license(biz_b)
        m_b    = make_membership(user_b, biz_b)
        make_cloud_profile(user_b)

        # Register device to biz_b
        device_b, raw_b = make_device(biz_b, m_b, name="Biz B Terminal")

        # Token from biz_b works for biz_b heartbeat
        c = device_client(raw_b)
        resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(str(resp.data["business_id"]), str(biz_b.id))

        # Token from biz_a doesn't work for biz_b (different token)
        c2 = device_client(self.raw)
        resp2 = c2.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        # Still 200 but pointing to biz_a — NOT biz_b
        self.assertEqual(resp2.status_code, status.HTTP_200_OK)
        self.assertEqual(str(resp2.data["business_id"]), str(self.biz.id))

    def test_authentication_backend_returns_none_for_bearer_scheme(self):
        """DeviceTokenAuthentication must return None (not fail) for JWT Bearer."""
        from django.test import RequestFactory
        factory = RequestFactory()
        req = factory.get("/", HTTP_AUTHORIZATION="Bearer some.jwt.token")
        # Wrap in DRF request
        from rest_framework.request import Request
        from rest_framework.parsers import JSONParser
        drf_req = Request(req, parsers=[JSONParser()])
        backend = DeviceTokenAuthentication()
        result = backend.authenticate(drf_req)
        self.assertIsNone(result)

    def test_authentication_backend_returns_none_for_no_header(self):
        from django.test import RequestFactory
        factory = RequestFactory()
        req = factory.get("/")
        from rest_framework.request import Request
        from rest_framework.parsers import JSONParser
        drf_req = Request(req, parsers=[JSONParser()])
        backend = DeviceTokenAuthentication()
        result = backend.authenticate(drf_req)
        self.assertIsNone(result)


# ══════════════════════════════════════════════════════════════════════════════
# 2. Device Registration Security
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(CLOUD_ENABLED=True)
class TestDeviceRegistrationSecurity(TestCase):

    def setUp(self):
        self.user = make_user("reg_user")
        self.biz  = make_business(owner=self.user)
        make_license(self.biz)
        self.m    = make_membership(self.user, self.biz)
        make_cloud_profile(self.user)
        self.c    = jwt_client(self.user)

    def test_registration_returns_token_once(self):
        resp = self.c.post(
            f"/api/v1/cloud/business/{self.biz.id}/devices/register/",
            {"name": "POS 1", "device_type": "POS_TERMINAL"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertIn("token", resp.data)
        self.assertGreater(len(resp.data["token"]), 20)

    def test_token_hash_not_in_registration_response(self):
        resp = self.c.post(
            f"/api/v1/cloud/business/{self.biz.id}/devices/register/",
            {"name": "POS 2"},
            format="json",
        )
        self.assertNotIn("token_hash", resp.data)

    def test_token_hash_stored_not_plaintext(self):
        resp = self.c.post(
            f"/api/v1/cloud/business/{self.biz.id}/devices/register/",
            {"name": "POS 3"},
            format="json",
        )
        raw   = resp.data["token"]
        uuid  = resp.data["device_uuid"]
        dev   = CloudDevice.objects.get(device_uuid=uuid)
        self.assertNotEqual(dev.token_hash, raw)
        self.assertEqual(len(dev.token_hash), 64)
        self.assertTrue(dev.verify_token(raw))

    def test_token_hash_not_in_device_list(self):
        self.c.post(
            f"/api/v1/cloud/business/{self.biz.id}/devices/register/",
            {"name": "POS 4"},
            format="json",
        )
        resp = self.c.get(f"/api/v1/cloud/business/{self.biz.id}/devices/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        for d in resp.data:
            self.assertNotIn("token_hash", d)
            self.assertNotIn("token", d)

    def test_revoked_device_cannot_reregister_same_uuid(self):
        resp = self.c.post(
            f"/api/v1/cloud/business/{self.biz.id}/devices/register/",
            {"name": "POS 5"},
            format="json",
        )
        device_uuid = resp.data["device_uuid"]
        dev = CloudDevice.objects.get(device_uuid=device_uuid)
        dev.revoke(revoked_by=self.user)

        # Attempt re-registration with same UUID
        resp2 = self.c.post(
            f"/api/v1/cloud/business/{self.biz.id}/devices/register/",
            {"device_uuid": device_uuid, "name": "POS 5 retry"},
            format="json",
        )
        self.assertEqual(resp2.status_code, status.HTTP_403_FORBIDDEN)


# ══════════════════════════════════════════════════════════════════════════════
# 3. Device Revocation
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(CLOUD_ENABLED=True)
class TestDeviceRevocation(TestCase):

    def setUp(self):
        self.user   = make_user("rev_user")
        self.biz    = make_business(owner=self.user)
        make_license(self.biz)
        self.m      = make_membership(self.user, self.biz)
        make_cloud_profile(self.user)
        self.device, self.raw = make_device(self.biz, self.m)
        self.admin_c = jwt_client(self.user)

    def test_revoke_clears_token_hash(self):
        self.device.revoke(revoked_by=self.user)
        self.device.refresh_from_db()
        self.assertEqual(self.device.token_hash, "")
        self.assertEqual(self.device.status, CloudDevice.DeviceStatus.REVOKED)

    def test_revoked_device_cannot_heartbeat(self):
        self.admin_c.post(
            f"/api/v1/cloud/business/{self.biz.id}/devices/{self.device.id}/revoke/",
            format="json",
        )
        c = device_client(self.raw)
        resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_revoked_device_cannot_access_business_endpoints(self):
        self.device.revoke(revoked_by=self.user)
        c = device_client(self.raw)
        resp = c.get(f"/api/v1/cloud/business/{self.biz.id}/")
        self.assertIn(resp.status_code, [401, 403])

    def test_non_admin_cannot_revoke_another_users_device(self):
        cashier = make_user("cashier_rev")
        make_cloud_profile(cashier)
        cashier_m = make_membership(
            cashier, self.biz, role=BusinessMembership.RoleLabel.CASHIER
        )
        _, cashier_raw = make_device(self.biz, cashier_m, name="Cashier Device")
        cashier_c = jwt_client(cashier)

        resp = cashier_c.post(
            f"/api/v1/cloud/business/{self.biz.id}/devices/{self.device.id}/revoke/",
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_unauthorized_cross_business_revoke_rejected(self):
        user_b = make_user("other_rev")
        biz_b  = make_business(name="Other B")
        make_license(biz_b)
        m_b    = make_membership(user_b, biz_b)
        make_cloud_profile(user_b)
        dev_b, _ = make_device(biz_b, m_b)

        # user_b tries to revoke device in self.biz
        c = jwt_client(user_b)
        resp = c.post(
            f"/api/v1/cloud/business/{self.biz.id}/devices/{self.device.id}/revoke/",
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_revoked_device_preserved_in_audit_history(self):
        """Revocation audit record must persist after device is revoked."""
        self.admin_c.post(
            f"/api/v1/cloud/business/{self.biz.id}/devices/{self.device.id}/revoke/",
            format="json",
        )
        exists = CloudAuditLog.objects.filter(
            action=CloudAuditLog.Action.DEVICE_REVOKED,
            business=self.biz,
        ).exists()
        self.assertTrue(exists)


# ══════════════════════════════════════════════════════════════════════════════
# 4. Device Heartbeat
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(CLOUD_ENABLED=True)
class TestDeviceHeartbeat(TestCase):

    def setUp(self):
        self.user   = make_user("beat_user")
        self.biz    = make_business(owner=self.user)
        make_license(self.biz)
        self.m      = make_membership(self.user, self.biz)
        make_cloud_profile(self.user)
        self.device, self.raw = make_device(self.biz, self.m)

    def test_heartbeat_updates_last_seen(self):
        self.assertIsNone(self.device.last_seen)
        c = device_client(self.raw)
        resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.device.refresh_from_db()
        self.assertIsNotNone(self.device.last_seen)

    def test_heartbeat_updates_app_version(self):
        c = device_client(self.raw)
        c.post(
            "/api/v1/cloud/device/heartbeat/",
            {"app_version": "2.3.1"},
            format="json",
        )
        self.device.refresh_from_db()
        self.assertEqual(self.device.app_version, "2.3.1")

    def test_heartbeat_updates_device_name(self):
        c = device_client(self.raw)
        c.post(
            "/api/v1/cloud/device/heartbeat/",
            {"device_name": "Front Till"},
            format="json",
        )
        self.device.refresh_from_db()
        self.assertEqual(self.device.name, "Front Till")

    def test_heartbeat_response_shape(self):
        c = device_client(self.raw)
        resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        for key in ("device_uuid", "device_status", "business_id",
                    "business_name", "license_status", "cloud_access_ok",
                    "server_time"):
            self.assertIn(key, resp.data, f"Missing key: {key}")

    def test_heartbeat_license_status_never_includes_activation_code(self):
        c = device_client(self.raw)
        resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        resp_str = str(resp.data)
        self.assertNotIn("activation_code", resp_str)

    def test_heartbeat_returns_license_is_active_true_for_active_license(self):
        c = device_client(self.raw)
        resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertTrue(resp.data["license_status"]["is_active"])
        self.assertTrue(resp.data["cloud_access_ok"])

    def test_heartbeat_returns_cloud_access_false_for_expired_license(self):
        # Expire the license
        lic = License.objects.get(business=self.biz)
        lic.expiry_date = date.today() - timedelta(days=1)
        lic.status = License.Status.EXPIRED
        lic.save()

        c = device_client(self.raw)
        resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        # cloud_access_ok is False but the endpoint still responds (non-blocking)
        self.assertFalse(resp.data["cloud_access_ok"])
        self.assertFalse(resp.data["license_status"]["is_active"])

    def test_heartbeat_is_idempotent(self):
        """Calling heartbeat many times is safe and non-destructive."""
        c = device_client(self.raw)
        for _ in range(5):
            resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
            self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_revoked_device_heartbeat_rejected(self):
        self.device.revoke(revoked_by=self.user)
        c = device_client(self.raw)
        resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_invalid_token_heartbeat_rejected(self):
        c = device_client("not_a_real_token")
        resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)


# ══════════════════════════════════════════════════════════════════════════════
# 5. License Integration (CloudLicenseService)
# ══════════════════════════════════════════════════════════════════════════════

class TestCloudLicenseService(TestCase):

    def setUp(self):
        self.owner = make_user("lic_owner")
        self.biz   = make_business(owner=self.owner)

    def test_no_license_returns_found_false(self):
        lic_status = CloudLicenseService.get_status(self.biz)
        self.assertFalse(lic_status.found)
        self.assertFalse(lic_status.is_active)
        self.assertEqual(lic_status.license_state, "NO_LICENSE")

    def test_active_subscription_returns_is_active_true(self):
        make_license(self.biz)
        lic_status = CloudLicenseService.get_status(self.biz)
        self.assertTrue(lic_status.found)
        self.assertTrue(lic_status.is_active)
        self.assertEqual(lic_status.license_type, "SUBSCRIPTION")

    def test_expired_subscription_returns_is_active_false(self):
        lic = make_license(self.biz)
        lic.expiry_date = date.today() - timedelta(days=1)
        lic.status = License.Status.EXPIRED
        lic.save()
        lic_status = CloudLicenseService.get_status(self.biz)
        self.assertFalse(lic_status.is_active)
        self.assertEqual(lic_status.license_state, "EXPIRED")

    def test_lifetime_license_returns_is_lifetime_true_and_is_active(self):
        make_license(self.biz, license_type=License.LicenseType.LIFETIME)
        lic_status = CloudLicenseService.get_status(self.biz)
        self.assertTrue(lic_status.is_lifetime)
        self.assertTrue(lic_status.is_active)
        self.assertIsNone(lic_status.days_remaining)

    def test_pending_license_returns_is_active_false(self):
        make_license(self.biz, lic_status=License.Status.PENDING)
        lic_status = CloudLicenseService.get_status(self.biz)
        self.assertFalse(lic_status.is_active)
        self.assertEqual(lic_status.license_state, "PENDING")

    def test_suspended_license_returns_is_active_false(self):
        make_license(self.biz, lic_status=License.Status.SUSPENDED)
        lic_status = CloudLicenseService.get_status(self.biz)
        self.assertFalse(lic_status.is_active)
        self.assertEqual(lic_status.license_state, "SUSPENDED")

    def test_revoked_license_returns_is_active_false(self):
        make_license(self.biz, lic_status=License.Status.REVOKED)
        lic_status = CloudLicenseService.get_status(self.biz)
        self.assertFalse(lic_status.is_active)

    def test_license_status_never_returns_activation_code(self):
        """as_dict() must never include activation_code."""
        make_license(self.biz)
        d = CloudLicenseService.get_status(self.biz).as_dict()
        self.assertNotIn("activation_code", d)
        self.assertNotIn("code", d)

    def test_auto_flip_active_to_expired(self):
        """refresh_expiry_status() must be called and flip ACTIVE→EXPIRED."""
        lic = make_license(self.biz)
        lic.expiry_date = date.today() - timedelta(days=1)
        # Leave status as ACTIVE — service should flip it
        lic.status = License.Status.ACTIVE
        lic.save()
        lic_status = CloudLicenseService.get_status(self.biz)
        self.assertFalse(lic_status.is_active)

    def test_is_cloud_access_permitted_returns_tuple(self):
        make_license(self.biz)
        allowed, lic_status = CloudLicenseService.is_cloud_access_permitted(self.biz)
        self.assertTrue(allowed)
        self.assertTrue(lic_status.is_active)

    def test_is_cloud_access_denied_for_no_license(self):
        allowed, lic_status = CloudLicenseService.is_cloud_access_permitted(self.biz)
        self.assertFalse(allowed)
        self.assertFalse(lic_status.is_active)


# ══════════════════════════════════════════════════════════════════════════════
# 6. Cloud License Status API Endpoint
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(CLOUD_ENABLED=True)
class TestCloudLicenseStatusEndpoint(TestCase):

    def setUp(self):
        self.owner = make_user("lic_api_owner")
        self.biz   = make_business(owner=self.owner)
        make_license(self.biz)
        self.m     = make_membership(self.owner, self.biz)
        make_cloud_profile(self.owner)
        self.c     = jwt_client(self.owner)

    def test_owner_can_read_license_status(self):
        resp = self.c.get(f"/api/v1/cloud/business/{self.biz.id}/license/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn("is_active", resp.data)
        self.assertIn("license_type", resp.data)
        self.assertIn("license_state", resp.data)
        self.assertIn("last_checked_at", resp.data)

    def test_license_endpoint_never_returns_activation_code(self):
        resp = self.c.get(f"/api/v1/cloud/business/{self.biz.id}/license/")
        resp_str = str(resp.data)
        self.assertNotIn("activation_code", resp_str)

    def test_cashier_cannot_read_license_status(self):
        cashier = make_user("cashier_lic")
        make_cloud_profile(cashier)
        make_membership(cashier, self.biz, role=BusinessMembership.RoleLabel.CASHIER)
        c = jwt_client(cashier)
        resp = c.get(f"/api/v1/cloud/business/{self.biz.id}/license/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_manager_cannot_read_license_status(self):
        mgr = make_user("manager_lic")
        make_cloud_profile(mgr)
        make_membership(mgr, self.biz, role=BusinessMembership.RoleLabel.MANAGER)
        c = jwt_client(mgr)
        resp = c.get(f"/api/v1/cloud/business/{self.biz.id}/license/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_cross_business_license_access_rejected(self):
        intruder = make_user("intruder_lic")
        other_biz = make_business(name="Other Biz Lic")
        make_license(other_biz)
        make_membership(intruder, other_biz)
        make_cloud_profile(intruder)
        c = jwt_client(intruder)
        resp = c.get(f"/api/v1/cloud/business/{self.biz.id}/license/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_device_token_can_read_own_business_license(self):
        device, raw = make_device(self.biz, self.m)
        c = device_client(raw)
        resp = c.get(f"/api/v1/cloud/business/{self.biz.id}/license/")
        # Device is OWNER-level membership → should succeed
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_lifetime_license_fields_correct(self):
        # Replace subscription with lifetime
        License.objects.filter(business=self.biz).delete()
        make_license(self.biz, license_type=License.LicenseType.LIFETIME)
        resp = self.c.get(f"/api/v1/cloud/business/{self.biz.id}/license/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(resp.data["is_lifetime"])
        self.assertIsNone(resp.data["days_remaining"])
        self.assertIsNone(resp.data["expires_at"])


# ══════════════════════════════════════════════════════════════════════════════
# 7. Cloud Flag Enforcement (CLOUD_ENABLED / PWA_ENABLED)
# ══════════════════════════════════════════════════════════════════════════════

class TestCloudFlagEnforcement(TestCase):

    def setUp(self):
        self.user = make_user("flag_user")
        self.biz  = make_business(owner=self.user)
        make_license(self.biz)
        self.m    = make_membership(self.user, self.biz)
        make_cloud_profile(self.user)
        self.c    = jwt_client(self.user)

    @override_settings(CLOUD_ENABLED=False)
    def test_cloud_status_returns_503_when_disabled(self):
        resp = self.c.get("/api/v1/cloud/status/")
        self.assertEqual(resp.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)

    @override_settings(CLOUD_ENABLED=True)
    def test_cloud_status_returns_200_when_enabled(self):
        resp = self.c.get("/api/v1/cloud/status/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    @override_settings(CLOUD_ENABLED=False)
    def test_heartbeat_returns_503_when_cloud_disabled(self):
        device, raw = make_device(self.biz, self.m)
        c = device_client(raw)
        resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)

    @override_settings(CLOUD_ENABLED=False)
    def test_license_endpoint_returns_503_when_cloud_disabled(self):
        resp = self.c.get(f"/api/v1/cloud/business/{self.biz.id}/license/")
        self.assertEqual(resp.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)

    def test_is_cloud_enabled_reflects_settings(self):
        with self.settings(CLOUD_ENABLED=True):
            self.assertTrue(is_cloud_enabled())
        with self.settings(CLOUD_ENABLED=False):
            self.assertFalse(is_cloud_enabled())

    def test_require_cloud_enabled_raises_when_false(self):
        with self.settings(CLOUD_ENABLED=False):
            with self.assertRaises(CloudServiceUnavailable):
                require_cloud_enabled()

    def test_require_cloud_enabled_no_raise_when_true(self):
        with self.settings(CLOUD_ENABLED=True):
            require_cloud_enabled()  # must not raise

    @override_settings(CLOUD_ENABLED=False)
    def test_local_pos_health_endpoint_unaffected_by_cloud_flag(self):
        """CLOUD_ENABLED=False must NOT break local POS health endpoint."""
        c = APIClient()
        resp = c.get("/api/v1/health/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    @override_settings(CLOUD_ENABLED=False)
    def test_local_pos_auth_unaffected_by_cloud_flag(self):
        """Login endpoint must still work when cloud is disabled."""
        c = APIClient()
        resp = c.post(
            "/api/v1/auth/login/",
            {"username": "flag_user", "password": "Pass123!"},
            format="json",
        )
        # Should return 200 (success) or 400 (wrong credentials) — NOT 503
        self.assertNotEqual(resp.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)


# ══════════════════════════════════════════════════════════════════════════════
# 8. Business Isolation
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(CLOUD_ENABLED=True)
class TestBusinessIsolation62B(TestCase):
    """
    Cross-business access must be rejected for all 6.2B endpoints.
    These tests extend the 6.2A isolation tests specifically for
    device tokens and license endpoints.
    """

    def setUp(self):
        # Biz A
        self.user_a = make_user("iso_user_a")
        self.biz_a  = make_business(name="Biz A Iso", owner=self.user_a)
        make_license(self.biz_a)
        self.m_a    = make_membership(self.user_a, self.biz_a)
        make_cloud_profile(self.user_a)
        self.dev_a, self.raw_a = make_device(self.biz_a, self.m_a)

        # Biz B
        self.user_b = make_user("iso_user_b")
        self.biz_b  = make_business(name="Biz B Iso", owner=self.user_b)
        make_license(self.biz_b)
        self.m_b    = make_membership(self.user_b, self.biz_b)
        make_cloud_profile(self.user_b)
        self.dev_b, self.raw_b = make_device(self.biz_b, self.m_b)

    def test_user_a_device_cannot_access_biz_b_license(self):
        c = device_client(self.raw_a)
        resp = c.get(f"/api/v1/cloud/business/{self.biz_b.id}/license/")
        self.assertIn(resp.status_code, [401, 403])

    def test_user_a_jwt_cannot_access_biz_b_license(self):
        c = jwt_client(self.user_a)
        resp = c.get(f"/api/v1/cloud/business/{self.biz_b.id}/license/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_user_b_jwt_cannot_access_biz_a_devices(self):
        c = jwt_client(self.user_b)
        resp = c.get(f"/api/v1/cloud/business/{self.biz_a.id}/devices/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_user_b_jwt_cannot_access_biz_a_audit(self):
        c = jwt_client(self.user_b)
        resp = c.get(f"/api/v1/cloud/business/{self.biz_a.id}/audit/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_device_a_heartbeat_reports_biz_a_not_biz_b(self):
        c = device_client(self.raw_a)
        resp = c.post("/api/v1/cloud/device/heartbeat/", {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(str(resp.data["business_id"]), str(self.biz_a.id))
        self.assertNotEqual(str(resp.data["business_id"]), str(self.biz_b.id))

    def test_changing_url_business_id_does_not_bypass_auth(self):
        """Manually constructing a URL with a different business_id must fail."""
        c = device_client(self.raw_a)  # device belongs to biz_a
        # Try to access biz_b's license using biz_a's device token
        resp = c.get(f"/api/v1/cloud/business/{self.biz_b.id}/license/")
        # device_a authenticates as biz_a's user, who has no membership in biz_b
        self.assertIn(resp.status_code, [401, 403])


# ══════════════════════════════════════════════════════════════════════════════
# 9. Offline Safety / Local POS Unaffected
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(CLOUD_ENABLED=False)
class TestOfflineSafety(TestCase):
    """
    Verify that disabling cloud features (CLOUD_ENABLED=False) or cloud
    failures do not block local POS operation.
    """

    def setUp(self):
        self.user = make_user("offline_user")
        self.biz  = make_business(owner=self.user)
        # Active license — local POS should continue working
        make_license(self.biz)
        # Attach user to business for local POS
        self.user.business = self.biz
        self.user.save()

    def test_health_endpoint_accessible_regardless_of_cloud_flag(self):
        c = APIClient()
        resp = c.get("/api/v1/health/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_ping_endpoint_accessible_regardless_of_cloud_flag(self):
        c = APIClient()
        resp = c.get("/api/v1/ping/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_local_login_unaffected_by_cloud_disabled(self):
        c = APIClient()
        resp = c.post(
            "/api/v1/auth/login/",
            {"username": "offline_user", "password": "Pass123!"},
            format="json",
        )
        self.assertNotEqual(resp.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)

    def test_sync_endpoint_unaffected_by_cloud_disabled(self):
        """Sync endpoints bypass LicenseCheckMiddleware AND cloud flags."""
        c = APIClient()
        c.force_authenticate(user=self.user)
        resp = c.get("/api/sync/status/")
        # Should return 200 (not 503)
        self.assertNotEqual(resp.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)

    def test_licensing_endpoint_unaffected_by_cloud_disabled(self):
        """Local licensing endpoint must work when cloud is disabled."""
        c = APIClient()
        c.force_authenticate(user=self.user)
        resp = c.get("/api/v1/licensing/status/")
        self.assertNotEqual(resp.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)

    def test_cloud_api_returns_503_when_disabled_not_pos_api(self):
        """Cloud endpoints return 503; local POS endpoints are unaffected."""
        c = APIClient()
        c.force_authenticate(user=self.user)

        # Cloud endpoint → 503
        cloud_resp = c.get("/api/v1/cloud/status/")
        self.assertEqual(cloud_resp.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)

        # Local POS endpoint → not 503
        health_resp = c.get("/api/v1/health/")
        self.assertEqual(health_resp.status_code, status.HTTP_200_OK)

    def test_license_check_middleware_bypasses_cloud_endpoints(self):
        """
        /api/v1/cloud/ is in BYPASS_PREFIXES so LicenseCheckMiddleware
        never blocks cloud requests — the cloud layer does its own checks.
        """
        from licensing.middleware import BYPASS_PREFIXES
        self.assertIn("/api/v1/cloud/", BYPASS_PREFIXES)


# ══════════════════════════════════════════════════════════════════════════════
# 10. SyncDevice Bridge
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(CLOUD_ENABLED=True)
class TestSyncDeviceBridge(TestCase):

    def setUp(self):
        self.user = make_user("sync_bridge_user")
        self.biz  = make_business(owner=self.user)
        make_license(self.biz)
        self.m    = make_membership(self.user, self.biz)
        make_cloud_profile(self.user)

    def test_cloud_device_has_sync_device_field(self):
        device, _ = make_device(self.biz, self.m)
        self.assertTrue(hasattr(device, "sync_device"))
        self.assertIsNone(device.sync_device)

    def test_sync_device_field_is_nullable(self):
        """sync_device FK is null=True — does not break existing devices."""
        device, _ = make_device(self.biz, self.m)
        # Can save without sync_device
        device.name = "Updated Name"
        device.save()
        device.refresh_from_db()
        self.assertIsNone(device.sync_device)

    def test_can_link_sync_device_to_cloud_device(self):
        from synchronization.models import SyncDevice
        import uuid
        sync_dev = SyncDevice.objects.create(
            device_id=uuid.uuid4(),
            name="Local POS Sync Device",
            business_id=self.biz.id,
        )
        device, _ = make_device(self.biz, self.m)
        device.sync_device = sync_dev
        device.save()
        device.refresh_from_db()
        self.assertEqual(device.sync_device, sync_dev)


# ══════════════════════════════════════════════════════════════════════════════
# 11. Stage 6.2A regression — existing tests still pass
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(CLOUD_ENABLED=True)
class TestStage62ARegressionChecks(TestCase):
    """
    Smoke-test key Stage 6.2A behaviours to ensure 6.2B changes
    don't break what was already working.
    """

    def setUp(self):
        self.user = make_user("regression_user")
        self.biz  = make_business(owner=self.user)
        make_license(self.biz)
        make_membership(self.user, self.biz, role=BusinessMembership.RoleLabel.OWNER)
        make_cloud_profile(self.user)
        self.c    = jwt_client(self.user)

    def test_cloud_status_still_works(self):
        resp = self.c.get("/api/v1/cloud/status/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_pwa_context_still_works(self):
        resp = self.c.get("/api/v1/cloud/account/pwa-context/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn("businesses", resp.data)

    def test_member_list_still_works(self):
        resp = self.c.get(f"/api/v1/cloud/business/{self.biz.id}/members/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_audit_log_still_works(self):
        resp = self.c.get(f"/api/v1/cloud/business/{self.biz.id}/audit/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_device_register_still_works(self):
        resp = self.c.post(
            f"/api/v1/cloud/business/{self.biz.id}/devices/register/",
            {"name": "Regression Till"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertIn("token", resp.data)

    def test_new_audit_action_choices_importable(self):
        """New CloudAuditLog.Action choices must be importable and usable."""
        from cloud.models import CloudAuditLog as CAL
        actions = [
            CAL.Action.DEVICE_AUTH_FAILED,
            CAL.Action.DEVICE_HEARTBEAT,
            CAL.Action.LICENSE_VERIFIED_OK,
            CAL.Action.LICENSE_VERIFIED_FAIL,
            CAL.Action.CLOUD_ACCESS_DENIED,
        ]
        for a in actions:
            self.assertIsNotNone(a)
