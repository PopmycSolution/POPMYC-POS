from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from accounts.models import CustomUser, Role, Permission, UserRole, RolePermission


@admin.register(CustomUser)
class CustomUserAdmin(BaseUserAdmin):
    list_display = ("username", "email", "phone_number", "business", "branch", "is_active", "is_staff", "created_at")
    list_filter = ("business", "branch", "is_active", "is_staff", "is_superuser", "created_at")
    search_fields = ("username", "email", "phone_number", "first_name", "last_name")
    readonly_fields = ("id", "created_at", "updated_at", "last_login", "date_joined")
    fieldsets = BaseUserAdmin.fieldsets + (
        (None, {"fields": ("id", "phone_number", "business", "branch")}),
        ("Timestamps", {"fields": ("created_at", "updated_at")}),
    )
    add_fieldsets = BaseUserAdmin.add_fieldsets + (
        (None, {"fields": ("phone_number", "business", "branch")}),
    )
    raw_id_fields = ("business", "branch")


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
