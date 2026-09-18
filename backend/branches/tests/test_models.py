import pytest


@pytest.mark.unit
class TestBranchesModelsImport:
    def test_can_import_models_module(self):
        from branches import models
        assert models is not None

    def test_branch_model_exists(self):
        from branches.models import Branch
        assert Branch is not None

    def test_warehouse_model_exists(self):
        from branches.models import Warehouse
        assert Warehouse is not None

    def test_register_model_exists(self):
        from branches.models import Register
        assert Register is not None
