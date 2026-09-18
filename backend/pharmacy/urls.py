from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    MedicineViewSet,
    PrescriptionViewSet,
    PrescriptionItemViewSet,
    DrugInteractionViewSet,
    DrugAllergyViewSet,
    DrugStockFEFOViewSet,
    FEFOBatchesView,
)

router = DefaultRouter()
router.register(r"medicines", MedicineViewSet, basename="medicine")
router.register(r"prescriptions/items", PrescriptionItemViewSet, basename="prescription-item")
router.register(r"prescriptions", PrescriptionViewSet, basename="prescription")
router.register(r"interactions", DrugInteractionViewSet, basename="drug-interaction")
router.register(r"allergies", DrugAllergyViewSet, basename="drug-allergy")
router.register(r"fefo-stock", DrugStockFEFOViewSet, basename="drug-stock-fefo")

urlpatterns = [
    path("", include(router.urls)),
    path("fefo/<uuid:pk>/", FEFOBatchesView.as_view({"get": "retrieve"}), name="fefo-batches"),
]
