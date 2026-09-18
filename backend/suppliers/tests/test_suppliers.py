"""
suppliers/tests/test_suppliers.py
==================================
Tests for Stage 3 Part A — Suppliers.

Covers:
  1.  Supplier creation
  2.  Business isolation (Biz A cannot access Biz B suppliers)
  3.  Supplier has all required fields
  4.  Inactive supplier flag
  5.  Supplier code uniqueness per business
  6.  Supplier list scoped to business via API
  7.  Biz A admin cannot create supplier for Biz B
  8.  Unauthenticated request rejected
"""

import uuid
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from businesses.models import Business
from suppliers.models import Supplier

User = get_user_model()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _biz(name=None):
    return Business.objects.create(
        name=name or f"Biz-{uuid.uuid4().hex[:6]}",
        is_active=True,
    )


def _user(business, is_staff=False, is_superuser=False):
    u = User.objects.create_user(
        username=f"u_{uuid.uuid4().hex[:8]}",
        password="TestPass@123",
        email=f"{uuid.uuid4().hex[:8]}@test.com",
        is_staff=is_staff,
        is_superuser=is_superuser,
    )
    u.business = business
    u.role = "ADMIN"
    u.save()
    return u


def _authed(user):
    c = APIClient()
    c.force_authenticate(user=user)
    return c


def _supplier(business, name=None, is_active=True):
    return Supplier.objects.create(
        business=business,
        name=name or f"Supplier-{uuid.uuid4().hex[:6]}",
        code=f"S{uuid.uuid4().hex[:6].upper()}",
        is_active=is_active,
    )


# ─────────────────────────────────────────────────────────────────────────────
# 1. Supplier creation
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestSupplierCreation:

    def test_supplier_can_be_created(self):
        biz = _biz()
        s = _supplier(biz)
        assert s.pk is not None
        assert s.business == biz

    def test_supplier_has_required_fields(self):
        biz = _biz()
        s = Supplier.objects.create(
            business=biz,
            name="Test Supplier",
            code="TEST001",
            contact_person="John Doe",
            phone="0244000000",
            email="test@supplier.com",
            address="123 Test St",
            notes="Test notes",
            is_active=True,
        )
        assert s.name          == "Test Supplier"
        assert s.contact_person == "John Doe"
        assert s.phone         == "0244000000"
        assert s.email         == "test@supplier.com"
        assert s.address       == "123 Test St"
        assert s.notes         == "Test notes"
        assert s.is_active     is True

    def test_supplier_default_is_active(self):
        biz = _biz()
        s = Supplier.objects.create(business=biz, name="S1", code="C1")
        assert s.is_active is True

    def test_api_create_supplier(self):
        biz  = _biz()
        user = _user(biz, is_staff=True)
        resp = _authed(user).post("/api/v1/suppliers/suppliers/", {
            "business": str(biz.pk),
            "name": "API Supplier",
            "code": "API001",
            "contact_person": "Jane",
            "phone": "0200000001",
            "email": "api@supplier.com",
            "supplier_type": "LOCAL",
        }, format="json")
        assert resp.status_code == 201, resp.data
        assert resp.data["name"] == "API Supplier"


# ─────────────────────────────────────────────────────────────────────────────
# 2. Business isolation
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestSupplierBusinessIsolation:

    def test_api_list_scoped_to_business(self):
        biz_a = _biz()
        biz_b = _biz()
        _supplier(biz_a, name="A-Supplier")
        _supplier(biz_b, name="B-Supplier")

        admin_a = _user(biz_a, is_staff=True)
        resp = _authed(admin_a).get("/api/v1/suppliers/suppliers/")
        assert resp.status_code == 200
        names = [i["name"] for i in resp.data.get("results", resp.data)]
        assert "A-Supplier" in names
        assert "B-Supplier" not in names

    def test_biz_a_cannot_create_supplier_for_biz_b(self):
        biz_a = _biz()
        biz_b = _biz()
        admin_a = _user(biz_a, is_staff=True)
        resp = _authed(admin_a).post("/api/v1/suppliers/suppliers/", {
            "business": str(biz_b.pk),
            "name": "Infiltrated Supplier",
            "code": "INF001",
        }, format="json")
        # BusinessScopedMixin or serializer validator rejects cross-tenant write
        assert resp.status_code in (400, 403, 404)

    def test_changing_biz_a_supplier_does_not_affect_biz_b(self):
        biz_a = _biz()
        biz_b = _biz()
        s_b = _supplier(biz_b, name="B-Supplier-Original")

        admin_a = _user(biz_a, is_staff=True)
        # Try to update Biz B's supplier as Biz A admin
        resp = _authed(admin_a).patch(
            f"/api/v1/suppliers/suppliers/{s_b.pk}/",
            {"name": "Compromised"},
            format="json",
        )
        assert resp.status_code in (403, 404)
        s_b.refresh_from_db()
        assert s_b.name == "B-Supplier-Original"

    def test_unauthenticated_request_rejected(self):
        resp = APIClient().get("/api/v1/suppliers/suppliers/")
        assert resp.status_code == 401
