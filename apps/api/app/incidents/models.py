from datetime import datetime, timezone

from pydantic import BaseModel, Field


class IncidentLocation(BaseModel):
    lat: float
    lng: float
    edge_id: str


class Incident(BaseModel):
    id: str
    kind: str
    severity: str
    location: IncidentLocation
    vehicles_involved: list[str]
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
