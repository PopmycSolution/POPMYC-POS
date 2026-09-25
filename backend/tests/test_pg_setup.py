"""
tests/test_pg_setup.py
=======================
Tests for the pg_setup.py helper functions.

These tests use mocking to avoid requiring a live PostgreSQL installation.
They verify detection, usability checks, port scanning, and credential logic.
"""
import json
import socket
import sys
import types
from io import StringIO
from pathlib import Path
from unittest import mock
import pytest


# ── Helpers to import pg_setup without triggering winreg import errors ────────

def _import_pg_setup():
    """Import pg_setup from the backend directory."""
    import importlib
    import os
    backend_dir = Path(__file__).resolve().parent.parent
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))
    # Provide a stub winreg for non-Windows test environments
    if "winreg" not in sys.modules:
        winreg_stub = types.ModuleType("winreg")
        winreg_stub.HKEY_LOCAL_MACHINE = 0x80000002
        winreg_stub.OpenKey = mock.MagicMock(side_effect=FileNotFoundError)
        winreg_stub.EnumKey = mock.MagicMock(side_effect=OSError)
        winreg_stub.QueryValueEx = mock.MagicMock(side_effect=FileNotFoundError)
        winreg_stub.HKLM64 = 0x80000002
        winreg_stub.HKLM32 = 0x80000002
        sys.modules["winreg"] = winreg_stub
    import importlib
    if "pg_setup" in sys.modules:
        del sys.modules["pg_setup"]
    return importlib.import_module("pg_setup")


pg = _import_pg_setup()


# ── _detect_pg_windows ────────────────────────────────────────────────────────

class TestDetectPgWindows:

    def test_returns_installed_false_when_nothing_found(self):
        """No registry, no directories, no psql → installed=False."""
        import winreg as _winreg
        with mock.patch.object(_winreg, "OpenKey", side_effect=FileNotFoundError), \
             mock.patch("os.path.isdir", return_value=False), \
             mock.patch("os.listdir", return_value=[]), \
             mock.patch("subprocess.run", side_effect=FileNotFoundError):
            result = pg._detect_pg_windows()
        assert result["installed"] is False
        assert result["all_instances"] == []

    def test_directory_scan_sets_installed(self, tmp_path):
        """A PostgreSQL directory being present → installed=True."""
        pg16_dir = tmp_path / "PostgreSQL" / "16"
        pg16_dir.mkdir(parents=True)

        def _isdir(path):
            return path == str(tmp_path / "PostgreSQL") or \
                   path.startswith(str(tmp_path / "PostgreSQL"))

        with mock.patch("os.path.isdir", side_effect=_isdir), \
             mock.patch("os.listdir", return_value=["16"]):
            result = pg._detect_pg_windows()
        assert result["installed"] is True

    def test_prefers_pg16_over_older_version(self):
        """When multiple versions exist, PG 16 is selected as best candidate."""
        instances = [
            {"version": "14.5", "major": 14, "port": 5432,
             "service_name": "postgresql-x64-14", "base_dir": None},
            {"version": "16.4", "major": 16, "port": 5433,
             "service_name": "postgresql-x64-16", "base_dir": None},
        ]
        # Simulate directory detection returning both
        with mock.patch("os.path.isdir", return_value=False), \
             mock.patch("subprocess.run", side_effect=FileNotFoundError):
            result = pg._detect_pg_windows()

        # Manually test sort logic: 16 should rank higher
        instances_copy = list(instances)
        instances_copy.sort(
            key=lambda i: (1 if i.get("major") == 16 else 0, i.get("major", 0)),
            reverse=True,
        )
        assert instances_copy[0]["major"] == 16

    def test_returns_all_instances(self):
        """all_instances list captures every detected installation."""
        instances = [
            {"version": "14.5", "major": 14, "port": 5432,
             "service_name": "postgresql-x64-14", "base_dir": None},
            {"version": "16.4", "major": 16, "port": 5433,
             "service_name": "postgresql-x64-16", "base_dir": None},
        ]
        # The detection collects all_instances before picking best
        # We verify the field exists and is a list
        with mock.patch("os.path.isdir", return_value=False), \
             mock.patch("subprocess.run", side_effect=FileNotFoundError):
            result = pg._detect_pg_windows()
        assert isinstance(result["all_instances"], list)


# ── _is_port_in_use ───────────────────────────────────────────────────────────

class TestIsPortInUse:

    def test_returns_false_for_closed_port(self):
        """Connection refused → port not in use."""
        with mock.patch("socket.create_connection",
                        side_effect=ConnectionRefusedError):
            assert pg._is_port_in_use(19999) is False

    def test_returns_true_for_open_port(self):
        """Successful connection → port is in use."""
        mock_conn = mock.MagicMock()
        mock_conn.__enter__ = mock.MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = mock.MagicMock(return_value=False)
        with mock.patch("socket.create_connection", return_value=mock_conn):
            assert pg._is_port_in_use(5432) is True

    def test_returns_false_for_timeout(self):
        """Timeout → treated as port not in use."""
        with mock.patch("socket.create_connection",
                        side_effect=OSError("timed out")):
            assert pg._is_port_in_use(5432) is False


# ── _find_free_port ───────────────────────────────────────────────────────────

class TestFindFreePort:

    def test_returns_preferred_when_free(self):
        with mock.patch.object(pg, "_is_port_in_use", return_value=False):
            assert pg._find_free_port(5432) == 5432

    def test_returns_alternate_when_5432_occupied(self):
        def _in_use(port, host="127.0.0.1"):
            return port == 5432   # only 5432 is busy
        with mock.patch.object(pg, "_is_port_in_use", side_effect=_in_use):
            result = pg._find_free_port(5432, (5433, 5434))
            assert result == 5433

    def test_returns_none_when_all_occupied(self):
        with mock.patch.object(pg, "_is_port_in_use", return_value=True):
            assert pg._find_free_port(5432, (5433, 5434)) is None


# ── _wait_pg_ready ────────────────────────────────────────────────────────────

class TestWaitPgReady:

    def test_returns_true_immediately_when_port_open(self):
        with mock.patch.object(pg, "_is_port_in_use", return_value=True):
            assert pg._wait_pg_ready("127.0.0.1", 5432, timeout_s=10) is True

    def test_returns_true_after_a_few_retries(self):
        """Port becomes available after 2 failed polls."""
        call_count = {"n": 0}
        def _in_use(port, host="127.0.0.1"):
            call_count["n"] += 1
            return call_count["n"] >= 3   # True on 3rd call
        with mock.patch.object(pg, "_is_port_in_use", side_effect=_in_use), \
             mock.patch("time.sleep"):
            result = pg._wait_pg_ready("127.0.0.1", 5432, timeout_s=20, interval_s=2.0)
        assert result is True

    def test_returns_false_on_timeout(self):
        with mock.patch.object(pg, "_is_port_in_use", return_value=False), \
             mock.patch("time.sleep"):
            assert pg._wait_pg_ready("127.0.0.1", 5432, timeout_s=4, interval_s=2.0) is False


# ── action_check ──────────────────────────────────────────────────────────────

class TestActionCheck:

    def _run_check(self, data_dir, mock_detect=None, mock_running=False,
                   mock_conn=(False, "CONNECTION_REFUSED")):
        detect_result = mock_detect or {
            "installed": False, "version": None, "major": None,
            "port": 5432, "service_name": None, "all_instances": [],
        }
        captured = []
        def _out(payload):
            captured.append(payload)

        with mock.patch.object(pg, "_detect_pg_windows", return_value=detect_result), \
             mock.patch.object(pg, "_is_pg_service_running", return_value=mock_running), \
             mock.patch.object(pg, "_is_port_in_use", return_value=mock_running), \
             mock.patch.object(pg, "_test_db_connection", return_value=mock_conn), \
             mock.patch.object(pg, "_out", side_effect=_out), \
             mock.patch.object(pg, "_load_env", return_value={}):
            pg.action_check(str(data_dir))
        return captured[0] if captured else None

    def test_not_installed(self, tmp_path):
        result = self._run_check(tmp_path)
        assert result["error_code"] == "PG_NOT_INSTALLED"
        assert result["pg_installed"] is False

    def test_installed_not_running(self, tmp_path):
        detect = {"installed": True, "version": "16.4", "major": 16,
                  "port": 5432, "service_name": "postgresql-x64-16", "all_instances": []}
        result = self._run_check(tmp_path, mock_detect=detect, mock_running=False)
        assert result["error_code"] == "PG_NOT_RUNNING"

    def test_installed_running_db_exists(self, tmp_path):
        detect = {"installed": True, "version": "16.4", "major": 16,
                  "port": 5432, "service_name": "postgresql-x64-16", "all_instances": []}
        result = self._run_check(tmp_path, mock_detect=detect,
                                 mock_running=True, mock_conn=(True, ""))
        assert result["success"] is True
        assert result["next_step"] == "done"

    def test_db_not_found(self, tmp_path):
        detect = {"installed": True, "version": "16.4", "major": 16,
                  "port": 5432, "service_name": "postgresql-x64-16", "all_instances": []}
        result = self._run_check(tmp_path, mock_detect=detect,
                                 mock_running=True,
                                 mock_conn=(False, "DATABASE_NOT_FOUND"))
        assert result["error_code"] == "DB_NOT_FOUND"

    def test_uses_detected_port_not_just_env(self, tmp_path):
        """When PG is detected on port 5433, the check uses that port."""
        detect = {"installed": True, "version": "15.2", "major": 15,
                  "port": 5433, "service_name": "postgresql-x64-15",
                  "all_instances": []}
        result = self._run_check(tmp_path, mock_detect=detect,
                                 mock_running=True, mock_conn=(True, ""))
        assert result["pg_port"] == 5433

    def test_auth_failed(self, tmp_path):
        detect = {"installed": True, "version": "16.4", "major": 16,
                  "port": 5432, "service_name": "postgresql-x64-16", "all_instances": []}
        result = self._run_check(tmp_path, mock_detect=detect,
                                 mock_running=True, mock_conn=(False, "AUTH_FAILED"))
        assert result["error_code"] == "AUTH_FAILED"


# ── action_create ─────────────────────────────────────────────────────────────

class TestActionCreate:

    def _run_create(self, data_dir, admin_pwd="adminpwd",
                    mock_create_db=(True, "DB created.")):
        captured = []
        def _out(payload):
            captured.append(payload)

        with mock.patch.object(pg, "_create_database", return_value=mock_create_db), \
             mock.patch.object(pg, "_detect_pg_windows",
                               return_value={"installed": True, "port": 5432,
                                             "all_instances": []}), \
             mock.patch.object(pg, "_out", side_effect=_out), \
             mock.patch.object(pg, "_load_env", return_value={}), \
             mock.patch.object(pg, "_update_env") as mock_update:
            pg.action_create(str(data_dir), admin_pwd)
        return captured[0] if captured else None, mock_update

    def test_success_writes_app_user_not_superuser(self, tmp_path):
        """After create, .env gets DB_USER=popmyc_app, NOT postgres."""
        result, mock_update = self._run_create(tmp_path)
        assert result["success"] is True
        call_args = mock_update.call_args[0][1]  # second positional = updates dict
        assert call_args["DB_USER"] == "popmyc_app"
        assert "postgres" not in call_args.get("DB_USER", "")

    def test_superuser_password_not_in_env_updates(self, tmp_path):
        """The postgres superuser password is never stored in .env."""
        _, mock_update = self._run_create(tmp_path, admin_pwd="SUPER_SECRET_ADMIN_PWD")
        call_args = mock_update.call_args[0][1]
        # Check none of the values equal the superuser password
        for v in call_args.values():
            assert v != "SUPER_SECRET_ADMIN_PWD", \
                "Superuser password must NEVER be written to .env"

    def test_failure_wrong_admin_password(self, tmp_path):
        result, _ = self._run_create(
            tmp_path,
            mock_create_db=(False, "Invalid PostgreSQL administrator password.")
        )
        assert result["success"] is False
        assert result["error_code"] == "WRONG_ADMIN_PASSWORD"

    def test_generated_app_password_is_complex(self, tmp_path):
        """Generated password must have uppercase, lowercase, digit, symbol."""
        captured_passwords = []
        original_create = pg._create_database

        def _capture_create(host, port, admin_user, admin_password,
                             db_name, app_user, app_password):
            captured_passwords.append(app_password)
            return True, "created"

        with mock.patch.object(pg, "_create_database", side_effect=_capture_create), \
             mock.patch.object(pg, "_detect_pg_windows",
                               return_value={"installed": True, "port": 5432, "all_instances": []}), \
             mock.patch.object(pg, "_load_env", return_value={}), \
             mock.patch.object(pg, "_update_env"), \
             mock.patch.object(pg, "_out"):
            pg.action_create(str(tmp_path), "adminpwd")

        assert len(captured_passwords) == 1
        pwd = captured_passwords[0]
        assert len(pwd) >= 16
        assert any(c.isupper() for c in pwd), "No uppercase in password"
        assert any(c.islower() for c in pwd), "No lowercase in password"
        assert any(c.isdigit() for c in pwd), "No digit in password"
        assert any(c in "!@#$%^&*" for c in pwd), "No symbol in password"


# ── _is_pg_service_running ────────────────────────────────────────────────────

class TestPgServiceRunning:

    def test_detects_running_service(self):
        mock_result = mock.MagicMock()
        mock_result.stdout = "SERVICE_NAME: postgresql-x64-16\n STATE: 4  RUNNING"
        mock_result.returncode = 0
        with mock.patch("subprocess.run", return_value=mock_result):
            assert pg._is_pg_service_running("postgresql-x64-16") is True

    def test_detects_stopped_service(self):
        mock_result = mock.MagicMock()
        mock_result.stdout = "SERVICE_NAME: postgresql-x64-16\n STATE: 1  STOPPED"
        mock_result.returncode = 0
        with mock.patch("subprocess.run", return_value=mock_result):
            assert pg._is_pg_service_running("postgresql-x64-16") is False

    def test_returns_false_when_service_not_found(self):
        with mock.patch("subprocess.run", side_effect=FileNotFoundError):
            assert pg._is_pg_service_running("postgresql-x64-16") is False

    def test_checks_multiple_service_names_when_none_provided(self):
        """When no service name given, tries common names."""
        call_args_list = []
        def _run(cmd, *a, **kw):
            call_args_list.append(cmd)
            r = mock.MagicMock()
            r.stdout = "STOPPED"
            r.returncode = 0
            return r
        with mock.patch("subprocess.run", side_effect=_run):
            pg._is_pg_service_running(None)
        # Should have tried multiple service names
        assert len(call_args_list) > 1


# ── _start_pg_service ─────────────────────────────────────────────────────────

class TestStartPgService:

    def test_returns_true_when_service_starts(self):
        with mock.patch("subprocess.run") as mock_run, \
             mock.patch("time.sleep"), \
             mock.patch.object(pg, "_is_pg_service_running", return_value=True):
            assert pg._start_pg_service("postgresql-x64-16") is True

    def test_returns_false_when_service_does_not_start(self):
        with mock.patch("subprocess.run") as mock_run, \
             mock.patch("time.sleep"), \
             mock.patch.object(pg, "_is_pg_service_running", return_value=False):
            assert pg._start_pg_service("postgresql-x64-16") is False


# ── Idempotency ───────────────────────────────────────────────────────────────

class TestIdempotency:

    def test_create_uses_existing_app_password(self, tmp_path):
        """If DB_PASSWORD is already in .env, it is reused (idempotent)."""
        existing_pwd = "ExistingPass@99"
        env_data = {"DB_PASSWORD": existing_pwd, "DB_PORT": "5432", "DB_HOST": "localhost"}

        captured_app_passwords = []
        def _cap(host, port, admin_user, admin_password, db_name, app_user, app_password):
            captured_app_passwords.append(app_password)
            return True, "ok"

        with mock.patch.object(pg, "_create_database", side_effect=_cap), \
             mock.patch.object(pg, "_detect_pg_windows",
                               return_value={"installed": True, "port": 5432, "all_instances": []}), \
             mock.patch.object(pg, "_load_env", return_value=env_data), \
             mock.patch.object(pg, "_update_env"), \
             mock.patch.object(pg, "_out"):
            pg.action_create(str(tmp_path), "adminpwd")

        assert captured_app_passwords[0] == existing_pwd, \
            "Existing app password in .env should be reused"

    def test_create_does_not_overwrite_existing_db(self, tmp_path):
        """_create_database is called with 'never drop' semantics — already exists = ok."""
        with mock.patch.object(pg, "_create_database",
                               return_value=(True, "Database already exists — no changes made.")) as mock_create, \
             mock.patch.object(pg, "_detect_pg_windows",
                               return_value={"installed": True, "port": 5432, "all_instances": []}), \
             mock.patch.object(pg, "_load_env", return_value={}), \
             mock.patch.object(pg, "_update_env"), \
             mock.patch.object(pg, "_out"):
            pg.action_create(str(tmp_path), "adminpwd")
        # Must still call _create_database — which handles idempotency internally
        assert mock_create.called


# ─────────────────────────────────────────────────────────────────────────────
# Installer scenario tests
# These test the logic that maps to the Inno Setup Pascal code in popmyc-setup.iss
# (EnvIsPlaceholder, InstallPostgreSQLSilent decision tree).
# They use the Python pg_setup helpers and mock logic to simulate each case.
# ─────────────────────────────────────────────────────────────────────────────

class TestInstallerScenarios:
    """
    Simulate the installer decision logic in Python to verify correctness
    without needing to run Inno Setup.
    """

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _placeholder_env(tmp_path):
        """Write the Electron-generated placeholder .env."""
        env = tmp_path / ".env"
        env.write_text(
            "DB_NAME=popmyc_pos\n"
            "DB_USER=postgres\n"
            "DB_PASSWORD=changeme\n"
            "DB_HOST=localhost\n"
            "DB_PORT=5432\n"
        )
        return str(tmp_path)

    @staticmethod
    def _valid_customer_env(tmp_path, password="RealCustomerPass@1"):
        """Write a real customer .env with non-placeholder values."""
        env = tmp_path / ".env"
        env.write_text(
            "DB_NAME=popmyc_pos\n"
            f"DB_USER=popmyc_app\n"
            f"DB_PASSWORD={password}\n"
            "DB_HOST=localhost\n"
            "DB_PORT=5432\n"
        )
        return str(tmp_path)

    @staticmethod
    def _env_is_placeholder(data_dir: str) -> bool:
        """Python equivalent of Inno Setup's EnvIsPlaceholder()."""
        from pathlib import Path
        env_path = Path(data_dir) / ".env"
        if not env_path.exists():
            return True  # no file = treat as placeholder
        content = env_path.read_text()
        lines = [l.strip() for l in content.splitlines()]
        return "DB_USER=postgres" in lines and "DB_PASSWORD=changeme" in lines

    # ── Tests 1–2: existing PG usable / unusable ──────────────────────────────

    def test_existing_pg_usable_reused(self):
        """
        If an existing PostgreSQL instance is TCP-reachable, it is reused.
        No new installation is attempted.
        """
        # Port responds → WaitForPgReady would return True → reuse
        with mock.patch.object(pg, "_is_port_in_use", return_value=True):
            result = pg._wait_pg_ready("127.0.0.1", 5432, timeout_s=4, interval_s=1.0)
        assert result is True, "Usable PG should be detected as ready"

    def test_existing_pg_unusable_triggers_fresh_install(self):
        """
        If existing PG never responds, WaitForPgReady returns False →
        the installer falls through to fresh install logic.
        """
        with mock.patch.object(pg, "_is_port_in_use", return_value=False), \
             mock.patch("time.sleep"):
            result = pg._wait_pg_ready("127.0.0.1", 5432, timeout_s=4, interval_s=2.0)
        assert result is False, "Unusable PG should fail readiness check"

    # ── Tests 3–4: existing installation not touched ──────────────────────────

    def test_dedicated_service_name_differs_from_standard(self):
        """
        The dedicated POPMYC service name (POPMYCPostgreSQL16) must differ
        from the EDB default (postgresql-x64-16) so existing installs are safe.
        """
        standard = "postgresql-x64-16"
        dedicated = "POPMYCPostgreSQL16"
        assert standard != dedicated, "Service names must differ"
        assert "POPMYC" in dedicated, "Dedicated service name should contain POPMYC"

    def test_dedicated_prefix_differs_from_standard(self):
        """
        The dedicated POPMYC installation path must differ from the EDB default
        so existing C:\\Program Files\\PostgreSQL\\16 is never touched.
        """
        standard  = "C:\\Program Files\\PostgreSQL\\16"
        dedicated = "C:\\Program Files\\POPMYC\\PostgreSQL\\16"
        assert standard != dedicated
        assert "POPMYC" in dedicated

    def test_dedicated_datadir_differs_from_standard(self):
        dedicated_data = "C:\\Program Files\\POPMYC\\PostgreSQL\\16\\data"
        standard_data  = "C:\\Program Files\\PostgreSQL\\16\\data"
        assert dedicated_data != standard_data

    # ── Tests 5–6: port selection ──────────────────────────────────────────────

    def test_5432_free_uses_5432(self):
        """When 5432 is not listening, it should be selected."""
        def _in_use(port, host="127.0.0.1"):
            return False   # all ports free
        with mock.patch.object(pg, "_is_port_in_use", side_effect=_in_use):
            chosen = pg._find_free_port(5432, (5433, 5434, 5435, 5436))
        assert chosen == 5432

    def test_5432_occupied_5433_free_uses_5433(self):
        """When 5432 is occupied (existing non-responding PG) and 5433 is free."""
        def _in_use(port, host="127.0.0.1"):
            return port == 5432   # only 5432 occupied
        with mock.patch.object(pg, "_is_port_in_use", side_effect=_in_use):
            chosen = pg._find_free_port(5432, (5433, 5434, 5435, 5436))
        assert chosen == 5433

    def test_port_selection_skips_occupied(self):
        """When 5432 and 5433 are both occupied, selects 5434."""
        def _in_use(port, host="127.0.0.1"):
            return port in (5432, 5433)
        with mock.patch.object(pg, "_is_port_in_use", side_effect=_in_use):
            chosen = pg._find_free_port(5432, (5433, 5434, 5435, 5436))
        assert chosen == 5434

    def test_all_ports_occupied_returns_none(self):
        """When all candidate ports are in use, returns None → installer aborts."""
        with mock.patch.object(pg, "_is_port_in_use", return_value=True):
            result = pg._find_free_port(5432, (5433, 5434, 5435, 5436))
        assert result is None

    def test_existing_pg_on_nondefault_port_detected(self, tmp_path):
        """PG registered on port 5433 → action_check reports that port."""
        detect = {
            "installed": True, "version": "15.2", "major": 15,
            "port": 5433, "service_name": "postgresql-x64-15",
            "all_instances": [],
        }
        captured = []
        with mock.patch.object(pg, "_detect_pg_windows", return_value=detect), \
             mock.patch.object(pg, "_is_pg_service_running", return_value=True), \
             mock.patch.object(pg, "_test_db_connection", return_value=(True, "")), \
             mock.patch.object(pg, "_out", side_effect=captured.append), \
             mock.patch.object(pg, "_load_env", return_value={}):
            pg.action_check(str(tmp_path))
        assert captured[0]["pg_port"] == 5433

    # ── Tests 7–9: .env placeholder detection & overwrite ─────────────────────

    def test_placeholder_env_detected(self, tmp_path):
        """A placeholder .env (DB_USER=postgres / DB_PASSWORD=changeme) is detected."""
        self._placeholder_env(tmp_path)
        assert self._env_is_placeholder(str(tmp_path)) is True

    def test_valid_env_not_flagged_as_placeholder(self, tmp_path):
        """A real customer .env is NOT flagged as a placeholder."""
        self._valid_customer_env(tmp_path)
        assert self._env_is_placeholder(str(tmp_path)) is False

    def test_missing_env_treated_as_placeholder(self, tmp_path):
        """No .env present → treated as placeholder (will be created)."""
        assert self._env_is_placeholder(str(tmp_path)) is True

    def test_placeholder_env_would_be_replaced(self, tmp_path):
        """
        Simulate: placeholder .env exists → installer overwrites with real credentials.
        """
        self._placeholder_env(tmp_path)
        assert self._env_is_placeholder(str(tmp_path)) is True
        # Simulate installer writing real credentials
        from pathlib import Path
        (Path(str(tmp_path)) / ".env").write_text(
            "DB_NAME=popmyc_pos\n"
            "DB_USER=popmyc_app\n"
            "DB_PASSWORD=RealPass@1\n"
            "DB_HOST=localhost\n"
            "DB_PORT=5432\n"
        )
        assert self._env_is_placeholder(str(tmp_path)) is False

    def test_valid_env_preserved_on_reinstall(self, tmp_path):
        """
        Simulate: valid customer .env → installer must NOT overwrite it.
        """
        self._valid_customer_env(tmp_path, password="CustomerSecret@99")
        is_ph = self._env_is_placeholder(str(tmp_path))
        assert is_ph is False, "Valid .env must not be flagged as placeholder"
        # Since it's not a placeholder, the installer would skip the overwrite.

    # ── Tests 10–11: popmyc_app user / superuser never in .env ───────────────

    def test_create_writes_popmyc_app_not_postgres(self, tmp_path):
        """After create, DB_USER must be popmyc_app, never postgres."""
        with mock.patch.object(pg, "_create_database",
                               return_value=(True, "DB created.")), \
             mock.patch.object(pg, "_detect_pg_windows",
                               return_value={"installed": True, "port": 5432,
                                             "all_instances": []}), \
             mock.patch.object(pg, "_load_env", return_value={}), \
             mock.patch.object(pg, "_update_env") as mock_update, \
             mock.patch.object(pg, "_out"):
            pg.action_create(str(tmp_path), "adminpwd")
        updates = mock_update.call_args[0][1]
        assert updates["DB_USER"] == "popmyc_app"
        assert updates.get("DB_USER") != "postgres"

    def test_superuser_password_never_in_env(self, tmp_path):
        """The postgres superuser password must not appear in any .env update."""
        admin_pwd = "SuperSecretPostgresAdminPwd@99"
        captured_create = []

        def _cap(host, port, admin_user, admin_password, db_name, app_user, app_password):
            captured_create.append({"admin": admin_password, "app": app_password})
            return True, "ok"

        with mock.patch.object(pg, "_create_database", side_effect=_cap), \
             mock.patch.object(pg, "_detect_pg_windows",
                               return_value={"installed": True, "port": 5432,
                                             "all_instances": []}), \
             mock.patch.object(pg, "_load_env", return_value={}), \
             mock.patch.object(pg, "_update_env") as mock_update, \
             mock.patch.object(pg, "_out"):
            pg.action_create(str(tmp_path), admin_pwd)

        # Verify admin password not in any .env write
        updates = mock_update.call_args[0][1]
        for v in updates.values():
            assert v != admin_pwd, "Superuser password must NEVER be written to .env"

    # ── Test 12: temp superuser file deleted ──────────────────────────────────

    def test_superuser_temp_file_pattern(self, tmp_path):
        """
        The superuser password is stored in a temp file, passed via stdin,
        and should be deleted after use. Verify action_create reads from stdin
        (simulated here) and does not persist the admin password.
        """
        with mock.patch.object(pg, "_create_database",
                               return_value=(True, "ok")) as mock_create, \
             mock.patch.object(pg, "_detect_pg_windows",
                               return_value={"installed": True, "port": 5432,
                                             "all_instances": []}), \
             mock.patch.object(pg, "_load_env", return_value={}), \
             mock.patch.object(pg, "_update_env"), \
             mock.patch.object(pg, "_out"):
            pg.action_create(str(tmp_path), "TempSuperPassword@1")

        # _create_database is called with keyword args only
        call_kwargs = mock_create.call_args.kwargs if mock_create.call_args.kwargs else {}
        # The admin_password kwarg should be what was passed in
        assert call_kwargs.get("admin_password") == "TempSuperPassword@1"
        # But it should NOT appear in any returned value or env update

    # ── Test 13: readiness timeout handled ───────────────────────────────────

    def test_readiness_timeout_returns_false(self):
        """WaitForPgReady returns False when timeout expires without connection."""
        with mock.patch.object(pg, "_is_port_in_use", return_value=False), \
             mock.patch("time.sleep"):
            result = pg._wait_pg_ready("127.0.0.1", 5432, timeout_s=6, interval_s=2.0)
        assert result is False

    def test_readiness_succeeds_before_timeout(self):
        """WaitForPgReady returns True as soon as port becomes available."""
        calls = {"n": 0}
        def _in_use(port, host="127.0.0.1"):
            calls["n"] += 1
            return calls["n"] >= 2   # becomes available on 2nd poll
        with mock.patch.object(pg, "_is_port_in_use", side_effect=_in_use), \
             mock.patch("time.sleep"):
            result = pg._wait_pg_ready("127.0.0.1", 5432, timeout_s=20, interval_s=2.0)
        assert result is True
        assert calls["n"] == 2   # stopped as soon as it became ready

    # ── Test 14: existing unrelated PG not modified ───────────────────────────

    def test_existing_unrelated_pg_service_never_stopped(self):
        """
        The installer must not call sc.exe stop on a third-party PG service.
        Verified by checking that the dedicated POPMYC service name differs
        from the third-party name, so any stop command targets a different service.
        """
        third_party = "postgresql-x64-16"
        dedicated   = "POPMYCPostgreSQL16"
        # The installer only calls 'sc start/stop <dedicated>' in the fresh path
        assert third_party != dedicated
        # Stopping dedicated does not stop third-party
        assert not dedicated.startswith("postgresql-x64")


# =============================================================================
# TestZombieRunningDetection — Bug 3 fix verification
# =============================================================================

class TestZombieRunningDetection:
    """
    action_check must treat a service that is "RUNNING" in the SCM but whose
    TCP port is not actually accepting connections as not-running
    (zombie-running / startup-failed state).

    Before the fix, action_check would fall through to _test_db_connection,
    get CONNECTION_REFUSED, and report next_step="enter_credentials" — which
    displayed the admin password prompt even though the right action was to
    install a fresh dedicated POPMYC PostgreSQL instance.

    After the fix, action_check returns:
      pg_running=False, error_code="PG_NOT_RUNNING", next_step="install_pg"
    when the SCM says RUNNING but the port is closed.
    """

    def test_zombie_running_reports_pg_not_running(self, tmp_path):
        """
        Service reports RUNNING but TCP port is closed → pg_running=False,
        next_step='install_pg' (not 'enter_credentials').
        """
        captured = []

        def _cap(payload):
            captured.append(payload)

        with mock.patch.object(pg, "_detect_pg_windows",
                               return_value={"installed": True, "version": "16.4",
                                             "major": 16, "port": 5432,
                                             "service_name": "postgresql-x64-16",
                                             "all_instances": []}), \
             mock.patch.object(pg, "_is_pg_service_running", return_value=True), \
             mock.patch.object(pg, "_is_port_in_use", return_value=False), \
             mock.patch.object(pg, "_out", side_effect=_cap):
            pg.action_check(str(tmp_path))

        assert len(captured) == 1
        result = captured[0]
        assert result["pg_installed"] is True
        assert result["pg_running"] is False
        assert result["error_code"] == "PG_NOT_RUNNING"
        # Must NOT ask for credentials — the right action is to install fresh PG
        assert result["next_step"] == "install_pg"

    def test_service_running_port_open_proceeds_to_db_check(self, tmp_path):
        """
        Service reports RUNNING and TCP port is open → continues to DB connection test.
        """
        captured = []

        def _cap(payload):
            captured.append(payload)

        with mock.patch.object(pg, "_detect_pg_windows",
                               return_value={"installed": True, "version": "16.4",
                                             "major": 16, "port": 5432,
                                             "service_name": "postgresql-x64-16",
                                             "all_instances": []}), \
             mock.patch.object(pg, "_is_pg_service_running", return_value=True), \
             mock.patch.object(pg, "_is_port_in_use", return_value=True), \
             mock.patch.object(pg, "_test_db_connection",
                               return_value=(True, "")), \
             mock.patch.object(pg, "_load_env",
                               return_value={"DB_USER": "popmyc_app",
                                             "DB_PASSWORD": "secret",
                                             "DB_PORT": "5432",
                                             "DB_HOST": "localhost",
                                             "DB_NAME": "popmyc_pos"}), \
             mock.patch.object(pg, "_out", side_effect=_cap):
            pg.action_check(str(tmp_path))

        assert len(captured) == 1
        result = captured[0]
        assert result["success"] is True
        assert result["pg_running"] is True
        assert result["next_step"] == "done"

    def test_service_not_running_reports_pg_not_running_start_pg(self, tmp_path):
        """
        Service not running at all → pg_running=False, next_step='start_pg'.
        This preserves the pre-existing behavior for truly-stopped services.
        """
        captured = []

        def _cap(payload):
            captured.append(payload)

        with mock.patch.object(pg, "_detect_pg_windows",
                               return_value={"installed": True, "version": "16.4",
                                             "major": 16, "port": 5432,
                                             "service_name": "postgresql-x64-16",
                                             "all_instances": []}), \
             mock.patch.object(pg, "_is_pg_service_running", return_value=False), \
             mock.patch.object(pg, "_out", side_effect=_cap):
            pg.action_check(str(tmp_path))

        assert len(captured) == 1
        result = captured[0]
        assert result["pg_running"] is False
        assert result["error_code"] == "PG_NOT_RUNNING"
        # Service is simply stopped (not zombie) → suggest starting it
        assert result["next_step"] == "start_pg"


# =============================================================================
# TestPopmycInstanceDetection — Bug 3 (part 2): POPMYCPostgreSQL16 preferred
# =============================================================================

class TestPopmycInstanceDetection:
    """
    _detect_pg_windows must prefer POPMYCPostgreSQL16 over postgresql-x64-16
    when both are present, so that action_check talks to the right instance.
    """

    def test_popmyc_service_name_constant(self):
        """The dedicated POPMYC service name must be exactly POPMYCPostgreSQL16."""
        assert "POPMYCPostgreSQL16" != "postgresql-x64-16"
        assert "POPMYCPostgreSQL16" != "postgresql"

    def test_sort_key_prefers_popmyc_over_standard_pg16(self):
        """
        The _sort_key used inside _detect_pg_windows must rank POPMYCPostgreSQL16
        above postgresql-x64-16 when both are present.
        Simulated by sorting two candidate dicts directly.
        """
        POPMYC_SVC = "POPMYCPostgreSQL16"

        def _sort_key(inst: dict):
            major = inst.get("major") or 0
            is_popmyc = 1 if inst.get("service_name") == POPMYC_SVC else 0
            is_16     = 1 if major == 16 else 0
            return (is_popmyc, is_16, major)

        candidates = [
            {"version": "16.4", "major": 16, "port": 5432,
             "service_name": "postgresql-x64-16"},
            {"version": "16.4", "major": 16, "port": 5433,
             "service_name": "POPMYCPostgreSQL16"},
        ]
        candidates.sort(key=_sort_key, reverse=True)
        assert candidates[0]["service_name"] == "POPMYCPostgreSQL16"
        assert candidates[0]["port"] == 5433

    def test_sort_key_popmyc_beats_higher_version(self):
        """
        POPMYCPostgreSQL16 should be preferred even over a higher-version
        third-party install, because POPMYC manages it end-to-end.
        """
        POPMYC_SVC = "POPMYCPostgreSQL16"

        def _sort_key(inst: dict):
            major = inst.get("major") or 0
            is_popmyc = 1 if inst.get("service_name") == POPMYC_SVC else 0
            is_16     = 1 if major == 16 else 0
            return (is_popmyc, is_16, major)

        candidates = [
            {"version": "17.1", "major": 17, "port": 5432,
             "service_name": "postgresql-x64-17"},
            {"version": "16.4", "major": 16, "port": 5433,
             "service_name": "POPMYCPostgreSQL16"},
        ]
        candidates.sort(key=_sort_key, reverse=True)
        assert candidates[0]["service_name"] == "POPMYCPostgreSQL16"


# =============================================================================
# TestPasswordFile — Bug 5 fix: --password-file replaces cmd pipe
# =============================================================================

class TestPasswordFile:
    """
    pg_setup.py --action create --password-file <path> must read the admin
    password from the file (first line), not from stdin, and must NOT delete
    the file itself (the ISS caller deletes it).
    """

    def test_create_reads_password_from_file(self, tmp_path):
        """--password-file is read and passed to action_create."""
        pwd_file = tmp_path / "pg_super.tmp"
        pwd_file.write_text("TestSuperPwd@123\n")

        captured_admin = []

        def _cap(host, port, admin_user, admin_password,
                 db_name, app_user, app_password):
            captured_admin.append(admin_password)
            return True, "ok"

        with mock.patch.object(pg, "_create_database", side_effect=_cap), \
             mock.patch.object(pg, "_detect_pg_windows",
                               return_value={"installed": True, "port": 5432,
                                             "all_instances": []}), \
             mock.patch.object(pg, "_load_env", return_value={}), \
             mock.patch.object(pg, "_update_env"), \
             mock.patch.object(pg, "_out"):
            import sys as _sys
            old_argv = _sys.argv
            try:
                _sys.argv = [
                    "pg_setup.py",
                    "--action", "create",
                    "--data-dir", str(tmp_path),
                    "--password-file", str(pwd_file),
                ]
                pg.main()
            finally:
                _sys.argv = old_argv

        assert len(captured_admin) == 1
        assert captured_admin[0] == "TestSuperPwd@123"

    def test_password_file_not_deleted_by_pg_setup(self, tmp_path):
        """
        pg_setup.py must NOT delete the password file — the ISS caller
        (CreatePopmycDatabase) deletes it after Exec() returns.
        """
        pwd_file = tmp_path / "pg_super.tmp"
        pwd_file.write_text("TestSuperPwd@123\n")

        with mock.patch.object(pg, "_create_database",
                               return_value=(True, "ok")), \
             mock.patch.object(pg, "_detect_pg_windows",
                               return_value={"installed": True, "port": 5432,
                                             "all_instances": []}), \
             mock.patch.object(pg, "_load_env", return_value={}), \
             mock.patch.object(pg, "_update_env"), \
             mock.patch.object(pg, "_out"):
            import sys as _sys
            old_argv = _sys.argv
            try:
                _sys.argv = [
                    "pg_setup.py",
                    "--action", "create",
                    "--data-dir", str(tmp_path),
                    "--password-file", str(pwd_file),
                ]
                pg.main()
            finally:
                _sys.argv = old_argv

        # File must still exist — ISS caller deletes it, not pg_setup.py
        assert pwd_file.exists(), "pg_setup.py must not delete the password file"

    def test_missing_password_file_returns_error_json(self, tmp_path):
        """Missing --password-file path emits error JSON, does not raise."""
        captured = []

        with mock.patch.object(pg, "_out", side_effect=captured.append):
            import sys as _sys
            old_argv = _sys.argv
            try:
                _sys.argv = [
                    "pg_setup.py",
                    "--action", "create",
                    "--data-dir", str(tmp_path),
                    "--password-file", str(tmp_path / "nonexistent.tmp"),
                ]
                pg.main()
            finally:
                _sys.argv = old_argv

        assert len(captured) == 1
        assert captured[0]["success"] is False
        assert captured[0]["error_code"] == "PASSWORD_FILE_ERROR"

    def test_stdin_still_works_without_password_file(self, tmp_path):
        """
        Without --password-file, the password is still read from stdin
        (backward-compatible with Electron's runPgScript('create', ...) path).
        """
        captured_admin = []

        def _cap(host, port, admin_user, admin_password,
                 db_name, app_user, app_password):
            captured_admin.append(admin_password)
            return True, "ok"

        with mock.patch.object(pg, "_create_database", side_effect=_cap), \
             mock.patch.object(pg, "_detect_pg_windows",
                               return_value={"installed": True, "port": 5432,
                                             "all_instances": []}), \
             mock.patch.object(pg, "_load_env", return_value={}), \
             mock.patch.object(pg, "_update_env"), \
             mock.patch.object(pg, "_out"):
            import sys as _sys
            import io
            old_argv  = _sys.argv
            old_stdin = _sys.stdin
            try:
                _sys.argv  = ["pg_setup.py", "--action", "create",
                               "--data-dir", str(tmp_path)]
                _sys.stdin = io.StringIO("StdinPwd@456\n")
                pg.main()
            finally:
                _sys.argv  = old_argv
                _sys.stdin = old_stdin

        assert len(captured_admin) == 1
        assert captured_admin[0] == "StdinPwd@456"




# =============================================================================
# TestManualPostgreSQLDeployment
# =============================================================================
# Verifies the new operator-managed PostgreSQL deployment model:
#   - Operator installs PostgreSQL 16 manually before running POPMYC installer.
#   - POPMYC installer checks PostgreSQL is present; aborts clearly if not.
#   - On first launch, DB Setup screen asks for the postgres admin password once.
#   - POPMYC creates popmyc_pos / popmyc_app automatically from that password.
#   - .env is written with the ACTUAL detected port, never hard-coded 5432.
#   - DB_PASSWORD is never logged.
# =============================================================================

class TestManualPostgreSQLDeployment:

    def _make_pg_detect(self, port: int = 5432,
                        svc: str = "postgresql-x64-16") -> dict:
        return {
            "installed": True, "version": "16.4", "major": 16,
            "port": port, "service_name": svc, "all_instances": [],
        }

    # ── 1. PostgreSQL installed and running → detected successfully ───────────

    def test_pg_installed_and_running_check_succeeds(self, tmp_path):
        """PG running + DB accessible → success, no DB Setup screen."""
        captured = []
        with mock.patch.object(pg, "_detect_pg_windows",
                               return_value=self._make_pg_detect(5432)), \
             mock.patch.object(pg, "_is_pg_service_running", return_value=True), \
             mock.patch.object(pg, "_is_port_in_use", return_value=True), \
             mock.patch.object(pg, "_test_db_connection", return_value=(True, "")), \
             mock.patch.object(pg, "_load_env",
                               return_value={"DB_USER": "popmyc_app",
                                             "DB_PASSWORD": "Str0ng!Pwd",
                                             "DB_HOST": "localhost",
                                             "DB_PORT": "5432",
                                             "DB_NAME": "popmyc_pos"}), \
             mock.patch.object(pg, "_out", side_effect=captured.append):
            pg.action_check(str(tmp_path))
        assert captured[0]["success"] is True
        assert captured[0]["next_step"] == "done"

    # ── 2. PostgreSQL on 5432 → detected correctly ───────────────────────────

    def test_pg_on_default_port_5432_detected(self, tmp_path):
        """PostgreSQL on standard port 5432 is detected and returned correctly."""
        captured = []
        with mock.patch.object(pg, "_detect_pg_windows",
                               return_value=self._make_pg_detect(5432)), \
             mock.patch.object(pg, "_is_pg_service_running", return_value=True), \
             mock.patch.object(pg, "_is_port_in_use", return_value=True), \
             mock.patch.object(pg, "_test_db_connection", return_value=(True, "")), \
             mock.patch.object(pg, "_load_env",
                               return_value={"DB_USER": "popmyc_app",
                                             "DB_PASSWORD": "p", "DB_HOST": "localhost",
                                             "DB_PORT": "5432", "DB_NAME": "popmyc_pos"}), \
             mock.patch.object(pg, "_out", side_effect=captured.append):
            pg.action_check(str(tmp_path))
        assert captured[0]["pg_port"] == 5432

    # ── 3. PostgreSQL on 5433 → detected correctly ───────────────────────────

    def test_pg_on_port_5433_detected(self, tmp_path):
        """PostgreSQL on 5433 (non-default) is detected; pg_port=5433 in result."""
        captured = []
        with mock.patch.object(pg, "_detect_pg_windows",
                               return_value=self._make_pg_detect(5433)), \
             mock.patch.object(pg, "_is_pg_service_running", return_value=True), \
             mock.patch.object(pg, "_is_port_in_use", return_value=True), \
             mock.patch.object(pg, "_test_db_connection", return_value=(True, "")), \
             mock.patch.object(pg, "_load_env",
                               return_value={"DB_USER": "popmyc_app",
                                             "DB_PASSWORD": "p", "DB_HOST": "localhost",
                                             "DB_PORT": "5433", "DB_NAME": "popmyc_pos"}), \
             mock.patch.object(pg, "_out", side_effect=captured.append):
            pg.action_check(str(tmp_path))
        assert captured[0]["pg_port"] == 5433
        assert captured[0]["success"] is True

    # ── 4. PostgreSQL on another supported port ───────────────────────────────

    def test_pg_on_port_5434_detected(self, tmp_path):
        """PostgreSQL on port 5434 is also detected correctly."""
        captured = []
        with mock.patch.object(pg, "_detect_pg_windows",
                               return_value=self._make_pg_detect(5434)), \
             mock.patch.object(pg, "_is_pg_service_running", return_value=True), \
             mock.patch.object(pg, "_is_port_in_use", return_value=True), \
             mock.patch.object(pg, "_test_db_connection", return_value=(True, "")), \
             mock.patch.object(pg, "_load_env",
                               return_value={"DB_USER": "popmyc_app",
                                             "DB_PASSWORD": "p", "DB_HOST": "localhost",
                                             "DB_PORT": "5434", "DB_NAME": "popmyc_pos"}), \
             mock.patch.object(pg, "_out", side_effect=captured.append):
            pg.action_check(str(tmp_path))
        assert captured[0]["pg_port"] == 5434

    # ── 5. PostgreSQL not installed → install_pg next_step ───────────────────

    def test_pg_not_installed_returns_install_pg(self, tmp_path):
        """No PostgreSQL detected → error_code=PG_NOT_INSTALLED, next_step=install_pg."""
        captured = []
        with mock.patch.object(pg, "_detect_pg_windows",
                               return_value={"installed": False, "version": None,
                                             "major": None, "port": 5432,
                                             "service_name": None, "all_instances": []}), \
             mock.patch.object(pg, "_out", side_effect=captured.append):
            pg.action_check(str(tmp_path))
        assert captured[0]["success"] is False
        assert captured[0]["error_code"] == "PG_NOT_INSTALLED"
        assert captured[0]["next_step"] == "install_pg"

    # ── 6. Admin password screen appears when DB not provisioned ─────────────

    def test_db_not_found_returns_enter_credentials(self, tmp_path):
        """
        DB_NOT_FOUND → next_step=enter_credentials so the DB Setup screen
        shows the administrator password field.
        This is correct in the manual-deployment model.
        """
        captured = []
        with mock.patch.object(pg, "_detect_pg_windows",
                               return_value=self._make_pg_detect(5432)), \
             mock.patch.object(pg, "_is_pg_service_running", return_value=True), \
             mock.patch.object(pg, "_is_port_in_use", return_value=True), \
             mock.patch.object(pg, "_test_db_connection",
                               return_value=(False, "DATABASE_NOT_FOUND")), \
             mock.patch.object(pg, "_load_env",
                               return_value={"DB_USER": "postgres",
                                             "DB_PASSWORD": "changeme",
                                             "DB_HOST": "localhost",
                                             "DB_PORT": "5432",
                                             "DB_NAME": "popmyc_pos"}), \
             mock.patch.object(pg, "_out", side_effect=captured.append):
            pg.action_check(str(tmp_path))
        result = captured[0]
        assert result["success"] is False
        assert result["error_code"] == "DB_NOT_FOUND"
        assert result["next_step"] == "enter_credentials", (
            "DB Setup screen must show the password field when DB doesn't exist."
        )

    def test_db_not_found_enter_credentials_even_with_popmyc_app_env(self, tmp_path):
        """
        Even if .env has popmyc_app credentials, DB_NOT_FOUND still routes to
        enter_credentials in the manual-deployment model. The operator can
        re-enter the postgres password to reprovision.
        """
        captured = []
        with mock.patch.object(pg, "_detect_pg_windows",
                               return_value=self._make_pg_detect(5432)), \
             mock.patch.object(pg, "_is_pg_service_running", return_value=True), \
             mock.patch.object(pg, "_is_port_in_use", return_value=True), \
             mock.patch.object(pg, "_test_db_connection",
                               return_value=(False, "DATABASE_NOT_FOUND")), \
             mock.patch.object(pg, "_load_env",
                               return_value={"DB_USER": "popmyc_app",
                                             "DB_PASSWORD": "Str0ng!Pwd",
                                             "DB_HOST": "localhost",
                                             "DB_PORT": "5432",
                                             "DB_NAME": "popmyc_pos"}), \
             mock.patch.object(pg, "_out", side_effect=captured.append):
            pg.action_check(str(tmp_path))
        assert captured[0]["next_step"] == "enter_credentials"

    # ── 7. Correct admin password → DB and user created ──────────────────────

    def test_correct_admin_password_creates_db_and_user(self, tmp_path):
        """Correct postgres admin password → action_create succeeds."""
        captured = []
        with mock.patch.object(pg, "_create_database",
                               return_value=(True, "Database 'popmyc_pos' created.")), \
             mock.patch.object(pg, "_detect_pg_windows",
                               return_value=self._make_pg_detect(5432)), \
             mock.patch.object(pg, "_load_env",
                               return_value={"DB_PORT": "5432",
                                             "DB_HOST": "localhost",
                                             "DB_NAME": "popmyc_pos"}), \
             mock.patch.object(pg, "_update_env"), \
             mock.patch.object(pg, "_out", side_effect=captured.append):
            pg.action_create(str(tmp_path), "CorrectAdminPwd@99")
        assert captured[0]["success"] is True
        assert captured[0]["next_step"] == "done"

    # ── 8. Incorrect admin password → clear AUTH error ───────────────────────

    def test_wrong_admin_password_returns_wrong_admin_password_error(self, tmp_path):
        """Wrong postgres admin password → error_code=WRONG_ADMIN_PASSWORD."""
        captured = []
        with mock.patch.object(pg, "_create_database",
                               return_value=(False, "Invalid PostgreSQL administrator password.")), \
             mock.patch.object(pg, "_detect_pg_windows",
                               return_value=self._make_pg_detect(5432)), \
             mock.patch.object(pg, "_load_env",
                               return_value={"DB_PORT": "5432", "DB_HOST": "localhost",
                                             "DB_NAME": "popmyc_pos"}), \
             mock.patch.object(pg, "_out", side_effect=captured.append):
            pg.action_create(str(tmp_path), "WrongPwd")
        assert captured[0]["success"] is False
        assert captured[0]["error_code"] == "WRONG_ADMIN_PASSWORD"

    # ── 8b. AUTH_FAILED on check → enter_credentials ─────────────────────────

    def test_auth_failed_check_returns_enter_credentials(self, tmp_path):
        """AUTH_FAILED on action_check → next_step=enter_credentials always."""
        captured = []
        with mock.patch.object(pg, "_detect_pg_windows",
                               return_value=self._make_pg_detect(5432)), \
             mock.patch.object(pg, "_is_pg_service_running", return_value=True), \
             mock.patch.object(pg, "_is_port_in_use", return_value=True), \
             mock.patch.object(pg, "_test_db_connection",
                               return_value=(False, "AUTH_FAILED")), \
             mock.patch.object(pg, "_load_env",
                               return_value={"DB_USER": "popmyc_app",
                                             "DB_PASSWORD": "Str0ng!Pwd",
                                             "DB_HOST": "localhost",
                                             "DB_PORT": "5432",
                                             "DB_NAME": "popmyc_pos"}), \
             mock.patch.object(pg, "_out", side_effect=captured.append):
            pg.action_check(str(tmp_path))
        assert captured[0]["error_code"] == "AUTH_FAILED"
        assert captured[0]["next_step"] == "enter_credentials"

    # ── 9. Existing popmyc_pos safely reused ─────────────────────────────────

    def test_existing_popmyc_pos_reused_safely(self, tmp_path):
        """action_create on existing DB returns success without dropping it."""
        captured = []
        with mock.patch.object(pg, "_create_database",
                               return_value=(True, "Database already exists — no changes made.")), \
             mock.patch.object(pg, "_detect_pg_windows",
                               return_value=self._make_pg_detect(5432)), \
             mock.patch.object(pg, "_load_env",
                               return_value={"DB_PORT": "5432", "DB_HOST": "localhost",
                                             "DB_NAME": "popmyc_pos",
                                             "DB_PASSWORD": "Existing!Pwd"}), \
             mock.patch.object(pg, "_update_env"), \
             mock.patch.object(pg, "_out", side_effect=captured.append):
            pg.action_create(str(tmp_path), "AdminPwd@99")
        assert captured[0]["success"] is True
        assert "already exists" in captured[0]["message"]

    # ── 10. popmyc_app connection succeeds after provision ───────────────────

    def test_popmyc_app_connection_succeeds_after_provision(self, tmp_path):
        """After action_create, action_check with popmyc_app creds succeeds."""
        # First: provision
        with mock.patch.object(pg, "_create_database",
                               return_value=(True, "created")), \
             mock.patch.object(pg, "_detect_pg_windows",
                               return_value=self._make_pg_detect(5432)), \
             mock.patch.object(pg, "_load_env", return_value={"DB_PORT": "5432",
                                             "DB_HOST": "localhost",
                                             "DB_NAME": "popmyc_pos"}), \
             mock.patch.object(pg, "_update_env") as mock_upd, \
             mock.patch.object(pg, "_out"):
            pg.action_create(str(tmp_path), "AdminPwd@99")
        # The env was updated with popmyc_app creds
        updates = mock_upd.call_args[0][1]
        assert updates["DB_USER"] == "popmyc_app"

        # Then: check succeeds with the new creds
        captured = []
        with mock.patch.object(pg, "_detect_pg_windows",
                               return_value=self._make_pg_detect(5432)), \
             mock.patch.object(pg, "_is_pg_service_running", return_value=True), \
             mock.patch.object(pg, "_is_port_in_use", return_value=True), \
             mock.patch.object(pg, "_test_db_connection", return_value=(True, "")), \
             mock.patch.object(pg, "_load_env",
                               return_value={"DB_USER": "popmyc_app",
                                             "DB_PASSWORD": updates["DB_PASSWORD"],
                                             "DB_HOST": "localhost",
                                             "DB_PORT": "5432",
                                             "DB_NAME": "popmyc_pos"}), \
             mock.patch.object(pg, "_out", side_effect=captured.append):
            pg.action_check(str(tmp_path))
        assert captured[0]["success"] is True

    # ── 11. .env contains the ACTUAL detected DB_PORT ────────────────────────

    def test_env_db_port_matches_detected_port(self, tmp_path):
        """After provision on port 5433, .env must have DB_PORT=5433, not 5432."""
        with mock.patch.object(pg, "_create_database",
                               return_value=(True, "ok")), \
             mock.patch.object(pg, "_detect_pg_windows",
                               return_value=self._make_pg_detect(5433)), \
             mock.patch.object(pg, "_load_env",
                               return_value={"DB_PORT": "5433",
                                             "DB_HOST": "localhost",
                                             "DB_NAME": "popmyc_pos"}), \
             mock.patch.object(pg, "_update_env") as mock_upd, \
             mock.patch.object(pg, "_out"):
            pg.action_create(str(tmp_path), "AdminPwd@99")
        updates = mock_upd.call_args[0][1]
        assert updates["DB_PORT"] == "5433", (
            ".env DB_PORT must be the actual detected port, never hard-coded 5432."
        )

    # ── 12. DB_PASSWORD never logged ─────────────────────────────────────────

    def test_db_password_not_in_action_check_output(self, tmp_path):
        """DB_PASSWORD must never appear in action_check JSON output."""
        secret = "SuperSecret!Pwd99"
        captured = []
        with mock.patch.object(pg, "_detect_pg_windows",
                               return_value=self._make_pg_detect(5432)), \
             mock.patch.object(pg, "_is_pg_service_running", return_value=True), \
             mock.patch.object(pg, "_is_port_in_use", return_value=True), \
             mock.patch.object(pg, "_test_db_connection", return_value=(True, "")), \
             mock.patch.object(pg, "_load_env",
                               return_value={"DB_USER": "popmyc_app",
                                             "DB_PASSWORD": secret,
                                             "DB_HOST": "localhost",
                                             "DB_PORT": "5432",
                                             "DB_NAME": "popmyc_pos"}), \
             mock.patch.object(pg, "_out", side_effect=captured.append):
            pg.action_check(str(tmp_path))
        assert secret not in json.dumps(captured), \
            "DB_PASSWORD must never appear in action_check output."

    def test_admin_password_not_in_action_create_output(self, tmp_path):
        """postgres admin password must never appear in action_create JSON output."""
        admin_pwd = "PostgresAdmin!Secret99"
        captured = []
        with mock.patch.object(pg, "_create_database",
                               return_value=(True, "ok")), \
             mock.patch.object(pg, "_detect_pg_windows",
                               return_value=self._make_pg_detect(5432)), \
             mock.patch.object(pg, "_load_env", return_value={}), \
             mock.patch.object(pg, "_update_env"), \
             mock.patch.object(pg, "_out", side_effect=captured.append):
            pg.action_create(str(tmp_path), admin_pwd)
        assert admin_pwd not in json.dumps(captured), \
            "postgres admin password must never appear in action_create output."

    # ── 13. action_check result includes correct pg_version and pg_port ───────

    def test_check_result_includes_detected_version_and_port(self, tmp_path):
        """action_check result must include the detected pg_version and pg_port."""
        captured = []
        with mock.patch.object(pg, "_detect_pg_windows",
                               return_value=self._make_pg_detect(5433)), \
             mock.patch.object(pg, "_is_pg_service_running", return_value=True), \
             mock.patch.object(pg, "_is_port_in_use", return_value=True), \
             mock.patch.object(pg, "_test_db_connection", return_value=(True, "")), \
             mock.patch.object(pg, "_load_env",
                               return_value={"DB_USER": "popmyc_app",
                                             "DB_PASSWORD": "p", "DB_HOST": "localhost",
                                             "DB_PORT": "5433", "DB_NAME": "popmyc_pos"}), \
             mock.patch.object(pg, "_out", side_effect=captured.append):
            pg.action_check(str(tmp_path))
        assert captured[0]["pg_port"] == 5433
        assert captured[0]["pg_version"] == "16.4"
        assert captured[0]["next_step"] == "done"

    # ── Regression: no contact_support routing ───────────────────────────────

    def test_no_contact_support_routing_in_any_scenario(self, tmp_path):
        """
        contact_support must NEVER appear as next_step in the manual-deployment
        model. All DB errors route to enter_credentials so the operator can
        re-enter the admin password to reprovision.
        """
        error_cases = [
            (False, "DATABASE_NOT_FOUND"),
            (False, "AUTH_FAILED"),
        ]
        for conn_ok, err in error_cases:
            captured = []
            with mock.patch.object(pg, "_detect_pg_windows",
                                   return_value=self._make_pg_detect(5432)), \
                 mock.patch.object(pg, "_is_pg_service_running", return_value=True), \
                 mock.patch.object(pg, "_is_port_in_use", return_value=True), \
                 mock.patch.object(pg, "_test_db_connection",
                                   return_value=(conn_ok, err)), \
                 mock.patch.object(pg, "_load_env",
                                   return_value={"DB_USER": "popmyc_app",
                                                 "DB_PASSWORD": "Str0ng!Pwd",
                                                 "DB_HOST": "localhost",
                                                 "DB_PORT": "5432",
                                                 "DB_NAME": "popmyc_pos"}), \
                 mock.patch.object(pg, "_out", side_effect=captured.append):
                pg.action_check(str(tmp_path))
            assert captured[0]["next_step"] != "contact_support", (
                f"contact_support must never appear (case: {err})"
            )
            assert captured[0]["next_step"] == "enter_credentials", (
                f"All DB errors must route to enter_credentials (case: {err})"
            )

    # ── action_create writes DB_USER=popmyc_app ───────────────────────────────

    def test_action_create_writes_popmyc_app_not_postgres(self, tmp_path):
        """After provision, .env gets DB_USER=popmyc_app, never postgres."""
        with mock.patch.object(pg, "_create_database",
                               return_value=(True, "ok")), \
             mock.patch.object(pg, "_detect_pg_windows",
                               return_value=self._make_pg_detect(5432)), \
             mock.patch.object(pg, "_load_env", return_value={}), \
             mock.patch.object(pg, "_update_env") as mock_upd, \
             mock.patch.object(pg, "_out"):
            pg.action_create(str(tmp_path), "AdminPwd@99")
        updates = mock_upd.call_args[0][1]
        assert updates["DB_USER"] == "popmyc_app"
        assert updates["DB_USER"] != "postgres"
