import os
import pytest
import traci

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


def test_stop_after_mark_failed_still_closes_the_traci_connection(runner):
    label = runner._label
    runner.mark_failed()
    runner.stop()
    # The connection must actually be closed, not just flagged internally:
    # switching to a label that traci.close() released raises TraCIException.
    with pytest.raises(traci.TraCIException):
        traci.switch(label)


def test_stop_is_idempotent(runner):
    runner.stop()
    runner.stop()  # must not raise
    assert runner.is_running is False


def test_trigger_collision_stops_vehicles_on_the_target_edge(runner):
    for _ in range(5):
        runner.step()
    result = runner.trigger_collision("AB")
    assert result.incident_edge_id == "AB"
    assert set(result.vehicle_ids).issubset({"veh0", "veh1", "veh2"})

    for _ in range(5):
        runner.step()
    states = {v.id: v for v in runner.get_vehicle_states()}
    for veh_id in result.vehicle_ids:
        assert states[veh_id].speed == 0.0


def test_trigger_collision_raises_for_edge_with_no_vehicles(runner):
    with pytest.raises(ValueError):
        runner.trigger_collision("ZZ")


def test_pick_busy_edge_raises_when_simulation_is_empty(runner):
    with pytest.raises(ValueError):
        runner.pick_busy_edge()


def test_pick_busy_edge_returns_an_edge_with_vehicles(runner):
    for _ in range(5):
        runner.step()
    edge = runner.pick_busy_edge()
    assert edge in {"AB", "BC"}
