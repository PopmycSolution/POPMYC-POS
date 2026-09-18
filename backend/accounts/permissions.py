from rest_framework import permissions


class HasRolePermission(permissions.BasePermission):
    """
    Checks the custom POPMYC POS role/permission system.

    Superusers automatically have full access.
    Other users must have the required custom permission
    through at least one of their assigned roles.
    """

    def has_permission(self, request, view):
        user = request.user

        # User must be authenticated
        if not user or not user.is_authenticated:
            return False

        # Django Super Admin gets full access
        if user.is_superuser:
            return True

        # Get the permission required by the current view/action
        required_permission = self.get_required_permission(request, view)

        # Deny if the view has no required permission configured
        if not required_permission:
            return False

        # User must belong to a business
        if not user.business:
            return False

        # Check the user's assigned roles and permissions
        return user.user_roles.filter(
            role__business=user.business,
            role__role_permissions__permission__codename=required_permission,
        ).exists()

    def has_object_permission(self, request, view, obj):
        return self.has_permission(request, view)

    def get_required_permission(self, request, view):
        """
        Get the custom permission codename assigned
        to the current view/action.
        """

        permission_map = getattr(
            view,
            "required_permissions",
            {},
        )

        action = getattr(view, "action", None)

        if action:
            return permission_map.get(action)

        method = request.method.lower()

        return permission_map.get(method)