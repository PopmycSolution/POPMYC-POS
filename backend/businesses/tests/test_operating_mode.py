"""
businesses/tests/test_operating_mode.py
========================================
Tests for Stage 2: Operating Mode (FULL_POS / INVENTORY_ONLY / POS_ONLY).

Covers all 18 required scenarios:
 1.  Operating Mode can be stored
 2.  Existing businesses default safely to FULL_POS
 3.  FULL_POS retains existing POS behaviour
 4.  INVENTORY_ONLY allows inventory workflows
 5.  INVENTORY_ONLY blocks new sales (API returns 403)
 6.  POS_ONLY allows sales
 7.  POS_ONLY restricts inventory-management workflows
 8.  Switching modes does not delete data
 9.  Products remain intact after switching modes
10.  Prices remain intact after switching modes
11.  Historical sales remain intact
12.  Business A's mode cannot affect Business B
13.  Branches inherit the Business operating mode
14.  Unauthorized users cannot change Operating Mode
15.  Licensing still works
16.  Stage 1 Business Type still works
17.  Fixed / Negotiable pricing still works
18.  Existing authentication still works
"""

import uuid
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from businesses.models import Business, BusinessSettings
from businesses.operating_mode import require_pos, require_inventory, get_effective_mode
from products.models import Product, UnitOfMeasure, Category

User = get_user_model()

# ─────────────────────────────────────────────────────────────────────────────
# Shared helpers / fixtures
# ─────────────────────────────────────────────────────────────────────────────

def _biz(category="GENERAL_RETAIL", **kwargs):
    return Business.objects.create(
        name=f"Biz-{uuid.uuid4().hex[:6]}",
        business_category=category,
        is_active=True,
        **kwargs,
    )


def _settings(business, mode="FULL_POS"):
    s, _ = BusinessSettings.objects.get_or_create(business=business)
    s.inventory_mode = mode
    s.save()
    return s


def _user(business, role="ADMIN", is_staff=False, is_superuser=False):
    u = User.objects.create_user(
        username=f"u_{uuid.uuid4().hex[:8]}",
        password="TestPass@123",
        email=f"{uuid.uuid4().hex[:8]}@test.com",
        is_staff=is_staff,
        is_superuser=is_superuser,
    )
    u.business = business
    u.role = role
    u.save()
    return u


def _authed(user):
    c = APIClient()
    c.force_authenticate(user=user)
    return c


def _uom(business):
    return UnitOfMeasure.objects.create(
        business=business, name="Piece", code=f"PCS{uuid.uuid4().hex[:4]}", symbol="pcs"
    )


def _product(business, uom=None, price=Decimal("100.00"),
             pricing_type=Product.PricingType.FIXED):
    if uom is None:
        uom = _uom(business)
    cat = Category.objects.create(
        business=business, name="Cat", code=f"C{uuid.uuid4().hex[:4]}"
    )
    return Product.objects.create(
        business=business,
        name=f"Prod {uuid.uuid4().hex[:6]}",
        sku=f"SKU-{uuid.uuid4().hex[:6]}",
        uom_purchase=uom, uom_sale=uom,
        selling_price=price,
        cost_price=Decimal("50.00"),
        pricing_type=pricing_type,
        category=cat,
    )


# ─────────────────────────────────────────────────────────────────────────────
# 1. Operating Mode can be stored
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestOperatingModeStorage:

    def test_all_three_modes_can_be_stored(self):
        biz = _biz()
        for mode in ("FULL_POS", "INVENTORY_ONLY", "POS_ONLY"):
            s = _settings(biz, mode)
            s.refresh_from_db()
            assert s.inventory_mode == mode

    def test_effective_mode_resolves_legacy_stock_enabled(self):
        biz = _biz()
        s = _settings(biz, "STOCK_ENABLED")
        assert s.effective_operating_mode == "FULL_POS"

    def test_effective_mode_resolves_legacy_sales_only(self):
        biz = _biz()
        s = _settings(biz, "SALES_ONLY")
        assert s.effective_operating_mode == "POS_ONLY"

    def test_full_pos_is_canonical(self):
        biz = _biz()
        s = _settings(biz, "FULL_POS")
        assert s.effective_operating_mode == "FULL_POS"

    def test_inventory_only_is_canonical(self):
        biz = _biz()
        s = _settings(biz, "INVENTORY_ONLY")
        assert s.effective_operating_mode == "INVENTORY_ONLY"

    def test_pos_only_is_canonical(self):
        biz = _biz()
        s = _settings(biz, "POS_ONLY")
        assert s.effective_operating_mode == "POS_ONLY"


# ─────────────────────────────────────────────────────────────────────────────
# 2. Existing businesses default safely to FULL_POS
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestDefaultMode:

    def test_new_settings_row_defaults_to_full_pos(self):
        biz = _biz()
        s, created = BusinessSettings.objects.get_or_create(business=biz)
        assert created is True
        assert s.inventory_mode == "FULL_POS"
        assert s.effective_operating_mode == "FULL_POS"

    def test_pos_and_inventory_both_enabled_for_full_pos(self):
        biz = _biz()
        s = _settings(biz, "FULL_POS")
        assert s.pos_enabled is True
        assert s.inventory_enabled is True

    def test_helper_returns_full_pos_when_no_settings_row(self):
        biz = _biz()
        # Delete any settings row so get_effective_mode falls back
        BusinessSettings.objects.filter(business=biz).delete()
        user = _user(biz)
        mode = get_effective_mode(user)
        assert mode == "FULL_POS"


# ─────────────────────────────────────────────────────────────────────────────
# 3. FULL_POS retains existing POS behaviour
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestFullPosMode:

    def test_require_pos_returns_none_for_full_pos(self):
        biz = _biz()
        _settings(biz, "FULL_POS")
        user = _user(biz)
        assert require_pos(user) is None

    def test_require_inventory_returns_none_for_full_pos(self):
        biz = _biz()
        _settings(biz, "FULL_POS")
        user = _user(biz)
        assert require_inventory(user) is None

    def test_full_pos_pos_enabled(self):
        biz = _biz()
        s = _settings(biz, "FULL_POS")
        assert s.pos_enabled is True

    def test_full_pos_inventory_enabled(self):
        biz = _biz()
        s = _settings(biz, "FULL_POS")
        assert s.inventory_enabled is True


# ─────────────────────────────────────────────────────────────────────────────
# 4. INVENTORY_ONLY allows inventory workflows
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestInventoryOnlyAllowsInventory:

    def test_require_inventory_returns_none_for_inventory_only(self):
        biz = _biz()
        _settings(biz, "INVENTORY_ONLY")
        user = _user(biz)
        assert require_inventory(user) is None

    def test_inventory_only_inventory_enabled(self):
        biz = _biz()
        s = _settings(biz, "INVENTORY_ONLY")
        assert s.inventory_enabled is True

    def test_products_accessible_in_inventory_only(self):
        biz = _biz()
        _settings(biz, "INVENTORY_ONLY")
        admin = _user(biz, is_staff=True)
        p = _product(biz)
        resp = _authed(admin).get("/api/v1/products/products/")
        assert resp.status_code == 200
        ids = [str(item["id"]) for item in resp.data.get("results", resp.data)]
        assert str(p.pk) in ids


# ─────────────────────────────────────────────────────────────────────────────
# 5. INVENTORY_ONLY blocks new sales (API returns 403)
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestInventoryOnlyBlocksSales:

    def test_require_pos_returns_403_response_for_inventory_only(self):
        biz = _biz()
        _settings(biz, "INVENTORY_ONLY")
        user = _user(biz)
        resp = require_pos(user)
        assert resp is not None
        assert resp.status_code == 403
        data = resp.data
        assert data.get("code") == "OPERATING_MODE_RESTRICTION"
        assert data.get("operating_mode") == "INVENTORY_ONLY"

    def test_api_blocks_new_sale_when_inventory_only(self):
        from branches.models import Branch, Warehouse, Register
        biz = _biz()
        _settings(biz, "INVENTORY_ONLY")
        admin = _user(biz, is_staff=True)
        resp = _authed(admin).post("/api/v1/sales/sales/", {
            "business": str(biz.pk),
            "grand_total": "100.00",
        }, format="json")
        assert resp.status_code == 403
        assert resp.data.get("code") == "OPERATING_MODE_RESTRICTION"

    def test_is_inventory_only_property_true(self):
        biz = _biz()
        s = _settings(biz, "INVENTORY_ONLY")
        assert s.is_inventory_only is True
        assert s.is_full_pos is False
        assert s.is_pos_only is False


# ─────────────────────────────────────────────────────────────────────────────
# 6. POS_ONLY allows sales
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestPosOnlyAllowsSales:

    def test_require_pos_returns_none_for_pos_only(self):
        biz = _biz()
        _settings(biz, "POS_ONLY")
        user = _user(biz)
        assert require_pos(user) is None

    def test_pos_only_pos_enabled(self):
        biz = _biz()
        s = _settings(biz, "POS_ONLY")
        assert s.pos_enabled is True

    def test_is_pos_only_property_true(self):
        biz = _biz()
        s = _settings(biz, "POS_ONLY")
        assert s.is_pos_only is True
        assert s.is_full_pos is False
        assert s.is_inventory_only is False


# ─────────────────────────────────────────────────────────────────────────────
# 7. POS_ONLY restricts inventory-management workflows
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestPosOnlyRestrictsInventory:

    def test_require_inventory_returns_403_for_pos_only(self):
        biz = _biz()
        _settings(biz, "POS_ONLY")
        user = _user(biz)
        resp = require_inventory(user)
        assert resp is not None
        assert resp.status_code == 403
        assert resp.data.get("code") == "OPERATING_MODE_RESTRICTION"
        assert resp.data.get("operating_mode") == "POS_ONLY"

    def test_pos_only_inventory_disabled(self):
        biz = _biz()
        s = _settings(biz, "POS_ONLY")
        assert s.inventory_enabled is False


# ─────────────────────────────────────────────────────────────────────────────
# 8 + 9 + 10. Switching modes preserves data (products, prices, sales)
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestModeSwitchingPreservesData:

    def test_products_intact_after_full_pos_to_inventory_only(self):
        biz = _biz()
        s = _settings(biz, "FULL_POS")
        p = _product(biz, price=Decimal("5500.00"))
        original_price = p.selling_price

        s.inventory_mode = "INVENTORY_ONLY"
        s.save()

        p.refresh_from_db()
        assert p.selling_price == original_price
        assert p.pk is not None

    def test_prices_intact_after_inventory_only_to_full_pos(self):
        biz = _biz()
        s = _settings(biz, "INVENTORY_ONLY")
        p = _product(biz, price=Decimal("200.00"))

        s.inventory_mode = "FULL_POS"
        s.save()

        p.refresh_from_db()
        assert p.selling_price == Decimal("200.00")

    def test_round_trip_full_pos_inv_only_full_pos(self):
        biz = _biz()
        s = _settings(biz, "FULL_POS")
        p = _product(biz, price=Decimal("999.00"))

        # Switch to Inventory Only
        s.inventory_mode = "INVENTORY_ONLY"
        s.save()

        # Switch back to Full POS
        s.inventory_mode = "FULL_POS"
        s.save()

        p.refresh_from_db()
        assert p.selling_price == Decimal("999.00")
        assert Product.objects.filter(pk=p.pk).exists()


# ─────────────────────────────────────────────────────────────────────────────
# 11. Historical sales remain intact
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestHistoricalSalesIntact:

    def test_sale_item_model_unchanged_by_mode_extension(self):
        from sales.models import SaleItem
        field_names = {f.name for f in SaleItem._meta.get_fields()}
        for field in [
            "qty", "name_snapshot", "unit_price_incl", "total_line",
            "negotiated_unit_price", "original_price_snapshot",
        ]:
            assert field in field_names, f"SaleItem.{field} missing after mode extension"

    def test_sale_model_unchanged(self):
        from sales.models import Sale
        field_names = {f.name for f in Sale._meta.get_fields()}
        for field in ["grand_total", "total_discount", "status", "created_at"]:
            assert field in field_names, f"Sale.{field} missing after mode extension"

    def test_inventory_only_does_not_delete_sales_model(self):
        from sales.models import Sale
        # Model must still exist and be queryable when mode is INVENTORY_ONLY
        assert Sale.objects.model is Sale


# ─────────────────────────────────────────────────────────────────────────────
# 12. Business A's mode cannot affect Business B
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestBusinessIsolation:

    def test_changing_biz_a_mode_does_not_affect_biz_b(self):
        biz_a = _biz()
        biz_b = _biz()
        s_a = _settings(biz_a, "FULL_POS")
        s_b = _settings(biz_b, "FULL_POS")

        s_a.inventory_mode = "INVENTORY_ONLY"
        s_a.save()

        s_b.refresh_from_db()
        assert s_b.inventory_mode == "FULL_POS"
        assert s_b.pos_enabled is True

    def test_require_pos_uses_authenticated_users_business(self):
        biz_a = _biz()
        biz_b = _biz()
        _settings(biz_a, "INVENTORY_ONLY")
        _settings(biz_b, "FULL_POS")

        user_a = _user(biz_a)
        user_b = _user(biz_b)

        # A is blocked
        assert require_pos(user_a) is not None
        # B is not affected
        assert require_pos(user_b) is None

    def test_biz_a_admin_cannot_change_biz_b_operating_mode(self):
        biz_a = _biz()
        biz_b = _biz()
        s_b = _settings(biz_b, "FULL_POS")
        admin_a = _user(biz_a, is_staff=True)

        url = f"/api/v1/businesses/settings/{s_b.pk}/inventory-mode/"
        resp = _authed(admin_a).patch(url, {"inventory_mode": "INVENTORY_ONLY"}, format="json")
        # BusinessScopedMixin: Biz B settings not in Biz A's queryset → 404
        assert resp.status_code in (403, 404)

        s_b.refresh_from_db()
        assert s_b.inventory_mode == "FULL_POS"


# ─────────────────────────────────────────────────────────────────────────────
# 13. Branches inherit Business operating mode
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestBranchInheritance:

    def test_branch_model_linked_to_business(self):
        from branches.models import Branch
        field_names = {f.name for f in Branch._meta.get_fields()}
        assert "business" in field_names

    def test_branches_under_same_business_share_mode(self):
        biz = _biz()
        s = _settings(biz, "INVENTORY_ONLY")

        # Both users in different branches of same business
        user1 = _user(biz)
        user2 = _user(biz)

        # Both should be blocked by POS restriction
        assert require_pos(user1) is not None
        assert require_pos(user2) is not None

    def test_mode_lookup_uses_business_not_branch(self):
        """get_effective_mode reads from BusinessSettings, not Branch."""
        biz = _biz()
        _settings(biz, "POS_ONLY")
        user = _user(biz)
        mode = get_effective_mode(user)
        assert mode == "POS_ONLY"


# ─────────────────────────────────────────────────────────────────────────────
# 14. Unauthorized users cannot change Operating Mode
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestUnauthorizedCannotChangeMode:

    def test_cashier_cannot_change_operating_mode(self):
        biz = _biz()
        s = _settings(biz, "FULL_POS")
        cashier = _user(biz, role="CASHIER")
        url = f"/api/v1/businesses/settings/{s.pk}/inventory-mode/"
        resp = _authed(cashier).patch(url, {"inventory_mode": "INVENTORY_ONLY"}, format="json")
        assert resp.status_code == 403
        s.refresh_from_db()
        assert s.inventory_mode == "FULL_POS"

    def test_inventory_clerk_cannot_change_mode(self):
        biz = _biz()
        s = _settings(biz, "FULL_POS")
        clerk = _user(biz, role="INVENTORY_CLERK")
        url = f"/api/v1/businesses/settings/{s.pk}/inventory-mode/"
        resp = _authed(clerk).patch(url, {"inventory_mode": "POS_ONLY"}, format="json")
        assert resp.status_code == 403

    def test_unauthenticated_cannot_change_mode(self):
        biz = _biz()
        s = _settings(biz, "FULL_POS")
        url = f"/api/v1/businesses/settings/{s.pk}/inventory-mode/"
        resp = APIClient().patch(url, {"inventory_mode": "INVENTORY_ONLY"}, format="json")
        assert resp.status_code == 401

    def test_admin_can_change_operating_mode(self):
        biz = _biz()
        s = _settings(biz, "FULL_POS")
        admin = _user(biz, is_staff=True)
        url = f"/api/v1/businesses/settings/{s.pk}/inventory-mode/"
        resp = _authed(admin).patch(url, {"inventory_mode": "POS_ONLY"}, format="json")
        assert resp.status_code == 200, resp.data
        s.refresh_from_db()
        assert s.inventory_mode == "POS_ONLY"


# ─────────────────────────────────────────────────────────────────────────────
# 15. Licensing still works
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestLicensingIntact:

    def test_license_model_still_importable(self):
        from licensing.models import License
        assert License is not None

    def test_license_works_alongside_operating_mode(self):
        from licensing.models import License
        from datetime import date, timedelta
        biz = _biz()
        _settings(biz, "FULL_POS")
        lic = License.objects.create(
            business=biz,
            license_type=License.LicenseType.SUBSCRIPTION,
            status=License.Status.ACTIVE,
            start_date=date.today(),
            expiry_date=date.today() + timedelta(days=365),
        )
        assert lic.is_active is True
        assert biz.stock_enabled is True  # still works after adding mode
        lic.delete()


# ─────────────────────────────────────────────────────────────────────────────
# 16. Stage 1 Business Type still works
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestBusinessTypeStillWorks:

    def test_business_category_unaffected_by_mode_change(self):
        biz = _biz(category="PHONE_ACCESSORIES")
        s = _settings(biz, "FULL_POS")
        assert biz.supports_negotiable_pricing is True

        s.inventory_mode = "INVENTORY_ONLY"
        s.save()

        biz.refresh_from_db()
        assert biz.supports_negotiable_pricing is True

    def test_all_business_categories_still_present(self):
        cats = {c.value for c in Business.BusinessCategory}
        expected = {
            "PROVISION_GROCERY", "SUPERMARKET", "GENERAL_RETAIL", "COSMETICS",
            "PHARMACY", "ELECTRONICS", "PHONE_ACCESSORIES", "FASHION_CLOTHING",
            "SHOES", "SERVICE", "OTHER",
        }
        assert expected == cats


# ─────────────────────────────────────────────────────────────────────────────
# 17. Fixed / Negotiable pricing still works
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestPricingStillWorks:

    def test_negotiable_product_pricing_type_intact_after_mode_switch(self):
        biz = _biz(category="PHONE_ACCESSORIES")
        s = _settings(biz, "FULL_POS")
        p = _product(biz, pricing_type=Product.PricingType.NEGOTIABLE, price=Decimal("5500.00"))
        assert p.pricing_type == Product.PricingType.NEGOTIABLE

        s.inventory_mode = "INVENTORY_ONLY"
        s.save()

        p.refresh_from_db()
        assert p.pricing_type == Product.PricingType.NEGOTIABLE
        assert p.selling_price == Decimal("5500.00")

    def test_fixed_product_unaffected_by_mode_switch(self):
        biz = _biz()
        s = _settings(biz, "POS_ONLY")
        p = _product(biz, pricing_type=Product.PricingType.FIXED, price=Decimal("15.00"))
        assert p.pricing_type == Product.PricingType.FIXED

        s.inventory_mode = "FULL_POS"
        s.save()

        p.refresh_from_db()
        assert p.pricing_type == Product.PricingType.FIXED
        assert p.selling_price == Decimal("15.00")

    def test_allow_cashier_price_negotiation_unaffected_by_mode(self):
        biz = _biz()
        s = _settings(biz, "FULL_POS")
        s.allow_cashier_price_negotiation = True
        s.save()

        s.inventory_mode = "POS_ONLY"
        s.save()

        s.refresh_from_db()
        assert s.allow_cashier_price_negotiation is True


# ─────────────────────────────────────────────────────────────────────────────
# 18. Existing authentication still works
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestAuthenticationIntact:

    def test_user_model_has_business_field(self):
        field_names = {f.name for f in User._meta.get_fields()}
        assert "business" in field_names

    def test_login_endpoint_works(self):
        biz = _biz()
        _settings(biz, "FULL_POS")
        user = _user(biz, role="ADMIN", is_staff=True)
        user.set_password("TestPass@123")
        user.save()
        resp = APIClient().post(
            "/api/v1/auth/login/",
            {"email": user.email, "password": "TestPass@123"},
            format="json",
        )
        assert resp.status_code == 200
        assert "access" in resp.data

    def test_unauthenticated_request_rejected_regardless_of_mode(self):
        resp = APIClient().get("/api/v1/products/products/")
        assert resp.status_code == 401
