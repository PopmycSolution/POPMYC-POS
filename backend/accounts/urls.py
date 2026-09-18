from django.urls import path, include
from rest_framework.routers import DefaultRouter
from accounts.views import (
    UserViewSet,
    RoleViewSet,
    PermissionViewSet,
    LoginView,
    LogoutView,
    CurrentUserView,
    PasswordChangeView,
    ProfilePictureView,
    UserRoleViewSet,
    RolePermissionViewSet,
)

router = DefaultRouter()
router.register(r"users", UserViewSet)
router.register(r"roles", RoleViewSet)
router.register(r"permissions", PermissionViewSet)
router.register(r"user-roles", UserRoleViewSet)
router.register(r"role-permissions", RolePermissionViewSet)

urlpatterns = [
    path("login/",    LoginView.as_view(),    name="login"),
    path("logout/",   LogoutView.as_view(),   name="logout"),
    path("me/",       CurrentUserView.as_view(), name="current-user"),
    # Self-service password change (requires current password)
    path("me/password/", PasswordChangeView.as_view(),  name="password-change"),
    # Profile picture: POST to upload/replace, DELETE to remove
    path("me/avatar/",   ProfilePictureView.as_view(),  name="profile-picture"),
    path("", include(router.urls)),
]
