#!/usr/bin/env python
"""
pg_setup.py
===========
PostgreSQL detection and database setup helper for POPMYC POS Desktop.

Called by the Electron main process before starting Django.
Communicates via JSON on stdout — never exposes stack traces to the customer.

Usage:
    python pg_setup.py --action check   --data-dir <path>
    python pg_setup.py --action create  --data-dir <path>
    python pg_setup.py --action create  --data-dir <path> --password-file <file>

Actions:
    check   - Detect PostgreSQL, test DB connection, report status.
              Treats a service that is "RUNNING" but not accepting TCP
              connections as not-running (zombie-running detection).
    create  - Create the popmyc_pos database and dedicated popmyc_app user.
              PostgreSQL superuser password is read from stdin OR from
              --password-file (file path only in argv — never the password
              itself). The password file is NOT deleted by this script;
              the caller is responsible for deletion.

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
    - pg (admin) password is NEVER written to logs or stdout.
    - The PostgreSQL superuser (postgres) is used ONLY for initial provisioning.
    - A dedicated application user (popmyc_app) is created for Django.
    - Only the application-user credentials are persisted in .env.
    - Never drops, truncates, or resets existing databases.
    - Only creates the database/user if they do not already exist.

Credential design:
    - DB_USER  in .env = popmyc_app  (dedicated, limited application user)
    - DB_PASSWORD in .env = popmyc_app's password (not the postgres superuser password)
    - The postgres superuser password is never stored in .env.
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
    """
    Update specific keys in the .env file, preserving all others.

    If the file doesn't exist OR is missing critical Django settings
    (DJANGO_SECRET_KEY, DJANGO_DEBUG, etc.), write a complete fresh .env
    so the service never starts with an incomplete configuration.
    """
    import secrets as _secrets
    import string as _string

    env_path = Path(data_dir) / ".env"

    # ── Generate a proper Django secret key ───────────────────────────────────
    # Uses only alphanumeric + safe punctuation — no shell-special chars
    # (no $, ^, !, `, ", \, |, &, <, >) so the value survives being written
    # to the .env file and read back correctly on every OS/shell.
    _alphabet = _string.ascii_letters + _string.digits + "-_=+@#%~"
    _secret_key = "".join(_secrets.choice(_alphabet) for _ in range(50))

    # ── Defaults for a complete desktop .env ──────────────────────────────────
    _defaults = {
        "DJANGO_SECRET_KEY":     _secret_key,
        "DJANGO_DEBUG":          "False",
        "DJANGO_ALLOWED_HOSTS":  "localhost,127.0.0.1",
        "CORS_ALLOWED_ORIGINS":  "http://localhost:8000,http://127.0.0.1:8000",
        "SYNC_CLOUD_URL":        "",
        "SYNC_CLOUD_TOKEN":      "",
        "CLOUD_SETUP_URL":       "https://popmyc-pos.onrender.com",
        "POPMYC_CELERY_EAGER":   "True",
    }

    # Load existing file (if any)
    existing: dict = {}
    lines: list = []
    if env_path.exists():
        with open(env_path, encoding="utf-8") as f:
            lines = f.readlines()
        for line in lines:
            stripped = line.strip()
            if stripped and not stripped.startswith("#") and "=" in stripped:
                k, _, v = stripped.partition("=")
                existing[k.strip()] = v.strip()

    # Determine whether the file is complete enough to use as-is
    _critical = {"DJANGO_SECRET_KEY", "DB_USER", "DB_PASSWORD", "DB_PORT", "DB_NAME"}
    _missing_critical = _critical - set(existing.keys()) - set(updates.keys())
    _file_missing = not env_path.exists()

    if _file_missing or _missing_critical:
        # Write a complete fresh .env — merge defaults + existing + updates
        merged = {**_defaults, **existing, **updates}
        timestamp = __import__("datetime").datetime.now().isoformat()
        new_lines = [
            f"# POPMYC POS Desktop Configuration\n",
            f"# Generated automatically on first run — {timestamp}\n",
            f"# DO NOT DELETE this file. It contains your database password.\n",
            f"DB_NAME={merged.get('DB_NAME', 'popmyc_pos')}\n",
            f"DB_USER={merged.get('DB_USER', 'popmyc_app')}\n",
            f"DB_PASSWORD={merged.get('DB_PASSWORD', '')}\n",
            f"DB_HOST={merged.get('DB_HOST', 'localhost')}\n",
            f"DB_PORT={merged.get('DB_PORT', '5432')}\n",
            f"\n",
            f"DJANGO_SECRET_KEY={merged['DJANGO_SECRET_KEY']}\n",
            f"DJANGO_DEBUG={merged['DJANGO_DEBUG']}\n",
            f"DJANGO_ALLOWED_HOSTS={merged['DJANGO_ALLOWED_HOSTS']}\n",
            f"\n",
            f"CORS_ALLOWED_ORIGINS={merged['CORS_ALLOWED_ORIGINS']}\n",
            f"SYNC_CLOUD_URL={merged['SYNC_CLOUD_URL']}\n",
            f"SYNC_CLOUD_TOKEN={merged['SYNC_CLOUD_TOKEN']}\n",
            f"\n",
            f"# Cloud licensing service — used ONLY for first-run trial activation.\n",
            f"# DO NOT CHANGE unless directed by POPMYC support.\n",
            f"CLOUD_SETUP_URL={merged['CLOUD_SETUP_URL']}\n",
            f"\n",
            f"POPMYC_CELERY_EAGER={merged['POPMYC_CELERY_EAGER']}\n",
        ]
        with open(env_path, "w", encoding="utf-8") as f:
            f.writelines(new_lines)
        return

    # File exists and is complete — just update the specified keys in-place
    updated_keys: set = set()
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

    for k, v in updates.items():
        if k not in updated_keys:
            new_lines.append(f"{k}={v}\n")

    with open(env_path, "w", encoding="utf-8") as f:
        f.writelines(new_lines)

def _detect_pg_windows() -> dict:
    """
    Detect PostgreSQL installation on Windows.

    Scans ALL installed PostgreSQL instances (any version) from the registry
    and returns the single best candidate, prioritised as:
      1. PostgreSQL 16 (matches what POPMYC POS installs)
      2. Highest version number among other installs
      3. Fallback: directory/PATH detection

    Returns dict with:
      installed    (bool)
      version      (str|None)   — e.g. "16.4"
      major        (int|None)   — e.g. 16
      port         (int)
      service_name (str|None)
      all_instances (list[dict]) — every detected instance
    """
    import subprocess

    result = {
        "installed":     False,
        "version":       None,
        "major":         None,
        "port":          5432,
        "service_name":  None,
        "all_instances": [],
    }

    instances: list[dict] = []

    # ── Method 1: Registry — enumerate ALL PostgreSQL installation keys ────────
    try:
        import winreg

        reg_roots = [
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\PostgreSQL\Installations"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\PostgreSQL\Installations"),
        ]
        for hive, reg_path in reg_roots:
            try:
                key = winreg.OpenKey(hive, reg_path)
            except Exception:
                continue
            idx = 0
            while True:
                try:
                    sub_name = winreg.EnumKey(key, idx)
                    idx += 1
                    try:
                        sub_key = winreg.OpenKey(key, sub_name)
                        inst: dict = {"version": None, "major": None,
                                      "port": 5432, "service_name": None,
                                      "base_dir": None}
                        try:
                            v, _ = winreg.QueryValueEx(sub_key, "Version")
                            inst["version"] = str(v)
                            try:
                                inst["major"] = int(str(v).split(".")[0])
                            except Exception:
                                pass
                        except Exception:
                            pass
                        try:
                            p, _ = winreg.QueryValueEx(sub_key, "Port")
                            inst["port"] = int(p)
                        except Exception:
                            pass
                        try:
                            s, _ = winreg.QueryValueEx(sub_key, "ServiceName")
                            inst["service_name"] = str(s)
                        except Exception:
                            pass
                        try:
                            bd, _ = winreg.QueryValueEx(sub_key, "Base Directory")
                            inst["base_dir"] = str(bd)
                        except Exception:
                            pass
                        instances.append(inst)
                    except Exception:
                        pass
                except OSError:
                    break   # no more subkeys

        # Also check the older "Global Development Group" key (single install)
        for hive, reg_path in [
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\PostgreSQL Global Development Group\PostgreSQL"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\PostgreSQL Global Development Group\PostgreSQL"),
        ]:
            try:
                key = winreg.OpenKey(hive, reg_path)
                sub_name = winreg.EnumKey(key, 0)
                sub_key  = winreg.OpenKey(key, sub_name)
                inst = {"version": None, "major": None, "port": 5432,
                        "service_name": None, "base_dir": None}
                try:
                    v, _ = winreg.QueryValueEx(sub_key, "Version")
                    inst["version"] = str(v)
                    try:
                        inst["major"] = int(str(v).split(".")[0])
                    except Exception:
                        pass
                except Exception:
                    pass
                try:
                    p, _ = winreg.QueryValueEx(sub_key, "Port")
                    inst["port"] = int(p)
                except Exception:
                    pass
                try:
                    s, _ = winreg.QueryValueEx(sub_key, "ServiceName")
                    inst["service_name"] = str(s)
                except Exception:
                    pass
                # Only add if not already captured
                if not any(i.get("version") == inst.get("version") for i in instances):
                    instances.append(inst)
            except Exception:
                pass

    except ImportError:
        pass    # winreg not available (non-Windows dev environment)

    # ── Method 2: Scan common install directories ─────────────────────────────
    if not instances:
        for pg_root in ["C:\\Program Files\\PostgreSQL",
                        "C:\\Program Files (x86)\\PostgreSQL"]:
            if os.path.isdir(pg_root):
                try:
                    for ver_dir in os.listdir(pg_root):
                        full = os.path.join(pg_root, ver_dir)
                        if os.path.isdir(full):
                            try:
                                major = int(ver_dir)
                                instances.append({
                                    "version":      ver_dir,
                                    "major":        major,
                                    "port":         5432,
                                    "service_name": f"postgresql-x64-{ver_dir}",
                                    "base_dir":     full,
                                })
                            except ValueError:
                                pass
                except Exception:
                    pass

    # ── Method 2b: Dedicated POPMYC installation directory ───────────────────
    # The POPMYC installer puts PostgreSQL in a separate prefix so that the
    # standard C:\Program Files\PostgreSQL path is never touched.
    # Detect it by checking the POPMYC-specific service key OR directory.
    _popmyc_svc   = "POPMYCPostgreSQL16"
    _popmyc_dir   = "C:\\Program Files\\POPMYC\\PostgreSQL\\16"
    _popmyc_found = any(i.get("service_name") == _popmyc_svc for i in instances)
    if not _popmyc_found:
        try:
            import winreg
            winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                f"SYSTEM\\CurrentControlSet\\Services\\{_popmyc_svc}",
            )
            # Service key exists — read port from PostgreSQL Installations registry
            # (EDB registers the service there regardless of custom prefix/service name).
            _port = 5432
            try:
                for hive, rp in [
                    (winreg.HKEY_LOCAL_MACHINE, "SOFTWARE\\PostgreSQL\\Installations"),
                    (winreg.HKEY_LOCAL_MACHINE, "SOFTWARE\\WOW6432Node\\PostgreSQL\\Installations"),
                ]:
                    try:
                        k = winreg.OpenKey(hive, rp)
                        i = 0
                        while True:
                            try:
                                sub = winreg.EnumKey(k, i); i += 1
                                sk = winreg.OpenKey(k, sub)
                                try:
                                    sv, _ = winreg.QueryValueEx(sk, "ServiceName")
                                    if sv == _popmyc_svc:
                                        try:
                                            pv, _ = winreg.QueryValueEx(sk, "Port")
                                            _port = int(pv)
                                        except Exception:
                                            pass
                                        break
                                except Exception:
                                    pass
                            except OSError:
                                break
                    except Exception:
                        pass
            except Exception:
                pass
            instances.append({
                "version":      "16",
                "major":        16,
                "port":         _port,
                "service_name": _popmyc_svc,
                "base_dir":     _popmyc_dir,
            })
        except Exception:
            # Service key doesn't exist — check directory as last resort
            if os.path.isdir(_popmyc_dir):
                instances.append({
                    "version":      "16",
                    "major":        16,
                    "port":         5432,
                    "service_name": _popmyc_svc,
                    "base_dir":     _popmyc_dir,
                })

    # ── Method 3: psql in PATH ────────────────────────────────────────────────
    if not instances:
        try:
            r = subprocess.run(
                ["psql", "--version"],
                capture_output=True, text=True, timeout=5,
            )
            if r.returncode == 0:
                parts = r.stdout.strip().split()
                ver = parts[-1] if len(parts) >= 3 else None
                major = None
                try:
                    major = int(ver.split(".")[0]) if ver else None
                except Exception:
                    pass
                instances.append({
                    "version": ver, "major": major,
                    "port": 5432, "service_name": None, "base_dir": None,
                })
        except Exception:
            pass

    if not instances:
        return result   # Nothing found

    # ── Select best candidate ─────────────────────────────────────────────────
    # Priority 1: dedicated POPMYC instance (POPMYCPostgreSQL16) — always wins
    #             when present; it means a successful POPMYC-managed install.
    # Priority 2: PG 16 (our target version for a third-party install).
    # Priority 3: highest major version number.
    # Priority 4: first found.
    POPMYC_SVC = "POPMYCPostgreSQL16"

    def _sort_key(inst: dict) -> tuple:
        major = inst.get("major") or 0
        is_popmyc = 1 if inst.get("service_name") == POPMYC_SVC else 0
        is_16     = 1 if major == 16 else 0
        return (is_popmyc, is_16, major)

    instances.sort(key=_sort_key, reverse=True)
    best = instances[0]

    result["installed"]     = True
    result["version"]       = best.get("version")
    result["major"]         = best.get("major")
    result["port"]          = best.get("port") or 5432
    result["service_name"]  = best.get("service_name")
    result["all_instances"] = instances

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


def _start_pg_service(service_name: str | None) -> bool:
    """
    Attempt to start a PostgreSQL Windows service.
    Returns True if the service is running after the attempt.
    """
    import subprocess
    services_to_try = []
    if service_name:
        services_to_try.append(service_name)
    services_to_try += ["postgresql-x64-16", "postgresql-x64-15",
                         "postgresql-x64-14", "postgresql-x64-13",
                         "postgresql-x64-12", "postgresql"]
    for svc in services_to_try:
        try:
            subprocess.run(["sc", "start", svc],
                           capture_output=True, text=True, timeout=10)
        except Exception:
            pass
    # Give it a few seconds then check
    import time
    time.sleep(3)
    return _is_pg_service_running(service_name)


def _is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    """Return True if something is listening on host:port."""
    import socket
    try:
        with socket.create_connection((host, port), timeout=2):
            return True
    except (OSError, ConnectionRefusedError):
        return False


def _find_free_port(preferred: int = 5432, alternates: tuple = (5433, 5434, 5435, 5436)) -> int | None:
    """
    Return the first free TCP port from the candidates.
    Returns None if all candidates are in use.
    """
    for port in (preferred,) + alternates:
        if not _is_port_in_use(port):
            return port
    return None


def _wait_pg_ready(host: str, port: int,
                   timeout_s: int = 60, interval_s: float = 2.0) -> bool:
    """
    Poll until PostgreSQL accepts a TCP connection on host:port,
    or until timeout_s seconds have elapsed.

    Returns True when the port is accepting connections.
    Does NOT require credentials — only checks TCP reachability
    so it is safe to call without a password.
    """
    import time
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if _is_port_in_use(port, host):
            return True
        time.sleep(interval_s)
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
    Create the application database and dedicated application user.

    Security design:
      - admin_user (postgres superuser) is used ONLY here for provisioning.
      - app_user (popmyc_app) gets only the privileges needed for normal operation.
      - The postgres superuser password is NOT stored after this call returns.
      - NEVER drops or resets existing databases or users.

    Privileges granted to app_user on db_name:
      - CONNECT on DATABASE
      - All privileges on public schema objects (tables, sequences, functions)
      - Default privileges for future tables/sequences created by migrations

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

        safe_db   = db_name.replace('"', '')
        safe_user = app_user.replace('"', '') if app_user else ""

        # ── Step 1: Create the application user if it doesn't exist ──────────
        if safe_user and safe_user != admin_user:
            cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (safe_user,))
            if not cur.fetchone():
                cur.execute(
                    f'CREATE USER "{safe_user}" WITH PASSWORD %s LOGIN',
                    (app_password,),
                )

        # ── Step 2: Create the database if it doesn't exist ──────────────────
        cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (safe_db,))
        db_already_exists = bool(cur.fetchone())

        if not db_already_exists:
            cur.execute(f'CREATE DATABASE "{safe_db}"')

        # ── Step 3: Grant database-level privileges ───────────────────────────
        if safe_user and safe_user != admin_user:
            # CONNECT + ability to use the database
            cur.execute(
                f'GRANT CONNECT ON DATABASE "{safe_db}" TO "{safe_user}"'
            )

        cur.close()
        conn.close()

        # ── Step 4: Grant schema-level privileges inside the new database ─────
        # Must connect to the target DB (not postgres) to set schema privileges.
        if safe_user and safe_user != admin_user:
            conn2 = psycopg2.connect(
                host=host, port=port, dbname=safe_db,
                user=admin_user, password=admin_password,
                connect_timeout=10,
            )
            conn2.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
            cur2 = conn2.cursor()

            # Grant usage on public schema
            cur2.execute(f'GRANT USAGE, CREATE ON SCHEMA public TO "{safe_user}"')

            # Grant on all existing tables/sequences/functions
            cur2.execute(
                f'GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "{safe_user}"'
            )
            cur2.execute(
                f'GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "{safe_user}"'
            )
            cur2.execute(
                f'GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO "{safe_user}"'
            )

            # Default privileges so future objects created by migrations are accessible
            cur2.execute(
                f'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
                f'GRANT ALL ON TABLES TO "{safe_user}"'
            )
            cur2.execute(
                f'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
                f'GRANT ALL ON SEQUENCES TO "{safe_user}"'
            )

            cur2.close()
            conn2.close()

        if db_already_exists:
            return True, "Database already exists — no changes made."
        return True, f"Database '{db_name}' and user '{app_user}' created successfully."

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
    # Default to popmyc_app — the dedicated application user, not postgres superuser.
    db_user = env.get("DB_USER", "popmyc_app")
    db_pass = env.get("DB_PASSWORD", "")

    # Detect PostgreSQL installation
    try:
        pg = _detect_pg_windows()
    except Exception:
        pg = {"installed": False, "version": None, "major": None,
              "port": db_port, "service_name": None, "all_instances": []}

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

    # Use the port from the detected PG instance (may differ from .env if .env
    # hasn't been written yet for this installation).
    effective_port = pg["port"] if pg["port"] else db_port

    # ── Zombie-running detection ───────────────────────────────────────────────
    # A service may report STATE=RUNNING in the SCM but not actually accept
    # TCP connections (corrupted install, port conflict, startup failure).
    # We MUST TCP-test the port before trusting the service state, otherwise
    # action_check will fall through to _test_db_connection which returns
    # CONNECTION_REFUSED and prompts the customer for an admin password —
    # even on a machine that just needs a fresh dedicated POPMYC PG install.
    #
    # Strategy:
    #   1. Check SCM service state (fast, no network).
    #   2. If "running", TCP-test the port (cheap socket connect, 2s timeout).
    #   3. Only if both pass, attempt a full DB connection with credentials.
    # ──────────────────────────────────────────────────────────────────────────

    # Step 1: SCM service state
    pg_svc_running = _is_pg_service_running(pg.get("service_name"))

    if not pg_svc_running:
        _out({
            "success": False, "action": "check",
            "pg_installed": True, "pg_running": False,
            "db_exists": False, "db_accessible": False,
            "pg_version": pg["version"], "pg_port": effective_port,
            "message": "PostgreSQL is installed but the service is not running.",
            "error_code": "PG_NOT_RUNNING",
            "next_step": "start_pg",
        })
        return

    # Step 2: TCP port test — the service is "RUNNING" but is it actually
    # accepting connections? (Handles zombie-running / startup-failed states.)
    port_open = _is_port_in_use(effective_port, db_host)
    if not port_open:
        _out({
            "success": False, "action": "check",
            "pg_installed": True, "pg_running": False,
            "db_exists": False, "db_accessible": False,
            "pg_version": pg["version"], "pg_port": effective_port,
            "message": (
                f"PostgreSQL service is running but port {effective_port} is not "
                f"accepting connections. The existing installation may be unusable."
            ),
            "error_code": "PG_NOT_RUNNING",
            "next_step": "install_pg",
        })
        return

    # pg_running is True only when both SCM state AND TCP port confirm readiness
    pg_running = True

    # Step 3: Full DB connection test using the effective port
    ok, err = _test_db_connection(db_host, effective_port, db_name, db_user, db_pass)
    if ok:
        _out({
            "success": True, "action": "check",
            "pg_installed": True, "pg_running": True,
            "db_exists": True, "db_accessible": True,
            "pg_version": pg["version"], "pg_port": effective_port,
            "message": f"Database '{db_name}' is ready.",
            "error_code": None,
            "next_step": "done",
        })
        return

    if err == "DATABASE_NOT_FOUND":
        # New deployment model: PostgreSQL is installed manually by the operator.
        # Whenever the database doesn't exist, ask for the admin password so
        # POPMYC can create popmyc_pos / popmyc_app automatically.
        # next_step='enter_credentials' is ALWAYS correct here.
        _out({
            "success": False, "action": "check",
            "pg_installed": True, "pg_running": True,
            "db_exists": False, "db_accessible": False,
            "pg_version": pg["version"], "pg_port": effective_port,
            "message": (
                f"PostgreSQL is running but the database '{db_name}' does not exist. "
                f"Enter the PostgreSQL administrator password to create it."
            ),
            "error_code": "DB_NOT_FOUND",
            "next_step": "enter_credentials",
            "db_name": db_name,
            "db_host": db_host,
            "db_port": effective_port,
        })
        return

    if err == "AUTH_FAILED":
        _out({
            "success": False, "action": "check",
            "pg_installed": True, "pg_running": True,
            "db_exists": None, "db_accessible": False,
            "pg_version": pg["version"], "pg_port": effective_port,
            "message": (
                "The POPMYC database credentials are incorrect. "
                "Please check your configuration or enter the PostgreSQL "
                "administrator password to reprovision."
            ),
            "error_code": "AUTH_FAILED",
            "next_step": "enter_credentials",
        })
        return

    _out({
        "success": False, "action": "check",
        "pg_installed": True, "pg_running": True,
        "db_exists": None, "db_accessible": False,
        "pg_version": pg["version"], "pg_port": effective_port,
        "message": f"Cannot connect to database: {err}",
        "error_code": "CONNECTION_ERROR",
        "next_step": "enter_credentials",
    })


# ── Action: create ─────────────────────────────────────────────────────────────

def action_create(data_dir: str, pg_admin_password: str) -> None:
    """
    Create the popmyc_pos database and the dedicated popmyc_app application user.

    Credential design:
      - pg_admin_password  = postgres superuser password (read from stdin, NEVER stored)
      - app_password       = popmyc_app password (generated here if not in .env, stored)
      - After this action, .env contains DB_USER=popmyc_app and DB_PASSWORD=<app_password>
      - The postgres superuser password is DISCARDED after this function returns.
    """
    import re
    import secrets
    import string

    env = _load_env(data_dir)
    db_host  = env.get("DB_HOST", "localhost")
    db_name  = env.get("DB_NAME", "popmyc_pos")

    # Use the port from the .env if already written; otherwise detect from PG.
    # This ensures we talk to the right PG instance on non-default ports.
    env_port = env.get("DB_PORT", "")
    if env_port:
        db_port = int(env_port)
    else:
        try:
            pg = _detect_pg_windows()
            db_port = pg["port"] if pg.get("port") else 5432
        except Exception:
            db_port = 5432

    # Always use the dedicated application user — never the superuser.
    app_user = "popmyc_app"

    # Use the app-user password from .env if already set; otherwise generate one.
    # This ensures idempotency: re-running create with the same .env is safe.
    app_password = env.get("DB_PASSWORD", "")
    if not app_password or app_password in ("changeme", "postgres"):
        # Generate a cryptographically secure password meeting Windows complexity:
        # uppercase + lowercase + digits + symbol, minimum 20 chars.
        alphabet = string.ascii_uppercase + string.ascii_lowercase + string.digits
        symbols  = "!@#$%^&*"
        # Guarantee at least one of each required class
        pwd = (
            secrets.choice(string.ascii_uppercase) +
            secrets.choice(string.ascii_lowercase) +
            secrets.choice(string.digits) +
            secrets.choice(symbols) +
            "".join(secrets.choice(alphabet + symbols) for _ in range(16))
        )
        # Shuffle so the guaranteed characters aren't always at the front
        pwd_list = list(pwd)
        secrets.SystemRandom().shuffle(pwd_list)
        app_password = "".join(pwd_list)

    # Validate db_name (only alphanumeric + underscore)
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
        app_user=app_user, app_password=app_password,
    )

    if ok:
        # Persist ONLY the application-user credentials.
        # The postgres superuser password is intentionally NOT stored.
        _update_env(data_dir, {
            "DB_USER":     app_user,
            "DB_PASSWORD": app_password,
            "DB_PORT":     str(db_port),
            "DB_HOST":     db_host,
            "DB_NAME":     db_name,
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
    # For the 'create' action the password is read from stdin (one line),
    # OR from a file specified via --password-file (file path in argv, never
    # the password itself). The caller is responsible for deleting the file.
    parser.add_argument("--password-file", default=None,
                        help="Path to a file whose first line is the PG admin password. "
                             "Used by the Inno Setup installer to avoid cmd.exe pipe quoting issues.")
    args = parser.parse_args()

    try:
        if args.action == "check":
            action_check(args.data_dir)
        elif args.action == "create":
            if args.password_file:
                # Read from file — avoids cmd.exe "type file | python" quoting fragility.
                # The file path is in argv (safe); the password content is not.
                try:
                    with open(args.password_file, "r") as pf:
                        pg_password = pf.readline().rstrip("\n")
                except Exception as exc:
                    _out({
                        "success": False,
                        "action": "create",
                        "message": "Could not read password file.",
                        "error_code": "PASSWORD_FILE_ERROR",
                    })
                    print(f"[pg_setup] password-file error: {exc}", file=sys.stderr)
                    return
            else:
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
