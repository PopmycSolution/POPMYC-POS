import pytest
from django.urls import reverse


pytestmark = pytest.mark.django_db


@pytest.mark.unit
class TestPingEndpoint:
    def test_ping_returns_200(self, api_client):
        url = reverse("ping")
        response = api_client.get(url)
        assert response.status_code == 200

    def test_ping_returns_pong_message(self, api_client):
        url = reverse("ping")
        response = api_client.get(url)
        data = response.json()
        assert data["message"] == "pong"


@pytest.mark.unit
class TestHealthCheckEndpoint:
    def test_health_returns_200(self, api_client):
        url = reverse("health-check")
        response = api_client.get(url)
        assert response.status_code == 200

    def test_health_has_status_ok(self, api_client):
        url = reverse("health-check")
        response = api_client.get(url)
        data = response.json()
        assert data["status"] == "ok"

    def test_health_has_version(self, api_client):
        url = reverse("health-check")
        response = api_client.get(url)
        data = response.json()
        assert "version" in data
        assert data["version"] == "0.1.0"

    def test_health_has_timestamp(self, api_client):
        url = reverse("health-check")
        response = api_client.get(url)
        data = response.json()
        assert "timestamp" in data

    def test_health_has_database_status(self, api_client):
        url = reverse("health-check")
        response = api_client.get(url)
        data = response.json()
        assert "database" in data
        assert data["database"] in ("ok", "error")
