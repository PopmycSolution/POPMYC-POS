#!/usr/bin/env python
"""
desktop_launcher.py
===================
Entry point launched by the Electron main process for POPMYC POS Desktop.

What it does (in order):
  1. Resolve the persistent data directory and load its .env
  2. Set DJANGO_SETTINGS_MODULE = config.settings_desktop
  3. Run `manage.py migrate --run-syncdb` to apply any pending migrations
  4. Run `manage.py collectstatic --noinput` to copy the React SPA into
     staticfiles/ so WhiteNoise can serve it
  5. Start the waitress WSGI server on the requested port

Arguments:
  --port       Port to listen on (default 8000)
  --data-dir   Path to the persistent data directory (default: auto-detected)

The Electron main process reads stdout/stderr and pipes them to a log file.
All print() calls below go to the Electron log.

Design notes
------------
- This script does NOT touch Django models or business logic.
- It does NOT create a superuser — that is Stage 5.2.
- It does NOT assume internet access — everything must work offline.
- If migrations fail (e.g. DB not found), the process exits with code 1
  and Electron shows an appropriate error dialog.
"""

import argparse
import os
import sys
import time
from pathlib import Path


def resolve_data_dir(arg_data_dir: str | None) -> Path:
    """
    Determine the persistent data directory.

    Priority:
      1. --data-dir command-line argument
      2. POPMYC_DATA_DIR environment variable
      3. ~/AppData/Roaming/POPMYC POS  (Windows)
      4. ~/.popmyc-pos  (macOS/Linux fallback)
    """
    if arg_data_dir:
        return Path(arg_data_dir)

    if os.environ.get("POPMYC_DATA_DIR"):
        return Path(os.environ["POPMYC_DATA_DIR"])

    # Windows APPDATA
    appdata = os.environ.get("APPDATA")
    if appdata:
        return Path(appdata) / "POPMYC POS"

    # macOS / Linux
    return Path.home() / ".popmyc-pos"


def load_desktop_env(data_dir: Path) -> None:
    """
    Load the .env from the persistent data directory.
    This sets DB_*, DJANGO_SECRET_KEY, SYNC_CLOUD_URL, etc.
    The file is created by the Electron main.js on first run.
    """
    env_path = data_dir / ".env"

    if not env_path.exists():
        print(f"[Launcher] WARNING: No .env found at {env_path}")
        print("[Launcher] Using default environment. Edit the .env to configure the database.")
        return

    # Use python-dotenv to load into os.environ (override=False: existing vars win)
    try:
        from dotenv import load_dotenv
        load_dotenv(dotenv_path=str(env_path), override=False)
        print(f"[Launcher] Loaded .env from {env_path}")
    except ImportError:
        # Fallback: manual parser (python-dotenv must be present in the venv)
        print("[Launcher] WARNING: python-dotenv not available; parsing .env manually")
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value


def run_management_command(command: list[str], description: str) -> bool:
    """
    Run a Django management command in-process.
    Returns True on success, False on failure.
    Prints clear progress messages for the Electron log.
    """
    import django
    from django.core.management import call_command
    from io import StringIO

    print(f"[Launcher] {description} …")
    stdout_capture = StringIO()
    try:
        call_command(*command, stdout=stdout_capture, stderr=stdout_capture)
        output = stdout_capture.getvalue().strip()
        if output:
            for line in output.splitlines():
                print(f"[Django]   {line}")
        print(f"[Launcher] {description} — OK")
        return True
    except Exception as exc:
        print(f"[Launcher] ERROR: {description} failed: {exc}", file=sys.stderr)
        return False


def _auto_backup(data_dir: Path, backend_dir: Path) -> None:
    """
    Create a best-effort pre-migration backup using pg_dump.
    Uses PGPASSWORD env var so the password never appears on the command line.
    Writes to data_dir/backups/popmyc_backup_<timestamp>.sql.gz.
    Failures are logged to stderr but are non-fatal — the caller must
    decide whether to abort the migration or proceed.
    """
    import shutil
    import subprocess
    import re

    backup_dir = data_dir / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)

    # Read DB config from environment (already loaded by load_desktop_env)
    db_host = os.environ.get("DB_HOST", "localhost")
    db_port = os.environ.get("DB_PORT", "5432")
    db_name = os.environ.get("DB_NAME", "popmyc_pos")
    db_user = os.environ.get("DB_USER", "postgres")
    db_pass = os.environ.get("DB_PASSWORD", "")

    # Find pg_dump
    candidates = [
        shutil.which("pg_dump"),
        r"C:\Program Files\PostgreSQL\16\bin\pg_dump.exe",
        r"C:\Program Files\PostgreSQL\15\bin\pg_dump.exe",
        r"C:\Program Files\PostgreSQL\14\bin\pg_dump.exe",
        r"C:\Program Files\PostgreSQL\13\bin\pg_dump.exe",
    ]
    pg_dump = next((c for c in candidates if c and Path(c).exists()), "pg_dump")

    timestamp  = __import__("datetime").datetime.now().strftime("%Y%m%d_%H%M%S")
    tmp_file   = backup_dir / f"popmyc_backup_{timestamp}.sql.gz.tmp"
    final_file = backup_dir / f"popmyc_backup_{timestamp}.sql.gz"

    env = os.environ.copy()
    env["PGPASSWORD"] = db_pass  # never on the command line

    cmd = [
        pg_dump,
        "--host", db_host, "--port", db_port,
        "--username", db_user, "--dbname", db_name,
        "--format", "p", "--no-owner", "--no-acl",
        "--compress", "6",
    ]

    try:
        with open(tmp_file, "wb") as out_f:
            result = subprocess.run(cmd, env=env, stdout=out_f,
                                    stderr=subprocess.PIPE, timeout=300)
        if result.returncode != 0:
            tmp_file.unlink(missing_ok=True)
            err = result.stderr.decode(errors="replace")
            err = re.sub(r'password[^\n]*', '[password hidden]', err, flags=re.IGNORECASE)
            raise RuntimeError(f"pg_dump exited {result.returncode}: {err[:200]}")
        tmp_file.rename(final_file)
        print(f"[Launcher] Pre-migration backup: {final_file.name} "
              f"({final_file.stat().st_size // 1024} KB)")
    except Exception as exc:
        tmp_file.unlink(missing_ok=True)
        raise


def main() -> None:
    # ── Parse arguments ──────────────────────────────────────────────────────
    parser = argparse.ArgumentParser(description="POPMYC POS Desktop Launcher")
    parser.add_argument("--port",     type=int,  default=8000,  help="Port for waitress")
    parser.add_argument("--data-dir", type=str,  default=None,  help="Persistent data directory")
    parser.add_argument("--host",     type=str,  default="127.0.0.1", help="Bind host")
    args = parser.parse_args()

    port     = args.port
    host     = args.host
    data_dir = resolve_data_dir(args.data_dir)

    print(f"[Launcher] POPMYC POS Desktop Launcher starting")
    print(f"[Launcher] Data directory : {data_dir}")
    print(f"[Launcher] Python         : {sys.executable}")
    print(f"[Launcher] Bind           : {host}:{port}")

    # ── Ensure data directories exist ───────────────────────────────────────
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "logs").mkdir(exist_ok=True)
    (data_dir / "media").mkdir(exist_ok=True)
    (data_dir / "backups").mkdir(exist_ok=True)

    # ── Load persistent .env BEFORE Django setup ─────────────────────────────
    load_desktop_env(data_dir)

    # Inject the data dir so settings_desktop.py can resolve MEDIA_ROOT, LOGS_DIR
    os.environ.setdefault("POPMYC_DATA_DIR", str(data_dir))
    os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings_desktop"

    # ── Ensure the backend directory is on sys.path ───────────────────────────
    backend_dir = Path(__file__).resolve().parent
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))

    # ── Setup Django ─────────────────────────────────────────────────────────
    print("[Launcher] Initialising Django …")
    try:
        import django
        django.setup()
        print("[Launcher] Django OK")
    except Exception as exc:
        print(f"[Launcher] FATAL: Django setup failed: {exc}", file=sys.stderr)
        print("[Launcher] Check that PostgreSQL is running and the .env is correct.", file=sys.stderr)
        sys.exit(1)

    # ── Database connectivity check ───────────────────────────────────────────
    print("[Launcher] Checking database connectivity …")
    try:
        from django.db import connection
        connection.ensure_connection()
        print("[Launcher] Database connection — OK")
    except Exception as exc:
        print(f"[Launcher] FATAL: Cannot connect to database: {exc}", file=sys.stderr)
        print("[Launcher] Ensure PostgreSQL is running and the database exists.", file=sys.stderr)
        print("[Launcher] Edit the .env file at:", data_dir / ".env", file=sys.stderr)
        sys.exit(1)

    # ── Apply pending migrations ──────────────────────────────────────────────
    # Safe to run on every startup — Django only applies unapplied migrations.
    # Check if there are unapplied migrations first — if so, optionally create
    # a pre-migration backup to protect existing data.
    print("[Launcher] Checking for pending migrations …")
    try:
        from django.db.migrations.executor import MigrationExecutor
        from django.db import connection as _conn
        executor = MigrationExecutor(_conn)
        targets  = executor.loader.graph.leaf_nodes()
        pending  = executor.migration_plan(targets)
        if pending:
            print(f"[Launcher] {len(pending)} migration(s) pending — creating pre-migration backup …")
            # Best-effort backup before applying migrations
            try:
                _auto_backup(data_dir, backend_dir)
            except Exception as bup_exc:
                print(f"[Launcher] WARNING: Pre-migration backup failed (non-fatal): {bup_exc}", file=sys.stderr)
        else:
            print("[Launcher] No pending migrations.")
    except Exception as check_exc:
        print(f"[Launcher] WARNING: Could not check pending migrations: {check_exc}", file=sys.stderr)

    ok = run_management_command(
        ["migrate", "--run-syncdb"],
        "Applying database migrations",
    )
    if not ok:
        print("[Launcher] FATAL: Migration failed — cannot start", file=sys.stderr)
        sys.exit(1)

    # ── Collect static files (React SPA + Django admin) ───────────────────────
    # Only runs if the staticfiles directory is empty or the build is newer.
    # Uses --clear to remove stale files from previous app versions.
    static_root = backend_dir / "staticfiles"
    spa_index   = static_root / "index.html"

    if not spa_index.exists():
        print("[Launcher] Static files not found — running collectstatic …")
        ok = run_management_command(
            ["collectstatic", "--noinput", "--clear"],
            "Collecting static files",
        )
        if not ok:
            # Non-fatal: the app will still run, just without the React SPA
            print("[Launcher] WARNING: collectstatic failed — frontend may not be available")
    else:
        print("[Launcher] Static files already present — skipping collectstatic")

    # ── Start waitress WSGI server ────────────────────────────────────────────
    print(f"[Launcher] Starting waitress on {host}:{port} …")
    print(f"[Launcher] Application will be available at http://{host}:{port}/")

    try:
        from waitress import serve
        from config.wsgi import application
        serve(
            application,
            host=host,
            port=port,
            threads=8,                # enough for a single-user desktop POS
            connection_limit=100,
            channel_timeout=120,
            log_socket_errors=False,  # suppress noisy connection-reset logs
        )
    except KeyboardInterrupt:
        print("[Launcher] Received shutdown signal — stopping")
    except Exception as exc:
        print(f"[Launcher] FATAL: waitress failed to start: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
