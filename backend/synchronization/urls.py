from django.urls import path

from synchronization.views import (
    SyncDeviceView,
    SyncDownloadView,
    SyncUploadView,
    SyncStatusView,
)

urlpatterns = [
    path("upload/",  SyncUploadView.as_view(),  name="sync-upload"),
    path("download/",SyncDownloadView.as_view(),name="sync-download"),
    path("device/",  SyncDeviceView.as_view(),  name="sync-device"),
    path("status/",  SyncStatusView.as_view(),  name="sync-status"),
]