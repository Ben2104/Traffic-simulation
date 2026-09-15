import os

import pytest
import traci
from pyproj import Geod

from app.simulation.geo import NetworkProjection
from app.simulation.runner import SimulationRunner

# tests/simulation is four levels below the repo root.
_HERE = os.path.dirname(__file__)
NETWORK_PATH = os.path.join(_HERE, "..", "..", "..", "..", "networks", "soma", "soma.net.xml")
ROUTE_PATH = os.path.join(_HERE, "..", "..", "..", "..", "networks", "soma", "soma.rou.xml")

STEPS_TO_LET_TRAFFIC_BUILD = 50
GEOD = Geod(ellps="WGS84")


@pytest.fixture
def runner():
    r = SimulationRunner(net_file=NETWORK_PATH, route_file=ROUTE_PATH, sumo_binary="sumo")
    r.start()
    yield r
    r.stop()


def test_projection_reads_the_nets_location_element():
    projection = NetworkProjection.from_net_file(NETWORK_PATH)
    assert projection.net_offset == (-551766.43, -4180641.21)
    assert "+proj=utm" in projection.proj_parameter
    assert "+zone=10" in projection.proj_parameter


def test_projection_matches_convert_geo_within_ten_centimetres(runner):
    # This is the only test proving the performance rewrite did not silently
    # move every vehicle. traci.simulation.convertGeo is the reference
    # implementation being replaced; pyproj must agree with it on real
    # vehicle positions from the real network, not on synthetic points.
    projection = NetworkProjection.from_net_file(NETWORK_PATH)
    for _ in range(STEPS_TO_LET_TRAFFIC_BUILD):
        runner.step()

    traci.switch(runner.label)
    checked = 0
    for veh_id in traci.vehicle.getIDList():
        x, y = traci.vehicle.getPosition(veh_id)
        want_lon, want_lat = traci.simulation.convertGeo(x, y)
        got_lon, got_lat = projection.to_lon_lat(x, y)
        _, _, distance_m = GEOD.inv(want_lon, want_lat, got_lon, got_lat)
        assert distance_m < 0.1, (
            f"vehicle {veh_id}: pyproj disagrees with convertGeo by {distance_m:.3f} m"
        )
        checked += 1

    assert checked > 0, "no vehicles present - cannot verify the projection"


def test_projection_does_not_swap_lat_and_lng(runner):
    # Guards the always_xy=True contract specifically. Without it pyproj
    # returns (lat, lon) for EPSG:4326 and every coordinate silently swaps:
    # SoMa longitudes (~-122) would appear as latitudes, which is not a valid
    # latitude at all, and the failure would look like "vehicles in the ocean"
    # rather than an obvious crash.
    projection = NetworkProjection.from_net_file(NETWORK_PATH)
    runner.step()
    lon, lat = projection.to_lon_lat(1000.0, 1000.0)
    assert -122.42 < lon < -122.38, f"expected a SoMa longitude, got {lon}"
    assert 37.76 < lat < 37.80, f"expected a SoMa latitude, got {lat}"
