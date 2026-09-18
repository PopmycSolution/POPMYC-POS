"""
Management command: recover_sync

Resets SyncRecord rows stuck in SYNCING state back to PENDING so they
can be retried on the next sync cycle.

Usage
-----
    python manage.py recover_sync
    python manage.py recover_sync --minutes 10   # stuck longer than 10 min
    python manage.py recover_sync --dry-run       # show count without changing

This command is safe to run at any time, including while the service
is running. It only touches records whose updated_at is older than
--minutes minutes, so records being actively processed are left alone.

The SyncWorker also calls this logic automatically on startup.
"""

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from synchronization.models import SyncRecord
from cloud.models import CloudAuditLog


class Command(BaseCommand):
    help = "Recover SyncRecord rows stuck in SYNCING state (crash recovery)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--minutes",
            type=int,
            default=5,
            help="Reset records stuck in SYNCING longer than this many minutes (default: 5).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            default=False,
            help="Print the count of affected records without modifying them.",
        )

    def handle(self, *args, **options):
        minutes  = options["minutes"]
        dry_run  = options["dry_run"]
        cutoff   = timezone.now() - timedelta(minutes=minutes)

        qs = SyncRecord.objects.filter(
            status=SyncRecord.STATUS_SYNCING,
            updated_at__lt=cutoff,
        )
        count = qs.count()

        if dry_run:
            self.stdout.write(
                f"[dry-run] {count} SYNCING record(s) stuck longer than "
                f"{minutes} minute(s) would be reset to PENDING."
            )
            return

        if count == 0:
            self.stdout.write(self.style.SUCCESS("No stuck SYNCING records found."))
            return

        recovered = qs.update(status=SyncRecord.STATUS_PENDING)
        self.stdout.write(
            self.style.SUCCESS(
                f"Recovered {recovered} record(s): SYNCING → PENDING "
                f"(stuck > {minutes} min)."
            )
        )

        # Audit (system-level event, no actor)
        try:
            CloudAuditLog.log(
                action   = CloudAuditLog.Action.SYNC_RECOVERY,
                metadata = {
                    "recovered": recovered,
                    "stuck_threshold_minutes": minutes,
                },
            )
        except Exception:
            pass  # non-fatal
