"""
cloud/license_service.py
========================
CloudLicenseService — reusable wrapper around the existing License model.

Design principles
-----------------
  - Reads the EXISTING licensing system; never duplicates or replaces it.
  - Returns a normalised LicenseStatus dataclass — never a raw License ORM object.
  - NEVER returns activation_code, token hashes, or any internal secrets.
  - Calls License.refresh_expiry_status() (auto-flips ACTIVE → EXPIRED) but
    makes NO other state changes.
  - Safe to call from device authentication, heartbeat, cloud status, and
    future sync endpoints.

Offline safety
--------------
  This service is only called from cloud endpoints.  The local POS, sync
  endpoints, and LicenseCheckMiddleware are completely unaffected.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional

from django.utils import timezone


@dataclass(frozen=True)
class LicenseStatus:
    """
    Normalised, safe representation of a business's license state.

    Attributes
    ----------
    found           True if a license record exists for the business.
    is_active       True if the license currently permits POS/cloud operation.
    is_lifetime     True for LIFETIME licenses (no expiry).
    license_type    "SUBSCRIPTION" | "LIFETIME" | None
    license_state   The raw status value from License.Status choices, or
                    "NO_LICENSE" if no license exists.
    expires_at      Expiry date for SUBSCRIPTION licenses, None otherwise.
    days_remaining  Days until expiry (0 = today/expired), None for LIFETIME.
    start_date      Activation start date, None if not yet activated.
    activated_at    Datetime of activation, None if not yet activated.
    last_checked_at Server timestamp when this status was evaluated.
    """
    found:            bool
    is_active:        bool
    is_lifetime:      bool
    license_type:     Optional[str]
    license_state:    str
    expires_at:       Optional[date]
    days_remaining:   Optional[int]
    start_date:       Optional[date]
    activated_at:     Optional[datetime]
    last_checked_at:  datetime = field(default_factory=timezone.now)

    def as_dict(self) -> dict:
        """Safe dict representation — no activation codes or secrets."""
        return {
            "found":            self.found,
            "is_active":        self.is_active,
            "is_lifetime":      self.is_lifetime,
            "license_type":     self.license_type,
            "license_state":    self.license_state,
            "expires_at":       self.expires_at.isoformat() if self.expires_at else None,
            "days_remaining":   self.days_remaining,
            "start_date":       self.start_date.isoformat() if self.start_date else None,
            "activated_at":     self.activated_at.isoformat() if self.activated_at else None,
            "last_checked_at":  self.last_checked_at.isoformat(),
        }


# ── Sentinel value returned when no license record exists ────────────────────

def _no_license_status() -> LicenseStatus:
    return LicenseStatus(
        found=False,
        is_active=False,
        is_lifetime=False,
        license_type=None,
        license_state="NO_LICENSE",
        expires_at=None,
        days_remaining=None,
        start_date=None,
        activated_at=None,
    )


# ── Service ───────────────────────────────────────────────────────────────────

class CloudLicenseService:
    """
    Reusable license verification service for the cloud layer.

    All methods are class-level (no instance required) for easy import.

    Example usage:
        status = CloudLicenseService.get_status(business)
        if not status.is_active:
            raise PermissionDenied(f"License {status.license_state}")
    """

    @classmethod
    def get_status(cls, business) -> LicenseStatus:
        """
        Return the current LicenseStatus for the given Business instance.

        Calls License.refresh_expiry_status() to auto-flip ACTIVE → EXPIRED
        when the subscription has run out, but makes no other changes.

        Returns a LicenseStatus with found=False if no license record exists.
        """
        from licensing.models import License

        try:
            lic: License = License.objects.select_related("business").get(
                business=business
            )
        except License.DoesNotExist:
            return _no_license_status()

        # Auto-flip ACTIVE → EXPIRED if subscription has run out.
        # This is a safe read-side side-effect — same as what the middleware does.
        lic.refresh_expiry_status()

        return LicenseStatus(
            found=True,
            is_active=lic.is_active,
            is_lifetime=(lic.license_type == License.LicenseType.LIFETIME),
            license_type=lic.license_type,
            license_state=lic.status,
            expires_at=lic.expiry_date,
            days_remaining=lic.days_remaining,
            start_date=lic.start_date,
            activated_at=lic.activated_at,
        )

    @classmethod
    def get_status_for_device(cls, device) -> LicenseStatus:
        """
        Convenience wrapper: fetch license status via a CloudDevice.
        """
        return cls.get_status(device.business)

    @classmethod
    def is_cloud_access_permitted(cls, business) -> tuple[bool, LicenseStatus]:
        """
        Check whether a business may perform cloud operations.

        Returns (allowed: bool, status: LicenseStatus).

        Rules (mirrors the existing LicenseCheckMiddleware logic):
          - LIFETIME + ACTIVE   → permitted
          - SUBSCRIPTION + ACTIVE + not expired → permitted
          - Anything else       → denied

        This method never blocks local POS operation — it is only called
        from cloud views.
        """
        lic_status = cls.get_status(business)
        return lic_status.is_active, lic_status
