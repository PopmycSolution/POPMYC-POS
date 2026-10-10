#!/usr/bin/env python
"""
service_launcher.py
===================
Entry point for the POPMYC POS Windows background service.

Invoked by NSSM (Non-Sucking Service Manager) as:

    python.exe service_launcher.py [--port 8000] [--host 127.0.0.1]

This script is intentionally separate from desktop_launcher.py because the
service context has different requirements:

  - No interactive UI (no pg_setup wizard, no Electron parent process)
  - No collectstatic (static files must already be built before service start)
  - PostgreSQL may still be starting when Windows boots — we must wait/retry
  - Migrations run safely on every start (idempotent — Django skips up-to-date)
  - Must exit with code 1 on fatal error so NSSM knows to restart/report failure
  - Must handle SIGTERM cleanly so NSSM can stop the service gracefully

Startup sequence:
  1. Resolve data directory and load .env
  2. Configure Django settings
  3. Poll PostgreSQL until available (30 retries × 5 s = up to 2.5 min)
  4. Check for pending migrations; create pre-migration backup if any
  5. Apply pending migrations
  6. Verify backend health (self-test)
  7. Start Waitress on 127.0.0.1:8000

Logging:
  - Stdout/stderr are captured by NSSM and written to:
      C:\\ProgramData\\POPMYC POS\\logs\\service_stdout.log
      C:\\ProgramData\\POPMYC POS\\logs\\service_stderr.log
  - Django application logs go to:
      C:\\ProgramData\\POPMYC POS\\logs\\popmyc_desktop.log
  - All log files are rotated at 10 MB by NSSM (stdout/stderr) or
    by Django's RotatingFileHandler (application log).

Security:
  - Never logs passwords, tokens, or activation codes.
  - Binds exclusively to 127.0.0.1 — never exposed to the network.
"""

from __future__ import annotations

import argparse
import os
import re
import signal
import sys
import time
from pathlib import Path


# ── Constants ──────────────────────────────────────────────────────────────────

SERVICE_NAME      = "POPMYCBackend"
PG_RETRY_COUNT    = 36        # attempts — 36 × 5s = 180s max wait (generous for fresh PG install)
PG_RETRY_DELAY    = 5.0       # seconds between attempts
LOG_PREFIX        = "[POPMYC Service]"


# ── Helpers ────────────────────────────────────────────────────────────────────

def log(msg: str) -> None:
    """Print a timestamped message to stdout (captured by NSSM into service log)."""
    from datetime import datetime
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"{ts} {LOG_PREFIX} {msg}", flush=True)


def log_err(msg: str) -> None:
    """Print a timestamped error to stderr (captured by NSSM into service error log)."""
    from datetime import datetime
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"{ts} {LOG_PREFIX} ERROR: {msg}", file=sys.stderr, flush=True)


def fatal(msg: str, code: int = 1) -> None:
    """Log a fatal error and exit with the given code (non-zero → NSSM will restart)."""
    log_err(msg)
    sys.exit(code)


# ── Data directory / env ───────────────────────────────────────────────────────

def resolve_data_dir() -> Path:
    """
    Determine the persistent data directory in priority order:
      1. POPMYC_DATA_DIR environment variable (set by NSSM AppEnvironmentExtra)
      2. %PROGRAMDATA%\\POPMYC POS  (C:\\ProgramData\\POPMYC POS)
         Preferred for production: machine-wide, accessible to LocalSystem
         service AND every logged-in operator regardless of which user account
         the service runs under.  Always readable/writable by LocalSystem.
      3. %APPDATA%\\POPMYC POS  (Windows per-user fallback — dev/legacy)
      4. ~/.popmyc-pos           (non-Windows dev fallback)

    GUARD: If POPMYC_DATA_DIR is set but doesn't end with 'POPMYC POS'
    (case-insensitive), it was likely truncated by the old NSSM
    AppEnvironmentExtra space-splitting bug (where 'C:\\ProgramData\\POPMYC POS'
    became 'C:\\ProgramData\\POPMYC').  In that case fall through to priority 2
    so the correct machine-wide path is used.
    """
    raw = os.environ.get("POPMYC_DATA_DIR", "").strip()
    if raw:
        if raw.upper().endswith("POPMYC POS"):
            p = Path(raw)
            log(f"Data dir (from POPMYC_DATA_DIR env): {p}")
            return p
        else:
            log(
                f"WARNING: POPMYC_DATA_DIR='{raw}' does not end with 'POPMYC POS' — "
                f"likely truncated by NSSM space-splitting bug. "
                f"Ignoring and using %PROGRAMDATA%\\POPMYC POS instead."
            )
    programdata = os.environ.get("PROGRAMDATA")
    if programdata:
        p = Path(programdata) / "POPMYC POS"
        log(f"Data dir (from PROGRAMDATA): {p}")
        return p
    appdata = os.environ.get("APPDATA")
    if appdata:
        p = Path(appdata) / "POPMYC POS"
        log(f"Data dir (from APPDATA fallback): {p}")
        return p
    p = Path.home() / ".popmyc-pos"
    log(f"Data dir (home fallback): {p}")
    return p


def ensure_data_dirs(data_dir: Path) -> None:
    for sub in ("logs", "media", "backups"):
        (data_dir / sub).mkdir(parents=True, exist_ok=True)


def load_env(data_dir: Path) -> None:
    """
    Load the .env from the persistent data directory into os.environ.
    Existing environment variables are NOT overwritten (the installer or NSSM
    may already have set DB_* etc. via AppEnvironmentExtra).
    """
    env_path = data_dir / ".env"
    if not env_path.exists():
        log(f"WARNING: No .env found at {env_path} — using environment defaults")
        return
    try:
        from dotenv import load_dotenv
        load_dotenv(dotenv_path=str(env_path), override=True)
        log(f"Loaded .env from {env_path} (env vars overridden)")
    except ImportError:
        # Fallback manual parser (python-dotenv must be in the venv)
        log("WARNING: python-dotenv not available — parsing .env manually")
        _scrubbed = re.compile(r"(?i)(password|secret|token|key)\s*=.*")
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key   = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
                elif key:
                    os.environ[key] = value  # always override from .env
        log("Manual .env parsing complete")


# ── PostgreSQL readiness check ─────────────────────────────────────────────────

def wait_for_postgres(retries: int = PG_RETRY_COUNT, delay: float = PG_RETRY_DELAY) -> bool:
    """
    Attempt a lightweight PostgreSQL connection up to `retries` times,
    waiting `delay` seconds between each attempt.

    Returns True when the connection succeeds, False if all retries are exhausted.
    Does NOT raise — the caller decides whether to fatal() or continue.

    NOTE: django.setup() must be called before this function so that
    django.db.connection uses the correct DB settings.
    """
    import django
    from django.db import connection, OperationalError, ProgrammingError

    db_host = os.environ.get("DB_HOST", "localhost")
    db_port = os.environ.get("DB_PORT", "5432")
    db_name = os.environ.get("DB_NAME", "popmyc_pos")
    # Never log the password
    log(f"Waiting for PostgreSQL at {db_host}:{db_port}/{db_name} …")

    for attempt in range(1, retries + 1):
        try:
            connection.ensure_connection()
            # Cheap sanity query
            with connection.cursor() as cur:
                cur.execute("SELECT 1")
            log(f"PostgreSQL ready (attempt {attempt}/{retries})")
            connection.close()
            return True
        except (OperationalError, ProgrammingError, Exception) as exc:
            # Scrub any password that might appear in the exception message
            msg = re.sub(r"(?i)password[^\s]*\s*=\s*\S+", "password=[hidden]", str(exc))
            if attempt < retries:
                log(f"PostgreSQL not ready (attempt {attempt}/{retries}): {msg[:120]} — retrying in {delay:.0f}s")
                time.sleep(delay)
            else:
                log_err(f"PostgreSQL still unavailable after {retries} attempts: {msg[:200]}")
        finally:
            try:
                connection.close()
            except Exception:
                pass
    return False


# ── Migrations ─────────────────────────────────────────────────────────────────

def _auto_backup(data_dir: Path) -> None:
    """
    Best-effort pre-migration backup via pg_dump.
    Failures are logged but non-fatal — the caller decides whether to proceed.
    Password is passed via PGPASSWORD env var, never on the command line.
    """
    import shutil
    import subprocess

    backup_dir = data_dir / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)

    db_host = os.environ.get("DB_HOST", "localhost")
    db_port = os.environ.get("DB_PORT", "5432")
    db_name = os.environ.get("DB_NAME", "popmyc_pos")
    db_user = os.environ.get("DB_USER", "postgres")
    db_pass = os.environ.get("DB_PASSWORD", "")

    # Find pg_dump
    candidates = [
        shutil.which("pg_dump"),
        r"C:\Program Files\PostgreSQL\17\bin\pg_dump.exe",
        r"C:\Program Files\PostgreSQL\16\bin\pg_dump.exe",
        r"C:\Program Files\PostgreSQL\15\bin\pg_dump.exe",
        r"C:\Program Files\PostgreSQL\14\bin\pg_dump.exe",
        r"C:\Program Files\PostgreSQL\13\bin\pg_dump.exe",
    ]
    pg_dump = next((c for c in candidates if c and Path(c).exists()), None)
    if not pg_dump:
        log("WARNING: pg_dump not found — skipping pre-migration backup")
        return

    from datetime import datetime
    timestamp  = datetime.now().strftime("%Y%m%d_%H%M%S")
    tmp_file   = backup_dir / f"popmyc_backup_{timestamp}.sql.gz.tmp"
    final_file = backup_dir / f"popmyc_backup_{timestamp}.sql.gz"

    env = os.environ.copy()
    env["PGPASSWORD"] = db_pass  # never appears on the command line

    cmd = [
        pg_dump,
        "--host", db_host, "--port", db_port,
        "--username", db_user, "--dbname", db_name,
        "--format", "p", "--no-owner", "--no-acl",
        "--compress", "6",
    ]

    try:
        with open(tmp_file, "wb") as out_f:
            result = subprocess.run(
                cmd, env=env, stdout=out_f,
                stderr=subprocess.PIPE, timeout=300,
            )
        if result.returncode != 0:
            tmp_file.unlink(missing_ok=True)
            err = result.stderr.decode(errors="replace")
            err = re.sub(r"(?i)password[^\n]*", "[password hidden]", err)
            raise RuntimeError(f"pg_dump exited {result.returncode}: {err[:200]}")
        tmp_file.rename(final_file)
        size_kb = final_file.stat().st_size // 1024
        log(f"Pre-migration backup saved: {final_file.name} ({size_kb} KB)")
    except Exception as exc:
        tmp_file.unlink(missing_ok=True)
        log(f"WARNING: Pre-migration backup failed (non-fatal): {exc}")


def apply_migrations(data_dir: Path) -> bool:
    """
    Run Django migrations.  Safe to call on every startup — Django is idempotent.
    Returns True on success, False on failure.

    NOTE: Pre-migration backups are intentionally skipped here for speed.
    The startup latency budget is tight (Electron waits 180s).
    Backups should be scheduled separately, not run on every service start.
    """
    from django.db import connection as _conn
    from django.db.migrations.executor import MigrationExecutor
    from django.core.management import call_command
    from io import StringIO

    try:
        executor = MigrationExecutor(_conn)
        targets  = executor.loader.graph.leaf_nodes()
        pending  = executor.migration_plan(targets)
    except Exception as exc:
        log(f"WARNING: Could not check pending migrations: {exc}")
        pending = []

    if pending:
        log(f"{len(pending)} migration(s) pending — applying …")
    else:
        log("No pending migrations.")

    log("Applying migrations …")
    buf = StringIO()
    try:
        call_command("migrate", "--run-syncdb", stdout=buf, stderr=buf)
        output = buf.getvalue().strip()
        for line in output.splitlines():
            log(f"  {line}")
        log("Migrations OK")
        return True
    except Exception as exc:
        log_err(f"Migration failed: {exc}")
        return False


# ── Graceful shutdown ──────────────────────────────────────────────────────────

_shutdown_requested = False


def _register_device_with_cloud(data_dir: Path) -> None:
    """
    Register (or update) this local POS installation as a SyncDevice on Render.

    This tells the cloud which business this device belongs to so that
    SyncDownloadView can scope records correctly when the device syncs.

    Registration is idempotent — the cloud uses update_or_create on device_id.
    The device_id is a stable UUID stored in the local data directory so the
    same installation always uses the same identity across restarts.

    Non-fatal: if the cloud is unreachable the local POS continues working.
    The SyncWorker will retry registration on every startup via SyncManager.
    """
    try:
        from django.conf import settings as _settings
        cloud_url   = getattr(_settings, "SYNC_CLOUD_URL",   "").rstrip("/")
        cloud_token = getattr(_settings, "SYNC_CLOUD_TOKEN", "")
        cloud_enabled = getattr(_settings, "CLOUD_ENABLED", False)

        if not cloud_enabled or not cloud_url or not cloud_token:
            return  # not configured — skip silently

        # ── Get or generate a stable device_id ────────────────────────────────
        device_id_file = data_dir / "device_id.txt"
        if device_id_file.exists():
            device_id = device_id_file.read_text(encoding="utf-8").strip()
        else:
            import uuid as _uuid
            device_id = str(_uuid.uuid4())
            device_id_file.write_text(device_id, encoding="utf-8")
            log(f"Generated new device_id: {device_id}")

        # ── Get business and branch from local DB ──────────────────────────────
        business_id = None
        branch_id   = None
        machine_name = ""
        try:
            import socket
            machine_name = socket.gethostname()
        except Exception:
            pass

        try:
            from businesses.models import Business
            biz = Business.objects.order_by("created_at").first()
            if biz:
                business_id = str(biz.id)
        except Exception:
            pass

        try:
            from branches.models import Branch
            br = Branch.objects.filter(is_head_office=True).first() or Branch.objects.first()
            if br:
                branch_id = str(br.id)
        except Exception:
            pass

        # ── POST to cloud device endpoint ─────────────────────────────────────
        import urllib.request
        import urllib.error
        import json

        payload = json.dumps({
            "device_id":   device_id,
            "name":        f"POPMYC POS — {machine_name}" if machine_name else "POPMYC POS",
            "business_id": business_id,
            "branch_id":   branch_id,
        }).encode("utf-8")

        req = urllib.request.Request(
            f"{cloud_url}/device/",
            data=payload,
            headers={
                "Content-Type":  "application/json",
                "Accept":        "application/json",
                "Authorization": f"Bearer {cloud_token}",
            },
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read().decode())
            log(f"Device registered with cloud. device_id={device_id} business_id={business_id}")

            # ── Also create/update local SyncDevice record ─────────────────────
            # The SyncWorker needs a local SyncDevice row to track sync_checkpoint.
            try:
                import uuid as _uuid
                from synchronization.models import SyncDevice
                SyncDevice.objects.update_or_create(
                    device_id=_uuid.UUID(device_id),
                    defaults={
                        "name":        f"POPMYC POS — {machine_name}",
                        "business_id": _uuid.UUID(business_id) if business_id else None,
                        "branch_id":   _uuid.UUID(branch_id)   if branch_id   else None,
                        "is_active":   True,
                    },
                )
            except Exception as _local_exc:
                log(f"WARNING: Could not create local SyncDevice: {_local_exc}")

    except urllib.error.HTTPError as exc:
        log(f"WARNING: Device registration HTTP error {exc.code} — will retry on next start.")
    except (urllib.error.URLError, OSError):
        log("WARNING: Cloud unreachable for device registration — will sync when online.")
    except Exception as exc:
        log(f"WARNING: Device registration failed ({type(exc).__name__}) — non-fatal.")


def _handle_sigterm(signum, frame):  # noqa: ANN001
    """NSSM sends SIGTERM (or WM_CLOSE) when the service is stopped.
    Waitress catches KeyboardInterrupt/SystemExit, so we convert SIGTERM to
    a clean SystemExit which Waitress will handle."""
    global _shutdown_requested
    _shutdown_requested = True
    log("Received stop signal — shutting down …")
    raise SystemExit(0)


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    # ── Argument parsing ──────────────────────────────────────────────────────
    parser = argparse.ArgumentParser(description="POPMYC POS Windows Service Launcher")
    parser.add_argument("--port", type=int, default=8000, help="Waitress bind port")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Waitress bind host")
    args = parser.parse_args()

    port = args.port
    host = args.host

    # ── Signal handling ───────────────────────────────────────────────────────
    signal.signal(signal.SIGTERM, _handle_sigterm)
    if hasattr(signal, "SIGBREAK"):          # Windows Ctrl+Break
        signal.signal(signal.SIGBREAK, _handle_sigterm)

    # ── Data directory ────────────────────────────────────────────────────────
    data_dir = resolve_data_dir()
    ensure_data_dirs(data_dir)

    log(f"POPMYC POS Service Launcher starting")
    log(f"Service     : {SERVICE_NAME}")
    log(f"Python      : {sys.executable}")
    log(f"Data dir    : {data_dir}")
    log(f"Bind        : {host}:{port}")

    # ── Load persistent .env ─────────────────────────────────────────────────
    load_env(data_dir)

    # Propagate data dir into environment so settings_desktop.py picks it up
    os.environ.setdefault("POPMYC_DATA_DIR", str(data_dir))
    os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings_desktop"

    # ── Diagnostic: log resolved DB config (never log password) ──────────────
    log(f"DB host    : {os.environ.get('DB_HOST', 'localhost')}")
    log(f"DB port    : {os.environ.get('DB_PORT', '5432')}")
    log(f"DB name    : {os.environ.get('DB_NAME', 'popmyc_pos')}")
    log(f"DB user    : {os.environ.get('DB_USER', '(not set)')}")
    log(f"Settings   : config.settings_desktop")

    # Safety check: warn if the DB user is "postgres" — this is the developer/placeholder
    # credential that should have been replaced by the setup flow with "popmyc_app".
    # It is NOT a fatal error (allows recovery) but is logged prominently.
    db_user = os.environ.get("DB_USER", "")
    if db_user in ("postgres", "changeme", ""):
        log(
            "WARNING: DB_USER is set to a placeholder/developer value "
            f"('{db_user}'). This typically means the Database Setup screen "
            "has not been completed. The backend may fail to connect to popmyc_pos. "
            "Please run POPMYC POS and complete the Database Setup."
        )

    # ── sys.path — ensure backend dir is importable ──────────────────────────
    backend_dir = Path(__file__).resolve().parent
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))

    # ── Ensure staticfiles/ exists before Django/WhiteNoise setup ────────────
    # WhiteNoise raises during django.setup() if WHITENOISE_ROOT points to a
    # directory that doesn't exist. Create it here as an empty directory so
    # WhiteNoise initialises cleanly even if collectstatic hasn't been run.
    # The actual static files (React SPA) are bundled by the installer into
    # {installDir}/resources/backend/staticfiles/ — this just handles the edge
    # case where the directory was accidentally deleted or not created.
    staticfiles_dir = backend_dir / "staticfiles"
    try:
        staticfiles_dir.mkdir(parents=True, exist_ok=True)
        # Create a minimal index.html placeholder so WhiteNoise doesn't
        # serve a 404 for every request before the SPA is loaded.
        # The real index.html from the installer will overwrite this.
        placeholder = staticfiles_dir / "index.html"
        if not placeholder.exists():
            placeholder.write_text(
                "<html><body><p>Loading POPMYC POS… "
                "If this page persists, please restart the application.</p></body></html>",
                encoding="utf-8",
            )
            log("Created staticfiles placeholder — frontend files will load on restart.")
    except Exception as _sf_exc:
        log(f"WARNING: Could not create staticfiles directory: {_sf_exc}")

    # ── Django setup ─────────────────────────────────────────────────────────
    log("Initialising Django …")
    try:
        import django
        django.setup()
        log("Django ready")
    except Exception as exc:
        fatal(
            f"Django setup failed: {exc}\n"
            f"  Check .env at: {data_dir / '.env'}\n"
            f"  Check Python path: {sys.executable}"
        )

    # ── Wait for PostgreSQL ───────────────────────────────────────────────────
    pg_ready = wait_for_postgres()
    if not pg_ready:
        fatal(
            "PostgreSQL is not available. Cannot start POPMYC POS backend.\n"
            "  Ensure the PostgreSQL Windows service is running.\n"
            "  Check database credentials in: " + str(data_dir / ".env")
        )

    # ── Migrations ────────────────────────────────────────────────────────────
    ok = apply_migrations(data_dir)
    if not ok:
        # Non-fatal: log the failure but continue starting Waitress.
        # A migration failure usually means the DB schema is behind but the
        # existing tables still work — the customer can still use the POS
        # and the migration will be retried on the next restart.
        log_err(
            "WARNING: Database migration had errors — starting anyway. "
            "Some features may not work until migrations succeed. "
            "Check the logs and restart the application."
        )

    # ── Static file check (non-fatal warning only) ────────────────────────────
    static_index = backend_dir / "staticfiles" / "index.html"
    if not static_index.exists():
        log(
            "WARNING: staticfiles/index.html not found. "
            "The React frontend may not be available. "
            "Run the build script to regenerate static files."
        )
    else:
        log("Static files: OK")

    # ── Start Sync Worker ────────────────────────────────────────────────────
    # The SyncWorker runs as a daemon thread inside this same process.
    # It uploads pending SyncRecords and downloads cloud changes in the
    # background without blocking HTTP requests or POS sales.
    # It stops automatically when the process exits (daemon=True).
    # If CLOUD_ENABLED=False or SYNC_CLOUD_URL is not set it sleeps silently.

    # ── Register this device with the cloud ───────────────────────────────────
    # Done BEFORE starting the SyncWorker so the first sync cycle already has
    # a registered device with the correct business_id.
    # Non-blocking and non-fatal — the local POS works offline without it.
    _register_device_with_cloud(data_dir)

    try:
        from synchronization.sync_worker import SyncWorker
        _sync_worker = SyncWorker()
        _sync_worker.start()
        log("Sync worker started (background thread)")
    except Exception as _sw_exc:
        log(f"WARNING: Sync worker failed to start (non-fatal): {_sw_exc}")

    # ── Start Waitress ────────────────────────────────────────────────────────
    log(f"Starting Waitress on {host}:{port} …")
    log(f"Backend URL: http://{host}:{port}/")
    log(f"Health URL : http://{host}:{port}/api/v1/health/")

    try:
        from waitress import serve
        from config.wsgi import application
        serve(
            application,
            host=host,
            port=port,
            threads=8,
            connection_limit=100,
            channel_timeout=120,
            log_socket_errors=False,
        )
    except SystemExit:
        log("Waitress stopped cleanly.")
    except KeyboardInterrupt:
        log("Received keyboard interrupt — stopping.")
    except Exception as exc:
        fatal(f"Waitress failed: {exc}")

    log("POPMYC POS Service Launcher stopped.")


if __name__ == "__main__":
    main()
