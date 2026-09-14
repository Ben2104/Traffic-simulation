from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from ..incidents.models import IncidentLocation
from ..incidents.store import IncidentStore
from ..simulation.runner import SimulationRunner
from .deps import get_runner, get_store
from .ws import manager
from .frames import incident_created_frame

router = APIRouter()


class TriggerCollisionRequest(BaseModel):
    edge_id: str | None = None


@router.post("/demo/trigger-collision")
async def trigger_collision(
    # Defaulted so the request body is genuinely optional: the spec says the
    # server picks a busy edge when `edge_id` is omitted, and `curl -X POST
    # .../demo/trigger-collision` with no body at all must work (without a
    # default FastAPI rejects it with 422).
    body: TriggerCollisionRequest = TriggerCollisionRequest(),
    runner: SimulationRunner = Depends(get_runner),
    store: IncidentStore = Depends(get_store),
):
    try:
        edge_id = body.edge_id or runner.pick_busy_edge()
        result = runner.trigger_collision(edge_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    incident = await store.create(
        kind="collision",
        severity="HIGH",
        location=IncidentLocation(lat=result.lat, lng=result.lng, edge_id=result.incident_edge_id),
        vehicles_involved=result.vehicle_ids,
    )
    await manager.broadcast(incident_created_frame(incident))
    return {"incident_id": incident.id}


@router.get("/incidents")
async def list_incidents(store: IncidentStore = Depends(get_store)):
    return await store.list()


@router.get("/incidents/{incident_id}")
async def get_incident(incident_id: str, store: IncidentStore = Depends(get_store)):
    incident = await store.get(incident_id)
    if incident is None:
        raise HTTPException(status_code=404, detail="incident not found")
    return incident
