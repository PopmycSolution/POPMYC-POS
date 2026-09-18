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
