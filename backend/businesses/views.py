from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.decorators import action
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter

from common.mixins import BusinessScopedMixin

from businesses.models import Business, BusinessSettings
from businesses.serializers import (
    BusinessSerializer,
    BusinessSettingsSerializer,
    TaxConfigWriteSerializer,
    PricingConfigWriteSerializer,
    InventoryModeWriteSerializer,
    BranchModeWriteSerializer,
    BusinessSettingsPublicSerializer,
)

# Roles that may change pricing settings
_PRICING_ADMIN_ROLES = {"SUPER_ADMIN", "super_admin", "ADMIN", "admin"}


def _can_manage_pricing(user) -> bool:
    """Super Admin and Admin can manage pricing configuration."""
    if user.is_superuser or user.is_staff:
        return True
    role = getattr(user, "role", "") or ""
    return str(role).upper() in {"SUPER_ADMIN", "ADMIN"}


class BusinessViewSet(viewsets.ModelViewSet):
    """
    Business IS the tenant root.
    Non-superusers see only their own business (filter by id, not business FK).
    Superusers see all businesses.
    """
    queryset = Business.objects.all()
    serializer_class = BusinessSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business_category", "is_active", "currency"]
    search_fields = ["name", "address", "phone", "email", "tin"]
    ordering_fields = ["created_at", "updated_at", "name"]
    ordering = ["-created_at"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Business.objects.none()
        qs = super().get_queryset()
        user = self.request.user
        if user.is_superuser:
            return qs
        if user.business_id:
            return qs.filter(id=user.business_id)
        return qs.none()


class BusinessSettingsViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = BusinessSettings.objects.all()
    serializer_class = BusinessSettingsSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business"]
    search_fields = []
    ordering_fields = ["created_at", "updated_at"]
    ordering = ["-created_at"]

    @action(detail=True, methods=["put", "patch"], url_path="tax-config")
    def tax_config(self, request, pk=None):
        instance = self.get_object()
        partial = request.method == "PATCH"
        serializer = TaxConfigWriteSerializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    @action(detail=True, methods=["put", "patch"], url_path="pricing-config")
    def pricing_config(self, request, pk=None):
        """
        Update pricing configuration for a business.
        Only Admin and Super Admin are permitted.

        PATCH /api/v1/businesses/settings/{id}/pricing-config/
        Body: { "allow_cashier_price_negotiation": true/false }
        """
        if not _can_manage_pricing(request.user):
            return Response(
                {"detail": "Only Admin and Super Admin can modify pricing configuration."},
                status=status.HTTP_403_FORBIDDEN,
            )
        instance = self.get_object()
        partial = request.method == "PATCH"
        serializer = PricingConfigWriteSerializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    @action(detail=True, methods=["put", "patch"], url_path="inventory-mode")
    def inventory_mode(self, request, pk=None):
        """
        Update the inventory mode for a business.
        Only Admin and Super Admin are permitted.

        PATCH /api/v1/businesses/settings/{id}/inventory-mode/
        Body: { "inventory_mode": "STOCK_ENABLED" | "SALES_ONLY" }
        """
        if not _can_manage_pricing(request.user):
            return Response(
                {"detail": "Only Admin and Super Admin can modify inventory mode."},
                status=status.HTTP_403_FORBIDDEN,
            )
        instance = self.get_object()
        partial = request.method == "PATCH"
        serializer = InventoryModeWriteSerializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        # Return public summary so frontend gets stock_enabled computed field
        return Response(BusinessSettingsPublicSerializer(instance).data)

    @action(detail=True, methods=["put", "patch"], url_path="branch-mode")
    def branch_mode(self, request, pk=None):
        """
        Update the branch mode for a business.
        Only Admin and Super Admin are permitted.

        PATCH /api/v1/businesses/settings/{id}/branch-mode/
        Body: { "branch_mode": "SINGLE" | "MULTI" }
        """
        if not _can_manage_pricing(request.user):
            return Response(
                {"detail": "Only Admin and Super Admin can modify branch mode."},
                status=status.HTTP_403_FORBIDDEN,
            )
        instance = self.get_object()
        partial = request.method == "PATCH"
        serializer = BranchModeWriteSerializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(BusinessSettingsPublicSerializer(instance).data)

    @action(detail=False, methods=["get"], url_path="my-settings")
    def my_settings(self, request):
        """
        GET /api/v1/businesses/settings/my-settings/
        Returns the current user's business settings (public subset).
        Useful for the frontend to determine inventory_mode / stock_enabled
        without having to know the settings PK.
        """
        user = request.user
        if not user.business_id:
            return Response(
                {"detail": "No business assigned."},
                status=status.HTTP_404_NOT_FOUND,
            )
        settings_obj, _ = BusinessSettings.objects.get_or_create(business_id=user.business_id)
        return Response(BusinessSettingsPublicSerializer(settings_obj).data)


class BusinessModeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        mode = request.data.get("mode")
        if mode not in ["pharmacy", "phone_shop"]:
            return Response(
                {"detail": "Mode must be 'pharmacy' or 'phone_shop'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = request.user
        business = user.business
        if not business:
            return Response(
                {"detail": "User has no associated business."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        business.business_type = mode
        business.save(update_fields=["business_type", "updated_at"])

        settings, _ = BusinessSettings.objects.get_or_create(business=business)
        if mode == "pharmacy":
            settings.inventory_config["pharmacy_enabled"] = True
            settings.inventory_config["phone_shop_enabled"] = False
        elif mode == "phone_shop":
            settings.inventory_config["phone_shop_enabled"] = True
            settings.inventory_config["pharmacy_enabled"] = False
        settings.save(update_fields=["inventory_config", "updated_at"])

        return Response(
            {
                "detail": f"Business mode set to {mode}.",
                "business_type": business.business_type,
                "inventory_config": settings.inventory_config,
            },
            status=status.HTTP_200_OK,
        )
