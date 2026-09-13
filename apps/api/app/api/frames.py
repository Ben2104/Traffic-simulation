from ..simulation.models import VehicleState
from ..incidents.models import Incident


def vehicle_frame(tick: int, vehicles: list[VehicleState]) -> dict:
    return {
        "type": "simulation.vehicles",
        "tick": tick,
        "vehicles": [v.model_dump() for v in vehicles],
    }


def incident_created_frame(incident: Incident) -> dict:
    return {"type": "incident.created", "incident": incident.model_dump(mode="json")}


def error_frame(message: str) -> dict:
    return {"type": "simulation.error", "message": message}
