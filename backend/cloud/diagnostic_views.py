"""
cloud/diagnostic_views.py
=========================
TEMPORARY read-only diagnostic endpoint.

Purpose
-------
Expose enough runtime database context via an HTTP GET to determine why
TrialCode records created in Django Admin are not found by
POST /api/v1/cloud/trial/validate/.

Endpoint
--------
GET /api/v1/cloud/diagnostics/trial-codes/

Security
--------
- Read-only.  No data is created, modified, or deleted.
- Never returns: DATABASE_URL, DB_PASSWORD, SECRET_KEY, tokens,
  or any other secret/credential value.
- Database name, host, and user are redacted (first 3 + last 3 chars,
  middle replaced with ***).
- PostgreSQL introspection uses current_database() and current_user —
  these return the actual runtime values visible inside the DB session,
  which is the authoritative proof of which database the API uses.
- AllowAny — no authentication required (this endpoint must be callable
  before any user exists in the production database).
- Gated behind CLOUD_ENABLED=True via CloudAPIView base class.

Removal
-------
Once the root cause is found, delete this file and remove the URL entry
from cloud/urls.py.  No other files reference this module.
"""

from __future__ import annotations

import os

from django.conf import settings
from django.db import connection
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .feature_flags import CloudAPIView


def _redact(value: str) -> str:
    """
    Return a safe redacted view of a string.
    Shows first 3 + last 3 characters; masks everything in between.
    Short strings are fully masked.
    """
    s = str(value) if value else ""
    if not s:
        return "<empty>"
    if len(s) <= 6:
        return "*" * len(s)
    return f"{s[:3]}{'*' * (len(s) - 6)}{s[-3:]}"


class TrialCodeDiagnosticsView(CloudAPIView):
    """
    GET /api/v1/cloud/diagnostics/trial-codes/

    Returns a JSON object with:
      - Django runtime context (settings module, CLOUD_ENABLED)
      - Database connection info (engine, redacted name/host/user, port)
      - Whether DATABASE_URL environment variable is set (not its value)
      - PostgreSQL current_database() and current_user (actual runtime values)
      - TrialCode row counts (total, by status)
      - Latest 5 TrialCode records (code, status, repr_code, created_at)

    Everything is read-only.  No secret values are included.
    """

    permission_classes = [AllowAny]
    # No throttle — this is a temporary internal diagnostic tool, not a
    # customer-facing endpoint.  Remove the whole file once diagnosis is done.

    def get(self, request):  # noqa: C901
        payload: dict = {}

        # ── 1. Django runtime context ─────────────────────────────────────────
        payload["django"] = {
            "settings_module": os.environ.get(
                "DJANGO_SETTINGS_MODULE", "<not set>"
            ),
            "debug": settings.DEBUG,
            "cloud_enabled": getattr(settings, "CLOUD_ENABLED", False),
        }

        # ── 2. Database connection config (no password) ───────────────────────
        db_cfg = settings.DATABASES.get("default", {})
        engine  = db_cfg.get("ENGINE", "")
        db_name = str(db_cfg.get("NAME", ""))
        db_host = str(db_cfg.get("HOST", ""))
        db_user = str(db_cfg.get("USER", ""))
        db_port = db_cfg.get("PORT", "")

        host_lower = db_host.lower()
        is_local = "localhost" in host_lower or "127.0.0" in host_lower

        payload["database_config"] = {
            "engine":           engine,
            "name_redacted":    _redact(db_name),
            "host_redacted":    _redact(db_host),
            "port":             str(db_port),
            "user_redacted":    _redact(db_user),
            "database_url_set": bool(os.environ.get("DATABASE_URL", "")),
            "host_is_local":    is_local,
            "warning":          (
                "HOST appears to be localhost — API may be using "
                "the local desktop DB instead of Supabase"
            ) if is_local else None,
        }

        # ── 3. PostgreSQL runtime introspection ───────────────────────────────
        # These values come from the *actual database session*, not from
        # Django settings.  They are the definitive answer to "which DB is
        # the API actually connected to?"
        pg_info: dict = {}
        try:
            with connection.cursor() as cur:
                cur.execute(
                    "SELECT current_database(), current_user, version()"
                )
                row = cur.fetchone()
                pg_db, pg_user, pg_version = row
                pg_info["current_database"] = pg_db          # not a secret
                pg_info["current_user"]     = pg_user        # DB role name
                pg_info["server_version"]   = pg_version[:80]
                pg_info["connection_ok"]    = True
        except Exception as exc:
            pg_info["connection_ok"] = False
            pg_info["error"]         = str(exc)

        payload["postgres_runtime"] = pg_info

        # ── 4. Migration state ────────────────────────────────────────────────
        migrations_info: dict = {}
        try:
            from django.db.migrations.executor import MigrationExecutor
            executor = MigrationExecutor(connection)
            applied  = set(executor.loader.applied_migrations)
            migrations_info["licensing_0003_applied"] = (
                ("licensing", "0003_add_trial_code_model") in applied
            )
            migrations_info["cloud_0004_applied"] = (
                ("cloud", "0004_add_activation_reservation") in applied
            )
        except Exception as mig_exc:
            migrations_info["error"] = str(mig_exc)

        payload["migrations"] = migrations_info

        # ── 5. Table existence (raw SQL) ──────────────────────────────────────
        tables_info: dict = {}
        for table in ("licensing_trial_code", "cloud_activation_reservation"):
            try:
                with connection.cursor() as cur:
                    cur.execute(
                        """
                        SELECT EXISTS (
                            SELECT 1
                            FROM information_schema.tables
                            WHERE table_schema = 'public'
                              AND table_name   = %s
                        )
                        """,
                        [table],
                    )
                    tables_info[table] = cur.fetchone()[0]
            except Exception as tbl_exc:
                tables_info[table] = f"error: {tbl_exc}"

        payload["tables_exist"] = tables_info

        # ── 6. TrialCode counts ───────────────────────────────────────────────
        counts_info: dict = {}
        try:
            from licensing.models import TrialCode

            counts_info["total"]   = TrialCode.objects.count()
            counts_info["pending"] = TrialCode.objects.filter(
                status=TrialCode.TrialStatus.PENDING
            ).count()
            counts_info["used"]    = TrialCode.objects.filter(
                status=TrialCode.TrialStatus.USED
            ).count()
            counts_info["revoked"] = TrialCode.objects.filter(
                status=TrialCode.TrialStatus.REVOKED
            ).count()
            counts_info["db_table"] = TrialCode._meta.db_table
        except Exception as cnt_exc:
            counts_info["error"] = str(cnt_exc)

        payload["trial_code_counts"] = counts_info

        # ── 7. Latest 5 TrialCode records ─────────────────────────────────────
        # Activation codes are diagnostic vouchers, not credentials.
        # repr() is included so any hidden characters (non-ASCII, invisible
        # Unicode, unexpected spaces) are immediately visible in the JSON.
        records: list = []
        try:
            from licensing.models import TrialCode
            qs = TrialCode.objects.order_by("-created_at")[:5]
            for tc in qs:
                records.append(
                    {
                        "code":       tc.code,
                        "repr_code":  repr(tc.code),   # exposes hidden chars
                        "len":        len(tc.code),
                        "status":     tc.status,
                        "created_at": tc.created_at.isoformat()
                        if tc.created_at
                        else None,
                    }
                )
        except Exception as rec_exc:
            records = [{"error": str(rec_exc)}]

        payload["latest_trial_codes"] = records

        # ── 8. Raw SQL latest 5 (bypasses ORM completely) ─────────────────────
        # If ORM and raw SQL return different results, there is a queryset
        # layer issue.  If both return the same nothing, the table is genuinely
        # empty or pointing at the wrong database.
        raw_records: list = []
        try:
            with connection.cursor() as cur:
                cur.execute(
                    """
                    SELECT code, status,
                           length(code) AS code_len,
                           created_at
                    FROM   licensing_trial_code
                    ORDER  BY created_at DESC
                    LIMIT  5
                    """,
                )
                for row in cur.fetchall():
                    r_code, r_status, r_len, r_created = row
                    raw_records.append(
                        {
                            "code":       r_code,
                            "repr_code":  repr(r_code),
                            "pg_length":  r_len,
                            "status":     r_status,
                            "created_at": r_created.isoformat()
                            if r_created
                            else None,
                        }
                    )
        except Exception as raw_exc:
            raw_records = [{"error": str(raw_exc)}]

        payload["latest_trial_codes_raw_sql"] = raw_records

        # ── 9. ORM vs raw SQL consistency check ───────────────────────────────
        # Compare the sets of codes returned by the ORM and raw SQL.
        orm_codes = {r["code"] for r in records if "code" in r}
        raw_codes = {r["code"] for r in raw_records if "code" in r}
        payload["orm_vs_raw_sql"] = {
            "match":       orm_codes == raw_codes,
            "orm_only":    list(orm_codes - raw_codes),
            "raw_sql_only": list(raw_codes - orm_codes),
        }

        # ── Done ──────────────────────────────────────────────────────────────
        payload["_note"] = (
            "TEMPORARY DIAGNOSTIC ENDPOINT — remove after diagnosis is complete."
        )

        return Response(payload, status=status.HTTP_200_OK)
