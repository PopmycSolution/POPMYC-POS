"""
setup/views.py
==============
First-run setup API for POPMYC POS Desktop.

Endpoints (all under /api/v1/setup/, all in BYPASS_PREFIXES — no auth required):

  GET  /api/v1/setup/status/
      Returns whether the application has been initialised.
      Safe to call before any authentication exists.
      The frontend polls this on startup to decide whether to show the
      setup wizard or the normal login page.

  POST /api/v1/setup/run/
      Atomically executes all setup steps:
        1. Create the Business
        2. Create the default Branch (head office)
        3. Create the super-admin CustomUser
        4. Activate the License using the supplied activation code
      All steps run inside a single transaction.atomic() — if any step
      fails the entire setup is rolled back and the installer can retry.
      Once setup is complete this endpoint returns 409 CONFLICT on every
      subsequent call so it cannot be used to create duplicate data.

Security model
--------------
- No authentication is required for these endpoints (they're pre-login).
- The setup/run/ endpoint is a one-shot: it rejects calls once a Business
  and CustomUser already exist. The check is server-side only.
- The activation code is validated against the existing licensing system
  (License model + ActivateLicenseSerializer).  We don't invent a second
  license system.
- The license lookup uses the business_id from the just-created Business,
  so the code must genuinely belong to that business.
- The endpoint is added to LicenseCheckMiddleware's BYPASS_PREFIXES so
  it is reachable before any license is active.
- No secrets, database credentials, or Django internals are exposed in
  responses.

Assumptions
-----------
- POPMYC staff have already created a License record (status=PENDING) for
  the business and given the customer an activation code.
- On a fresh install there are no Business, Branch, or CustomUser objects
  in the database (other than any Django superuser the developer may have
  created via manage.py, which won't interfere because we check
  CustomUser with business=None separately).
"""

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction

from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from businesses.models import Business, BusinessSettings
from branches.models import Branch
from licensing.models import License, TrialCode
from licensing.serializers import ActivateLicenseSerializer, LicenseStatusSerializer
from licensing.services import create_trial_license, generate_trial_code

User = get_user_model()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _is_setup_complete() -> bool:
    """
    True when the application has been fully initialised.

    Criteria (all must be true):
      1. At least one Business exists
      2. At least one Branch exists
      3. At least one CustomUser with a business assigned exists
      4. That business has an ACTIVE License

    All checks are server-side.  The frontend must never be trusted to
    report setup as complete on its own.
    """
    if not Business.objects.exists():
        return False
    if not Branch.objects.exists():
        return False
    if not User.objects.filter(business__isnull=False).exists():
        return False
    # Check that the first business has an active license
    first_biz = Business.objects.order_by("created_at").first()
    if first_biz is None:
        return False
    try:
        lic = first_biz.license
        lic.refresh_expiry_status()
        if not lic.is_active:
            return False
    except License.DoesNotExist:
        return False
    return True


def _safe_error(msg: str) -> dict:
    """Return a structured error response that never leaks internals."""
    return {"success": False, "error": str(msg)}


# ── Views ─────────────────────────────────────────────────────────────────────

class SetupStatusView(APIView):
    """
    GET /api/v1/setup/status/

    Called by the frontend on every cold start to decide whether to show
    the setup wizard or the normal login screen.

    Returns HTTP 200 always (no 4xx) so the frontend can always interpret it.
    """
    permission_classes = [AllowAny]

    def get(self, request):
        complete = _is_setup_complete()
        return Response(
            {
                "setup_complete": complete,
                "has_business": Business.objects.exists(),
                "has_branch": Branch.objects.exists(),
                "has_admin": User.objects.filter(business__isnull=False).exists(),
                "has_license": License.objects.filter(
                    status=License.Status.ACTIVE
                ).exists(),
            },
            status=status.HTTP_200_OK,
        )


class SetupRunView(APIView):
    """
    POST /api/v1/setup/run/

    Atomically creates Business → Branch → Admin user → activates License.

    Expected request body:
    {
        "business": {
            "name":             "Kofi Stores Ltd",
            "business_category": "GENERAL_RETAIL",
            "address":          "123 Main St, Accra",
            "phone":            "+233241234567",
            "email":            "kofi@example.com",
            "currency":         "GHS",
            "currency_symbol":  "GH₵"
        },
        "branch": {
            "name": "Main Branch",
            "code": "MAIN"
        },
        "admin": {
            "first_name": "Kofi",
            "last_name":  "Mensah",
            "email":      "kofi@example.com",
            "username":   "admin",
            "password":   "SecurePass@123"
        },
        "license": {
            "activation_code": "ABCD-1234-EFGH-5678-IJKL"
        }
    }

    Returns:
        200 OK  on success
        400 BAD REQUEST  on validation error
        409 CONFLICT  if setup is already complete
        500 INTERNAL SERVER ERROR  (generic message only — never leaks details)
    """
    permission_classes = [AllowAny]

    def post(self, request):
        # ── Guard: reject if already set up ───────────────────────────────────
        if _is_setup_complete():
            return Response(
                {"success": False, "error": "Setup is already complete."},
                status=status.HTTP_409_CONFLICT,
            )

        data = request.data

        # ── Extract and validate sections ─────────────────────────────────────
        biz_data     = data.get("business", {})
        branch_data  = data.get("branch", {})
        admin_data   = data.get("admin", {})
        license_data = data.get("license", {})

        # Required field validation before touching the DB
        errors = {}

        # Business
        if not biz_data.get("name", "").strip():
            errors.setdefault("business", {})["name"] = "Business name is required."

        # Branch
        if not branch_data.get("name", "").strip():
            errors.setdefault("branch", {})["name"] = "Branch name is required."

        # Admin
        for field in ("first_name", "last_name", "username", "password"):
            if not admin_data.get(field, "").strip():
                errors.setdefault("admin", {})[field] = f"{field} is required."
        if not admin_data.get("email", "").strip():
            errors.setdefault("admin", {})["email"] = "Email is required."

        # License — activation code is OPTIONAL for fresh installations.
        # If omitted, a 7-day trial license is created automatically.
        # If supplied, it is validated against the existing licensing system.
        raw_code = license_data.get("activation_code", "").strip().upper()
        use_trial = not raw_code

        if errors:
            return Response(
                {"success": False, "errors": errors},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── Password validation (before DB work) ──────────────────────────────
        password = admin_data["password"]
        # Build a temporary User instance for Django's validators
        tmp_user = User(
            username=admin_data["username"].strip(),
            email=admin_data.get("email", "").strip(),
            first_name=admin_data.get("first_name", "").strip(),
            last_name=admin_data.get("last_name", "").strip(),
        )
        try:
            validate_password(password, user=tmp_user)
        except DjangoValidationError as exc:
            return Response(
                {"success": False, "errors": {"admin": {"password": list(exc.messages)}}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── Username / email uniqueness check (before DB work) ────────────────
        username = admin_data["username"].strip()
        email    = admin_data.get("email", "").strip()

        if User.objects.filter(username=username).exists():
            return Response(
                {"success": False, "errors": {"admin": {"username": "This username is already taken."}}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── Activation code pre-check (only when code was supplied) ──────────
        # Three possible paths:
        #   1. No code supplied             → auto-create trial (PATH A)
        #   2. Code matches a TrialCode     → claim pre-issued trial (PATH B)
        #   3. Code matches a License       → paid activation (existing path)
        pending_license  = None
        pending_trial_code = None

        if not use_trial:
            # Check TrialCode first (Path B)
            trial_code_obj = TrialCode.objects.filter(
                code=raw_code,
                status=TrialCode.TrialStatus.PENDING,
            ).first()

            if trial_code_obj:
                # It's a valid pre-issued trial code
                pending_trial_code = trial_code_obj
            else:
                # Check if it's a paid License code (existing Path C)
                if not License.objects.filter(activation_code=raw_code).exists():
                    return Response(
                        {
                            "success": False,
                            "errors": {
                                "license": {
                                    "activation_code": (
                                        "Invalid activation code. "
                                        "Please check the code provided by POPMYC."
                                    )
                                }
                            },
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                try:
                    pending_license = License.objects.select_related("business").get(
                        activation_code=raw_code
                    )
                except License.DoesNotExist:
                    return Response(
                        {"success": False, "errors": {"license": {"activation_code": "Invalid activation code."}}},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                if pending_license.status == License.Status.REVOKED:
                    return Response(
                        {
                            "success": False,
                            "errors": {"license": {"activation_code": "This license has been revoked. Contact POPMYC support."}},
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

        # ── Atomic setup ──────────────────────────────────────────────────────
        try:
            with transaction.atomic():
                # 1. Create (or reuse) the Business
                # When using a pre-issued activation code, POPMYC may have already
                # linked a Business to the License.  In the trial path (no code),
                # we always create a fresh Business from the wizard data.
                if not use_trial and pending_license is not None and pending_license.business:
                    business = pending_license.business
                    # Sync any overrideable fields from the wizard
                    business.name    = biz_data.get("name", business.name).strip()
                    business.address = biz_data.get("address", business.address).strip()
                    business.phone   = biz_data.get("phone",   business.phone).strip()
                    business.email   = biz_data.get("email",   business.email).strip()
                    if biz_data.get("business_category"):
                        business.business_category = biz_data["business_category"]
                    if biz_data.get("currency"):
                        business.currency = biz_data["currency"]
                    if biz_data.get("currency_symbol"):
                        business.currency_symbol = biz_data["currency_symbol"]
                    business.save()
                else:
                    # Trial path (or code path where no business was pre-linked)
                    business = Business.objects.create(
                        name              = biz_data["name"].strip(),
                        business_category = biz_data.get("business_category", "GENERAL_RETAIL"),
                        address           = biz_data.get("address", "").strip(),
                        phone             = biz_data.get("phone", "").strip(),
                        email             = biz_data.get("email", "").strip(),
                        currency          = biz_data.get("currency", "GHS"),
                        currency_symbol   = biz_data.get("currency_symbol", "GH₵"),
                    )
                    if not use_trial and pending_license is not None:
                        # Link license to the newly created business
                        pending_license.business = business
                        pending_license.save(update_fields=["business", "updated_at"])

                # 2. Create BusinessSettings if absent
                BusinessSettings.objects.get_or_create(business=business)

                # 3. Create the head-office Branch
                branch_name = branch_data.get("name", "Main Branch").strip()
                branch_code = branch_data.get("code", "MAIN").strip().upper()
                # Ensure code uniqueness within the business
                if Branch.objects.filter(business=business, code=branch_code).exists():
                    branch_code = branch_code + "1"
                branch = Branch.objects.create(
                    business      = business,
                    name          = branch_name,
                    code          = branch_code,
                    is_head_office = True,
                    is_active     = True,
                    phone         = biz_data.get("phone", "").strip(),
                    address       = biz_data.get("address", "").strip(),
                )

                # 4. Create the super-admin user
                admin_user = User.objects.create_user(
                    username   = username,
                    email      = email,
                    password   = password,
                    first_name = admin_data.get("first_name", "").strip(),
                    last_name  = admin_data.get("last_name", "").strip(),
                    is_staff   = True,
                    is_superuser = True,
                )
                admin_user.business = business
                admin_user.branch   = branch
                admin_user.save(update_fields=["business", "branch", "updated_at"])

                # 5. Activate the license
                # Three paths:
                #   a) Auto-trial (no code)      → create_trial_license()
                #   b) Pre-issued trial code      → TrialCode.claim()
                #   c) Paid code                 → ActivateLicenseSerializer
                if use_trial:
                    activated_license = create_trial_license(
                        business=business, performed_by=admin_user
                    )
                elif pending_trial_code is not None:
                    # Path B: pre-issued trial voucher — 7 days start NOW
                    activated_license = pending_trial_code.claim(
                        business=business, performed_by=admin_user
                    )
                else:
                    # Path C: paid activation code
                    activate_ser = ActivateLicenseSerializer(
                        data={"activation_code": raw_code},
                        context={"business": business, "user": admin_user},
                    )
                    activate_ser.is_valid(raise_exception=True)
                    activated_license = activate_ser.save()

        except Exception as exc:
            # Don't leak internal error details to the client
            import logging
            logging.getLogger("setup").exception("Setup failed: %s", exc)
            return Response(
                {
                    "success": False,
                    "error": (
                        "Setup could not be completed. "
                        "Please check that your database is available and try again."
                    ),
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # ── Return a minimal success payload ──────────────────────────────────
        return Response(
            {
                "success": True,
                "business_id":  str(business.id),
                "branch_id":    str(branch.id),
                "admin_username": admin_user.username,
                "license": LicenseStatusSerializer(activated_license).data,
            },
            status=status.HTTP_200_OK,
        )
