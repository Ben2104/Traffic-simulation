import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.ws import ConnectionManager, manager, router


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
