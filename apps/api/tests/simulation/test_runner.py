import os
import pytest

from app.simulation.runner import SimulationRunner

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")
FIXTURE_NET = os.path.join(FIXTURES_DIR, "fixture.net.xml")
FIXTURE_ROUTE = os.path.join(FIXTURES_DIR, "fixture.rou.xml")


@pytest.fixture
def runner():
    r = SimulationRunner(net_file=FIXTURE_NET, route_file=FIXTURE_ROUTE, sumo_binary="sumo")
    r.start()
    yield r
    r.stop()


def test_get_vehicle_states_is_empty_before_any_step(runner):
    assert runner.get_vehicle_states() == []


def test_vehicles_depart_and_report_positions_after_stepping(runner):
    for _ in range(5):
        runner.step()
    states = runner.get_vehicle_states()
    ids = {v.id for v in states}
    assert {"veh0", "veh1", "veh2"}.issubset(ids)
    for v in states:
        assert isinstance(v.lat, float)
        assert isinstance(v.lng, float)
