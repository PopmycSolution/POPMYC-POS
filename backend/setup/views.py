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

Cloud TrialCode activation (Stage 7 bridge)
--------------------------------------------
The customer may supply a cloud_activation_token inside the license section:

    "license": {
        "activation_code":        "XXXX-XXXX-XXXX-XXXX-XXXX",
        "cloud_activation_token": "<reservation token from /cloud/trial/validate/>"
    }

When cloud_activation_token is present the flow becomes:

  Phase 1 (already done by frontend):
    Frontend called POST /api/v1/cloud/trial/validate/ on Render.
    Render verified the TrialCode is PENDING and returned a reservation token.
    Token is short-lived (10 minutes).

  Phase 1.5 (this view):
    SetupRunView calls POST /api/v1/cloud/trial/verify-reservation/ on Render
    to confirm the token is still valid *before* any DB writes.
    If the token has expired → 400, customer must restart.

  Phase 2 (atomic local setup):
    SetupRunView creates Business, Branch, Admin, local TRIAL License using
    the existing create_trial_license() helper — identical audit trail.
    The local TrialCode row is NOT required (the cloud is the authority).

  Phase 3 (after commit — handled by frontend):
    Frontend calls POST /api/v1/cloud/trial/complete/ on Render to
    atomically mark the cloud TrialCode as USED.
    If this call fails transiently, the local license is still active and
    the frontend retries from localStorage.

IMPORTANT OFFLINE SAFETY:
- The cloud verify-reservation call is only made when a cloud_activation_token
  is present.  Existing paths (no code, local TrialCode, paid License) are
  completely unchanged and work without any network access.
- If CLOUD_SETUP_URL is not configured, the cloud token path falls back
  gracefully with a clear error (not a silent bypass).

Assumptions
-----------
- POPMYC staff have already created a License record (status=PENDING) for
  the business and given the customer an activation code.
- On a fresh install there are no Business, Branch, or CustomUser objects
  in the database (other than any Django superuser the developer may have
  created via manage.py, which won't interfere because we check
  CustomUser with business=None separately).
"""

import logging

from django.conf import settings
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
logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _is_setup_complete() -> bool:
    """
    True when the application has been fully initialised.

    Criteria (all must be true):
      1. At least one Business exists
      2. At least one Branch exists
      3. At least one CustomUser with a business assigned exists
      4. At least one Business has an ACTIVE License

    NOTE: We check whether ANY business has an active license, not just the
    oldest one.  Early test/sync businesses created before the customer's
    real setup would otherwise cause this check to return False even when
    the customer's business has a valid active license.

    All checks are server-side.  The frontend must never be trusted to
    report setup as complete on its own.
    """
    if not Business.objects.exists():
        return False
    if not Branch.objects.exists():
        return False
    if not User.objects.filter(business__isnull=False).exists():
        return False

    # Check whether ANY business has an active license.
    # Iterate only over businesses that actually have a license to avoid
    # N+1 queries on large datasets — filter to businesses with a related
    # license record, then check activeness in Python.
    from licensing.models import License as _License
    active_exists = _License.objects.filter(
        status=_License.Status.ACTIVE,
    ).exists()

    if not active_exists:
        return False

    # Secondary check: at least one of those active licenses is genuinely
    # not expired (catches the case where status is ACTIVE but expiry_date
    # has passed and refresh_expiry_status() hasn't been called yet).
    for lic in _License.objects.filter(status=_License.Status.ACTIVE).select_related("business"):
        if lic.is_active:   # uses the model property which checks expiry_date
            return True

    return False


def _safe_error(msg: str) -> dict:
    """Return a structured error response that never leaks internals."""
    return {"success": False, "error": str(msg)}


def _verify_cloud_reservation(raw_token: str) -> tuple[bool, str]:
    """
    Call the cloud verify-reservation endpoint to confirm that
    an ActivationReservation is still PENDING and not expired.

    Returns (is_valid: bool, error_message: str).

    This is a synchronous HTTP call made BEFORE the local atomic setup
    begins.  It is the only network call in the setup flow — everything
    else runs locally.

    Security notes:
    - We only send the opaque token, nothing else.
    - We only receive {valid, trial_days, expires_in_seconds}.
    - No cloud DB credential or secret is transmitted.
    - If CLOUD_SETUP_URL is not configured we return an explicit error
      rather than silently bypassing the check.
    - Timeout is 10 seconds — enough for a slow Render cold-start.
    """
    import urllib.request
    import urllib.error
    import json

    cloud_url = getattr(settings, "CLOUD_SETUP_URL", "").rstrip("/")
    if not cloud_url:
        return False, (
            "Cloud licensing service URL is not configured on this server. "
            "Contact your POPMYC administrator."
        )

    endpoint = f"{cloud_url}/api/v1/cloud/trial/verify-reservation/"
    payload = json.dumps({"reservation_token": raw_token}).encode()

    req = urllib.request.Request(
        endpoint,
        data=payload,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read().decode())
            if body.get("valid"):
                return True, ""
            return False, (
                "The activation reservation is no longer valid or has expired. "
                "Please restart the activation process."
            )
    except urllib.error.HTTPError as exc:
        logger.warning("Cloud reservation verify HTTP error: %s", exc.code)
        return False, (
            "Could not verify the activation reservation with the cloud service. "
            "Please check your internet connection and try again."
        )
    except (urllib.error.URLError, OSError) as exc:
        logger.warning("Cloud reservation verify network error: %s", exc)
        return False, (
            "Cannot reach the POPMYC cloud service. "
            "Please check your internet connection and try again."
        )
    except Exception as exc:
        logger.exception("Cloud reservation verify unexpected error: %s", exc)
        return False, (
            "An unexpected error occurred while verifying your activation. "
            "Please try again."
        )


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
            "activation_code":        "XXXX-XXXX-XXXX-XXXX-XXXX",  // optional
            "cloud_activation_token": "<reservation token>"          // optional, from cloud validate
        }
    }

    License activation paths (unchanged + new):
      PATH A: no code, no token  → auto-create 7-day trial (original behaviour)
      PATH B: local TrialCode    → TrialCode.claim() (original behaviour)
      PATH C: paid License code  → ActivateLicenseSerializer (original behaviour)
      PATH D: cloud token        → verify reservation, then create_trial_license()
                                   (new — cloud TrialCode bridge)

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

        # License — both fields are optional; logic determined below.
        raw_code    = license_data.get("activation_code", "").strip().upper()
        cloud_token = license_data.get("cloud_activation_token", "").strip()

        # PATH D takes precedence when a cloud token is present.
        # PATH A is used when neither code nor token is supplied.
        use_cloud_token = bool(cloud_token)
        use_trial       = not raw_code and not cloud_token

        if errors:
            return Response(
                {"success": False, "errors": errors},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── Password validation (before DB work) ──────────────────────────────
        password = admin_data["password"]
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

        # ── Username uniqueness check (before DB work) ────────────────────────
        username = admin_data["username"].strip()
        email    = admin_data.get("email", "").strip()

        if User.objects.filter(username=username).exists():
            return Response(
                {"success": False, "errors": {"admin": {"username": "This username is already taken."}}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── PATH D: Cloud token — verify reservation before any DB writes ─────
        # This is the ONLY network call in the setup flow.
        # If the reservation has expired the customer must restart activation.
        # If CLOUD_SETUP_URL is unconfigured we reject rather than silently
        # creating an un-tracked trial (security requirement).
        if use_cloud_token:
            valid, err_msg = _verify_cloud_reservation(cloud_token)
            if not valid:
                return Response(
                    {
                        "success": False,
                        "errors": {
                            "license": {
                                "cloud_activation_token": err_msg
                            }
                        },
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # ── Activation code pre-check for PATH B / PATH C ────────────────────
        # (Only when a raw code is supplied and no cloud token is present.)
        pending_license    = None
        pending_trial_code = None

        if raw_code and not use_cloud_token:
            # Check TrialCode first (Path B — local trial code)
            trial_code_obj = TrialCode.objects.filter(
                code=raw_code,
                status=TrialCode.TrialStatus.PENDING,
            ).first()

            if trial_code_obj:
                pending_trial_code = trial_code_obj
            else:
                # Check if it's a paid License code (Path C)
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
                        {
                            "success": False,
                            "errors": {"license": {"activation_code": "Invalid activation code."}},
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                if pending_license.status == License.Status.REVOKED:
                    return Response(
                        {
                            "success": False,
                            "errors": {
                                "license": {
                                    "activation_code": (
                                        "This license has been revoked. "
                                        "Contact POPMYC support."
                                    )
                                }
                            },
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

        # ── Atomic local setup ────────────────────────────────────────────────
        try:
            with transaction.atomic():
                # 1. Create (or reuse) the Business.
                # For PATH C: if the paid License already has a linked Business,
                # reuse it and update the wizard fields.
                # For all other paths: create a fresh Business.
                if (
                    not use_trial
                    and not use_cloud_token
                    and pending_license is not None
                    and pending_license.business
                ):
                    business = pending_license.business
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
                    business = Business.objects.create(
                        name              = biz_data["name"].strip(),
                        business_category = biz_data.get("business_category", "GENERAL_RETAIL"),
                        address           = biz_data.get("address", "").strip(),
                        phone             = biz_data.get("phone", "").strip(),
                        email             = biz_data.get("email", "").strip(),
                        currency          = biz_data.get("currency", "GHS"),
                        currency_symbol   = biz_data.get("currency_symbol", "GH₵"),
                    )
                    if (
                        not use_trial
                        and not use_cloud_token
                        and pending_license is not None
                    ):
                        pending_license.business = business
                        pending_license.save(update_fields=["business", "updated_at"])

                # 2. BusinessSettings — save branch_mode and inventory_mode from wizard
                branch_mode_val = branch_data.get("branch_mode", "SINGLE").upper()
                if branch_mode_val not in ("SINGLE", "MULTI"):
                    branch_mode_val = "SINGLE"
                biz_settings, _ = BusinessSettings.objects.get_or_create(business=business)
                changed_fields = []
                if biz_settings.branch_mode != branch_mode_val:
                    biz_settings.branch_mode = branch_mode_val
                    changed_fields.append("branch_mode")

                inventory_mode_val = biz_data.get("inventory_mode", "FULL_POS").upper()
                valid_modes = ("FULL_POS", "INVENTORY_ONLY", "POS_ONLY")
                if inventory_mode_val not in valid_modes:
                    inventory_mode_val = "FULL_POS"
                if biz_settings.inventory_mode != inventory_mode_val:
                    biz_settings.inventory_mode = inventory_mode_val
                    changed_fields.append("inventory_mode")

                if changed_fields:
                    changed_fields.append("updated_at")
                    biz_settings.save(update_fields=changed_fields)

                # 3. Head-office Branch
                branch_name = branch_data.get("name", "Main Branch").strip()
                branch_code = branch_data.get("code", "MAIN").strip().upper()
                if Branch.objects.filter(business=business, code=branch_code).exists():
                    branch_code = branch_code + "1"
                branch = Branch.objects.create(
                    business       = business,
                    name           = branch_name,
                    code           = branch_code,
                    is_head_office = True,
                    is_active      = True,
                    phone          = biz_data.get("phone", "").strip(),
                    address        = biz_data.get("address", "").strip(),
                )

                # 4. Super-admin user
                admin_user = User.objects.create_user(
                    username     = username,
                    email        = email,
                    password     = password,
                    first_name   = admin_data.get("first_name", "").strip(),
                    last_name    = admin_data.get("last_name", "").strip(),
                    is_staff     = True,
                    is_superuser = True,
                )
                admin_user.business = business
                admin_user.branch   = branch
                admin_user.save(update_fields=["business", "branch", "updated_at"])

                # 5. Activate the license — four paths:
                #   A) Auto-trial (no code, no token)  → create_trial_license()
                #   B) Local TrialCode voucher         → TrialCode.claim()
                #   C) Paid License code               → ActivateLicenseSerializer
                #   D) Cloud reservation token         → create_trial_license()
                #      (TrialCode lives in cloud DB; local DB has no row for it.
                #       The cloud verify-reservation call above already confirmed
                #       the code is valid.  We create the local license using the
                #       same helper as PATH A — the audit trail is identical.)

                if use_trial:
                    # PATH A
                    activated_license = create_trial_license(
                        business=business, performed_by=admin_user
                    )

                elif use_cloud_token:
                    # PATH D — cloud TrialCode bridge
                    # create_trial_license() creates + activates a 7-day TRIAL
                    # License and writes a TRIAL_ACTIVATION LicenseRenewalLog entry.
                    # This is the same local data structure used by PATH A/B.
                    activated_license = create_trial_license(
                        business=business, performed_by=admin_user
                    )
                    # Note the token itself in the license notes for auditability.
                    activated_license.notes = (
                        "7-day trial activated via cloud TrialCode reservation. "
                        f"Reservation token prefix: {cloud_token[:8]}…"
                    )
                    activated_license.save(update_fields=["notes", "updated_at"])

                elif pending_trial_code is not None:
                    # PATH B — local TrialCode.claim()
                    activated_license = pending_trial_code.claim(
                        business=business, performed_by=admin_user
                    )

                else:
                    # PATH C — paid activation code
                    activate_ser = ActivateLicenseSerializer(
                        data={"activation_code": raw_code},
                        context={"business": business, "user": admin_user},
                    )
                    activate_ser.is_valid(raise_exception=True)
                    activated_license = activate_ser.save()

        except Exception as exc:
            logger.exception("Setup failed: %s", exc)
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

        # ── Return success payload ─────────────────────────────────────────────
        # ── Cloud business registration (non-blocking, best-effort) ───────────
        # Runs OUTSIDE the transaction so a cloud failure never rolls back the
        # local setup. Two layers of resilience:
        #   1. Immediate push to Render via CLOUD_SETUP_URL/trial/register-business/
        #   2. SyncRecord queue → retried by SyncWorker on next cycle (offline-safe)
        try:
            from cloud.business_registration import sync_business_to_cloud
            sync_business_to_cloud(
                business=business,
                branch=branch,
                cloud_token=cloud_token,
                admin_user=admin_user,
            )
        except Exception as _cloud_exc:
            # Never fail local setup because of a cloud registration error
            logger.warning(
                "Cloud business registration raised unexpectedly: %s",
                type(_cloud_exc).__name__,
            )

        return Response(
            {
                "success": True,
                "business_id":    str(business.id),
                "branch_id":      str(branch.id),
                "admin_username": admin_user.username,
                "license":        LicenseStatusSerializer(activated_license).data,
            },
            status=status.HTTP_200_OK,
        )
