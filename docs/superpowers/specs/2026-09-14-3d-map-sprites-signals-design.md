# 3D Map, Car Sprites, and Traffic Signals — Design

Date: 2026-09-14
Status: Approved (design); implementation plan not yet written
Scope: Slice A+B+C of a five-slice program (see "Program context")

## Problem

The dashboard renders vehicles as identical flat cyan dots on a top-down `dark-v11`
basemap. An operator cannot tell one vehicle from another, cannot see the signal
state at any intersection, and has no depth cues to navigate by. The upcoming
red-light-running collision scenario is unreadable without visible signals: a car
running a red looks exactly like a car driving through a green.

## Program context

This design covers the first of five slices. The others are specified separately
and are out of scope here:

| Slice | Contents | Status |
| --- | --- | --- |
| **A+B+C** | 3D camera, basemap switcher, car sprites, traffic signals | **this document** |
| D | Real red-light-running collisions in SUMO | not started |
| E | Manual dispatch (facilities, routing, emergency units) | not started |

Two decisions here exist to serve later slices and must not be optimized away:

- Vehicle sprite selection keys off the existing `VehicleState.kind` field, so
  police/ambulance/fire liveries drop in during slice E without layer changes.
- The civilian color palette excludes red and red/white/blue, reserving them for
  emergency liveries.

## Non-goals

- Elevated road geometry. `soma.net.xml` contains 13,974 lane shapes and **zero**
  carry a z-coordinate. The network is flat. Viaducts and grade separation are
  not achievable and are not attempted.
- Rendering our own lane ribbons from `net.xml`. Mapbox Standard's painted lane
  markings are cartography derived from Mapbox's road model, not from our SUMO
  network, and the two will disagree on some edges. Accepted as a known
  cosmetic mismatch; see "Known limitations".
- Live real-world traffic data. The `mapbox-traffic-v1` tileset contains only
  line-geometry congestion (`class`, `structure`, `congestion`, `closed`) and no
  intersection-control data of any kind. It is also live real-world data, which
  would visually contradict the simulated vehicles drawn on top of it.

## Facts established from the codebase

These were measured, not assumed, and the design depends on them.

- `networks/soma/soma.net.xml` contains **51 `<tlLogic>` programs** across **112
  junctions** of `type="traffic_light"`. Real SF intersections with real phase
  timing, already simulating. No synthetic signals are needed.
- Drivable multi-lane geometry already exists: of 384 `highway.secondary` edges,
  **289 have 2 or more lanes** (up to 6). SUMO already positions vehicles at the
  correct lateral offset within the correct lane.
- The net's projection is `+proj=utm +zone=10 +ellps=WGS84 +datum=WGS84 +units=m`
  with `netOffset="-551766.43,-4180641.21"`.
- Installed: `mapbox-gl@3.30.0` (Standard style and `setConfigProperty`
  available), `@deck.gl/layers@9.4.0`, `pyproj 3.8.0`, `sumolib 1.27.1`.
- `apps/api/app/simulation/runner.py:67` performs `1 + 4N` TraCI round-trips per
  tick. At 200 vehicles and a 0.25 s tick that is roughly **3,200 socket
  round-trips per second** before this slice adds anything.

## Architecture

### Data flow

Traffic light data splits by lifetime:

- **Geometry is static.** Computed once after `runner.start()`, cached, served
  from `GET /traffic-lights`.
- **State is dynamic.** Carried inside the existing `simulation.vehicles`
  WebSocket frame as a new `signals` field.

`signals` rides in the vehicle frame rather than a separate frame type so signal
state stays atomically in sync with the vehicle positions of the same tick. A
separate frame would introduce a skew the interpolator would have to reconcile,
for no benefit.

### Backend changes

**`apps/api/app/simulation/runner.py`**

Two new methods:

- `get_traffic_light_approaches() -> list[TrafficLightApproach]` — called once
  after `start()`, result cached on the runner. For each id from
  `traci.trafficlight.getIDList()`, `getControlledLinks(id)` returns a list
  index-aligned with that TLS's state string. Group those indices by incoming
  lane. Position each group at `traci.lane.getShape(lane)[-1]` (the stop line).
  Derive a bearing from the last two points of the lane shape.
- `get_traffic_light_states() -> dict[str, str]` — `{tls_id:
  getRedYellowGreenState(tls_id)}`, called per tick.

**Performance rewrite** (in scope, because this slice modifies this code and
raises its per-tick budget):

1. **TraCI subscriptions.** Subscribe once per entity via
   `traci.vehicle.subscribe()` and `traci.trafficlight.subscribe()`, then read
   one `getAllSubscriptionResults()` per step. Collapses `4N` calls to roughly 1.
   New vehicles are subscribed as they appear in
   `traci.simulation.getDepartedIDList()`.
2. **Drop `convertGeo`.** Build a `pyproj.Transformer` once at `start()` from the
   net's `projParameter`, and transform `(x - netOffset_x, y - netOffset_y)`
   in-process. Removes one round-trip per vehicle per tick.

`pyproj.Transformer.from_crs(..., always_xy=True)` is **mandatory**. pyproj 2+
honors CRS axis order, so EPSG:4326 returns `(lat, lon)` without it — a silent
coordinate swap that puts every vehicle in the Indian Ocean.

**`apps/api/app/simulation/models.py`** — add:

```python
class TrafficLightApproach(BaseModel):
    tls_id: str
    lane_id: str
    link_indices: list[int]
    lat: float
    lng: float
    heading: float
```

**`apps/api/app/api/frames.py`** — `vehicle_frame(tick, vehicles, signals=None)`
includes `"signals"` only when signals were read successfully. The key is absent,
not null, on failure.

**`apps/api/app/api/traffic_lights.py`** (new) — `GET /traffic-lights` returning
`{"approaches": [...]}`; 503 when the runner is unconfigured.

**`apps/api/app/simulation/loop.py`** — read signal state inside `tick_once`,
wrapped in its own `try`, so a signal failure degrades the frame instead of
reaching the outer handler that calls `mark_failed()`.

### Frontend changes

| File | Change |
| --- | --- |
| `lib/map-style.ts` | new — basemap + toggle state as a pure reducer, and the re-apply instruction list a style change produces |
| `lib/car-sprites.ts` | new — SVG sources, atlas rasterization, stable id→cell hash |
| `lib/layers.ts` | add `buildVehicleIconLayer`, `buildSignalLayer` |
| `lib/types.ts` | add `TrafficLightApproach`; add `signals?` to the vehicles frame |
| `lib/store.ts` | add `signals: Record<string, string>`, `approaches: TrafficLightApproach[]` |
| `components/MapControls.tsx` | new — basemap radio, `[3D buildings]` `[Terrain]` `[Night]` toggles |
| `components/MapView.tsx` | camera defaults, style wiring, `style.load` re-application |

## Rendering

### Camera

`initialViewState`: `pitch: 45`, `bearing: -17`, `zoom: 16.5`.

Zoom 16.5 rather than 15.5 because Mapbox Standard's detailed road rendering —
lane markings, crosswalks, turn arrows, 3D trees — only appears around z16+. The
tradeoff is roughly four blocks of view instead of the whole SoMa grid; accepted.

The existing incident `flyTo` retains current pitch and bearing by default and
needs no change.

### Basemap and toggles

- **Basemap radio:** Standard (`mapbox://styles/mapbox/standard`) | Satellite
  (`mapbox://styles/mapbox/satellite-streets-v12`). Default is Standard.
- **`lightPreset`:** `day` by default, `night` available via a toggle. This
  changes the default look from today's `dark-v11` and is deliberate — `day` is
  where Standard's road detail is most legible.
- **`[3D buildings]`** requires **two implementations behind one toggle**:
  - Standard: `map.setConfigProperty('basemap', 'show3dObjects', bool)`. A custom
    extrusion layer cannot be added to Standard; it does not expose its source
    schema.
  - Satellite: a manual `fill-extrusion` layer on source `composite`,
    source-layer `building`, filtered to `['==', 'extrude', 'true']`, height from
    the `height` property.
- **`[Terrain]`:** `mapbox://mapbox.mapbox-terrain-dem-v1` as a `raster-dem`
  source at `tileSize: 512`, applied with `setTerrain({ exaggeration: 1.5 })`.
  SoMa is flat; this is expected to be subtle.

### Style reload

`map.setStyle()` destroys every custom source and layer. The DEM source,
`setTerrain`, and the satellite extrusion layer must all be re-added after each
basemap switch.

A single persistent `map.on('style.load', ...)` handler re-applies all of them
from current toggle state. Map-level listeners survive `setStyle`; sources and
layers do not. **This handler is the only code path that adds these sources and
layers** — toggle handlers mutate state and, if the style is already loaded,
invoke the same re-application function.

`MapboxOverlay` (deck.gl mounted as a native map control) also survives
`setStyle`, so the vehicle, incident, and signal layers need no special handling.

### Car sprites

Three SVG bodies authored in-repo — `sedan`, `suv`, `truck` — drawn top-down and
nose-up, rasterized to ~64×128 px atlas cells.

**Pre-tinted atlas.** At mount, rasterize 3 bodies × 20 palette colors = 60 cells
into an offscreen canvas. Icons are declared `mask: false` and `getIcon` selects a
cell. deck.gl's `getColor` only tints icons declared `mask: true`, and a masked
icon renders as a flat silhouette, losing windshield and light detail. Pre-tinting
keeps the detail in a single draw call, and — decisively — emergency liveries in
slice E are pre-colored and must not be tinted at all; they become additional
`mask: false` cells in the same atlas under one uniform pipeline.

Layer configuration:

- `sizeUnits: 'meters'`, `getSize: 4.5` (10 for truck-class bodies)
- `sizeMinPixels: 14` — a real 4.5 m car is about 2 px at z15; without the floor
  vehicles vanish when the operator zooms out
- `billboard: false` — icons lie in the ground plane and stay correct under pitch
- `getAngle: -heading` — deck.gl's angle is counter-clockwise degrees, SUMO's
  `getAngle()` is clockwise from north

**Assignment is a stable FNV-1a hash of `vehicle.id`** → palette index and body
index. This is load-bearing, not cosmetic: re-randomizing per frame produces a
flickering disco. The palette excludes red and red/white/blue.

### Traffic signals

`ColumnLayer`, not `ScatterplotLayer`. A flat dot is nearly invisible at 45°
pitch; a roughly 1.5 m radius, 4 m tall colored post standing at the stop line
reads instantly in a pitched view and needs no atlas. Roughly 400–800 columns.

State character → color, per SUMO's signal alphabet:

| chars | color |
| --- | --- |
| `r`, `s` | red |
| `y`, `u` | amber |
| `g`, `G` | green |
| `o`, `O` | gray (off) |

An approach owns several link indices. **Most-permissive wins**: any green →
green, else any amber → amber, else red. This matches the only question the
marker answers — "can traffic from this lane move?" Aggregation happens on the
frontend; the backend emits raw indices.

## Error handling

**Governing rule: signals are cosmetic and must never be able to stop traffic.**
`loop.py:36` currently catches any exception from a tick and calls
`runner.mark_failed()` permanently. A signal read inside that path would let one
bad TLS call kill the simulation for the session.

### Backend

| Failure | Handling |
| --- | --- |
| `get_traffic_light_states()` raises mid-tick | Caught inside `tick_once`. Omit `signals` from the frame, log once rather than per tick. Runner stays running. |
| TLS geometry computation fails at startup | Log, cache an empty list, start anyway. Map renders without signal columns. |
| `GET /traffic-lights` before the runner is ready | 503. Frontend retries with backoff and renders the map meanwhile; first paint is never blocked. |
| Subscription result missing an entity | The vehicle departed between subscribe and read. Skip it. |

### Frontend

| Failure | Handling |
| --- | --- |
| Atlas rasterization fails (no `<canvas>`: SSR, jsdom) | Fall back to the existing `ScatterplotLayer`. This fallback is also what makes the layer unit-testable under jsdom. |
| 3D toggle flipped while `setStyle` is in flight | Guard on `map.isStyleLoaded()`; the `style.load` handler re-applies. |
| DEM tiles fail to load | Mapbox fires `error`; terrain is silently absent. Non-fatal, surfaced in `StatusBar`. |
| `signals` absent from a frame | Retain previous state. Do not clear to gray — a one-frame blackout across 800 columns is worse than briefly stale data. |
| Satellite lacks a `building` source-layer | Probe at style load. If absent, disable the 3D-buildings toggle on Satellite with a tooltip rather than throwing. |

## Testing

### Backend — pytest, existing `apps/api/tests/` layout

- `simulation/test_projection.py` — transform real SoMa net coordinates with
  pyproj and assert agreement with `traci.simulation.convertGeo` to **within
  0.1 m**. This is the only test proving the performance rewrite did not move
  every vehicle. Real-network tests are an established pattern here
  (`test_soma_network.py`).
- `simulation/test_traffic_lights.py` — approach grouping: given fake
  `getControlledLinks` output, link indices group correctly by incoming lane, and
  the stop-line position is the last point of the lane shape.
- `simulation/test_loop.py` (extend) — **regression: a signal-read failure does
  not call `mark_failed()` and does not stop vehicle frames.**
- `api/test_frames.py` (extend) — `vehicle_frame` carries `signals`; the key is
  absent when the read failed.
- `api/test_traffic_lights_routes.py` — 200 response shape; 503 when the runner is
  unconfigured.

### Frontend — vitest + jsdom, existing `apps/web/tests/`

- `layers.test.ts` (extend) — `getAngle === -heading`; all eight SUMO state
  characters map to the correct color; most-permissive aggregation across an
  approach's link indices.
- `car-sprites.test.ts` — hash **stability** (same id yields the same cell across
  calls — this is what prevents the flickering-disco bug) and spread across all
  20 colors over 1,000 ids.
- `map-style.test.ts` — pure reducer: basemap and toggle transitions, and that a
  basemap change emits the correct re-apply instruction list.
- `store.test.ts` (extend) — `signals` updates on vehicle frames; approaches are
  set once.
- `map-controls.test.tsx` — React Testing Library: toggles dispatch correct state.

### Manual verification checklist

WebGL rendering, real `setStyle` behavior, terrain, and frame rate cannot be
tested under jsdom. These are verified by hand:

1. **Car noses point along the direction of travel on a known one-way street.**
   Non-negotiable — a 90°-off or mirrored rotation passes every unit test and
   still looks plausible in a screenshot.
2. Signals change color over time, and cross-streets show opposing states at the
   same instant.
3. All four basemap × toggle combinations render correctly **after two
   consecutive style switches** — two is what catches the lost-sources bug.
4. Frame rate at pitch 45 / z16.5 under full vehicle load.
5. Cyan vehicles and red incident markers still read against the `day` preset.
   The existing colors were tuned against `dark-v11`.

## Known limitations

- **Painted lanes will not always match driven lanes.** Mapbox Standard's lane
  markings come from Mapbox's road model; SUMO's lanes come from the OSM `lanes`
  tag as compiled into `net.xml`. A vehicle correctly in SUMO lane 2-of-3 will
  sometimes straddle a painted line. Fixing this requires rendering lane ribbons
  from `net.xml` geometry, which is out of scope.
- **Sprite detail is largely invisible at render size.** At `sizeMinPixels: 14`,
  vehicles occupy roughly 14–40 px. Silhouette and dominant color carry the
  distinction; fine detail does not survive. This constrains slice E: emergency
  units are distinguishable by silhouette and livery block, not by markings.
- **Street names are not in the network.** `net.xml` was generated without
  `--output.street-names`, so edges carry no `name` attribute. Slice E cannot
  reference streets by name without regenerating the network or joining back to
  `soma.osm`.
- **Terrain will be subtle.** SoMa within the bbox is essentially flat.

## Asset licensing

The emergency-vehicle artwork supplied for slice E is not yet usable:

- The **ambulance** image is a watermarked Pixta preview ("PIXTA" rendered across
  the body panel, stock id 58052445). It cannot be committed or shipped. A
  licensed file is required.
- The **police car** image carries no visible watermark, but its provenance is
  unconfirmed. Source and license must be established before use.
- The **fire truck** image appears clean.

All three require white-background removal and nose-up orientation normalization:
the police car is already nose-up; the ambulance is landscape with its front
facing left and needs +90°; the fire truck's cab is at the bottom and needs 180°.
These orientations are inferred from the images and must be confirmed visually.

Civilian sprites are authored in-repo as SVG and carry no licensing question.
