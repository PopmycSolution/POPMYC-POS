"""
licensing/models.py
===================
Simple license system for POPMYC POS.

Two license types:
  SUBSCRIPTION  — has an expiry date, can be renewed with an activation code
  LIFETIME      — no expiry, active permanently

One License per Business. Activation codes are unique across the table.
"""
import uuid
import secrets
import string
from datetime import date, timedelta

from django.db import models
from django.utils import timezone
from django.utils.translation import gettext_lazy as _


def _generate_code():
    """
    Generate a human-readable 20-char activation code in groups of 4.
    Example: ABCD-1234-EFGH-5678-IJKL
    Characters are uppercase letters + digits, ambiguous chars removed.
    """
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I
    raw = "".join(secrets.choice(alphabet) for _ in range(20))
    return "-".join(raw[i:i+4] for i in range(0, 20, 4))


class License(models.Model):

    # ── Choices ────────────────────────────────────────────────────────────────
    class LicenseType(models.TextChoices):
        SUBSCRIPTION = "SUBSCRIPTION", _("Subscription")
        LIFETIME     = "LIFETIME",     _("Lifetime")
        TRIAL        = "TRIAL",        _("7-Day Trial")

    class Status(models.TextChoices):
        PENDING  = "PENDING",  _("Pending Activation")
        ACTIVE   = "ACTIVE",   _("Active")
        EXPIRED  = "EXPIRED",  _("Expired")
        SUSPENDED = "SUSPENDED", _("Suspended")
        REVOKED  = "REVOKED",  _("Revoked")

    # ── Fields ─────────────────────────────────────────────────────────────────
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    business = models.OneToOneField(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="license",
        verbose_name=_("Business"),
    )

    license_type = models.CharField(
        max_length=20,
        choices=LicenseType.choices,
        default=LicenseType.SUBSCRIPTION,
        verbose_name=_("License Type"),
    )

    activation_code = models.CharField(
        max_length=30,
        unique=True,
        default=_generate_code,
        verbose_name=_("Activation Code"),
        help_text=_("Share this code with the customer to activate or renew their license."),
    )

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
        verbose_name=_("Status"),
    )

    # Dates
    start_date  = models.DateField(null=True, blank=True, verbose_name=_("Start Date"))
    expiry_date = models.DateField(null=True, blank=True, verbose_name=_("Expiry Date"),
                                   help_text=_("Leave blank for Lifetime licenses."))
    activated_at = models.DateTimeField(null=True, blank=True, verbose_name=_("Activated At"))
    created_at   = models.DateTimeField(auto_now_add=True, verbose_name=_("Created At"))
    updated_at   = models.DateTimeField(auto_now=True)

    # POPMYC internal notes
    notes = models.TextField(blank=True, verbose_name=_("Internal Notes"))

    class Meta:
        db_table = "licensing_license"
        verbose_name = _("License")
        verbose_name_plural = _("Licenses")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.business.name} — {self.get_license_type_display()} [{self.status}]"

    # ── Computed helpers ───────────────────────────────────────────────────────

    @property
    def is_active(self):
        """True if the license allows the business to operate right now."""
        if self.status not in (self.Status.ACTIVE,):
            return False
        if self.license_type == self.LicenseType.LIFETIME:
            return True
        # SUBSCRIPTION and TRIAL both have an expiry date
        if self.expiry_date is None:
            return False
        return date.today() <= self.expiry_date

    @property
    def is_expired(self):
        if self.license_type == self.LicenseType.LIFETIME:
            return False
        if self.status != self.Status.ACTIVE:
            return False
        if self.expiry_date is None:
            return True
        return date.today() > self.expiry_date

    @property
    def days_remaining(self):
        if self.license_type == self.LicenseType.LIFETIME:
            return None  # unlimited
        if not self.expiry_date:
            return 0
        delta = self.expiry_date - date.today()
        return max(delta.days, 0)

    @property
    def is_trial(self) -> bool:
        """Convenience: True when this is an auto-created 7-day trial license."""
        return self.license_type == self.LicenseType.TRIAL

    # ── Mutation helpers ───────────────────────────────────────────────────────

    def activate(self):
        """Mark license as active and stamp the activation timestamp."""
        self.status = self.Status.ACTIVE
        self.activated_at = timezone.now()
        if self.start_date is None:
            self.start_date = date.today()
        self.save(update_fields=["status", "activated_at", "start_date", "updated_at"])

    def refresh_expiry_status(self):
        """
        Call periodically (or on each request check) to flip status to EXPIRED
        when the expiry_date has passed.  Safe to call on lifetime licenses.
        """
        if self.license_type == self.LicenseType.LIFETIME:
            return
        if self.status == self.Status.ACTIVE and self.expiry_date and date.today() > self.expiry_date:
            self.status = self.Status.EXPIRED
            self.save(update_fields=["status", "updated_at"])

    def renew(self, new_activation_code, duration_days=365, performed_by=None):
        """
        Renew a SUBSCRIPTION license.
        - Validates the new activation code belongs to this license.
        - Extends expiry from today (or current expiry if still in future) by duration_days.
        - Generates a fresh activation code so the old one cannot be reused.
        - Always writes a LicenseRenewalLog entry.

        Raises ValueError on invalid code or wrong license type.
        """
        if self.license_type != self.LicenseType.SUBSCRIPTION:
            raise ValueError("Only SUBSCRIPTION licenses can be renewed.")
        if self.activation_code != new_activation_code.strip().upper():
            raise ValueError("Invalid activation code.")

        code_used   = self.activation_code
        prev_expiry = self.expiry_date

        base = max(self.expiry_date, date.today()) if self.expiry_date else date.today()
        self.expiry_date = base + timedelta(days=duration_days)
        self.status = self.Status.ACTIVE
        # Rotate the code so it cannot be reused
        self.activation_code = _generate_code()
        self.save(update_fields=["expiry_date", "status", "activation_code", "updated_at"])

        # Always write an audit log from the model layer
        LicenseRenewalLog.objects.create(
            license=self,
            action="RENEWAL",
            code_used=code_used,
            previous_expiry=prev_expiry,
            new_expiry=self.expiry_date,
            duration_days=duration_days,
            performed_by=performed_by,
        )
        return self


class TrialCode(models.Model):
    """
    A single-use trial voucher generated by POPMYC staff.

    Workflow:
      1. Developer calls generate_trial_code() (or uses admin action).
      2. Code stays PENDING — the 7-day clock has NOT started.
      3. Customer enters code during the setup wizard.
      4. Backend validates code is PENDING and not expired.
      5. Backend creates + activates a 7-day TRIAL License for the business.
      6. TrialCode.status → USED, linked to the resulting License.

    This is intentionally separate from License so trial vouchers can exist
    before a Business is created on the customer's machine.
    """

    class TrialStatus(models.TextChoices):
        PENDING  = "PENDING",  _("Pending — not yet activated")
        USED     = "USED",     _("Used — activated by a customer")
        REVOKED  = "REVOKED",  _("Revoked")

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    code = models.CharField(
        max_length=30,
        unique=True,
        default=_generate_code,
        verbose_name=_("Trial Code"),
        help_text=_("Share this code with the customer to activate their 7-day trial."),
    )

    status = models.CharField(
        max_length=20,
        choices=TrialStatus.choices,
        default=TrialStatus.PENDING,
        verbose_name=_("Status"),
        db_index=True,
    )

    # Notes / customer reference (filled in by the developer when generating)
    notes = models.TextField(
        blank=True,
        verbose_name=_("Notes"),
        help_text=_("Internal reference, e.g. customer name or order ID."),
    )

    # Populated once the customer activates the code
    activated_license = models.OneToOneField(
        "License",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="trial_code",
        verbose_name=_("Activated License"),
    )

    activated_at = models.DateTimeField(null=True, blank=True, verbose_name=_("Activated At"))

    created_by = models.ForeignKey(
        "accounts.CustomUser",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
        verbose_name=_("Created By"),
    )

    created_at = models.DateTimeField(auto_now_add=True, verbose_name=_("Created At"))
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "licensing_trial_code"
        verbose_name = _("Trial Code")
        verbose_name_plural = _("Trial Codes")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.code} [{self.status}]"

    # ── Helpers ────────────────────────────────────────────────────────────────

    @property
    def is_usable(self) -> bool:
        """True if the code can still be used to start a trial."""
        return self.status == self.TrialStatus.PENDING

    def claim(self, business, performed_by=None) -> "License":
        """
        Claim this trial code for *business* and return the activated License.

        - Creates a TRIAL License with status=PENDING, then activates it
          so the 7-day clock starts NOW (at claim time, not at code generation).
        - Marks this TrialCode as USED.
        - All writes are done atomically by the caller's transaction.

        Raises ValueError if the code is not usable.
        """
        from django.utils import timezone as tz
        from datetime import date, timedelta

        if not self.is_usable:
            raise ValueError(
                f"Trial code {self.code!r} cannot be used — status is {self.status}."
            )

        # Guard: business must not already have a license
        if License.objects.filter(business=business).exists():
            raise ValueError(
                f"Business '{business.name}' already has a license."
            )

        today  = date.today()
        expiry = today + timedelta(days=TRIAL_DAYS)

        lic = License.objects.create(
            business     = business,
            license_type = License.LicenseType.TRIAL,
            status       = License.Status.PENDING,
            start_date   = today,
            expiry_date  = expiry,
            notes        = f"7-day trial activated from code {self.code}.",
        )
        # activate() sets status=ACTIVE, activated_at=now
        lic.activate()

        # Audit trail
        LicenseRenewalLog.objects.create(
            license         = lic,
            action          = "TRIAL_ACTIVATION",
            code_used       = self.code,
            previous_expiry = None,
            new_expiry      = expiry,
            duration_days   = TRIAL_DAYS,
            performed_by    = performed_by,
        )

        # Mark this voucher as used
        self.status            = self.TrialStatus.USED
        self.activated_license = lic
        self.activated_at      = tz.now()
        self.save(update_fields=["status", "activated_license", "activated_at", "updated_at"])

        return lic


TRIAL_DAYS = 7   # kept here so both models.py and services.py share the constant


class LicenseRenewalLog(models.Model):
    """
    Audit trail — one row for every successful renewal or initial activation.
    Keeps the used code for reference even after the main code has been rotated.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    license = models.ForeignKey(
        License,
        on_delete=models.CASCADE,
        related_name="renewal_logs",
    )
    action = models.CharField(max_length=20, default="RENEWAL")  # ACTIVATION / RENEWAL
    code_used = models.CharField(max_length=30)
    previous_expiry = models.DateField(null=True, blank=True)
    new_expiry = models.DateField(null=True, blank=True)
    duration_days = models.IntegerField(default=365)
    performed_by = models.ForeignKey(
        "accounts.CustomUser",
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "licensing_renewal_log"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.license.business.name} {self.action} {self.created_at:%Y-%m-%d}"
