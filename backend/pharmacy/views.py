from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters

from .models import (
    Medicine,
    Prescription,
    PrescriptionItem,
    DrugInteraction,
    DrugAllergy,
    DrugStockFEFO,
)
from .serializers import (
    MedicineSerializer,
    PrescriptionSerializer,
    PrescriptionItemSerializer,
    DrugInteractionSerializer,
    DrugAllergySerializer,
    DrugStockFEFOSerializer,
)


class MedicineViewSet(viewsets.ModelViewSet):
    queryset = Medicine.objects.all()
    serializer_class = MedicineSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = [
        "business",
        "product",
        "dosage_form",
        "administration_route",
        "drug_class",
        "schedule",
        "requires_prescription",
        "pregnancy_category",
        "is_pharmacist_only",
    ]
    search_fields = [
        "generic_name",
        "brand_name",
        "strength",
        "manufacturer",
        "drug_registration_number",
    ]
    ordering_fields = ["generic_name", "brand_name", "created_at"]


class PrescriptionViewSet(viewsets.ModelViewSet):
    queryset = Prescription.objects.all()
    serializer_class = PrescriptionSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = [
        "business",
        "status",
        "is_repeat",
        "created_by",
        "dispensed_by",
    ]
    search_fields = [
        "prescription_number",
        "patient_name",
        "patient_phone",
        "doctor_name",
        "doctor_reg_number",
        "diagnosis",
    ]
    ordering_fields = ["prescription_number", "prescription_date", "created_at"]

    @action(detail=True, methods=["post"])
    def dispense(self, request, pk=None):
        prescription = self.get_object()
        prescription.status = "DISPENSED"
        prescription.dispensed_by = request.user
        prescription.dispensed_at = timezone.now()
        prescription.save()
        return Response(PrescriptionSerializer(prescription).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        prescription = self.get_object()
        prescription.status = "CANCELLED"
        prescription.save()
        return Response(PrescriptionSerializer(prescription).data)


class PrescriptionItemViewSet(viewsets.ModelViewSet):
    queryset = PrescriptionItem.objects.all()
    serializer_class = PrescriptionItemSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["prescription", "medicine", "product", "variant", "batch"]
    search_fields = ["dosage_instruction", "frequency", "notes"]
    ordering_fields = ["created_at"]


class DrugInteractionViewSet(viewsets.ModelViewSet):
    queryset = DrugInteraction.objects.all()
    serializer_class = DrugInteractionSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["business", "medicine_a", "medicine_b", "severity"]
    search_fields = ["description", "clinical_significance", "management"]
    ordering_fields = ["severity", "created_at"]


class DrugAllergyViewSet(viewsets.ModelViewSet):
    queryset = DrugAllergy.objects.all()
    serializer_class = DrugAllergySerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["business", "customer", "medicine", "reaction_type", "severity"]
    search_fields = ["generic_name", "ingredient_name", "description", "notes"]
    ordering_fields = ["recorded_at", "severity"]


class DrugStockFEFOViewSet(viewsets.ModelViewSet):
    queryset = DrugStockFEFO.objects.all()
    serializer_class = DrugStockFEFOSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["business", "medicine", "product", "variant", "branch", "warehouse"]
    search_fields = []
    ordering_fields = ["total_available_qty", "updated_at"]


class FEFOBatchesView(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def retrieve(self, request, pk=None):
        business = request.query_params.get("business")
        branch = request.query_params.get("branch")

        from inventory.models import Batch

        batches = Batch.objects.filter(product_id=pk)
        if business:
            batches = batches.filter(business_id=business)
        if branch:
            batches = batches.filter(stock__branch_id=branch)

        today = timezone.now().date()
        batches = batches.filter(
            expiry_date__gte=today,
            quantity__gt=0,
        ).order_by("expiry_date")

        result = []
        total_qty = 0
        for b in batches:
            result.append(
                {
                    "batch_id": str(b.id),
                    "batch_number": b.batch_number,
                    "expiry_date": b.expiry_date,
                    "quantity": b.quantity,
                    "unit_cost": b.unit_cost,
                }
            )
            total_qty += b.quantity

        return Response(
            {
                "product_id": pk,
                "total_available_qty": total_qty,
                "batches": result,
                "method": "FEFO",
            }
        )
