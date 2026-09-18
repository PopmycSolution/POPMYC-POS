"""
licensing/management/commands/diagnose_trial_codes.py
=====================================================
Read-only production diagnostic for the TrialCode lookup path.

Purpose
-------
TrialCode records created via Django Admin are not found by
POST /api/v1/cloud/trial/validate/.  This command reproduces the
exact database query used by TrialValidateView and prints enough
context to identify the mismatch without exposing any credential.

Usage on Render
---------------
Because Render Hobby has no persistent Shell, inject this command
into the Render BUILD COMMAND (runs on every deploy):

    pip install -r requirements-prod.txt \
    && python manage.py collectstatic --noinput \
    && python manage.py migrate \
    && python manage.py diagnose_trial_codes

Remove the diagnose_trial_codes call once the root cause is found.

Alternatively set it as a temporary START COMMAND (the process will
print the report then gunicorn will take over via the && chain):

    python manage.py diagnose_trial_codes && \
    python manage.py migrate --noinput && \
    gunicorn config.wsgi:application --bind 0.0.0.0:$PORT

What is printed
---------------
1.  Django settings module in use.
2.  Database ENGINE.
3.  Database NAME and HOST with the password redacted — safe to log.
4.  db_table for the TrialCode model.
5.  Migration state: whether 0003_add_trial_code_model is applied.
6.  Total TrialCode row count.
7.  Count by status (PENDING / USED / REVOKED / unknown).
8.  Latest 10 codes with repr(code), status, len(code), created_at.
9.  Direct lookup of RDVC-RYAD-E2Z9-6NQN-FXL2 and any other PENDING
    codes, printing repr() to expose hidden characters.
10. Raw SQL SELECT to bypass any ORM queryset behaviour.

What is NEVER printed
---------------------
- DATABASE_URL
- DB_PASSWORD
- DJANGO_SECRET_KEY
- SYNC_CLOUD_TOKEN
- Any other environment variable value that could be a secret.

No data is modified.  The command is entirely read-only.
"""

import os
import sys

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import connection, connections, DEFAULT_DB_ALIAS


# The code that is failing in production — used as the primary test case.
PRIMARY_TEST_CODE = "RDVC-RYAD-E2Z9-6NQN-FXL2"


def _redact(value: str) -> str:
    """Show first 3 chars and last 3 chars of a string, mask the middle."""
    if not value:
        return "<empty>"
    if len(value) <= 6:
        return "***"
    return f"{value[:3]}{'*' * (len(value) - 6)}{value[-3:]}"


class Command(BaseCommand):
    help = (
        "Read-only production diagnostic for the TrialCode database lookup. "
        "Never modifies data. Never prints credentials."
    )

    def handle(self, *args, **options):
        self.stdout.write("\n" + "=" * 70)
        self.stdout.write("  POPMYC POS — TrialCode Diagnostic")
        self.stdout.write("=" * 70 + "\n")

        # ── 1. Settings context ───────────────────────────────────────────────
        self._section("1. Django Settings")
        settings_module = os.environ.get(
            "DJANGO_SETTINGS_MODULE", "<not set — using default>"
        )
        self.stdout.write(f"  DJANGO_SETTINGS_MODULE : {settings_module}")
        self.stdout.write(f"  DEBUG                  : {settings.DEBUG}")
        self.stdout.write(
            f"  CLOUD_ENABLED          : {getattr(settings, 'CLOUD_ENABLED', '<not set>')}"
        )

        # ── 2. Database connection info (no password) ─────────────────────────
        self._section("2. Database Connection (credentials redacted)")
        db_cfg = settings.DATABASES.get(DEFAULT_DB_ALIAS, {})
        self.stdout.write(f"  ENGINE  : {db_cfg.get('ENGINE', '<not set>')}")
        self.stdout.write(f"  NAME    : {_redact(str(db_cfg.get('NAME', '')))}")
        self.stdout.write(f"  HOST    : {_redact(str(db_cfg.get('HOST', '')))}")
        self.stdout.write(f"  PORT    : {db_cfg.get('PORT', '<not set>')}")
        self.stdout.write(f"  USER    : {_redact(str(db_cfg.get('USER', '')))}")
        # Confirm we are NOT using the local desktop DB
        host = str(db_cfg.get("HOST", "")).lower()
        if "localhost" in host or "127.0.0" in host:
            self.stdout.write(
                self.style.WARNING(
                    "  ⚠  HOST appears to be LOCAL — this is the desktop DB, "
                    "not Supabase. Check DATABASE_URL env var on Render."
                )
            )
        else:
            self.stdout.write(
                self.style.SUCCESS("  ✓  HOST is not localhost (cloud DB)")
            )
        # DATABASE_URL presence (value never printed)
        has_db_url = bool(os.environ.get("DATABASE_URL", ""))
        self.stdout.write(f"  DATABASE_URL set       : {has_db_url}")

        # ── 3. Database connectivity ──────────────────────────────────────────
        self._section("3. Database Connectivity")
        try:
            conn = connections[DEFAULT_DB_ALIAS]
            conn.ensure_connection()
            self.stdout.write(self.style.SUCCESS("  ✓  Connection established"))
            # PostgreSQL server version
            try:
                with conn.cursor() as cur:
                    cur.execute("SELECT version()")
                    pg_version = cur.fetchone()[0]
                    # Only print the version string, not connection details
                    self.stdout.write(f"  PG version : {pg_version[:60]}…")
            except Exception as ver_exc:
                self.stdout.write(f"  PG version : <could not retrieve: {ver_exc}>")
        except Exception as conn_exc:
            self.stdout.write(
                self.style.ERROR(f"  ✗  Connection FAILED: {conn_exc}")
            )
            self.stdout.write(
                "  Cannot continue without a database connection.\n"
            )
            sys.exit(1)

        # ── 4. Migration state ────────────────────────────────────────────────
        self._section("4. Migration State")
        self._check_migration("licensing", "0003_add_trial_code_model")
        self._check_migration("cloud", "0004_add_activation_reservation")

        # ── 5. Table existence (raw SQL, bypasses ORM) ────────────────────────
        self._section("5. Table Existence (raw SQL)")
        for table in ("licensing_trial_code", "cloud_activation_reservation"):
            self._check_table(table)

        # ── 6. TrialCode model metadata ───────────────────────────────────────
        self._section("6. TrialCode Model Metadata")
        try:
            from licensing.models import TrialCode
            self.stdout.write(f"  db_table : {TrialCode._meta.db_table}")
            self.stdout.write(f"  app_label: {TrialCode._meta.app_label}")
            code_field = TrialCode._meta.get_field("code")
            self.stdout.write(f"  code field max_length: {code_field.max_length}")
            self.stdout.write(f"  code field unique    : {code_field.unique}")
            self.stdout.write(
                f"  code field db_column : {code_field.column}"
            )
        except Exception as meta_exc:
            self.stdout.write(self.style.ERROR(f"  ✗  {meta_exc}"))

        # ── 7. Row counts ─────────────────────────────────────────────────────
        self._section("7. TrialCode Row Counts")
        try:
            from licensing.models import TrialCode
            total   = TrialCode.objects.count()
            pending = TrialCode.objects.filter(
                status=TrialCode.TrialStatus.PENDING
            ).count()
            used    = TrialCode.objects.filter(
                status=TrialCode.TrialStatus.USED
            ).count()
            revoked = TrialCode.objects.filter(
                status=TrialCode.TrialStatus.REVOKED
            ).count()
            other   = total - pending - used - revoked
            self.stdout.write(f"  Total   : {total}")
            self.stdout.write(f"  PENDING : {pending}")
            self.stdout.write(f"  USED    : {used}")
            self.stdout.write(f"  REVOKED : {revoked}")
            if other:
                self.stdout.write(
                    self.style.WARNING(f"  OTHER   : {other}  ← unexpected status values")
                )
        except Exception as count_exc:
            self.stdout.write(self.style.ERROR(f"  ✗  Count query failed: {count_exc}"))

        # ── 8. Latest 10 codes ────────────────────────────────────────────────
        self._section("8. Latest 10 TrialCodes (repr reveals hidden chars)")
        try:
            from licensing.models import TrialCode
            codes = TrialCode.objects.order_by("-created_at")[:10]
            if not codes:
                self.stdout.write("  <no TrialCode records in database>")
            for tc in codes:
                # repr() will show escape sequences for non-ASCII, spaces, etc.
                self.stdout.write(
                    f"  repr: {repr(tc.code):<32}  "
                    f"len={len(tc.code):<3}  "
                    f"status={tc.status:<10}  "
                    f"created={tc.created_at}"
                )
        except Exception as list_exc:
            self.stdout.write(self.style.ERROR(f"  ✗  List query failed: {list_exc}"))

        # ── 9. Direct ORM lookup of the failing code ──────────────────────────
        self._section(f"9. ORM Lookup: TrialCode.objects.get(code=...)")
        self._test_code_lookup(PRIMARY_TEST_CODE)

        # Also test all PENDING codes (to verify the ORM path works at all)
        self._section("10. ORM Lookup: all PENDING codes")
        try:
            from licensing.models import TrialCode
            pending_codes = TrialCode.objects.filter(
                status=TrialCode.TrialStatus.PENDING
            ).order_by("-created_at")
            if not pending_codes.exists():
                self.stdout.write("  <no PENDING TrialCodes>")
            for tc in pending_codes:
                self.stdout.write(
                    f"  repr: {repr(tc.code):<32}  len={len(tc.code)}"
                )
                # Test that get() also finds it
                try:
                    found = TrialCode.objects.get(code=tc.code)
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"  ✓  objects.get(code={repr(tc.code)}) → found"
                        )
                    )
                except TrialCode.DoesNotExist:
                    self.stdout.write(
                        self.style.ERROR(
                            f"  ✗  objects.get(code={repr(tc.code)}) → "
                            "DoesNotExist (ORM round-trip broken!)"
                        )
                    )
        except Exception as pend_exc:
            self.stdout.write(self.style.ERROR(f"  ✗  {pend_exc}"))

        # ── 11. Raw SQL lookup (bypasses ORM completely) ──────────────────────
        self._section("11. Raw SQL Lookup (bypasses ORM queryset)")
        self._raw_sql_lookup(PRIMARY_TEST_CODE)

        # ── 12. Normalisation check ───────────────────────────────────────────
        self._section("12. Normalisation Check (strip + upper)")
        normalised = PRIMARY_TEST_CODE.strip().upper()
        self.stdout.write(
            f"  Input    : {repr(PRIMARY_TEST_CODE)}"
        )
        self.stdout.write(
            f"  Normalised: {repr(normalised)}"
        )
        self.stdout.write(
            f"  Lengths match: {len(PRIMARY_TEST_CODE) == len(normalised)}"
        )
        # Also run the normalised value through the lookup
        self._section("12b. ORM Lookup with normalised value")
        self._test_code_lookup(normalised)

        # ── Done ──────────────────────────────────────────────────────────────
        self.stdout.write("\n" + "=" * 70)
        self.stdout.write("  Diagnostic complete — no data was modified.")
        self.stdout.write("=" * 70 + "\n")

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _section(self, title: str) -> None:
        self.stdout.write(f"\n--- {title} ---")

    def _check_migration(self, app: str, migration: str) -> None:
        try:
            from django.db.migrations.executor import MigrationExecutor
            executor = MigrationExecutor(connection)
            applied = dict(executor.loader.applied_migrations)
            key = (app, migration)
            if key in applied:
                self.stdout.write(
                    self.style.SUCCESS(f"  ✓  {app}.{migration} — APPLIED")
                )
            else:
                self.stdout.write(
                    self.style.ERROR(
                        f"  ✗  {app}.{migration} — NOT APPLIED  "
                        f"← run: python manage.py migrate"
                    )
                )
        except Exception as mig_exc:
            self.stdout.write(f"  ?  Could not check migration state: {mig_exc}")

    def _check_table(self, table_name: str) -> None:
        try:
            with connection.cursor() as cur:
                cur.execute(
                    """
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.tables
                        WHERE table_schema = 'public'
                          AND table_name   = %s
                    )
                    """,
                    [table_name],
                )
                exists = cur.fetchone()[0]
            if exists:
                self.stdout.write(
                    self.style.SUCCESS(f"  ✓  Table '{table_name}' EXISTS")
                )
            else:
                self.stdout.write(
                    self.style.ERROR(
                        f"  ✗  Table '{table_name}' MISSING — "
                        "migration not applied or wrong database"
                    )
                )
        except Exception as tbl_exc:
            self.stdout.write(f"  ?  Could not check table '{table_name}': {tbl_exc}")

    def _test_code_lookup(self, code: str) -> None:
        """Test TrialCode.objects.get(code=code) and print result."""
        from licensing.models import TrialCode
        self.stdout.write(f"  Testing: TrialCode.objects.get(code={repr(code)})")
        try:
            tc = TrialCode.objects.get(code=code)
            self.stdout.write(
                self.style.SUCCESS(
                    f"  ✓  FOUND — repr(tc.code)={repr(tc.code)}, "
                    f"status={tc.status}, "
                    f"len={len(tc.code)}"
                )
            )
        except TrialCode.DoesNotExist:
            self.stdout.write(
                self.style.ERROR(
                    "  ✗  DoesNotExist — code not found via ORM get()"
                )
            )
            # Try a filter to see if it partially matches
            self.stdout.write("  Attempting filter fallback …")
            try:
                # case-insensitive lookup
                qs_iexact = TrialCode.objects.filter(code__iexact=code)
                if qs_iexact.exists():
                    tc = qs_iexact.first()
                    self.stdout.write(
                        self.style.WARNING(
                            f"  ⚠  iexact MATCH found: repr={repr(tc.code)}, "
                            f"len={len(tc.code)} — case mismatch!"
                        )
                    )
                else:
                    self.stdout.write("  iexact: no match")

                # contains lookup to detect partial match / hidden chars
                stripped = code.replace("-", "")
                qs_contains = TrialCode.objects.filter(
                    code__icontains=stripped[:8]
                )
                if qs_contains.exists():
                    tc = qs_contains.first()
                    self.stdout.write(
                        self.style.WARNING(
                            f"  ⚠  contains({repr(stripped[:8])}) MATCH: "
                            f"repr={repr(tc.code)}, len={len(tc.code)}"
                        )
                    )
                else:
                    self.stdout.write(
                        f"  contains({repr(stripped[:8])}): no match"
                    )
            except Exception as fb_exc:
                self.stdout.write(f"  Filter fallback error: {fb_exc}")
        except Exception as exc:
            self.stdout.write(
                self.style.ERROR(f"  ✗  Unexpected error: {exc}")
            )

    def _raw_sql_lookup(self, code: str) -> None:
        """Lookup via raw SQL to bypass all ORM queryset machinery."""
        self.stdout.write(
            f"  SELECT code, status FROM licensing_trial_code WHERE code = %s"
        )
        self.stdout.write(f"  Parameter: {repr(code)}")
        try:
            with connection.cursor() as cur:
                cur.execute(
                    "SELECT code, status, length(code) "
                    "FROM licensing_trial_code "
                    "WHERE code = %s",
                    [code],
                )
                rows = cur.fetchall()
            if rows:
                for row in rows:
                    raw_code, raw_status, code_len = row
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"  ✓  RAW SQL FOUND: "
                            f"repr={repr(raw_code)}, "
                            f"status={raw_status}, "
                            f"pg_length={code_len}"
                        )
                    )
                    if raw_code != code:
                        self.stdout.write(
                            self.style.WARNING(
                                "  ⚠  Raw value differs from Python str — "
                                "encoding/collation issue!"
                            )
                        )
            else:
                self.stdout.write(
                    self.style.ERROR(
                        "  ✗  RAW SQL: no row found for this code value"
                    )
                )
                # Count all rows to confirm table is not empty
                cur_count = connection.cursor()
                cur_count.execute(
                    "SELECT COUNT(*) FROM licensing_trial_code"
                )
                total = cur_count.fetchone()[0]
                cur_count.close()
                self.stdout.write(f"  Total rows in table (raw): {total}")

                # Dump all codes raw so repr reveals hidden chars
                self.stdout.write(
                    "  All codes in table (raw SQL, repr):"
                )
                with connection.cursor() as cur2:
                    cur2.execute(
                        "SELECT code, status, length(code) "
                        "FROM licensing_trial_code "
                        "ORDER BY created_at DESC "
                        "LIMIT 10"
                    )
                    all_rows = cur2.fetchall()
                for r_code, r_status, r_len in all_rows:
                    self.stdout.write(
                        f"    repr={repr(r_code):<35}  "
                        f"pg_len={r_len:<4}  "
                        f"status={r_status}"
                    )
        except Exception as sql_exc:
            self.stdout.write(
                self.style.ERROR(f"  ✗  Raw SQL error: {sql_exc}")
            )
