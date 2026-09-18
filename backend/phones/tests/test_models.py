import pytest


@pytest.mark.unit
class TestPhonesModelsImport:
    def test_can_import_models_module(self):
        from phones import models
        assert models is not None

    def test_models_module_has_docstring(self):
        from phones import models
        assert models.__doc__ is not None or len(models.__file__) > 0
