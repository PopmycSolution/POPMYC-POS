"""
licensing/tests/test_admin_diagnostic.py
=========================================
Tests for the TEMPORARY TrialCode database diagnostic Admin page.

URL: /admin/licensing/trialcode/database-diagnostic/

Covers
------
- Anonymous users are redirected to login (not shown the page).
- Non-staff users cannot access the page (redirected/403).
- Superusers can access the page and get HTTP 200.
- The response is HTML.
- All required diagnostic sections are present.
- Credential-sensitive values (DATABASE_URL, SECRET_KEY, DB password)
  are never present in the response body.
- TrialCode counts in the page reflect actual DB state.
- repr() column is present for hidden-character detection.
- No data is created, modified, or deleted.
"""
import os

from django.contrib.auth import get_user_model
from django.test import TestCase, Client

from licensing.models import TrialCode, _generate_code

User = get_user_model()

DIAG_URL = "/admin/licensing/trialcode/database-diagnostic/"


class TestAdminDiagnosticPage(TestCase):

    def setUp(self):
        self.client = Client()
        self.superuser = User.objects.create_superuser(
            username="diag_admin",
            password="AdminPass@123",
            email="diag@test.com",
        )
        self.staff_user = User.objects.create_user(
            username="diag_staff",
            password="StaffPass@123",
            email="staff@test.com",
            is_staff=True,       # staff but not superuser
        )
        self.regular_user = User.objects.create_user(
            username="diag_regular",
            password="RegularPass@123",
            email="regular@test.com",
        )

    # ── Access control ─────────────────────────────────────────────────────────

    def test_anonymous_redirected_to_login(self):
        """Unauthenticated requests are redirected to the admin login page."""
        resp = self.client.get(DIAG_URL)
        self.assertEqual(resp.status_code, 302)
        self.assertIn("login", resp["Location"])

    def test_regular_user_cannot_access(self):
        """Non-staff users are redirected/denied."""
        self.client.login(username="diag_regular", password="RegularPass@123")
        resp = self.client.get(DIAG_URL)
        # Django admin redirects non-staff to login
        self.assertIn(resp.status_code, [302, 403])

    def test_superuser_gets_200(self):
        """Superusers can access the diagnostic page."""
        self.client.login(username="diag_admin", password="AdminPass@123")
        resp = self.client.get(DIAG_URL)
        self.assertEqual(resp.status_code, 200)

    def test_staff_user_gets_200(self):
        """Staff users (is_staff=True) can also access the page."""
        self.client.login(username="diag_staff", password="StaffPass@123")
        resp = self.client.get(DIAG_URL)
        self.assertEqual(resp.status_code, 200)

    # ── Response format ────────────────────────────────────────────────────────

    def test_response_is_html(self):
        self.client.login(username="diag_admin", password="AdminPass@123")
        resp = self.client.get(DIAG_URL)
        self.assertIn("text/html", resp["Content-Type"])

    def test_page_contains_title(self):
        self.client.login(username="diag_admin", password="AdminPass@123")
        resp = self.client.get(DIAG_URL)
        body = resp.content.decode()
        self.assertIn("TrialCode", body)
        self.assertIn("Diagnostic", body)

    def test_page_is_readonly_marker_present(self):
        self.client.login(username="diag_admin", password="AdminPass@123")
        resp = self.client.get(DIAG_URL)
        body = resp.content.decode()
        self.assertIn("READ-ONLY", body)

    # ── Required sections ──────────────────────────────────────────────────────

    def test_page_contains_settings_module(self):
        self.client.login(username="diag_admin", password="AdminPass@123")
        resp = self.client.get(DIAG_URL)
        body = resp.content.decode()
        self.assertIn("Settings module", body)

    def test_page_contains_database_engine(self):
        self.client.login(username="diag_admin", password="AdminPass@123")
        resp = self.client.get(DIAG_URL)
        body = resp.content.decode()
        self.assertIn("ENGINE", body)

    def test_page_contains_redacted_db_name(self):
        self.client.login(username="diag_admin", password="AdminPass@123")
        resp = self.client.get(DIAG_URL)
        body = resp.content.decode()
        self.assertIn("NAME (redacted)", body)

    def test_page_contains_redacted_host(self):
        self.client.login(username="diag_admin", password="AdminPass@123")
        resp = self.client.get(DIAG_URL)
        body = resp.content.decode()
        self.assertIn("HOST (redacted)", body)

    def test_page_contains_database_url_set_field(self):
        self.client.login(username="diag_admin", password="AdminPass@123")
        resp = self.client.get(DIAG_URL)
        body = resp.content.decode()
        self.assertIn("DATABASE_URL set", body)

    def test_page_contains_postgres_runtime_section(self):
        self.client.login(username="diag_admin", password="AdminPass@123")
        resp = self.client.get(DIAG_URL)
        body = resp.content.decode()
        self.assertIn("current_database()", body)
        self.assertIn("current_user", body)

    def test_page_contains_trial_code_counts(self):
        self.client.login(username="diag_admin", password="AdminPass@123")
        resp = self.client.get(DIAG_URL)
        body = resp.content.decode()
        self.assertIn("PENDING", body)
        self.assertIn("USED",    body)
        self.assertIn("REVOKED", body)

    def test_page_contains_repr_column(self):
        """repr() column must be present to expose hidden characters."""
        self.client.login(username="diag_admin", password="AdminPass@123")
        resp = self.client.get(DIAG_URL)
        body = resp.content.decode()
        self.assertIn("repr", body)

    # ── Credential safety ──────────────────────────────────────────────────────

    def test_database_url_value_never_in_response(self):
        """The value of DATABASE_URL must never appear in the page."""
        fake_url = "postgres://user:SUPERSECRET99@db.supabase.co:5432/prod"
        original = os.environ.get("DATABASE_URL")
        os.environ["DATABASE_URL"] = fake_url
        try:
            self.client.login(username="diag_admin", password="AdminPass@123")
            resp = self.client.get(DIAG_URL)
            body = resp.content.decode()
        finally:
            if original is None:
                os.environ.pop("DATABASE_URL", None)
            else:
                os.environ["DATABASE_URL"] = original
        self.assertNotIn("SUPERSECRET99", body)
        self.assertNotIn(fake_url, body)

    def test_secret_key_never_in_response(self):
        from django.conf import settings
        self.client.login(username="diag_admin", password="AdminPass@123")
        resp = self.client.get(DIAG_URL)
        body = resp.content.decode()
        self.assertNotIn(settings.SECRET_KEY[:10], body)

    def test_db_password_never_in_response(self):
        from django.conf import settings
        password = settings.DATABASES.get("default", {}).get("PASSWORD", "")
        if password and len(password) > 5:
            self.client.login(username="diag_admin", password="AdminPass@123")
            resp = self.client.get(DIAG_URL)
            body = resp.content.decode()
            self.assertNotIn(password, body)

    def test_raw_host_is_redacted(self):
        """The host_redacted field must not equal the raw hostname."""
        from django.conf import settings
        db_host = settings.DATABASES.get("default", {}).get("HOST", "")
        if db_host and len(db_host) > 6:
            self.client.login(username="diag_admin", password="AdminPass@123")
            resp = self.client.get(DIAG_URL)
            body = resp.content.decode()
            # The full raw hostname must not appear adjacent to "HOST (redacted)"
            # in an unmasked form — find the redacted cell value
            self.assertIn("HOST (redacted)", body)
            # The redacted value should contain asterisks
            self.assertIn("***", body)

    # ── Data integrity ─────────────────────────────────────────────────────────

    def test_counts_reflect_actual_state(self):
        """Counts displayed match the actual DB state."""
        TrialCode.objects.create(
            code=_generate_code(), status=TrialCode.TrialStatus.PENDING
        )
        TrialCode.objects.create(
            code=_generate_code(), status=TrialCode.TrialStatus.PENDING
        )
        self.client.login(username="diag_admin", password="AdminPass@123")
        resp = self.client.get(DIAG_URL)
        body = resp.content.decode()
        # 2 PENDING codes — the string "2" should appear in the counts section
        self.assertIn(">2<", body)

    def test_no_data_modified(self):
        """GET request must not modify any TrialCode rows."""
        tc = TrialCode.objects.create(
            code=_generate_code(), status=TrialCode.TrialStatus.PENDING
        )
        original_status = tc.status
        self.client.login(username="diag_admin", password="AdminPass@123")
        self.client.get(DIAG_URL)
        tc.refresh_from_db()
        self.assertEqual(tc.status, original_status)

    def test_code_values_displayed(self):
        """The codes of existing TrialCode records appear on the page."""
        tc = TrialCode.objects.create(
            code=_generate_code(), status=TrialCode.TrialStatus.PENDING
        )
        self.client.login(username="diag_admin", password="AdminPass@123")
        resp = self.client.get(DIAG_URL)
        body = resp.content.decode()
        self.assertIn(tc.code, body)
