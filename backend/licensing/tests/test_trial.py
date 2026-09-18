"""
licensing/tests/test_trial.py
==============================
Stage: 7-Day Auto-Trial

Tests for the automatic 7-day trial license feature.

Coverage
--------
1.  create_trial_license() creates exactly one active TRIAL license
2.  Trial start_date is today
3.  Trial expiry_date is today + 7 days
4.  Trial status is ACTIVE immediately (no PENDING intermediate)
5.  Trial is_active returns True
6.  Calling create_trial_license() twice on the same business raises ValueError
7.  Backend restart does not re-create the trial (idempotency via DB state)
8.  Existing valid SUBSCRIPTION license prevents trial creation
9.  Existing LIFETIME license prevents trial creation
10. Expired trial remains expired (expiry handled by existing middleware logic)
11. Trial license passes LicenseCheckMiddleware (middleware allows TRIAL+ACTIVE)
12. LicenseStatusSerializer includes is_trial=True for a trial license
13. SetupRunView without activation_code creates a 7-day trial and completes setup
14. SetupRunView with activation_code still uses the existing activation path
15. SetupRunView called twice returns 409 (idempotent — no second trial)
16. Trial works offline (pure DB, no network dependency)
17. LicenseRenewalLog entry created for trial activation
"""

from datetime import date, timedelta
from unittest import mock

from django.test import TestCase, RequestFactory
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status as drf_status

from businesses.models import Business
from branches.models import Branch
from licensing.models import License, LicenseRenewalLog
from licensing.services import create_trial_license, TRIAL_DAYS
from licensing.serializers import LicenseStatusSerializer

User = get_user_model()


# ── Helpers ────────────────────────────────────────────────────────────────────

def make_business(name="Trial Corp"):
    return Business.objects.create(name=name)


def make_subscription_license(business, active=True, days=365):
    expiry = date.today() + timedelta(days=days) if active else date.today() - timedelta(days=1)
    lic = License.objects.create(
        business=business,
        license_type=License.LicenseType.SUBSCRIPTION,
        status=License.Status.ACTIVE if active else License.Status.EXPIRED,
        start_date=date.today(),
        expiry_date=expiry,
    )
    return lic


def make_lifetime_license(business):
    lic = License.objects.create(
        business=business,
        license_type=License.LicenseType.LIFETIME,
        status=License.Status.ACTIVE,
        start_date=date.today(),
        expiry_date=None,
    )
    return lic


# ══════════════════════════════════════════════════════════════════════════════
# 1–9: create_trial_license() service
# ══════════════════════════════════════════════════════════════════════════════

class TestCreateTrialLicense(TestCase):

    def setUp(self):
        self.biz = make_business()

    def test_creates_exactly_one_trial_license(self):
        lic = create_trial_license(self.biz)
        self.assertEqual(License.objects.filter(business=self.biz).count(), 1)
        self.assertEqual(lic.license_type, License.LicenseType.TRIAL)

    def test_trial_start_date_is_today(self):
        lic = create_trial_license(self.biz)
        self.assertEqual(lic.start_date, date.today())

    def test_trial_expiry_is_7_days_from_today(self):
        lic = create_trial_license(self.biz)
        self.assertEqual(lic.expiry_date, date.today() + timedelta(days=TRIAL_DAYS))

    def test_trial_status_is_active_immediately(self):
        lic = create_trial_license(self.biz)
        self.assertEqual(lic.status, License.Status.ACTIVE)

    def test_trial_is_active_returns_true(self):
        lic = create_trial_license(self.biz)
        self.assertTrue(lic.is_active)

    def test_trial_is_trial_returns_true(self):
        lic = create_trial_license(self.biz)
        self.assertTrue(lic.is_trial)

    def test_trial_activated_at_is_set(self):
        lic = create_trial_license(self.biz)
        self.assertIsNotNone(lic.activated_at)

    def test_second_call_raises_value_error(self):
        create_trial_license(self.biz)
        with self.assertRaises(ValueError) as ctx:
            create_trial_license(self.biz)
        self.assertIn("already has a license", str(ctx.exception))

    def test_existing_subscription_prevents_trial(self):
        make_subscription_license(self.biz)
        with self.assertRaises(ValueError):
            create_trial_license(self.biz)

    def test_existing_lifetime_prevents_trial(self):
        make_lifetime_license(self.biz)
        with self.assertRaises(ValueError):
            create_trial_license(self.biz)

    def test_creates_renewal_log_entry(self):
        lic = create_trial_license(self.biz)
        log = LicenseRenewalLog.objects.filter(license=lic).first()
        self.assertIsNotNone(log)
        self.assertEqual(log.action, "TRIAL_ACTIVATION")
        self.assertEqual(log.duration_days, TRIAL_DAYS)
        self.assertEqual(log.new_expiry, lic.expiry_date)

    def test_trial_notes_mention_trial(self):
        lic = create_trial_license(self.biz)
        self.assertIn("trial", lic.notes.lower())

    def test_trial_works_with_performed_by(self):
        user = User.objects.create_user(username="trialuser", password="Pass123!")
        lic = create_trial_license(self.biz, performed_by=user)
        log = LicenseRenewalLog.objects.filter(license=lic).first()
        self.assertEqual(log.performed_by, user)


# ══════════════════════════════════════════════════════════════════════════════
# 10: Expired trial
# ══════════════════════════════════════════════════════════════════════════════

class TestExpiredTrial(TestCase):

    def test_expired_trial_is_not_active(self):
        biz = make_business("Expired Trial Corp")
        lic = create_trial_license(biz)
        # Simulate 8 days passing
        lic.expiry_date = date.today() - timedelta(days=1)
        lic.save(update_fields=["expiry_date", "updated_at"])
        # refresh_expiry_status() flips ACTIVE → EXPIRED
        lic.refresh_expiry_status()
        lic.refresh_from_db()
        self.assertEqual(lic.status, License.Status.EXPIRED)
        self.assertFalse(lic.is_active)
        self.assertTrue(lic.is_trial)  # still a trial, just expired

    def test_expired_trial_cannot_be_re_created(self):
        """An expired trial still prevents creating a new trial."""
        biz = make_business("Expired Trial Corp 2")
        lic = create_trial_license(biz)
        lic.expiry_date = date.today() - timedelta(days=1)
        lic.status = License.Status.EXPIRED
        lic.save()
        # Must not create a second license
        with self.assertRaises(ValueError):
            create_trial_license(biz)


# ══════════════════════════════════════════════════════════════════════════════
# 11: Middleware allows TRIAL+ACTIVE
# ══════════════════════════════════════════════════════════════════════════════

class TestTrialMiddleware(TestCase):

    def test_active_trial_passes_middleware(self):
        """
        LicenseCheckMiddleware must allow requests when the business has
        an ACTIVE TRIAL license within its expiry period.
        """
        from licensing.middleware import LicenseCheckMiddleware
        from django.http import HttpRequest, HttpResponse

        biz  = make_business("Middleware Trial Corp")
        user = User.objects.create_user(username="mwtestuser", password="Pass123!")
        user.business = biz
        user.save()

        create_trial_license(biz)

        mw    = LicenseCheckMiddleware(get_response=lambda r: HttpResponse("OK"))
        req   = HttpRequest()
        req.path_info = "/api/v1/products/"
        req.user      = user

        result = mw.process_request(req)
        # None means "pass through" (not blocked)
        self.assertIsNone(result)

    def test_expired_trial_blocked_by_middleware(self):
        from licensing.middleware import LicenseCheckMiddleware
        from django.http import HttpRequest

        biz  = make_business("MW Expired Trial Corp")
        user = User.objects.create_user(username="mwexpired", password="Pass123!")
        user.business = biz
        user.save()

        lic = create_trial_license(biz)
        lic.expiry_date = date.today() - timedelta(days=1)
        lic.status      = License.Status.EXPIRED
        lic.save()

        mw  = LicenseCheckMiddleware(get_response=lambda r: None)
        req = HttpRequest()
        req.path_info = "/api/v1/products/"
        req.user      = user

        result = mw.process_request(req)
        self.assertIsNotNone(result)
        self.assertEqual(result.status_code, 402)


# ══════════════════════════════════════════════════════════════════════════════
# 12: LicenseStatusSerializer includes is_trial
# ══════════════════════════════════════════════════════════════════════════════

class TestTrialSerializer(TestCase):

    def test_serializer_includes_is_trial_true(self):
        biz = make_business("Serializer Trial Corp")
        lic = create_trial_license(biz)
        data = LicenseStatusSerializer(lic).data
        self.assertIn("is_trial", data)
        self.assertTrue(data["is_trial"])

    def test_serializer_is_trial_false_for_subscription(self):
        biz = make_business("Serializer Sub Corp")
        lic = make_subscription_license(biz)
        data = LicenseStatusSerializer(lic).data
        self.assertIn("is_trial", data)
        self.assertFalse(data["is_trial"])

    def test_serializer_is_trial_false_for_lifetime(self):
        biz = make_business("Serializer Lifetime Corp")
        lic = make_lifetime_license(biz)
        data = LicenseStatusSerializer(lic).data
        self.assertFalse(data["is_trial"])

    def test_serializer_days_remaining_correct_for_trial(self):
        biz = make_business("Days Remaining Corp")
        lic = create_trial_license(biz)
        data = LicenseStatusSerializer(lic).data
        self.assertEqual(data["days_remaining"], TRIAL_DAYS)

    def test_serializer_license_type_is_trial(self):
        biz = make_business("LT Corp")
        lic = create_trial_license(biz)
        data = LicenseStatusSerializer(lic).data
        self.assertEqual(data["license_type"], "TRIAL")


# ══════════════════════════════════════════════════════════════════════════════
# 13–15: SetupRunView integration
# ══════════════════════════════════════════════════════════════════════════════

class TestSetupRunViewTrial(TestCase):
    """
    Integration tests for SetupRunView with the automatic trial path.
    Uses the actual setup endpoint via APIClient.
    """

    BASE_PAYLOAD = {
        "business": {
            "name": "Trial Business",
            "business_category": "GENERAL_RETAIL",
            "currency": "GHS",
            "currency_symbol": "GH₵",
        },
        "branch": {"name": "Main Branch", "code": "MAIN"},
        "admin": {
            "first_name": "Test",
            "last_name":  "Admin",
            "username":   "trialadmin",
            "email":      "trial@test.com",
            "password":   "TrialPass@123",
        },
        # Note: no "license" key — triggers the trial path
    }

    def test_setup_without_code_creates_trial(self):
        c = APIClient()
        resp = c.post("/api/v1/setup/run/", self.BASE_PAYLOAD, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        lic_data = resp.data["license"]
        self.assertEqual(lic_data["license_type"], "TRIAL")
        self.assertTrue(lic_data["is_active"])
        self.assertTrue(lic_data["is_trial"])

    def test_trial_expiry_is_7_days_in_setup_response(self):
        c = APIClient()
        resp = c.post("/api/v1/setup/run/", self.BASE_PAYLOAD, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        expiry = resp.data["license"]["expiry_date"]
        expected = (date.today() + timedelta(days=TRIAL_DAYS)).isoformat()
        self.assertEqual(expiry, expected)

    def test_setup_called_twice_returns_409(self):
        c = APIClient()
        resp1 = c.post("/api/v1/setup/run/", self.BASE_PAYLOAD, format="json")
        self.assertEqual(resp1.status_code, 200)
        # Second call — setup already complete
        payload2 = dict(self.BASE_PAYLOAD)
        payload2["admin"] = dict(self.BASE_PAYLOAD["admin"], username="trialadmin2")
        resp2 = c.post("/api/v1/setup/run/", payload2, format="json")
        self.assertEqual(resp2.status_code, 409)

    def test_setup_only_one_license_created(self):
        c = APIClient()
        c.post("/api/v1/setup/run/", self.BASE_PAYLOAD, format="json")
        self.assertEqual(License.objects.count(), 1)
        self.assertEqual(License.objects.first().license_type, "TRIAL")

    def test_setup_with_empty_license_section_uses_trial(self):
        """Explicit empty license dict also triggers trial path."""
        payload = dict(self.BASE_PAYLOAD)
        payload["admin"] = dict(self.BASE_PAYLOAD["admin"], username="trialadmin3",
                                email="trial3@test.com")
        payload["license"] = {}
        c = APIClient()
        resp = c.post("/api/v1/setup/run/", payload, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["license"]["license_type"], "TRIAL")


class TestSetupRunViewWithActivationCode(TestCase):
    """
    Existing activation code path must still work unchanged.
    """

    def setUp(self):
        # Create a pre-issued license as POPMYC staff would
        self.biz = Business.objects.create(name="Pre-issued Corp")
        self.lic = License.objects.create(
            business=self.biz,
            license_type=License.LicenseType.SUBSCRIPTION,
            status=License.Status.PENDING,
            expiry_date=date.today() + timedelta(days=365),
        )

    def test_setup_with_code_uses_existing_activation_path(self):
        payload = {
            "business": {"name": "Pre-issued Corp"},
            "branch":   {"name": "Main", "code": "MAIN"},
            "admin": {
                "first_name": "Code",
                "last_name":  "User",
                "username":   "codeuser",
                "email":      "code@test.com",
                "password":   "CodePass@123",
            },
            "license": {"activation_code": self.lic.activation_code},
        }
        c = APIClient()
        resp = c.post("/api/v1/setup/run/", payload, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["license"]["license_type"], "SUBSCRIPTION")

    def test_invalid_code_returns_400(self):
        payload = {
            "business": {"name": "Bad Code Corp"},
            "branch":   {"name": "Main", "code": "MAIN"},
            "admin": {
                "first_name": "Bad",
                "last_name":  "Code",
                "username":   "badcode",
                "email":      "bad@test.com",
                "password":   "BadCode@123",
            },
            "license": {"activation_code": "XXXX-XXXX-XXXX-XXXX-XXXX"},
        }
        c = APIClient()
        resp = c.post("/api/v1/setup/run/", payload, format="json")
        self.assertEqual(resp.status_code, 400)


# ══════════════════════════════════════════════════════════════════════════════
# 16: Offline — trial is a pure DB operation
# ══════════════════════════════════════════════════════════════════════════════

class TestTrialOfflineSafety(TestCase):
    """
    The trial creates no network calls.
    Verify by ensuring no requests are made during trial creation.
    """

    def test_create_trial_makes_no_network_calls(self):
        import socket
        original_create_connection = socket.create_connection

        def fail_if_called(*args, **kwargs):
            raise AssertionError("Network call made during trial creation — should be offline-safe")

        biz = make_business("Offline Trial Corp")
        with mock.patch.object(socket, "create_connection", side_effect=fail_if_called):
            # Must not raise AssertionError (no network calls)
            lic = create_trial_license(biz)
        self.assertTrue(lic.is_active)


# ══════════════════════════════════════════════════════════════════════════════
# 17: Idempotency on repeated initialization
# ══════════════════════════════════════════════════════════════════════════════

class TestTrialIdempotency(TestCase):

    def test_restart_does_not_create_second_trial(self):
        """
        Simulates backend restart: the trial already exists in the DB.
        create_trial_license() must raise ValueError, not create a duplicate.
        """
        biz = make_business("Restart Corp")
        create_trial_license(biz)  # first run
        count_before = License.objects.count()

        # Simulate restart: call create_trial_license again
        with self.assertRaises(ValueError):
            create_trial_license(biz)

        # Count must be unchanged
        self.assertEqual(License.objects.count(), count_before)

    def test_existing_paid_license_unchanged_after_failed_trial_attempt(self):
        biz = make_business("Paid Corp")
        paid = make_subscription_license(biz, active=True, days=180)
        original_expiry = paid.expiry_date

        # Attempt (and fail) to create a trial
        with self.assertRaises(ValueError):
            create_trial_license(biz)

        paid.refresh_from_db()
        self.assertEqual(paid.expiry_date, original_expiry)
        self.assertEqual(paid.status, License.Status.ACTIVE)

    def test_existing_lifetime_license_unchanged_after_failed_trial_attempt(self):
        biz      = make_business("Lifetime Corp")
        lifetime = make_lifetime_license(biz)

        with self.assertRaises(ValueError):
            create_trial_license(biz)

        lifetime.refresh_from_db()
        self.assertEqual(lifetime.status, License.Status.ACTIVE)
        self.assertIsNone(lifetime.expiry_date)
