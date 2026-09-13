import os
import xml.etree.ElementTree as ET

import pytest

from app.simulation.runner import SimulationRunner

# NOTE: apps/api/tests is three levels below the repo root
# (tests -> api -> apps -> root), so three ".." are needed here.
NETWORK_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "networks", "soma", "soma.net.xml"
)
ROUTE_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "networks", "soma", "soma.rou.xml"
)

# Bounding box of the SoMa OSM extract used to build the network
# (roughly 4th/5th/6th St x Market/Howard/Folsom/Harrison).
SOMA_LAT_MIN, SOMA_LAT_MAX = 37.77, 37.79
SOMA_LNG_MIN, SOMA_LNG_MAX = -122.41, -122.39

# The route file is generated with `randomTrips.py --seed 42 --period 3`.
# Observed vehicle counts after stepping the real network are deterministic
# across runs: ~20 vehicles at t=60s, ~60 vehicles at t=200s. 200 steps gives
# traffic time to build up without needlessly slowing the test suite.
STEPS_TO_LET_TRAFFIC_BUILD = 200

# Threshold set well below the ~60 vehicles actually observed at t=200s with
# the fixed seed, so the test tolerates minor SUMO-version/platform variance
# in exact vehicle counts while still failing if background traffic
# generation is broken (e.g. an empty or near-empty route file).
MIN_EXPECTED_VEHICLES = 30


def test_soma_network_file_exists_and_has_expected_road_edges():
    assert os.path.exists(NETWORK_PATH), (
        "soma.net.xml not found - run the netconvert step in Task 10 before this test"
    )
    tree = ET.parse(NETWORK_PATH)
    edges = [
        e for e in tree.getroot().findall("edge")
        if e.get("function") != "internal"
    ]
    assert len(edges) > 20


@pytest.fixture
def runner():
    r = SimulationRunner(
        net_file=NETWORK_PATH, route_file=ROUTE_PATH, sumo_binary="sumo"
    )
    r.start()
    yield r
    r.stop()


def test_vehicle_positions_convert_to_real_soma_wgs84_coordinates(runner):
    # Guards against building the network without a projection: without one,
    # traci.simulation.convertGeo passes raw cartesian x,y straight through
    # instead of returning WGS84 lat/lng, so vehicles would report positions
    # wildly outside San Francisco (or in the ocean) on the live map.
    for _ in range(STEPS_TO_LET_TRAFFIC_BUILD):
        runner.step()

    states = runner.get_vehicle_states()
    assert states, "no vehicles present after stepping - background traffic generation may be broken"

    for v in states:
        assert SOMA_LAT_MIN <= v.lat <= SOMA_LAT_MAX, (
            f"vehicle {v.id} lat={v.lat} is outside the SoMa bbox "
            f"({SOMA_LAT_MIN}-{SOMA_LAT_MAX}) - network likely lacks a proper "
            "geo-referencing projection (e.g. --proj.utm)"
        )
        assert SOMA_LNG_MIN <= v.lng <= SOMA_LNG_MAX, (
            f"vehicle {v.id} lng={v.lng} is outside the SoMa bbox "
            f"({SOMA_LNG_MIN}-{SOMA_LNG_MAX}) - network likely lacks a proper "
            "geo-referencing projection (e.g. --proj.utm)"
        )


def test_background_traffic_produces_a_meaningful_vehicle_volume(runner):
    for _ in range(STEPS_TO_LET_TRAFFIC_BUILD):
        runner.step()

    states = runner.get_vehicle_states()
    assert len(states) >= MIN_EXPECTED_VEHICLES, (
        f"expected at least {MIN_EXPECTED_VEHICLES} vehicles in the network "
        f"after {STEPS_TO_LET_TRAFFIC_BUILD} steps, got {len(states)} - "
        "background traffic (soma.rou.xml) may not be flowing"
    )
