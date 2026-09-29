from django.apps import AppConfig


class BusinessesConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "businesses"
    verbose_name = "Businesses"

    def ready(self):
        # Connect the post_migrate signal to backfill missing cloud registration
        # data (CloudBusinessProfile, Branch, License) for every Business that
        # was registered before the registration endpoint created them.
        # This runs automatically after every `manage.py migrate` — including
        # Render's deploy step — so no shell access is needed.
        from django.db.models.signals import post_migrate
        post_migrate.connect(_backfill_cloud_data, sender=self)


def _backfill_cloud_data(sender, **kwargs):
    """
    After migrations complete, ensure every Business on this database has:
      1. A CloudBusinessProfile (cloud_status=ACTIVE)
      2. At least one Branch (head-office stub)
      3. At least one License (TRIAL, 7 days)

    This is idempotent — safe to run multiple times.
    Only runs when the businesses table already has rows (i.e. not on a
    completely fresh empty database where no businesses exist yet).
    """
    try:
        from businesses.models import Business
        businesses = list(Business.objects.all())
        if not businesses:
            return  # fresh empty DB — nothing to backfill

        from branches.models import Branch
        from cloud.models import CloudBusinessProfile
        from licensing.models import License
        from django.utils import timezone
        from datetime import date, timedelta
        import logging
        logger = logging.getLogger(__name__)

        for biz in businesses:
            # 1. CloudBusinessProfile
            try:
                profile, created = CloudBusinessProfile.objects.get_or_create(
                    business=biz,
                    defaults={
                        "cloud_status":         CloudBusinessProfile.CloudStatus.ACTIVE,
                        "cloud_registered_at":  timezone.now(),
                    },
                )
                if not created and profile.cloud_status != CloudBusinessProfile.CloudStatus.ACTIVE:
                    profile.cloud_status = CloudBusinessProfile.CloudStatus.ACTIVE
                    if not profile.cloud_registered_at:
                        profile.cloud_registered_at = timezone.now()
                    profile.save(update_fields=["cloud_status", "cloud_registered_at"])
            except Exception as exc:
                logger.warning("Backfill: CloudBusinessProfile failed for %s: %s", biz.name, exc)

            # 2. Branch
            try:
                if not Branch.objects.filter(business=biz).exists():
                    Branch.objects.create(
                        business=biz,
                        name="Main Branch",
                        code="MAIN",
                        is_head_office=True,
                        is_active=True,
                    )
                    logger.info("Backfill: created Main Branch for %s", biz.name)
            except Exception as exc:
                logger.warning("Backfill: Branch failed for %s: %s", biz.name, exc)

            # 3. License
            try:
                if not License.objects.filter(business=biz).exists():
                    today = date.today()
                    lic = License.objects.create(
                        business=biz,
                        license_type=License.LicenseType.TRIAL,
                        status=License.Status.PENDING,
                        start_date=today,
                        expiry_date=today + timedelta(days=7),
                        notes="Auto-backfilled during cloud deployment.",
                    )
                    lic.activate()
                    logger.info("Backfill: created TRIAL license for %s", biz.name)
            except Exception as exc:
                logger.warning("Backfill: License failed for %s: %s", biz.name, exc)

    except Exception as exc:
        # Never crash the startup process — backfill is best-effort
        import logging
        logging.getLogger(__name__).warning(
            "Backfill _backfill_cloud_data raised unexpectedly: %s", exc
        )
