#!/usr/bin/env python
"""
pg_setup.py
===========
PostgreSQL detection and database setup helper for POPMYC POS Desktop.

Called by the Electron main process before starting Django.
Communicates via JSON on stdout — never exposes stack traces to the customer.

Usage:
    python pg_setup.py --action check   --data-dir <path>
    python pg_setup.py --action create  --data-dir <path> --pg-password <password>

Actions:
    check   - Detect PostgreSQL, test DB connection, report status
    create  - Create the popmyc_pos database using provided PG admin credentials

Exit codes:
    0 = success (or DB already exists)
    1 = fatal error (Python/import problem)
    All business errors are reported as JSON with success=false.

Output format (always valid JSON on stdout):
    {
        "success": true/false,
        "action": "check|create",
        "pg_installed": true/false,
        "pg_running": true/false,
        "db_exists": true/false,
        "db_accessible": true/false,
        "pg_version": "14.x" | null,
        "pg_port": 5432,
        "message": "human readable",
        "error_code": "PG_NOT_INSTALLED|PG_NOT_RUNNING|DB_NOT_FOUND|DB_AUTH_FAILED|...",
        "next_step": "install_pg|start_pg|enter_credentials|done"
    }

Security:
    - pg_password is NEVER written to logs or stdout.
    - Credentials are used only for the single DB creation operation.
    - Never drops, truncates, or resets existing databases.
    - Only creates the database if it does not exist.
"""

import argparse
import json
import os
import sys
from pathlib import Path


def _out(payload: dict) -> None:
    """Print a JSON payload to stdout and flush."""
    print(json.dumps(payload), flush=True)


def _load_env(data_dir: str) -> dict:
    """Load .env from the data directory into a dict."""
    env_path = Path(data_dir) / ".env"
    result = {}
    if not env_path.exists():
        return result
    try:
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                result[k.strip()] = v.strip().strip('"').strip("'")
    except Exception:
        pass
    return result


def _update_env(data_dir: str, updates: dict) -> None:
    """Update specific keys in the .env file, preserving all others."""
    env_path = Path(data_dir) / ".env"
    lines = []
    if env_path.exists():
        with open(env_path) as f:
            lines = f.readlines()

    updated_keys = set()
    new_lines = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            new_lines.append(line)
            continue
        k = stripped.partition("=")[0].strip()
        if k in updates:
            new_lines.append(f"{k}={updates[k]}\n")
            updated_keys.add(k)
        else:
            new_lines.append(line)

    # Add any keys that weren't already in the file
    for k, v in updates.items():
        if k not in updated_keys:
            new_lines.append(f"{k}={v}\n")

    with open(env_path, "w") as f:
        f.writelines(new_lines)


def _detect_pg_windows() -> dict:
    """
    Detect PostgreSQL installation on Windows.
    Returns dict with: installed (bool), version (str|None), port (int), service_name (str|None).
    """
    import winreg
    import subprocess

    result = {"installed": False, "version": None, "port": 5432, "service_name": None}

    # Method 1: Registry scan
    reg_paths = [
        r"SOFTWARE\PostgreSQL\Installations",
        r"SOFTWARE\WOW6432Node\PostgreSQL\Installations",
        r"SOFTWARE\PostgreSQL Global Development Group\PostgreSQL",
    ]
    for reg_path in reg_paths:
        try:
            key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, reg_path)
            result["installed"] = True
            try:
                # Try to read version from first subkey
                first_sub = winreg.EnumKey(key, 0)
                sub_key = winreg.OpenKey(key, first_sub)
                try:
                    ver, _ = winreg.QueryValueEx(sub_key, "Version")
                    result["version"] = str(ver)
                except Exception:
                    pass
                try:
                    port_val, _ = winreg.QueryValueEx(sub_key, "Port")
                    result["port"] = int(port_val)
                except Exception:
                    pass
                try:
                    svc, _ = winreg.QueryValueEx(sub_key, "ServiceName")
                    result["service_name"] = svc
                except Exception:
                    pass
            except Exception:
                pass
            break
        except Exception:
            continue

    # Method 2: Scan common install paths
    if not result["installed"]:
        for root in ["C:\\Program Files\\PostgreSQL", "C:\\Program Files (x86)\\PostgreSQL"]:
            if os.path.isdir(root):
                result["installed"] = True
                break

    # Method 3: Check for psql in PATH
    if not result["installed"]:
        try:
            r = subprocess.run(["psql", "--version"], capture_output=True, text=True, timeout=5)
            if r.returncode == 0:
                result["installed"] = True
                # e.g. "psql (PostgreSQL) 14.2"
                parts = r.stdout.strip().split()
                if len(parts) >= 3:
                    result["version"] = parts[-1]
        except Exception:
            pass

    return result


def _is_pg_service_running(service_name: str | None = None) -> bool:
    """Check if the PostgreSQL Windows service is running."""
    import subprocess
    services_to_check = []
    if service_name:
        services_to_check.append(service_name)
    # Common service name patterns
    services_to_check += ["postgresql", "postgresql-x64-16", "postgresql-x64-15",
                           "postgresql-x64-14", "postgresql-x64-13", "postgresql-x64-12"]
    for svc in services_to_check:
        try:
            r = subprocess.run(
                ["sc", "query", svc],
                capture_output=True, text=True, timeout=5,
            )
            if "RUNNING" in r.stdout:
                return True
        except Exception:
            continue
    return False


def _test_db_connection(host: str, port: int, dbname: str, user: str, password: str) -> tuple[bool, str]:
    """
    Attempt to connect to PostgreSQL.
    Returns (success: bool, error_message: str).
    Never raises — all errors are caught.
    """
    try:
        import psycopg2
        conn = psycopg2.connect(
            host=host, port=port, dbname=dbname,
            user=user, password=password,
            connect_timeout=5,
        )
        conn.close()
        return True, ""
    except ImportError:
        return False, "psycopg2 not available in this environment."
    except Exception as exc:
        msg = str(exc).lower()
        if "does not exist" in msg or "database" in msg and "exist" in msg:
            return False, "DATABASE_NOT_FOUND"
        if "password authentication" in msg or "authentication failed" in msg:
            return False, "AUTH_FAILED"
        if "connection refused" in msg or "could not connect" in msg:
            return False, "CONNECTION_REFUSED"
        if "timeout" in msg:
            return False, "TIMEOUT"
        return False, str(exc)[:200]


def _create_database(host: str, port: int, admin_user: str, admin_password: str,
                     db_name: str, app_user: str, app_password: str) -> tuple[bool, str]:
    """
    Create the application database (if it doesn't exist).
    NEVER drops or resets existing data.
    Returns (success: bool, message: str).
    """
    try:
        import psycopg2
        from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

        # Connect to the postgres maintenance database as admin
        conn = psycopg2.connect(
            host=host, port=port, dbname="postgres",
            user=admin_user, password=admin_password,
            connect_timeout=10,
        )
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cur = conn.cursor()

        # Check if database already exists (never create if it does)
        cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db_name,))
        if cur.fetchone():
            cur.close()
            conn.close()
            return True, "Database already exists — no changes made."

        # Create the database
        # Use a safe identifier (no injection possible — db_name validated below)
        safe_db = db_name.replace('"', '')
        cur.execute(f'CREATE DATABASE "{safe_db}"')

        # Create/update application user (only if different from admin)
        if app_user and app_user != admin_user:
            cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (app_user,))
            if not cur.fetchone():
                # Create user — password is passed as parameter (safe)
                cur.execute(
                    f"CREATE USER \"{app_user.replace('\"', '')}\" WITH PASSWORD %s",
                    (app_password,),
                )
            cur.execute(
                f"GRANT ALL PRIVILEGES ON DATABASE \"{safe_db}\" "
                f"TO \"{app_user.replace('\"', '')}\""
            )

        cur.close()
        conn.close()
        return True, f"Database '{db_name}' created successfully."

    except Exception as exc:
        msg = str(exc).lower()
        if "password authentication" in msg or "authentication failed" in msg:
            return False, "Invalid PostgreSQL administrator password."
        if "connection refused" in msg:
            return False, "Cannot connect to PostgreSQL. Is the service running?"
        return False, f"Database creation failed: {str(exc)[:200]}"


# ── Action: check ─────────────────────────────────────────────────────────────

def action_check(data_dir: str) -> None:
    env = _load_env(data_dir)
    db_host = env.get("DB_HOST", "localhost")
    db_port = int(env.get("DB_PORT", "5432"))
    db_name = env.get("DB_NAME", "popmyc_pos")
    db_user = env.get("DB_USER", "postgres")
    db_pass = env.get("DB_PASSWORD", "")

    # Detect PostgreSQL installation
    try:
        pg = _detect_pg_windows()
    except Exception:
        pg = {"installed": False, "version": None, "port": db_port, "service_name": None}

    if not pg["installed"]:
        _out({
            "success": False, "action": "check",
            "pg_installed": False, "pg_running": False,
            "db_exists": False, "db_accessible": False,
            "pg_version": None, "pg_port": db_port,
            "message": "PostgreSQL is not installed on this computer.",
            "error_code": "PG_NOT_INSTALLED",
            "next_step": "install_pg",
        })
        return

    # Check service
    pg_running = _is_pg_service_running(pg.get("service_name"))

    if not pg_running:
        _out({
            "success": False, "action": "check",
            "pg_installed": True, "pg_running": False,
            "db_exists": False, "db_accessible": False,
            "pg_version": pg["version"], "pg_port": db_port,
            "message": "PostgreSQL is installed but the service is not running.",
            "error_code": "PG_NOT_RUNNING",
            "next_step": "start_pg",
        })
        return

    # Test connection
    ok, err = _test_db_connection(db_host, db_port, db_name, db_user, db_pass)
    if ok:
        _out({
            "success": True, "action": "check",
            "pg_installed": True, "pg_running": True,
            "db_exists": True, "db_accessible": True,
            "pg_version": pg["version"], "pg_port": db_port,
            "message": f"Database '{db_name}' is ready.",
            "error_code": None,
            "next_step": "done",
        })
        return

    if err == "DATABASE_NOT_FOUND":
        _out({
            "success": False, "action": "check",
            "pg_installed": True, "pg_running": True,
            "db_exists": False, "db_accessible": False,
            "pg_version": pg["version"], "pg_port": db_port,
            "message": f"PostgreSQL is running but the database '{db_name}' does not exist.",
            "error_code": "DB_NOT_FOUND",
            "next_step": "enter_credentials",
            "db_name": db_name,
            "db_host": db_host,
            "db_port": db_port,
        })
        return

    if err == "AUTH_FAILED":
        _out({
            "success": False, "action": "check",
            "pg_installed": True, "pg_running": True,
            "db_exists": None, "db_accessible": False,
            "pg_version": pg["version"], "pg_port": db_port,
            "message": "PostgreSQL password is incorrect. Please update your database credentials.",
            "error_code": "AUTH_FAILED",
            "next_step": "enter_credentials",
        })
        return

    _out({
        "success": False, "action": "check",
        "pg_installed": True, "pg_running": True,
        "db_exists": None, "db_accessible": False,
        "pg_version": pg["version"], "pg_port": db_port,
        "message": f"Cannot connect to database: {err}",
        "error_code": "CONNECTION_ERROR",
        "next_step": "enter_credentials",
    })


# ── Action: create ─────────────────────────────────────────────────────────────

def action_create(data_dir: str, pg_admin_password: str) -> None:
    env = _load_env(data_dir)
    db_host  = env.get("DB_HOST", "localhost")
    db_port  = int(env.get("DB_PORT", "5432"))
    db_name  = env.get("DB_NAME", "popmyc_pos")
    db_user  = env.get("DB_USER", "postgres")
    db_pass  = env.get("DB_PASSWORD", pg_admin_password)

    # Validate db_name (only alphanumeric + underscore)
    import re
    if not re.match(r'^[a-zA-Z0-9_]+$', db_name):
        _out({
            "success": False, "action": "create",
            "message": "Invalid database name. Only letters, numbers, and underscores are allowed.",
            "error_code": "INVALID_DB_NAME",
        })
        return

    ok, msg = _create_database(
        host=db_host, port=db_port,
        admin_user="postgres", admin_password=pg_admin_password,
        db_name=db_name,
        app_user=db_user, app_password=db_pass,
    )

    if ok:
        # Update the .env with the confirmed credentials
        _update_env(data_dir, {
            "DB_PASSWORD": db_pass,
            "DB_PORT": str(db_port),
            "DB_HOST": db_host,
        })
        _out({
            "success": True, "action": "create",
            "message": msg,
            "error_code": None,
            "next_step": "done",
        })
    else:
        error_code = "CREATE_FAILED"
        if "password" in msg.lower() or "authentication" in msg.lower():
            error_code = "WRONG_ADMIN_PASSWORD"
        _out({
            "success": False, "action": "create",
            "message": msg,
            "error_code": error_code,
        })


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="POPMYC POS PostgreSQL Setup Helper")
    parser.add_argument("--action",      required=True, choices=["check", "create"])
    parser.add_argument("--data-dir",    required=True)
    # --pg-password is intentionally NOT accepted as a CLI argument to prevent
    # the password appearing in the Windows process list (Task Manager, etc.).
    # For the 'create' action the password is read from stdin (one line).
    args = parser.parse_args()

    try:
        if args.action == "check":
            action_check(args.data_dir)
        elif args.action == "create":
            # Read password from stdin — never from argv
            pg_password = sys.stdin.readline().rstrip("\n")
            action_create(args.data_dir, pg_password)
    except Exception as exc:
        # Catch-all: never expose a traceback to the customer
        _out({
            "success": False,
            "action": args.action,
            "message": "An unexpected error occurred. Please check the log file.",
            "error_code": "INTERNAL_ERROR",
        })
        # Write detail to stderr (goes to log file, not customer UI)
        print(f"[pg_setup] INTERNAL ERROR: {exc}", file=sys.stderr)


if __name__ == "__main__":
    main()
