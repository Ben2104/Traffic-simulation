import os

import pytest
import traci

from app.simulation.runner import SimulationRunner

_HERE = os.path.dirname(__file__)
NETWORK_PATH = os.path.join(_HERE, "..", "..", "..", "..", "networks", "soma", "soma.net.xml")
ROUTE_PATH = os.path.join(_HERE, "..", "..", "..", "..", "networks", "soma", "soma.rou.xml")

STEPS_TO_LET_TRAFFIC_BUILD = 120


@pytest.fixture
def runner():
    r = SimulationRunner(net_file=NETWORK_PATH, route_file=ROUTE_PATH, sumo_binary="sumo")
    r.start()
    yield r
    r.stop()


def test_subscription_results_cover_every_vehicle_in_the_simulation(runner):
    for _ in range(STEPS_TO_LET_TRAFFIC_BUILD):
        runner.step()

    states = runner.get_vehicle_states()
    traci.switch(runner.label)
    expected_ids = set(traci.vehicle.getIDList())

    assert expected_ids, "no vehicles present - background traffic may be broken"
    assert {s.id for s in states} == expected_ids, (
        "subscription results diverged from getIDList() - newly departed "
        "vehicles are probably not being subscribed in step()"
    )


def test_subscribed_values_match_the_direct_getters(runner):
    for _ in range(STEPS_TO_LET_TRAFFIC_BUILD):
        runner.step()

    states = {s.id: s for s in runner.get_vehicle_states()}
    traci.switch(runner.label)
    checked = 0
    for veh_id in traci.vehicle.getIDList():
        state = states[veh_id]
        assert state.speed == pytest.approx(traci.vehicle.getSpeed(veh_id), abs=1e-6)
        assert state.heading == pytest.approx(traci.vehicle.getAngle(veh_id), abs=1e-6)
        checked += 1
    assert checked > 0


def test_vehicles_that_leave_drop_out_of_the_results(runner):
    # Subscription results are keyed by vehicle id and SUMO drops a vehicle's
    # subscription when it arrives. A stale id here would be rendered as a
    # ghost car frozen at its last position.
    for _ in range(STEPS_TO_LET_TRAFFIC_BUILD):
        runner.step()
    traci.switch(runner.label)
    before = set(traci.vehicle.getIDList())

    for _ in range(60):
        runner.step()
    traci.switch(runner.label)
    now = set(traci.vehicle.getIDList())
    departed = before - now

    assert departed, "no vehicle completed its route - extend the step count"
    assert not departed & {s.id for s in runner.get_vehicle_states()}


def test_step_skips_a_vehicle_that_is_no_longer_known_when_subscribed(runner, monkeypatch):
    # Pins the fix for a vehicle that departs and arrives within the same
    # step: by the time step() gets around to subscribing it, SUMO no
    # longer knows it, and traci.vehicle.subscribe() raises TraCIException
    # ("... is not known"). That must be swallowed per-vehicle inside
    # step()'s loop, not escape as a SimulationError - letting it through
    # would mark_failed() the runner permanently over one vanished vehicle.
    #
    # Not reachable with today's soma.net.xml/soma.rou.xml: confirmed
    # empirically (400 steps, zero ids appearing in both
    # getDepartedIDList() and getArrivedIDList() in the same step). A real
    # same-step depart+arrive would need a regenerated route file, a
    # shorter --step-length, or a single-edge route, so this stubs the two
    # traci calls involved instead of reproducing it end-to-end.
    runner.step()  # one real step first, so there is a live connection under the label

    monkeypatch.setattr(
        traci.simulation, "getDepartedIDList", lambda: ["definitely-not-a-vehicle"]
    )

    def fake_subscribe(veh_id, variables):
        raise traci.TraCIException(
            f"Could not add subscription. Vehicle '{veh_id}' is not known."
        )

    monkeypatch.setattr(traci.vehicle, "subscribe", fake_subscribe)

    runner.step()  # must not raise despite the rejected subscription

    monkeypatch.undo()

    # The runner is still usable afterwards - the one bad id didn't taint
    # the connection or any other in-flight state.
    runner.step()
    runner.get_vehicle_states()
