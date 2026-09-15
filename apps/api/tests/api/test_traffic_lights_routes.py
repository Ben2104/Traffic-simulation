import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import deps
from app.api.traffic_lights import router
from app.simulation.models import TrafficLightApproach


class _StubRunner:
    def __init__(self, approaches):
        self._approaches = approaches

    def get_traffic_light_approaches(self):
        return self._approaches


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router)
    yield TestClient(app)
    deps.deps.runner = None


def test_returns_the_approach_list(client):
    deps.deps.runner = _StubRunner(
        [
            TrafficLightApproach(
                tls_id="tls-1",
                lane_id="north_0",
                link_indices=[0, 1],
                lat=37.7765,
                lng=-122.3946,
                heading=90.0,
            )
        ]
    )
    response = client.get("/traffic-lights")
    assert response.status_code == 200
    assert response.json() == {
        "approaches": [
            {
                "tls_id": "tls-1",
                "lane_id": "north_0",
                "link_indices": [0, 1],
                "lat": 37.7765,
                "lng": -122.3946,
                "heading": 90.0,
            }
        ]
    }


def test_returns_an_empty_list_when_the_network_has_no_signals(client):
    deps.deps.runner = _StubRunner([])
    response = client.get("/traffic-lights")
    assert response.status_code == 200
    assert response.json() == {"approaches": []}


def test_returns_503_when_the_simulation_is_not_ready(client):
    # 503, not 500. The dashboard polls this on mount and may well beat the
    # simulation's startup; it retries on 503 and renders the map meanwhile,
    # so first paint is never blocked on signal geometry.
    deps.deps.runner = None
    response = client.get("/traffic-lights")
    assert response.status_code == 503
    assert response.json()["detail"] == "simulation not ready"
