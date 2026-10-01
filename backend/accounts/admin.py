from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.utils.html import format_html
from accounts.models import CustomUser, Role, Permission, UserRole, RolePermission


@admin.register(CustomUser)
class CustomUserAdmin(BaseUserAdmin):
    """
    Cloud admin shows ONLY Admin and SuperAdmin users —
    Cashiers, Managers, and Inventory Clerks live on the customer's local PC
    and are not relevant to cloud administration.

    PASSWORD CHANGE:
    Click any username → scroll to the "Password" row → click the
    "change password form" link → enter and confirm the new password.
    The "Force password change on next login" action is also available.
    """
    list_display = (
        "username_link", "full_name_display", "email",
        "role_display", "business", "is_active",
        "must_change_password", "created_at",
    )
    list_filter  = ("business", "is_active", "is_staff", "is_superuser",
                    "must_change_password", "created_at")
    search_fields = ("username", "email", "first_name", "last_name", "phone_number")
    readonly_fields = ("id", "created_at", "updated_at", "last_login", "date_joined")
    ordering = ("-created_at",)

    fieldsets = BaseUserAdmin.fieldsets + (
        ("POPMYC POS", {
            "fields": ("id", "phone_number", "business", "branch",
                       "must_change_password", "profile_picture"),
            "description": (
                "To change this user's password, use the <strong>Password</strong> "
                "field link above, or select the user and run the "
                "<em>Force password change on next login</em> action."
            ),
        }),
        ("Timestamps", {"fields": ("created_at", "updated_at")}),
    )
    add_fieldsets = BaseUserAdmin.add_fieldsets + (
        ("POPMYC POS", {"fields": ("phone_number", "business", "branch")}),
    )
    raw_id_fields = ("business", "branch")
    actions = ["force_password_change"]

    def get_queryset(self, request):
        """Show ONLY Admin (is_staff) and SuperAdmin (is_superuser) users."""
        qs = super().get_queryset(request)
        return qs.filter(is_staff=True) | qs.filter(is_superuser=True)

    @admin.display(description="Username", ordering="username")
    def username_link(self, obj):
        try:
            from django.urls import reverse
            url = reverse("admin:accounts_customuser_change", args=[obj.pk])
            return format_html(
                '<a href="{}" style="font-weight:600">{}</a>', url, obj.username
            )
        except Exception:
            return obj.username

    @admin.display(description="Name", ordering="first_name")
    def full_name_display(self, obj):
        name = f"{obj.first_name} {obj.last_name}".strip()
        return name or "—"

    @admin.display(description="Role", ordering="is_superuser")
    def role_display(self, obj):
        if obj.is_superuser:
            return format_html(
                '<span style="color:#dc2626;font-weight:700">Super Admin</span>'
            )
        if obj.is_staff:
            return format_html(
                '<span style="color:#7c3aed;font-weight:700">Admin</span>'
            )
        return "—"

    @admin.action(description="🔑 Force password change on next login")
    def force_password_change(self, request, queryset):
        updated = queryset.update(must_change_password=True)
        self.message_user(
            request,
            f"✅ {updated} user(s) will be required to change their password on next login."
        )


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ("name", "business", "is_system", "created_at")
    list_filter = ("business", "is_system", "created_at")
    search_fields = ("name", "description")
    readonly_fields = ("id", "created_at", "updated_at")
    raw_id_fields = ("business",)


@admin.register(Permission)
class PermissionAdmin(admin.ModelAdmin):
    list_display = ("codename", "name", "module", "created_at")
    list_filter = ("module", "created_at")
    search_fields = ("codename", "name", "description")
    readonly_fields = ("id", "created_at")


@admin.register(UserRole)
class UserRoleAdmin(admin.ModelAdmin):
    list_display = ("user", "role", "assigned_at")
    list_filter = ("assigned_at",)
    search_fields = ("user__username", "role__name")
    readonly_fields = ("id", "assigned_at")
    raw_id_fields = ("user", "role")


@admin.register(RolePermission)
class RolePermissionAdmin(admin.ModelAdmin):
    list_display = ("role", "permission", "granted_at")
    list_filter = ("granted_at",)
    search_fields = ("role__name", "permission__codename", "permission__name")
    readonly_fields = ("id", "granted_at")
    raw_id_fields = ("role", "permission")
