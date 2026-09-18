import pytest


@pytest.mark.unit
class TestSalesModelsImport:
    def test_can_import_models_module(self):
        from sales import models
        assert models is not None

    def test_models_module_has_docstring(self):
        from sales import models
        assert models.__doc__ is not None or len(models.__file__) > 0
