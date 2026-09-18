"""
licensing/admin.py
==================
Django admin for the licensing app.

POPMYC staff actions available:
  - Create a license for any business (choose type, set duration)
  - Generate a fresh activation code (rotates the current code)
  - Renew an expired subscription directly from the admin
  - View full renewal/activation audit log inline
"""
from datetime import date, timedelta

from django.contrib import admin, messages
from django.utils import timezone
from django.utils.html import format_html
from django.utils.safestring import mark_safe

from .models import License, LicenseRenewalLog, TrialCode, _generate_code


# ── Inline ─────────────────────────────────────────────────────────────────────

class LicenseRenewalLogInline(admin.TabularInline):
    model = LicenseRenewalLog
    extra = 0
    readonly_fields = ("action", "code_used", "previous_expiry", "new_expiry",
                       "duration_days", "performed_by", "created_at")
    can_delete = False
    ordering = ("-created_at",)


# ── License admin ──────────────────────────────────────────────────────────────

@admin.register(License)
class LicenseAdmin(admin.ModelAdmin):
    list_display = (
        "business",
        "license_type",
        "status",
        "colored_status",
        "is_trial_display",
        "start_date",
        "expiry_date",
        "days_remaining_display",
        "activated_at",
        "created_at",
    )
    list_filter = ("license_type", "status")
    search_fields = ("business__name", "activation_code")
    readonly_fields = (
        "id",
        "activation_code",
        "activated_at",
        "created_at",
        "updated_at",
        "is_active_display",
        "is_trial_display",
        "days_remaining_display",
    )
    ordering = ("-created_at",)
    inlines = [LicenseRenewalLogInline]

    fieldsets = (
        ("Business", {
            "fields": ("business",),
        }),
        ("License", {
            "fields": ("license_type", "status", "is_active_display", "is_trial_display"),
        }),
        ("Activation Code", {
            "fields": ("activation_code",),
            "description": (
                "This code is shown to the customer to activate or renew. "
                "Use <b>Generate New Code</b> action to rotate it."
            ),
        }),
        ("Dates", {
            "fields": ("start_date", "expiry_date", "days_remaining_display",
                       "activated_at", "created_at", "updated_at"),
        }),
        ("Notes", {
            "fields": ("notes",),
        }),
    )

    actions = [
        "action_generate_new_code",
        "action_renew_30_days",
        "action_renew_90_days",
        "action_renew_180_days",
        "action_renew_365_days",
        "action_mark_active",
        "action_mark_suspended",
        "action_mark_revoked",
        "action_refresh_expiry_status",
    ]

    # ── Display helpers ────────────────────────────────────────────────────────

    @admin.display(description="Active?")
    def is_active_display(self, obj):
        if obj.is_active:
            return mark_safe('<span style="color:green;font-weight:bold">&#10004; Yes</span>')
        return mark_safe('<span style="color:red;font-weight:bold">&#10008; No</span>')

    @admin.display(description="Days Left")
    def days_remaining_display(self, obj):
        dr = obj.days_remaining
        if dr is None:
            return mark_safe('<span style="color:green">\u221e Lifetime</span>')
        if dr == 0:
            return mark_safe('<span style="color:red;font-weight:bold">Expired</span>')
        if dr <= 7 and obj.is_trial:
            return format_html(
                '<span style="color:orange;font-weight:bold">{} days (Trial)</span>', dr
            )
        if dr <= 14:
            return format_html('<span style="color:orange;font-weight:bold">{} days</span>', dr)
        return format_html('<span style="color:green">{} days</span>', dr)

    @admin.display(description="Trial?")
    def is_trial_display(self, obj):
        if obj.is_trial:
            return mark_safe('<span style="color:blue;font-weight:bold">&#9733; Trial</span>')
        return "—"

    @admin.display(description="")
    def colored_status(self, obj):
        colours = {
            "ACTIVE":    "green",
            "PENDING":   "gray",
            "EXPIRED":   "red",
            "SUSPENDED": "orange",
            "REVOKED":   "darkred",
        }
        colour = colours.get(obj.status, "black")
        label = "● (Trial)" if obj.is_trial and obj.status == "ACTIVE" else "●"
        return format_html(
            '<span style="color:{};font-weight:bold">{}</span>', colour, label
        )

    # ── Actions ────────────────────────────────────────────────────────────────

    @admin.action(description="🔑 Generate new activation code (rotate)")
    def action_generate_new_code(self, request, queryset):
        count = 0
        for lic in queryset:
            lic.activation_code = _generate_code()
            lic.save(update_fields=["activation_code", "updated_at"])
            count += 1
        self.message_user(request, f"Generated new codes for {count} license(s).", messages.SUCCESS)

    def _renew_action(self, request, queryset, days):
        count = 0
        skipped = 0
        for lic in queryset:
            if lic.license_type != License.LicenseType.SUBSCRIPTION:
                skipped += 1
                continue
            prev_expiry = lic.expiry_date
            base = max(lic.expiry_date, date.today()) if lic.expiry_date else date.today()
            lic.expiry_date = base + timedelta(days=days)
            lic.status = License.Status.ACTIVE
            old_code = lic.activation_code
            lic.activation_code = _generate_code()
            lic.save(update_fields=["expiry_date", "status", "activation_code", "updated_at"])
            LicenseRenewalLog.objects.create(
                license=lic,
                action="RENEWAL",
                code_used=old_code,
                previous_expiry=prev_expiry,
                new_expiry=lic.expiry_date,
                duration_days=days,
                performed_by=request.user,
            )
            count += 1
        msg = f"Renewed {count} subscription(s) by {days} days."
        if skipped:
            msg += f" Skipped {skipped} non-subscription license(s)."
        self.message_user(request, msg, messages.SUCCESS)

    @admin.action(description="🔄 Renew +30 days")
    def action_renew_30_days(self, request, queryset):
        self._renew_action(request, queryset, 30)

    @admin.action(description="🔄 Renew +90 days")
    def action_renew_90_days(self, request, queryset):
        self._renew_action(request, queryset, 90)

    @admin.action(description="🔄 Renew +180 days")
    def action_renew_180_days(self, request, queryset):
        self._renew_action(request, queryset, 180)

    @admin.action(description="🔄 Renew +365 days (1 year)")
    def action_renew_365_days(self, request, queryset):
        self._renew_action(request, queryset, 365)

    @admin.action(description="✅ Mark as Active")
    def action_mark_active(self, request, queryset):
        updated = queryset.update(status=License.Status.ACTIVE)
        self.message_user(request, f"Marked {updated} license(s) as Active.", messages.SUCCESS)

    @admin.action(description="⏸ Mark as Suspended")
    def action_mark_suspended(self, request, queryset):
        updated = queryset.update(status=License.Status.SUSPENDED)
        self.message_user(request, f"Suspended {updated} license(s).", messages.WARNING)

    @admin.action(description="🚫 Mark as Revoked")
    def action_mark_revoked(self, request, queryset):
        updated = queryset.update(status=License.Status.REVOKED)
        self.message_user(request, f"Revoked {updated} license(s).", messages.ERROR)

    @admin.action(description="🔍 Refresh expiry status (mark expired if past date)")
    def action_refresh_expiry_status(self, request, queryset):
        count = 0
        for lic in queryset:
            before = lic.status
            lic.refresh_expiry_status()
            if lic.status != before:
                count += 1
        self.message_user(request, f"Flipped {count} license(s) to EXPIRED.", messages.SUCCESS)


# ── Renewal log admin (read-only) ──────────────────────────────────────────────

@admin.register(LicenseRenewalLog)
class LicenseRenewalLogAdmin(admin.ModelAdmin):
    list_display = ("license", "action", "code_used", "previous_expiry",
                    "new_expiry", "duration_days", "performed_by", "created_at")
    list_filter = ("action",)
    search_fields = ("license__business__name", "code_used")
    readonly_fields = ("id", "license", "action", "code_used", "previous_expiry",
                       "new_expiry", "duration_days", "performed_by", "created_at")
    ordering = ("-created_at",)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


# ── Trial Code admin ───────────────────────────────────────────────────────────

@admin.register(TrialCode)
class TrialCodeAdmin(admin.ModelAdmin):
    """
    Admin for pre-issued 7-day trial vouchers.

    Workflow for POPMYC staff:
      1. Click "Add Trial Code" (or use "Generate 7-Day Trial Codes" action
         from the change-list to create in bulk).
      2. Fill in optional Notes (e.g. customer name / order reference).
      3. Save — the code is auto-generated.
      4. Copy the code from the "Activation Code" field and give it to the customer.
      5. The customer enters it in the POPMYC POS setup wizard.
      6. Status changes to USED once the customer activates it.
    """

    list_display = (
        "code",
        "status_badge",
        "notes",
        "activated_license_link",
        "activated_at",
        "created_by",
        "created_at",
    )
    list_filter  = ("status",)
    search_fields = ("code", "notes")
    readonly_fields = (
        "id",
        "code",
        "status",
        "activated_license",
        "activated_at",
        "created_by",
        "created_at",
        "updated_at",
        "code_display",
    )
    ordering = ("-created_at",)

    fieldsets = (
        ("Trial Code", {
            "fields": ("code_display", "status"),
            "description": (
                "<strong>Copy this code and give it to the customer.</strong> "
                "The 7-day trial starts when they enter it during setup."
            ),
        }),
        ("Reference", {
            "fields": ("notes",),
        }),
        ("Activation Details", {
            "fields": ("activated_license", "activated_at"),
            "classes": ("collapse",),
        }),
        ("Audit", {
            "fields": ("id", "created_by", "created_at", "updated_at"),
            "classes": ("collapse",),
        }),
    )

    actions = ["action_generate_trial_codes", "action_revoke_trial_codes"]

    def get_fields(self, request, obj=None):
        if obj is None:
            # On the add form only show notes — code is auto-generated
            return ["notes"]
        return super().get_fields(request, obj)

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)

    # ── Display helpers ────────────────────────────────────────────────────────

    @admin.display(description="Trial Code")
    def code_display(self, obj):
        return format_html(
            '<code style="font-size:16px;letter-spacing:2px;background:#f8f9fa;'
            'padding:4px 8px;border-radius:4px;border:1px solid #dee2e6">{}</code>',
            obj.code,
        )

    @admin.display(description="Status")
    def status_badge(self, obj):
        colours = {
            "PENDING": ("gray",   "⏳ Pending"),
            "USED":    ("green",  "✅ Used"),
            "REVOKED": ("red",    "🚫 Revoked"),
        }
        colour, label = colours.get(obj.status, ("black", obj.status))
        return format_html(
            '<span style="color:{};font-weight:bold">{}</span>', colour, label
        )

    @admin.display(description="Activated For")
    def activated_license_link(self, obj):
        if obj.activated_license:
            try:
                biz_name = obj.activated_license.business.name
            except Exception:
                biz_name = str(obj.activated_license_id)
            return format_html(
                '<span style="color:green">{}</span>', biz_name
            )
        return mark_safe('<span style="color:#aaa">—</span>')

    # ── Actions ────────────────────────────────────────────────────────────────

    @admin.action(description="🎟️ Generate new 7-Day Trial Code(s) for selected rows")
    def action_generate_trial_codes(self, request, queryset):
        """Rotate the activation code on selected PENDING trial codes."""
        count  = 0
        skipped = 0
        for tc in queryset:
            if tc.status != TrialCode.TrialStatus.PENDING:
                skipped += 1
                continue
            tc.code = _generate_code()
            tc.save(update_fields=["code", "updated_at"])
            count += 1
        msg = f"Generated fresh code(s) for {count} trial code(s)."
        if skipped:
            msg += f" Skipped {skipped} already-used/revoked code(s)."
        self.message_user(request, msg, messages.SUCCESS)

    @admin.action(description="🚫 Revoke selected trial codes")
    def action_revoke_trial_codes(self, request, queryset):
        count = queryset.filter(status=TrialCode.TrialStatus.PENDING).update(
            status=TrialCode.TrialStatus.REVOKED
        )
        self.message_user(request, f"Revoked {count} trial code(s).", messages.WARNING)

    def has_delete_permission(self, request, obj=None):
        # Prevent deleting used codes — they are part of the audit trail
        if obj and obj.status == TrialCode.TrialStatus.USED:
            return False
        return super().has_delete_permission(request, obj)

    # ── TEMPORARY: database diagnostic custom admin view ──────────────────────
    # Registered at:  /admin/licensing/trialcode/database-diagnostic/
    # Read-only.  Remove this method and the import block below once the
    # TrialCode lookup issue is diagnosed.

    def get_urls(self):
        from django.urls import path as url_path
        urls = super().get_urls()
        custom = [
            url_path(
                "database-diagnostic/",
                self.admin_site.admin_view(self._diagnostic_view),
                name="licensing_trialcode_database_diagnostic",
            ),
        ]
        return custom + urls  # prepend so our URL is checked first

    def _diagnostic_view(self, request):
        """
        Read-only diagnostic page for the TrialCode database connection.

        Displays the same information as the API endpoint at
        GET /api/v1/cloud/diagnostics/trial-codes/ but as an HTML Admin page,
        so we can compare Django Admin's DB connection with the live API's.

        Security:
          - Restricted to staff/superusers by admin_site.admin_view() wrapper.
          - Never displays DATABASE_URL, DB_PASSWORD, SECRET_KEY, or tokens.
          - All sensitive config values are redacted.
          - Read-only: no data is created, modified, or deleted.
        """
        import os
        from django.conf import settings as dj_settings
        from django.db import connection
        from django.http import HttpResponse

        def _redact(value):
            s = str(value) if value else ""
            if not s:
                return "<empty>"
            if len(s) <= 6:
                return "***"
            return f"{s[:3]}{'*' * (len(s) - 6)}{s[-3:]}"

        # ── Collect diagnostic data ────────────────────────────────────────────

        # Settings context
        settings_module = os.environ.get("DJANGO_SETTINGS_MODULE", "<not set>")
        db_cfg  = dj_settings.DATABASES.get("default", {})
        engine  = db_cfg.get("ENGINE", "")
        db_name = str(db_cfg.get("NAME", ""))
        db_host = str(db_cfg.get("HOST", ""))
        db_port = str(db_cfg.get("PORT", ""))
        db_user = str(db_cfg.get("USER", ""))
        db_url_set = bool(os.environ.get("DATABASE_URL", ""))
        host_lower = db_host.lower()
        is_local   = "localhost" in host_lower or "127.0.0" in host_lower

        # PostgreSQL runtime values (actual session — not from settings)
        pg_db = pg_user = pg_version = pg_error = None
        try:
            with connection.cursor() as cur:
                cur.execute("SELECT current_database(), current_user, version()")
                row = cur.fetchone()
                pg_db, pg_user, pg_version = row
        except Exception as exc:
            pg_error = str(exc)

        # TrialCode counts
        total_count = pending_count = used_count = revoked_count = 0
        count_error = None
        try:
            total_count   = TrialCode.objects.count()
            pending_count = TrialCode.objects.filter(status=TrialCode.TrialStatus.PENDING).count()
            used_count    = TrialCode.objects.filter(status=TrialCode.TrialStatus.USED).count()
            revoked_count = TrialCode.objects.filter(status=TrialCode.TrialStatus.REVOKED).count()
        except Exception as exc:
            count_error = str(exc)

        # Latest 10 codes
        latest_codes = []
        latest_error = None
        try:
            for tc in TrialCode.objects.order_by("-created_at")[:10]:
                latest_codes.append(
                    {
                        "code":       tc.code,
                        "repr_code":  repr(tc.code),
                        "len":        len(tc.code),
                        "status":     tc.status,
                        "created_at": str(tc.created_at),
                    }
                )
        except Exception as exc:
            latest_error = str(exc)

        # ── Render HTML page ───────────────────────────────────────────────────
        # Plain HTML — no template dependency so the view works even if
        # templates are misconfigured.

        def row(label, value, warn=False, mono=False):
            style = "color:#856404;background:#fff3cd;padding:2px 6px;border-radius:3px;" if warn else ""
            val_fmt = f"<code>{value}</code>" if mono else value
            return (
                f"<tr>"
                f"<td style='padding:6px 12px;font-weight:600;white-space:nowrap'>{label}</td>"
                f"<td style='padding:6px 12px;{style}'>{val_fmt}</td>"
                f"</tr>"
            )

        def section(title):
            return (
                f"<tr><td colspan='2' style='padding:12px 12px 4px;"
                f"font-weight:700;font-size:13px;background:#f8f9fa;"
                f"border-top:2px solid #dee2e6;text-transform:uppercase;"
                f"letter-spacing:.04em;color:#495057'>{title}</td></tr>"
            )

        rows = []
        rows.append(section("Django Runtime"))
        rows.append(row("Settings module", settings_module, mono=True))
        rows.append(row("DEBUG", str(dj_settings.DEBUG)))
        rows.append(row(
            "CLOUD_ENABLED",
            str(getattr(dj_settings, "CLOUD_ENABLED", "<not set>")),
        ))

        rows.append(section("Database Config (redacted)"))
        rows.append(row("ENGINE",           engine,           mono=True))
        rows.append(row("NAME (redacted)",  _redact(db_name), mono=True))
        rows.append(row(
            "HOST (redacted)",
            _redact(db_host),
            warn=is_local,
            mono=True,
        ))
        if is_local:
            rows.append(row(
                "⚠ WARNING",
                "HOST is localhost — Admin may be using the desktop DB, not Supabase",
                warn=True,
            ))
        rows.append(row("PORT",             db_port,          mono=True))
        rows.append(row("USER (redacted)",  _redact(db_user), mono=True))
        rows.append(row("DATABASE_URL set", str(db_url_set)))

        rows.append(section("PostgreSQL Runtime (actual session values)"))
        if pg_error:
            rows.append(row("Connection error", pg_error, warn=True))
        else:
            rows.append(row("current_database()", pg_db,      mono=True))
            rows.append(row("current_user",       pg_user,    mono=True))
            rows.append(row("server_version",     (pg_version or "")[:80], mono=True))

        rows.append(section("TrialCode Counts"))
        if count_error:
            rows.append(row("Error", count_error, warn=True))
        else:
            rows.append(row("Total",   str(total_count)))
            rows.append(row("PENDING", str(pending_count),
                            warn=(pending_count == 0 and total_count > 0)))
            rows.append(row("USED",    str(used_count)))
            rows.append(row("REVOKED", str(revoked_count)))

        # Latest codes table
        if latest_error:
            codes_html = f"<p style='color:red'>Error: {latest_error}</p>"
        elif not latest_codes:
            codes_html = "<p style='color:#6c757d'><em>No TrialCode records in this database.</em></p>"
        else:
            code_rows = "".join(
                f"<tr>"
                f"<td style='padding:5px 10px;font-family:monospace'>{tc['code']}</td>"
                f"<td style='padding:5px 10px;font-family:monospace;font-size:11px'>{tc['repr_code']}</td>"
                f"<td style='padding:5px 10px;text-align:center'>{tc['len']}</td>"
                f"<td style='padding:5px 10px'>{tc['status']}</td>"
                f"<td style='padding:5px 10px;font-size:11px;color:#6c757d'>{tc['created_at']}</td>"
                f"</tr>"
                for tc in latest_codes
            )
            codes_html = (
                "<table style='border-collapse:collapse;width:100%;font-size:13px'>"
                "<thead><tr style='background:#f8f9fa'>"
                "<th style='padding:6px 10px;text-align:left'>Code</th>"
                "<th style='padding:6px 10px;text-align:left'>repr(code) — hidden chars visible here</th>"
                "<th style='padding:6px 10px;text-align:center'>Len</th>"
                "<th style='padding:6px 10px;text-align:left'>Status</th>"
                "<th style='padding:6px 10px;text-align:left'>Created</th>"
                "</tr></thead>"
                f"<tbody>{code_rows}</tbody>"
                "</table>"
            )

        table_html = (
            "<table style='border-collapse:collapse;width:100%;font-size:13px;"
            "border:1px solid #dee2e6'>"
            + "".join(rows)
            + "</table>"
        )

        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>TrialCode DB Diagnostic — POPMYC Admin</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
             margin: 0; padding: 0; background: #f8f9fa; color: #212529; }}
    .container {{ max-width: 960px; margin: 32px auto; padding: 0 24px 64px; }}
    h1 {{ font-size: 22px; margin-bottom: 4px; color: #212529; }}
    .subtitle {{ font-size: 13px; color: #6c757d; margin-bottom: 24px; }}
    .banner {{ background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px;
               padding: 12px 16px; margin-bottom: 20px; font-size: 13px; color: #856404; }}
    .card {{ background: #fff; border: 1px solid #dee2e6; border-radius: 6px;
             overflow: hidden; margin-bottom: 24px; }}
    .card-title {{ font-size: 14px; font-weight: 700; padding: 12px 16px;
                   background: #e9ecef; border-bottom: 1px solid #dee2e6; }}
    .card-body {{ padding: 16px; }}
    a {{ color: #0d6efd; }}
  </style>
</head>
<body>
<div class="container">
  <h1>🔍 TrialCode Database Diagnostic</h1>
  <p class="subtitle">
    TEMPORARY READ-ONLY PAGE — Django Admin view for diagnosing the
    TrialCode database connection. No data is modified.
    Compare with the API endpoint at
    <a href="/api/v1/cloud/diagnostics/trial-codes/" target="_blank">
      /api/v1/cloud/diagnostics/trial-codes/
    </a>.
  </p>

  <div class="banner">
    ⚠ This page is restricted to staff/superusers.
    Never share screenshots containing DATABASE_URL, passwords, or SECRET_KEY.
    This page shows only redacted values.
  </div>

  <div class="card">
    <div class="card-title">Database &amp; Runtime Context</div>
    <div class="card-body">{table_html}</div>
  </div>

  <div class="card">
    <div class="card-title">
      Latest 10 TrialCodes
      <span style="font-weight:400;font-size:12px;margin-left:8px;color:#6c757d">
        repr() column reveals hidden characters (non-ASCII, invisible Unicode, unexpected spaces)
      </span>
    </div>
    <div class="card-body">{codes_html}</div>
  </div>

  <p style="font-size:12px;color:#6c757d">
    &larr; <a href="/admin/licensing/trialcode/">Back to Trial Codes</a>
    &nbsp;|&nbsp;
    <a href="/admin/">Admin Home</a>
  </p>
</div>
</body>
</html>"""

        return HttpResponse(html, content_type="text/html")
