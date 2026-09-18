"""
common/mixins.py
================
Shared DRF view mixins for the POPMYC POS multi-business architecture.

BusinessScopedMixin
-------------------
Automatically scopes every queryset to the authenticated user's business.

Rules:
  - Django superusers (is_superuser=True) can see ALL records across ALL businesses.
    These are platform-level administrators, not per-business admins.
  - Regular users with a business assigned → scoped to that business only.
  - Users with NO business assigned → empty queryset (fail-safe, no data leak).

Usage:
    class MyViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
        queryset = MyModel.objects.all()
        ...

The model MUST have a `business` ForeignKey field pointing to
businesses.Business for this mixin to work correctly.
"""


class BusinessScopedMixin:
    """
    Automatically scope every queryset to the authenticated user's business.
    Apply as the FIRST base class so it overrides get_queryset correctly.
    """

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user

        # Platform super-admin: sees everything across all businesses.
        if user.is_superuser:
            return qs

        # Business-scoped user: filter to their business.
        if hasattr(user, "business") and user.business_id:
            return qs.filter(business=user.business)

        # No business assigned → return nothing (safe default).
        return qs.none()
