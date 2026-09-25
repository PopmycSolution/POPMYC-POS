from rest_framework import serializers
from django.contrib.auth import authenticate
from accounts.models import CustomUser, Role, Permission, UserRole, RolePermission


class CustomUserSerializer(serializers.ModelSerializer):
    # Absolute URL so the frontend can use it directly without constructing the media path
    profile_picture_url = serializers.SerializerMethodField(read_only=True)
    # Derived role string for the frontend RBAC system
    role = serializers.SerializerMethodField(read_only=True)
    # Convenience display name
    full_name = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = CustomUser
        exclude = ("password",)
        read_only_fields = (
            "id", "created_at", "updated_at", "last_login", "date_joined",
            "must_change_password",
        )

    def get_profile_picture_url(self, obj) -> str | None:
        """Return absolute URL if a picture is set, otherwise None."""
        if not obj.profile_picture:
            return None
        request = self.context.get("request")
        if request:
            return request.build_absolute_uri(obj.profile_picture.url)
        # Fallback: return relative URL if no request context (e.g. tests)
        return obj.profile_picture.url

    def get_role(self, obj) -> str:
        """
        Return a single role string for the frontend.

        Priority:
          1. Django superuser  → SUPER_ADMIN
          2. First assigned role's name (uppercased + underscored)
          3. Fallback          → CASHIER
        """
        if obj.is_superuser:
            return "SUPER_ADMIN"
        # Look up assigned roles through UserRole join table
        user_role = obj.user_roles.select_related("role").first()
        if user_role and user_role.role:
            # Normalise: "Admin" → "ADMIN", "Inventory Clerk" → "INVENTORY_CLERK"
            name = user_role.role.name.strip().upper().replace(" ", "_")
            # Map common aliases to canonical frontend role names
            alias_map = {
                "SUPER_ADMIN": "SUPER_ADMIN",
                "SUPERADMIN":  "SUPER_ADMIN",
                "ADMIN":       "ADMIN",
                "MANAGER":     "MANAGER",
                "CASHIER":     "CASHIER",
                "INVENTORY_CLERK": "INVENTORY_CLERK",
                "INVENTORY":   "INVENTORY_CLERK",
                "CLERK":       "INVENTORY_CLERK",
            }
            return alias_map.get(name, name)
        # Django staff (non-super) → ADMIN fallback
        if obj.is_staff:
            return "ADMIN"
        return "CASHIER"

    def get_full_name(self, obj) -> str:
        return f"{obj.first_name} {obj.last_name}".strip() or obj.username


class LoginSerializer(serializers.Serializer):
    # Accept username, email, or phone_number — any one is sufficient.
    # 'identifier' is also accepted as a catch-all field name from the frontend.
    username     = serializers.CharField(required=False, allow_blank=True)
    identifier   = serializers.CharField(required=False, allow_blank=True)   # generic fallback
    phone_number = serializers.CharField(required=False, allow_blank=True)
    email        = serializers.CharField(required=False, allow_blank=True)   # CharField, not EmailField
    password     = serializers.CharField(write_only=True)

    def validate(self, data):
        username     = (data.get("username",     "") or "").strip()
        identifier   = (data.get("identifier",   "") or "").strip()
        phone_number = (data.get("phone_number", "") or "").strip()
        email        = (data.get("email",        "") or "").strip()
        password     = data.get("password", "")

        # 'identifier' and 'email' are interchangeable generic fields —
        # prefer whichever the frontend sends (email is the legacy key).
        lookup = username or identifier or email

        user = None

        # ── 1. Direct username authenticate ───────────────────────────────────
        if lookup and not user:
            user = authenticate(username=lookup, password=password)

        # ── 2. Email lookup → username authenticate ───────────────────────────
        if lookup and not user:
            try:
                user_obj = CustomUser.objects.get(email=lookup)
                user = authenticate(username=user_obj.username, password=password)
            except CustomUser.DoesNotExist:
                pass

        # ── 3. Phone number lookup ────────────────────────────────────────────
        phone = phone_number or ""
        if phone and not user:
            try:
                user_obj = CustomUser.objects.get(phone_number=phone)
                user = authenticate(username=user_obj.username, password=password)
            except CustomUser.DoesNotExist:
                pass

        if not user:
            raise serializers.ValidationError("Invalid credentials.")
        if not user.is_active:
            raise serializers.ValidationError("User is inactive.")

        data["user"] = user
        return data


class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = "__all__"
        read_only_fields = ("id", "created_at")


class UserRoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserRole
        fields = "__all__"
        read_only_fields = ("id", "assigned_at")


class RolePermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = RolePermission
        fields = "__all__"
        read_only_fields = ("id", "granted_at")
