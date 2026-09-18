import uuid
from django.db import models
from django.contrib.auth.models import AbstractUser
from django.utils.translation import gettext_lazy as _


def user_avatar_path(instance, filename):
    """Upload to media/avatars/<user_id>/<filename>  — one folder per user."""
    ext = filename.rsplit(".", 1)[-1].lower()
    return f"avatars/{instance.pk}/{instance.pk}.{ext}"


class CustomUser(AbstractUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    phone_number = models.CharField(max_length=20, unique=True, null=True, blank=True)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="users",
    )
    branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="users",
    )
    # When True the user must set a new password on their next successful login.
    must_change_password = models.BooleanField(
        default=False,
        verbose_name=_("Must Change Password"),
        help_text=_(
            "Forces the user to create a new password on their next login. "
            "Set automatically when an administrator resets this user's password."
        ),
    )
    # Profile picture stored in media/avatars/<user_id>/
    profile_picture = models.ImageField(
        upload_to=user_avatar_path,
        null=True,
        blank=True,
        verbose_name=_("Profile Picture"),
        help_text=_("Square image recommended. JPG, JPEG, PNG or WEBP. Max 5 MB."),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "accounts_custom_user"
        verbose_name = _("User")
        verbose_name_plural = _("Users")

    def __str__(self):
        return self.username


class Role(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="roles",
    )
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    is_system = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "accounts_role"
        verbose_name = _("Role")
        verbose_name_plural = _("Roles")
        unique_together = ("business", "name")

    def __str__(self):
        return self.name


class Permission(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    codename = models.CharField(max_length=100, unique=True)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    module = models.CharField(max_length=100, help_text=_("Module name for grouping permissions"))
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "accounts_permission"
        verbose_name = _("Permission")
        verbose_name_plural = _("Permissions")

    def __str__(self):
        return f"{self.module}: {self.codename}"


class UserRole(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        related_name="user_roles",
    )
    role = models.ForeignKey(
        Role,
        on_delete=models.CASCADE,
        related_name="user_roles",
    )
    assigned_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "accounts_user_role"
        unique_together = ("user", "role")
        verbose_name = _("User Role")
        verbose_name_plural = _("User Roles")

    def __str__(self):
        return f"{self.user.username} - {self.role.name}"


class RolePermission(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    role = models.ForeignKey(
        Role,
        on_delete=models.CASCADE,
        related_name="role_permissions",
    )
    permission = models.ForeignKey(
        Permission,
        on_delete=models.CASCADE,
        related_name="role_permissions",
    )
    granted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "accounts_role_permission"
        unique_together = ("role", "permission")
        verbose_name = _("Role Permission")
        verbose_name_plural = _("Role Permissions")

    def __str__(self):
        return f"{self.role.name} - {self.permission.codename}"
