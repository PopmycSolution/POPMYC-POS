import pytest


@pytest.mark.unit
class TestAccountsModelsImport:
    def test_can_import_models_module(self):
        from accounts import models
        assert models is not None

    def test_custom_user_model_exists(self):
        from accounts.models import CustomUser
        assert CustomUser is not None

    def test_role_model_exists(self):
        from accounts.models import Role
        assert Role is not None

    def test_permission_model_exists(self):
        from accounts.models import Permission
        assert Permission is not None

    def test_user_role_model_exists(self):
        from accounts.models import UserRole
        assert UserRole is not None

    def test_role_permission_model_exists(self):
        from accounts.models import RolePermission
        assert RolePermission is not None
