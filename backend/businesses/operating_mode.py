"""
businesses/operating_mode.py
============================
Reusable helpers for enforcing the Business Operating Mode.

Usage in views:
    from businesses.operating_mode import require_pos, require_inventory

    class MyViewSet(...):
        def create(self, request, *args, **kwargs):
            err = require_pos(request.user)
            if err:
                return err
            return super().create(request, *args, **kwargs)
"""
from rest_framework import status
from rest_framework.response import Response


def _get_settings(user):
    """Return the BusinessSettings for the authenticated user or None."""
    from businesses.models import BusinessSettings
    if not user or not getattr(user, "business_id", None):
        return None
    try:
        return BusinessSettings.objects.get(business_id=user.business_id)
    except BusinessSettings.DoesNotExist:
        return None


def require_pos(user):
    """
    Returns a 403 Response if the business is INVENTORY_ONLY (POS/sales blocked),
    or None when the operation is allowed.

    Intended for any view that creates or processes a sale.
    """
    settings = _get_settings(user)
    if settings and settings.is_inventory_only:
        return Response(
            {
                "detail": (
                    "This business is configured for Inventory Only mode. "
                    "New sales cannot be created. "
                    "Switch to Full POS or POS Only in Business Settings."
                ),
                "code": "OPERATING_MODE_RESTRICTION",
                "operating_mode": settings.effective_operating_mode,
            },
            status=status.HTTP_403_FORBIDDEN,
        )
    return None


def require_inventory(user):
    """
    Returns a 403 Response if the business is POS_ONLY (inventory management blocked),
    or None when the operation is allowed.

    Intended for views that perform stock adjustments, transfers, purchases, etc.
    Note: even in POS_ONLY the underlying data is not deleted; only management
    workflows are restricted.
    """
    settings = _get_settings(user)
    if settings and settings.is_pos_only:
        return Response(
            {
                "detail": (
                    "This business is configured for POS Only mode. "
                    "Inventory management operations are restricted. "
                    "Switch to Full POS or Inventory Only in Business Settings."
                ),
                "code": "OPERATING_MODE_RESTRICTION",
                "operating_mode": settings.effective_operating_mode,
            },
            status=status.HTTP_403_FORBIDDEN,
        )
    return None


def get_effective_mode(user) -> str:
    """
    Return the effective operating mode for the user's business.
    Falls back to 'FULL_POS' when no settings row exists.
    """
    settings = _get_settings(user)
    if settings:
        return settings.effective_operating_mode
    return "FULL_POS"
