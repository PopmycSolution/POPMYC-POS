import pytest


@pytest.mark.unit
class TestBusinessesModelsImport:
    def test_can_import_models_module(self):
        from businesses import models
        assert models is not None

    def test_business_model_exists(self):
        from businesses.models import Business
        assert Business is not None

    def test_business_settings_model_exists(self):
        from businesses.models import BusinessSettings
        assert BusinessSettings is not None
