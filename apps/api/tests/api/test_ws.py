import json
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.ws import ConnectionManager, manager, router
from app.config import get_settings
from app.main import app as real_app
from app.simulation.models import VehicleState

FIXTURES_DIR = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "simulation", "fixtures"
)


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def app():
    fastapi_app = FastAPI()
    fastapi_app.include_router(router)
    return fastapi_app


def test_connect_and_disconnect_updates_connection_count(app):
    client = TestClient(app)
    assert manager.connection_count == 0
    with client.websocket_connect("/ws/simulation"):
        assert manager.connection_count == 1
    assert manager.connection_count == 0


class _FakeWebSocket:
    def __init__(self, fail: bool = False):
        self.fail = fail
        self.sent: list[dict] = []

    async def send_json(self, data: dict) -> None:
        if self.fail:
            raise RuntimeError("boom")
        self.sent.append(data)


async def test_broadcast_removes_stale_connections_and_delivers_to_healthy_ones():
    mgr = ConnectionManager()
    healthy = _FakeWebSocket()
    broken = _FakeWebSocket(fail=True)
    mgr._connections = {healthy, broken}

    await mgr.broadcast({"type": "simulation.error", "message": "hi"})

    assert healthy.sent == [{"type": "simulation.error", "message": "hi"}]
    assert mgr.connection_count == 1


async def test_broadcast_drops_frame_entries_containing_a_non_finite_float():
    # Defence-in-depth at the serialisation boundary, independent of whatever
    # upstream producer (correctly or not) built the frame. Starlette's
    # WebSocket.send_json serialises with json.dumps(..., allow_nan=True) by
    # default, which happily writes a bare `Infinity` / `-Infinity` / `NaN`
    # token for a non-finite float. That token is not valid JSON: a strict
    # parser -- the browser's JSON.parse, most notably -- throws on it and
    # discards the ENTIRE message, not just the offending entry. This proves
    # the boundary catches that case even if a future producer reintroduces a
    # non-finite value: the offending vehicle is dropped, the rest of the
    # frame is delivered, and what's actually sent is provably representable
    # as strict JSON (allow_nan=False must not raise).
    mgr = ConnectionManager()
    healthy = _FakeWebSocket()
    mgr._connections = {healthy}

    frame = {
        "type": "simulation.vehicles",
        "tick": 7,
        "vehicles": [
            {"id": "ok", "lat": 37.7, "lng": -122.4, "heading": 90.0, "speed": 5.0, "kind": "civilian"},
            {
                "id": "ghost",
                "lat": float("inf"),
                "lng": float("inf"),
                "heading": -1073741824.0,
                "speed": -1073741824.0,
                "kind": "civilian",
            },
        ],
    }

    await mgr.broadcast(frame)

    assert len(healthy.sent) == 1
    sent = healthy.sent[0]
    assert {v["id"] for v in sent["vehicles"]} == {"ok"}
    # Round-trips clean through strict JSON -- the actual browser failure
    # mode this guards against.
    json.dumps(sent, allow_nan=False)


ALLOWED_MESSAGE_TYPES = {"simulation.vehicles", "incident.created", "simulation.error"}


def _receive_until(websocket, message_type: str, limit: int = 80) -> dict:
    """Read frames until one of `message_type` arrives, bounded so a broken
    contract fails fast instead of hanging the suite forever."""
    seen: list[str] = []
    for _ in range(limit):
        frame = websocket.receive_json()
        assert frame["type"] in ALLOWED_MESSAGE_TYPES, (
            f"unexpected WS message type {frame['type']!r} "
            f"(this slice ships exactly {sorted(ALLOWED_MESSAGE_TYPES)})"
        )
        seen.append(frame["type"])
        if frame["type"] != message_type:
            continue
        if message_type == "simulation.vehicles" and not frame["vehicles"]:
            continue  # sim hasn't spawned any vehicles yet
        return frame
    raise AssertionError(
        f"no {message_type!r} frame after {limit} messages; saw {seen}"
    )


def test_ws_simulation_streams_pydantic_valid_vehicle_frames_and_incident_created(
    monkeypatch,
):
    """End-to-end WS contract test the spec promises (spec:167-168).

    Runs the *real* app against the fixture SUMO network and reads frames off
    the real `/ws/simulation` route, so the whole path (tick loop ->
    ConnectionManager -> socket) is exercised, not just its pieces. Also pins
    `incident.created.created_at` as a JSON string: `frames.py` uses
    `model_dump(mode="json")` there and a plain `model_dump()` for vehicles,
    and only the former keeps the TypeScript `Incident.created_at: string`
    contract honest.
    """
    monkeypatch.setenv(
        "SIM_SUMO_NET_FILE", os.path.join(FIXTURES_DIR, "fixture.net.xml")
    )
    monkeypatch.setenv(
        "SIM_SUMO_ROUTE_FILE", os.path.join(FIXTURES_DIR, "fixture.rou.xml")
    )

    with TestClient(real_app) as client:
        with client.websocket_connect("/ws/simulation") as websocket:
            frame = _receive_until(websocket, "simulation.vehicles")

            assert isinstance(frame["tick"], int)
            assert frame["vehicles"]
            for entry in frame["vehicles"]:
                vehicle = VehicleState.model_validate(entry)
                assert isinstance(vehicle.id, str)
                assert isinstance(vehicle.lat, float)
                assert isinstance(vehicle.lng, float)

            response = client.post("/demo/trigger-collision")
            assert response.status_code == 200, response.text
            incident_id = response.json()["incident_id"]

            incident_frame = _receive_until(websocket, "incident.created")

    incident = incident_frame["incident"]
    assert incident["id"] == incident_id
    assert incident["kind"] == "collision"
    assert incident["severity"] == "HIGH"
    assert set(incident["location"]) == {"lat", "lng", "edge_id"}
    assert isinstance(incident["vehicles_involved"], list)
    # The one cross-language type that can silently break the frontend's
    # `Incident.created_at: string` if frames.py ever drops mode="json".
    assert isinstance(incident["created_at"], str)
