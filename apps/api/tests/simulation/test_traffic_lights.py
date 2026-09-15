import os

import pytest

from app.simulation.runner import SimulationRunner
from app.simulation.traffic_lights import (
    group_links_by_incoming_lane,
    stop_line_heading,
)

_HERE = os.path.dirname(__file__)
NETWORK_PATH = os.path.join(_HERE, "..", "..", "..", "..", "networks", "soma", "soma.net.xml")
ROUTE_PATH = os.path.join(_HERE, "..", "..", "..", "..", "networks", "soma", "soma.rou.xml")

# Measured from the committed soma.net.xml: 51 <tlLogic> programs across 112
# junctions of type="traffic_light". The threshold is deliberately loose so
# the test survives a network regeneration, while still failing if signal
# extraction returns nothing.
MIN_EXPECTED_APPROACHES = 100

SOMA_LAT_MIN, SOMA_LAT_MAX = 37.76, 37.80
SOMA_LNG_MIN, SOMA_LNG_MAX = -122.42, -122.385


def test_group_links_by_incoming_lane_maps_state_indices_to_their_lane():
    # traci's getControlledLinks() returns a list whose index matches the
    # position of that link's character in the TLS state string. Each entry is
    # a list of (incoming_lane, outgoing_lane, via_lane) tuples.
    controlled_links = [
        [("north_0", "south_0", ":j_0_0")],   # index 0
        [("north_0", "east_0", ":j_0_1")],    # index 1 - same incoming lane
        [("east_0", "west_0", ":j_0_2")],     # index 2
    ]
    assert group_links_by_incoming_lane(controlled_links) == {
        "north_0": [0, 1],
        "east_0": [2],
    }


def test_group_links_by_incoming_lane_handles_an_index_with_no_links():
    # SUMO emits empty link entries for state characters that control nothing.
    assert group_links_by_incoming_lane([[], [("a_0", "b_0", "")]]) == {"a_0": [1]}


def test_group_links_by_incoming_lane_handles_multiple_links_at_one_index():
    controlled_links = [[("a_0", "b_0", ""), ("c_0", "d_0", "")]]
    assert group_links_by_incoming_lane(controlled_links) == {"a_0": [0], "c_0": [0]}


@pytest.mark.parametrize(
    "shape,expected",
    [
        ([(0.0, 0.0), (0.0, 10.0)], 0.0),     # heading north
        ([(0.0, 0.0), (10.0, 0.0)], 90.0),    # heading east
        ([(0.0, 0.0), (0.0, -10.0)], 180.0),  # heading south
        ([(0.0, 0.0), (-10.0, 0.0)], 270.0),  # heading west
    ],
)
def test_stop_line_heading_is_compass_bearing_from_the_final_segment(shape, expected):
    # SUMO's cartesian frame is x=east, y=north, and the rendered marker must
    # face the way traffic approaches, so this returns degrees CLOCKWISE from
    # north -- the same convention as traci.vehicle.getAngle().
    assert stop_line_heading(shape) == pytest.approx(expected)


def test_stop_line_heading_uses_only_the_last_two_points():
    curved = [(0.0, 0.0), (5.0, 5.0), (10.0, 0.0), (10.0, 10.0)]
    assert stop_line_heading(curved) == pytest.approx(0.0)


@pytest.fixture
def runner():
    r = SimulationRunner(net_file=NETWORK_PATH, route_file=ROUTE_PATH, sumo_binary="sumo")
    r.start()
    yield r
    r.stop()


def test_runner_extracts_real_approaches_from_the_soma_network(runner):
    approaches = runner.get_traffic_light_approaches()
    assert len(approaches) >= MIN_EXPECTED_APPROACHES
    for approach in approaches:
        assert approach.tls_id
        assert approach.lane_id
        assert approach.link_indices
        assert SOMA_LAT_MIN <= approach.lat <= SOMA_LAT_MAX
        assert SOMA_LNG_MIN <= approach.lng <= SOMA_LNG_MAX
        assert 0.0 <= approach.heading < 360.0


def test_runner_caches_approaches_so_geometry_is_computed_once(runner):
    first = runner.get_traffic_light_approaches()
    second = runner.get_traffic_light_approaches()
    assert first is second


def test_every_approach_has_a_unique_tls_and_lane_pair(runner):
    approaches = runner.get_traffic_light_approaches()
    keys = [(a.tls_id, a.lane_id) for a in approaches]
    assert len(keys) == len(set(keys)), "a lane was emitted twice for one TLS"
