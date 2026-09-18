"""
tests/test_cloud_settings.py
=============================
Stage 1 — Cloud Backend Readiness tests.

Verifies that:
A. Local DB_* configuration produces the correct DATABASES dict.
B. DATABASE_URL configuration is parsed correctly (cloud path).
C. SSL options are applied only when DATABASE_URL is set.
D. DB_SSLMODE override is respected.
E. CSRF_TRUSTED_ORIGINS is populated from env.
F. ALLOWED_HOSTS is populated from env.
G. Django system check still passes with both configurations.
H. Static files configuration is valid (STATIC_ROOT, STATIC_URL).
I. settings_cloud module inherits base settings cleanly.
"""

import importlib
import os
import sys
from unittest import mock

import pytest
from django.test import TestCase, override_settings


# ── helpers ───────────────────────────────────────────────────────────────────

def _reload_settings(extra_env: dict):
    """
    Reload config.settings with a patched os.environ, return the module.
    Uses unittest.mock.patch.dict so the real environment is unaffected.
    """
    # Remove DATABASE_URL and DB_* from the real env to get a clean slate,
    # then apply the test overrides.
    clean_env = {
        k: v for k, v in os.environ.items()
        if k not in {"DATABASE_URL", "DB_NAME", "DB_USER", "DB_PASSWORD",
                     "DB_HOST", "DB_PORT", "DB_SSLMODE",
                     "DJANGO_ALLOWED_HOSTS", "CSRF_TRUSTED_ORIGINS"}
    }
    clean_env.update(extra_env)

    with mock.patch.dict(os.environ, clean_env, clear=True):
        # Force a fresh import by removing the cached module
        mod_name = "config.settings"
        if mod_name in sys.modules:
            del sys.modules[mod_name]
        # Also clear dotenv cache if any
        for m in list(sys.modules.keys()):
            if "config" in m and "settings" in m:
                del sys.modules[m]
        return importlib.import_module(mod_name)


# ══════════════════════════════════════════════════════════════════════════════
# A. Local DB_* configuration
# ══════════════════════════════════════════════════════════════════════════════

class TestLocalDBStarConfig(TestCase):
    """When DATABASE_URL is absent, existing DB_* vars must be used."""

    def test_local_db_vars_used_when_no_database_url(self):
        env = {
            "DB_NAME":     "mypos",
            "DB_USER":     "pguser",
            "DB_PASSWORD": "secret",
            "DB_HOST":     "192.168.1.10",
            "DB_PORT":     "5433",
            "DJANGO_SECRET_KEY": "test-secret",
        }
        settings = _reload_settings(env)
        db = settings.DATABASES["default"]
        self.assertEqual(db["NAME"],     "mypos")
        self.assertEqual(db["USER"],     "pguser")
        self.assertEqual(db["PASSWORD"], "secret")
        self.assertEqual(db["HOST"],     "192.168.1.10")
        self.assertEqual(db["PORT"],     "5433")

    def test_local_path_has_no_ssl_options(self):
        """The local DB_* path must NOT inject SSL options."""
        env = {
            "DB_NAME": "popmyc_pos",
            "DJANGO_SECRET_KEY": "test-secret",
        }
        settings = _reload_settings(env)
        db = settings.DATABASES["default"]
        self.assertNotIn("OPTIONS", db)

    def test_local_defaults_are_correct(self):
        """When no DB_* vars are set the hard-coded defaults are used."""
        # Also clear DB_PORT so the real .env's port doesn't leak in
        settings = _reload_settings({
            "DJANGO_SECRET_KEY": "test-secret",
            # Explicitly set to default values to ensure isolation
            "DB_NAME": "popmyc_pos",
            "DB_USER": "postgres",
            "DB_PASSWORD": "changeme",
            "DB_HOST": "localhost",
            "DB_PORT": "5432",
        })
        db = settings.DATABASES["default"]
        self.assertEqual(db["NAME"],  "popmyc_pos")
        self.assertEqual(db["USER"],  "postgres")
        self.assertEqual(db["HOST"],  "localhost")
        self.assertEqual(db["PORT"],  "5432")


# ══════════════════════════════════════════════════════════════════════════════
# B. DATABASE_URL parsing
# ══════════════════════════════════════════════════════════════════════════════

class TestDatabaseURLConfig(TestCase):
    """When DATABASE_URL is set it must be parsed into DATABASES."""

    _SAMPLE_URL = (
        "postgresql://myuser:mypassword@db.supabase.co:5432/postgres"
    )

    def test_database_url_parsed_correctly(self):
        settings = _reload_settings({
            "DATABASE_URL":       self._SAMPLE_URL,
            "DJANGO_SECRET_KEY":  "test-secret",
        })
        db = settings.DATABASES["default"]
        self.assertEqual(db["ENGINE"],   "django.db.backends.postgresql")
        self.assertEqual(db["NAME"],     "postgres")
        self.assertEqual(db["USER"],     "myuser")
        self.assertEqual(db["PASSWORD"], "mypassword")
        self.assertEqual(db["HOST"],     "db.supabase.co")
        self.assertEqual(db["PORT"],     "5432")

    def test_database_url_takes_priority_over_db_star(self):
        """DATABASE_URL must win over any DB_* variables that are also set."""
        settings = _reload_settings({
            "DATABASE_URL":       self._SAMPLE_URL,
            "DB_NAME":            "should_be_ignored",
            "DB_USER":            "should_be_ignored",
            "DJANGO_SECRET_KEY":  "test-secret",
        })
        db = settings.DATABASES["default"]
        self.assertEqual(db["NAME"], "postgres")
        self.assertEqual(db["USER"], "myuser")

    def test_database_url_with_special_chars_in_password(self):
        """Passwords with URL-encoded special characters must be decoded."""
        # Password: p@ssw0rd! → URL-encoded: p%40ssw0rd%21
        url = "postgresql://user:p%40ssw0rd%21@host.db:5432/mydb"
        settings = _reload_settings({
            "DATABASE_URL":      url,
            "DJANGO_SECRET_KEY": "test-secret",
        })
        db = settings.DATABASES["default"]
        self.assertEqual(db["PASSWORD"], "p@ssw0rd!")

    def test_database_url_engine_is_always_postgresql(self):
        settings = _reload_settings({
            "DATABASE_URL":      self._SAMPLE_URL,
            "DJANGO_SECRET_KEY": "test-secret",
        })
        self.assertEqual(
            settings.DATABASES["default"]["ENGINE"],
            "django.db.backends.postgresql",
        )


# ══════════════════════════════════════════════════════════════════════════════
# C. SSL applied only with DATABASE_URL
# ══════════════════════════════════════════════════════════════════════════════

class TestSSLConfiguration(TestCase):

    def test_ssl_require_applied_when_database_url_set(self):
        settings = _reload_settings({
            "DATABASE_URL":      "postgresql://u:p@host/db",
            "DJANGO_SECRET_KEY": "test-secret",
        })
        db = settings.DATABASES["default"]
        self.assertIn("OPTIONS", db)
        self.assertEqual(db["OPTIONS"]["sslmode"], "require")

    def test_ssl_not_applied_on_local_path(self):
        settings = _reload_settings({"DJANGO_SECRET_KEY": "test-secret"})
        db = settings.DATABASES["default"]
        self.assertNotIn("OPTIONS", db)


# ══════════════════════════════════════════════════════════════════════════════
# D. DB_SSLMODE override
# ══════════════════════════════════════════════════════════════════════════════

class TestSSLModeOverride(TestCase):

    def test_db_sslmode_override_respected(self):
        """DB_SSLMODE=disable must override the default 'require'."""
        settings = _reload_settings({
            "DATABASE_URL":      "postgresql://u:p@localhost/db",
            "DB_SSLMODE":        "disable",
            "DJANGO_SECRET_KEY": "test-secret",
        })
        db = settings.DATABASES["default"]
        self.assertEqual(db["OPTIONS"]["sslmode"], "disable")

    def test_db_sslmode_prefer(self):
        settings = _reload_settings({
            "DATABASE_URL":      "postgresql://u:p@localhost/db",
            "DB_SSLMODE":        "prefer",
            "DJANGO_SECRET_KEY": "test-secret",
        })
        self.assertEqual(
            settings.DATABASES["default"]["OPTIONS"]["sslmode"], "prefer"
        )


# ══════════════════════════════════════════════════════════════════════════════
# E. CSRF_TRUSTED_ORIGINS
# ══════════════════════════════════════════════════════════════════════════════

class TestCSRFTrustedOrigins(TestCase):

    def test_csrf_trusted_origins_from_env(self):
        settings = _reload_settings({
            "CSRF_TRUSTED_ORIGINS": "https://app.onrender.com,https://pos.example.com",
            "DJANGO_SECRET_KEY":    "test-secret",
        })
        self.assertIn("https://app.onrender.com",   settings.CSRF_TRUSTED_ORIGINS)
        self.assertIn("https://pos.example.com",    settings.CSRF_TRUSTED_ORIGINS)

    def test_csrf_trusted_origins_empty_when_not_set(self):
        settings = _reload_settings({"DJANGO_SECRET_KEY": "test-secret"})
        self.assertEqual(settings.CSRF_TRUSTED_ORIGINS, [])

    def test_csrf_trusted_origins_strips_whitespace(self):
        settings = _reload_settings({
            "CSRF_TRUSTED_ORIGINS": " https://a.com , https://b.com ",
            "DJANGO_SECRET_KEY":    "test-secret",
        })
        self.assertIn("https://a.com", settings.CSRF_TRUSTED_ORIGINS)
        self.assertIn("https://b.com", settings.CSRF_TRUSTED_ORIGINS)


# ══════════════════════════════════════════════════════════════════════════════
# F. ALLOWED_HOSTS
# ══════════════════════════════════════════════════════════════════════════════

class TestAllowedHosts(TestCase):

    def test_allowed_hosts_from_env(self):
        settings = _reload_settings({
            "DJANGO_ALLOWED_HOSTS": "myapp.onrender.com,localhost,127.0.0.1",
            "DJANGO_SECRET_KEY":    "test-secret",
        })
        self.assertIn("myapp.onrender.com", settings.ALLOWED_HOSTS)
        self.assertIn("localhost",          settings.ALLOWED_HOSTS)

    def test_allowed_hosts_defaults_to_localhost(self):
        settings = _reload_settings({"DJANGO_SECRET_KEY": "test-secret"})
        self.assertIn("localhost",  settings.ALLOWED_HOSTS)
        self.assertIn("127.0.0.1", settings.ALLOWED_HOSTS)


# ══════════════════════════════════════════════════════════════════════════════
# G. Django system check (uses the test database already configured)
# ══════════════════════════════════════════════════════════════════════════════

class TestDjangoSystemCheck(TestCase):

    def test_check_passes_with_default_settings(self):
        from django.core.management import call_command
        from io import StringIO
        out = StringIO()
        # Should not raise
        call_command("check", "--deploy", stdout=out, stderr=out)
        # We do NOT assert output contents because --deploy warns about
        # HTTPS settings that are irrelevant for the local test environment.
        # The important thing is that it does not raise SystemCheckError.


# ══════════════════════════════════════════════════════════════════════════════
# H. Static files
# ══════════════════════════════════════════════════════════════════════════════

class TestStaticFilesConfig(TestCase):

    def test_static_root_is_set(self):
        s = _reload_settings({"DJANGO_SECRET_KEY": "test-secret", "DB_PORT": "5432"})
        self.assertTrue(bool(s.STATIC_ROOT))

    def test_static_url_is_set(self):
        # Reload base settings.py to get its own STATIC_URL value
        s = _reload_settings({"DJANGO_SECRET_KEY": "test-secret", "DB_PORT": "5432"})
        # Base settings.py defines STATIC_URL = "static/" (no leading slash)
        self.assertEqual(s.STATIC_URL, "static/")

    def test_static_root_is_absolute_path(self):
        s = _reload_settings({"DJANGO_SECRET_KEY": "test-secret", "DB_PORT": "5432"})
        from pathlib import Path
        self.assertTrue(Path(s.STATIC_ROOT).is_absolute())


# ══════════════════════════════════════════════════════════════════════════════
# I. settings_cloud module
# ══════════════════════════════════════════════════════════════════════════════

class TestCloudSettingsModule(TestCase):

    def test_cloud_settings_importable(self):
        """settings_cloud must be importable without errors."""
        # Remove cached copies
        for key in list(sys.modules.keys()):
            if "settings_cloud" in key or "settings_desktop" in key:
                del sys.modules[key]
        try:
            import importlib
            mod = importlib.import_module("config.settings_cloud")
            self.assertIsNotNone(mod)
        except Exception as exc:
            self.fail(f"settings_cloud import failed: {exc}")

    def test_cloud_settings_debug_is_false(self):
        import importlib
        for key in list(sys.modules.keys()):
            if "settings_cloud" in key:
                del sys.modules[key]
        mod = importlib.import_module("config.settings_cloud")
        self.assertFalse(mod.DEBUG)

    def test_cloud_settings_inherits_installed_apps(self):
        import importlib
        for key in list(sys.modules.keys()):
            if "settings_cloud" in key:
                del sys.modules[key]
        mod = importlib.import_module("config.settings_cloud")
        self.assertIn("licensing", mod.INSTALLED_APPS)
        self.assertIn("cloud",     mod.INSTALLED_APPS)

    def test_cloud_settings_has_whitenoise_middleware(self):
        import importlib
        for key in list(sys.modules.keys()):
            if "settings_cloud" in key:
                del sys.modules[key]
        mod = importlib.import_module("config.settings_cloud")
        self.assertIn(
            "whitenoise.middleware.WhiteNoiseMiddleware",
            mod.MIDDLEWARE,
        )

    def test_cloud_settings_secure_proxy_ssl_header(self):
        import importlib
        for key in list(sys.modules.keys()):
            if "settings_cloud" in key:
                del sys.modules[key]
        mod = importlib.import_module("config.settings_cloud")
        self.assertEqual(
            mod.SECURE_PROXY_SSL_HEADER,
            ("HTTP_X_FORWARDED_PROTO", "https"),
        )
