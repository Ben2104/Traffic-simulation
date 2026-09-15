import logging
import math

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

log = logging.getLogger(__name__)


def _has_non_finite_float(value: object) -> bool:
    """True if `value` contains a float that strict JSON cannot represent.

    Recurses through dicts/lists so a single bad field anywhere inside a
    list entry (e.g. one vehicle's `lat`) is detected without having to know
    that frame's exact shape.
    """
    if isinstance(value, float):
        return not math.isfinite(value)
    if isinstance(value, dict):
        return any(_has_non_finite_float(v) for v in value.values())
    if isinstance(value, list):
        return any(_has_non_finite_float(v) for v in value)
    return False


def _drop_non_finite_entries(message: dict) -> dict:
    """Defence-in-depth at the WS serialisation boundary.

    Starlette's WebSocket.send_json serialises with json.dumps(...,
    allow_nan=True) (the default), which happily writes a bare `Infinity` /
    `-Infinity` / `NaN` token for a non-finite float. That token is not valid
    JSON: a strict parser -- the browser's JSON.parse, most notably -- throws
    on it and discards the ENTIRE message, not just the offending entry.
    (This is exactly what happened with TraCI's INVALID_DOUBLE_VALUE sentinel
    turning into an out-of-domain `inf` lat/lng: one bad vehicle killed every
    vehicle, signal, and incident in the frame.)

    get_vehicle_states() is fixed at its source for that known case, but this
    is the last line of defence for any producer, present or future, that
    reintroduces a non-finite value: the offending list entry (e.g. one
    vehicle) is dropped rather than the frame being sent as broken JSON.
    Top-level scalar fields (`type`, `tick`, ...) are left untouched -- there
    is nothing sensible to drop them to.
    """
    cleaned = dict(message)
    for key, value in message.items():
        if isinstance(value, list):
            kept = [item for item in value if not _has_non_finite_float(item)]
            if len(kept) != len(value):
                log.warning(
                    "dropped %d non-finite entr%s from WS frame field %r",
                    len(value) - len(kept),
                    "y" if len(value) - len(kept) == 1 else "ies",
                    key,
                )
            cleaned[key] = kept
    return cleaned


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()

    @property
    def connection_count(self) -> int:
        return len(self._connections)

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.add(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self._connections.discard(websocket)

    async def broadcast(self, message: dict) -> None:
        safe_message = _drop_non_finite_entries(message)
        stale: list[WebSocket] = []
        for connection in self._connections:
            try:
                await connection.send_json(safe_message)
            except Exception:
                stale.append(connection)
        for connection in stale:
            self._connections.discard(connection)


manager = ConnectionManager()
router = APIRouter()


@router.websocket("/ws/simulation")
async def simulation_ws(websocket: WebSocket) -> None:
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
