from django.urls import path, include
from rest_framework.routers import DefaultRouter
from branches.views import (
    BranchViewSet,
    WarehouseViewSet,
    RegisterViewSet,
)

router = DefaultRouter()
router.register(r"branches", BranchViewSet)
router.register(r"warehouses", WarehouseViewSet)
router.register(r"registers", RegisterViewSet)

urlpatterns = [
    path("", include(router.urls)),
]
