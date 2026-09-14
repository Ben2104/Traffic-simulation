import asyncio
from itertools import count

from .models import Incident, IncidentLocation


class IncidentStore:
    def __init__(self) -> None:
        self._incidents: dict[str, Incident] = {}
        self._lock = asyncio.Lock()
        self._counter = count(1)

    def _next_id(self) -> str:
        return f"INC-{1000 + next(self._counter)}"

    async def create(
        self,
        kind: str,
        severity: str,
        location: IncidentLocation,
        vehicles_involved: list[str],
    ) -> Incident:
        async with self._lock:
            incident = Incident(
                id=self._next_id(),
                kind=kind,
                severity=severity,
                location=location,
                vehicles_involved=vehicles_involved,
            )
            self._incidents[incident.id] = incident
            return incident

    async def get(self, incident_id: str) -> Incident | None:
        async with self._lock:
            return self._incidents.get(incident_id)

    async def list(self) -> list[Incident]:
        async with self._lock:
            return list(self._incidents.values())
