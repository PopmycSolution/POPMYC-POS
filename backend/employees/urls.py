from django.urls import path, include
from rest_framework.routers import DefaultRouter
from employees.views import (
    EmployeeViewSet,
    ShiftViewSet,
    CashDrawerEventViewSet,
)

router = DefaultRouter()
router.register(r"employees", EmployeeViewSet)
router.register(r"shifts", ShiftViewSet)
router.register(r"cash-drawer-events", CashDrawerEventViewSet)

urlpatterns = [
    path("", include(router.urls)),
]
