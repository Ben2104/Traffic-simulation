import os
import signal
import subprocess
import time

import pytest
import traci

from app.simulation.errors import SimulationError
from app.simulation.runner import SimulationRunner

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")
FIXTURE_NET = os.path.join(FIXTURES_DIR, "fixture.net.xml")
FIXTURE_ROUTE = os.path.join(FIXTURES_DIR, "fixture.rou.xml")


def _kill_sumo_server(runner: SimulationRunner) -> None:
    """SIGKILL the SUMO server behind `runner`'s TraCI connection.

    The pip-installed `sumo` entry point is a small Python wrapper that execs
    the real SUMO binary as a *child*, so killing only the process traci
    spawned leaves the actual server running and the socket healthy. Kill the
    whole tree: descendants first, then the process traci owns.
    """
    process = traci.connection.get(runner._label)._process

    def descendants(pid: int) -> list[int]:
        found = subprocess.run(
            ["pgrep", "-P", str(pid)], capture_output=True, text=True
        ).stdout.split()
        out: list[int] = []
        for child in found:
            out.extend(descendants(int(child)))
            out.append(int(child))
        return out

    for pid in descendants(process.pid):
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.kill()
    process.wait()


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


def test_step_raises_simulation_error_after_connection_is_closed(runner):
    # After stop() closes the underlying TraCI connection, switching to the
    # released label raises traci.TraCIException (see
    # test_stop_after_mark_failed_still_closes_the_traci_connection above).
    # step() must translate that into SimulationError at the boundary rather
    # than letting the raw TraCIException escape.
    runner.stop()
    with pytest.raises(SimulationError):
        runner.step()


def test_step_raises_simulation_error_when_the_sumo_process_dies(runner):
    # The real-world failure this guards: SUMO crashes/is killed mid-run and
    # traci raises FatalTraCIError("Connection closed by SUMO."), which is a
    # *sibling* of TraCIException, not a subclass. If step() only catches
    # TraCIException the fatal error escapes SimulationError entirely and
    # kills the tick loop. No mocking: the actual subprocess is SIGKILLed.
    for _ in range(3):
        runner.step()

    _kill_sumo_server(runner)

    with pytest.raises(SimulationError):
        # Stepping repeatedly rather than once removes any dependency on how
        # fast the OS tears the socket down; if the translation is missing,
        # the raw FatalTraCIError escapes and fails this test instead.
        for _ in range(20):
            runner.step()
            time.sleep(0.05)


def test_get_vehicle_states_raises_simulation_error_when_the_sumo_process_dies(runner):
    for _ in range(3):
        runner.step()

    _kill_sumo_server(runner)

    with pytest.raises(SimulationError):
        for _ in range(20):
            runner.get_vehicle_states()
            time.sleep(0.05)


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


def test_trigger_collision_excludes_a_vehicle_too_close_to_the_lane_end(runner):
    for _ in range(5):
        runner.step()
    # veh0 is fast-moving; teleport it to just short of AB's 200m end so its
    # braking distance (~18.8m at its current speed) no longer fits on the
    # lane. veh1/veh2 stay at their normal mid-lane positions and remain
    # stoppable. This reproduces the "too close to brake" boundary without
    # letting the exception escape trigger_collision.
    traci.switch(runner._label)
    traci.vehicle.moveTo("veh0", "AB_0", 191.0)

    result = runner.trigger_collision("AB")

    assert result.incident_edge_id == "AB"
    assert "veh0" not in result.vehicle_ids
    assert set(result.vehicle_ids).issubset({"veh1", "veh2"})


def test_trigger_collision_raises_value_error_when_no_vehicle_can_be_stopped(runner):
    for _ in range(5):
        runner.step()
    # Teleport every vehicle on AB to just short of its 200m end. At their
    # current speeds none of them can brake to a stop before the lane ends,
    # so trigger_collision must raise ValueError (not let the underlying
    # TraCIException escape).
    traci.switch(runner._label)
    for veh_id in ("veh0", "veh1", "veh2"):
        traci.vehicle.moveTo(veh_id, "AB_0", 191.0)

    with pytest.raises(ValueError):
        runner.trigger_collision("AB")
