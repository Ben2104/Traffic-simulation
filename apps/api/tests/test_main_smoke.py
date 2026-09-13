import os
import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "simulation", "fixtures")


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_app_starts_and_serves_incidents_with_fixture_network(monkeypatch):
    monkeypatch.setenv("SIM_SUMO_NET_FILE", os.path.join(FIXTURES_DIR, "fixture.net.xml"))
    monkeypatch.setenv("SIM_SUMO_ROUTE_FILE", os.path.join(FIXTURES_DIR, "fixture.rou.xml"))
    with TestClient(app) as client:
        response = client.get("/incidents")
        assert response.status_code == 200
        assert response.json() == []
