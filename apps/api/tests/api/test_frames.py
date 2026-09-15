from app.api.frames import vehicle_frame, incident_created_frame, error_frame
from app.simulation.models import VehicleState
from app.incidents.models import Incident, IncidentLocation


def test_vehicle_frame_shape():
    vehicles = [VehicleState(id="car-1", lat=37.7, lng=-122.4, heading=90.0, speed=5.0)]
    frame = vehicle_frame(tick=3, vehicles=vehicles)
    assert frame == {
        "type": "simulation.vehicles",
        "tick": 3,
        "vehicles": [
            {"id": "car-1", "lat": 37.7, "lng": -122.4, "heading": 90.0, "speed": 5.0, "kind": "civilian"}
        ],
    }


def test_incident_created_frame_shape():
    incident = Incident(
        id="INC-1042",
        kind="collision",
        severity="HIGH",
        location=IncidentLocation(lat=37.7, lng=-122.4, edge_id="AB"),
        vehicles_involved=["veh0", "veh1"],
    )
    frame = incident_created_frame(incident)
    assert frame["type"] == "incident.created"
    assert frame["incident"]["id"] == "INC-1042"
    assert frame["incident"]["vehicles_involved"] == ["veh0", "veh1"]


def test_error_frame_shape():
    assert error_frame("boom") == {"type": "simulation.error", "message": "boom"}


def test_vehicle_frame_carries_signals_when_supplied():
    vehicles = [VehicleState(id="car-1", lat=37.7, lng=-122.4, heading=90.0, speed=5.0)]
    frame = vehicle_frame(tick=3, vehicles=vehicles, signals={"tls-1": "rrGG"})
    assert frame["signals"] == {"tls-1": "rrGG"}


def test_vehicle_frame_omits_the_signals_key_entirely_when_none():
    # Absent, not null. The frontend retains its previous signal state when
    # the key is missing; an explicit null would have to be special-cased to
    # avoid blanking ~800 markers to grey for one frame.
    frame = vehicle_frame(tick=3, vehicles=[], signals=None)
    assert "signals" not in frame
