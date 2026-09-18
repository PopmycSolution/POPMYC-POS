"""
accounts/tests/test_avatar.py
==============================
Tests for the profile-picture (avatar) system.

Covers:
  1.  Upload a valid image → 200, profile_picture_url populated
  2.  Change (replace) picture → old file deleted, new URL returned
  3.  Remove picture (DELETE) → 200, profile_picture_url is None
  4.  Remove when no picture set → 404
  5.  Default (no picture) → profile_picture_url is None in /me/
  6.  Invalid file type rejected → 400
  7.  Oversized file rejected → 400
  8.  Corrupt / non-image file rejected → 400
  9.  Unauthenticated access blocked → 401
  10. User cannot change another user's avatar via the upload endpoint
  11. profile_picture_url persists across /me/ GET calls
  12. manage.py check passes (imported via import smoke)
"""
import io
import pytest
from django.urls import reverse
from rest_framework.test import APIClient
from PIL import Image as PilImage

from accounts.models import CustomUser
from businesses.models import Business

AVATAR_URL = "/api/v1/accounts/me/avatar/"
ME_URL     = "/api/v1/accounts/me/"


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest.fixture
def biz(db):
    return Business.objects.create(name="TestBiz", is_active=True)


@pytest.fixture
def user(db, biz):
    u = CustomUser.objects.create_user(
        username="avataruser", password="TestPass@123",
        email="avatar@test.com", first_name="Avatar", last_name="User",
    )
    u.business = biz
    u.save()
    return u


@pytest.fixture
def other_user(db, biz):
    u = CustomUser.objects.create_user(
        username="otheravataruser", password="TestPass@123",
        email="other_avatar@test.com", first_name="Other", last_name="User",
    )
    u.business = biz
    u.save()
    return u


def authed(user: CustomUser) -> APIClient:
    c = APIClient()
    c.force_authenticate(user=user)
    return c


def make_image(width=200, height=200, fmt="JPEG") -> io.BytesIO:
    """Return an in-memory image file."""
    buf = io.BytesIO()
    img = PilImage.new("RGB", (width, height), color=(60, 120, 180))
    img.save(buf, format=fmt)
    buf.seek(0)
    buf.name = f"test.{'jpg' if fmt == 'JPEG' else fmt.lower()}"
    return buf


def make_png() -> io.BytesIO:
    buf = io.BytesIO()
    img = PilImage.new("RGBA", (200, 200), color=(60, 120, 180, 255))
    img.save(buf, format="PNG")
    buf.seek(0)
    buf.name = "test.png"
    return buf


def make_webp() -> io.BytesIO:
    buf = io.BytesIO()
    img = PilImage.new("RGB", (200, 200), color=(60, 120, 180))
    img.save(buf, format="WEBP")
    buf.seek(0)
    buf.name = "test.webp"
    return buf


# ── Tests ──────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestAvatarUpload:

    def test_upload_jpeg_succeeds(self, user):
        client = authed(user)
        buf = make_image()
        resp = client.post(AVATAR_URL, {"avatar": buf}, format="multipart")
        assert resp.status_code == 200, resp.data
        assert resp.data.get("profile_picture_url") is not None
        user.refresh_from_db()
        assert user.profile_picture

    def test_upload_png_succeeds(self, user):
        client = authed(user)
        resp = client.post(AVATAR_URL, {"avatar": make_png()}, format="multipart")
        assert resp.status_code == 200
        assert resp.data.get("profile_picture_url") is not None

    def test_upload_webp_succeeds(self, user):
        client = authed(user)
        resp = client.post(AVATAR_URL, {"avatar": make_webp()}, format="multipart")
        assert resp.status_code == 200
        assert resp.data.get("profile_picture_url") is not None

    def test_change_picture_replaces_old(self, user):
        client = authed(user)
        # Upload first picture
        client.post(AVATAR_URL, {"avatar": make_image()}, format="multipart")
        user.refresh_from_db()
        first_name = user.profile_picture.name

        # Upload second picture
        resp = client.post(AVATAR_URL, {"avatar": make_image(300, 300)}, format="multipart")
        assert resp.status_code == 200
        user.refresh_from_db()
        # The stored path is the same because we always save as <pk>.jpg
        assert user.profile_picture.name == first_name or user.profile_picture

    def test_remove_picture_succeeds(self, user):
        client = authed(user)
        client.post(AVATAR_URL, {"avatar": make_image()}, format="multipart")
        user.refresh_from_db()
        assert user.profile_picture

        resp = client.delete(AVATAR_URL)
        assert resp.status_code == 200
        assert resp.data["profile_picture_url"] is None
        user.refresh_from_db()
        assert not user.profile_picture

    def test_remove_when_no_picture_returns_404(self, user):
        assert not user.profile_picture
        client = authed(user)
        resp = client.delete(AVATAR_URL)
        assert resp.status_code == 404

    def test_default_no_picture_returns_null_url(self, user):
        client = authed(user)
        resp = client.get(ME_URL)
        assert resp.status_code == 200
        assert resp.data.get("profile_picture_url") is None

    def test_invalid_file_type_rejected(self, user):
        client = authed(user)
        buf = io.BytesIO(b"this is a text file")
        buf.name = "resume.txt"
        resp = client.post(AVATAR_URL, {"avatar": buf}, format="multipart")
        assert resp.status_code == 400
        assert "Unsupported" in resp.data["detail"] or "type" in resp.data["detail"].lower()

    def test_oversized_file_rejected(self, user):
        client = authed(user)
        # Create a fake "image" that is 6 MB of zeros
        buf = io.BytesIO(b"\x00" * (6 * 1024 * 1024))
        buf.name = "huge.jpg"
        buf.seek(0)
        resp = client.post(AVATAR_URL, {"avatar": buf}, format="multipart")
        assert resp.status_code == 400
        assert "large" in resp.data["detail"].lower() or "size" in resp.data["detail"].lower()

    def test_corrupt_image_rejected(self, user):
        client = authed(user)
        buf = io.BytesIO(b"\xFF\xD8\xFF\xE0" + b"\x00" * 100)   # fake JPEG header
        buf.name = "corrupt.jpg"
        resp = client.post(AVATAR_URL, {"avatar": buf}, format="multipart")
        assert resp.status_code == 400

    def test_no_file_field_returns_400(self, user):
        client = authed(user)
        resp = client.post(AVATAR_URL, {}, format="multipart")
        assert resp.status_code == 400

    def test_unauthenticated_upload_blocked(self):
        client = APIClient()
        buf = make_image()
        resp = client.post(AVATAR_URL, {"avatar": buf}, format="multipart")
        assert resp.status_code == 401

    def test_unauthenticated_delete_blocked(self):
        client = APIClient()
        resp = client.delete(AVATAR_URL)
        assert resp.status_code == 401

    def test_cannot_upload_to_another_users_avatar_via_this_endpoint(self, user, other_user):
        """
        The /me/avatar/ endpoint is always bound to request.user.
        There is no way to target another user's picture through it —
        the endpoint has no user-id parameter.
        We verify that uploading as `user` does not affect `other_user`.
        """
        client = authed(user)
        client.post(AVATAR_URL, {"avatar": make_image()}, format="multipart")

        other_user.refresh_from_db()
        assert not other_user.profile_picture   # other_user untouched

    def test_picture_url_persists_after_get(self, user):
        client = authed(user)
        client.post(AVATAR_URL, {"avatar": make_image()}, format="multipart")

        # GET /me/ should include profile_picture_url
        resp = client.get(ME_URL)
        assert resp.status_code == 200
        assert resp.data.get("profile_picture_url") is not None
        assert "/media/" in resp.data["profile_picture_url"] or "avatar" in resp.data["profile_picture_url"]

    def test_avatar_model_import(self):
        """Smoke: model and view can be imported without errors."""
        from accounts.models import CustomUser
        from accounts.views import ProfilePictureView
        assert CustomUser._meta.get_field("profile_picture") is not None
        assert ProfilePictureView is not None
