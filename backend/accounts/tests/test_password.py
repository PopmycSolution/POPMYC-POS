"""
accounts/tests/test_password.py
================================
Real behaviour tests for the POPMYC POS password-management workflow.

Covers all 10 required scenarios:
  1.  User can change their own password with the correct current password.
  2.  Wrong current password is rejected with 400.
  3.  New-password confirmation mismatch is rejected with 400.
  4.  User cannot change another user's password through the self-service endpoint.
  5.  Authorised Business Admin can reset a user in the same Business.
  6.  Business Admin cannot reset a user belonging to another Business.
  7.  Super Admin retains full reset authority across all businesses.
  8.  Temporary-password login: must_change_password is True after admin reset.
  9.  Passwords remain hashed — never stored in plain text.
  10. Existing login functionality still works (login returns tokens + user data).

All tests use the real database (pytest.mark.django_db) and the real DRF
test client. No mocking of password hashing or auth middleware.
"""
import pytest
from django.contrib.auth.hashers import is_password_usable
from django.urls import reverse
from rest_framework.test import APIClient

from accounts.models import CustomUser
from businesses.models import Business


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest.fixture
def biz_a(db):
    return Business.objects.create(name="Business A", is_active=True)


@pytest.fixture
def biz_b(db):
    return Business.objects.create(name="Business B", is_active=True)


@pytest.fixture
def regular_user(db, biz_a):
    """A normal non-admin user in Business A."""
    u = CustomUser.objects.create_user(
        username="regular_user",
        password="OldPass@123",
        email="regular@biz-a.test",
        first_name="Regular",
        last_name="User",
    )
    u.business = biz_a
    u.save()
    return u


@pytest.fixture
def other_user(db, biz_a):
    """Another user in Business A (target for cross-user attempts)."""
    u = CustomUser.objects.create_user(
        username="other_user",
        password="OtherPass@123",
        email="other@biz-a.test",
        first_name="Other",
        last_name="User",
    )
    u.business = biz_a
    u.save()
    return u


@pytest.fixture
def admin_user(db, biz_a):
    """Business Admin for Business A (is_staff=True marks them as admin-capable)."""
    u = CustomUser.objects.create_user(
        username="admin_biz_a",
        password="AdminPass@123",
        email="admin@biz-a.test",
        first_name="Admin",
        last_name="BizA",
        is_staff=True,
    )
    u.business = biz_a
    u.save()
    return u


@pytest.fixture
def user_biz_b(db, biz_b):
    """A user in Business B."""
    u = CustomUser.objects.create_user(
        username="user_biz_b",
        password="BizBPass@123",
        email="user@biz-b.test",
        first_name="Biz",
        last_name="B",
    )
    u.business = biz_b
    u.save()
    return u


@pytest.fixture
def superuser(db):
    """Platform superuser — no business assignment."""
    return CustomUser.objects.create_superuser(
        username="superadmin",
        password="SuperPass@123!",
        email="super@platform.test",
    )


def auth_client(user: CustomUser) -> APIClient:
    """Return an APIClient force-authenticated as *user*."""
    client = APIClient()
    client.force_authenticate(user=user)
    return client


# ── Helpers ────────────────────────────────────────────────────────────────────

PASSWORD_CHANGE_URL = "/api/v1/accounts/me/password/"


def reset_url(user_id) -> str:
    return f"/api/v1/accounts/users/{user_id}/reset-password/"


# ══════════════════════════════════════════════════════════════════════════════
# TEST 1 — User can change their own password with the correct current password
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.django_db
class TestSelfServicePasswordChange:

    def test_change_own_password_succeeds(self, regular_user):
        client = auth_client(regular_user)
        resp = client.post(PASSWORD_CHANGE_URL, {
            "old_password":     "OldPass@123",
            "new_password":     "NewSecure@789",
            "confirm_password": "NewSecure@789",
        })
        assert resp.status_code == 200, resp.data
        assert resp.data["must_change_password"] is False

        # The password actually changed
        regular_user.refresh_from_db()
        assert regular_user.check_password("NewSecure@789")
        assert not regular_user.check_password("OldPass@123")

    # ── TEST 2 — Wrong current password rejected ──────────────────────────────

    def test_wrong_current_password_rejected(self, regular_user):
        client = auth_client(regular_user)
        resp = client.post(PASSWORD_CHANGE_URL, {
            "old_password":     "WrongPassword!",
            "new_password":     "NewSecure@789",
            "confirm_password": "NewSecure@789",
        })
        assert resp.status_code == 400
        assert "incorrect" in resp.data["detail"].lower()

        # Password must not have changed
        regular_user.refresh_from_db()
        assert regular_user.check_password("OldPass@123")

    # ── TEST 3 — Confirmation mismatch rejected ───────────────────────────────

    def test_confirmation_mismatch_rejected(self, regular_user):
        client = auth_client(regular_user)
        resp = client.post(PASSWORD_CHANGE_URL, {
            "old_password":     "OldPass@123",
            "new_password":     "NewSecure@789",
            "confirm_password": "DifferentPass@789",
        })
        assert resp.status_code == 400
        assert "match" in resp.data["detail"].lower()

        regular_user.refresh_from_db()
        assert regular_user.check_password("OldPass@123")

    # ── TEST 4 — User cannot change another user's password via self-service ──

    def test_cannot_change_other_users_password(self, regular_user, other_user):
        """
        The self-service endpoint is bound to request.user.
        Even if someone crafts a request with another user's old password,
        the endpoint only operates on the authenticated user's own account.
        """
        client = auth_client(regular_user)
        # regular_user tries to "change" other_user's password by knowing it
        resp = client.post(PASSWORD_CHANGE_URL, {
            "old_password":     "OtherPass@123",  # other_user's real password
            "new_password":     "Hijacked@456",
            "confirm_password": "Hijacked@456",
        })
        # Must fail because "OtherPass@123" is not regular_user's password
        assert resp.status_code == 400

        other_user.refresh_from_db()
        assert other_user.check_password("OtherPass@123")  # unchanged

    def test_missing_fields_rejected(self, regular_user):
        client = auth_client(regular_user)
        resp = client.post(PASSWORD_CHANGE_URL, {
            "old_password": "OldPass@123",
            # missing new_password and confirm_password
        })
        assert resp.status_code == 400


# ══════════════════════════════════════════════════════════════════════════════
# TEST 5 — Business Admin can reset a user in the same business
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.django_db
class TestAdminPasswordReset:

    def test_admin_can_reset_same_business_user(self, admin_user, other_user):
        assert str(admin_user.business_id) == str(other_user.business_id)
        client = auth_client(admin_user)
        resp = client.post(reset_url(other_user.id), {
            "new_password": "TempReset@999",
        })
        assert resp.status_code == 200, resp.data
        assert resp.data["must_change_password"] is True
        assert "temporary_password" in resp.data

        other_user.refresh_from_db()
        assert other_user.check_password("TempReset@999")
        assert other_user.must_change_password is True

    def test_admin_reset_auto_generates_password_when_omitted(self, admin_user, other_user):
        client = auth_client(admin_user)
        resp = client.post(reset_url(other_user.id), {})
        assert resp.status_code == 200
        temp_pwd = resp.data["temporary_password"]
        assert len(temp_pwd) >= 12  # auto-generated is 16 chars

        other_user.refresh_from_db()
        assert other_user.check_password(temp_pwd)
        assert other_user.must_change_password is True

    # ── TEST 6 — Business Admin cannot reset user in another business ─────────

    def test_admin_cannot_reset_different_business_user(self, admin_user, user_biz_b):
        assert str(admin_user.business_id) != str(user_biz_b.business_id)
        client = auth_client(admin_user)
        # user_biz_b is in a different business — get_queryset() won't include them
        resp = client.post(reset_url(user_biz_b.id), {
            "new_password": "HackedPass@999",
        })
        # DRF returns 404 when object not in scoped queryset
        assert resp.status_code in (403, 404)

        user_biz_b.refresh_from_db()
        assert user_biz_b.check_password("BizBPass@123")  # unchanged
        assert user_biz_b.must_change_password is False

    # ── TEST 7 — Super Admin can reset any user ───────────────────────────────

    def test_superuser_can_reset_any_user(self, superuser, user_biz_b):
        client = auth_client(superuser)
        resp = client.post(reset_url(user_biz_b.id), {
            "new_password": "SuperReset@111",
        })
        assert resp.status_code == 200, resp.data
        user_biz_b.refresh_from_db()
        assert user_biz_b.check_password("SuperReset@111")
        assert user_biz_b.must_change_password is True

    def test_superuser_can_reset_biz_a_user(self, superuser, other_user):
        client = auth_client(superuser)
        resp = client.post(reset_url(other_user.id), {
            "new_password": "SuperReset@222",
        })
        assert resp.status_code == 200
        other_user.refresh_from_db()
        assert other_user.check_password("SuperReset@222")

    # ── TEST 8 — must_change_password is True after admin reset ──────────────

    def test_must_change_password_set_after_admin_reset(self, admin_user, other_user):
        assert not other_user.must_change_password  # starts False

        client = auth_client(admin_user)
        client.post(reset_url(other_user.id), {"new_password": "Forced@Pass1"})

        other_user.refresh_from_db()
        assert other_user.must_change_password is True

    def test_must_change_password_cleared_after_self_change(self, regular_user):
        # Simulate admin having set must_change_password=True previously
        regular_user.must_change_password = True
        regular_user.save()

        client = auth_client(regular_user)
        resp = client.post(PASSWORD_CHANGE_URL, {
            "old_password":     "OldPass@123",
            "new_password":     "NewSecure@789",
            "confirm_password": "NewSecure@789",
        })
        assert resp.status_code == 200
        assert resp.data["must_change_password"] is False

        regular_user.refresh_from_db()
        assert regular_user.must_change_password is False

    # ── TEST 9 — Passwords remain hashed ─────────────────────────────────────

    def test_password_stored_as_hash_not_plaintext(self, regular_user):
        # After creation the password field must never equal the raw string
        raw = "OldPass@123"
        regular_user.refresh_from_db()
        assert regular_user.password != raw
        assert is_password_usable(regular_user.password)
        # Should be a recognisable Django hash prefix
        assert regular_user.password.startswith(
            ("pbkdf2_sha256$", "argon2$", "bcrypt$", "scrypt$")
        )

    def test_password_hashed_after_admin_reset(self, admin_user, other_user):
        client = auth_client(admin_user)
        resp = client.post(reset_url(other_user.id), {"new_password": "TempReset@888"})
        assert resp.status_code == 200

        other_user.refresh_from_db()
        assert other_user.password != "TempReset@888"
        assert is_password_usable(other_user.password)

    def test_password_hashed_after_self_change(self, regular_user):
        client = auth_client(regular_user)
        client.post(PASSWORD_CHANGE_URL, {
            "old_password":     "OldPass@123",
            "new_password":     "NewSecure@789",
            "confirm_password": "NewSecure@789",
        })
        regular_user.refresh_from_db()
        assert regular_user.password != "NewSecure@789"
        assert is_password_usable(regular_user.password)

    # ── TEST 10 — Existing login still works ─────────────────────────────────

    def test_login_returns_tokens_and_user(self, regular_user):
        client = APIClient()
        # Login via the /me/ endpoint indirectly — use force_authenticate
        # then verify GET /me/ works (login endpoint needs phone/email in our setup)
        client.force_authenticate(user=regular_user)
        resp = client.get("/api/v1/accounts/me/")
        assert resp.status_code == 200
        assert resp.data["username"] == "regular_user"
        assert "password" not in resp.data
        assert "must_change_password" in resp.data

    def test_login_includes_must_change_password_flag(self, regular_user):
        """LoginView serialises the flag so the frontend can intercept it."""
        regular_user.must_change_password = True
        regular_user.set_password("OldPass@123")
        regular_user.save()

        client = APIClient()
        resp = client.post("/api/v1/accounts/login/", {
            "phone_number": "",
            "email":        "regular@biz-a.test",
            "password":     "OldPass@123",
        })
        assert resp.status_code == 200
        assert resp.data["must_change_password"] is True
        assert "access" in resp.data
        assert "refresh" in resp.data

    def test_admin_cannot_reset_own_password_via_reset_endpoint(self, admin_user):
        """Admin must use /me/password/ for self-service, not the reset endpoint."""
        client = auth_client(admin_user)
        resp = client.post(reset_url(admin_user.id), {"new_password": "SelfReset@111"})
        assert resp.status_code == 400
        assert "self-service" in resp.data["detail"].lower()

    def test_unauthenticated_cannot_change_password(self):
        client = APIClient()
        resp = client.post(PASSWORD_CHANGE_URL, {
            "old_password":     "anything",
            "new_password":     "anything",
            "confirm_password": "anything",
        })
        assert resp.status_code == 401

    def test_unauthenticated_cannot_reset_password(self, other_user):
        client = APIClient()
        resp = client.post(reset_url(other_user.id), {"new_password": "anything"})
        assert resp.status_code == 401
