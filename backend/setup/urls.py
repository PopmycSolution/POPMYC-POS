from django.urls import path
from setup.views import SetupStatusView, SetupRunView

urlpatterns = [
    path("status/", SetupStatusView.as_view(), name="setup-status"),
    path("run/",    SetupRunView.as_view(),    name="setup-run"),
]
