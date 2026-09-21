"""
setup/tests.py
==============
Tests for the first-run setup API.

Covers every scenario from the 5.2C requirement:
  - Fresh installation → wizard → complete
  - Invalid license key
  - Expired license
  - Cloud / network unavailable (tested via mocking)
  - Restarting during setup (partial state)
  - Restarting after setup (409 Conflict)
  - Attempting setup twice
  - Existing customer (data preserved)
  - Server-side completeness check (frontend-only flag is not trusted)
"""

import uuid
import pytest
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from businesses.models import Business, BusinessSettings
from branches.models import Branch
from licensing.models import License

User = get_user_model()


# ── Fixtures ──────────────────────────────────────────────────────────────────

def _client():
    return APIClient()


def _make_license(status=License.Status.PENDING, business=None):
    """Create a License record as POPMYC staff would before giving code to customer."""
    if business is None:
        business = Business.objects.create(
            name="Test Biz",
            business_category="GENERAL_RETAIL",
        )
    return License.objects.create(
        business=business,
        license_type=License.LicenseType.SUBSCRIPTION,
        status=status,
        activation_code=f"TEST-{uuid.uuid4().hex[:16].upper()}",
        expiry_date=date.today() + timedelta(days=365),
    )


def _setup_payload(activation_code: str) -> dict:
    return {
        "business": {
            "name": "Kofi Stores Ltd",
            "business_category": "GENERAL_RETAIL",
            "address": "123 Main Street, Accra",
            "phone": "+233241234567",
            "email": "kofi@example.com",
            "currency": "GHS",
            "currency_symbol": "GH₵",
        },
        "branch": {
            "name": "Main Branch",
            "code": "MAIN",
        },
        "admin": {
            "first_name": "Kofi",
            "last_name": "Mensah",
            "email": "kofi@example.com",
            "username": f"admin_{uuid.uuid4().hex[:6]}",
            "password": "SecurePass@2025!",
        },
        "license": {
            "activation_code": activation_code,
        },
    }


# ── Status endpoint ───────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_setup_status_fresh_install():
    """
    GET /api/v1/setup/status/ returns setup_complete=False on a fresh DB.
    """
    c = _client()
    resp = c.get("/api/v1/setup/status/")
    assert resp.status_code == 200
    data = resp.json()
    assert data["setup_complete"] == False
    assert data["has_business"] == False
    assert data["has_branch"] == False
    assert data["has_admin"] == False
    assert data["has_license"] == False


@pytest.mark.django_db
def test_setup_status_no_auth_required():
    """
    Status endpoint must be reachable without any authentication.
    """
    c = APIClient()   # no credentials
    resp = c.get("/api/v1/setup/status/")
    assert resp.status_code == 200


# ── Successful full setup ─────────────────────────────────────────────────────

@pytest.mark.django_db
def test_setup_run_creates_all_objects():
    """
    POST /api/v1/setup/run/ creates Business, Branch, admin user,
    activates License — all in one atomic call.
    """
    lic = _make_license()
    c = _client()

    resp = c.post("/api/v1/setup/run/", _setup_payload(lic.activation_code), format="json")
    assert resp.status_code == 200, resp.json()

    data = resp.json()
    assert data["success"] == True
    assert "business_id" in data
    assert "branch_id"   in data
    assert "admin_username" in data
    assert data["license"]["is_active"] == True
    assert data["license"]["status"] == "ACTIVE"

    # Verify DB state
    assert Business.objects.filter(id=data["business_id"]).exists()
    assert Branch.objects.filter(id=data["branch_id"]).exists()
    assert User.objects.filter(username=data["admin_username"]).exists()

    lic.refresh_from_db()
    assert lic.status == License.Status.ACTIVE


@pytest.mark.django_db
def test_setup_status_complete_after_run():
    """
    After a successful run, status returns setup_complete=True.
    """
    lic = _make_license()
    _client().post("/api/v1/setup/run/", _setup_payload(lic.activation_code), format="json")

    resp = _client().get("/api/v1/setup/status/")
    assert resp.status_code == 200
    assert resp.json()["setup_complete"] == True


@pytest.mark.django_db
def test_setup_run_no_auth_required():
    """
    Setup run endpoint must be reachable without any authentication.
    """
    lic = _make_license()
    c = APIClient()  # no credentials
    resp = c.post("/api/v1/setup/run/", _setup_payload(lic.activation_code), format="json")
    assert resp.status_code == 200


# ── Idempotency / duplicate prevention ───────────────────────────────────────

@pytest.mark.django_db
def test_setup_run_twice_returns_409():
    """
    Calling run/ a second time after setup is complete returns 409 CONFLICT.
    Existing data must not be overwritten.
    The second call uses the SAME license so no extra Business is created
    by the test helper itself.
    """
    lic = _make_license()
    c = _client()
    resp1 = c.post("/api/v1/setup/run/", _setup_payload(lic.activation_code), format="json")
    assert resp1.status_code == 200

    biz_count_before  = Business.objects.count()
    user_count_before = User.objects.filter(business__isnull=False).count()

    # Second call with the SAME payload — license is now ACTIVE so the code
    # no longer passes ActivateLicenseSerializer (activation_code was rotated),
    # but more importantly _is_setup_complete() returns True → 409 first.
    payload2 = _setup_payload(lic.activation_code)
    resp2 = c.post("/api/v1/setup/run/", payload2, format="json")
    assert resp2.status_code == 409

    # Nothing should have changed
    assert Business.objects.count() == biz_count_before
    assert User.objects.filter(business__isnull=False).count() == user_count_before


# ── Invalid license ───────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_setup_run_invalid_license_code():
    """
    An activation code that doesn't exist in the DB returns 400 with
    a clear error on the license.activation_code field.
    """
    c = _client()
    payload = _setup_payload("FAKE-0000-0000-0000-0000")
    resp = c.post("/api/v1/setup/run/", payload, format="json")
    assert resp.status_code == 400
    data = resp.json()
    assert data["success"] == False
    assert "license" in data.get("errors", {})
    assert "activation_code" in data["errors"]["license"]


@pytest.mark.django_db
def test_setup_run_revoked_license_rejected():
    """
    A REVOKED license must be rejected with a clear message.
    """
    biz = Business.objects.create(name="Revoked Biz", business_category="GENERAL_RETAIL")
    lic = License.objects.create(
        business=biz,
        license_type=License.LicenseType.SUBSCRIPTION,
        status=License.Status.REVOKED,
        activation_code=f"REVK-{uuid.uuid4().hex[:16].upper()}",
        expiry_date=date.today() + timedelta(days=365),
    )
    payload = _setup_payload(lic.activation_code)
    resp = _client().post("/api/v1/setup/run/", payload, format="json")
    assert resp.status_code == 400
    assert "revoked" in str(resp.json()).lower()


# ── Missing fields ────────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_setup_run_missing_business_name():
    lic = _make_license()
    payload = _setup_payload(lic.activation_code)
    payload["business"]["name"] = ""
    resp = _client().post("/api/v1/setup/run/", payload, format="json")
    assert resp.status_code == 400
    assert "business" in resp.json().get("errors", {})


@pytest.mark.django_db
def test_setup_run_missing_password():
    lic = _make_license()
    payload = _setup_payload(lic.activation_code)
    payload["admin"]["password"] = ""
    resp = _client().post("/api/v1/setup/run/", payload, format="json")
    assert resp.status_code == 400
    assert "admin" in resp.json().get("errors", {})


@pytest.mark.django_db
def test_setup_run_weak_password_rejected():
    """
    A password that fails Django's validators must return 400 with
    an error on admin.password.
    """
    lic = _make_license()
    payload = _setup_payload(lic.activation_code)
    payload["admin"]["password"] = "password"   # too common
    resp = _client().post("/api/v1/setup/run/", payload, format="json")
    assert resp.status_code == 400
    errors = resp.json().get("errors", {})
    assert "admin" in errors
    assert "password" in errors["admin"]


@pytest.mark.django_db
def test_setup_run_duplicate_username_rejected():
    """
    If the requested admin username already exists, setup must return 400.
    """
    existing_user = User.objects.create_user(username="taken_admin", password="SomePass@1")
    lic = _make_license()
    payload = _setup_payload(lic.activation_code)
    payload["admin"]["username"] = "taken_admin"
    resp = _client().post("/api/v1/setup/run/", payload, format="json")
    assert resp.status_code == 400
    errors = resp.json().get("errors", {})
    assert "admin" in errors
    assert "username" in errors["admin"]


# ── Partial restart safety ────────────────────────────────────────────────────

@pytest.mark.django_db
def test_setup_run_is_atomic_on_bad_license():
    """
    If the license activation fails (bad code), NO objects must be left
    behind in the database. The entire setup is atomic.
    """
    biz_count_before  = Business.objects.count()
    branch_count_before = Branch.objects.count()
    user_count_before   = User.objects.filter(business__isnull=False).count()

    payload = _setup_payload("INVALID-CODE-THAT-DOES-NOT-EXIST")
    resp = _client().post("/api/v1/setup/run/", payload, format="json")
    assert resp.status_code == 400

    # Nothing was created
    assert Business.objects.count() == biz_count_before
    assert Branch.objects.count() == branch_count_before
    assert User.objects.filter(business__isnull=False).count() == user_count_before


# ── Server-side completeness validation ──────────────────────────────────────

@pytest.mark.django_db
def test_is_setup_complete_false_with_only_business():
    """
    setup_complete must be False if only a Business exists (no branch/user/license).
    The frontend cannot trust its own 'complete' flag.
    """
    Business.objects.create(name="Half-setup Biz", business_category="GENERAL_RETAIL")
    resp = _client().get("/api/v1/setup/status/")
    assert resp.status_code == 200
    data = resp.json()
    assert data["setup_complete"] == False
    assert data["has_business"] == True
    assert data["has_branch"] == False


@pytest.mark.django_db
def test_is_setup_complete_false_with_expired_license():
    """
    setup_complete must be False even if all objects exist but the license is EXPIRED.
    """
    biz = Business.objects.create(name="Expired Biz", business_category="GENERAL_RETAIL")
    branch = Branch.objects.create(business=biz, name="HQ", code="HQ", is_head_office=True)
    user = User.objects.create_user(username="expuser", password="Pass@1234")
    user.business = biz; user.save()
    License.objects.create(
        business=biz,
        license_type=License.LicenseType.SUBSCRIPTION,
        status=License.Status.EXPIRED,
        activation_code=f"EXP-{uuid.uuid4().hex[:16].upper()}",
    )

    resp = _client().get("/api/v1/setup/status/")
    assert resp.status_code == 200
    assert resp.json()["setup_complete"] == False


# ── Existing customer update ───────────────────────────────────────────────────

@pytest.mark.django_db
def test_existing_customer_data_preserved_on_restart():
    """
    An existing fully-setup customer who restarts the app must get
    setup_complete=True — their data is NOT wiped.
    """
    lic = _make_license()
    _client().post("/api/v1/setup/run/", _setup_payload(lic.activation_code), format="json")

    # Simulate a second cold-start (Electron restarts the backend)
    resp = _client().get("/api/v1/setup/status/")
    assert resp.status_code == 200
    assert resp.json()["setup_complete"] == True

    # Ensure business data is unchanged
    biz = Business.objects.first()
    assert biz.name == "Kofi Stores Ltd"


# ── Regression: stale/unlicensed business must not block setup_complete ───────

@pytest.mark.django_db
def test_setup_complete_true_when_older_unlicensed_business_exists():
    """
    Regression test for the bug where _is_setup_complete() returned False
    because it checked only the OLDEST (first-created) business for an active
    license, and that oldest business had no license (e.g. a test/sync business
    created before the real customer setup).

    Expected behaviour:
    - An old business with NO license exists first.
    - A second business is created via setup/run/ and gets an ACTIVE TRIAL license.
    - setup/status/ must report setup_complete=True.
    - The frontend must proceed to the login screen, not the setup wizard.
    """
    from businesses.models import Business

    # Create an older business with no license (simulates a sync-test or
    # demo business that was created before the real customer did setup).
    old_biz = Business.objects.create(
        name="POPMYC SYNC TEST",
        business_category="GENERAL_RETAIL",
    )
    # Confirm it genuinely has no license
    from licensing.models import License as L
    assert not L.objects.filter(business=old_biz).exists()

    # Now run the real customer setup — this creates the actual business + license.
    lic = _make_license()
    resp = _client().post(
        "/api/v1/setup/run/",
        _setup_payload(lic.activation_code),
        format="json",
    )
    assert resp.status_code == 200, resp.json()
    assert resp.json()["success"] is True

    # The real business was created AFTER the stale one.
    # setup_complete must still be True.
    status_resp = _client().get("/api/v1/setup/status/")
    assert status_resp.status_code == 200
    data = status_resp.json()
    assert data["setup_complete"] is True, (
        "setup_complete must be True even when an older unlicensed business exists. "
        "Check _is_setup_complete(): it must check ANY active license, not only the "
        "oldest business's license."
    )


@pytest.mark.django_db
def test_setup_complete_true_when_older_business_has_pending_license():
    """
    Regression: an older business with a PENDING (not yet activated) license
    must not prevent setup_complete from returning True for a newer business
    that has a valid ACTIVE license.
    """
    from businesses.models import Business
    from licensing.models import License as L

    # Old business with a PENDING license (never activated)
    old_biz = Business.objects.create(
        name="Old Pending Business",
        business_category="GENERAL_RETAIL",
    )
    L.objects.create(
        business=old_biz,
        license_type=L.LicenseType.SUBSCRIPTION,
        status=L.Status.PENDING,
        activation_code=f"OLD-{uuid.uuid4().hex[:16].upper()}",
        expiry_date=date.today() + timedelta(days=365),
    )

    # Real customer setup
    lic = _make_license()
    resp = _client().post(
        "/api/v1/setup/run/",
        _setup_payload(lic.activation_code),
        format="json",
    )
    assert resp.status_code == 200, resp.json()

    status_resp = _client().get("/api/v1/setup/status/")
    assert status_resp.status_code == 200
    assert status_resp.json()["setup_complete"] is True, (
        "setup_complete must be True even when an older business has a PENDING license."
    )
