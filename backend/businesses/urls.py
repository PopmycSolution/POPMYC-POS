from django.urls import path, include
from rest_framework.routers import DefaultRouter
from businesses.views import (
    BusinessViewSet,
    BusinessSettingsViewSet,
    BusinessModeView,
)

router = DefaultRouter()
router.register(r"businesses", BusinessViewSet)
router.register(r"settings", BusinessSettingsViewSet)

urlpatterns = [
    path("mode/", BusinessModeView.as_view(), name="business-mode"),
    path("", include(router.urls)),
]
