import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import deps
from app.api.incidents import router
from app.incidents.store import IncidentStore
from app.simulation.models import CollisionResult


class _StubRunner:
    def __init__(self):
        self.triggered_edge = None

    def pick_busy_edge(self):
        return "AB"

    def trigger_collision(self, edge_id):
        self.triggered_edge = edge_id
        if edge_id == "EMPTY":
            raise ValueError(f"no vehicles present on edge {edge_id!r}")
        return CollisionResult(incident_edge_id=edge_id, vehicle_ids=["veh0"], lat=37.7, lng=-122.4)


class _NoVehiclesRunner:
    """Stub whose pick_busy_edge raises, simulating an empty simulation."""

    def pick_busy_edge(self):
        raise ValueError("no vehicles currently in simulation")

    def trigger_collision(self, edge_id):
        raise AssertionError("trigger_collision should not be called when pick_busy_edge raises")


@pytest.fixture(autouse=True)
def reset_deps():
    deps.deps.runner = None
    deps.deps.store = None
    yield
    deps.deps.runner = None
    deps.deps.store = None


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router)
    deps.deps.runner = _StubRunner()
    deps.deps.store = IncidentStore()
    return TestClient(app)


def test_trigger_collision_creates_incident_and_returns_id(client):
    response = client.post("/demo/trigger-collision", json={})
    assert response.status_code == 200
    assert response.json()["incident_id"].startswith("INC-")


def test_trigger_collision_with_explicit_edge_uses_it(client):
    response = client.post("/demo/trigger-collision", json={"edge_id": "BC"})
    assert response.status_code == 200
    assert deps.deps.runner.triggered_edge == "BC"


def test_trigger_collision_returns_400_for_edge_with_no_vehicles(client):
    response = client.post("/demo/trigger-collision", json={"edge_id": "EMPTY"})
    assert response.status_code == 400


def test_list_incidents_returns_created_incidents(client):
    client.post("/demo/trigger-collision", json={})
    response = client.get("/incidents")
    assert len(response.json()) == 1


def test_get_incident_returns_404_for_unknown_id(client):
    response = client.get("/incidents/INC-9999")
    assert response.status_code == 404


def test_trigger_collision_returns_400_when_no_vehicles_in_simulation():
    app = FastAPI()
    app.include_router(router)
    deps.deps.runner = _NoVehiclesRunner()
    deps.deps.store = IncidentStore()
    client = TestClient(app)

    response = client.post("/demo/trigger-collision", json={})

    assert response.status_code == 400
