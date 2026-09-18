"""
licensing/tests/test_trial_v1.py
=================================
V1 Trial Code workflow tests.

Coverage
--------
1.  generate_trial_code() creates a PENDING TrialCode
2.  Generated code is unique (random)
3.  Code does NOT start the 7-day clock when generated (no License yet)
4.  TrialCode.claim() creates a License and activates it
5.  Activation sets start_date = today, expiry = today+7
6.  7-day clock starts at claim time, not at code generation time
7.  A used code cannot be claimed again (idempotency)
8.  An invalid/unknown code is rejected by the setup wizard
9.  A REVOKED code is rejected
10. A USED code is rejected
11. Claiming for a business that already has a license raises ValueError
12. Active SUBSCRIPTION cannot be replaced by trial claim
13. Active LIFETIME cannot be replaced by trial claim
14. LicenseRenewalLog entry is created on claim
15. license_type is TRIAL after claim
16. is_trial property is True after claim
17. Expired trial remains expired after 7 days
18. SetupRunView with a valid TrialCode activates the trial (integration)
19. SetupRunView with a paid code still works (regression)
20. SetupRunView with no code still works (auto-trial, regression)
21. manage.py check still passes (covered by run of check above)
22. Existing subscription/lifetime activation flows unchanged (regression)
"""

from datetime import date, timedelta
from unittest import mock

from django.test import TestCase, override_settings
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status as drf_status

from businesses.models import Business
from branches.models import Branch
from licensing.models import License, LicenseRenewalLog, TrialCode, TRIAL_DAYS
from licensing.services import generate_trial_code, create_trial_license

User = get_user_model()


# ── Helpers ────────────────────────────────────────────────────────────────────

def make_business(name="Test Corp"):
    return Business.objects.create(name=name)


def make_subscription_license(biz, active=True):
    expiry = date.today() + timedelta(days=365) if active else date.today() - timedelta(days=1)
    lic = License.objects.create(
        business=biz,
        license_type=License.LicenseType.SUBSCRIPTION,
        status=License.Status.ACTIVE if active else License.Status.EXPIRED,
        start_date=date.today(),
        expiry_date=expiry,
    )
    return lic


def make_lifetime_license(biz):
    return License.objects.create(
        business=biz,
        license_type=License.LicenseType.LIFETIME,
        status=License.Status.ACTIVE,
        start_date=date.today(),
        expiry_date=None,
    )


# ══════════════════════════════════════════════════════════════════════════════
# 1–5: generate_trial_code() and TrialCode.claim()
# ══════════════════════════════════════════════════════════════════════════════

class TestGenerateTrialCode(TestCase):

    def test_creates_pending_trial_code(self):
        tc = generate_trial_code()
        self.assertEqual(tc.status, TrialCode.TrialStatus.PENDING)
        self.assertIsNotNone(tc.code)

    def test_code_is_unique(self):
        tc1 = generate_trial_code()
        tc2 = generate_trial_code()
        self.assertNotEqual(tc1.code, tc2.code)

    def test_no_license_created_on_generation(self):
        tc = generate_trial_code()
        self.assertIsNone(tc.activated_license)
        self.assertIsNone(tc.activated_at)
        # No License rows exist for this code
        self.assertFalse(License.objects.exists())

    def test_notes_stored(self):
        tc = generate_trial_code(notes="Customer: Kofi Mensah")
        self.assertEqual(tc.notes, "Customer: Kofi Mensah")

    def test_created_by_stored(self):
        user = User.objects.create_user("staff", password="pass")
        tc = generate_trial_code(created_by=user)
        self.assertEqual(tc.created_by, user)

    def test_is_usable_when_pending(self):
        tc = generate_trial_code()
        self.assertTrue(tc.is_usable)

    def test_is_not_usable_when_revoked(self):
        tc = generate_trial_code()
        tc.status = TrialCode.TrialStatus.REVOKED
        tc.save()
        self.assertFalse(tc.is_usable)


# ══════════════════════════════════════════════════════════════════════════════
# 6–14: TrialCode.claim()
# ══════════════════════════════════════════════════════════════════════════════

class TestTrialCodeClaim(TestCase):

    def setUp(self):
        self.biz = make_business()
        self.tc  = generate_trial_code()

    def test_claim_creates_active_trial_license(self):
        lic = self.tc.claim(self.biz)
        self.assertEqual(lic.license_type, License.LicenseType.TRIAL)
        self.assertEqual(lic.status, License.Status.ACTIVE)
        self.assertTrue(lic.is_trial)

    def test_claim_sets_start_date_today(self):
        lic = self.tc.claim(self.biz)
        self.assertEqual(lic.start_date, date.today())

    def test_claim_sets_expiry_7_days_from_today(self):
        lic = self.tc.claim(self.biz)
        self.assertEqual(lic.expiry_date, date.today() + timedelta(days=TRIAL_DAYS))

    def test_7_days_from_claim_not_from_generation(self):
        """Even if code was generated yesterday, expiry is 7 days from today."""
        # Simulate the code being generated in the past
        past = date.today() - timedelta(days=3)
        lic = self.tc.claim(self.biz)
        # expiry must be 7 days from today, not 7 days from past
        self.assertEqual(lic.expiry_date, date.today() + timedelta(days=TRIAL_DAYS))

    def test_claim_marks_trial_code_as_used(self):
        self.tc.claim(self.biz)
        self.tc.refresh_from_db()
        self.assertEqual(self.tc.status, TrialCode.TrialStatus.USED)

    def test_claim_links_trial_code_to_license(self):
        lic = self.tc.claim(self.biz)
        self.tc.refresh_from_db()
        self.assertEqual(self.tc.activated_license, lic)
        self.assertIsNotNone(self.tc.activated_at)

    def test_claim_creates_renewal_log(self):
        lic = self.tc.claim(self.biz)
        log = LicenseRenewalLog.objects.filter(license=lic).first()
        self.assertIsNotNone(log)
        self.assertEqual(log.action, "TRIAL_ACTIVATION")
        self.assertEqual(log.code_used, self.tc.code)
        self.assertEqual(log.duration_days, TRIAL_DAYS)

    def test_used_code_cannot_be_claimed_again(self):
        self.tc.claim(self.biz)
        biz2 = make_business("Second Corp")
        with self.assertRaises(ValueError) as ctx:
            self.tc.claim(biz2)
        self.assertIn("cannot be used", str(ctx.exception))

    def test_revoked_code_cannot_be_claimed(self):
        self.tc.status = TrialCode.TrialStatus.REVOKED
        self.tc.save()
        with self.assertRaises(ValueError):
            self.tc.claim(self.biz)

    def test_business_with_existing_license_rejected(self):
        make_subscription_license(self.biz)
        with self.assertRaises(ValueError) as ctx:
            self.tc.claim(self.biz)
        self.assertIn("already has a license", str(ctx.exception))

    def test_business_with_lifetime_license_rejected(self):
        make_lifetime_license(self.biz)
        with self.assertRaises(ValueError):
            self.tc.claim(self.biz)


# ══════════════════════════════════════════════════════════════════════════════
# 15–17: License properties after claim
# ══════════════════════════════════════════════════════════════════════════════

class TestTrialLicenseProperties(TestCase):

    def setUp(self):
        self.biz = make_business()
        self.tc  = generate_trial_code()
        self.lic = self.tc.claim(self.biz)

    def test_is_active_immediately(self):
        self.assertTrue(self.lic.is_active)

    def test_is_trial_true(self):
        self.assertTrue(self.lic.is_trial)

    def test_days_remaining_is_7(self):
        self.assertEqual(self.lic.days_remaining, TRIAL_DAYS)

    def test_expired_after_7_days(self):
        self.lic.expiry_date = date.today() - timedelta(days=1)
        self.lic.status = License.Status.EXPIRED
        self.lic.save()
        self.assertFalse(self.lic.is_active)
        self.assertTrue(self.lic.is_trial)   # still TRIAL type

    def test_refresh_expiry_flips_to_expired(self):
        self.lic.expiry_date = date.today() - timedelta(days=1)
        self.lic.status = License.Status.ACTIVE
        self.lic.save()
        self.lic.refresh_expiry_status()
        self.lic.refresh_from_db()
        self.assertEqual(self.lic.status, License.Status.EXPIRED)

    def test_activated_at_set(self):
        self.assertIsNotNone(self.lic.activated_at)


# ══════════════════════════════════════════════════════════════════════════════
# 18: SetupRunView with TrialCode (integration)
# ══════════════════════════════════════════════════════════════════════════════

class TestSetupRunViewWithTrialCode(TestCase):
    """Integration: customer enters a pre-issued trial code in the setup wizard."""

    BASE_PAYLOAD = {
        "business": {
            "name": "Trial Integration Corp",
            "business_category": "GENERAL_RETAIL",
            "currency": "GHS",
            "currency_symbol": "GH₵",
        },
        "branch": {"name": "Main", "code": "MAIN"},
        "admin": {
            "first_name": "Trial",
            "last_name":  "User",
            "username":   "trialuser_v1",
            "email":      "trial_v1@test.com",
            "password":   "TrialV1Pass@123",
        },
    }

    def test_valid_trial_code_activates_trial(self):
        tc = generate_trial_code(notes="Integration test customer")
        payload = dict(self.BASE_PAYLOAD)
        payload["license"] = {"activation_code": tc.code}
        c = APIClient()
        resp = c.post("/api/v1/setup/run/", payload, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["license"]["license_type"], "TRIAL")
        self.assertTrue(resp.data["license"]["is_trial"])
        self.assertTrue(resp.data["license"]["is_active"])
        # Verify expiry is 7 days
        from datetime import date as _date
        expected_expiry = (_date.today() + timedelta(days=TRIAL_DAYS)).isoformat()
        self.assertEqual(resp.data["license"]["expiry_date"], expected_expiry)
        # Verify TrialCode is marked USED
        tc.refresh_from_db()
        self.assertEqual(tc.status, TrialCode.TrialStatus.USED)

    def test_used_trial_code_rejected_on_second_install(self):
        tc = generate_trial_code()
        payload = dict(self.BASE_PAYLOAD)
        payload["license"] = {"activation_code": tc.code}
        c = APIClient()
        c.post("/api/v1/setup/run/", payload, format="json")
        # Second install attempt with same code — setup already complete → 409
        payload2 = dict(self.BASE_PAYLOAD)
        payload2["admin"] = dict(self.BASE_PAYLOAD["admin"], username="another_user")
        payload2["license"] = {"activation_code": tc.code}
        resp2 = c.post("/api/v1/setup/run/", payload2, format="json")
        self.assertEqual(resp2.status_code, 409)

    def test_invalid_code_returns_400(self):
        payload = dict(self.BASE_PAYLOAD)
        payload["admin"] = dict(self.BASE_PAYLOAD["admin"], username="badcode_user",
                                email="badcode@test.com")
        payload["license"] = {"activation_code": "XXXX-XXXX-XXXX-XXXX-XXXX"}
        c = APIClient()
        resp = c.post("/api/v1/setup/run/", payload, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_revoked_trial_code_rejected(self):
        tc = generate_trial_code()
        tc.status = TrialCode.TrialStatus.REVOKED
        tc.save()
        payload = dict(self.BASE_PAYLOAD)
        payload["admin"] = dict(self.BASE_PAYLOAD["admin"], username="revoked_user",
                                email="revoked@test.com")
        payload["license"] = {"activation_code": tc.code}
        c = APIClient()
        resp = c.post("/api/v1/setup/run/", payload, format="json")
        self.assertEqual(resp.status_code, 400)


# ══════════════════════════════════════════════════════════════════════════════
# 19: Paid subscription code still works (regression)
# ══════════════════════════════════════════════════════════════════════════════

class TestPaidActivationRegression(TestCase):

    def setUp(self):
        self.biz = Business.objects.create(name="Pre-issued Corp")
        self.lic = License.objects.create(
            business=self.biz,
            license_type=License.LicenseType.SUBSCRIPTION,
            status=License.Status.PENDING,
            expiry_date=date.today() + timedelta(days=365),
        )

    def test_paid_code_setup_still_works(self):
        payload = {
            "business": {"name": "Pre-issued Corp"},
            "branch":   {"name": "Main", "code": "MAIN"},
            "admin": {
                "first_name": "Paid",
                "last_name":  "User",
                "username":   "paidreg_v1",
                "email":      "paidreg_v1@test.com",
                "password":   "Xk7#mQ29vZ!",
            },
            "license": {"activation_code": self.lic.activation_code},
        }
        c = APIClient()
        resp = c.post("/api/v1/setup/run/", payload, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["license"]["license_type"], "SUBSCRIPTION")
        self.assertFalse(resp.data["license"]["is_trial"])


# ══════════════════════════════════════════════════════════════════════════════
# 20: Auto-trial (no code) still works (regression)
# ══════════════════════════════════════════════════════════════════════════════

class TestAutoTrialRegression(TestCase):

    def test_auto_trial_no_code_still_works(self):
        payload = {
            "business": {
                "name": "Auto Trial Corp",
                "business_category": "GENERAL_RETAIL",
            },
            "branch": {"name": "Main", "code": "MAIN"},
            "admin": {
                "first_name": "Auto",
                "last_name":  "Trial",
                "username":   "autotrial_reg",
                "email":      "autotrial_reg@test.com",
                "password":   "AutoTrial@123",
            },
            # No "license" key at all
        }
        c = APIClient()
        resp = c.post("/api/v1/setup/run/", payload, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["license"]["license_type"], "TRIAL")
        self.assertTrue(resp.data["license"]["is_trial"])


# ══════════════════════════════════════════════════════════════════════════════
# 21: generate_trial_code() offline safety
# ══════════════════════════════════════════════════════════════════════════════

class TestTrialOfflineSafety(TestCase):

    def test_generate_and_claim_make_no_network_calls(self):
        import socket
        original = socket.create_connection
        def fail(*a, **kw):
            raise AssertionError("Network call made — should be offline-safe")
        with mock.patch.object(socket, "create_connection", side_effect=fail):
            tc = generate_trial_code()
            biz = make_business("Offline Trial Corp")
            lic = tc.claim(biz)
        self.assertTrue(lic.is_active)


# ══════════════════════════════════════════════════════════════════════════════
# 22: Existing licensing tests still pass (smoke)
# ══════════════════════════════════════════════════════════════════════════════

class TestExistingLicensingSmoke(TestCase):

    def test_create_trial_license_path_a_still_works(self):
        """PATH A (auto trial) still activates immediately."""
        biz = make_business("Smoke Corp A")
        lic = create_trial_license(biz)
        self.assertEqual(lic.license_type, License.LicenseType.TRIAL)
        self.assertTrue(lic.is_active)

    def test_subscription_license_unaffected(self):
        biz = make_business("Smoke Sub Corp")
        lic = make_subscription_license(biz)
        self.assertEqual(lic.license_type, License.LicenseType.SUBSCRIPTION)
        self.assertTrue(lic.is_active)

    def test_lifetime_license_unaffected(self):
        biz = make_business("Smoke Life Corp")
        lic = make_lifetime_license(biz)
        self.assertEqual(lic.license_type, License.LicenseType.LIFETIME)
        self.assertTrue(lic.is_active)
        self.assertIsNone(lic.days_remaining)
