"""
Management command: ensure_business_owner
==========================================
Assigns an owner to every Business that currently has no owner set.

Usage:
    # Show what would be done (dry run):
    python manage.py ensure_business_owner --dry-run

    # Assign the first superuser as owner of every ownerless business:
    python manage.py ensure_business_owner

    # Assign a specific user as owner of every ownerless business:
    python manage.py ensure_business_owner --owner-username=owusu.michael

    # Assign a specific user to a specific business only:
    python manage.py ensure_business_owner --business-name="OJE ENT" --owner-username=owusu.michael

This command is safe to run multiple times — it only modifies records
where owner is currently NULL.  Existing data is never deleted.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction


class Command(BaseCommand):
    help = "Assign an owner to every Business that currently has no owner set."

    def add_arguments(self, parser):
        parser.add_argument(
            "--owner-username",
            type=str,
            default=None,
            help="Username of the user to assign as owner. "
                 "Defaults to the first Django superuser found.",
        )
        parser.add_argument(
            "--business-name",
            type=str,
            default=None,
            help="Only process the business with this exact name. "
                 "Defaults to all ownerless businesses.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            default=False,
            help="Show what would be done without making any changes.",
        )

    def handle(self, *args, **options):
        from businesses.models import Business
        from accounts.models import CustomUser

        dry_run         = options["dry_run"]
        owner_username  = options["owner_username"]
        business_name   = options["business_name"]

        # ── Resolve owner user ────────────────────────────────────────────────
        if owner_username:
            try:
                owner = CustomUser.objects.get(username=owner_username)
            except CustomUser.DoesNotExist:
                raise CommandError(
                    f"No user found with username '{owner_username}'."
                )
        else:
            owner = CustomUser.objects.filter(is_superuser=True).order_by("date_joined").first()
            if not owner:
                raise CommandError(
                    "No superuser found. Create one first or pass --owner-username."
                )

        self.stdout.write(
            f"  Owner resolved  -> {owner.username} ({owner.email or 'no email'})"
        )

        # ── Resolve businesses ────────────────────────────────────────────────
        qs = Business.objects.filter(owner__isnull=True)
        if business_name:
            qs = qs.filter(name=business_name)

        count = qs.count()
        if count == 0:
            self.stdout.write(
                self.style.SUCCESS("  No ownerless businesses found — nothing to do.")
            )
            return

        self.stdout.write(f"  Businesses to update: {count}")
        for biz in qs:
            self.stdout.write(f"    • {biz.name} ({biz.id})")

        if dry_run:
            self.stdout.write(
                self.style.WARNING("  DRY RUN — no changes were made.")
            )
            return

        # ── Apply ──────────────────────────────────────────────────────────────
        with transaction.atomic():
            updated = qs.update(owner=owner)

        self.stdout.write(
            self.style.SUCCESS(
                f"  OK Updated {updated} business(es) - owner set to '{owner.username}'."
            )
        )
