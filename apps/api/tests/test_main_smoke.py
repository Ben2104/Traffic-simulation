import os
import subprocess

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


def _sumo_pids() -> set[str]:
    """Snapshot of PIDs for any currently-running process with 'sumo' in its
    command name, via `ps` (no psutil dependency)."""
    result = subprocess.run(
        ["ps", "-A", "-o", "pid,comm"], capture_output=True, text=True, check=True
    )
    pids = set()
    for line in result.stdout.splitlines()[1:]:
        parts = line.split(None, 1)
        if len(parts) == 2 and "sumo" in parts[1].lower():
            pids.add(parts[0])
    return pids


def test_app_starts_and_serves_incidents_with_fixture_network(monkeypatch):
    monkeypatch.setenv("SIM_SUMO_NET_FILE", os.path.join(FIXTURES_DIR, "fixture.net.xml"))
    monkeypatch.setenv("SIM_SUMO_ROUTE_FILE", os.path.join(FIXTURES_DIR, "fixture.rou.xml"))
    with TestClient(app) as client:
        response = client.get("/incidents")
        assert response.status_code == 200
        assert response.json() == []


def test_app_lifespan_raises_and_leaves_no_orphan_sumo_process_when_start_fails(monkeypatch):
    monkeypatch.setenv(
        "SIM_SUMO_NET_FILE", os.path.join(FIXTURES_DIR, "does-not-exist.net.xml")
    )
    monkeypatch.setenv("SIM_SUMO_ROUTE_FILE", os.path.join(FIXTURES_DIR, "fixture.rou.xml"))

    before = _sumo_pids()

    with pytest.raises(Exception):
        with TestClient(app):
            pass

    after = _sumo_pids()
    assert after - before == set(), (
        f"orphan sumo process(es) left behind: pids={after - before}"
    )
