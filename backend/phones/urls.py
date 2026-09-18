from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    PhoneBrandViewSet,
    PhoneModelViewSet,
    PhoneVariantViewSet,
    PhoneIMEIViewSet,
    PhoneWarrantyViewSet,
    PhoneHistoryViewSet,
)

router = DefaultRouter()
router.register(r"brands", PhoneBrandViewSet, basename="phone-brand")
router.register(r"models/variants", PhoneVariantViewSet, basename="phone-variant")
router.register(r"models", PhoneModelViewSet, basename="phone-model")
router.register(r"imei", PhoneIMEIViewSet, basename="phone-imei")
router.register(r"warranties", PhoneWarrantyViewSet, basename="phone-warranty")
router.register(r"history", PhoneHistoryViewSet, basename="phone-history")

urlpatterns = [
    path("", include(router.urls)),
]
