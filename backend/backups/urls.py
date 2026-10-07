from django.urls import path, include
from rest_framework.routers import DefaultRouter
from backups.views import (
    BackupViewSet,
    BackupRestoreView,
    DatabaseExportView,
    BackupCreateView,
    BackupListView,
    BackupStatusView,
    BackupValidateView,
    BackupRestoreNewView,
    BackupExportView,
    BackupImportView,
    BackupDeleteFileView,
    CloudBackupUploadView,
    CloudBackupListView,
    CloudBackupDownloadView,
    CloudBackupDeleteView,
)

# NOTE: this urls.py is mounted at api/v1/backups/ in api/urls.py
# Paths here must NOT repeat the "backups/" prefix — it's already in the mount point.

# Use an explicit basename to avoid name-collision with our custom view names.
router = DefaultRouter()
router.register(r"records", BackupViewSet, basename="backup-record")

urlpatterns = [
    # ── Filesystem backup routes (Stage 5.4/5.5) ─────────────────────────────
    path("create/",              BackupCreateView.as_view(),    name="backup-create"),
    path("list/",                BackupListView.as_view(),       name="backup-list"),
    path("status/",              BackupStatusView.as_view(),     name="backup-status"),
    path("validate/",            BackupValidateView.as_view(),   name="backup-validate"),
    path("restore/",             BackupRestoreNewView.as_view(), name="backup-restore"),
    path("export/",              BackupExportView.as_view(),          name="backup-export"),
    path("import/",              BackupImportView.as_view(),          name="backup-import"),
    path("file/<str:filename>/", BackupDeleteFileView.as_view(),      name="backup-delete-file"),

    # ── Cloud backup (disaster recovery) ─────────────────────────────────────
    path("cloud-upload/",              CloudBackupUploadView.as_view(),   name="cloud-backup-upload"),
    path("cloud-list/",                CloudBackupListView.as_view(),     name="cloud-backup-list"),
    path("cloud-download/<str:pk>/",   CloudBackupDownloadView.as_view(), name="cloud-backup-download"),
    path("cloud-delete/<str:pk>/",     CloudBackupDeleteView.as_view(),   name="cloud-backup-delete"),

    # ── Legacy / model-based routes ───────────────────────────────────────────
    path("<uuid:pk>/restore-legacy/", BackupRestoreView.as_view(),  name="backup-restore-legacy"),
    path("database/export/",          DatabaseExportView.as_view(), name="database-export-legacy"),

    # Router last (so specific paths above take priority)
    path("", include(router.urls)),
]
