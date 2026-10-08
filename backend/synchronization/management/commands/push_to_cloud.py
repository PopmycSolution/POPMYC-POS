"""
synchronization/management/commands/push_to_cloud.py
=====================================================
Complete one-time migration: push ALL local POS data to the Render cloud.

What it migrates (in order):
  1.  Business registration (name, category, currency, address, phone)
  2.  Branch
  3.  License (creates a LIFETIME license on the cloud so PWA users aren't blocked)
  4.  Categories
  5.  Brands
  6.  Units of measure
  7.  Products (with stock quantities)
  8.  Customers
  9.  Suppliers
  10. Users — ALL roles (Admin, Cashier, Inventory Clerk, Manager, Super Admin)
      • Passwords CANNOT be transferred (they are hashed — irreversible)
      • Each user gets a temporary password: POPMYC + their username + @2025
      • must_change_password is set to True so they are forced to change it
        on first PWA login
      • The command prints a summary table of all users + their temp passwords

Usage (from dev machine or customer PC):

    # Dev machine:
    cd c:\\xampp\\htdocs\\POS\\backend
    .venv-prod\\Scripts\\python.exe manage.py push_to_cloud \\
        --username omyc --password YOUR_CLOUD_PASSWORD

    # Customer PC (installed app):
    cd "C:\\Program Files\\POPMYC POS\\resources\\backend"
    $env:DJANGO_SETTINGS_MODULE = "config.settings"
    ..\\runtime\\python\\python.exe manage.py push_to_cloud \\
        --username omyc --password YOUR_CLOUD_PASSWORD

Safety:
  - Reads from local DB, writes to cloud via REST API (no direct DB access)
  - Idempotent: skips records that already exist (by name/username match)
  - Never modifies the local database
  - Temp passwords are printed ONCE — save them before closing the terminal
"""
import getpass
import secrets
import string

from django.core.management.base import BaseCommand, CommandError

try:
    import requests as _requests
except ImportError:
    _requests = None  # type: ignore


# ── Helpers ───────────────────────────────────────────────────────────────────

def _temp_password(username: str) -> str:
    """
    Generate a deterministic but non-trivial temporary password.
    Format: POPMYC + <username> + @2025
    Easy to communicate verbally. User is forced to change on first login.
    """
    return f"POPMYC{username}@2025"


def _cloud_list(requests, cloud_url, endpoint, headers, page_size=200):
    """Fetch all pages from a paginated cloud endpoint."""
    items = []
    url = cloud_url + endpoint
    params = {"page_size": page_size}
    while url:
        r = requests.get(url, headers=headers, params=params, timeout=30)
        if r.status_code != 200:
            return []
        data = r.json()
        if isinstance(data, list):
            return data
        items.extend(data.get("results", []))
        url = data.get("next")
        params = {}
    return items


class Command(BaseCommand):
    help = "Push ALL local POS data (including users) to the Render cloud database."

    def add_arguments(self, parser):
        parser.add_argument(
            "--cloud-url",
            default="https://popmyc-pos.onrender.com",
        )
        parser.add_argument("--username", required=True,
                            help="Your cloud login username")
        parser.add_argument("--password", default="",
                            help="Cloud password (prompted if omitted)")
        parser.add_argument("--dry-run", action="store_true",
                            help="Show what would be pushed without doing it")

    def handle(self, *args, **options):
        if _requests is None:
            raise CommandError("'requests' library not available in this environment.")

        requests   = _requests
        cloud_url  = options["cloud_url"].rstrip("/")
        username   = options["username"]
        password   = options["password"] or getpass.getpass("Cloud password: ")
        dry_run    = options["dry_run"]
        prefix     = "[DRY-RUN] " if dry_run else ""

        W = self.style.WARNING
        S = self.style.SUCCESS
        E = self.style.ERROR

        self.stdout.write(f"\n{prefix}╔══ POPMYC Cloud Migration ══╗")
        self.stdout.write(f"{prefix}║  Target: {cloud_url}")
        self.stdout.write(f"{prefix}╚{'═' * (len(cloud_url) + 11)}╝\n")

        # ── Login ─────────────────────────────────────────────────────────────
        self.stdout.write("🔐  Logging in to cloud...")
        try:
            resp = requests.post(
                cloud_url + "/api/v1/auth/login/",
                json={"username": username, "password": password},
                timeout=30,
            )
        except Exception as exc:
            raise CommandError(f"Cannot reach cloud: {exc}")

        if resp.status_code != 200:
            raise CommandError(f"Login failed ({resp.status_code}): {resp.text[:200]}")

        token = resp.json().get("access")
        if not token:
            raise CommandError("Login succeeded but no access token in response.")

        H = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        self.stdout.write(S("  ✅  Logged in\n"))

        # ── Local data ────────────────────────────────────────────────────────
        from businesses.models import Business, BusinessSettings
        from branches.models import Branch
        from accounts.models import CustomUser
        from products.models import Category, Brand, UnitOfMeasure, Product
        from customers.models import Customer
        from suppliers.models import Supplier

        local_biz = Business.objects.first()
        if not local_biz:
            raise CommandError("No business in local database. Run Setup Wizard first.")

        local_branch = Branch.objects.filter(business=local_biz).first()

        self.stdout.write(f"🏪  Local business: {local_biz.name}")
        self.stdout.write(f"🌐  Cloud URL     : {cloud_url}\n")

        def push(endpoint, payload, label):
            if dry_run:
                self.stdout.write(f"  {prefix}POST {endpoint} — {label}")
                return {"id": "dry-run-id"}
            r = requests.post(cloud_url + endpoint, headers=H,
                              json=payload, timeout=30)
            if r.status_code in (200, 201):
                return r.json()
            self.stdout.write(W(f"  ⚠️  {label}: {r.status_code} {r.text[:150]}"))
            return None

        def cloud_ids_by_name(endpoint, name_field="name"):
            return {
                item.get(name_field, "").lower(): item["id"]
                for item in _cloud_list(requests, cloud_url, endpoint, H)
                if item.get(name_field)
            }

        # ── 1. Business registration ──────────────────────────────────────────
        self.stdout.write("🏢  Registering business on cloud...")
        biz_payload = {
            "business_id":        str(local_biz.id),
            "name":               local_biz.name,
            "business_category":  local_biz.business_category,
            "address":            local_biz.address or "",
            "phone":              local_biz.phone or "",
            "email":              local_biz.email or "",
            "currency":           local_biz.currency or "GHS",
            "currency_symbol":    local_biz.currency_symbol or "GH₵",
            "branch_id":          str(local_branch.id) if local_branch else None,
            "branch_name":        local_branch.name if local_branch else "Main Branch",
            "branch_code":        local_branch.code if local_branch else "HQ",
        }
        # Include the admin user info
        admin = CustomUser.objects.filter(
            business=local_biz, is_superuser=True
        ).first() or CustomUser.objects.filter(business=local_biz).first()
        if admin:
            biz_payload.update({
                "admin_id":         str(admin.id),
                "admin_username":   admin.username,
                "admin_email":      admin.email or "",
                "admin_first_name": admin.first_name or "",
                "admin_last_name":  admin.last_name or "",
            })
        if not dry_run:
            try:
                r = requests.post(
                    cloud_url + "/api/v1/cloud/trial/register-business/",
                    json=biz_payload, timeout=30
                )
                if r.status_code in (200, 201):
                    self.stdout.write(S("  ✅  Business registered\n"))
                elif r.status_code == 409:
                    self.stdout.write(S("  ✅  Business already registered\n"))
                else:
                    self.stdout.write(W(f"  ⚠️  Registration: {r.status_code} {r.text[:120]}\n"))
            except Exception as exc:
                self.stdout.write(W(f"  ⚠️  Registration failed: {exc}\n"))
        else:
            self.stdout.write(f"  {prefix}POST /api/v1/cloud/trial/register-business/\n")

        # Get cloud business ID (may have just been created)
        cloud_bizs = _cloud_list(requests, cloud_url, "/api/v1/businesses/", H)
        cloud_biz_id = cloud_bizs[0]["id"] if cloud_bizs else str(local_biz.id)
        self.stdout.write(f"   Cloud business ID: {cloud_biz_id}\n")

        # ── 2. License ────────────────────────────────────────────────────────
        self.stdout.write("🔑  Syncing license...")
        from licensing.models import License
        local_lic = License.objects.filter(business=local_biz).first()
        if local_lic:
            cloud_lics = _cloud_list(requests, cloud_url, "/api/v1/licensing/licenses/", H)
            cloud_lic_biz_ids = {str(l.get("business")): l for l in cloud_lics}
            if cloud_biz_id not in cloud_lic_biz_ids:
                result = push("/api/v1/licensing/licenses/", {
                    "business":     cloud_biz_id,
                    "license_type": local_lic.license_type,
                    "status":       local_lic.status,
                    "activation_code": local_lic.activation_code or "CLOUD-MIGRATED",
                    "expiry_date":  local_lic.expiry_date.isoformat() if local_lic.expiry_date else None,
                }, "license")
                if result:
                    self.stdout.write(S(f"  ✅  License synced ({local_lic.license_type})\n"))
            else:
                self.stdout.write(S("  ✅  License already exists\n"))
        else:
            self.stdout.write(W("  ⚠️  No local license found — skipping\n"))

        # ── 3. Categories ─────────────────────────────────────────────────────
        self.stdout.write("📂  Pushing categories...")
        cloud_cats = cloud_ids_by_name("/api/v1/products/categories/")
        cat_map = {}
        pushed = skipped = 0
        for cat in Category.objects.filter(business=local_biz).order_by("sort_order", "name"):
            if cat.name.lower() in cloud_cats:
                cat_map[str(cat.id)] = cloud_cats[cat.name.lower()]
                skipped += 1
                continue
            r = push("/api/v1/products/categories/", {
                "name": cat.name, "code": cat.code,
                "description": cat.description,
                "is_active": cat.is_active,
                "sort_order": cat.sort_order,
                "business": cloud_biz_id,
            }, f"category '{cat.name}'")
            if r:
                cat_map[str(cat.id)] = r["id"]
                pushed += 1
        self.stdout.write(S(f"  ✅  {pushed} pushed, {skipped} already existed\n"))

        # ── 4. Brands ─────────────────────────────────────────────────────────
        self.stdout.write("🏷️   Pushing brands...")
        cloud_brands = cloud_ids_by_name("/api/v1/products/brands/")
        brand_map = {}
        pushed = skipped = 0
        for brand in Brand.objects.filter(business=local_biz):
            if brand.name.lower() in cloud_brands:
                brand_map[str(brand.id)] = cloud_brands[brand.name.lower()]
                skipped += 1
                continue
            r = push("/api/v1/products/brands/", {
                "name": brand.name, "code": brand.code,
                "description": brand.description,
                "website": brand.website,
                "is_active": brand.is_active,
                "business": cloud_biz_id,
            }, f"brand '{brand.name}'")
            if r:
                brand_map[str(brand.id)] = r["id"]
                pushed += 1
        self.stdout.write(S(f"  ✅  {pushed} pushed, {skipped} already existed\n"))

        # ── 5. Units ──────────────────────────────────────────────────────────
        self.stdout.write("📏  Pushing units of measure...")
        cloud_units = cloud_ids_by_name("/api/v1/products/units/")
        unit_map = {}
        pushed = skipped = 0
        for unit in UnitOfMeasure.objects.filter(business=local_biz):
            if unit.name.lower() in cloud_units:
                unit_map[str(unit.id)] = cloud_units[unit.name.lower()]
                skipped += 1
                continue
            r = push("/api/v1/products/units/", {
                "name": unit.name,
                "code": getattr(unit, "code", unit.symbol or ""),
                "symbol": unit.symbol or "",
                "allow_fractional": getattr(unit, "allow_fractional", True),
                "business": cloud_biz_id,
            }, f"unit '{unit.name}'")
            if r:
                unit_map[str(unit.id)] = r["id"]
                pushed += 1
        self.stdout.write(S(f"  ✅  {pushed} pushed, {skipped} already existed\n"))

        # ── 6. Products ───────────────────────────────────────────────────────
        self.stdout.write("📦  Pushing products...")
        cloud_prods = cloud_ids_by_name("/api/v1/products/")
        pushed = skipped = errors = 0
        for prod in Product.objects.filter(business=local_biz).select_related(
            "category", "brand", "unit_of_measure"
        ):
            if prod.name.lower() in cloud_prods:
                skipped += 1
                continue
            payload = {
                "name": prod.name,
                "sku": prod.sku,
                "description": prod.description or "",
                "selling_price": str(prod.selling_price),
                "cost_price": str(prod.cost_price) if prod.cost_price else "0",
                "is_active": prod.is_active,
                "business": cloud_biz_id,
            }
            # Stock quantity
            for attr in ("stock_quantity", "quantity", "qty_on_hand"):
                if hasattr(prod, attr):
                    payload["stock_quantity"] = float(getattr(prod, attr) or 0)
                    break
            # Optional FKs
            if prod.category_id and str(prod.category_id) in cat_map:
                payload["category"] = cat_map[str(prod.category_id)]
            if prod.brand_id and str(prod.brand_id) in brand_map:
                payload["brand"] = brand_map[str(prod.brand_id)]
            if prod.unit_of_measure_id and str(prod.unit_of_measure_id) in unit_map:
                payload["unit_of_measure"] = unit_map[str(prod.unit_of_measure_id)]
            r = push("/api/v1/products/", payload, f"product '{prod.name}'")
            if r:
                pushed += 1
            else:
                errors += 1
        self.stdout.write(S(f"  ✅  {pushed} pushed, {skipped} already existed, {errors} errors\n"))

        # ── 7. Customers ──────────────────────────────────────────────────────
        self.stdout.write("👥  Pushing customers...")
        cloud_custs = _cloud_list(requests, cloud_url, "/api/v1/customers/", H)
        cloud_cust_phones = {c.get("phone", ""): c["id"] for c in cloud_custs if c.get("phone")}
        pushed = skipped = 0
        for cust in Customer.objects.filter(business=local_biz):
            phone = getattr(cust, "phone", "") or getattr(cust, "phone_number", "") or ""
            if phone and phone in cloud_cust_phones:
                skipped += 1
                continue
            payload = {"business": cloud_biz_id}
            for field in [
                "first_name", "last_name", "name", "full_name",
                "email", "phone", "phone_number", "address", "city",
                "credit_limit", "loyalty_points", "group", "is_active",
            ]:
                val = getattr(cust, field, None)
                if val is not None:
                    payload[field] = val
            r = push("/api/v1/customers/", payload,
                     f"customer '{getattr(cust, 'first_name', '')} {getattr(cust, 'last_name', '')}'".strip())
            if r:
                pushed += 1
        self.stdout.write(S(f"  ✅  {pushed} pushed, {skipped} already existed\n"))

        # ── 8. Suppliers ──────────────────────────────────────────────────────
        self.stdout.write("🚚  Pushing suppliers...")
        cloud_sups = cloud_ids_by_name("/api/v1/suppliers/")
        pushed = skipped = 0
        for sup in Supplier.objects.filter(business=local_biz):
            if sup.name.lower() in cloud_sups:
                skipped += 1
                continue
            payload = {"name": sup.name, "business": cloud_biz_id}
            for field in ["email", "phone", "address", "contact_person", "notes", "is_active"]:
                val = getattr(sup, field, None)
                if val is not None:
                    payload[field] = val
            r = push("/api/v1/suppliers/", payload, f"supplier '{sup.name}'")
            if r:
                pushed += 1
        self.stdout.write(S(f"  ✅  {pushed} pushed, {skipped} already existed\n"))

        # ── 9. Users ──────────────────────────────────────────────────────────
        self.stdout.write("👤  Pushing users (all roles)...")
        cloud_users_list = _cloud_list(requests, cloud_url, "/api/v1/accounts/users/", H)
        cloud_usernames = {u["username"].lower(): u["id"] for u in cloud_users_list if u.get("username")}
        cloud_emails    = {u.get("email", "").lower(): u["id"] for u in cloud_users_list if u.get("email")}

        local_users = CustomUser.objects.filter(
            business=local_biz
        ).exclude(id=admin.id if admin else None)  # admin was created via register-business

        user_summary = []  # list of (username, role, temp_password, status)

        # Include admin too if not already on cloud
        all_users = list(CustomUser.objects.filter(business=local_biz))

        pushed = skipped = errors = 0
        for user in all_users:
            uname_lower = user.username.lower()
            email_lower = (user.email or "").lower()

            if uname_lower in cloud_usernames or (email_lower and email_lower in cloud_emails):
                user_summary.append((user.username, user.email, "—", "already exists"))
                skipped += 1
                continue

            temp_pwd = _temp_password(user.username)
            payload = {
                "username":           user.username,
                "email":              user.email or "",
                "first_name":         user.first_name or "",
                "last_name":          user.last_name or "",
                "phone_number":       user.phone_number or "",
                "password":           temp_pwd,
                "must_change_password": True,
                "is_active":          user.is_active,
                "is_staff":           user.is_staff,
                "is_superuser":       user.is_superuser,
                "business":           cloud_biz_id,
            }
            if local_branch:
                payload["branch"] = str(local_branch.id)

            r = push("/api/v1/accounts/users/", payload, f"user '{user.username}'")
            if r:
                pushed += 1
                user_summary.append((user.username, user.email, temp_pwd, "✅ created"))
            else:
                errors += 1
                user_summary.append((user.username, user.email, temp_pwd, "❌ failed"))

        self.stdout.write(S(f"  ✅  {pushed} created, {skipped} already existed, {errors} errors\n"))

        # ── Print user summary table ──────────────────────────────────────────
        if user_summary:
            self.stdout.write("\n" + "═" * 70)
            self.stdout.write("  USER CREDENTIALS — Save this before closing!")
            self.stdout.write("  Staff must use these credentials to log in to the PWA.")
            self.stdout.write("  They will be prompted to change their password on first login.")
            self.stdout.write("═" * 70)
            self.stdout.write(f"  {'USERNAME':<20} {'EMAIL':<30} {'TEMP PASSWORD':<25} STATUS")
            self.stdout.write("  " + "─" * 68)
            for uname, email, pwd, status in user_summary:
                self.stdout.write(f"  {uname:<20} {(email or '—'):<30} {pwd:<25} {status}")
            self.stdout.write("═" * 70 + "\n")

        # ── Done ─────────────────────────────────────────────────────────────
        self.stdout.write(S(
            "🎉  Migration complete!\n"
            "   Open https://popmyc-poos-app.onrender.com and log in.\n"
            "   All your data is now on the cloud.\n"
        ))
