# 3D Map, Car Sprites, and Traffic Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat top-down map of identical cyan dots with a 45°-pitched 3D view showing per-vehicle car sprites and live traffic-signal state driven by the network's existing SUMO signal programs.

**Architecture:** Traffic-light data splits by lifetime — static approach geometry is computed once at startup and served from `GET /traffic-lights`; dynamic phase state rides inside the existing `simulation.vehicles` WebSocket frame so it stays atomically in sync with vehicle positions. The per-tick TraCI cost is cut first (subscriptions + in-process pyproj reprojection) because this slice raises the budget on a loop already doing ~3,200 socket round-trips per second. On the frontend, all Mapbox style manipulation is reduced to a pure reducer emitting a declarative instruction list, so the logic is unit-testable and `MapView` is a thin interpreter.

**Tech Stack:** FastAPI, SUMO/TraCI 1.27.1, pyproj 3.8.0, pytest — Next.js 16, React 19, deck.gl 9.4.0, mapbox-gl 3.30.0, zustand, vitest + jsdom + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-14-3d-map-sprites-signals-design.md`

## Global Constraints

- Branch: `feat/3d-map-sprites-signals`. Already created; do not branch again.
- `pyproj.Transformer.from_crs(..., always_xy=True)` is **mandatory**. pyproj 2+ honors CRS axis order, so EPSG:4326 returns `(lat, lon)` without it — a silent coordinate swap.
- **Signals are cosmetic and must never stop traffic.** No signal read may reach the handler in `loop.py` that calls `runner.mark_failed()`.
- Camera defaults: `pitch: 45`, `bearing: -17`, `zoom: 16.5`.
- Basemaps: `mapbox://styles/mapbox/standard` (default) and `mapbox://styles/mapbox/satellite-streets-v12`. Default `lightPreset` is `day`.
- deck.gl `getAngle` is counter-clockwise degrees; SUMO `getAngle()` is clockwise from north. Always `-heading`.
- Icon sizing: `sizeUnits: 'meters'`, `sizeMinPixels: 14`, `billboard: false`.
- Civilian palette excludes red and red/white/blue — reserved for slice E emergency liveries.
- Vehicle sprite selection keys off `VehicleState.kind`.
- Backend tests: `cd apps/api && .venv/bin/pytest`. Frontend tests: `cd apps/web && npm test`.
- Never commit the emergency-vehicle images. The ambulance is a watermarked Pixta comp (id 58052445); police provenance is unconfirmed. Slice E, not this one.

**Spec refinement (deliberate):** the spec says civilian sprites are "authored SVG, rasterized to an atlas." Loading SVG into a canvas requires an async `Image` round-trip, which would force the layer builder to be async. This plan draws the three civilian bodies with **synchronous Canvas 2D path commands** instead. Same outcome — an in-repo authored atlas with no licensing question — without the async. Raster emergency liveries in slice E still load as images.

---

### Task 1: In-process reprojection (replace `convertGeo`)

**Files:**
- Create: `apps/api/app/simulation/geo.py`
- Modify: `apps/api/app/simulation/runner.py`
- Test: `apps/api/tests/simulation/test_projection.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `NetworkProjection` with classmethod `from_net_file(net_file: str) -> NetworkProjection` and method `to_lon_lat(x: float, y: float) -> tuple[float, float]` (returns **lon, lat** in that order). `SimulationRunner.label -> str` property. `SimulationRunner._projection: NetworkProjection` set during `start()`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/simulation/test_projection.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && .venv/bin/pytest tests/simulation/test_projection.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.simulation.geo'`

- [ ] **Step 3: Write `apps/api/app/simulation/geo.py`**

```python
import xml.etree.ElementTree as ET

from pyproj import Transformer


class NetworkProjection:
    """Converts SUMO network coordinates to WGS84 in-process.

    Replaces traci.simulation.convertGeo, which costs one socket round-trip
    per vehicle per tick. The transform is exact: it uses the same
    projParameter netconvert recorded in the network file.
    """

    def __init__(self, proj_parameter: str, net_offset: tuple[float, float]) -> None:
        self.proj_parameter = proj_parameter
        self.net_offset = net_offset
        self._offset_x, self._offset_y = net_offset
        # always_xy=True is MANDATORY. pyproj 2+ honours CRS axis order, so
        # EPSG:4326 yields (lat, lon) without it -- a silent coordinate swap
        # that puts every vehicle in the Indian Ocean.
        self._transformer = Transformer.from_crs(
            proj_parameter, "EPSG:4326", always_xy=True
        )

    @classmethod
    def from_net_file(cls, net_file: str) -> "NetworkProjection":
        # soma.net.xml is 5.5 MB. <location> is the first element after the
        # root, so iterparse and bail out before the edge list is walked.
        for _event, elem in ET.iterparse(net_file, events=("start",)):
            if elem.tag == "location":
                offset_x, offset_y = (float(v) for v in elem.get("netOffset").split(","))
                return cls(elem.get("projParameter"), (offset_x, offset_y))
            if elem.tag == "edge":
                break
        raise ValueError(f"no <location> element found in {net_file!r}")

    def to_lon_lat(self, x: float, y: float) -> tuple[float, float]:
        """SUMO (x, y) -> (lon, lat).

        netOffset is the offset netconvert ADDED to the original projected
        coordinates, so the original is recovered by subtracting it.
        """
        return self._transformer.transform(x - self._offset_x, y - self._offset_y)
```

- [ ] **Step 4: Wire the projection into the runner**

In `apps/api/app/simulation/runner.py`, add the import at the top:

```python
from .geo import NetworkProjection
```

In `__init__`, after `self._started = False`, add:

```python
        self._projection: NetworkProjection | None = None
```

Add this property directly after the existing `is_running` property:

```python
    @property
    def label(self) -> str:
        """The TraCI connection label. Exposed so tests can traci.switch() to
        this runner's connection and compare against reference TraCI calls."""
        return self._label
```

In `start()`, after `self._running = True`, add:

```python
        self._projection = NetworkProjection.from_net_file(self.net_file)
```

In `get_vehicle_states()`, replace the line `lon, lat = traci.simulation.convertGeo(x, y)` with:

```python
                lon, lat = self._projection.to_lon_lat(x, y)
```

In `trigger_collision()`, replace `lon, lat = traci.simulation.convertGeo(x, y)` with the same call.

- [ ] **Step 5: Run the new tests**

Run: `cd apps/api && .venv/bin/pytest tests/simulation/test_projection.py -v`
Expected: PASS (3 tests)

- [ ] **Step 6: Run the full backend suite for regressions**

Run: `cd apps/api && .venv/bin/pytest -q`
Expected: PASS. `tests/test_soma_network.py` is the important one — it asserts vehicle coordinates land inside the SoMa bbox, so it fails loudly if the reprojection is wrong.

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/simulation/geo.py apps/api/app/simulation/runner.py apps/api/tests/simulation/test_projection.py
git commit -m "perf(api): reproject vehicle positions in-process with pyproj

Replaces traci.simulation.convertGeo, which cost one socket round-trip per
vehicle per tick. Verified against convertGeo on real network positions to
within 0.1 m."
```

---

### Task 2: TraCI subscriptions for vehicle state

**Files:**
- Modify: `apps/api/app/simulation/runner.py`
- Test: `apps/api/tests/simulation/test_subscriptions.py`

**Interfaces:**
- Consumes: `SimulationRunner.label`, `SimulationRunner._projection` (Task 1).
- Produces: `SimulationRunner.step()` subscribes newly departed vehicles; `get_vehicle_states()` reads `traci.vehicle.getAllSubscriptionResults()` instead of per-vehicle getters. Return type is unchanged: `list[VehicleState]`.

- [ ] **Step 1: Write characterization tests**

This task is a refactor, not new behavior: `get_vehicle_states()` already
returns the right answer, just expensively. So these are **characterization
tests** — they pin the current observable behavior, pass before the change,
and must still pass after it. That is the point; do not try to make them fail
first.

Create `apps/api/tests/simulation/test_subscriptions.py`:

```python
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
```

- [ ] **Step 2: Run them against the CURRENT implementation**

Run: `cd apps/api && .venv/bin/pytest tests/simulation/test_subscriptions.py -v`
Expected: **PASS (3 tests)** — against the per-vehicle-getter implementation.
This baseline is what gives the tests their value: they are only evidence the
refactor preserved behavior if they passed before it. If any fails here, stop
and report — the characterization is wrong and must be fixed before touching
`runner.py`.

- [ ] **Step 3: Add subscriptions to `runner.py`**

Add to the imports at the top of `apps/api/app/simulation/runner.py`:

```python
import traci.constants as tc
```

Add near the other module-level names:

```python
# Subscribed once per vehicle, then read in a single getAllSubscriptionResults()
# call per tick. The previous implementation issued four TraCI round-trips per
# vehicle per tick (getPosition, convertGeo, getAngle, getSpeed); at 200
# vehicles on a 0.25 s tick that was roughly 3,200 round-trips per second.
_VEHICLE_SUBSCRIPTIONS = (tc.VAR_POSITION, tc.VAR_ANGLE, tc.VAR_SPEED)
```

Replace the body of `step()` with:

```python
    def step(self) -> None:
        try:
            traci.switch(self._label)
            traci.simulationStep()
            # Subscribe vehicles as they enter. One round-trip per tick for the
            # departed list, instead of one per vehicle per tick forever after.
            for veh_id in traci.simulation.getDepartedIDList():
                traci.vehicle.subscribe(veh_id, _VEHICLE_SUBSCRIPTIONS)
        # FatalTraCIError is a *sibling* of TraCIException (both subclass
        # Exception directly), not a subclass, so catching TraCIException
        # alone lets "Connection closed by SUMO." escape every downstream
        # error boundary. Both must be listed explicitly.
        except (traci.TraCIException, traci.FatalTraCIError) as exc:
            raise SimulationError(str(exc)) from exc
```

Replace the body of `get_vehicle_states()` with:

```python
    def get_vehicle_states(self) -> list[VehicleState]:
        try:
            traci.switch(self._label)
            states = []
            for veh_id, values in traci.vehicle.getAllSubscriptionResults().items():
                # A vehicle can be present in the result map with an incomplete
                # value set if it departed between the subscribe and the read.
                # Skip it rather than raising a KeyError that would escape
                # every SimulationError boundary as a programming error.
                if tc.VAR_POSITION not in values:
                    continue
                x, y = values[tc.VAR_POSITION]
                lon, lat = self._projection.to_lon_lat(x, y)
                states.append(
                    VehicleState(
                        id=veh_id,
                        lat=lat,
                        lng=lon,
                        heading=values[tc.VAR_ANGLE],
                        speed=values[tc.VAR_SPEED],
                    )
                )
            return states
        # See step(): FatalTraCIError is not a subclass of TraCIException.
        except (traci.TraCIException, traci.FatalTraCIError) as exc:
            raise SimulationError(str(exc)) from exc
```

- [ ] **Step 4: Run the new tests**

Run: `cd apps/api && .venv/bin/pytest tests/simulation/test_subscriptions.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full backend suite**

Run: `cd apps/api && .venv/bin/pytest -q`
Expected: PASS. `tests/test_soma_network.py::test_background_traffic_produces_a_meaningful_vehicle_volume` is the key regression — it fails if subscriptions miss vehicles.

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/simulation/runner.py apps/api/tests/simulation/test_subscriptions.py
git commit -m "perf(api): read vehicle state via TraCI subscriptions

Collapses four round-trips per vehicle per tick into a single
getAllSubscriptionResults() call. Vehicles are subscribed as they appear in
getDepartedIDList(); SUMO drops the subscription when they arrive."
```

---

### Task 3: Traffic-light approach geometry

**Files:**
- Create: `apps/api/app/simulation/traffic_lights.py`
- Modify: `apps/api/app/simulation/models.py`, `apps/api/app/simulation/runner.py`
- Test: `apps/api/tests/simulation/test_traffic_lights.py`

**Interfaces:**
- Consumes: `NetworkProjection.to_lon_lat` (Task 1), `SimulationRunner.label`.
- Produces: `TrafficLightApproach` pydantic model with fields `tls_id: str`, `lane_id: str`, `link_indices: list[int]`, `lat: float`, `lng: float`, `heading: float`. Pure functions `group_links_by_incoming_lane(controlled_links) -> dict[str, list[int]]` and `stop_line_heading(shape) -> float`. `SimulationRunner.get_traffic_light_approaches() -> list[TrafficLightApproach]` (cached after first call).

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/simulation/test_traffic_lights.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && .venv/bin/pytest tests/simulation/test_traffic_lights.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.simulation.traffic_lights'`

- [ ] **Step 3: Write `apps/api/app/simulation/traffic_lights.py`**

```python
import math


def group_links_by_incoming_lane(controlled_links) -> dict[str, list[int]]:
    """Map each incoming lane to the state-string indices that control it.

    `controlled_links` is traci.trafficlight.getControlledLinks() output: a
    list whose index matches the position of that link's character in the TLS
    state string, each entry being a list of
    (incoming_lane, outgoing_lane, via_lane) tuples.

    Grouping by incoming lane is what turns a 40-character state string into
    the handful of markers an operator can actually read: one per approach,
    answering "can traffic coming this way go?"
    """
    groups: dict[str, list[int]] = {}
    for index, links in enumerate(controlled_links):
        for incoming_lane, _outgoing_lane, _via_lane in links:
            indices = groups.setdefault(incoming_lane, [])
            if index not in indices:
                indices.append(index)
    return groups


def stop_line_heading(shape) -> float:
    """Compass bearing of a lane's final segment, in degrees clockwise from
    north -- the same convention traci.vehicle.getAngle() uses.

    SUMO's cartesian frame is x=east, y=north, so the arguments to atan2 are
    (dx, dy) rather than the (dy, dx) of a standard mathematical angle.
    """
    (x1, y1), (x2, y2) = shape[-2], shape[-1]
    return math.degrees(math.atan2(x2 - x1, y2 - y1)) % 360.0
```

- [ ] **Step 4: Add the model**

Append to `apps/api/app/simulation/models.py`:

```python
class TrafficLightApproach(BaseModel):
    """One signalised approach: every link a single incoming lane controls,
    positioned at that lane's stop line.

    `link_indices` are offsets into the TLS state string, which the frontend
    uses to resolve this approach's colour from the per-tick state map.
    """

    tls_id: str
    lane_id: str
    link_indices: list[int]
    lat: float
    lng: float
    heading: float
```

- [ ] **Step 5: Add the runner method**

In `apps/api/app/simulation/runner.py`, extend the model import:

```python
from .models import VehicleState, CollisionResult, TrafficLightApproach
```

Add:

```python
from .traffic_lights import group_links_by_incoming_lane, stop_line_heading
```

In `__init__`, after `self._projection = None`, add:

```python
        self._approaches: list[TrafficLightApproach] | None = None
```

Add this method after `get_vehicle_states()`:

```python
    def get_traffic_light_approaches(self) -> list[TrafficLightApproach]:
        """Signal geometry for every controlled approach in the network.

        Static for the life of the simulation, so it is computed once and
        cached: 51 tlLogic programs mean ~500 lane-shape lookups, which is far
        too many round-trips to repeat per tick.
        """
        if self._approaches is not None:
            return self._approaches

        traci.switch(self._label)
        approaches: list[TrafficLightApproach] = []
        for tls_id in traci.trafficlight.getIDList():
            controlled_links = traci.trafficlight.getControlledLinks(tls_id)
            for lane_id, indices in group_links_by_incoming_lane(controlled_links).items():
                shape = traci.lane.getShape(lane_id)
                # A degenerate one-point shape has no direction to derive a
                # heading from; skipping is better than emitting a marker
                # pointing an arbitrary way.
                if len(shape) < 2:
                    continue
                x, y = shape[-1]
                lon, lat = self._projection.to_lon_lat(x, y)
                approaches.append(
                    TrafficLightApproach(
                        tls_id=tls_id,
                        lane_id=lane_id,
                        link_indices=indices,
                        lat=lat,
                        lng=lon,
                        heading=stop_line_heading(shape),
                    )
                )

        self._approaches = approaches
        return approaches
```

- [ ] **Step 6: Run the tests**

Run: `cd apps/api && .venv/bin/pytest tests/simulation/test_traffic_lights.py -v`
Expected: PASS (10 tests)

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/simulation/traffic_lights.py apps/api/app/simulation/models.py apps/api/app/simulation/runner.py apps/api/tests/simulation/test_traffic_lights.py
git commit -m "feat(api): extract traffic light approach geometry from the network

Groups each TLS's controlled links by incoming lane and positions one
approach at the lane's stop line. Computed once at startup and cached."
```

---

### Task 4: Traffic-light state subscriptions

**Files:**
- Modify: `apps/api/app/simulation/runner.py`
- Test: `apps/api/tests/simulation/test_traffic_lights.py` (extend)

**Interfaces:**
- Consumes: `SimulationRunner.start()` (Task 1), `_VEHICLE_SUBSCRIPTIONS` pattern (Task 2).
- Produces: `SimulationRunner.get_traffic_light_states() -> dict[str, str]`, mapping TLS id to its `RedYellowGreenState` string.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/tests/simulation/test_traffic_lights.py`:

```python
VALID_STATE_CHARS = set("rRyYgGsSuUoO")


def test_traffic_light_states_cover_every_program_in_the_network(runner):
    runner.step()
    states = runner.get_traffic_light_states()

    traci.switch(runner.label)
    assert set(states) == set(traci.trafficlight.getIDList())
    assert len(states) >= 40, "expected ~51 tlLogic programs in the SoMa network"


def test_traffic_light_state_strings_are_well_formed(runner):
    runner.step()
    for tls_id, state in runner.get_traffic_light_states().items():
        assert state, f"{tls_id} returned an empty state string"
        assert set(state) <= VALID_STATE_CHARS, (
            f"{tls_id} state {state!r} contains an unknown signal character"
        )


def test_state_string_is_long_enough_to_index_every_approachs_links(runner):
    # An approach's link_indices are offsets into its TLS's state string. If
    # the string were shorter than the largest index, the frontend would read
    # undefined and render the approach grey forever.
    runner.step()
    states = runner.get_traffic_light_states()
    for approach in runner.get_traffic_light_approaches():
        state = states[approach.tls_id]
        assert max(approach.link_indices) < len(state), (
            f"{approach.tls_id} lane {approach.lane_id} indexes past its state string"
        )


def test_traffic_light_states_change_as_the_simulation_runs(runner):
    # Proves phases are actually advancing rather than being read once and
    # frozen -- a frozen map of signals looks identical to a working one in a
    # single-frame screenshot.
    first = runner.get_traffic_light_states()
    for _ in range(200):
        runner.step()
    later = runner.get_traffic_light_states()
    assert first != later, "no signal changed phase over 200 steps"
```

Add `import traci` to the top of the file if it is not already present.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && .venv/bin/pytest tests/simulation/test_traffic_lights.py -k state -v`
Expected: FAIL — `AttributeError: 'SimulationRunner' object has no attribute 'get_traffic_light_states'`

- [ ] **Step 3: Implement**

In `apps/api/app/simulation/runner.py`, add beside `_VEHICLE_SUBSCRIPTIONS`:

```python
# TLS ids are fixed by the network, so every program is subscribed once at
# startup and the whole set is read in one call per tick.
_TRAFFIC_LIGHT_SUBSCRIPTIONS = (tc.TL_RED_YELLOW_GREEN_STATE,)
```

In `start()`, after the `self._projection = ...` line, add:

```python
        for tls_id in traci.trafficlight.getIDList():
            traci.trafficlight.subscribe(tls_id, _TRAFFIC_LIGHT_SUBSCRIPTIONS)
```

Add this method after `get_traffic_light_approaches()`:

```python
    def get_traffic_light_states(self) -> dict[str, str]:
        """Current phase string for every signal program, keyed by TLS id."""
        try:
            traci.switch(self._label)
            return {
                tls_id: values[tc.TL_RED_YELLOW_GREEN_STATE]
                for tls_id, values in traci.trafficlight.getAllSubscriptionResults().items()
                if tc.TL_RED_YELLOW_GREEN_STATE in values
            }
        # See step(): FatalTraCIError is not a subclass of TraCIException.
        except (traci.TraCIException, traci.FatalTraCIError) as exc:
            raise SimulationError(str(exc)) from exc
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/api && .venv/bin/pytest tests/simulation/test_traffic_lights.py -v`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/simulation/runner.py apps/api/tests/simulation/test_traffic_lights.py
git commit -m "feat(api): read traffic light phase state via subscriptions"
```

---

### Task 5: Carry `signals` in the vehicle frame, with fault isolation

**Files:**
- Modify: `apps/api/app/api/frames.py`, `apps/api/app/simulation/loop.py`
- Test: `apps/api/tests/api/test_frames.py` (extend), `apps/api/tests/simulation/test_loop.py` (extend)

**Interfaces:**
- Consumes: `SimulationRunner.get_traffic_light_states()` (Task 4).
- Produces: `vehicle_frame(tick: int, vehicles: list[VehicleState], signals: dict[str, str] | None = None) -> dict` — the `"signals"` key is **absent**, not null, when `signals is None`. `reset_signal_failure_log() -> None` in `app.simulation.loop`, for test isolation.

- [ ] **Step 1: Write the failing frame tests**

Append to `apps/api/tests/api/test_frames.py`:

```python
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && .venv/bin/pytest tests/api/test_frames.py -v`
Expected: FAIL — `TypeError: vehicle_frame() got an unexpected keyword argument 'signals'`

- [ ] **Step 3: Implement `vehicle_frame`**

Replace `vehicle_frame` in `apps/api/app/api/frames.py`:

```python
def vehicle_frame(
    tick: int,
    vehicles: list[VehicleState],
    signals: dict[str, str] | None = None,
) -> dict:
    frame = {
        "type": "simulation.vehicles",
        "tick": tick,
        "vehicles": [v.model_dump() for v in vehicles],
    }
    # Omitted rather than set to None: the frontend treats a missing key as
    # "keep what you had", which is what a transient signal-read failure
    # should look like.
    if signals is not None:
        frame["signals"] = signals
    return frame
```

- [ ] **Step 4: Run to verify frames pass**

Run: `cd apps/api && .venv/bin/pytest tests/api/test_frames.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the failing loop tests**

In `apps/api/tests/simulation/test_loop.py`, replace the `_StubRunner` class with:

```python
class _StubRunner:
    def __init__(
        self,
        vehicles=None,
        raise_on_step=False,
        running=True,
        step_error=None,
        signals=None,
        signal_error=None,
    ):
        self._vehicles = vehicles or []
        self._raise_on_step = raise_on_step
        self._step_error = step_error
        self._signals = {} if signals is None else signals
        self._signal_error = signal_error
        self.is_running = running
        self.failed = False

    def step(self):
        if self._raise_on_step:
            raise SimulationError("traci died")
        if self._step_error is not None:
            raise self._step_error

    def get_vehicle_states(self):
        return self._vehicles

    def get_traffic_light_states(self):
        if self._signal_error is not None:
            raise self._signal_error
        return self._signals

    def mark_failed(self):
        self.failed = True
```

Update the existing exact-equality assertion in `test_tick_once_returns_vehicle_frame_on_success` to account for the new key:

```python
async def test_tick_once_returns_vehicle_frame_on_success():
    vehicles = [VehicleState(id="car-1", lat=1.0, lng=2.0, heading=0.0, speed=0.0)]
    runner = _StubRunner(vehicles=vehicles, signals={"tls-1": "rG"})
    frame = await tick_once(runner, tick=7)
    assert frame == {
        "type": "simulation.vehicles",
        "tick": 7,
        "vehicles": [v.model_dump() for v in vehicles],
        "signals": {"tls-1": "rG"},
    }
```

Append the new tests:

```python
@pytest.fixture(autouse=True)
def _reset_signal_log():
    # The signal-failure warning is logged once per process to avoid spamming
    # at 4 Hz, so the flag has to be cleared between tests that assert on it.
    loop_module.reset_signal_failure_log()
    yield
    loop_module.reset_signal_failure_log()


async def test_tick_once_omits_signals_and_keeps_running_when_the_signal_read_fails():
    # THE regression test for this slice. loop.py's outer handler calls
    # mark_failed() permanently on any exception, and the frontend store
    # auto-clears errorMessage on the next vehicle frame -- sound only while a
    # failed runner can never emit one. A decorative signal layer must never
    # be able to trip that. Traffic keeps flowing; the signals key disappears.
    vehicles = [VehicleState(id="car-1", lat=1.0, lng=2.0, heading=0.0, speed=0.0)]
    runner = _StubRunner(vehicles=vehicles, signal_error=RuntimeError("tls exploded"))

    frame = await tick_once(runner, tick=4)

    assert frame["type"] == "simulation.vehicles"
    assert frame["vehicles"] == [v.model_dump() for v in vehicles]
    assert "signals" not in frame
    assert runner.failed is False, "a signal read failure killed the simulation"


async def test_tick_once_logs_a_signal_failure_only_once(caplog):
    runner = _StubRunner(signal_error=RuntimeError("tls exploded"))
    with caplog.at_level(logging.ERROR, logger="app.simulation.loop"):
        for tick in range(5):
            await tick_once(runner, tick=tick)
    signal_records = [r for r in caplog.records if "traffic light" in r.getMessage()]
    assert len(signal_records) == 1, "signal failures must not log at tick rate"


async def test_run_tick_loop_keeps_broadcasting_vehicle_frames_despite_signal_failures(
    monkeypatch,
):
    recorder = _RecordingManager()
    monkeypatch.setattr(loop_module, "manager", recorder)
    vehicles = [VehicleState(id="car-1", lat=1.0, lng=2.0, heading=0.0, speed=0.0)]
    runner = _StubRunner(vehicles=vehicles, signal_error=RuntimeError("tls exploded"))

    task = asyncio.create_task(run_tick_loop(runner, tick_interval=0.01))
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert len(recorder.frames) >= 2
    assert all(f["type"] == "simulation.vehicles" for f in recorder.frames)
    ticks = [f["tick"] for f in recorder.frames]
    assert ticks == list(range(len(ticks))), "tick counter stalled"
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd apps/api && .venv/bin/pytest tests/simulation/test_loop.py -v`
Expected: FAIL — `AttributeError: module 'app.simulation.loop' has no attribute 'reset_signal_failure_log'`

- [ ] **Step 7: Implement the loop change**

In `apps/api/app/simulation/loop.py`, after `log = logging.getLogger(__name__)` add:

```python
# Logged once per process rather than per tick: a persistent TraCI fault would
# otherwise emit a stack trace four times a second for the life of the run.
_signal_failure_logged = False


def reset_signal_failure_log() -> None:
    """Clear the log-once latch. Exists for test isolation."""
    global _signal_failure_logged
    _signal_failure_logged = False
```

Replace `tick_once` with:

```python
async def tick_once(runner, tick: int) -> dict:
    global _signal_failure_logged

    if not runner.is_running:
        return error_frame("simulation offline")
    try:
        runner.step()
        vehicles = runner.get_vehicle_states()
    except SimulationError as exc:
        runner.mark_failed()
        return error_frame(f"simulation step failed: {exc}")

    # Signals are cosmetic and must never be able to stop traffic. Letting an
    # exception from here reach run_tick_loop's handler would call
    # mark_failed() permanently, killing the simulation for the rest of the
    # session over a decorative layer. Degrade the frame instead: the
    # frontend keeps its previous signal state when the key is absent.
    signals = None
    try:
        signals = runner.get_traffic_light_states()
    except Exception:
        if not _signal_failure_logged:
            log.exception(
                "traffic light state read failed; frames will omit signals"
            )
            _signal_failure_logged = True

    return vehicle_frame(tick, vehicles, signals)
```

- [ ] **Step 8: Run the tests**

Run: `cd apps/api && .venv/bin/pytest tests/simulation/test_loop.py tests/api/test_frames.py -v`
Expected: PASS

- [ ] **Step 9: Run the full backend suite**

Run: `cd apps/api && .venv/bin/pytest -q`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add apps/api/app/api/frames.py apps/api/app/simulation/loop.py apps/api/tests/api/test_frames.py apps/api/tests/simulation/test_loop.py
git commit -m "feat(api): carry traffic signal state in the vehicle frame

Signals ride inside simulation.vehicles so phase state stays atomically in
sync with the positions of the same tick. The read is isolated inside
tick_once: a signal failure omits the key and logs once, and can never reach
the handler that permanently marks the runner failed."
```

---

### Task 6: `GET /traffic-lights`

**Files:**
- Create: `apps/api/app/api/traffic_lights.py`
- Modify: `apps/api/app/main.py`
- Test: `apps/api/tests/api/test_traffic_lights_routes.py`

**Interfaces:**
- Consumes: `SimulationRunner.get_traffic_light_approaches()` (Task 3), `app.api.deps.get_runner`.
- Produces: `GET /traffic-lights` returning `{"approaches": [TrafficLightApproach, ...]}`; 503 when the runner is unconfigured.

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/api/test_traffic_lights_routes.py`:

```python
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import deps
from app.api.traffic_lights import router
from app.simulation.models import TrafficLightApproach


class _StubRunner:
    def __init__(self, approaches):
        self._approaches = approaches

    def get_traffic_light_approaches(self):
        return self._approaches


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router)
    yield TestClient(app)
    deps.deps.runner = None


def test_returns_the_approach_list(client):
    deps.deps.runner = _StubRunner(
        [
            TrafficLightApproach(
                tls_id="tls-1",
                lane_id="north_0",
                link_indices=[0, 1],
                lat=37.7765,
                lng=-122.3946,
                heading=90.0,
            )
        ]
    )
    response = client.get("/traffic-lights")
    assert response.status_code == 200
    assert response.json() == {
        "approaches": [
            {
                "tls_id": "tls-1",
                "lane_id": "north_0",
                "link_indices": [0, 1],
                "lat": 37.7765,
                "lng": -122.3946,
                "heading": 90.0,
            }
        ]
    }


def test_returns_an_empty_list_when_the_network_has_no_signals(client):
    deps.deps.runner = _StubRunner([])
    response = client.get("/traffic-lights")
    assert response.status_code == 200
    assert response.json() == {"approaches": []}


def test_returns_503_when_the_simulation_is_not_ready(client):
    # 503, not 500. The dashboard polls this on mount and may well beat the
    # simulation's startup; it retries on 503 and renders the map meanwhile,
    # so first paint is never blocked on signal geometry.
    deps.deps.runner = None
    response = client.get("/traffic-lights")
    assert response.status_code == 503
    assert response.json()["detail"] == "simulation not ready"
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && .venv/bin/pytest tests/api/test_traffic_lights_routes.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.api.traffic_lights'`

- [ ] **Step 3: Write the route**

Create `apps/api/app/api/traffic_lights.py`:

```python
from fastapi import APIRouter, HTTPException

from .deps import get_runner

router = APIRouter()


@router.get("/traffic-lights")
async def list_traffic_lights():
    # get_runner() is called directly rather than through Depends() so the
    # unconfigured case can be answered with 503 here, without changing the
    # 500 behaviour the incident routes already rely on.
    try:
        runner = get_runner()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="simulation not ready") from exc
    return {"approaches": runner.get_traffic_light_approaches()}
```

- [ ] **Step 4: Register the router and warm the cache at startup**

In `apps/api/app/main.py`, add to the imports:

```python
from .api.traffic_lights import router as traffic_lights_router
```

In `lifespan`, after `deps.deps.store = IncidentStore()`, add:

```python
    # Warm the approach cache before the first request. Signal geometry is
    # decorative, so a failure here must not prevent the simulation starting:
    # the map simply renders without signal markers.
    try:
        runner.get_traffic_light_approaches()
    except Exception:
        log.exception("traffic light geometry extraction failed; signals will be absent")
        runner._approaches = []
```

At the bottom, after `app.include_router(incidents_router)`:

```python
app.include_router(traffic_lights_router)
```

- [ ] **Step 5: Run the tests**

Run: `cd apps/api && .venv/bin/pytest tests/api/test_traffic_lights_routes.py -v`
Expected: PASS (3 tests)

- [ ] **Step 6: Run the full backend suite**

Run: `cd apps/api && .venv/bin/pytest -q`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/api/traffic_lights.py apps/api/app/main.py apps/api/tests/api/test_traffic_lights_routes.py
git commit -m "feat(api): serve traffic light approach geometry at GET /traffic-lights"
```

---

### Task 7: Car sprite atlas

**Files:**
- Create: `apps/web/lib/car-sprites.ts`
- Test: `apps/web/tests/car-sprites.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `CIVILIAN_PALETTE: string[]` (20 hex strings)
  - `BODY_KEYS: readonly ["sedan", "suv", "truck"]`
  - `hashVehicleId(id: string): number` — FNV-1a 32-bit, unsigned
  - `spriteKeyForVehicle(id: string, kind: string): string` — returns `"<body>-<colorIndex>"`
  - `SpriteAtlas = { canvas: HTMLCanvasElement; mapping: Record<string, {x:number;y:number;width:number;height:number;mask:false}> }`
  - `buildSpriteAtlas(): SpriteAtlas | null` — `null` when no 2D context is available (jsdom, SSR)

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/car-sprites.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  BODY_KEYS,
  CIVILIAN_PALETTE,
  buildSpriteAtlas,
  hashVehicleId,
  spriteKeyForVehicle,
} from "../lib/car-sprites";

describe("CIVILIAN_PALETTE", () => {
  it("has 20 colours", () => {
    expect(CIVILIAN_PALETTE).toHaveLength(20);
  });

  it("contains no duplicates", () => {
    expect(new Set(CIVILIAN_PALETTE).size).toBe(CIVILIAN_PALETTE.length);
  });

  it("reserves red for the emergency liveries in a later slice", () => {
    // A civilian car tinted fire-engine red is indistinguishable from an
    // emergency unit at 14px, which is the whole point of the palette.
    for (const hex of CIVILIAN_PALETTE) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const dominantlyRed = r > 150 && r - g > 60 && r - b > 60;
      expect(dominantlyRed, `${hex} is too red for a civilian vehicle`).toBe(false);
    }
  });
});

describe("hashVehicleId", () => {
  it("is stable across calls for the same id", () => {
    // Load-bearing, not cosmetic: re-randomising per frame makes every car
    // strobe through the palette at the render rate.
    expect(hashVehicleId("veh42")).toBe(hashVehicleId("veh42"));
  });

  it("returns a non-negative integer", () => {
    for (const id of ["veh0", "veh1", "a", "", "veh999999"]) {
      const h = hashVehicleId(id);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
    }
  });

  it("distinguishes adjacent ids", () => {
    expect(hashVehicleId("veh1")).not.toBe(hashVehicleId("veh2"));
  });
});

describe("spriteKeyForVehicle", () => {
  it("is stable for the same id", () => {
    expect(spriteKeyForVehicle("veh42", "civilian")).toBe(
      spriteKeyForVehicle("veh42", "civilian")
    );
  });

  it("only ever returns a key in the atlas mapping", () => {
    const valid = new Set<string>();
    for (const body of BODY_KEYS) {
      for (let i = 0; i < CIVILIAN_PALETTE.length; i += 1) valid.add(`${body}-${i}`);
    }
    for (let i = 0; i < 1000; i += 1) {
      expect(valid.has(spriteKeyForVehicle(`veh${i}`, "civilian"))).toBe(true);
    }
  });

  it("spreads 1000 vehicles across every palette colour", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      seen.add(spriteKeyForVehicle(`veh${i}`, "civilian").split("-")[1]);
    }
    expect(seen.size).toBe(CIVILIAN_PALETTE.length);
  });

  it("spreads 1000 vehicles across every body type", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      seen.add(spriteKeyForVehicle(`veh${i}`, "civilian").split("-")[0]);
    }
    expect(seen.size).toBe(BODY_KEYS.length);
  });
});

describe("buildSpriteAtlas", () => {
  it("returns null when no 2D canvas context is available", () => {
    // jsdom has no canvas implementation, and neither does the Next.js
    // server render. Returning null lets the layer builder fall back to the
    // scatterplot instead of throwing during SSR.
    expect(buildSpriteAtlas()).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npm test -- car-sprites`
Expected: FAIL — cannot resolve `../lib/car-sprites`

- [ ] **Step 3: Write `apps/web/lib/car-sprites.ts`**

```ts
/**
 * Civilian car sprites, drawn in-repo with Canvas 2D path commands.
 *
 * Drawn rather than loaded because rasterising SVG requires an async Image
 * round-trip, which would force every caller of buildSpriteAtlas to be async.
 *
 * Pre-tinted rather than tinted at draw time because deck.gl's IconLayer
 * only applies getColor to icons declared `mask: true`, and a masked icon
 * renders as a flat silhouette with no windows or lights. Baking 3 bodies x
 * 20 colours into the atlas keeps the detail in a single draw call -- and the
 * emergency liveries arriving in a later slice are pre-coloured and must not
 * be tinted at all, so one uniform `mask: false` pipeline serves both.
 */

export const CELL_WIDTH = 64;
export const CELL_HEIGHT = 128;

export const BODY_KEYS = ["sedan", "suv", "truck"] as const;
export type BodyKey = (typeof BODY_KEYS)[number];

/**
 * Deliberately excludes red and red/white/blue: those are reserved for police,
 * ambulance and fire liveries, which must stay instantly distinguishable at
 * the ~14px these render at.
 */
export const CIVILIAN_PALETTE = [
  "#e8e8ea", "#b9bec6", "#8d949e", "#5f6670", "#3a4048",
  "#1d2127", "#2f4b7c", "#1b6ca8", "#2a9d8f", "#2f7d54",
  "#6aa84f", "#b7c94a", "#e9c46a", "#e0a458", "#c98b3a",
  "#8a6240", "#6b4f3f", "#7d5ba6", "#4b4e8f", "#a8a29e",
] as const;

export interface SpriteAtlas {
  canvas: HTMLCanvasElement;
  mapping: Record<
    string,
    { x: number; y: number; width: number; height: number; mask: false }
  >;
}

/** FNV-1a, 32-bit, returned unsigned. */
export function hashVehicleId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function spriteKeyForVehicle(id: string, _kind: string): string {
  // `_kind` is unused for civilians but is the hook the emergency liveries
  // key off in a later slice; keeping it in the signature now means no
  // call-site churn then.
  const hash = hashVehicleId(id);
  const body = BODY_KEYS[hash % BODY_KEYS.length];
  // Shift before the second modulo so body and colour do not correlate.
  const colorIndex = (hash >>> 8) % CIVILIAN_PALETTE.length;
  return `${body}-${colorIndex}`;
}

function shade(hex: string, amount: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const r = clamp(parseInt(hex.slice(1, 3), 16) * (1 + amount));
  const g = clamp(parseInt(hex.slice(3, 5), 16) * (1 + amount));
  const b = clamp(parseInt(hex.slice(5, 7), 16) * (1 + amount));
  return `rgb(${r},${g},${b})`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

const GLASS = "rgba(18,24,32,0.88)";
const HEADLIGHT = "#fff4cc";
const TAILLIGHT = "#d64545";

/** All bodies are drawn nose-up (front towards -y) in a CELL_WIDTH x
 * CELL_HEIGHT box. The layer rotates them with getAngle = -heading. */
function drawBody(
  ctx: CanvasRenderingContext2D,
  body: BodyKey,
  color: string
): void {
  const w = CELL_WIDTH;
  const h = CELL_HEIGHT;
  const inset = body === "truck" ? 0.08 : 0.12;
  const radius = body === "truck" ? w * 0.1 : w * 0.22;

  ctx.fillStyle = color;
  roundRect(ctx, w * inset, h * 0.03, w * (1 - inset * 2), h * 0.94, radius);

  ctx.fillStyle = shade(color, -0.18);
  if (body === "truck") {
    // Cab, then a flat load bed.
    roundRect(ctx, w * 0.14, h * 0.06, w * 0.72, h * 0.3, w * 0.07);
    ctx.fillStyle = shade(color, -0.3);
    roundRect(ctx, w * 0.14, h * 0.42, w * 0.72, h * 0.5, w * 0.04);
  } else {
    const roofTop = body === "suv" ? 0.28 : 0.36;
    const roofHeight = body === "suv" ? 0.42 : 0.28;
    roundRect(ctx, w * 0.2, h * roofTop, w * 0.6, h * roofHeight, w * 0.06);
  }

  ctx.fillStyle = GLASS;
  roundRect(ctx, w * 0.21, h * 0.17, w * 0.58, h * 0.13, w * 0.05);
  if (body !== "truck") {
    roundRect(ctx, w * 0.21, h * 0.7, w * 0.58, h * 0.12, w * 0.05);
  }

  ctx.fillStyle = HEADLIGHT;
  ctx.fillRect(w * 0.17, h * 0.045, w * 0.16, h * 0.028);
  ctx.fillRect(w * 0.67, h * 0.045, w * 0.16, h * 0.028);

  ctx.fillStyle = TAILLIGHT;
  ctx.fillRect(w * 0.17, h * 0.935, w * 0.16, h * 0.025);
  ctx.fillRect(w * 0.67, h * 0.935, w * 0.16, h * 0.025);
}

export function buildSpriteAtlas(): SpriteAtlas | null {
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = CELL_WIDTH * CIVILIAN_PALETTE.length;
  canvas.height = CELL_HEIGHT * BODY_KEYS.length;

  const ctx = canvas.getContext("2d");
  // jsdom returns null here (no canvas backend), as does any server render.
  if (!ctx) return null;

  const mapping: SpriteAtlas["mapping"] = {};
  BODY_KEYS.forEach((body, row) => {
    CIVILIAN_PALETTE.forEach((color, column) => {
      const x = column * CELL_WIDTH;
      const y = row * CELL_HEIGHT;
      ctx.save();
      ctx.translate(x, y);
      drawBody(ctx, body, color);
      ctx.restore();
      mapping[`${body}-${column}`] = {
        x,
        y,
        width: CELL_WIDTH,
        height: CELL_HEIGHT,
        mask: false,
      };
    });
  });

  return { canvas, mapping };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/web && npm test -- car-sprites`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/car-sprites.ts apps/web/tests/car-sprites.test.ts
git commit -m "feat(web): add a pre-tinted civilian car sprite atlas

Three bodies x 20 colours drawn with Canvas 2D paths. Assignment is a stable
FNV-1a hash of the vehicle id, so a car keeps its appearance across ticks and
reconnects. Returns null without a 2D context so SSR and jsdom fall back."
```

---

### Task 8: Vehicle icon layer

**Files:**
- Modify: `apps/web/lib/layers.ts`
- Test: `apps/web/tests/layers.test.ts` (extend)

**Interfaces:**
- Consumes: `SpriteAtlas`, `buildSpriteAtlas`, `spriteKeyForVehicle` (Task 7); existing `buildVehicleLayer`.
- Produces: `buildVehicleIconLayer(vehicles: VehicleState[], sprites: SpriteAtlas | null): Layer` — always has `id === "vehicles"`, on both the icon and the fallback path.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/tests/layers.test.ts`:

```ts
import { buildVehicleIconLayer } from "../lib/layers";
import { buildSpriteAtlas, spriteKeyForVehicle } from "../lib/car-sprites";
import type { SpriteAtlas } from "../lib/car-sprites";
import type { VehicleState } from "../lib/types";

describe("buildVehicleIconLayer", () => {
  const vehicle: VehicleState = {
    id: "veh42",
    lat: 37.7765,
    lng: -122.3946,
    heading: 90,
    speed: 8,
    kind: "civilian",
  };

  // jsdom has no canvas backend, so a real atlas is unavailable here. This
  // fake carries the same shape the icon path consumes.
  const fakeAtlas = {
    canvas: {} as HTMLCanvasElement,
    mapping: { "sedan-0": { x: 0, y: 0, width: 64, height: 128, mask: false } },
  } as SpriteAtlas;

  it("falls back to the scatterplot layer when no atlas is available", () => {
    expect(buildSpriteAtlas()).toBeNull();
    const layer = buildVehicleIconLayer([vehicle], null);
    expect(layer.id).toBe("vehicles");
    expect(layer.props.data).toEqual([vehicle]);
  });

  it("keeps the layer id stable across both paths", () => {
    expect(buildVehicleIconLayer([vehicle], fakeAtlas).id).toBe(
      buildVehicleIconLayer([vehicle], null).id
    );
  });

  it("negates the heading, because deck.gl angles are counter-clockwise", () => {
    // SUMO's getAngle() is degrees clockwise from north; deck.gl's getAngle
    // is counter-clockwise. Getting this wrong points every car the wrong way
    // in a manner that still looks plausible in a screenshot.
    const layer = buildVehicleIconLayer([vehicle], fakeAtlas);
    const getAngle = layer.props.getAngle as (v: VehicleState) => number;
    expect(getAngle(vehicle)).toBe(-90);
    expect(getAngle({ ...vehicle, heading: 217 })).toBe(-217);
  });

  it("positions icons at [lng, lat]", () => {
    const layer = buildVehicleIconLayer([vehicle], fakeAtlas);
    const getPosition = layer.props.getPosition as (v: VehicleState) => number[];
    expect(getPosition(vehicle)).toEqual([-122.3946, 37.7765]);
  });

  it("selects the icon by the vehicle's stable sprite key", () => {
    const layer = buildVehicleIconLayer([vehicle], fakeAtlas);
    const getIcon = layer.props.getIcon as (v: VehicleState) => string;
    expect(getIcon(vehicle)).toBe(spriteKeyForVehicle("veh42", "civilian"));
  });

  it("sizes icons in metres with a pixel floor so they survive zooming out", () => {
    // A real 4.5m car is about 2px at z15. Without the floor, vehicles vanish.
    const layer = buildVehicleIconLayer([vehicle], fakeAtlas);
    expect(layer.props.sizeUnits).toBe("meters");
    expect(layer.props.sizeMinPixels).toBe(14);
  });

  it("lays icons flat on the ground plane rather than billboarding", () => {
    // billboard: true would make every car face the camera under pitch,
    // destroying the heading cue entirely.
    expect(buildVehicleIconLayer([vehicle], fakeAtlas).props.billboard).toBe(false);
  });

  it("handles an empty vehicle list", () => {
    expect(buildVehicleIconLayer([], fakeAtlas).props.data).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npm test -- layers`
Expected: FAIL — `buildVehicleIconLayer` is not exported

- [ ] **Step 3: Implement**

In `apps/web/lib/layers.ts`, extend the imports:

```ts
import { ScatterplotLayer, IconLayer } from "@deck.gl/layers";
import type { Incident, VehicleState } from "./types";
import { spriteKeyForVehicle, type SpriteAtlas } from "./car-sprites";
```

Append:

```ts
/**
 * Vehicles as pre-tinted top-down car icons.
 *
 * Falls back to the existing scatterplot layer when no atlas could be built
 * (server render, or jsdom under test). The id is "vehicles" on both paths so
 * MapView never has to know which one it got.
 */
export function buildVehicleIconLayer(
  vehicles: VehicleState[],
  sprites: SpriteAtlas | null
) {
  if (!sprites) return buildVehicleLayer(vehicles);

  return new IconLayer({
    id: "vehicles",
    data: vehicles,
    iconAtlas: sprites.canvas,
    iconMapping: sprites.mapping,
    getIcon: (v: VehicleState) => spriteKeyForVehicle(v.id, v.kind),
    getPosition: (v: VehicleState) => [v.lng, v.lat],
    // deck.gl angles are counter-clockwise; SUMO headings are clockwise from
    // north. Negating is the whole conversion.
    getAngle: (v: VehicleState) => -v.heading,
    getSize: 4.5,
    sizeUnits: "meters",
    // A 4.5m car is ~2px at z15; without a floor, traffic disappears when the
    // operator zooms out to see the whole grid.
    sizeMinPixels: 14,
    // Flat on the ground plane. Billboarding would turn every car to face the
    // camera under the 45-degree pitch and destroy the heading cue.
    billboard: false,
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/web && npm test -- layers`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/layers.ts apps/web/tests/layers.test.ts
git commit -m "feat(web): render vehicles as rotated car icons"
```

---

### Task 9: Traffic signal layer

**Files:**
- Modify: `apps/web/lib/layers.ts`, `apps/web/lib/types.ts`
- Test: `apps/web/tests/signal-layer.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `TrafficLightApproach` interface in `lib/types.ts`; `SignalColor = "red" | "amber" | "green" | "off"`; `approachColor(state: string | undefined, linkIndices: number[]): SignalColor`; `buildSignalLayer(approaches: TrafficLightApproach[], signals: Record<string, string>): Layer` with `id === "signals"`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/signal-layer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { approachColor, buildSignalLayer } from "../lib/layers";
import type { TrafficLightApproach } from "../lib/types";

const approach: TrafficLightApproach = {
  tls_id: "tls-1",
  lane_id: "north_0",
  link_indices: [0, 1],
  lat: 37.7765,
  lng: -122.3946,
  heading: 90,
};

describe("approachColor", () => {
  it.each([
    ["r", "red"],
    ["s", "red"],
    ["y", "amber"],
    ["u", "amber"],
    ["g", "green"],
    ["G", "green"],
    ["o", "off"],
    ["O", "off"],
  ])("maps SUMO state character %s to %s", (char, expected) => {
    expect(approachColor(char, [0])).toBe(expected);
  });

  it("takes the most permissive state across an approach's links", () => {
    // An approach owns several links -- a protected left can be red while the
    // through movement is green. The marker answers one question only: "can
    // traffic from this lane move?" So any green wins.
    expect(approachColor("rG", [0, 1])).toBe("green");
    expect(approachColor("Gr", [0, 1])).toBe("green");
    expect(approachColor("ry", [0, 1])).toBe("amber");
    expect(approachColor("rr", [0, 1])).toBe("red");
  });

  it("ranks red above off, so a dark link never masks a live red", () => {
    expect(approachColor("or", [0, 1])).toBe("red");
  });

  it("reads only the indices the approach owns", () => {
    expect(approachColor("rrGG", [0, 1])).toBe("red");
    expect(approachColor("rrGG", [2, 3])).toBe("green");
  });

  it("returns off for an unknown state character", () => {
    expect(approachColor("?", [0])).toBe("off");
  });

  it("returns off when the TLS has no state this tick", () => {
    expect(approachColor(undefined, [0, 1])).toBe("off");
  });

  it("returns off when an index runs past the end of the state string", () => {
    expect(approachColor("r", [7])).toBe("off");
  });
});

describe("buildSignalLayer", () => {
  it("builds an extruded column layer with the approach data", () => {
    const layer = buildSignalLayer([approach], { "tls-1": "GG" });
    expect(layer.id).toBe("signals");
    expect(layer.props.data).toEqual([approach]);
    expect(layer.props.extruded).toBe(true);
  });

  it("positions columns at [lng, lat]", () => {
    const layer = buildSignalLayer([approach], {});
    const getPosition = layer.props.getPosition as (a: TrafficLightApproach) => number[];
    expect(getPosition(approach)).toEqual([-122.3946, 37.7765]);
  });

  it("colours a green approach green and a red one red", () => {
    const green = buildSignalLayer([approach], { "tls-1": "GG" });
    const red = buildSignalLayer([approach], { "tls-1": "rr" });
    const colorOf = (l: ReturnType<typeof buildSignalLayer>) =>
      (l.props.getFillColor as (a: TrafficLightApproach) => number[])(approach);
    expect(colorOf(green)).not.toEqual(colorOf(red));
    expect(colorOf(green)[1]).toBeGreaterThan(colorOf(green)[0]);
    expect(colorOf(red)[0]).toBeGreaterThan(colorOf(red)[1]);
  });

  it("declares an updateTrigger on the signal map", () => {
    // Without this deck.gl caches the colour attribute and the signals never
    // change colour again after the first frame -- a bug that looks exactly
    // like "the simulation froze".
    const signals = { "tls-1": "GG" };
    const layer = buildSignalLayer([approach], signals);
    expect(layer.props.updateTriggers.getFillColor).toEqual([signals]);
  });

  it("handles an empty approach list", () => {
    expect(buildSignalLayer([], {}).props.data).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npm test -- signal-layer`
Expected: FAIL — `approachColor` is not exported from `../lib/layers`

- [ ] **Step 3: Add the type**

Append to `apps/web/lib/types.ts`:

```ts
/**
 * One signalised approach. `link_indices` are offsets into its TLS's state
 * string, which is how a single marker resolves the colour of every movement
 * the lane controls.
 */
export interface TrafficLightApproach {
  tls_id: string;
  lane_id: string;
  link_indices: number[];
  lat: number;
  lng: number;
  heading: number;
}
```

Also update the `ServerMessage` vehicles variant to carry signals:

```ts
export type ServerMessage =
  | {
      type: "simulation.vehicles";
      tick: number;
      vehicles: VehicleState[];
      // Absent when the backend's signal read failed. Absent means "keep the
      // previous state", not "everything is off".
      signals?: Record<string, string>;
    }
  | { type: "incident.created"; incident: Incident }
  | { type: "simulation.error"; message: string };
```

- [ ] **Step 4: Implement the layer**

In `apps/web/lib/layers.ts`, extend the imports:

```ts
import { ScatterplotLayer, IconLayer, ColumnLayer } from "@deck.gl/layers";
import type { Incident, VehicleState, TrafficLightApproach } from "./types";
```

Append:

```ts
export type SignalColor = "red" | "amber" | "green" | "off";

/** SUMO's signal alphabet. */
const STATE_COLOR: Record<string, SignalColor> = {
  r: "red",
  s: "red",
  y: "amber",
  u: "amber",
  g: "green",
  G: "green",
  o: "off",
  O: "off",
};

const SIGNAL_RGB: Record<SignalColor, [number, number, number]> = {
  red: [239, 68, 68],
  amber: [251, 191, 36],
  green: [34, 197, 94],
  off: [107, 114, 128],
};

// Most-permissive wins. Red outranks off so an unpowered link can never mask
// a live red on the same approach.
const PERMISSIVENESS: Record<SignalColor, number> = {
  off: 0,
  red: 1,
  amber: 2,
  green: 3,
};

/**
 * Resolve one approach's colour from its TLS's state string.
 *
 * An approach owns several links and they can differ -- a protected left may
 * be red while the through movement is green. The marker answers exactly one
 * question, "can traffic from this lane move?", so the most permissive of the
 * approach's links wins.
 */
export function approachColor(
  state: string | undefined,
  linkIndices: number[]
): SignalColor {
  if (!state) return "off";
  let best: SignalColor = "off";
  for (const index of linkIndices) {
    const color = STATE_COLOR[state[index]] ?? "off";
    if (PERMISSIVENESS[color] > PERMISSIVENESS[best]) best = color;
  }
  return best;
}

/**
 * Signal state as short coloured posts standing at each stop line.
 *
 * Columns rather than flat dots: at the 45-degree default pitch a ground-plane
 * dot is close to invisible, while a 4m post reads instantly and needs no
 * icon atlas.
 */
export function buildSignalLayer(
  approaches: TrafficLightApproach[],
  signals: Record<string, string>
) {
  return new ColumnLayer({
    id: "signals",
    data: approaches,
    diskResolution: 6,
    radius: 1.5,
    extruded: true,
    getPosition: (a: TrafficLightApproach) => [a.lng, a.lat],
    getElevation: 4,
    getFillColor: (a: TrafficLightApproach) =>
      SIGNAL_RGB[approachColor(signals[a.tls_id], a.link_indices)],
    // Without this deck.gl caches the colour attribute and signals never
    // change colour after the first frame.
    updateTriggers: { getFillColor: [signals] },
  });
}
```

- [ ] **Step 5: Run the tests**

Run: `cd apps/web && npm test -- signal-layer`
Expected: PASS (16 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/layers.ts apps/web/lib/types.ts apps/web/tests/signal-layer.test.ts
git commit -m "feat(web): render traffic signals as coloured columns at stop lines"
```

---

### Task 10: Store signals and approaches

**Files:**
- Modify: `apps/web/lib/store.ts`
- Test: `apps/web/tests/store.test.ts` (extend)

**Interfaces:**
- Consumes: `TrafficLightApproach`, updated `ServerMessage` (Task 9).
- Produces: `SimulationState.signals: Record<string, string>`, `SimulationState.approaches: TrafficLightApproach[]`, `setApproaches(approaches: TrafficLightApproach[]): void`.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/tests/store.test.ts` (add `TrafficLightApproach` to the existing type import from `../lib/types`):

```ts
describe("traffic signals", () => {
  beforeEach(() => {
    useSimulationStore.setState({ signals: {}, approaches: [] });
  });

  it("starts with no signals and no approaches", () => {
    expect(useSimulationStore.getState().signals).toEqual({});
    expect(useSimulationStore.getState().approaches).toEqual([]);
  });

  it("updates signals from a vehicle frame", () => {
    useSimulationStore.getState().handleMessage({
      type: "simulation.vehicles",
      tick: 1,
      vehicles: [],
      signals: { "tls-1": "rrGG" },
    });
    expect(useSimulationStore.getState().signals).toEqual({ "tls-1": "rrGG" });
  });

  it("retains the previous signals when a frame omits the key", () => {
    // A transient backend signal-read failure omits `signals`. Blanking ~800
    // markers to grey for a frame is worse than showing state one tick stale.
    const store = useSimulationStore.getState();
    store.handleMessage({
      type: "simulation.vehicles",
      tick: 1,
      vehicles: [],
      signals: { "tls-1": "rrGG" },
    });
    store.handleMessage({ type: "simulation.vehicles", tick: 2, vehicles: [] });
    expect(useSimulationStore.getState().signals).toEqual({ "tls-1": "rrGG" });
  });

  it("replaces signals wholesale rather than merging", () => {
    // The backend sends the complete map every tick, so a merge would
    // resurrect a TLS that has since dropped out of the simulation.
    const store = useSimulationStore.getState();
    store.handleMessage({
      type: "simulation.vehicles",
      tick: 1,
      vehicles: [],
      signals: { "tls-1": "rr", "tls-2": "GG" },
    });
    store.handleMessage({
      type: "simulation.vehicles",
      tick: 2,
      vehicles: [],
      signals: { "tls-1": "GG" },
    });
    expect(useSimulationStore.getState().signals).toEqual({ "tls-1": "GG" });
  });

  it("stores approaches via setApproaches", () => {
    const approaches: TrafficLightApproach[] = [
      {
        tls_id: "tls-1",
        lane_id: "north_0",
        link_indices: [0],
        lat: 37.7,
        lng: -122.4,
        heading: 0,
      },
    ];
    useSimulationStore.getState().setApproaches(approaches);
    expect(useSimulationStore.getState().approaches).toEqual(approaches);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npm test -- store`
Expected: FAIL — `setApproaches is not a function`

- [ ] **Step 3: Implement**

In `apps/web/lib/store.ts`, extend the type import:

```ts
import type {
  VehicleState,
  Incident,
  ServerMessage,
  TrafficLightApproach,
} from "./types";
```

Add to the `SimulationState` interface, after `incidents`:

```ts
  /**
   * Current signal phase per TLS id, replaced wholesale each tick. A frame
   * that omits the key leaves this untouched: a transient backend failure
   * should show stale signals, not blank every marker to grey.
   */
  signals: Record<string, string>;
  /** Static approach geometry, fetched once from GET /traffic-lights. */
  approaches: TrafficLightApproach[];
  setApproaches: (approaches: TrafficLightApproach[]) => void;
```

Add to the initial state, after `incidents: []`:

```ts
  signals: {},
  approaches: [],
```

In `handleMessage`, replace the `simulation.vehicles` case:

```ts
      case "simulation.vehicles":
        set({
          previousVehicles: get().vehicles,
          vehicles: message.vehicles,
          lastTickAt: Date.now(),
          errorMessage: null,
          // Replaced, never merged: the backend sends the complete map every
          // tick, so merging would resurrect a stale TLS. Left alone entirely
          // when the key is absent.
          ...(message.signals ? { signals: message.signals } : {}),
        });
        break;
```

Add beside `setIncidents`:

```ts
  setApproaches: (approaches) => set({ approaches }),
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/web && npm test -- store`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/store.ts apps/web/tests/store.test.ts
git commit -m "feat(web): hold traffic signal state and approach geometry in the store"
```

---

### Task 11: Map style reducer

**Files:**
- Create: `apps/web/lib/map-style.ts`
- Test: `apps/web/tests/map-style.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Basemap = "standard" | "satellite"`, `STYLE_URL: Record<Basemap, string>`
  - `MapStyleState = { basemap: Basemap; buildings3d: boolean; terrain: boolean; night: boolean }`
  - `INITIAL_MAP_STYLE: MapStyleState`
  - `MapStyleAction = { type: "setBasemap"; basemap: Basemap } | { type: "toggle"; key: "buildings3d" | "terrain" | "night" }`
  - `mapStyleReducer(state: MapStyleState, action: MapStyleAction): MapStyleState`
  - `Instruction` union and `reapplyPlan(state: MapStyleState): Instruction[]`
  - `DEM_SOURCE_ID`, `DEM_SOURCE_URL`, `EXTRUSION_LAYER_ID`, `TERRAIN_EXAGGERATION`, `DEFAULT_VIEW_STATE`

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/map-style.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  DEFAULT_VIEW_STATE,
  INITIAL_MAP_STYLE,
  STYLE_URL,
  mapStyleReducer,
  reapplyPlan,
} from "../lib/map-style";

describe("DEFAULT_VIEW_STATE", () => {
  it("opens tilted at the zoom where Standard shows road detail", () => {
    // Mapbox Standard only renders lane markings, crosswalks and turn arrows
    // from roughly z16; at the previous z15.5 default none of it appeared.
    expect(DEFAULT_VIEW_STATE.pitch).toBe(45);
    expect(DEFAULT_VIEW_STATE.bearing).toBe(-17);
    expect(DEFAULT_VIEW_STATE.zoom).toBe(16.5);
  });
});

describe("mapStyleReducer", () => {
  it("defaults to Standard, 3D buildings on, day lighting, no terrain", () => {
    expect(INITIAL_MAP_STYLE).toEqual({
      basemap: "standard",
      buildings3d: true,
      terrain: false,
      night: false,
    });
  });

  it("switches basemap without disturbing the toggles", () => {
    const next = mapStyleReducer(
      { basemap: "standard", buildings3d: true, terrain: true, night: true },
      { type: "setBasemap", basemap: "satellite" }
    );
    expect(next).toEqual({
      basemap: "satellite",
      buildings3d: true,
      terrain: true,
      night: true,
    });
  });

  it.each(["buildings3d", "terrain", "night"] as const)("flips %s", (key) => {
    const next = mapStyleReducer(INITIAL_MAP_STYLE, { type: "toggle", key });
    expect(next[key]).toBe(!INITIAL_MAP_STYLE[key]);
  });

  it("does not mutate the input state", () => {
    const state = { ...INITIAL_MAP_STYLE };
    mapStyleReducer(state, { type: "toggle", key: "terrain" });
    expect(state).toEqual(INITIAL_MAP_STYLE);
  });

  it("maps each basemap to its style URL", () => {
    expect(STYLE_URL.standard).toBe("mapbox://styles/mapbox/standard");
    expect(STYLE_URL.satellite).toBe("mapbox://styles/mapbox/satellite-streets-v12");
  });
});

describe("reapplyPlan", () => {
  it("drives Standard's buildings through its config property", () => {
    // A custom fill-extrusion layer cannot be added to Standard: it does not
    // expose its source schema. Buildings are a style config there.
    const plan = reapplyPlan({
      basemap: "standard",
      buildings3d: true,
      terrain: false,
      night: false,
    });
    expect(plan).toContainEqual({
      op: "setConfigProperty",
      property: "show3dObjects",
      value: true,
    });
    expect(plan).not.toContainEqual({ op: "addExtrusionLayer" });
  });

  it("drives Satellite's buildings through a manual extrusion layer", () => {
    // satellite-streets-v12 is a classic style with no config properties, so
    // the same toggle needs a completely different implementation.
    const plan = reapplyPlan({
      basemap: "satellite",
      buildings3d: true,
      terrain: false,
      night: false,
    });
    expect(plan).toContainEqual({ op: "addExtrusionLayer" });
    expect(plan.some((i) => i.op === "setConfigProperty")).toBe(false);
  });

  it("removes the extrusion layer when buildings are off on Satellite", () => {
    const plan = reapplyPlan({
      basemap: "satellite",
      buildings3d: false,
      terrain: false,
      night: false,
    });
    expect(plan).toContainEqual({ op: "removeExtrusionLayer" });
  });

  it("selects the light preset from the night toggle", () => {
    const day = reapplyPlan(INITIAL_MAP_STYLE);
    const night = reapplyPlan({ ...INITIAL_MAP_STYLE, night: true });
    expect(day).toContainEqual({
      op: "setConfigProperty",
      property: "lightPreset",
      value: "day",
    });
    expect(night).toContainEqual({
      op: "setConfigProperty",
      property: "lightPreset",
      value: "night",
    });
  });

  it("always emits exactly one terrain instruction", () => {
    for (const terrain of [true, false]) {
      const plan = reapplyPlan({ ...INITIAL_MAP_STYLE, terrain });
      const terrainOps = plan.filter(
        (i) => i.op === "addTerrain" || i.op === "removeTerrain"
      );
      expect(terrainOps).toHaveLength(1);
      expect(terrainOps[0].op).toBe(terrain ? "addTerrain" : "removeTerrain");
    }
  });

  it("emits a complete plan every time, so a style reload restores everything", () => {
    // setStyle() destroys every custom source and layer. The plan is replayed
    // wholesale on style.load, so it must describe the full desired state
    // rather than a delta.
    const plan = reapplyPlan({
      basemap: "satellite",
      buildings3d: true,
      terrain: true,
      night: false,
    });
    expect(plan).toEqual([{ op: "addExtrusionLayer" }, { op: "addTerrain" }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npm test -- map-style`
Expected: FAIL — cannot resolve `../lib/map-style`

- [ ] **Step 3: Write `apps/web/lib/map-style.ts`**

```ts
/**
 * Basemap and 3D-toggle state, plus the declarative instruction list that
 * re-applies it to a Mapbox map.
 *
 * map.setStyle() destroys every custom source and layer, so terrain and the
 * satellite extrusion layer have to be re-added on each style load. Expressing
 * that as a pure state -> instruction[] function keeps the only genuinely
 * untestable part (the Mapbox calls) down to a thin interpreter in MapView.
 */

export type Basemap = "standard" | "satellite";

export const STYLE_URL: Record<Basemap, string> = {
  standard: "mapbox://styles/mapbox/standard",
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
};

export const DEM_SOURCE_ID = "mapbox-dem";
export const DEM_SOURCE_URL = "mapbox://mapbox.mapbox-terrain-dem-v1";
export const EXTRUSION_LAYER_ID = "satellite-3d-buildings";
export const TERRAIN_EXAGGERATION = 1.5;

/**
 * Zoom 16.5 rather than the previous 15.5 because Mapbox Standard's detailed
 * road rendering -- lane markings, crosswalks, turn arrows, 3D trees -- only
 * appears from about z16. The cost is roughly four blocks of view instead of
 * the whole SoMa grid.
 */
export const DEFAULT_VIEW_STATE = {
  longitude: -122.4,
  latitude: 37.781,
  zoom: 16.5,
  pitch: 45,
  bearing: -17,
};

export interface MapStyleState {
  basemap: Basemap;
  buildings3d: boolean;
  terrain: boolean;
  night: boolean;
}

export const INITIAL_MAP_STYLE: MapStyleState = {
  basemap: "standard",
  buildings3d: true,
  terrain: false,
  night: false,
};

export type MapStyleAction =
  | { type: "setBasemap"; basemap: Basemap }
  | { type: "toggle"; key: "buildings3d" | "terrain" | "night" };

export function mapStyleReducer(
  state: MapStyleState,
  action: MapStyleAction
): MapStyleState {
  switch (action.type) {
    case "setBasemap":
      return { ...state, basemap: action.basemap };
    case "toggle":
      return { ...state, [action.key]: !state[action.key] };
  }
}

export type Instruction =
  | {
      op: "setConfigProperty";
      property: "show3dObjects" | "lightPreset";
      value: boolean | string;
    }
  | { op: "addExtrusionLayer" }
  | { op: "removeExtrusionLayer" }
  | { op: "addTerrain" }
  | { op: "removeTerrain" };

/**
 * The complete set of operations that brings a freshly loaded style into
 * agreement with `state`. Always complete, never a delta: it is replayed
 * wholesale after every setStyle, which wipes everything it describes.
 */
export function reapplyPlan(state: MapStyleState): Instruction[] {
  const plan: Instruction[] = [];

  if (state.basemap === "standard") {
    // Standard owns its buildings and lighting; a custom extrusion layer
    // cannot be added because it does not expose its source schema.
    plan.push({
      op: "setConfigProperty",
      property: "show3dObjects",
      value: state.buildings3d,
    });
    plan.push({
      op: "setConfigProperty",
      property: "lightPreset",
      value: state.night ? "night" : "day",
    });
  } else {
    // satellite-streets-v12 is a classic style: no config properties, so the
    // same toggle means adding or removing a fill-extrusion layer by hand.
    plan.push(
      state.buildings3d
        ? { op: "addExtrusionLayer" }
        : { op: "removeExtrusionLayer" }
    );
  }

  plan.push(state.terrain ? { op: "addTerrain" } : { op: "removeTerrain" });
  return plan;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/web && npm test -- map-style`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/map-style.ts apps/web/tests/map-style.test.ts
git commit -m "feat(web): add a pure map style reducer and re-apply plan

setStyle destroys custom sources and layers, so the desired 3D state is
expressed as a complete instruction list replayed on every style load."
```

---

### Task 12: Map controls UI

**Files:**
- Create: `apps/web/components/MapControls.tsx`
- Test: `apps/web/tests/map-controls.test.tsx`

**Interfaces:**
- Consumes: `MapStyleState`, `MapStyleAction`, `Basemap` (Task 11).
- Produces: `MapControls` default export, props `{ state: MapStyleState; dispatch: (action: MapStyleAction) => void; buildingsDisabled?: boolean }`. Purely presentational — it owns no state.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/map-controls.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MapControls from "../components/MapControls";
import { INITIAL_MAP_STYLE } from "../lib/map-style";

function setup(overrides = {}, props = {}) {
  const dispatch = vi.fn();
  render(
    <MapControls
      state={{ ...INITIAL_MAP_STYLE, ...overrides }}
      dispatch={dispatch}
      {...props}
    />
  );
  return { dispatch };
}

describe("MapControls", () => {
  it("renders both basemap options", () => {
    setup();
    expect(screen.getByRole("radio", { name: /standard/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /satellite/i })).toBeInTheDocument();
  });

  it("marks the active basemap as checked", () => {
    setup({ basemap: "satellite" });
    expect(screen.getByRole("radio", { name: /satellite/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /standard/i })).not.toBeChecked();
  });

  it("dispatches setBasemap when the other basemap is picked", async () => {
    const { dispatch } = setup();
    await userEvent.click(screen.getByRole("radio", { name: /satellite/i }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "setBasemap",
      basemap: "satellite",
    });
  });

  it.each([
    [/3d buildings/i, "buildings3d"],
    [/terrain/i, "terrain"],
    [/night/i, "night"],
  ])("dispatches a toggle for %s", async (label, key) => {
    const { dispatch } = setup();
    await userEvent.click(screen.getByRole("checkbox", { name: label }));
    expect(dispatch).toHaveBeenCalledWith({ type: "toggle", key });
  });

  it("reflects toggle state in the checkboxes", () => {
    setup({ buildings3d: true, terrain: false, night: true });
    expect(screen.getByRole("checkbox", { name: /3d buildings/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /terrain/i })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /night/i })).toBeChecked();
  });

  it("hides the night toggle on Satellite, which has no light presets", () => {
    setup({ basemap: "satellite" });
    expect(screen.queryByRole("checkbox", { name: /night/i })).toBeNull();
  });

  it("disables the buildings toggle when the style cannot support it", () => {
    setup({ basemap: "satellite" }, { buildingsDisabled: true });
    expect(screen.getByRole("checkbox", { name: /3d buildings/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Install the user-event helper**

Run: `cd apps/web && npm install --save-dev @testing-library/user-event`

- [ ] **Step 3: Run to verify it fails**

Run: `cd apps/web && npm test -- map-controls`
Expected: FAIL — cannot resolve `../components/MapControls`

- [ ] **Step 4: Write `apps/web/components/MapControls.tsx`**

```tsx
"use client";
import type { Basemap, MapStyleAction, MapStyleState } from "../lib/map-style";

export interface MapControlsProps {
  state: MapStyleState;
  dispatch: (action: MapStyleAction) => void;
  /** Set when the loaded style has no building geometry to extrude. */
  buildingsDisabled?: boolean;
}

const BASEMAPS: { value: Basemap; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "satellite", label: "Satellite" },
];

export default function MapControls({
  state,
  dispatch,
  buildingsDisabled = false,
}: MapControlsProps) {
  return (
    <div
      data-testid="map-controls"
      className="absolute right-3 top-3 z-10 flex flex-col gap-2 rounded border border-outline-variant bg-surface-container/90 p-3 backdrop-blur-sm"
    >
      <fieldset className="flex flex-col gap-1">
        <legend className="text-label-caps text-on-surface-variant">Basemap</legend>
        {BASEMAPS.map(({ value, label }) => (
          <label key={value} className="flex items-center gap-2 text-mono-sm">
            <input
              type="radio"
              name="basemap"
              value={value}
              checked={state.basemap === value}
              onChange={() => dispatch({ type: "setBasemap", basemap: value })}
            />
            {label}
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-1 border-t border-outline-variant pt-2">
        <legend className="text-label-caps text-on-surface-variant">Layers</legend>

        <label className="flex items-center gap-2 text-mono-sm">
          <input
            type="checkbox"
            checked={state.buildings3d}
            disabled={buildingsDisabled}
            onChange={() => dispatch({ type: "toggle", key: "buildings3d" })}
          />
          3D Buildings
        </label>

        <label className="flex items-center gap-2 text-mono-sm">
          <input
            type="checkbox"
            checked={state.terrain}
            onChange={() => dispatch({ type: "toggle", key: "terrain" })}
          />
          Terrain
        </label>

        {/* Light presets are a Standard-style feature; classic styles such as
            satellite-streets have none, so the control is withdrawn rather
            than left inert. */}
        {state.basemap === "standard" && (
          <label className="flex items-center gap-2 text-mono-sm">
            <input
              type="checkbox"
              checked={state.night}
              onChange={() => dispatch({ type: "toggle", key: "night" })}
            />
            Night
          </label>
        )}
      </fieldset>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `cd apps/web && npm test -- map-controls`
Expected: PASS (9 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/MapControls.tsx apps/web/tests/map-controls.test.tsx apps/web/package.json apps/web/package-lock.json
git commit -m "feat(web): add basemap and 3D layer controls"
```

---

### Task 13: Wire MapView

**Files:**
- Modify: `apps/web/components/MapView.tsx`
- Test: `apps/web/tests/map-view.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 7–12, plus `GET /traffic-lights` (Task 6).
- Produces: no new exported API. `MapViewProps` is unchanged.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/map-view.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { useSimulationStore } from "../lib/store";

// react-map-gl needs a real WebGL context, so the map itself is stubbed. What
// is under test here is the wiring: the initial camera, the controls being
// mounted, and the approach fetch -- not Mapbox's rendering.
const initialViewStates: unknown[] = [];

vi.mock("react-map-gl/mapbox", () => ({
  default: (props: { initialViewState: unknown; children: React.ReactNode }) => {
    initialViewStates.push(props.initialViewState);
    return <div data-testid="map-stub">{props.children}</div>;
  },
  useControl: () => ({ setProps: () => {} }),
}));

vi.mock("@deck.gl/mapbox", () => ({ MapboxOverlay: class {} }));

import MapView from "../components/MapView";

describe("MapView", () => {
  beforeEach(() => {
    initialViewStates.length = 0;
    useSimulationStore.setState({ approaches: [], signals: {} });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          approaches: [
            {
              tls_id: "tls-1",
              lane_id: "north_0",
              link_indices: [0],
              lat: 37.7765,
              lng: -122.3946,
              heading: 90,
            },
          ],
        }),
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the camera tilted at zoom 16.5", () => {
    render(<MapView mapboxToken="tok" flyToTarget={null} />);
    expect(initialViewStates[0]).toMatchObject({
      pitch: 45,
      bearing: -17,
      zoom: 16.5,
    });
  });

  it("mounts the map controls", () => {
    render(<MapView mapboxToken="tok" flyToTarget={null} />);
    expect(screen.getByTestId("map-controls")).toBeInTheDocument();
  });

  it("fetches approach geometry once and stores it", async () => {
    render(<MapView mapboxToken="tok" flyToTarget={null} />);
    await waitFor(() => {
      expect(useSimulationStore.getState().approaches).toHaveLength(1);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("http://localhost:8000/traffic-lights");
  });

  it("renders the map even when the approach fetch fails", async () => {
    // Signal geometry is decorative and the API may simply not be up yet.
    // First paint must never be blocked on it.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<MapView mapboxToken="tok" flyToTarget={null} />);
    expect(screen.getByTestId("map-stub")).toBeInTheDocument();
    await waitFor(() => {
      expect(useSimulationStore.getState().approaches).toEqual([]);
    });
  });

  it("does not store approaches on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    );
    render(<MapView mapboxToken="tok" flyToTarget={null} />);
    await waitFor(() => {
      expect(useSimulationStore.getState().approaches).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npm test -- map-view`
Expected: FAIL — no `map-controls` test id; `initialViewState` has no `pitch`

- [ ] **Step 3: Rewrite `apps/web/components/MapView.tsx`**

```tsx
"use client";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import Map, { MapRef, useControl } from "react-map-gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer } from "@deck.gl/core";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  buildIncidentLayer,
  buildSignalLayer,
  buildVehicleIconLayer,
} from "../lib/layers";
import { buildSpriteAtlas } from "../lib/car-sprites";
import {
  DEFAULT_VIEW_STATE,
  DEM_SOURCE_ID,
  DEM_SOURCE_URL,
  EXTRUSION_LAYER_ID,
  INITIAL_MAP_STYLE,
  STYLE_URL,
  TERRAIN_EXAGGERATION,
  mapStyleReducer,
  reapplyPlan,
  type Instruction,
} from "../lib/map-style";
import MapControls from "./MapControls";
import { useSimulationStore } from "../lib/store";
import { interpolateVehicles } from "../lib/interpolation";
import type { TrafficLightApproach, VehicleState } from "../lib/types";

// Vehicle ticks arrive over the WebSocket at this cadence (backend default
// `tick_interval = 0.25` seconds, see apps/api Settings); used to pace the
// rAF-driven interpolation between the previous and current tick's positions.
const TICK_DURATION_MS = 250;

// Same hardcoded host as the WebSocket URL and the incidents fetch in
// page.tsx; no env-var indirection exists in this project yet.
const TRAFFIC_LIGHTS_URL = "http://localhost:8000/traffic-lights";

/**
 * Renders deck.gl layers as a native mapbox-gl control (via MapboxOverlay),
 * so the vehicle layer automatically tracks the base map's camera on every
 * pan/zoom/flyTo. A plain `<DeckGL>` nested inside `<Map>` would NOT do this:
 * DeckGL only inherits a parent map's viewport when DeckGL is the outer
 * component (react-map-gl's `<Map>` nested under it); nested the other way,
 * DeckGL renders its own frozen viewport that never follows the base map.
 *
 * MapboxOverlay also survives setStyle(), which is why the deck.gl layers
 * need no part in the style re-application below.
 */
function DeckGLOverlay(props: { layers: Layer[] }) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

export interface MapViewProps {
  mapboxToken: string;
  flyToTarget: { lat: number; lng: number } | null;
}

export default function MapView({ mapboxToken, flyToTarget }: MapViewProps) {
  const mapRef = useRef<MapRef | null>(null);
  const [displayedVehicles, setDisplayedVehicles] = useState<VehicleState[]>([]);
  const [style, dispatch] = useReducer(mapStyleReducer, INITIAL_MAP_STYLE);
  const [buildingsDisabled, setBuildingsDisabled] = useState(false);

  const incidents = useSimulationStore((s) => s.incidents);
  const signals = useSimulationStore((s) => s.signals);
  const approaches = useSimulationStore((s) => s.approaches);
  const setApproaches = useSimulationStore((s) => s.setApproaches);

  // Built once: rasterising 60 cells on every render would thrash the GPU
  // texture upload. Null under SSR and in jsdom, where the layer falls back.
  const sprites = useMemo(() => buildSpriteAtlas(), []);

  useEffect(() => {
    let rafId: number;

    const tick = () => {
      const { vehicles, previousVehicles, lastTickAt } = useSimulationStore.getState();
      const elapsedMs = Date.now() - lastTickAt;
      setDisplayedVehicles(
        interpolateVehicles(previousVehicles, vehicles, TICK_DURATION_MS, elapsedMs)
      );
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafId);
  }, []);

  useEffect(() => {
    // Signal geometry is static, so this runs once. It is also decorative:
    // the API may not be up yet, and first paint must never wait on it.
    let cancelled = false;
    fetch(TRAFFIC_LIGHTS_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data: { approaches: TrafficLightApproach[] }) => {
        if (cancelled || !Array.isArray(data?.approaches)) return;
        setApproaches(data.approaches);
      })
      .catch(() => {
        // Silent on purpose: no signal markers is a degraded map, not a fault.
      });
    return () => {
      cancelled = true;
    };
  }, [setApproaches]);

  useEffect(() => {
    if (flyToTarget && mapRef.current) {
      mapRef.current.flyTo({
        center: [flyToTarget.lng, flyToTarget.lat],
        zoom: 17,
        duration: 2000,
      });
    }
  }, [flyToTarget]);

  /** Executes one instruction from the re-apply plan against the live map. */
  const runInstruction = useCallback((map: mapboxgl.Map, instruction: Instruction) => {
    switch (instruction.op) {
      case "setConfigProperty":
        map.setConfigProperty("basemap", instruction.property, instruction.value);
        break;

      case "addExtrusionLayer": {
        if (map.getLayer(EXTRUSION_LAYER_ID)) break;
        // Classic styles carry building footprints with a `height` property on
        // the composite source. If this style does not, withdraw the toggle
        // rather than throwing.
        if (!map.getSource("composite")) {
          setBuildingsDisabled(true);
          break;
        }
        setBuildingsDisabled(false);
        map.addLayer({
          id: EXTRUSION_LAYER_ID,
          type: "fill-extrusion",
          source: "composite",
          "source-layer": "building",
          filter: ["==", "extrude", "true"],
          minzoom: 14,
          paint: {
            "fill-extrusion-color": "#8d949e",
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-base": ["get", "min_height"],
            "fill-extrusion-opacity": 0.7,
          },
        });
        break;
      }

      case "removeExtrusionLayer":
        if (map.getLayer(EXTRUSION_LAYER_ID)) map.removeLayer(EXTRUSION_LAYER_ID);
        break;

      case "addTerrain":
        if (!map.getSource(DEM_SOURCE_ID)) {
          map.addSource(DEM_SOURCE_ID, {
            type: "raster-dem",
            url: DEM_SOURCE_URL,
            tileSize: 512,
            maxzoom: 14,
          });
        }
        map.setTerrain({ source: DEM_SOURCE_ID, exaggeration: TERRAIN_EXAGGERATION });
        break;

      case "removeTerrain":
        map.setTerrain(null);
        break;
    }
  }, []);

  const applyStyle = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || !map.isStyleLoaded()) return;
    for (const instruction of reapplyPlan(style)) runInstruction(map, instruction);
  }, [style, runInstruction]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    // setStyle() destroys every custom source and layer, so the full plan is
    // replayed on each style load. Map-level listeners survive setStyle, and
    // this handler is the ONLY path that adds these sources and layers --
    // toggling merely changes state and re-runs the same function.
    map.on("style.load", applyStyle);
    applyStyle();
    return () => {
      map.off("style.load", applyStyle);
    };
  }, [applyStyle]);

  return (
    <>
      <MapControls
        state={style}
        dispatch={dispatch}
        buildingsDisabled={buildingsDisabled}
      />
      <Map
        ref={mapRef}
        mapboxAccessToken={mapboxToken}
        initialViewState={DEFAULT_VIEW_STATE}
        mapStyle={STYLE_URL[style.basemap]}
      >
        {/* Signals first (ground furniture), then vehicles, then incidents on
            top so the demo's climax is never occluded by traffic. */}
        <DeckGLOverlay
          layers={[
            buildSignalLayer(approaches, signals),
            buildVehicleIconLayer(displayedVehicles, sprites),
            buildIncidentLayer(incidents),
          ]}
        />
      </Map>
    </>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/web && npm test -- map-view`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the whole frontend suite**

Run: `cd apps/web && npm test`
Expected: PASS. `tests/dashboard-page.test.tsx` is the regression to watch — `MapView` now renders a fragment rather than a single `<Map>`.

- [ ] **Step 6: Typecheck and lint**

Run: `cd apps/web && npx tsc --noEmit && npm run lint`
Expected: no errors. If `mapboxgl.Map` is unresolved in `runInstruction`, add `import type mapboxgl from "mapbox-gl";` at the top.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/MapView.tsx apps/web/tests/map-view.test.tsx
git commit -m "feat(web): tilt the map to 45 degrees and wire sprites, signals and controls

Camera opens at pitch 45 / zoom 16.5 on Mapbox Standard. A single style.load
handler replays the full re-apply plan after every basemap switch, which is
what keeps terrain and the satellite extrusion layer alive across setStyle."
```

---

### Task 14: Manual verification and documentation

**Files:**
- Create: `docs/superpowers/plans/2026-09-14-3d-map-verification.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: the running system from Tasks 1–13.
- Produces: a recorded verification result. No code.

- [ ] **Step 1: Start the stack**

Run: `docker compose up --build`
Open: `http://localhost:3000`
Expected: the map opens tilted, buildings extruded, cars visible as coloured car shapes, coloured posts at intersections.

- [ ] **Step 2: Verify vehicle rotation — the check no unit test can make**

A 90°-off or mirrored `getAngle` passes every test in this plan and still looks plausible in a screenshot. Pick a one-way street in the SoMa grid, zoom to z18, and confirm car noses point the way traffic actually flows.

If they are consistently 90° off, the sprite is drawn nose-right rather than nose-up — fix `drawBody` in `lib/car-sprites.ts`, not `getAngle`.
If they are mirrored front-to-back, the `-` in `getAngle` is wrong.

- [ ] **Step 3: Verify signals**

Watch one intersection for a full cycle. Confirm:
- posts change colour over time
- a cross-street's approaches show the opposite colour at the same instant
- no intersection is uniformly one colour in every phase

- [ ] **Step 4: Verify style switching survives two round trips**

Standard → Satellite → Standard → Satellite, with 3D buildings and Terrain both on throughout. After each switch confirm buildings are still extruded and terrain is still applied. One round trip can pass by luck; two is what catches the lost-sources bug.

- [ ] **Step 5: Verify frame rate**

Open DevTools → Performance, record 10 seconds at pitch 45 / z16.5 with traffic at full volume. Expected: a sustained 30 fps or better.

If it is below that, the first thing to check is whether `buildSpriteAtlas` is being called per render rather than memoised.

- [ ] **Step 6: Verify colours against the day preset**

Existing cyan vehicles and red incident markers were tuned against `dark-v11`. Trigger a collision (`curl -X POST http://localhost:8000/demo/trigger-collision`) and confirm the incident marker still reads clearly against the bright basemap. Record the result; a contrast fix is a follow-up, not part of this slice.

- [ ] **Step 7: Record results**

Create `docs/superpowers/plans/2026-09-14-3d-map-verification.md` with one section per step above: what was checked, pass or fail, and a screenshot reference for steps 2, 3 and 6.

- [ ] **Step 8: Update the README**

Add a "Map controls" subsection documenting the basemap radio and the three toggles, and note that signals come from the network's own `tlLogic` programs rather than any external data source.

- [ ] **Step 9: Run both suites one final time**

Run: `cd apps/api && .venv/bin/pytest -q && cd ../web && npm test && npx tsc --noEmit`
Expected: all PASS

- [ ] **Step 10: Commit**

```bash
git add docs/superpowers/plans/2026-09-14-3d-map-verification.md README.md
git commit -m "docs: record manual verification for the 3D map slice"
```

---

## Self-review

**Spec coverage:**

| Spec requirement | Task |
| --- | --- |
| pyproj replaces `convertGeo`, `always_xy=True` | 1 |
| TraCI subscriptions | 2 |
| `get_traffic_light_approaches()`, stop-line geometry | 3 |
| `TrafficLightApproach` model | 3 |
| `get_traffic_light_states()` | 4 |
| `signals` in the vehicle frame, key absent on failure | 5 |
| Signal failure cannot call `mark_failed()` | 5 |
| Log once, not per tick | 5 |
| `GET /traffic-lights`, 503 when unready | 6 |
| Startup geometry failure caches `[]` and starts anyway | 6 |
| Pre-tinted 3 × 20 atlas, `mask: false` | 7 |
| Stable FNV-1a id hash | 7 |
| Palette excludes red | 7 |
| Atlas null → scatterplot fallback | 7, 8 |
| `getAngle = -heading` | 8 |
| `sizeUnits: meters`, `sizeMinPixels: 14`, `billboard: false` | 8 |
| Sprite keyed off `kind` | 7 (signature), 8 (call site) |
| `ColumnLayer` signals, 8 state chars, most-permissive | 9 |
| Signals retained when the key is absent | 10 |
| Basemap radio, 3 toggles | 11, 12 |
| Two 3D-building implementations | 11 (plan), 13 (interpreter) |
| Terrain DEM at exaggeration 1.5 | 11, 13 |
| `style.load` as the single re-application path | 13 |
| pitch 45 / bearing −17 / zoom 16.5 | 11, 13 |
| Satellite missing `building` → disable toggle | 13 |
| Manual checklist, all 5 items | 14 |

No gaps.

**Placeholder scan:** no TBD, no "add error handling", no "similar to Task N". Every code step carries the actual code.

**Type consistency:** `TrafficLightApproach` fields are identical across `models.py` (Task 3), the route response (Task 6), `types.ts` (Task 9) and every test. `SpriteAtlas` is defined in Task 7 and consumed unchanged in Tasks 8 and 13. `Instruction` is defined in Task 11 and interpreted in Task 13 with all five variants handled. `buildVehicleIconLayer`, `buildSignalLayer`, `approachColor`, `spriteKeyForVehicle`, `buildSpriteAtlas`, `reapplyPlan`, `mapStyleReducer`, `reset_signal_failure_log` are each spelled identically at definition and every call site.
