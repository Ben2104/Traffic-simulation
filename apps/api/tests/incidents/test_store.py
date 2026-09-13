from app.incidents.store import IncidentStore
from app.incidents.models import IncidentLocation


async def test_create_assigns_incrementing_ids():
    store = IncidentStore()
    location = IncidentLocation(lat=1.0, lng=2.0, edge_id="AB")
    first = await store.create(kind="collision", severity="HIGH", location=location, vehicles_involved=["veh0"])
    second = await store.create(kind="collision", severity="HIGH", location=location, vehicles_involved=["veh1"])
    assert first.id != second.id
    assert first.id.startswith("INC-")


async def test_get_returns_none_for_unknown_id():
    store = IncidentStore()
    assert await store.get("INC-9999") is None


async def test_list_returns_all_created_incidents():
    store = IncidentStore()
    location = IncidentLocation(lat=1.0, lng=2.0, edge_id="AB")
    await store.create(kind="collision", severity="HIGH", location=location, vehicles_involved=[])
    await store.create(kind="collision", severity="HIGH", location=location, vehicles_involved=[])
    assert len(await store.list()) == 2
