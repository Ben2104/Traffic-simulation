from pydantic import BaseModel


class VehicleState(BaseModel):
    id: str
    lat: float
    lng: float
    heading: float
    speed: float
    kind: str = "civilian"


class CollisionResult(BaseModel):
    incident_edge_id: str
    vehicle_ids: list[str]
    lat: float
    lng: float
