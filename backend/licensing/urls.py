from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import LicenseViewSet

router = DefaultRouter()
router.register(r"licenses", LicenseViewSet, basename="license")

urlpatterns = [
    path("", include(router.urls)),
]
