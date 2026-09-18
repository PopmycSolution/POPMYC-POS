"""
accounts/management/commands/bootstrap_cloud_admin.py
======================================================
One-shot bootstrap command to create the first Django superuser in the
Render/Supabase production database.

Usage (on Render via Shell or Render's "Run Command" panel):

    CLOUD_ADMIN_USERNAME=myadmin \
    CLOUD_ADMIN_EMAIL=admin@example.com \
    CLOUD_ADMIN_PASSWORD=StrongPassword123! \
    python manage.py bootstrap_cloud_admin

Environment variables
---------------------
CLOUD_ADMIN_USERNAME   Required. Login username for the new admin.
CLOUD_ADMIN_EMAIL      Required. Email address for the new admin.
CLOUD_ADMIN_PASSWORD   Required. Password (never logged or printed).

Safety guarantees
-----------------
- Reads credentials exclusively from environment variables — nothing is
  hard-coded in source code, migration files, fixtures, or Git.
- The password is NEVER printed, logged, or included in any output.
- If the username already exists the command exits successfully without
  modifying the existing user (idempotent).
- The command cannot be used to reset or overwrite a password.
- No existing user data is modified.
- No authentication, licensing, or business logic is changed.
- Safe to run multiple times (idempotent).

Intended use
------------
Run once after the Render deployment to seed the production superuser.
Remove CLOUD_ADMIN_PASSWORD from the Render environment variables after
the account is created.  The account itself is permanent.
"""

import os
import sys

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = (
        "Create the initial cloud superuser from environment variables. "
        "Safe to run multiple times — skips creation if the username already exists. "
        "NEVER prints the password."
    )

    # No arguments — all input comes from the environment.
    # This is intentional: argument values appear in shell history and
    # process listings; environment variables do not.

    def handle(self, *args, **options):
        User = get_user_model()

        # ── 1. Read required environment variables ────────────────────────────
        username = os.environ.get("CLOUD_ADMIN_USERNAME", "").strip()
        email    = os.environ.get("CLOUD_ADMIN_EMAIL", "").strip()
        password = os.environ.get("CLOUD_ADMIN_PASSWORD", "")

        missing = []
        if not username:
            missing.append("CLOUD_ADMIN_USERNAME")
        if not email:
            missing.append("CLOUD_ADMIN_EMAIL")
        if not password:
            missing.append("CLOUD_ADMIN_PASSWORD")

        if missing:
            # Exit with a non-zero status so Render's run-command reports failure.
            # Never hint at what the password value might be.
            raise CommandError(
                "The following required environment variable(s) are not set or empty:\n"
                + "\n".join(f"  • {v}" for v in missing)
                + "\n\nSet them in Render's environment variable panel before running "
                "this command.  The password must never be committed to source code."
            )

        # ── 2. Idempotency check — skip if the user already exists ────────────
        if User.objects.filter(username=username).exists():
            self.stdout.write(
                self.style.WARNING(
                    f"User '{username}' already exists. "
                    "No changes made. "
                    "If you need to reset the password, use the Django admin UI."
                )
            )
            # Exit 0 — this is not an error, just a no-op.
            return

        # ── 3. Create the superuser ────────────────────────────────────────────
        # Use the project's own CustomUser.objects.create_superuser() so that
        # all model-level field defaults, signal handlers, and password hashing
        # go through the standard AbstractUser path — no bespoke logic here.
        try:
            user = User.objects.create_superuser(
                username=username,
                email=email,
                password=password,
                # Explicit flags for clarity — create_superuser sets these by
                # default but we name them so a code reader cannot miss them.
                is_staff=True,
                is_superuser=True,
                is_active=True,
            )
        except Exception as exc:
            # Sanitise the exception message before printing: if the DB
            # driver somehow echoes the password (it shouldn't), we don't
            # want it in logs.
            safe_msg = str(exc).replace(password, "[REDACTED]")
            raise CommandError(f"Could not create superuser: {safe_msg}") from exc
        finally:
            # Zero out the password string from local scope as early as possible.
            # Python's GC is non-deterministic about memory, but this is a
            # best-effort hygiene step.
            password = ""  # noqa: F841

        # ── 4. Confirm success — password is NOT mentioned ────────────────────
        self.stdout.write(
            self.style.SUCCESS(
                f"Superuser '{user.username}' created successfully "
                f"(email: {user.email}, is_staff: {user.is_staff}, "
                f"is_superuser: {user.is_superuser}, is_active: {user.is_active})."
            )
        )
        self.stdout.write(
            self.style.WARNING(
                "IMPORTANT: remove CLOUD_ADMIN_PASSWORD from Render environment "
                "variables now that the account has been created."
            )
        )
