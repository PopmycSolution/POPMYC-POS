"""
cloud/tests/test_trial_activation.py
=====================================
Stage 7 — Cloud TrialCode Activation Bridge — Regression Tests

Coverage
--------
PHASE 1 — /api/v1/cloud/trial/validate/
  1.  Valid PENDING TrialCode → 200 + reservation_token
  2.  Non-existent code → 400 invalid_code
  3.  USED code → 400 already_used
  4.  REVOKED code → 400 revoked
  5.  Missing activation_code field → 400
  6.  Code is case-insensitive (lowercase accepted)
  7.  Whitespace in code is trimmed
  8.  Returned token is not empty and not the raw code
  9.  Returned expires_in_seconds > 0
  10. Returned trial_days == TRIAL_DAYS

RESERVATION MODEL
  11. ActivationReservation.create_for() stores hash, not raw token
  12. ActivationReservation.get_valid_by_token() returns reservation for valid token
  13. get_valid_by_token() returns None for unknown token
  14. get_valid_by_token() returns None for expired reservation
  15. get_valid_by_token() returns None for COMPLETED reservation
  16. Reservation.is_valid True when PENDING and not expired
  17. Reservation.is_valid False when expired

PHASE 1.5 — /api/v1/cloud/trial/verify-reservation/
  18. Valid PENDING token → {valid: true}
  19. Unknown token → {valid: false, HTTP 200}
  20. Expired token → {valid: false, HTTP 200}

PHASE 2 — /api/v1/cloud/trial/complete/
  21. Valid PENDING reservation → 200, completed=true, TrialCode→USED
  22. Idempotent: already COMPLETED token → 200, completed=true
  23. Expired reservation → 400 expired_reservation
  24. Unknown token → 400 invalid_token
  25. USED TrialCode (race condition) → 409 already_used
  26. REVOKED TrialCode → 400 revoked
  27. Complete sets reservation.completed_at
  28. Complete sets trial_code.activated_at

LOCAL SETUP — SetupRunView PATH D (cloud token)
  29. Cloud token present + valid verify → local TRIAL License created
  30. Local TRIAL License is ACTIVE with 7-day expiry
  31. LicenseRenewalLog TRIAL_ACTIVATION entry created
  32. Cloud token invalid → 400, no DB objects created (atomic)
  33. Local setup failure does not consume cloud TrialCode
  34. PATH A (no code, no token) still works → auto-trial
  35. PATH B (local TrialCode) still works
  36. PATH C (paid License code) still works

OFFLINE SAFETY
  37. validate endpoint works without authenticated user
  38. complete endpoint works without authenticated user
  39. Normal POS endpoints are unaffected (separate URL prefix)

EXISTING TESTS REGRESSION
  40. sync security tests still importable
  41. licensing trial tests still importable
"""

import uuid
from datetime import date, timedelta
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework import status as drf_status

from licensing.models import License, TrialCode, LicenseRenewalLog, TRIAL_DAYS
from licensing.services import create_trial_license
from businesses.models import Business
from branches.models import Branch
from cloud.models import ActivationReservation


# ── Fixtures ───────────────────────────────────────────────────────────────────

def _make_pending_trial_code(notes="test"):
    return TrialCode.objects.create(
        status=TrialCode.TrialStatus.PENDING,
        notes=notes,
    )


def _make_used_trial_code():
    tc = TrialCode.objects.create(status=TrialCode.TrialStatus.USED)
    return tc


def _make_revoked_trial_code():
    return TrialCode.objects.create(status=TrialCode.TrialStatus.REVOKED)


def _make_reservation(tc, *, expired=False):
    res, raw = ActivationReservation.create_for(tc)
    if expired:
        res.expires_at = timezone.now() - timedelta(seconds=1)
        res.save(update_fields=["expires_at", "updated_at"])
    return res, raw


def _client():
    return APIClient()


VALIDATE_URL  = "/api/v1/cloud/trial/validate/"
VERIFY_URL    = "/api/v1/cloud/trial/verify-reservation/"
COMPLETE_URL  = "/api/v1/cloud/trial/complete/"

# ── Shared override settings for all trial endpoint tests ─────────────────────
# Throttle classes are disabled in tests because each test method would
# exhaust TrialActivationThrottle (10/min) since the test runner reuses the
# same in-process Django cache.  We patch get_throttles() → [] on every test
# class that hits the endpoints, using a shared mixin.

_TRIAL_TEST_SETTINGS = {
    "CLOUD_ENABLED": True,
}


class _NoThrottleMixin:
    """
    Disable all throttling on the three trial views for the duration of
    every test method in subclasses.  Call super().setUp() first.
    """

    def setUp(self):
        super().setUp()
        self._throttle_patches = [
            mock.patch(
                "cloud.trial_views.TrialValidateView.get_throttles",
                return_value=[],
            ),
            mock.patch(
                "cloud.trial_views.TrialVerifyReservationView.get_throttles",
                return_value=[],
            ),
            mock.patch(
                "cloud.trial_views.TrialCompleteView.get_throttles",
                return_value=[],
            ),
        ]
        for p in self._throttle_patches:
            p.start()

    def tearDown(self):
        for p in self._throttle_patches:
            p.stop()
        super().tearDown()


# ══════════════════════════════════════════════════════════════════════════════
# PHASE 1 — /api/v1/cloud/trial/validate/
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(**_TRIAL_TEST_SETTINGS)
class TestTrialValidate(_NoThrottleMixin, TestCase):

    def test_valid_pending_code_returns_200_with_token(self):
        tc = _make_pending_trial_code()
        resp = _client().post(VALIDATE_URL, {"activation_code": tc.code}, format="json")
        self.assertEqual(resp.status_code, drf_status.HTTP_200_OK)
        self.assertTrue(resp.data["valid"])
        self.assertIn("reservation_token", resp.data)
        self.assertTrue(len(resp.data["reservation_token"]) > 10)

    def test_nonexistent_code_returns_400_invalid_code(self):
        resp = _client().post(VALIDATE_URL, {"activation_code": "XXXX-XXXX-XXXX-XXXX-XXXX"}, format="json")
        self.assertEqual(resp.status_code, drf_status.HTTP_400_BAD_REQUEST)
        self.assertFalse(resp.data["valid"])
        self.assertEqual(resp.data["error"], "invalid_code")

    def test_used_code_returns_400_already_used(self):
        tc = _make_used_trial_code()
        resp = _client().post(VALIDATE_URL, {"activation_code": tc.code}, format="json")
        self.assertEqual(resp.status_code, drf_status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.data["error"], "already_used")

    def test_revoked_code_returns_400_revoked(self):
        tc = _make_revoked_trial_code()
        resp = _client().post(VALIDATE_URL, {"activation_code": tc.code}, format="json")
        self.assertEqual(resp.status_code, drf_status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.data["error"], "revoked")

    def test_missing_code_field_returns_400(self):
        resp = _client().post(VALIDATE_URL, {}, format="json")
        self.assertEqual(resp.status_code, drf_status.HTTP_400_BAD_REQUEST)
        self.assertFalse(resp.data["valid"])

    def test_lowercase_code_accepted(self):
        tc = _make_pending_trial_code()
        resp = _client().post(VALIDATE_URL, {"activation_code": tc.code.lower()}, format="json")
        self.assertEqual(resp.status_code, drf_status.HTTP_200_OK)
        self.assertTrue(resp.data["valid"])

    def test_whitespace_trimmed(self):
        tc = _make_pending_trial_code()
        resp = _client().post(VALIDATE_URL, {"activation_code": f"  {tc.code}  "}, format="json")
        self.assertEqual(resp.status_code, drf_status.HTTP_200_OK)
        self.assertTrue(resp.data["valid"])

    def test_returned_token_is_not_the_raw_code(self):
        tc = _make_pending_trial_code()
        resp = _client().post(VALIDATE_URL, {"activation_code": tc.code}, format="json")
        self.assertNotEqual(resp.data["reservation_token"], tc.code)

    def test_expires_in_seconds_positive(self):
        tc = _make_pending_trial_code()
        resp = _client().post(VALIDATE_URL, {"activation_code": tc.code}, format="json")
        self.assertGreater(resp.data["expires_in_seconds"], 0)

    def test_trial_days_matches_constant(self):
        tc = _make_pending_trial_code()
        resp = _client().post(VALIDATE_URL, {"activation_code": tc.code}, format="json")
        self.assertEqual(resp.data["trial_days"], TRIAL_DAYS)

    def test_validate_creates_reservation_in_db(self):
        tc = _make_pending_trial_code()
        before = ActivationReservation.objects.count()
        _client().post(VALIDATE_URL, {"activation_code": tc.code}, format="json")
        self.assertEqual(ActivationReservation.objects.count(), before + 1)
        res = ActivationReservation.objects.get(trial_code=tc)
        self.assertEqual(res.status, ActivationReservation.ReservationStatus.PENDING)

    def test_validate_does_not_consume_trial_code(self):
        """TrialCode must remain PENDING after Phase 1."""
        tc = _make_pending_trial_code()
        _client().post(VALIDATE_URL, {"activation_code": tc.code}, format="json")
        tc.refresh_from_db()
        self.assertEqual(tc.status, TrialCode.TrialStatus.PENDING)


# ══════════════════════════════════════════════════════════════════════════════
# RESERVATION MODEL
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(CLOUD_ENABLED=True)
class TestActivationReservationModel(TestCase):

    def test_create_for_stores_hash_not_raw_token(self):
        tc = _make_pending_trial_code()
        res, raw = ActivationReservation.create_for(tc)
        expected_hash = ActivationReservation.hash_token(raw)
        self.assertEqual(res.token_hash, expected_hash)
        self.assertNotEqual(res.token_hash, raw)

    def test_get_valid_by_token_returns_reservation(self):
        tc = _make_pending_trial_code()
        res, raw = _make_reservation(tc)
        found = ActivationReservation.get_valid_by_token(raw)
        self.assertIsNotNone(found)
        self.assertEqual(found.pk, res.pk)

    def test_get_valid_by_token_unknown_returns_none(self):
        result = ActivationReservation.get_valid_by_token("this-is-not-a-real-token")
        self.assertIsNone(result)

    def test_get_valid_by_token_expired_returns_none(self):
        tc = _make_pending_trial_code()
        res, raw = _make_reservation(tc, expired=True)
        result = ActivationReservation.get_valid_by_token(raw)
        self.assertIsNone(result)

    def test_get_valid_by_token_expired_marks_as_expired(self):
        tc = _make_pending_trial_code()
        res, raw = _make_reservation(tc, expired=True)
        ActivationReservation.get_valid_by_token(raw)
        res.refresh_from_db()
        self.assertEqual(res.status, ActivationReservation.ReservationStatus.EXPIRED)

    def test_get_valid_by_token_completed_returns_none(self):
        tc = _make_pending_trial_code()
        res, raw = _make_reservation(tc)
        res.complete()
        result = ActivationReservation.get_valid_by_token(raw)
        self.assertIsNone(result)

    def test_is_valid_true_for_pending_not_expired(self):
        tc = _make_pending_trial_code()
        res, raw = _make_reservation(tc)
        self.assertTrue(res.is_valid)

    def test_is_valid_false_for_expired(self):
        tc = _make_pending_trial_code()
        res, raw = _make_reservation(tc, expired=True)
        self.assertFalse(res.is_valid)

    def test_complete_sets_status_and_timestamp(self):
        tc = _make_pending_trial_code()
        res, raw = _make_reservation(tc)
        res.complete()
        res.refresh_from_db()
        self.assertEqual(res.status, ActivationReservation.ReservationStatus.COMPLETED)
        self.assertIsNotNone(res.completed_at)


# ══════════════════════════════════════════════════════════════════════════════
# PHASE 1.5 — /api/v1/cloud/trial/verify-reservation/
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(**_TRIAL_TEST_SETTINGS)
class TestTrialVerifyReservation(_NoThrottleMixin, TestCase):

    def test_valid_token_returns_valid_true(self):
        tc = _make_pending_trial_code()
        _, raw = _make_reservation(tc)
        resp = _client().post(VERIFY_URL, {"reservation_token": raw}, format="json")
        self.assertEqual(resp.status_code, drf_status.HTTP_200_OK)
        self.assertTrue(resp.data["valid"])
        self.assertEqual(resp.data["trial_days"], TRIAL_DAYS)
        self.assertIn("expires_in_seconds", resp.data)

    def test_unknown_token_returns_valid_false_200(self):
        resp = _client().post(VERIFY_URL, {"reservation_token": "bad-token"}, format="json")
        self.assertEqual(resp.status_code, drf_status.HTTP_200_OK)
        self.assertFalse(resp.data["valid"])

    def test_expired_token_returns_valid_false_200(self):
        tc = _make_pending_trial_code()
        _, raw = _make_reservation(tc, expired=True)
        resp = _client().post(VERIFY_URL, {"reservation_token": raw}, format="json")
        self.assertEqual(resp.status_code, drf_status.HTTP_200_OK)
        self.assertFalse(resp.data["valid"])

    def test_missing_token_field_returns_valid_false(self):
        resp = _client().post(VERIFY_URL, {}, format="json")
        self.assertEqual(resp.status_code, drf_status.HTTP_200_OK)
        self.assertFalse(resp.data["valid"])


# ══════════════════════════════════════════════════════════════════════════════
# PHASE 2 — /api/v1/cloud/trial/complete/
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(**_TRIAL_TEST_SETTINGS)
class TestTrialComplete(_NoThrottleMixin, TestCase):

    def test_valid_reservation_returns_200_completed(self):
        tc = _make_pending_trial_code()
        _, raw = _make_reservation(tc)
        resp = _client().post(COMPLETE_URL, {"reservation_token": raw}, format="json")
        self.assertEqual(resp.status_code, drf_status.HTTP_200_OK)
        self.assertTrue(resp.data["completed"])
        self.assertEqual(resp.data["trial_days"], TRIAL_DAYS)

    def test_complete_marks_trial_code_as_used(self):
        tc = _make_pending_trial_code()
        _, raw = _make_reservation(tc)
        _client().post(COMPLETE_URL, {"reservation_token": raw}, format="json")
        tc.refresh_from_db()
        self.assertEqual(tc.status, TrialCode.TrialStatus.USED)

    def test_complete_marks_reservation_as_completed(self):
        tc = _make_pending_trial_code()
        res, raw = _make_reservation(tc)
        _client().post(COMPLETE_URL, {"reservation_token": raw}, format="json")
        res.refresh_from_db()
        self.assertEqual(res.status, ActivationReservation.ReservationStatus.COMPLETED)

    def test_complete_sets_reservation_completed_at(self):
        tc = _make_pending_trial_code()
        res, raw = _make_reservation(tc)
        _client().post(COMPLETE_URL, {"reservation_token": raw}, format="json")
        res.refresh_from_db()
        self.assertIsNotNone(res.completed_at)

    def test_complete_sets_trial_code_activated_at(self):
        tc = _make_pending_trial_code()
        _, raw = _make_reservation(tc)
        _client().post(COMPLETE_URL, {"reservation_token": raw}, format="json")
        tc.refresh_from_db()
        self.assertIsNotNone(tc.activated_at)

    def test_idempotent_already_completed_returns_200(self):
        tc = _make_pending_trial_code()
        res, raw = _make_reservation(tc)
        # First completion
        _client().post(COMPLETE_URL, {"reservation_token": raw}, format="json")
        # Second completion — must not fail
        resp2 = _client().post(COMPLETE_URL, {"reservation_token": raw}, format="json")
        self.assertEqual(resp2.status_code, drf_status.HTTP_200_OK)
        self.assertTrue(resp2.data["completed"])

    def test_idempotent_does_not_double_mark_trial_code(self):
        tc = _make_pending_trial_code()
        _, raw = _make_reservation(tc)
        _client().post(COMPLETE_URL, {"reservation_token": raw}, format="json")
        _client().post(COMPLETE_URL, {"reservation_token": raw}, format="json")
        tc.refresh_from_db()
        # Still USED, not some corrupted state
        self.assertEqual(tc.status, TrialCode.TrialStatus.USED)

    def test_expired_reservation_returns_400(self):
        tc = _make_pending_trial_code()
        _, raw = _make_reservation(tc, expired=True)
        resp = _client().post(COMPLETE_URL, {"reservation_token": raw}, format="json")
        self.assertEqual(resp.status_code, drf_status.HTTP_400_BAD_REQUEST)
        self.assertFalse(resp.data["completed"])
        self.assertIn(resp.data["error"], ("expired_reservation", "invalid_token"))

    def test_unknown_token_returns_400(self):
        resp = _client().post(COMPLETE_URL, {"reservation_token": "unknown-token"}, format="json")
        self.assertEqual(resp.status_code, drf_status.HTTP_400_BAD_REQUEST)
        self.assertFalse(resp.data["completed"])

    def test_already_used_trial_code_race_returns_409(self):
        """
        If the TrialCode is USED by the time complete() runs (race condition),
        the endpoint returns 409 Conflict.
        """
        tc = _make_pending_trial_code()
        res, raw = _make_reservation(tc)
        # Simulate race: mark TrialCode as USED before the complete call
        tc.status = TrialCode.TrialStatus.USED
        tc.save(update_fields=["status", "updated_at"])

        resp = _client().post(COMPLETE_URL, {"reservation_token": raw}, format="json")
        self.assertEqual(resp.status_code, drf_status.HTTP_409_CONFLICT)
        self.assertFalse(resp.data["completed"])

    def test_revoked_trial_code_returns_400(self):
        tc = _make_pending_trial_code()
        res, raw = _make_reservation(tc)
        tc.status = TrialCode.TrialStatus.REVOKED
        tc.save(update_fields=["status", "updated_at"])
        resp = _client().post(COMPLETE_URL, {"reservation_token": raw}, format="json")
        self.assertEqual(resp.status_code, drf_status.HTTP_400_BAD_REQUEST)

    def test_missing_token_returns_400(self):
        resp = _client().post(COMPLETE_URL, {}, format="json")
        self.assertEqual(resp.status_code, drf_status.HTTP_400_BAD_REQUEST)

    def test_retry_field_false_for_permanent_errors(self):
        """Permanent errors (expired, invalid) must have retry=false."""
        resp = _client().post(COMPLETE_URL, {"reservation_token": "bad"}, format="json")
        self.assertFalse(resp.data.get("retry", True))

    def test_complete_does_not_affect_other_trial_codes(self):
        """Completing one reservation must not touch a different TrialCode."""
        tc1 = _make_pending_trial_code("code1")
        tc2 = _make_pending_trial_code("code2")
        _, raw1 = _make_reservation(tc1)
        _client().post(COMPLETE_URL, {"reservation_token": raw1}, format="json")
        tc2.refresh_from_db()
        self.assertEqual(tc2.status, TrialCode.TrialStatus.PENDING)


# ══════════════════════════════════════════════════════════════════════════════
# LOCAL SETUP — SetupRunView PATH D (cloud activation token)
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(**{**_TRIAL_TEST_SETTINGS, "CLOUD_SETUP_URL": "http://testserver-cloud"})
class TestSetupRunViewCloudToken(_NoThrottleMixin, TestCase):
    """
    Tests for SetupRunView PATH D.

    The cloud verify-reservation call is mocked so these tests run
    fully offline without a real Render server.
    """

    BASE_PAYLOAD = {
        "business": {
            "name": "Cloud Trial Corp",
            "business_category": "GENERAL_RETAIL",
            "currency": "GHS",
            "currency_symbol": "GH₵",
        },
        "branch": {"name": "Main", "code": "MAIN"},
        "admin": {
            "first_name": "Cloud",
            "last_name":  "Tester",
            "username":   "cloudtester",
            "email":      "cloud@test.com",
            "password":   "CloudPass@123",
        },
    }

    def _payload_with_token(self, token="fake-reservation-token", username_suffix=""):
        p = {**self.BASE_PAYLOAD}
        p["admin"] = {**self.BASE_PAYLOAD["admin"]}
        if username_suffix:
            p["admin"]["username"] = f"cloudtester_{username_suffix}"
            p["admin"]["email"]    = f"cloud_{username_suffix}@test.com"
        p["license"] = {
            "activation_code":        "CLOUD-TRIAL-CODE",
            "cloud_activation_token": token,
        }
        return p

    def _mock_verify(self, valid=True):
        """Return a context manager that mocks _verify_cloud_reservation."""
        return mock.patch(
            "setup.views._verify_cloud_reservation",
            return_value=(valid, "" if valid else "Reservation expired or invalid."),
        )

    # 29 — Cloud token + valid verify → local TRIAL License created
    def test_cloud_token_valid_creates_trial_license(self):
        with self._mock_verify(valid=True):
            resp = _client().post("/api/v1/setup/run/", self._payload_with_token(), format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertTrue(resp.data["success"])
        self.assertEqual(resp.data["license"]["license_type"], "TRIAL")

    # 30 — Local TRIAL License is ACTIVE with 7-day expiry
    def test_cloud_token_trial_is_active_7_days(self):
        with self._mock_verify(valid=True):
            resp = _client().post("/api/v1/setup/run/", self._payload_with_token(), format="json")
        lic = resp.data["license"]
        self.assertTrue(lic["is_active"])
        self.assertTrue(lic["is_trial"])
        expected_expiry = (date.today() + timedelta(days=TRIAL_DAYS)).isoformat()
        self.assertEqual(lic["expiry_date"], expected_expiry)

    # 31 — LicenseRenewalLog TRIAL_ACTIVATION entry created
    def test_cloud_token_creates_renewal_log_entry(self):
        with self._mock_verify(valid=True):
            resp = _client().post("/api/v1/setup/run/", self._payload_with_token(), format="json")
        biz_id = resp.data["business_id"]
        lic = License.objects.get(business_id=biz_id)
        log = LicenseRenewalLog.objects.filter(license=lic).first()
        self.assertIsNotNone(log)
        self.assertEqual(log.action, "TRIAL_ACTIVATION")
        self.assertEqual(log.duration_days, TRIAL_DAYS)

    # 32 — Cloud token invalid → 400, no DB objects created (atomic)
    def test_cloud_token_invalid_returns_400_and_no_db_objects(self):
        biz_count    = Business.objects.count()
        branch_count = Branch.objects.count()
        lic_count    = License.objects.count()

        with self._mock_verify(valid=False):
            resp = _client().post("/api/v1/setup/run/", self._payload_with_token(), format="json")

        self.assertEqual(resp.status_code, 400)
        self.assertFalse(resp.data["success"])
        # Nothing was created
        self.assertEqual(Business.objects.count(), biz_count)
        self.assertEqual(Branch.objects.count(), branch_count)
        self.assertEqual(License.objects.count(), lic_count)

    def test_cloud_token_invalid_error_in_license_section(self):
        with self._mock_verify(valid=False):
            resp = _client().post("/api/v1/setup/run/", self._payload_with_token(), format="json")
        self.assertIn("license", resp.data.get("errors", {}))
        self.assertIn("cloud_activation_token", resp.data["errors"]["license"])

    # 33 — Local setup failure does not consume cloud TrialCode
    # (The actual cloud TrialCode lives on the cloud; the local setup doesn't
    # call complete(). We verify the DB has no LOCAL TrialCode entry consumed.)
    def test_cloud_token_path_does_not_create_local_trial_code_entry(self):
        """
        PATH D uses create_trial_license() — it does NOT call TrialCode.claim().
        No local TrialCode row is created during cloud token setup.
        """
        with self._mock_verify(valid=True):
            resp = _client().post("/api/v1/setup/run/", self._payload_with_token(), format="json")
        self.assertEqual(resp.status_code, 200)
        # TrialCode table must be empty — no local TrialCode was created
        self.assertEqual(TrialCode.objects.count(), 0)

    # 34 — PATH A (no code, no token) still works
    def test_path_a_auto_trial_unchanged(self):
        payload = {**self.BASE_PAYLOAD}
        payload["admin"] = {**self.BASE_PAYLOAD["admin"],
                            "username": "autotrial", "email": "auto@test.com"}
        # No license section at all
        resp = _client().post("/api/v1/setup/run/", payload, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["license"]["license_type"], "TRIAL")

    # 35 — PATH B (local TrialCode) still works
    def test_path_b_local_trial_code_unchanged(self):
        tc = _make_pending_trial_code()
        payload = {**self.BASE_PAYLOAD}
        payload["admin"] = {**self.BASE_PAYLOAD["admin"],
                            "username": "localcode", "email": "local@test.com"}
        payload["license"] = {"activation_code": tc.code}
        resp = _client().post("/api/v1/setup/run/", payload, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["license"]["license_type"], "TRIAL")
        tc.refresh_from_db()
        self.assertEqual(tc.status, TrialCode.TrialStatus.USED)

    # 36 — PATH C (paid License code) still works
    def test_path_c_paid_license_unchanged(self):
        biz = Business.objects.create(name="Paid Biz")
        lic = License.objects.create(
            business=biz,
            license_type=License.LicenseType.SUBSCRIPTION,
            status=License.Status.PENDING,
            expiry_date=date.today() + timedelta(days=365),
        )
        payload = {
            "business": {"name": "Paid Biz"},
            "branch": {"name": "Main", "code": "MAIN"},
            "admin": {
                "first_name": "Paid",
                "last_name":  "User",
                "username":   "paiduser",
                "email":      "paid@test.com",
                "password":   "PaidPass@123",
            },
            "license": {"activation_code": lic.activation_code},
        }
        resp = _client().post("/api/v1/setup/run/", payload, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["license"]["license_type"], "SUBSCRIPTION")


# ══════════════════════════════════════════════════════════════════════════════
# OFFLINE SAFETY — endpoints require no prior auth
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(**_TRIAL_TEST_SETTINGS)
class TestTrialEndpointsAllowAny(_NoThrottleMixin, TestCase):
    """All three trial endpoints must be reachable without authentication."""

    def test_validate_allows_unauthenticated(self):
        tc = _make_pending_trial_code()
        resp = APIClient().post(VALIDATE_URL, {"activation_code": tc.code}, format="json")
        # Must not return 401 or 403
        self.assertNotIn(resp.status_code, [401, 403])

    def test_verify_allows_unauthenticated(self):
        resp = APIClient().post(VERIFY_URL, {"reservation_token": "test"}, format="json")
        self.assertNotIn(resp.status_code, [401, 403])

    def test_complete_allows_unauthenticated(self):
        resp = APIClient().post(COMPLETE_URL, {"reservation_token": "test"}, format="json")
        self.assertNotIn(resp.status_code, [401, 403])

    def test_cloud_disabled_returns_503(self):
        """When CLOUD_ENABLED=False the trial endpoints return 503."""
        with override_settings(CLOUD_ENABLED=False):
            tc = _make_pending_trial_code()
            resp = APIClient().post(VALIDATE_URL, {"activation_code": tc.code}, format="json")
            self.assertEqual(resp.status_code, 503)


# ══════════════════════════════════════════════════════════════════════════════
# EXISTING TESTS REGRESSION GUARD — imports must not break
# ══════════════════════════════════════════════════════════════════════════════

class TestExistingImportsUnbroken(TestCase):

    def test_sync_security_tests_importable(self):
        from synchronization.tests import test_sync_security
        self.assertIsNotNone(test_sync_security)

    def test_licensing_trial_tests_importable(self):
        from licensing.tests import test_trial
        self.assertIsNotNone(test_trial)

    def test_licensing_trial_v1_tests_importable(self):
        from licensing.tests import test_trial_v1
        self.assertIsNotNone(test_trial_v1)

    def test_setup_views_importable(self):
        from setup.views import SetupRunView, SetupStatusView, _verify_cloud_reservation
        self.assertIsNotNone(SetupRunView)
        self.assertIsNotNone(_verify_cloud_reservation)

    def test_cloud_trial_views_importable(self):
        from cloud.trial_views import (
            TrialValidateView,
            TrialVerifyReservationView,
            TrialCompleteView,
        )
        self.assertIsNotNone(TrialValidateView)

    def test_activation_reservation_model_importable(self):
        from cloud.models import ActivationReservation
        self.assertIsNotNone(ActivationReservation)

    def test_existing_setup_tests_importable(self):
        from setup import tests as setup_tests
        self.assertIsNotNone(setup_tests)
