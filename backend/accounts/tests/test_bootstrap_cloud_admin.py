"""
accounts/tests/test_bootstrap_cloud_admin.py
=============================================
Tests for the bootstrap_cloud_admin management command.

All tests use Django's call_command() so the command is exercised through
the same entry point that `python manage.py bootstrap_cloud_admin` uses.

Tested scenarios
----------------
1.  All three env vars present → superuser created, is_staff, is_superuser, active.
2.  Username already exists → no duplicate, no error, no password change.
3.  Missing CLOUD_ADMIN_USERNAME → CommandError, exit non-zero.
4.  Missing CLOUD_ADMIN_EMAIL → CommandError, exit non-zero.
5.  Missing CLOUD_ADMIN_PASSWORD → CommandError, exit non-zero.
6.  All three missing → single CommandError listing all three.
7.  Password is never present in command output.
8.  Command is idempotent (run twice → still only one user).
"""

import pytest
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError

User = get_user_model()

# ── Helpers ───────────────────────────────────────────────────────────────────

def _run(env_vars: dict, **kwargs):
    """
    Run bootstrap_cloud_admin with the given env vars injected into os.environ.
    Returns (stdout, stderr) as strings.
    Raises CommandError on validation/creation failure.
    """
    import os

    stdout = StringIO()
    stderr = StringIO()

    original = {k: os.environ.get(k) for k in (
        "CLOUD_ADMIN_USERNAME", "CLOUD_ADMIN_EMAIL", "CLOUD_ADMIN_PASSWORD"
    )}

    # Clear all three first, then set only what was provided
    for k in original:
        os.environ.pop(k, None)
    for k, v in env_vars.items():
        os.environ[k] = v

    try:
        call_command(
            "bootstrap_cloud_admin",
            stdout=stdout,
            stderr=stderr,
        )
    finally:
        # Always restore original environment
        for k, orig_v in original.items():
            if orig_v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = orig_v

    return stdout.getvalue(), stderr.getvalue()


# ── Tests ─────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestBootstrapCloudAdmin:

    VALID_ENV = {
        "CLOUD_ADMIN_USERNAME": "cloud_admin_test",
        "CLOUD_ADMIN_EMAIL":    "cloudadmin@test.com",
        "CLOUD_ADMIN_PASSWORD": "SecureCloudPass@123",
    }

    def test_creates_superuser_with_correct_flags(self):
        """All three vars present → user created with correct flags."""
        stdout, _ = _run(self.VALID_ENV)

        user = User.objects.get(username="cloud_admin_test")
        assert user.is_staff
        assert user.is_superuser
        assert user.is_active
        assert user.email == "cloudadmin@test.com"
        assert user.check_password("SecureCloudPass@123")
        assert "created successfully" in stdout

    def test_password_not_in_output(self):
        """The password must never appear in stdout or stderr."""
        stdout, stderr = _run(self.VALID_ENV)
        assert "SecureCloudPass@123" not in stdout
        assert "SecureCloudPass@123" not in stderr

    def test_idempotent_existing_user_not_duplicated(self):
        """Running twice → second run is a no-op; no duplicate created."""
        _run(self.VALID_ENV)
        count_before = User.objects.filter(username="cloud_admin_test").count()

        stdout, _ = _run(self.VALID_ENV)

        count_after = User.objects.filter(username="cloud_admin_test").count()
        assert count_before == 1
        assert count_after == 1
        assert "already exists" in stdout

    def test_existing_user_password_unchanged(self):
        """
        Second run must NOT change the existing user's password.
        """
        _run(self.VALID_ENV)
        user_before = User.objects.get(username="cloud_admin_test")
        original_hash = user_before.password

        # Run again with a different password — must be ignored
        _run({**self.VALID_ENV, "CLOUD_ADMIN_PASSWORD": "DifferentPassword@456"})

        user_after = User.objects.get(username="cloud_admin_test")
        assert user_after.password == original_hash

    def test_missing_username_raises_command_error(self):
        """CLOUD_ADMIN_USERNAME missing → CommandError."""
        env = {k: v for k, v in self.VALID_ENV.items() if k != "CLOUD_ADMIN_USERNAME"}
        with pytest.raises(CommandError) as exc_info:
            _run(env)
        assert "CLOUD_ADMIN_USERNAME" in str(exc_info.value)

    def test_missing_email_raises_command_error(self):
        """CLOUD_ADMIN_EMAIL missing → CommandError."""
        env = {k: v for k, v in self.VALID_ENV.items() if k != "CLOUD_ADMIN_EMAIL"}
        with pytest.raises(CommandError) as exc_info:
            _run(env)
        assert "CLOUD_ADMIN_EMAIL" in str(exc_info.value)

    def test_missing_password_raises_command_error(self):
        """CLOUD_ADMIN_PASSWORD missing → CommandError."""
        env = {k: v for k, v in self.VALID_ENV.items() if k != "CLOUD_ADMIN_PASSWORD"}
        with pytest.raises(CommandError) as exc_info:
            _run(env)
        assert "CLOUD_ADMIN_PASSWORD" in str(exc_info.value)

    def test_all_missing_lists_all_three(self):
        """All three vars missing → single CommandError that names all three."""
        with pytest.raises(CommandError) as exc_info:
            _run({})
        msg = str(exc_info.value)
        assert "CLOUD_ADMIN_USERNAME" in msg
        assert "CLOUD_ADMIN_EMAIL"    in msg
        assert "CLOUD_ADMIN_PASSWORD" in msg

    def test_no_user_created_on_missing_vars(self):
        """Validation failure must not leave a partial user behind."""
        count_before = User.objects.count()
        env = {k: v for k, v in self.VALID_ENV.items() if k != "CLOUD_ADMIN_USERNAME"}
        with pytest.raises(CommandError):
            _run(env)
        assert User.objects.count() == count_before

    def test_created_user_can_log_in(self):
        """The created user can authenticate with the supplied password."""
        _run(self.VALID_ENV)
        from django.contrib.auth import authenticate
        user = authenticate(
            username="cloud_admin_test",
            password="SecureCloudPass@123",
        )
        assert user is not None
        assert user.username == "cloud_admin_test"
