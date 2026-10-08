"""
synchronization/management/commands/register_with_cloud.py
===========================================================
Re-registers the local business with the Render cloud backend.

Use this when:
  - The initial cloud registration failed (e.g. CLOUD_ENABLED was False on Render)
  - The business data has changed and you want Render to reflect the latest
  - You are setting up the cloud for the first time after an older install

Usage (on the customer's PC or dev machine):

    cd "C:\Program Files\POPMYC POS\resources\backend"
    ..\runtime\python\python.exe manage.py register_with_cloud

Or on the dev machine:

    cd c:\xampp\htdocs\POS\backend
    .\.venv-prod\Scripts\python.exe manage.py register_with_cloud

What it does:
  1. Reads the local Business and Branch from the local PostgreSQL
  2. POSTs them to https://popmyc-pos.onrender.com/api/v1/cloud/trial/register-business/
  3. The cloud creates/updates the Business, Branch, CloudBusinessProfile,
     BusinessMembership, and admin user on Render
  4. After this, the PWA will show the correct business data
"""

from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Re-register the local business with the Render cloud backend."

    def add_arguments(self, parser):
        parser.add_argument(
            "--cloud-url",
            default="https://popmyc-pos.onrender.com",
            help="Render backend URL (default: https://popmyc-pos.onrender.com)",
        )

    def handle(self, *args, **options):
        cloud_url = options["cloud_url"].rstrip("/")

        # Get local business
        from businesses.models import Business
        from branches.models import Branch
        from accounts.models import CustomUser

        business = Business.objects.first()
        if not business:
            raise CommandError(
                "No business found in local database. "
                "Please complete the Setup Wizard first."
            )

        branch = Branch.objects.filter(business=business).first()
        if not branch:
            raise CommandError(
                f"No branch found for business '{business.name}'. "
                "Please complete the Setup Wizard first."
            )

        admin = CustomUser.objects.filter(
            business=business, is_superuser=True
        ).first() or CustomUser.objects.filter(business=business).first()

        self.stdout.write(f"\n🏢  Business : {business.name} ({business.id})")
        self.stdout.write(f"🏬  Branch   : {branch.name} ({branch.id})")
        self.stdout.write(f"👤  Admin    : {admin.username if admin else 'none'}")
        self.stdout.write(f"☁️   Cloud URL: {cloud_url}\n")
        self.stdout.write("📡  Registering with cloud...")

        # Override CLOUD_SETUP_URL for this call
        import django.conf
        original_url = getattr(django.conf.settings, "CLOUD_SETUP_URL", "")
        django.conf.settings.CLOUD_SETUP_URL = cloud_url

        try:
            from cloud.business_registration import register_business_with_cloud
            success = register_business_with_cloud(
                business=business,
                branch=branch,
                cloud_token="",
                admin_user=admin,
            )
        finally:
            django.conf.settings.CLOUD_SETUP_URL = original_url

        if success:
            self.stdout.write(self.style.SUCCESS(
                "\n✅  Registration successful!\n"
                "   Your business is now on the cloud.\n"
                "   Open the PWA and log in — your data will appear.\n"
            ))
        else:
            self.stdout.write(self.style.WARNING(
                "\n⚠️   Registration failed (check your internet connection).\n"
                "   The app will retry automatically on next startup.\n"
                "   Make sure https://popmyc-pos.onrender.com is reachable.\n"
            ))
