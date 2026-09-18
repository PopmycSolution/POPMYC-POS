"""
cloud/tests/test_diagnostics.py
================================
Tests for the TEMPORARY TrialCode diagnostic endpoint.

GET /api/v1/cloud/diagnostics/trial-codes/

Covers
------
- Endpoint is accessible without authentication (AllowAny).
- Returns HTTP 200 when CLOUD_ENABLED=True.
- Returns HTTP 503 when CLOUD_ENABLED=False (CloudAPIView gate).
- Response contains all required diagnostic sections.
- Credential-sensitive values are never present in the response.
- TrialCode counts reflect actual DB state.
- ORM and raw SQL sections both present.
- repr_code field is present for hidden-character detection.
"""

import os
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework import status as drf_status

from licensing.models import TrialCode, _generate_code

URL = "/api/v1/cloud/diagnostics/trial-codes/"

# Shared test settings — CLOUD_ENABLED=True, throttling off.
_DIAG_SETTINGS = {
    "CLOUD_ENABLED": True,
}


class TestTrialCodeDiagnosticsEndpoint(TestCase):

    def setUp(self):
        self.client = APIClient()

    # ── Basic availability ─────────────────────────────────────────────────────

    @override_settings(**_DIAG_SETTINGS)
    def test_returns_200_without_authentication(self):
        """No credentials required."""
        resp = self.client.get(URL)
        self.assertEqual(resp.status_code, drf_status.HTTP_200_OK)

    def test_returns_503_when_cloud_disabled(self):
        """CloudAPIView gate returns 503 when CLOUD_ENABLED=False."""
        with override_settings(CLOUD_ENABLED=False):
            resp = self.client.get(URL)
        self.assertEqual(resp.status_code, drf_status.HTTP_503_SERVICE_UNAVAILABLE)

    @override_settings(**_DIAG_SETTINGS)
    def test_method_get_only(self):
        """POST/PUT/PATCH/DELETE should return 405."""
        for method in ("post", "put", "patch", "delete"):
            resp = getattr(self.client, method)(URL)
            self.assertEqual(
                resp.status_code,
                drf_status.HTTP_405_METHOD_NOT_ALLOWED,
                msg=f"Expected 405 for {method.upper()}",
            )

    # ── Response structure ─────────────────────────────────────────────────────

    @override_settings(**_DIAG_SETTINGS)
    def test_response_contains_django_section(self):
        resp = self.client.get(URL)
        data = resp.json()
        self.assertIn("django", data)
        self.assertIn("settings_module",  data["django"])
        self.assertIn("debug",            data["django"])
        self.assertIn("cloud_enabled",    data["django"])

    @override_settings(**_DIAG_SETTINGS)
    def test_response_contains_database_config_section(self):
        resp = self.client.get(URL)
        data = resp.json()
        self.assertIn("database_config", data)
        db = data["database_config"]
        self.assertIn("engine",           db)
        self.assertIn("name_redacted",    db)
        self.assertIn("host_redacted",    db)
        self.assertIn("port",             db)
        self.assertIn("user_redacted",    db)
        self.assertIn("database_url_set", db)
        self.assertIn("host_is_local",    db)

    @override_settings(**_DIAG_SETTINGS)
    def test_response_contains_postgres_runtime_section(self):
        resp = self.client.get(URL)
        data = resp.json()
        self.assertIn("postgres_runtime", data)
        pg = data["postgres_runtime"]
        self.assertIn("connection_ok", pg)
        self.assertTrue(pg["connection_ok"], msg="DB connection should succeed in test environment")
        self.assertIn("current_database", pg)
        self.assertIn("current_user",     pg)

    @override_settings(**_DIAG_SETTINGS)
    def test_response_contains_migration_section(self):
        resp = self.client.get(URL)
        data = resp.json()
        self.assertIn("migrations", data)
        mig = data["migrations"]
        self.assertIn("licensing_0003_applied", mig)
        self.assertIn("cloud_0004_applied",     mig)

    @override_settings(**_DIAG_SETTINGS)
    def test_migration_0003_reported_as_applied_in_test_db(self):
        resp = self.client.get(URL)
        data = resp.json()
        self.assertTrue(
            data["migrations"]["licensing_0003_applied"],
            msg="licensing.0003_add_trial_code_model must be applied in the test DB",
        )

    @override_settings(**_DIAG_SETTINGS)
    def test_response_contains_tables_section(self):
        resp = self.client.get(URL)
        data = resp.json()
        self.assertIn("tables_exist", data)
        self.assertIn("licensing_trial_code",        data["tables_exist"])
        self.assertIn("cloud_activation_reservation", data["tables_exist"])

    @override_settings(**_DIAG_SETTINGS)
    def test_tables_exist_in_test_db(self):
        resp = self.client.get(URL)
        data = resp.json()
        self.assertTrue(
            data["tables_exist"]["licensing_trial_code"],
            msg="licensing_trial_code table must exist in test DB",
        )

    @override_settings(**_DIAG_SETTINGS)
    def test_response_contains_counts_section(self):
        resp = self.client.get(URL)
        data = resp.json()
        self.assertIn("trial_code_counts", data)
        counts = data["trial_code_counts"]
        self.assertIn("total",   counts)
        self.assertIn("pending", counts)
        self.assertIn("used",    counts)
        self.assertIn("revoked", counts)

    @override_settings(**_DIAG_SETTINGS)
    def test_response_contains_latest_codes_sections(self):
        resp = self.client.get(URL)
        data = resp.json()
        self.assertIn("latest_trial_codes",         data)
        self.assertIn("latest_trial_codes_raw_sql", data)
        self.assertIn("orm_vs_raw_sql",             data)
        self.assertIn("match", data["orm_vs_raw_sql"])

    @override_settings(**_DIAG_SETTINGS)
    def test_response_contains_note(self):
        resp = self.client.get(URL)
        data = resp.json()
        self.assertIn("_note", data)
        self.assertIn("TEMPORARY", data["_note"])

    # ── Credential safety ──────────────────────────────────────────────────────

    @override_settings(**_DIAG_SETTINGS)
    def test_database_url_value_never_in_response(self):
        """DATABASE_URL value must not appear in the response body."""
        fake_url = "postgres://user:SUPERSECRET_PASS@db.host.example.com:5432/mydb"
        original = os.environ.get("DATABASE_URL")
        os.environ["DATABASE_URL"] = fake_url
        try:
            resp = self.client.get(URL)
            body = resp.content.decode()
        finally:
            if original is None:
                os.environ.pop("DATABASE_URL", None)
            else:
                os.environ["DATABASE_URL"] = original
        self.assertNotIn("SUPERSECRET_PASS", body)
        self.assertNotIn(fake_url, body)

    @override_settings(**_DIAG_SETTINGS)
    def test_secret_key_never_in_response(self):
        from django.conf import settings as dj_settings
        resp = self.client.get(URL)
        body = resp.content.decode()
        self.assertNotIn(dj_settings.SECRET_KEY[:10], body)

    @override_settings(**_DIAG_SETTINGS)
    def test_db_password_never_in_response(self):
        from django.conf import settings as dj_settings
        password = dj_settings.DATABASES.get("default", {}).get("PASSWORD", "")
        if password and len(password) > 5:
            resp = self.client.get(URL)
            body = resp.content.decode()
            self.assertNotIn(password, body)

    @override_settings(**_DIAG_SETTINGS)
    def test_host_is_redacted_not_raw(self):
        """The raw database host must not appear verbatim — only redacted form."""
        from django.conf import settings as dj_settings
        db_host = dj_settings.DATABASES.get("default", {}).get("HOST", "")
        resp = self.client.get(URL)
        data = resp.json()
        # The redacted value is present; the full raw host must not be
        redacted = data["database_config"]["host_redacted"]
        self.assertNotEqual(
            redacted, db_host,
            msg="host_redacted should not equal the raw host string",
        )

    # ── Live count verification ────────────────────────────────────────────────

    @override_settings(**_DIAG_SETTINGS)
    def test_counts_reflect_actual_db_state(self):
        """Create 2 PENDING codes; verify counts match."""
        TrialCode.objects.create(
            code=_generate_code(), status=TrialCode.TrialStatus.PENDING
        )
        TrialCode.objects.create(
            code=_generate_code(), status=TrialCode.TrialStatus.PENDING
        )
        total_actual = TrialCode.objects.count()

        resp = self.client.get(URL)
        data = resp.json()
        self.assertEqual(data["trial_code_counts"]["total"], total_actual)
        self.assertEqual(data["trial_code_counts"]["pending"], 2)

    @override_settings(**_DIAG_SETTINGS)
    def test_latest_codes_include_repr_field(self):
        """repr_code must be present so hidden characters are detectable."""
        TrialCode.objects.create(
            code=_generate_code(), status=TrialCode.TrialStatus.PENDING
        )
        resp = self.client.get(URL)
        data = resp.json()
        latest = data["latest_trial_codes"]
        self.assertTrue(len(latest) > 0)
        self.assertIn("repr_code", latest[0])
        self.assertIn("len",       latest[0])

    @override_settings(**_DIAG_SETTINGS)
    def test_orm_and_raw_sql_match_in_test_db(self):
        """ORM and raw SQL must return the same codes in a healthy test DB."""
        TrialCode.objects.create(
            code=_generate_code(), status=TrialCode.TrialStatus.PENDING
        )
        resp = self.client.get(URL)
        data = resp.json()
        self.assertTrue(
            data["orm_vs_raw_sql"]["match"],
            msg=(
                f"ORM and raw SQL returned different codes: "
                f"orm_only={data['orm_vs_raw_sql']['orm_only']}, "
                f"raw_sql_only={data['orm_vs_raw_sql']['raw_sql_only']}"
            ),
        )
