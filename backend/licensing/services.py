"""
licensing/services.py
=====================
Reusable licensing helper functions.

Two distinct activation paths
------------------------------

PATH A — Automatic trial (no code entered by the customer):
  create_trial_license(business)
    → called by setup/views.py when no activation_code is supplied.
    → creates + activates the license immediately.
    → used when the developer installs on-site without pre-issuing a code.

PATH B — Pre-issued trial code (V1 workflow):
  generate_trial_code()
    → developer generates a PENDING TrialCode voucher before installation.
    → gives the code to the customer.
    → customer enters it during the setup wizard.
    → TrialCode.claim() is called; 7-day clock starts at that moment.
    → used when the customer self-installs after receiving a code.

Both paths use the same License / LicenseRenewalLog models.
Neither path duplicates license enforcement logic.
"""

from __future__ import annotations

from datetime import date, timedelta

from django.utils import timezone

from .models import License, LicenseRenewalLog, TrialCode, TRIAL_DAYS


# ── PATH A: Automatic immediate trial ─────────────────────────────────────────

def create_trial_license(business, performed_by=None) -> License:
    """
    Create and immediately activate a 7-day TRIAL license for *business*.

    Used when no pre-issued code exists — typically when the developer
    installs POPMYC POS on-site and does not pre-generate a trial code.

    The 7-day clock starts NOW.

    Raises ValueError if the business already has any license.
    """
    if License.objects.filter(business=business).exists():
        raise ValueError(
            f"Business '{business.name}' already has a license. "
            "A trial cannot be created again."
        )

    today  = date.today()
    expiry = today + timedelta(days=TRIAL_DAYS)

    lic = License.objects.create(
        business     = business,
        license_type = License.LicenseType.TRIAL,
        status       = License.Status.PENDING,
        start_date   = today,
        expiry_date  = expiry,
        notes        = "Automatic 7-day trial — created at first installation.",
    )
    lic.activate()

    LicenseRenewalLog.objects.create(
        license         = lic,
        action          = "TRIAL_ACTIVATION",
        code_used       = lic.activation_code,
        previous_expiry = None,
        new_expiry      = expiry,
        duration_days   = TRIAL_DAYS,
        performed_by    = performed_by,
    )
    return lic


# ── PATH B: Pre-issued trial code ─────────────────────────────────────────────

def generate_trial_code(notes: str = "", created_by=None) -> TrialCode:
    """
    Generate a PENDING trial code voucher.

    The 7-day trial clock does NOT start here — it starts when
    the customer calls TrialCode.claim() (via the setup wizard).

    Parameters
    ----------
    notes:      Optional developer reference (customer name, order ID, etc.)
    created_by: Optional CustomUser who generated the code (for audit).

    Returns
    -------
    A new TrialCode with status=PENDING.
    """
    return TrialCode.objects.create(
        notes      = notes,
        created_by = created_by,
        status     = TrialCode.TrialStatus.PENDING,
    )
