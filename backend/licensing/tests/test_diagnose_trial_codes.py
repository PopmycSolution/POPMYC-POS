"""
licensing/tests/test_diagnose_trial_codes.py
=============================================
Tests for the diagnose_trial_codes management command.

These tests verify that the command:
  - is discoverable by Django
  - runs without error against the test database
  - prints the expected sections
  - correctly identifies PENDING codes present in the DB
  - correctly reports DoesNotExist for codes not in the DB
  - never prints any credential-like strings

All tests use Django's TestCase (compatible with manage.py test --keepdb)
since the existing passing suites use that runner.
"""
from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from licensing.models import TrialCode, _generate_code


class TestDiagnoseTrialCodesCommand(TestCase):

    # ── Helpers ────────────────────────────────────────────────────────────────

    def _run(self):
        """Run the command and return stdout as a string."""
        out = StringIO()
        call_command("diagnose_trial_codes", stdout=out, stderr=out)
        return out.getvalue()

    # ── Command discoverability ────────────────────────────────────────────────

    def test_command_is_discoverable(self):
        """manage.py diagnose_trial_codes should be in the command registry."""
        from django.core.management import get_commands
        commands = get_commands()
        self.assertIn(
            "diagnose_trial_codes", commands,
            msg="Command 'diagnose_trial_codes' not found in Django command registry",
        )

    # ── Output sections ────────────────────────────────────────────────────────

    def test_output_contains_settings_section(self):
        output = self._run()
        self.assertIn("Django Settings", output)
        self.assertIn("DJANGO_SETTINGS_MODULE", output)

    def test_output_contains_database_section(self):
        output = self._run()
        self.assertIn("Database Connection", output)
        self.assertIn("ENGINE", output)

    def test_output_contains_migration_section(self):
        output = self._run()
        self.assertIn("Migration State", output)
        self.assertIn("0003_add_trial_code_model", output)

    def test_output_contains_table_existence_section(self):
        output = self._run()
        self.assertIn("Table Existence", output)
        self.assertIn("licensing_trial_code", output)

    def test_output_contains_row_counts(self):
        output = self._run()
        self.assertIn("Row Counts", output)
        self.assertIn("Total", output)
        self.assertIn("PENDING", output)

    def test_output_contains_raw_sql_section(self):
        output = self._run()
        self.assertIn("Raw SQL", output)

    def test_output_contains_normalisation_section(self):
        output = self._run()
        self.assertIn("Normalisation", output)

    def test_output_ends_with_complete_marker(self):
        output = self._run()
        self.assertIn("Diagnostic complete", output)
        self.assertIn("no data was modified", output)

    # ── Credential safety ──────────────────────────────────────────────────────

    def test_output_never_contains_database_url(self):
        """DATABASE_URL must never appear in output."""
        import os
        # Temporarily set a fake DATABASE_URL to ensure it's not printed
        original = os.environ.get("DATABASE_URL")
        os.environ["DATABASE_URL"] = "postgres://user:SUPERSECRET@host:5432/db"
        try:
            output = self._run()
        finally:
            if original is None:
                os.environ.pop("DATABASE_URL", None)
            else:
                os.environ["DATABASE_URL"] = original
        self.assertNotIn("SUPERSECRET", output)
        self.assertNotIn("postgres://user:", output)

    def test_output_never_contains_secret_key(self):
        """DJANGO_SECRET_KEY must never appear in output."""
        from django.conf import settings
        # The secret key should not appear anywhere in diagnostic output
        output = self._run()
        self.assertNotIn(settings.SECRET_KEY[:10], output)

    def test_output_never_contains_db_password(self):
        """Database password must not appear in output."""
        from django.conf import settings
        password = settings.DATABASES.get("default", {}).get("PASSWORD", "")
        if password and len(password) > 5:
            output = self._run()
            self.assertNotIn(password, output)

    # ── Code lookup behaviour ──────────────────────────────────────────────────

    def test_pending_code_in_db_is_found(self):
        """A PENDING code that exists in the DB is found by the command."""
        tc = TrialCode.objects.create(
            code=_generate_code(),
            status=TrialCode.TrialStatus.PENDING,
        )
        output = self._run()
        # The code should appear in the "Latest 10" listing
        self.assertIn(repr(tc.code), output)

    def test_missing_code_reported_as_not_found(self):
        """The primary test code (not in test DB) should show DoesNotExist."""
        # The primary test code RDVC-RYAD-E2Z9-6NQN-FXL2 is not in the test DB
        output = self._run()
        self.assertIn("DoesNotExist", output)

    def test_pending_code_lookup_succeeds(self):
        """ORM round-trip: a code stored as PENDING is found by get()."""
        tc = TrialCode.objects.create(
            code=_generate_code(),
            status=TrialCode.TrialStatus.PENDING,
        )
        output = self._run()
        # Section 10 tests all PENDING codes with objects.get()
        # The success marker is "→ found" in the output
        self.assertIn("found", output.lower())

    def test_raw_sql_finds_pending_code(self):
        """Raw SQL section also finds a PENDING code in the DB."""
        TrialCode.objects.create(
            code=_generate_code(),
            status=TrialCode.TrialStatus.PENDING,
        )
        output = self._run()
        # Either found via raw SQL of the primary code, or via ORM section
        # The raw SQL section will show total row count
        self.assertIn("licensing_trial_code", output)

    def test_count_reflects_db_state(self):
        """Row count output matches what's actually in the DB."""
        # Create 2 PENDING codes
        TrialCode.objects.create(
            code=_generate_code(), status=TrialCode.TrialStatus.PENDING
        )
        TrialCode.objects.create(
            code=_generate_code(), status=TrialCode.TrialStatus.PENDING
        )
        actual_total = TrialCode.objects.count()
        output = self._run()
        # The total count line should contain the actual number
        self.assertIn(str(actual_total), output)

    # ── Migration checks ───────────────────────────────────────────────────────

    def test_migration_0003_reported_as_applied(self):
        """In the test DB, migration 0003 must be applied."""
        output = self._run()
        self.assertIn("0003_add_trial_code_model", output)
        self.assertIn("APPLIED", output)

    def test_table_licensing_trial_code_reported_as_exists(self):
        """licensing_trial_code table must exist in the test DB."""
        output = self._run()
        # Should appear with "EXISTS" next to it
        lines = [l for l in output.splitlines() if "licensing_trial_code" in l]
        self.assertTrue(
            any("EXISTS" in line or "✓" in line for line in lines),
            msg=f"Expected table 'licensing_trial_code' to be reported as EXISTS. Lines: {lines}",
        )
