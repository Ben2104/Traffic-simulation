from ..simulation.models import VehicleState
from ..incidents.models import Incident


def vehicle_frame(
    tick: int,
    vehicles: list[VehicleState],
    signals: dict[str, str] | None = None,
) -> dict:
    frame = {
        "type": "simulation.vehicles",
        "tick": tick,
        "vehicles": [v.model_dump() for v in vehicles],
    }
    # Omitted rather than set to None: the frontend treats a missing key as
    # "keep what you had", which is what a transient signal-read failure
    # should look like.
    if signals is not None:
        frame["signals"] = signals
    return frame


def incident_created_frame(incident: Incident) -> dict:
    return {"type": "incident.created", "incident": incident.model_dump(mode="json")}


def error_frame(message: str) -> dict:
    return {"type": "simulation.error", "message": message}
