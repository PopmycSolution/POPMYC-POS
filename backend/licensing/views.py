"""
licensing/views.py
==================
API endpoints for the licensing system.

Endpoints (all under /api/v1/licensing/):
  GET    /                           list all licenses         (superuser only)
  POST   /                           create a license          (superuser only)
  GET    /{id}/                       retrieve license detail   (superuser or own business)
  PATCH  /{id}/                       update notes/dates        (superuser only)
  GET    /status/                     current user's business license status
  POST   /activate/                   activate with a code      (any authenticated user)
  POST   /renew/                      renew with a new code     (any authenticated user)
  GET    /{id}/logs/                  renewal audit log         (superuser or own business)
"""
from datetime import date

from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import License, LicenseRenewalLog
from .serializers import (
    LicenseSerializer,
    LicenseStatusSerializer,
    LicenseCreateSerializer,
    ActivateLicenseSerializer,
    RenewLicenseSerializer,
)


class IsSuperUser(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_superuser)


class LicenseViewSet(viewsets.ModelViewSet):
    """
    Full CRUD for superusers.  Regular users can only read their own license
    (handled in get_queryset / get_object).
    """
    serializer_class = LicenseSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        # Guard for schema generation (drf-spectacular uses AnonymousUser)
        if getattr(self, "swagger_fake_view", False):
            return License.objects.none()
        user = self.request.user
        if user.is_superuser:
            return License.objects.select_related("business").all()
        if getattr(user, "business_id", None):
            return License.objects.filter(business_id=user.business_id)
        return License.objects.none()

    # ── Create: superuser only, use dedicated serializer ──────────────────────

    def create(self, request, *args, **kwargs):
        if not request.user.is_superuser:
            return Response(
                {"detail": "Only POPMYC administrators can create licenses."},
                status=status.HTTP_403_FORBIDDEN,
            )
        serializer = LicenseCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        license = serializer.save()
        return Response(LicenseSerializer(license).data, status=status.HTTP_201_CREATED)

    # ── Update: superuser only ─────────────────────────────────────────────────

    def partial_update(self, request, *args, **kwargs):
        if not request.user.is_superuser:
            return Response({"detail": "Forbidden."}, status=status.HTTP_403_FORBIDDEN)
        return super().partial_update(request, *args, **kwargs)

    # ── GET /status/ — current business license state ─────────────────────────

    @action(detail=False, methods=["get"], url_path="status",
            permission_classes=[permissions.IsAuthenticated])
    def license_status(self, request):
        user = request.user
        if not user.business_id:
            return Response(
                {"detail": "No business assigned to your account.", "is_active": False},
                status=status.HTTP_200_OK,
            )
        try:
            lic = License.objects.get(business_id=user.business_id)
        except License.DoesNotExist:
            return Response(
                {
                    "detail": "No license found for this business. Contact POPMYC support.",
                    "is_active": False,
                    "license_type": None,
                    "status": "NO_LICENSE",
                },
                status=status.HTTP_200_OK,
            )
        # Auto-flip to EXPIRED if past date
        lic.refresh_expiry_status()
        return Response(LicenseStatusSerializer(lic).data)

    # ── POST /activate/ ────────────────────────────────────────────────────────

    @action(detail=False, methods=["post"], url_path="activate",
            permission_classes=[permissions.IsAuthenticated])
    def activate(self, request):
        user = request.user
        if not user.business_id:
            return Response(
                {"detail": "No business assigned to your account."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = ActivateLicenseSerializer(
            data=request.data,
            context={"business": user.business, "user": user},
        )
        serializer.is_valid(raise_exception=True)
        license = serializer.save()
        return Response(
            {
                "detail": "License activated successfully.",
                "license": LicenseStatusSerializer(license).data,
            },
            status=status.HTTP_200_OK,
        )

    # ── POST /renew/ ───────────────────────────────────────────────────────────

    @action(detail=False, methods=["post"], url_path="renew",
            permission_classes=[permissions.IsAuthenticated])
    def renew(self, request):
        user = request.user
        if not user.business_id:
            return Response(
                {"detail": "No business assigned to your account."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = RenewLicenseSerializer(
            data=request.data,
            context={
                "business": user.business,
                "user": user,
                "duration_days": int(request.data.get("duration_days", 365)),
            },
        )
        serializer.is_valid(raise_exception=True)
        license = serializer.save()
        return Response(
            {
                "detail": "License renewed successfully.",
                "license": LicenseStatusSerializer(license).data,
            },
            status=status.HTTP_200_OK,
        )

    # ── GET /{id}/logs/ ────────────────────────────────────────────────────────

    @action(detail=True, methods=["get"], url_path="logs",
            permission_classes=[permissions.IsAuthenticated])
    def logs(self, request, pk=None):
        license = self.get_object()
        user = request.user
        if not user.is_superuser and str(getattr(user, "business_id", "")) != str(license.business_id):
            return Response({"detail": "Forbidden."}, status=status.HTTP_403_FORBIDDEN)
        logs = LicenseRenewalLog.objects.filter(license=license).order_by("-created_at")
        data = [
            {
                "id": str(log.id),
                "action": log.action,
                "code_used": log.code_used,
                "previous_expiry": log.previous_expiry,
                "new_expiry": log.new_expiry,
                "duration_days": log.duration_days,
                "performed_by": log.performed_by.username if log.performed_by else None,
                "created_at": log.created_at,
            }
            for log in logs
        ]
        return Response(data)
