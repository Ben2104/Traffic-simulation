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


class TrafficLightApproach(BaseModel):
    """One signalised approach: every link a single incoming lane controls,
    positioned at that lane's stop line.

    `link_indices` are offsets into the TLS state string, which the frontend
    uses to resolve this approach's colour from the per-tick state map.
    """

    tls_id: str
    lane_id: str
    link_indices: list[int]
    lat: float
    lng: float
    heading: float
