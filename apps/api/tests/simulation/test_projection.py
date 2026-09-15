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

# fixture.net.xml has projParameter="!" and netOffset="0.00,0.00" -- SUMO's
# sentinel for a network with no real georeference (small synthetic test
# networks generated without netconvert's --proj.* options). No SUMO process
# is needed for these tests; they exercise NetworkProjection directly.
FIXTURE_NET = os.path.join(_HERE, "fixtures", "fixture.net.xml")

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


def test_projection_reads_the_unprojected_fixtures_location_element():
    # "!" is SUMO's sentinel for "this network has no real georeference."
    # Pins that from_net_file parses it through unchanged rather than
    # rejecting it or substituting something else.
    projection = NetworkProjection.from_net_file(FIXTURE_NET)
    assert projection.proj_parameter == "!"
    assert projection.net_offset == (0.0, 0.0)


def test_projection_is_identity_for_the_unprojected_fixture_network():
    # convertGeo is an identity transform on unprojected ("!") networks --
    # confirmed empirically against live SUMO. This pins parity with that
    # passthrough behaviour so a regression to a crash or wrong numbers
    # doesn't slip past the other fixture-network tests, which only assert
    # isinstance(v.lat, float).
    projection = NetworkProjection.from_net_file(FIXTURE_NET)
    lon, lat = projection.to_lon_lat(58.4865851258859, -1.6)
    assert (lon, lat) == (58.4865851258859, -1.6)


def test_projection_applies_net_offset_on_the_unprojected_path():
    # Pins that netOffset subtraction happens on the "!" path exactly as it
    # does on the projected path, even though fixture.net.xml itself only
    # exercises a zero offset.
    projection = NetworkProjection("!", (100.0, 200.0))
    assert projection.to_lon_lat(150.0, 250.0) == (50.0, 50.0)
