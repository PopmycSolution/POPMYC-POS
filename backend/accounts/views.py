"""
accounts/views.py
=================
Authentication and user-management endpoints for POPMYC POS.

Password-management endpoints
------------------------------
POST /api/v1/accounts/me/password/
    Self-service: authenticated user changes their OWN password.

POST /api/v1/accounts/users/{id}/reset-password/
    Admin-only: reset another user's password.

Profile-picture endpoints
--------------------------
POST   /api/v1/accounts/me/avatar/   — upload / replace picture (multipart)
DELETE /api/v1/accounts/me/avatar/   — remove picture
GET    /api/v1/accounts/me/          — returns profile_picture_url in payload
"""
import os
import secrets
import string

from django.contrib.auth import update_session_auth_hash
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.filters import SearchFilter, OrderingFilter
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import CustomUser, Role, Permission, UserRole, RolePermission
from accounts.serializers import (
    CustomUserSerializer,
    LoginSerializer,
    PermissionSerializer,
    RolePermissionSerializer,
    RoleSerializer,
    UserRoleSerializer,
)
from audit.models import AuditLog

# ── Constants ──────────────────────────────────────────────────────────────────
AVATAR_MAX_BYTES    = 5 * 1024 * 1024          # 5 MB hard limit
AVATAR_MAX_PIXELS   = 4096 * 4096              # safety cap for decompression bomb
AVATAR_OUTPUT_SIZE  = (400, 400)               # resize to 400×400 square
AVATAR_ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}
AVATAR_ALLOWED_EXT  = {".jpg", ".jpeg", ".png", ".webp"}

# ── Helpers ────────────────────────────────────────────────────────────────────

def _log(*, actor, action, target_user, business, reason="", request=None):
    """Write an AuditLog entry. Never logs passwords or raw image data."""
    ip = None
    ua = ""
    if request:
        x_fwd = request.META.get("HTTP_X_FORWARDED_FOR")
        ip = x_fwd.split(",")[0].strip() if x_fwd else request.META.get("REMOTE_ADDR")
        ua = request.META.get("HTTP_USER_AGENT", "")
    AuditLog.objects.create(
        business=business,
        user=actor,
        action=action,
        module="accounts",
        entity_type="CustomUser",
        entity_id=target_user.id,
        old_values={},
        new_values={"must_change_password": target_user.must_change_password},
        ip_address=ip,
        user_agent=ua,
        reason=reason,
    )


def _generate_temp_password(length: int = 16) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    while True:
        pwd = "".join(secrets.choice(alphabet) for _ in range(length))
        if (any(c.isalpha() for c in pwd) and any(c.isdigit() for c in pwd)
                and any(c in "!@#$%^&*" for c in pwd)):
            return pwd


def _can_admin_manage_target(admin_user: CustomUser, target_user: CustomUser) -> bool:
    if admin_user.is_superuser:
        return True
    if not admin_user.business_id:
        return False
    if target_user.is_superuser:
        return False
    return str(admin_user.business_id) == str(target_user.business_id)


# ── ViewSets ───────────────────────────────────────────────────────────────────

class UserViewSet(viewsets.ModelViewSet):
    queryset = CustomUser.objects.all()
    serializer_class = CustomUserSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "branch", "is_active", "is_staff", "is_superuser"]
    search_fields = ["username", "email", "phone_number", "first_name", "last_name"]
    ordering_fields = ["created_at", "updated_at", "username", "date_joined"]
    ordering = ["-created_at"]

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["request"] = self.request
        return ctx

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return CustomUser.objects.none()
        qs = super().get_queryset()
        user = self.request.user
        if user.is_superuser:
            return qs
        if user.business:
            return qs.filter(business=user.business)
        return qs.none()

    @action(detail=True, methods=["post"], url_path="reset-password",
            permission_classes=[permissions.IsAuthenticated])
    def reset_password(self, request, pk=None):
        admin = request.user
        if not (admin.is_superuser or admin.is_staff):
            is_admin_role = admin.user_roles.filter(
                role__name__iexact="admin",
                role__business=admin.business,
            ).exists() if admin.business else False
            if not is_admin_role:
                return Response(
                    {"detail": "You do not have permission to reset passwords."},
                    status=status.HTTP_403_FORBIDDEN,
                )
        target = self.get_object()
        if not _can_admin_manage_target(admin, target):
            return Response(
                {"detail": "You cannot reset the password for a user outside your business."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if target.pk == admin.pk:
            return Response(
                {"detail": "Use the self-service /me/password/ endpoint to change your own password."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        new_password = request.data.get("new_password") or _generate_temp_password()
        try:
            validate_password(new_password, user=target)
        except DjangoValidationError as exc:
            return Response({"detail": exc.messages}, status=status.HTTP_400_BAD_REQUEST)
        target.set_password(new_password)
        target.must_change_password = True
        target.save(update_fields=["password", "must_change_password", "updated_at"])
        _log(actor=admin, action="PASSWORD_CHANGE", target_user=target,
             business=admin.business, reason="Administrator password reset", request=request)
        return Response(
            {
                "detail": f"Password for {target.username} has been reset. "
                          "The user must change it on next login.",
                "must_change_password": True,
                "temporary_password": new_password,
            },
            status=status.HTTP_200_OK,
        )


class RoleViewSet(viewsets.ModelViewSet):
    queryset = Role.objects.all()
    serializer_class = RoleSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "is_system"]
    search_fields = ["name", "description"]
    ordering_fields = ["created_at", "updated_at", "name"]
    ordering = ["-created_at"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Role.objects.none()
        qs = super().get_queryset()
        user = self.request.user
        if user.is_superuser:
            return qs
        if user.business:
            return qs.filter(business=user.business)
        return qs.none()


class PermissionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Permission.objects.all()
    serializer_class = PermissionSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["module"]
    search_fields = ["codename", "name", "description"]
    ordering_fields = ["created_at", "codename", "name"]
    ordering = ["module", "codename"]


# ── API Views ──────────────────────────────────────────────────────────────────

class LoginView(APIView):
    permission_classes = [permissions.AllowAny]
    serializer_class = LoginSerializer

    def post(self, request):
        serializer = self.serializer_class(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        refresh = RefreshToken.for_user(user)
        user_data = CustomUserSerializer(user, context={"request": request}).data
        return Response(
            {
                "refresh": str(refresh),
                "access": str(refresh.access_token),
                "user": user_data,
                "must_change_password": user.must_change_password,
            },
            status=status.HTTP_200_OK,
        )


class LogoutView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        try:
            refresh_token = request.data.get("refresh")
            if refresh_token:
                token = RefreshToken(refresh_token)
                token.blacklist()
            return Response({"detail": "Successfully logged out."}, status=status.HTTP_200_OK)
        except TokenError:
            return Response({"detail": "Invalid token."}, status=status.HTTP_400_BAD_REQUEST)


class CurrentUserView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = CustomUserSerializer

    def get(self, request):
        serializer = self.serializer_class(request.user, context={"request": request})
        return Response(serializer.data, status=status.HTTP_200_OK)

    def put(self, request):
        serializer = self.serializer_class(
            request.user, data=request.data, partial=True,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)

    def patch(self, request):
        return self.put(request)


class ProfilePictureView(APIView):
    """
    Manage the authenticated user's own profile picture.

    POST   /api/v1/accounts/me/avatar/
        Upload or replace the profile picture.
        Accepts multipart/form-data with field name "avatar".
        Validates: file type (jpg/jpeg/png/webp), size (≤ 5 MB),
        image integrity (via Pillow). Resizes to 400×400 square
        (LANCZOS, centre-crop) to save storage.

    DELETE /api/v1/accounts/me/avatar/
        Remove the profile picture and delete the file from storage.
    """
    permission_classes = [permissions.IsAuthenticated]
    parser_classes     = [MultiPartParser, FormParser]

    def post(self, request):
        uploaded = request.FILES.get("avatar")
        if not uploaded:
            return Response(
                {"detail": "No file provided. Send a file in the 'avatar' field."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── 1. Size check (fast, before Pillow) ───────────────────────────────
        if uploaded.size > AVATAR_MAX_BYTES:
            return Response(
                {"detail": f"File too large. Maximum allowed size is 5 MB (got {uploaded.size // 1024} KB)."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── 2. Extension check ────────────────────────────────────────────────
        _, ext = os.path.splitext(uploaded.name.lower())
        if ext not in AVATAR_ALLOWED_EXT:
            return Response(
                {"detail": f"Unsupported file type '{ext}'. Allowed: jpg, jpeg, png, webp."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── 3. Pillow validation + resize ─────────────────────────────────────
        try:
            from PIL import Image
            import io

            img = Image.open(uploaded)
            img.verify()                      # detects truncated / corrupt files

            # Re-open after verify() (verify() leaves file in indeterminate state)
            uploaded.seek(0)
            img = Image.open(uploaded)

            # Decompression-bomb guard (already covered by Pillow's default
            # MAX_IMAGE_PIXELS, but be explicit)
            w, h = img.size
            if w * h > AVATAR_MAX_PIXELS:
                return Response(
                    {"detail": "Image dimensions are too large."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Convert to RGB (handles RGBA/P PNGs, WebP with alpha, etc.)
            img = img.convert("RGBA") if img.mode in ("RGBA", "LA") else img.convert("RGB")
            img = img.convert("RGB")

            # Centre-crop to square then resize to 400×400
            side = min(img.width, img.height)
            left = (img.width  - side) // 2
            top  = (img.height - side) // 2
            img  = img.crop((left, top, left + side, top + side))
            img  = img.resize(AVATAR_OUTPUT_SIZE, Image.LANCZOS)

            # Write processed image to an in-memory buffer
            buffer = io.BytesIO()
            img.save(buffer, format="JPEG", quality=88, optimize=True)
            buffer.seek(0)

        except Exception as exc:
            return Response(
                {"detail": f"Invalid or corrupt image file: {exc}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── 4. Delete old picture file from storage (if any) ──────────────────
        user = request.user
        if user.profile_picture:
            try:
                user.profile_picture.delete(save=False)
            except Exception:
                pass     # file may already be gone; safe to ignore

        # ── 5. Save processed image ───────────────────────────────────────────
        from django.core.files.base import ContentFile
        filename = f"{user.pk}.jpg"
        user.profile_picture.save(filename, ContentFile(buffer.read()), save=True)

        serializer = CustomUserSerializer(user, context={"request": request})
        return Response(
            {
                "detail": "Profile picture updated successfully.",
                "profile_picture_url": serializer.data.get("profile_picture_url"),
            },
            status=status.HTTP_200_OK,
        )

    def delete(self, request):
        user = request.user
        if not user.profile_picture:
            return Response(
                {"detail": "No profile picture to remove."},
                status=status.HTTP_404_NOT_FOUND,
            )
        user.profile_picture.delete(save=False)
        user.profile_picture = None
        user.save(update_fields=["profile_picture", "updated_at"])
        return Response(
            {"detail": "Profile picture removed.", "profile_picture_url": None},
            status=status.HTTP_200_OK,
        )


class PasswordChangeView(APIView):
    """
    Self-service password change.
    POST /api/v1/accounts/me/password/
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        old_password     = request.data.get("old_password", "").strip()
        new_password     = request.data.get("new_password", "").strip()
        confirm_password = request.data.get("confirm_password", "").strip()

        if not old_password or not new_password or not confirm_password:
            return Response(
                {"detail": "old_password, new_password, and confirm_password are all required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user = request.user
        if not user.check_password(old_password):
            _log(actor=user, action="PASSWORD_CHANGE", target_user=user,
                 business=user.business,
                 reason="Failed password change — incorrect current password",
                 request=request)
            return Response({"detail": "Current password is incorrect."}, status=status.HTTP_400_BAD_REQUEST)
        if new_password != confirm_password:
            return Response({"detail": "New password and confirmation do not match."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_password(new_password, user=user)
        except DjangoValidationError as exc:
            return Response({"detail": exc.messages}, status=status.HTTP_400_BAD_REQUEST)
        user.set_password(new_password)
        user.must_change_password = False
        user.save(update_fields=["password", "must_change_password", "updated_at"])
        update_session_auth_hash(request, user)
        _log(actor=user, action="PASSWORD_CHANGE", target_user=user,
             business=user.business, reason="User changed own password", request=request)
        return Response(
            {"detail": "Password changed successfully.", "must_change_password": False},
            status=status.HTTP_200_OK,
        )


class UserRoleViewSet(viewsets.ModelViewSet):
    queryset = UserRole.objects.all()
    serializer_class = UserRoleSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["user", "role"]
    search_fields = ["user__username", "role__name"]
    ordering_fields = ["assigned_at"]
    ordering = ["-assigned_at"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return UserRole.objects.none()
        qs = super().get_queryset()
        user = self.request.user
        if user.is_superuser:
            return qs
        if user.business:
            return qs.filter(role__business=user.business)
        return qs.none()


class RolePermissionViewSet(viewsets.ModelViewSet):
    queryset = RolePermission.objects.all()
    serializer_class = RolePermissionSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["role", "permission"]
    search_fields = ["role__name", "permission__codename", "permission__name"]
    ordering_fields = ["granted_at"]
    ordering = ["-granted_at"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return RolePermission.objects.none()
        qs = super().get_queryset()
        user = self.request.user
        if user.is_superuser:
            return qs
        if user.business:
            return qs.filter(role__business=user.business)
        return qs.none()
import secrets
import string

from django.contrib.auth import update_session_auth_hash
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.filters import SearchFilter, OrderingFilter
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import CustomUser, Role, Permission, UserRole, RolePermission
from accounts.serializers import (
    CustomUserSerializer,
    LoginSerializer,
    PermissionSerializer,
    RolePermissionSerializer,
    RoleSerializer,
    UserRoleSerializer,
)
from audit.models import AuditLog


# ── Helpers ────────────────────────────────────────────────────────────────────

def _log(*, actor, action, target_user, business, reason="", request=None):
    """Write an AuditLog entry for password-related events.
    Deliberately does NOT log the password itself."""
    ip = None
    ua = ""
    if request:
        x_fwd = request.META.get("HTTP_X_FORWARDED_FOR")
        ip = x_fwd.split(",")[0].strip() if x_fwd else request.META.get("REMOTE_ADDR")
        ua = request.META.get("HTTP_USER_AGENT", "")

    AuditLog.objects.create(
        business=business,
        user=actor,
        action=action,
        module="accounts",
        entity_type="CustomUser",
        entity_id=target_user.id,
        old_values={},
        new_values={"must_change_password": target_user.must_change_password},
        ip_address=ip,
        user_agent=ua,
        reason=reason,
    )


def _generate_temp_password(length: int = 16) -> str:
    """Generate a cryptographically random temporary password.
    Always satisfies Django's MinimumLengthValidator (≥8 chars) and
    NumericPasswordValidator (contains letters).
    """
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    while True:
        pwd = "".join(secrets.choice(alphabet) for _ in range(length))
        # Ensure at least one letter, one digit, one symbol
        if (
            any(c.isalpha() for c in pwd)
            and any(c.isdigit() for c in pwd)
            and any(c in "!@#$%^&*" for c in pwd)
        ):
            return pwd


def _can_admin_manage_target(admin_user: CustomUser, target_user: CustomUser) -> bool:
    """
    Return True if admin_user is authorised to reset target_user's password.
    - Super Admin: always True.
    - Business Admin/Manager/etc: True only if same business and target is not superuser.
    """
    if admin_user.is_superuser:
        return True
    # Business-level admin — same business, cannot touch superusers
    if not admin_user.business_id:
        return False
    if target_user.is_superuser:
        return False
    return str(admin_user.business_id) == str(target_user.business_id)


# ── ViewSets ───────────────────────────────────────────────────────────────────

class UserViewSet(viewsets.ModelViewSet):
    queryset = CustomUser.objects.all()
    serializer_class = CustomUserSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "branch", "is_active", "is_staff", "is_superuser"]
    search_fields = ["username", "email", "phone_number", "first_name", "last_name"]
    ordering_fields = ["created_at", "updated_at", "username", "date_joined"]
    ordering = ["-created_at"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return CustomUser.objects.none()
        qs = super().get_queryset()
        user = self.request.user
        if user.is_superuser:
            return qs
        if user.business:
            return qs.filter(business=user.business)
        return qs.none()

    @action(detail=True, methods=["post"], url_path="reset-password",
            permission_classes=[permissions.IsAuthenticated])
    def reset_password(self, request, pk=None):
        """
        Admin resets another user's password.
        POST /api/v1/accounts/users/{id}/reset-password/
        Body (optional): { "new_password": "..." }
          - If new_password is omitted a secure random one is generated.
        Returns: { "detail": "...", "must_change_password": true }
          - The raw password is returned ONCE so the admin can communicate it
            to the user through a secure out-of-band channel.
          - It is NOT logged.
        """
        admin = request.user

        # Only SUPER_ADMIN or ADMIN role may call this
        if not (admin.is_superuser or admin.is_staff):
            # Fall back: check role name for business admins
            is_admin_role = admin.user_roles.filter(
                role__name__iexact="admin",
                role__business=admin.business,
            ).exists() if admin.business else False
            if not is_admin_role:
                return Response(
                    {"detail": "You do not have permission to reset passwords."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        target = self.get_object()  # already scoped to requester's business via get_queryset

        if not _can_admin_manage_target(admin, target):
            return Response(
                {"detail": "You cannot reset the password for a user outside your business."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Disallow resetting your own password through this endpoint
        if target.pk == admin.pk:
            return Response(
                {"detail": "Use the self-service /me/password/ endpoint to change your own password."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        new_password = request.data.get("new_password") or _generate_temp_password()

        # Validate against project password validators
        try:
            validate_password(new_password, user=target)
        except DjangoValidationError as exc:
            return Response({"detail": exc.messages}, status=status.HTTP_400_BAD_REQUEST)

        target.set_password(new_password)
        target.must_change_password = True
        target.save(update_fields=["password", "must_change_password", "updated_at"])

        _log(
            actor=admin,
            action="PASSWORD_CHANGE",
            target_user=target,
            business=admin.business,
            reason="Administrator password reset",
            request=request,
        )

        return Response(
            {
                "detail": f"Password for {target.username} has been reset. "
                          "The user must change it on next login.",
                "must_change_password": True,
                # Return the temporary password ONCE — not logged, not stored in plain text
                "temporary_password": new_password,
            },
            status=status.HTTP_200_OK,
        )


class RoleViewSet(viewsets.ModelViewSet):
    queryset = Role.objects.all()
    serializer_class = RoleSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "is_system"]
    search_fields = ["name", "description"]
    ordering_fields = ["created_at", "updated_at", "name"]
    ordering = ["-created_at"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Role.objects.none()
        qs = super().get_queryset()
        user = self.request.user
        if user.is_superuser:
            return qs
        if user.business:
            return qs.filter(business=user.business)
        return qs.none()


class PermissionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Permission.objects.all()
    serializer_class = PermissionSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["module"]
    search_fields = ["codename", "name", "description"]
    ordering_fields = ["created_at", "codename", "name"]
    ordering = ["module", "codename"]


# ── API Views ──────────────────────────────────────────────────────────────────

class LoginView(APIView):
    permission_classes = [permissions.AllowAny]
    serializer_class = LoginSerializer

    def post(self, request):
        serializer = self.serializer_class(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]

        refresh = RefreshToken.for_user(user)
        user_data = CustomUserSerializer(user).data

        return Response(
            {
                "refresh": str(refresh),
                "access": str(refresh.access_token),
                "user": user_data,
                # Expose flag so the frontend can redirect to forced-change screen
                "must_change_password": user.must_change_password,
            },
            status=status.HTTP_200_OK,
        )


class LogoutView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        try:
            refresh_token = request.data.get("refresh")
            if refresh_token:
                token = RefreshToken(refresh_token)
                token.blacklist()
            return Response(
                {"detail": "Successfully logged out."},
                status=status.HTTP_200_OK,
            )
        except TokenError:
            return Response(
                {"detail": "Invalid token."},
                status=status.HTTP_400_BAD_REQUEST,
            )


class CurrentUserView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = CustomUserSerializer

    def get(self, request):
        serializer = self.serializer_class(request.user, context={"request": request})
        return Response(serializer.data, status=status.HTTP_200_OK)

    def put(self, request):
        serializer = self.serializer_class(request.user, data=request.data, partial=True,
                                           context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)

    def patch(self, request):
        return self.put(request)


class PasswordChangeView(APIView):
    """
    Self-service password change.
    POST /api/v1/accounts/me/password/
    Body: { "old_password": "...", "new_password": "...", "confirm_password": "..." }

    Rules:
    - old_password must match the user's current password.
    - new_password must pass Django's AUTH_PASSWORD_VALIDATORS.
    - confirm_password must equal new_password.
    - A user can only change THEIR OWN password via this endpoint.
    - On success: clears must_change_password flag, writes AuditLog.
    - On failure: writes AuditLog for wrong current-password attempts.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        old_password     = request.data.get("old_password", "").strip()
        new_password     = request.data.get("new_password", "").strip()
        confirm_password = request.data.get("confirm_password", "").strip()

        if not old_password or not new_password or not confirm_password:
            return Response(
                {"detail": "old_password, new_password, and confirm_password are all required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = request.user

        # 1. Verify current password
        if not user.check_password(old_password):
            _log(
                actor=user,
                action="PASSWORD_CHANGE",
                target_user=user,
                business=user.business,
                reason="Failed password change — incorrect current password",
                request=request,
            )
            return Response(
                {"detail": "Current password is incorrect."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 2. Confirm passwords match
        if new_password != confirm_password:
            return Response(
                {"detail": "New password and confirmation do not match."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 3. Validate strength against Django's configured validators
        try:
            validate_password(new_password, user=user)
        except DjangoValidationError as exc:
            return Response({"detail": exc.messages}, status=status.HTTP_400_BAD_REQUEST)

        # 4. Apply
        user.set_password(new_password)
        user.must_change_password = False   # clear forced-reset flag
        user.save(update_fields=["password", "must_change_password", "updated_at"])
        update_session_auth_hash(request, user)  # keep session valid (session auth path)

        _log(
            actor=user,
            action="PASSWORD_CHANGE",
            target_user=user,
            business=user.business,
            reason="User changed own password",
            request=request,
        )

        return Response(
            {
                "detail": "Password changed successfully.",
                "must_change_password": False,
            },
            status=status.HTTP_200_OK,
        )


class UserRoleViewSet(viewsets.ModelViewSet):
    queryset = UserRole.objects.all()
    serializer_class = UserRoleSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["user", "role"]
    search_fields = ["user__username", "role__name"]
    ordering_fields = ["assigned_at"]
    ordering = ["-assigned_at"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return UserRole.objects.none()
        qs = super().get_queryset()
        user = self.request.user
        if user.is_superuser:
            return qs
        if user.business:
            return qs.filter(role__business=user.business)
        return qs.none()


class RolePermissionViewSet(viewsets.ModelViewSet):
    queryset = RolePermission.objects.all()
    serializer_class = RolePermissionSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["role", "permission"]
    search_fields = ["role__name", "permission__codename", "permission__name"]
    ordering_fields = ["granted_at"]
    ordering = ["-granted_at"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return RolePermission.objects.none()
        qs = super().get_queryset()
        user = self.request.user
        if user.is_superuser:
            return qs
        if user.business:
            return qs.filter(role__business=user.business)
        return qs.none()
