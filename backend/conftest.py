"""
conftest.py
===========
Shared pytest fixtures for the POPMYC POS backend test suite.
"""
import django
import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import pytest
from rest_framework.test import APIClient


@pytest.fixture
def api_client():
    """Unauthenticated DRF APIClient — suitable for public endpoints."""
    return APIClient()


@pytest.fixture
def auth_client(db):
    """
    Authenticated DRF APIClient using a freshly created superuser.
    Uses the `db` fixture so the user is created inside a transaction
    that rolls back after each test.
    """
    from django.contrib.auth import get_user_model
    User = get_user_model()
    user = User.objects.create_superuser(
        username="_pytest_admin_",
        password="testpass123!",
        email="pytest@popmyc.test",
    )
    client = APIClient()
    client.force_authenticate(user=user)
    return client
