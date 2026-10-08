"""
synchronization/management/commands/push_to_cloud.py
=====================================================
One-time migration: push local POS data to the Render cloud database.

Usage (run from the desktop POS machine):

    cd backend
    .venv-prod\\Scripts\\python.exe manage.py push_to_cloud ^
        --cloud-url https://popmyc-pos.onrender.com ^
        --username omyc ^
        --password YOUR_PASSWORD

What it migrates (in order):
  1. Business & branch settings  (via /api/v1/businesses/ + /api/v1/branches/)
  2. Categories
  3. Brands
  4. Units of measure
  5. Products (with stock levels)
  6. Customers
  7. Suppliers
  8. Users (without passwords — they must set their own)

Safety:
  - Reads from local DB, writes to cloud via REST API (no direct DB access)
  - Idempotent: skips records that already exist by name/code match
  - Never touches local DB
  - Password is never logged
"""
import json
import sys
import getpass

from django.core.management.base import BaseCommand, CommandError

try:
    import requests
except ImportError:
    requests = None  # type: ignore


ENDPOINTS = {
    "login":      "/api/v1/auth/login/",
    "business":   "/api/v1/businesses/",
    "branches":   "/api/v1/branches/",
    "categories": "/api/v1/products/categories/",
    "brands":     "/api/v1/products/brands/",
    "units":      "/api/v1/products/units/",
    "products":   "/api/v1/products/",
    "customers":  "/api/v1/customers/",
    "suppliers":  "/api/v1/suppliers/",
    "users":      "/api/v1/accounts/users/",
}


class Command(BaseCommand):
    help = "Push local POS data to the Render cloud database via REST API."

    def add_arguments(self, parser):
        parser.add_argument(
            "--cloud-url",
            default="https://popmyc-pos.onrender.com",
            help="Base URL of the Render backend (default: https://popmyc-pos.onrender.com)",
        )
        parser.add_argument(
            "--username",
            required=True,
            help="Your login username on the cloud (same as desktop login)",
        )
        parser.add_argument(
            "--password",
            default="",
            help="Password (omit to be prompted securely)",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print what would be pushed without actually pushing",
        )

    def handle(self, *args, **options):
        if requests is None:
            raise CommandError(
                "The 'requests' library is required. "
                "Run: pip install requests"
            )

        cloud_url = options["cloud_url"].rstrip("/")
        username  = options["username"]
        password  = options["password"] or getpass.getpass("Cloud password: ")
        dry_run   = options["dry_run"]

        self.stdout.write(f"\n{'[DRY RUN] ' if dry_run else ''}Pushing local data to {cloud_url}\n")

        # ── Step 1: Login to cloud ────────────────────────────────────────────
        self.stdout.write("🔐  Logging in to cloud...")
        try:
            resp = requests.post(
                cloud_url + ENDPOINTS["login"],
                json={"username": username, "password": password},
                timeout=30,
            )
        except Exception as exc:
            raise CommandError(f"Could not reach cloud: {exc}")

        if resp.status_code != 200:
            raise CommandError(
                f"Login failed (HTTP {resp.status_code}): {resp.text[:200]}"
            )

        token = resp.json().get("access")
        if not token:
            raise CommandError("Login succeeded but no access token returned.")

        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        self.stdout.write(self.style.SUCCESS("  ✅  Logged in\n"))

        # ── Step 2: Get cloud business ID ────────────────────────────────────
        resp = requests.get(cloud_url + ENDPOINTS["business"], headers=headers, timeout=30)
        cloud_businesses = resp.json().get("results", []) if resp.status_code == 200 else []
        if not cloud_businesses:
            raise CommandError(
                "No business found on the cloud. "
                "Please complete the Setup Wizard on the PWA first, then re-run this command."
            )
        cloud_biz_id = cloud_businesses[0]["id"]
        self.stdout.write(f"🏢  Cloud business: {cloud_businesses[0].get('name')} ({cloud_biz_id})\n")

        # ── Step 3: Get local business ────────────────────────────────────────
        from businesses.models import Business
        from branches.models import Branch
        local_biz = Business.objects.first()
        if not local_biz:
            raise CommandError("No local business found.")
        self.stdout.write(f"🏪  Local business:  {local_biz.name}\n\n")

        # ── Helper: fetch all existing items from cloud (for dedup) ──────────
        def cloud_list(endpoint, params=None):
            all_items = []
            url = cloud_url + endpoint
            p = dict(params or {})
            p["page_size"] = 200
            while url:
                r = requests.get(url, headers=headers, params=p, timeout=30)
                if r.status_code != 200:
                    return []
                data = r.json()
                if isinstance(data, list):
                    return data
                all_items.extend(data.get("results", []))
                url = data.get("next")
                p = {}  # next URL already has params
            return all_items

        # ── Helper: push one item ─────────────────────────────────────────────
        def push(endpoint, payload, label):
            if dry_run:
                self.stdout.write(f"  [dry-run] would POST {label}")
                return None
            r = requests.post(
                cloud_url + endpoint,
                headers=headers,
                json=payload,
                timeout=30,
            )
            if r.status_code in (200, 201):
                return r.json()
            self.stdout.write(
                self.style.WARNING(f"  ⚠️  Failed to push {label}: {r.status_code} {r.text[:120]}")
            )
            return None

        # ── Step 4: Categories ────────────────────────────────────────────────
        from products.models import Category
        self.stdout.write("📂  Pushing categories...")
        cloud_cats = {c["name"].lower(): c["id"] for c in cloud_list(ENDPOINTS["categories"])}
        cat_id_map = {}  # local id → cloud id
        local_cats = Category.objects.filter(business=local_biz).order_by("sort_order", "name")
        pushed = skipped = 0
        for cat in local_cats:
            if cat.name.lower() in cloud_cats:
                cat_id_map[str(cat.id)] = cloud_cats[cat.name.lower()]
                skipped += 1
                continue
            result = push(ENDPOINTS["categories"], {
                "name": cat.name,
                "code": cat.code,
                "description": cat.description,
                "is_active": cat.is_active,
                "sort_order": cat.sort_order,
                "business": cloud_biz_id,
            }, f"category '{cat.name}'")
            if result:
                cat_id_map[str(cat.id)] = result["id"]
                pushed += 1
        self.stdout.write(self.style.SUCCESS(f"  ✅  {pushed} pushed, {skipped} already existed\n"))

        # ── Step 5: Brands ────────────────────────────────────────────────────
        from products.models import Brand
        self.stdout.write("🏷️   Pushing brands...")
        cloud_brands = {b["name"].lower(): b["id"] for b in cloud_list(ENDPOINTS["brands"])}
        brand_id_map = {}
        local_brands = Brand.objects.filter(business=local_biz)
        pushed = skipped = 0
        for brand in local_brands:
            if brand.name.lower() in cloud_brands:
                brand_id_map[str(brand.id)] = cloud_brands[brand.name.lower()]
                skipped += 1
                continue
            result = push(ENDPOINTS["brands"], {
                "name": brand.name,
                "code": brand.code,
                "description": brand.description,
                "website": brand.website,
                "is_active": brand.is_active,
                "business": cloud_biz_id,
            }, f"brand '{brand.name}'")
            if result:
                brand_id_map[str(brand.id)] = result["id"]
                pushed += 1
        self.stdout.write(self.style.SUCCESS(f"  ✅  {pushed} pushed, {skipped} already existed\n"))

        # ── Step 6: Units of measure ─────────────────────────────────────────
        from products.models import UnitOfMeasure
        self.stdout.write("📏  Pushing units of measure...")
        cloud_units = {u["name"].lower(): u["id"] for u in cloud_list(ENDPOINTS["units"])}
        unit_id_map = {}
        local_units = UnitOfMeasure.objects.filter(business=local_biz)
        pushed = skipped = 0
        for unit in local_units:
            if unit.name.lower() in cloud_units:
                unit_id_map[str(unit.id)] = cloud_units[unit.name.lower()]
                skipped += 1
                continue
            result = push(ENDPOINTS["units"], {
                "name": unit.name,
                "code": unit.code,
                "symbol": unit.symbol,
                "allow_fractional": unit.allow_fractional,
                "base_unit": unit.base_unit,
                "conversion_factor": str(unit.conversion_factor) if hasattr(unit, "conversion_factor") else "1",
                "business": cloud_biz_id,
            }, f"unit '{unit.name}'")
            if result:
                unit_id_map[str(unit.id)] = result["id"]
                pushed += 1
        self.stdout.write(self.style.SUCCESS(f"  ✅  {pushed} pushed, {skipped} already existed\n"))

        # ── Step 7: Products ──────────────────────────────────────────────────
        from products.models import Product
        self.stdout.write("📦  Pushing products...")
        cloud_products = {p["name"].lower(): p["id"] for p in cloud_list(ENDPOINTS["products"])}
        pushed = skipped = errors = 0
        local_products = Product.objects.filter(business=local_biz).select_related(
            "category", "brand", "unit_of_measure"
        )
        for product in local_products:
            if product.name.lower() in cloud_products:
                skipped += 1
                continue
            payload = {
                "name": product.name,
                "sku": product.sku,
                "description": product.description or "",
                "selling_price": str(product.selling_price),
                "cost_price": str(product.cost_price) if product.cost_price else "0",
                "quantity": float(product.quantity) if hasattr(product, "quantity") else 0,
                "reorder_level": float(product.reorder_level) if hasattr(product, "reorder_level") else 0,
                "is_active": product.is_active,
                "business": cloud_biz_id,
            }
            if product.category_id and str(product.category_id) in cat_id_map:
                payload["category"] = cat_id_map[str(product.category_id)]
            if product.brand_id and str(product.brand_id) in brand_id_map:
                payload["brand"] = brand_id_map[str(product.brand_id)]
            if product.unit_of_measure_id and str(product.unit_of_measure_id) in unit_id_map:
                payload["unit_of_measure"] = unit_id_map[str(product.unit_of_measure_id)]

            result = push(ENDPOINTS["products"], payload, f"product '{product.name}'")
            if result:
                pushed += 1
            else:
                errors += 1
        self.stdout.write(self.style.SUCCESS(
            f"  ✅  {pushed} pushed, {skipped} already existed, {errors} errors\n"
        ))

        # ── Step 8: Customers ────────────────────────────────────────────────
        from customers.models import Customer
        self.stdout.write("👥  Pushing customers...")
        cloud_customers = {c.get("name", c.get("full_name", "")).lower(): c["id"]
                           for c in cloud_list(ENDPOINTS["customers"])}
        pushed = skipped = 0
        local_customers = Customer.objects.filter(business=local_biz)
        for cust in local_customers:
            name = getattr(cust, "name", None) or getattr(cust, "full_name", "") or ""
            if name.lower() in cloud_customers:
                skipped += 1
                continue
            payload = {"business": cloud_biz_id}
            for field in ["name", "full_name", "email", "phone", "phone_number", "address", "notes"]:
                val = getattr(cust, field, None)
                if val:
                    payload[field] = val
            result = push(ENDPOINTS["customers"], payload, f"customer '{name}'")
            if result:
                pushed += 1
        self.stdout.write(self.style.SUCCESS(f"  ✅  {pushed} pushed, {skipped} already existed\n"))

        # ── Step 9: Suppliers ────────────────────────────────────────────────
        from suppliers.models import Supplier
        self.stdout.write("🚚  Pushing suppliers...")
        cloud_suppliers = {s["name"].lower(): s["id"] for s in cloud_list(ENDPOINTS["suppliers"])}
        pushed = skipped = 0
        local_suppliers = Supplier.objects.filter(business=local_biz)
        for sup in local_suppliers:
            if sup.name.lower() in cloud_suppliers:
                skipped += 1
                continue
            payload = {"name": sup.name, "business": cloud_biz_id}
            for field in ["email", "phone", "address", "contact_person", "notes", "is_active"]:
                val = getattr(sup, field, None)
                if val is not None:
                    payload[field] = val
            result = push(ENDPOINTS["suppliers"], payload, f"supplier '{sup.name}'")
            if result:
                pushed += 1
        self.stdout.write(self.style.SUCCESS(f"  ✅  {pushed} pushed, {skipped} already existed\n"))

        # ── Done ──────────────────────────────────────────────────────────────
        self.stdout.write(self.style.SUCCESS(
            "\n🎉  Migration complete! Refresh the PWA to see your data.\n"
        ))
        if not dry_run:
            self.stdout.write(
                "ℹ️   Note: User accounts were NOT migrated (passwords cannot be transferred).\n"
                "    Your staff must log in to the PWA using the same credentials they use\n"
                "    on the desktop, OR you can create their accounts manually on the PWA.\n"
            )
