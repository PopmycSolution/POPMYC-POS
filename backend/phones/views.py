from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters

from .models import (
    PhoneBrand,
    PhoneModel,
    PhoneVariant,
    PhoneIMEI,
    PhoneWarranty,
    PhoneHistory,
)
from .serializers import (
    PhoneBrandSerializer,
    PhoneModelSerializer,
    PhoneVariantSerializer,
    PhoneIMEISerializer,
    PhoneWarrantySerializer,
    PhoneHistorySerializer,
)


class PhoneBrandViewSet(viewsets.ModelViewSet):
    queryset = PhoneBrand.objects.all()
    serializer_class = PhoneBrandSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["business", "is_active"]
    search_fields = ["name", "code", "country"]
    ordering_fields = ["name", "code", "created_at"]


class PhoneModelViewSet(viewsets.ModelViewSet):
    queryset = PhoneModel.objects.all()
    serializer_class = PhoneModelSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = [
        "business",
        "brand",
        "product",
        "sim_type",
        "has_5g",
        "is_active",
    ]
    search_fields = [
        "model_name",
        "model_code",
        "operating_system",
        "processor",
    ]
    ordering_fields = ["model_name", "release_year", "created_at"]


class PhoneVariantViewSet(viewsets.ModelViewSet):
    queryset = PhoneVariant.objects.all()
    serializer_class = PhoneVariantSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["business", "phone_model", "product_variant", "color", "is_active"]
    search_fields = ["color", "sku_suffix"]
    ordering_fields = ["storage_gb", "ram_gb", "created_at"]


class PhoneIMEIViewSet(viewsets.ModelViewSet):
    queryset = PhoneIMEI.objects.all()
    serializer_class = PhoneIMEISerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = [
        "business",
        "phone_model",
        "phone_variant",
        "product",
        "variant",
        "sim_lock_status",
        "grade_condition",
        "supplier",
        "branch",
        "warehouse",
        "status",
        "sale",
        "customer",
    ]
    search_fields = [
        "imei_1",
        "imei_2",
        "serial_number",
        "carrier",
        "physical_condition_notes",
    ]
    ordering_fields = ["purchase_date", "created_at"]

    def perform_update(self, serializer):
        instance = serializer.save()
        instance.last_status_change = timezone.now()
        instance.save()

        old_status = PhoneIMEI.objects.filter(pk=instance.pk).values("status").first()
        old_status_val = old_status["status"] if old_status else ""
        if old_status_val != instance.status:
            PhoneHistory.objects.create(
                business=instance.business,
                imei=instance,
                status_from=old_status_val,
                status_to=instance.status,
                event_type="WRITTEN_OFF" if instance.status == "WRITE_OFF" else (
                    "SOLD" if instance.status == "SOLD" else (
                        "RETURNED" if instance.status == "RETURNED" else (
                            "LOST" if instance.status == "LOST" else (
                                "STOLEN" if instance.status == "STOLEN" else "RECEIVED_STOCK"
                            )
                        )
                    )
                ),
                done_by=self.request.user if self.request.user.is_authenticated else None,
            )
        return instance


class PhoneWarrantyViewSet(viewsets.ModelViewSet):
    queryset = PhoneWarranty.objects.all()
    serializer_class = PhoneWarrantySerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = [
        "business",
        "imei",
        "product",
        "customer",
        "sale",
        "warranty_type",
        "status",
    ]
    search_fields = ["warranty_number", "terms", "notes"]
    ordering_fields = ["start_date", "end_date", "created_at"]


class PhoneHistoryViewSet(viewsets.ModelViewSet):
    queryset = PhoneHistory.objects.all()
    serializer_class = PhoneHistorySerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = [
        "business",
        "imei",
        "event_type",
        "status_from",
        "status_to",
        "done_by",
    ]
    search_fields = ["notes", "reference_type"]
    ordering_fields = ["event_date", "created_at"]
    http_method_names = ["get", "list", "retrieve"]
