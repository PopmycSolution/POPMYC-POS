"""
synchronization/sync_worker.py
================================
Stage 6.2C — Background synchronization worker.

Architecture
------------
SyncWorker runs as a daemon thread inside the existing Stage 6.1
Windows service (service_launcher.py), sharing the same Python
process as Waitress. This means:

  - No second Windows service is needed.
  - The worker starts automatically when the backend starts.
  - It stops gracefully when the service stops (daemon=True).

Responsibilities
----------------
  1. Periodically call SyncManager.run() to upload pending records
     and download cloud changes.
  2. Recover stuck SYNCING records on startup (crash recovery).
  3. Respect CLOUD_ENABLED — skip sync silently when disabled.
  4. Never block POS HTTP requests.
  5. Back off on repeated failures (exponential back-off).
  6. Log progress and errors without logging secrets.

Offline safety
--------------
If the network is unavailable, SyncManager catches the exception and
returns success=False. The worker increments its back-off timer and
retries later. The local POS continues operating normally.

Usage (in service_launcher.py)
-------------------------------
    from synchronization.sync_worker import SyncWorker
    worker = SyncWorker()
    worker.start()   # non-blocking — runs in a daemon thread
    # then start Waitress normally
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

# ── Configuration ──────────────────────────────────────────────────────────────
# All durations in seconds.
_POLL_INTERVAL_SECS       = int(getattr(settings, "SYNC_POLL_INTERVAL",   60))   # normal
_BACKOFF_INITIAL_SECS     = int(getattr(settings, "SYNC_BACKOFF_INITIAL", 30))   # after 1st fail
_BACKOFF_MAX_SECS         = int(getattr(settings, "SYNC_BACKOFF_MAX",    600))   # 10-min cap
_SYNCING_STUCK_MINS       = int(getattr(settings, "SYNC_STUCK_MINUTES",    5))   # crash recovery
_MAX_UPLOAD_PER_CYCLE     = int(getattr(settings, "SYNC_UPLOAD_LIMIT",   100))   # records/cycle


class SyncWorker:
    """
    Background daemon thread that drives SyncManager.

    Thread-safety notes
    -------------------
    - Only one SyncWorker should run per process.
    - SyncManager.upload_pending() uses a DB UPDATE to atomically flip
      records from PENDING → SYNCING before the network call, preventing
      double-processing by concurrent threads/processes.
    - stop() is thread-safe — sets an Event that the worker checks
      after each sleep interval.
    """

    def __init__(self) -> None:
        self._stop_event  = threading.Event()
        self._thread: threading.Thread | None = None
        self._consecutive_failures = 0

    # ── Public API ────────────────────────────────────────────────────────────

    def start(self) -> None:
        """Start the background worker thread (non-blocking)."""
        if self._thread and self._thread.is_alive():
            logger.warning("[SyncWorker] Already running — ignoring start()")
            return

        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run_loop,
            name="SyncWorker",
            daemon=True,         # killed automatically when the main process exits
        )
        self._thread.start()
        logger.info("[SyncWorker] Started (poll interval=%ds)", _POLL_INTERVAL_SECS)

    def stop(self) -> None:
        """Signal the worker to stop gracefully."""
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=15)
        logger.info("[SyncWorker] Stopped")

    @property
    def is_running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    # ── Main loop ─────────────────────────────────────────────────────────────

    def _run_loop(self) -> None:
        """
        Infinite loop — runs in the daemon thread.
        Calls _sync_cycle() then sleeps for the appropriate interval.
        """
        logger.info("[SyncWorker] Loop started")

        # Crash recovery: on start-up, reset any SYNCING records that were
        # left in-flight by a previous process that was killed mid-sync.
        self._recover_stuck_records()

        while not self._stop_event.is_set():
            try:
                self._sync_cycle()
                self._consecutive_failures = 0
            except Exception as exc:
                # Broad catch — worker must never die from an unexpected error.
                # Log without leaking sensitive data.
                self._consecutive_failures += 1
                logger.error(
                    "[SyncWorker] Unexpected error in sync cycle "
                    "(failure #%d): %s",
                    self._consecutive_failures,
                    type(exc).__name__,  # type name only — no token/secret data
                )

            sleep_secs = self._next_sleep()
            logger.debug("[SyncWorker] Sleeping %ds before next cycle", sleep_secs)
            # Use wait() instead of sleep() so stop() wakes us immediately
            self._stop_event.wait(timeout=sleep_secs)

        logger.info("[SyncWorker] Loop exited cleanly")

    # ── Sync cycle ────────────────────────────────────────────────────────────

    def _sync_cycle(self) -> None:
        """
        One synchronization cycle: upload pending, then download changes.

        Skipped silently when:
          - CLOUD_ENABLED=False
          - SYNC_CLOUD_URL is not configured
          - License does not permit cloud operations (local POS continues)

        Never raises — all exceptions are caught and logged.
        """
        if not getattr(settings, "CLOUD_ENABLED", False):
            return   # Cloud disabled — do nothing; local queue accumulates

        cloud_url   = getattr(settings, "SYNC_CLOUD_URL",   "")
        cloud_token = getattr(settings, "SYNC_CLOUD_TOKEN", "")

        if not cloud_url:
            return   # Not configured — skip silently

        from synchronization.sync_manager import SyncManager
        manager = SyncManager(base_url=cloud_url, token=cloud_token)

        if not manager.is_configured():
            return

        # ── Upload ────────────────────────────────────────────────────────
        try:
            upload_result = manager.upload_pending(limit=_MAX_UPLOAD_PER_CYCLE)
            if upload_result.get("success"):
                uploaded   = upload_result.get("uploaded",   0)
                duplicates = upload_result.get("duplicates", 0)
                if uploaded or duplicates:
                    logger.info(
                        "[SyncWorker] Upload: %d accepted, %d duplicates",
                        uploaded, duplicates,
                    )
            elif upload_result.get("status") not in ("nothing_to_upload", "not_configured"):
                logger.warning(
                    "[SyncWorker] Upload failed: %s",
                    upload_result.get("status", "unknown"),
                )
                self._consecutive_failures += 1
        except Exception as exc:
            logger.warning(
                "[SyncWorker] Upload exception: %s", type(exc).__name__
            )
            self._consecutive_failures += 1

        # ── Download ──────────────────────────────────────────────────────
        try:
            # Use the first active SyncDevice's checkpoint as the cursor.
            # When multiple devices exist the SyncManager's run() method
            # handles per-device cursors; here we drive a simplified cycle.
            from synchronization.models import SyncDevice
            device = SyncDevice.objects.filter(is_active=True).first()

            since = None
            if device and device.sync_checkpoint:
                since = device.sync_checkpoint.isoformat()
            elif device and device.last_sync_at:
                since = device.last_sync_at.isoformat()

            device_id = device.device_id if device else None
            dl_result = manager.download_changes(
                since=since,
                device_id=device_id,
            )

            if dl_result.get("success"):
                applied  = dl_result.get("applied",  0)
                skipped  = dl_result.get("skipped",  0)
                failed   = dl_result.get("failed",   0)
                if applied or failed:
                    logger.info(
                        "[SyncWorker] Download: %d applied, %d skipped, %d failed",
                        applied, skipped, failed,
                    )
                # Advance checkpoint only after successful processing
                if device and dl_result.get("server_time"):
                    try:
                        from django.utils.dateparse import parse_datetime
                        new_cp = parse_datetime(str(dl_result["server_time"]))
                        if new_cp:
                            device.sync_checkpoint = new_cp
                            device.last_sync_at    = timezone.now()
                            device.save(
                                update_fields=["sync_checkpoint", "last_sync_at", "updated_at"]
                            )
                    except Exception:
                        pass  # non-fatal
            elif dl_result.get("status") not in ("not_configured",):
                logger.warning(
                    "[SyncWorker] Download failed: %s",
                    dl_result.get("status", "unknown"),
                )
        except Exception as exc:
            logger.warning(
                "[SyncWorker] Download exception: %s", type(exc).__name__
            )

    # ── Crash recovery ─────────────────────────────────────────────────────────

    def _recover_stuck_records(self) -> None:
        """
        On startup, reset SyncRecords that were stuck in SYNCING state
        because the previous process was killed mid-upload.

        Only records older than _SYNCING_STUCK_MINS minutes are reset —
        records that just turned SYNCING in a parallel process are left alone.
        """
        try:
            cutoff = timezone.now() - timedelta(minutes=_SYNCING_STUCK_MINS)
            recovered = (
                SyncRecord.objects
                .filter(
                    status=SyncRecord.STATUS_SYNCING,
                    updated_at__lt=cutoff,
                )
                .update(
                    status=SyncRecord.STATUS_PENDING
                )
            )
            if recovered:
                logger.info(
                    "[SyncWorker] Crash recovery: reset %d stuck SYNCING records "
                    "to PENDING (older than %d min)",
                    recovered, _SYNCING_STUCK_MINS,
                )
        except Exception as exc:
            logger.warning(
                "[SyncWorker] Crash recovery failed (non-fatal): %s",
                type(exc).__name__,
            )

    # ── Back-off ──────────────────────────────────────────────────────────────

    def _next_sleep(self) -> int:
        """
        Exponential back-off after failures; normal interval on success.

        Failures:  30s → 60s → 120s → … → 600s cap
        Success:   _POLL_INTERVAL_SECS (default 60s)
        """
        if self._consecutive_failures == 0:
            return _POLL_INTERVAL_SECS
        delay = min(
            _BACKOFF_INITIAL_SECS * (2 ** (self._consecutive_failures - 1)),
            _BACKOFF_MAX_SECS,
        )
        return int(delay)


# Import SyncRecord at module level (needed by _recover_stuck_records)
from synchronization.models import SyncRecord  # noqa: E402
