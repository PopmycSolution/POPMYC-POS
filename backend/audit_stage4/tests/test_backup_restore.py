"""
audit_stage4/tests/test_backup_restore.py
==========================================
Regression tests for the Stage 5.5 backup/restore system.

Tests:
  BACKUP-1  Validate endpoint rejects non-existent file
  BACKUP-2  Validate endpoint detects corrupt GZIP
  BACKUP-3  Validate endpoint accepts a real valid .sql.gz
  BACKUP-4  Import rejects non-.sql.gz files
  BACKUP-5  Import rejects invalid GZIP content
  BACKUP-6  Restore endpoint requires confirmed=true
  BACKUP-7  Restore endpoint rejects invalid filenames
  BACKUP-8  Delete refuses to remove the last backup
  BACKUP-9  Cashier cannot create/restore/delete backups (403)
  BACKUP-10 Admin can list backups
  BACKUP-11 Retention keeps at least 3 backups
"""

import gzip
import io
import uuid
from datetime import datetime
from pathlib import Path

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

User = get_user_model()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _biz(name=None):
    from businesses.models import Business
    return Business.objects.create(
        name=name or f"TestBiz-{uuid.uuid4().hex[:6]}",
        is_active=True,
    )


def _user(business, role="ADMIN"):
    u = User.objects.create_user(
        username=f"u_{uuid.uuid4().hex[:8]}",
        password="TestPass@123",
        email=f"{uuid.uuid4().hex[:8]}@test.com",
    )
    u.business = business
    u.role = role
    u.save()
    return u


def _authed(user):
    c = APIClient()
    c.force_authenticate(user=user)
    return c


def _active_license(business):
    from licensing.models import License
    from datetime import date, timedelta
    return License.objects.create(
        business=business,
        license_type=License.LicenseType.SUBSCRIPTION,
        status=License.Status.ACTIVE,
        activation_code=f"TEST-{uuid.uuid4().hex[:16].upper()}",
        start_date=date.today(),
        expiry_date=date.today() + timedelta(days=365),
    )


def _make_valid_backup_gz(tmp_path: Path, name: str = None) -> Path:
    """Create a minimal valid .sql.gz file that passes validation."""
    ts   = name or datetime.now().strftime("%Y%m%d_%H%M%S")
    path = tmp_path / f"popmyc_backup_{ts}.sql.gz"
    sql  = (
        b"-- PostgreSQL database dump\n"
        b"SET statement_timeout = 0;\n"
        b"CREATE TABLE test (id integer);\n"
    )
    with gzip.open(path, "wb") as f:
        f.write(sql)
    return path


def _make_corrupt_gz(tmp_path: Path) -> Path:
    """Create a file with GZIP magic bytes but corrupt content."""
    path = tmp_path / "popmyc_backup_20260101_000000.sql.gz"
    path.write_bytes(b'\x1f\x8b' + b'\x00' * 50)  # valid magic, corrupt data
    return path


def _make_fake_gz(tmp_path: Path) -> Path:
    """Create a file that is not GZIP at all."""
    path = tmp_path / "popmyc_backup_20260101_000001.sql.gz"
    path.write_bytes(b"This is not gzip data at all")
    return path


# ── Tests ─────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_validate_rejects_nonexistent(tmp_path, settings, monkeypatch):
    """BACKUP-1: Validate endpoint returns valid=False for a missing file."""
    monkeypatch.setenv("POPMYC_DATA_DIR", str(tmp_path))
    biz = _biz(); _active_license(biz)
    client = _authed(_user(biz, "ADMIN"))

    resp = client.post("/api/v1/backups/validate/",
                       {"filename": "popmyc_backup_20200101_000000.sql.gz"},
                       format="json")
    assert resp.status_code == 200
    data = resp.json()
    assert data["valid"] is False
    assert "not found" in data["reason"].lower()


@pytest.mark.django_db
def test_validate_rejects_corrupt_gzip(tmp_path, monkeypatch):
    """BACKUP-2: Validate endpoint returns valid=False for corrupt GZIP."""
    monkeypatch.setenv("POPMYC_DATA_DIR", str(tmp_path))
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    corrupt = _make_corrupt_gz(backup_dir)

    biz = _biz(); _active_license(biz)
    client = _authed(_user(biz, "ADMIN"))

    resp = client.post("/api/v1/backups/validate/",
                       {"filename": corrupt.name}, format="json")
    assert resp.status_code == 200
    data = resp.json()
    assert data["valid"] is False


@pytest.mark.django_db
def test_validate_accepts_valid_backup(tmp_path, monkeypatch):
    """BACKUP-3: Validate endpoint returns valid=True for a real .sql.gz."""
    monkeypatch.setenv("POPMYC_DATA_DIR", str(tmp_path))
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    valid_file = _make_valid_backup_gz(backup_dir)

    biz = _biz(); _active_license(biz)
    client = _authed(_user(biz, "ADMIN"))

    resp = client.post("/api/v1/backups/validate/",
                       {"filename": valid_file.name}, format="json")
    assert resp.status_code == 200
    data = resp.json()
    assert data["valid"] is True, f"Expected valid, got: {data}"


@pytest.mark.django_db
def test_import_rejects_non_gz(tmp_path, monkeypatch):
    """BACKUP-4: Import endpoint rejects files that don't end in .sql.gz."""
    monkeypatch.setenv("POPMYC_DATA_DIR", str(tmp_path))
    biz = _biz(); _active_license(biz)
    client = _authed(_user(biz, "ADMIN"))

    fake_file = io.BytesIO(b"not a real backup")
    fake_file.name = "backup.zip"
    resp = client.post("/api/v1/backups/import/",
                       {"backup_file": fake_file}, format="multipart")
    assert resp.status_code == 400
    assert "sql.gz" in resp.json().get("detail", "").lower()


@pytest.mark.django_db
def test_import_rejects_invalid_gzip(tmp_path, monkeypatch):
    """BACKUP-5: Import endpoint rejects files that aren't valid GZIP."""
    monkeypatch.setenv("POPMYC_DATA_DIR", str(tmp_path))
    biz = _biz(); _active_license(biz)
    client = _authed(_user(biz, "ADMIN"))

    fake_file = io.BytesIO(b"This is plaintext not gzip")
    fake_file.name = "popmyc_backup_20260101_000000.sql.gz"
    resp = client.post("/api/v1/backups/import/",
                       {"backup_file": fake_file}, format="multipart")
    assert resp.status_code == 400
    assert "gzip" in resp.json().get("detail", "").lower()


@pytest.mark.django_db
def test_restore_requires_confirmed(tmp_path, monkeypatch):
    """BACKUP-6: Restore endpoint must return 400 if confirmed is not true."""
    monkeypatch.setenv("POPMYC_DATA_DIR", str(tmp_path))
    biz = _biz(); _active_license(biz)
    client = _authed(_user(biz, "ADMIN"))

    resp = client.post("/api/v1/backups/restore/",
                       {"filename": "popmyc_backup_20260101_000000.sql.gz",
                        "confirmed": False},
                       format="json")
    assert resp.status_code == 400
    assert "confirmed" in resp.json().get("detail", "").lower()


@pytest.mark.django_db
def test_restore_rejects_invalid_filename(tmp_path, monkeypatch):
    """BACKUP-7: Restore endpoint rejects filenames with unsafe characters."""
    monkeypatch.setenv("POPMYC_DATA_DIR", str(tmp_path))
    biz = _biz(); _active_license(biz)
    client = _authed(_user(biz, "ADMIN"))

    resp = client.post("/api/v1/backups/restore/",
                       {"filename": "../../etc/passwd", "confirmed": True},
                       format="json")
    assert resp.status_code == 400


@pytest.mark.django_db
def test_delete_refuses_last_backup(tmp_path, monkeypatch):
    """BACKUP-8: Cannot delete the last remaining backup."""
    monkeypatch.setenv("POPMYC_DATA_DIR", str(tmp_path))
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    bkp = _make_valid_backup_gz(backup_dir)

    biz = _biz(); _active_license(biz)
    client = _authed(_user(biz, "ADMIN"))

    resp = client.delete(f"/api/v1/backups/file/{bkp.name}/")
    assert resp.status_code == 400
    assert "last" in resp.json().get("detail", "").lower()


@pytest.mark.django_db
def test_cashier_cannot_create_backup(tmp_path, monkeypatch):
    """BACKUP-9: A CASHIER role must receive 403 for backup operations."""
    monkeypatch.setenv("POPMYC_DATA_DIR", str(tmp_path))
    biz = _biz(); _active_license(biz)
    cashier = _user(biz, "CASHIER")
    client  = _authed(cashier)

    resp = client.post("/api/v1/backups/create/", {}, format="json")
    assert resp.status_code == 403

    resp2 = client.get("/api/v1/backups/list/")
    assert resp2.status_code == 403


@pytest.mark.django_db
def test_admin_can_list_backups(tmp_path, monkeypatch):
    """BACKUP-10: An ADMIN can list backups (returns 200 even if empty)."""
    monkeypatch.setenv("POPMYC_DATA_DIR", str(tmp_path))
    biz = _biz(); _active_license(biz)
    client = _authed(_user(biz, "ADMIN"))

    resp = client.get("/api/v1/backups/list/")
    assert resp.status_code == 200
    assert "backups" in resp.json()


@pytest.mark.django_db
def test_retention_keeps_minimum_3(tmp_path, monkeypatch):
    """BACKUP-11: Retention always keeps at least 3 backups."""
    from backups.views import _apply_retention
    monkeypatch.setenv("POPMYC_DATA_DIR", str(tmp_path))
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()

    # Create 5 backup files
    for i in range(5):
        ts = f"2026010{i+1}_120000"
        _make_valid_backup_gz(backup_dir, name=ts)

    # Request keep=1 — should still keep at least 3
    deleted = _apply_retention(backup_dir, keep=1)
    remaining = list(backup_dir.glob("popmyc_backup_*.sql.gz"))
    assert len(remaining) >= 3, f"Retention deleted too many, only {len(remaining)} left"
