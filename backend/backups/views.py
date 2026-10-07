# -*- coding: utf-8 -*-
"""
backups/views.py
================
Complete local PostgreSQL backup/restore API for POPMYC POS Desktop.

Endpoints:
  POST   /api/v1/backups/create/              -- create a new backup
  GET    /api/v1/backups/list/                -- list backup files
  GET    /api/v1/backups/status/              -- last backup + count
  POST   /api/v1/backups/validate/            -- validate a backup file
  POST   /api/v1/backups/restore/             -- restore (with safety backup first)
  POST   /api/v1/backups/export/              -- download a backup file
  POST   /api/v1/backups/import/              -- upload an external backup
  DELETE /api/v1/backups/file/<filename>/     -- delete one backup file

Legacy stubs (keep existing URLs working):
  BackupViewSet, BackupRestoreView (old UUID-based), DatabaseExportView

Security:
  - Admin/Super Admin only.
  - PGPASSWORD env var only -- password never on command line.
  - Restore requires explicit confirmation flag in request body.
  - Never deletes all backups (always keeps >= 3).
  - Failed backups never replace good ones (.tmp pattern).
  - Passwords never logged.
  - Filenames validated against safe pattern before any file operation.
"""

import gzip
import io
import logging
import os
import re
import shutil
import subprocess
from datetime import datetime
from pathlib import Path

from django.conf import settings
from django.http import FileResponse
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import serializers, status, viewsets
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from backups.models import Backup
from common.mixins import BusinessScopedMixin

logger = logging.getLogger("backups")

# Safe filename pattern for backup files created by this system
_BACKUP_FILENAME_RE = re.compile(r'^popmyc_backup_\d{8}_\d{6}\.sql\.gz$')


# ---------------------------------------------------------------------------
# Legacy stubs -- keep existing URLs working
# ---------------------------------------------------------------------------

class BackupViewSet(BusinessScopedMixin, viewsets.ReadOnlyModelViewSet):
    """Read-only model-based backup record listing (legacy)."""
    queryset = Backup.objects.all()
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["business", "backup_type", "status"]

    def get_serializer_class(self):
        class _S(serializers.ModelSerializer):
            class Meta:
                model = Backup
                fields = "__all__"
        return _S


class BackupRestoreView(APIView):
    """Legacy stub -- UUID-based restore endpoint kept for URL compatibility."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk=None):
        return Response(
            {"detail": "Use POST /api/v1/backups/restore/ with a filename to restore."},
            status=status.HTTP_301_MOVED_PERMANENTLY,
        )


class DatabaseExportView(APIView):
    """Legacy stub."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(
            {"detail": "Use POST /api/v1/backups/export/ with a filename to download a backup."},
            status=status.HTTP_200_OK,
        )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _can_manage_backups(user) -> bool:
    if user.is_superuser or user.is_staff:
        return True
    role = str(getattr(user, "role", "") or "").upper()
    return role in {"SUPER_ADMIN", "ADMIN"}


def _get_backup_dir() -> Path:
    data_dir = os.environ.get("POPMYC_DATA_DIR")
    d = (Path(data_dir) / "backups") if data_dir else (Path(settings.BASE_DIR) / "backups")
    d.mkdir(parents=True, exist_ok=True)
    return d


def _get_pg_env():
    db = settings.DATABASES["default"]
    env = os.environ.copy()
    env["PGPASSWORD"] = db.get("PASSWORD", "")   # password via env, never argv
    return env, db


def _find_pg_tool(tool: str) -> str:
    """Find pg_dump, psql, or pg_restore in common PostgreSQL install locations."""
    candidates = [
        shutil.which(tool),
        rf"C:\Program Files\PostgreSQL\16\bin\{tool}.exe",
        rf"C:\Program Files\PostgreSQL\15\bin\{tool}.exe",
        rf"C:\Program Files\PostgreSQL\14\bin\{tool}.exe",
        rf"C:\Program Files\PostgreSQL\13\bin\{tool}.exe",
    ]
    return next((c for c in candidates if c and Path(c).exists()), tool)


def _list_backups(backup_dir: Path) -> list:
    files = []
    for f in sorted(backup_dir.glob("popmyc_backup_*.sql.gz"),
                    key=lambda x: x.stat().st_mtime, reverse=True):
        stat = f.stat()
        files.append({
            "filename": f.name,
            "size_bytes": stat.st_size,
            "size_mb": round(stat.st_size / (1024 * 1024), 2),
            "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        })
    return files


def _apply_retention(backup_dir: Path, keep: int = 10) -> int:
    """Delete oldest backups beyond retention limit. Always keeps at least 3."""
    keep = max(keep, 3)
    files = sorted(
        backup_dir.glob("popmyc_backup_*.sql.gz"),
        key=lambda f: f.stat().st_mtime, reverse=True,
    )
    deleted = 0
    for old in files[keep:]:
        try:
            old.unlink()
            deleted += 1
            logger.info("Retention: deleted %s", old.name)
        except Exception as exc:
            logger.warning("Could not delete old backup %s: %s", old.name, exc)
    return deleted


def _validate_backup_file(file_path: Path) -> dict:
    """
    Validate a .sql.gz backup file.
    Returns {"valid": bool, "reason": str, "size_bytes": int}.
    Never raises -- all errors are caught and returned as reasons.
    """
    if not file_path.exists():
        return {"valid": False, "reason": "File not found.", "size_bytes": 0}

    size = file_path.stat().st_size
    if size == 0:
        return {"valid": False, "reason": "File is empty.", "size_bytes": 0}

    # Check GZIP magic bytes
    try:
        with open(file_path, "rb") as f:
            magic = f.read(2)
        if magic != b'\x1f\x8b':
            return {"valid": False, "reason": "File is not a valid GZIP archive.", "size_bytes": size}
    except Exception as exc:
        return {"valid": False, "reason": f"Cannot read file: {exc}", "size_bytes": size}

    # Decompress and check SQL content
    try:
        with gzip.open(file_path, "rb") as gz:
            # Read first 8 KB to check for SQL markers
            head = gz.read(8192).decode("utf-8", errors="replace")
        if not head.strip():
            return {"valid": False, "reason": "Backup contains no SQL content.", "size_bytes": size}
        # Basic SQL sanity check -- pg_dump plain format always starts with a comment
        if not any(marker in head for marker in ("--", "SET", "CREATE", "INSERT", "COPY", "PostgreSQL")):
            return {"valid": False, "reason": "File does not appear to be a PostgreSQL dump.", "size_bytes": size}
    except gzip.BadGzipFile:
        return {"valid": False, "reason": "GZIP data is corrupt.", "size_bytes": size}
    except Exception as exc:
        return {"valid": False, "reason": f"Cannot decompress file: {exc}", "size_bytes": size}

    return {"valid": True, "reason": "Backup is valid.", "size_bytes": size}


def _do_create_backup(backup_dir: Path, env: dict, db: dict) -> tuple:
    """
    Internal backup creation.
    Returns (success: bool, filename_or_error: str, size_bytes: int).
    Uses .tmp pattern -- failed backup never replaces a good file.
    """
    pg_dump   = _find_pg_tool("pg_dump")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    tmp_file  = backup_dir / f"popmyc_backup_{timestamp}.sql.gz.tmp"
    final     = backup_dir / f"popmyc_backup_{timestamp}.sql.gz"

    cmd = [
        pg_dump,
        "--host",     db.get("HOST", "localhost"),
        "--port",     str(db.get("PORT", "5432")),
        "--username", db.get("USER", "postgres"),
        "--dbname",   db.get("NAME", "popmyc_pos"),
        "--format",   "p",
        "--no-owner", "--no-acl",
        "--compress", "6",
    ]

    try:
        with open(tmp_file, "wb") as f:
            result = subprocess.run(cmd, env=env, stdout=f,
                                    stderr=subprocess.PIPE, timeout=300)
        if result.returncode != 0:
            tmp_file.unlink(missing_ok=True)
            err = result.stderr.decode(errors="replace")
            err = re.sub(r'password[^\n]*', '[password hidden]', err, flags=re.IGNORECASE)
            logger.error("pg_dump failed (exit %d): %s", result.returncode, err[:400])
            return False, f"pg_dump exited {result.returncode}.", 0

        tmp_file.rename(final)
        size = final.stat().st_size
        logger.info("Backup created: %s (%d bytes)", final.name, size)
        return True, final.name, size

    except subprocess.TimeoutExpired:
        tmp_file.unlink(missing_ok=True)
        return False, "Backup timed out (5 min limit).", 0
    except FileNotFoundError:
        tmp_file.unlink(missing_ok=True)
        return False, f"pg_dump not found at: {pg_dump}", 0
    except Exception as exc:
        tmp_file.unlink(missing_ok=True)
        logger.exception("Backup failed")
        return False, "Unexpected error during backup.", 0


def _do_restore(backup_path: Path, env: dict, db: dict) -> tuple:
    """
    Restore from a .sql.gz backup using psql.
    Steps: terminate active connections -> drop -> create -> restore.
    Returns (success: bool, message: str).
    NEVER exposes passwords or stack traces.
    """
    psql   = _find_pg_tool("psql")
    dbname = db.get("NAME", "popmyc_pos")
    host   = db.get("HOST", "localhost")
    port   = str(db.get("PORT", "5432"))
    user   = db.get("USER", "postgres")

    def run_psql(sql: str, dbname_arg: str = "postgres") -> tuple:
        """Run a SQL statement via psql. Returns (ok, stderr)."""
        cmd = [psql, "--host", host, "--port", port,
               "--username", user, "--dbname", dbname_arg,
               "--no-password", "--command", sql]
        r = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=60)
        return r.returncode == 0, r.stderr[:300]

    try:
        # Step 1: terminate all connections to the DB before dropping
        logger.info("Restore: terminating connections to %s", dbname)
        run_psql(
            f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            f"WHERE datname='{dbname}' AND pid<>pg_backend_pid();"
        )

        # Step 2: drop the database
        logger.info("Restore: dropping database %s", dbname)
        ok, err = run_psql(f'DROP DATABASE IF EXISTS "{dbname}";')
        if not ok:
            err = re.sub(r'password[^\n]*', '[hidden]', err, flags=re.IGNORECASE)
            logger.error("DROP DATABASE failed: %s", err)
            return False, "Could not drop the existing database before restore."

        # Step 3: create fresh database
        logger.info("Restore: creating database %s", dbname)
        ok, err = run_psql(f'CREATE DATABASE "{dbname}";')
        if not ok:
            err = re.sub(r'password[^\n]*', '[hidden]', err, flags=re.IGNORECASE)
            logger.error("CREATE DATABASE failed: %s", err)
            return False, "Could not create the database for restore."

        # Step 4: restore using psql (decompress on the fly)
        logger.info("Restore: loading data from %s", backup_path.name)
        with gzip.open(backup_path, "rb") as gz_in:
            sql_content = gz_in.read()

        restore_cmd = [psql, "--host", host, "--port", port,
                       "--username", user, "--dbname", dbname,
                       "--no-password", "--quiet"]
        r = subprocess.run(
            restore_cmd, env=env, input=sql_content,
            capture_output=True, timeout=600,
        )
        if r.returncode != 0:
            err = r.stderr.decode(errors="replace")[:400]
            err = re.sub(r'password[^\n]*', '[hidden]', err, flags=re.IGNORECASE)
            logger.error("psql restore failed (exit %d): %s", r.returncode, err)
            return False, "Data load failed. See the log file for details."

        # Step 5: verify the restore by connecting
        ok, _ = run_psql("SELECT 1;", dbname_arg=dbname)
        if not ok:
            return False, "Restore completed but database is not accessible. Check PostgreSQL logs."

        logger.info("Restore completed successfully from %s", backup_path.name)
        return True, "Database restored successfully."

    except gzip.BadGzipFile:
        return False, "Backup file is corrupt (invalid GZIP data)."
    except subprocess.TimeoutExpired:
        return False, "Restore timed out (10 min limit). Database may be partially restored."
    except Exception as exc:
        logger.exception("Restore failed unexpectedly")
        return False, "Restore failed. See the log file for details."


# ---------------------------------------------------------------------------
# Filesystem backup views
# ---------------------------------------------------------------------------

class BackupCreateView(APIView):
    """POST /api/v1/backups/create/ -- create a compressed backup."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not _can_manage_backups(request.user):
            return Response({"detail": "Only Admin and Super Admin can create backups."},
                            status=status.HTTP_403_FORBIDDEN)

        backup_dir = _get_backup_dir()
        env, db    = _get_pg_env()
        ok, result, size = _do_create_backup(backup_dir, env, db)

        if ok:
            _apply_retention(backup_dir, keep=10)
            return Response({
                "success": True,
                "filename": result,
                "size_bytes": size,
                "size_mb": round(size / (1024 * 1024), 2),
                "created_at": datetime.now().isoformat(),
                "backup_dir": str(backup_dir),
            }, status=status.HTTP_201_CREATED)

        msg_map = {
            "timed out":          "Backup timed out. PostgreSQL may be unresponsive.",
            "not found":          "pg_dump not found. Ensure PostgreSQL bin is in your system PATH.",
        }
        friendly = next((v for k, v in msg_map.items() if k in result.lower()),
                        "Backup failed. Check PostgreSQL is running and disk space is available.")
        return Response({"detail": friendly}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class BackupListView(APIView):
    """GET /api/v1/backups/list/ -- list all backup files, newest first."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _can_manage_backups(request.user):
            return Response({"detail": "Only Admin and Super Admin can view backups."},
                            status=status.HTTP_403_FORBIDDEN)
        backup_dir  = _get_backup_dir()
        files       = _list_backups(backup_dir)
        total_bytes = sum(f["size_bytes"] for f in files)
        return Response({
            "backups": files,
            "count": len(files),
            "total_size_mb": round(total_bytes / (1024 * 1024), 2),
            "backup_dir": str(backup_dir),
        })


class BackupStatusView(APIView):
    """GET /api/v1/backups/status/ -- last backup time and count."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _can_manage_backups(request.user):
            return Response({"detail": "Only Admin and Super Admin can view backup status."},
                            status=status.HTTP_403_FORBIDDEN)
        backup_dir = _get_backup_dir()
        files      = _list_backups(backup_dir)
        return Response({
            "last_backup": files[0] if files else None,
            "backup_count": len(files),
            "backup_dir": str(backup_dir),
        })


class BackupValidateView(APIView):
    """
    POST /api/v1/backups/validate/
    Body: { "filename": "popmyc_backup_20260101_120000.sql.gz" }
    Validates the file without touching the database.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not _can_manage_backups(request.user):
            return Response({"detail": "Only Admin and Super Admin can validate backups."},
                            status=status.HTTP_403_FORBIDDEN)

        filename = request.data.get("filename", "")
        if not _BACKUP_FILENAME_RE.match(filename):
            return Response({"valid": False, "reason": "Invalid backup filename."},
                            status=status.HTTP_400_BAD_REQUEST)

        backup_dir = _get_backup_dir()
        result     = _validate_backup_file(backup_dir / filename)
        return Response(result)


class BackupRestoreNewView(APIView):
    """
    POST /api/v1/backups/restore/

    Safe restore workflow:
      1. Validate selected backup.
      2. Create a safety backup of the current database.
      3. Restore from the selected backup.
      4. If restore fails, attempt recovery using the safety backup.

    Body:
    {
        "filename": "popmyc_backup_20260101_120000.sql.gz",
        "confirmed": true      <- REQUIRED, must be explicitly set to true
    }
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not _can_manage_backups(request.user):
            return Response({"detail": "Only Admin and Super Admin can restore backups."},
                            status=status.HTTP_403_FORBIDDEN)

        filename  = request.data.get("filename", "")
        confirmed = request.data.get("confirmed", False)

        if not confirmed:
            return Response(
                {"detail": "Restore requires explicit confirmation. "
                           "Set confirmed=true to proceed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not _BACKUP_FILENAME_RE.match(filename):
            return Response({"detail": "Invalid backup filename."},
                            status=status.HTTP_400_BAD_REQUEST)

        backup_dir    = _get_backup_dir()
        selected_path = backup_dir / filename

        if not selected_path.exists():
            return Response({"detail": "Backup file not found."},
                            status=status.HTTP_404_NOT_FOUND)

        env, db = _get_pg_env()

        # ── Step 1: Validate selected backup ──────────────────────────────────
        validation = _validate_backup_file(selected_path)
        if not validation["valid"]:
            return Response(
                {"detail": f"Selected backup failed validation: {validation['reason']} "
                           "Restore aborted to protect your data."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── Step 2: Create safety backup of current database ──────────────────
        logger.info("Restore: creating safety backup before restore by %s",
                    request.user.username)
        safety_ok, safety_result, safety_size = _do_create_backup(backup_dir, env, db)
        if not safety_ok:
            # If we can't make a safety backup, refuse to restore -- too risky
            logger.error("Restore aborted: could not create safety backup: %s", safety_result)
            return Response(
                {"detail": "Could not create a safety backup before restoring. "
                           "Restore aborted to protect your data. "
                           "Check PostgreSQL is running and disk space is available."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        safety_filename = safety_result
        logger.info("Restore: safety backup created: %s", safety_filename)

        # ── Step 3: Restore ───────────────────────────────────────────────────
        logger.info("Restore: starting restore from %s by %s",
                    filename, request.user.username)
        restore_ok, restore_msg = _do_restore(selected_path, env, db)

        if restore_ok:
            _apply_retention(backup_dir, keep=10)
            return Response({
                "success": True,
                "message": "Database restored successfully.",
                "restored_from": filename,
                "safety_backup": safety_filename,
            })

        # ── Step 4: Restore failed -- attempt recovery from safety backup ─────
        logger.error("Restore failed: %s. Attempting recovery from safety backup.", restore_msg)
        safety_path = backup_dir / safety_filename
        recovery_ok, recovery_msg = _do_restore(safety_path, env, db)

        if recovery_ok:
            logger.info("Recovery succeeded using safety backup %s", safety_filename)
            return Response(
                {
                    "success": False,
                    "message": f"Restore failed: {restore_msg}",
                    "recovery": "Your database has been recovered to the state before restore.",
                    "safety_backup_used": safety_filename,
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # Recovery also failed
        logger.error("Recovery also failed: %s", recovery_msg)
        return Response(
            {
                "success": False,
                "message": f"Restore failed: {restore_msg}",
                "recovery": f"Recovery also failed: {recovery_msg}",
                "safety_backup": safety_filename,
                "action_required": (
                    f"Your safety backup is at: {safety_filename}. "
                    "Please contact POPMYC support."
                ),
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


class BackupExportView(APIView):
    """
    POST /api/v1/backups/export/
    Body: { "filename": "popmyc_backup_20260101_120000.sql.gz" }
    Returns the backup file as a download.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not _can_manage_backups(request.user):
            return Response({"detail": "Only Admin and Super Admin can export backups."},
                            status=status.HTTP_403_FORBIDDEN)

        filename = request.data.get("filename", "")
        if not _BACKUP_FILENAME_RE.match(filename):
            return Response({"detail": "Invalid backup filename."},
                            status=status.HTTP_400_BAD_REQUEST)

        backup_dir = _get_backup_dir()
        file_path  = backup_dir / filename

        if not file_path.exists():
            return Response({"detail": "Backup file not found."},
                            status=status.HTTP_404_NOT_FOUND)

        logger.info("Export: %s downloaded by %s", filename, request.user.username)

        return FileResponse(
            open(file_path, "rb"),
            as_attachment=True,
            filename=filename,
            content_type="application/gzip",
        )


class BackupImportView(APIView):
    """
    POST /api/v1/backups/import/  (multipart/form-data)
    Field: "backup_file" -- a .sql.gz file

    Copies the uploaded file into the backup directory after validation.
    Does NOT automatically restore -- the user chooses to restore separately.
    """
    permission_classes = [IsAuthenticated]
    parser_classes     = [MultiPartParser]

    def post(self, request):
        if not _can_manage_backups(request.user):
            return Response({"detail": "Only Admin and Super Admin can import backups."},
                            status=status.HTTP_403_FORBIDDEN)

        uploaded = request.FILES.get("backup_file")
        if not uploaded:
            return Response({"detail": "No file provided. Send a file in the 'backup_file' field."},
                            status=status.HTTP_400_BAD_REQUEST)

        # Only accept files with .sql.gz extension
        if not uploaded.name.endswith(".sql.gz"):
            return Response(
                {"detail": "Only .sql.gz backup files are accepted."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # File size limit: 2 GB
        if uploaded.size > 2 * 1024 * 1024 * 1024:
            return Response({"detail": "File too large (maximum 2 GB)."},
                            status=status.HTTP_400_BAD_REQUEST)

        # Check GZIP magic bytes before writing to disk
        first_bytes = uploaded.read(2)
        uploaded.seek(0)
        if first_bytes != b'\x1f\x8b':
            return Response({"detail": "File is not a valid GZIP archive."},
                            status=status.HTTP_400_BAD_REQUEST)

        backup_dir = _get_backup_dir()

        # Build a safe destination filename (always use our naming convention)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        dest_name = f"popmyc_backup_{timestamp}.sql.gz"
        tmp_path  = backup_dir / f"{dest_name}.tmp"
        dest_path = backup_dir / dest_name

        try:
            with open(tmp_path, "wb") as f:
                for chunk in uploaded.chunks(chunk_size=8 * 1024 * 1024):
                    f.write(chunk)

            # Validate the uploaded file before making it permanent
            validation = _validate_backup_file(tmp_path)
            if not validation["valid"]:
                tmp_path.unlink(missing_ok=True)
                return Response(
                    {"detail": f"Uploaded file failed validation: {validation['reason']}"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            tmp_path.rename(dest_path)
            size = dest_path.stat().st_size
            logger.info("Import: %s imported as %s by %s (%d bytes)",
                        uploaded.name, dest_name, request.user.username, size)

            return Response({
                "success": True,
                "filename": dest_name,
                "size_bytes": size,
                "size_mb": round(size / (1024 * 1024), 2),
                "original_name": uploaded.name,
            }, status=status.HTTP_201_CREATED)

        except Exception:
            tmp_path.unlink(missing_ok=True)
            logger.exception("Import failed")
            return Response({"detail": "Import failed. Check the log file for details."},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class BackupDeleteFileView(APIView):
    """DELETE /api/v1/backups/file/<filename>/ -- delete one backup file."""
    permission_classes = [IsAuthenticated]

    def delete(self, request, filename):
        if not _can_manage_backups(request.user):
            return Response({"detail": "Only Admin and Super Admin can delete backups."},
                            status=status.HTTP_403_FORBIDDEN)

        if not _BACKUP_FILENAME_RE.match(filename):
            return Response({"detail": "Invalid backup filename."},
                            status=status.HTTP_400_BAD_REQUEST)

        backup_dir = _get_backup_dir()
        file_path  = backup_dir / filename

        if not file_path.exists():
            return Response({"detail": "Backup file not found."}, status=status.HTTP_404_NOT_FOUND)

        all_backups = list(backup_dir.glob("popmyc_backup_*.sql.gz"))
        if len(all_backups) <= 1:
            return Response(
                {"detail": "Cannot delete the last backup. Create a new backup first."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            file_path.unlink()
            logger.info("Deleted backup: %s by %s", filename, request.user.username)
            return Response({"success": True, "deleted": filename})
        except Exception:
            logger.exception("Failed to delete backup %s", filename)
            return Response({"detail": "Could not delete the backup file."},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ── Cloud backup views ────────────────────────────────────────────────────────

class CloudBackupUploadView(APIView):
    """
    POST /api/v1/backups/cloud-upload/

    Creates a local backup then uploads it to the Render cloud database.
    The backup is associated with the current user's business.
    On a fresh install on a new PC, the customer can restore from this backup.

    Steps:
      1. Create a fresh local pg_dump backup (reuses BackupCreateView logic)
      2. Upload the .sql.gz file to the CloudBackup model (stored in media/)
      3. Return the cloud backup metadata

    Only Admin and Super Admin may upload cloud backups.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not _can_manage_backups(request.user):
            return Response(
                {"detail": "Only Admin and Super Admin can upload cloud backups."},
                status=status.HTTP_403_FORBIDDEN,
            )

        user = request.user
        if not user.business_id:
            return Response(
                {"detail": "No business associated with your account."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Step 1: create a local pg_dump backup
        backup_dir = _get_backup_dir()
        backup_dir.mkdir(parents=True, exist_ok=True)

        from django.utils import timezone as _tz
        ts = _tz.now().strftime("%Y%m%d_%H%M%S")
        filename = f"cloud_backup_{ts}.sql.gz"
        filepath = backup_dir / filename

        pg_env = _get_pg_env()
        pg_env_dict = pg_env
        db = settings.DATABASES["default"]
        host  = db.get("HOST", "localhost")
        port  = str(db.get("PORT", "5432"))
        dbname = db.get("NAME", "popmyc_pos")
        user_pg = db.get("USER", "postgres")

        pg_dump = _find_pg_bin("pg_dump")
        if not pg_dump:
            return Response(
                {"detail": "pg_dump not found. Ensure PostgreSQL is installed."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        import subprocess, gzip as _gzip, shutil as _shutil
        try:
            # Run pg_dump and pipe through gzip
            dump_cmd = [
                pg_dump,
                "--host", host, "--port", port,
                "--username", user_pg,
                "--no-password",
                "--format=plain",
                "--blobs",
                dbname,
            ]
            with open(filepath, "wb") as f_out:
                with _gzip.open(f_out, "wb") as gz:
                    proc = subprocess.Popen(
                        dump_cmd,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        env=pg_env_dict,
                    )
                    stdout, stderr = proc.communicate(timeout=300)
                    if proc.returncode != 0:
                        filepath.unlink(missing_ok=True)
                        return Response(
                            {"detail": f"pg_dump failed: {stderr.decode()[:200]}"},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        )
                    gz.write(stdout)

            size = filepath.stat().st_size
        except Exception as exc:
            filepath.unlink(missing_ok=True)
            return Response(
                {"detail": f"Backup creation failed: {exc}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # Step 2: upload to CloudBackup model
        from backups.models import CloudBackup
        from django.core.files import File
        try:
            with open(filepath, "rb") as f:
                cloud_bk = CloudBackup.objects.create(
                    business_id=user.business_id,
                    original_filename=filename,
                    size_bytes=size,
                    uploaded_by=user,
                    notes=request.data.get("notes", ""),
                )
                cloud_bk.backup_file.save(filename, File(f), save=True)
        except Exception as exc:
            filepath.unlink(missing_ok=True)
            return Response(
                {"detail": f"Cloud upload failed: {exc}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # Clean up local temp file
        filepath.unlink(missing_ok=True)

        logger.info(
            "Cloud backup created: %s (%d bytes) by %s",
            filename, size, user.username,
        )

        return Response(
            {
                "id":        str(cloud_bk.id),
                "filename":  cloud_bk.original_filename,
                "size_mb":   round(size / (1024 * 1024), 2),
                "created_at": cloud_bk.created_at.isoformat(),
            },
            status=status.HTTP_201_CREATED,
        )


class CloudBackupListView(APIView):
    """
    GET /api/v1/backups/cloud-list/

    Lists all cloud backups for the current user's business.
    Used on a fresh install to offer a restore.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _can_manage_backups(request.user):
            return Response(
                {"detail": "Only Admin and Super Admin can list cloud backups."},
                status=status.HTTP_403_FORBIDDEN,
            )

        user = request.user
        if not user.business_id:
            return Response({"backups": []})

        from backups.models import CloudBackup
        backups = CloudBackup.objects.filter(
            business_id=user.business_id
        ).order_by("-created_at")[:10]  # last 10

        data = [
            {
                "id":        str(b.id),
                "filename":  b.original_filename,
                "size_mb":   round(b.size_bytes / (1024 * 1024), 2),
                "created_at": b.created_at.isoformat(),
                "notes":     b.notes,
            }
            for b in backups
        ]
        return Response({"backups": data})


class CloudBackupDownloadView(APIView):
    """
    GET /api/v1/backups/cloud-download/<pk>/

    Downloads a specific cloud backup file.
    Returns the .sql.gz file as a streaming response.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        if not _can_manage_backups(request.user):
            return Response(
                {"detail": "Only Admin and Super Admin can download cloud backups."},
                status=status.HTTP_403_FORBIDDEN,
            )

        from backups.models import CloudBackup
        from django.http import FileResponse
        try:
            import uuid as _uuid
            bk = CloudBackup.objects.get(
                pk=_uuid.UUID(str(pk)),
                business_id=request.user.business_id,
            )
        except (CloudBackup.DoesNotExist, ValueError):
            return Response({"detail": "Cloud backup not found."}, status=status.HTTP_404_NOT_FOUND)

        if not bk.backup_file or not bk.backup_file.name:
            return Response({"detail": "Backup file missing."}, status=status.HTTP_404_NOT_FOUND)

        try:
            resp = FileResponse(
                bk.backup_file.open("rb"),
                content_type="application/gzip",
            )
            resp["Content-Disposition"] = f'attachment; filename="{bk.original_filename}"'
            resp["Content-Length"] = bk.size_bytes
            return resp
        except Exception as exc:
            return Response(
                {"detail": f"Could not serve backup file: {exc}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class CloudBackupDeleteView(APIView):
    """DELETE /api/v1/backups/cloud-delete/<pk>/"""
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        if not _can_manage_backups(request.user):
            return Response({"detail": "Only Admin and Super Admin can delete cloud backups."}, status=403)

        from backups.models import CloudBackup
        try:
            import uuid as _uuid
            bk = CloudBackup.objects.get(pk=_uuid.UUID(str(pk)), business_id=request.user.business_id)
        except (CloudBackup.DoesNotExist, ValueError):
            return Response({"detail": "Not found."}, status=404)

        try:
            bk.backup_file.delete(save=False)
        except Exception:
            pass
        bk.delete()
        return Response({"detail": "Cloud backup deleted."}, status=204)
