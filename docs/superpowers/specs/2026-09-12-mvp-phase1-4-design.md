# Design Spec: Sim-to-Dashboard Vertical Slice (MVP Phases 1-4)

**Date**: 2026-09-12
**Status**: Approved for planning
**Parent brief**: AI-Powered 911 Emergency Dispatch Digital Twin (CalHacks 13.0)

## Goal

Prove the smallest coherent loop end-to-end before adding dispatch, AI voice, or event
streaming:

```
SUMO (headless traffic sim)
  -> FastAPI WebSocket
  -> Next.js / Mapbox / deck.gl visualization
  -> deterministic collision trigger
  -> incident ticket appears on dashboard
  -> operator clicks ticket
  -> camera flies to accident
  -> background traffic keeps moving throughout
```

No dispatch engine, no Gemini/voice, no Kafka/Redpanda, no Postgres. Those are later
phases (5-8) in the parent brief and get their own specs.

## Out of scope (explicitly deferred)

- Responder units, stations, facilities, dispatch logic
- Gemini voice / AI copilot / tool calling
- Kafka / Redpanda domain events
- Postgres / PostGIS persistence
- Incident clearing / recovery UX (hook exists in simulator, unused here)
- GLB vehicle models (dots/icons only)
- Playwright E2E (deferred to a later slice once UI stabilizes)

## Repo Layout

```
dispatch-digital-twin/
├── apps/
│   ├── web/                    # Next.js, TS, Tailwind
│   │   ├── app/
│   │   ├── components/         # MapView, IncidentFeed, IncidentToast
│   │   └── lib/                 # ws client, types, interpolation
│   └── api/                     # FastAPI
│       ├── app/
│       │   ├── api/             # routes: /ws/simulation, /demo/trigger-collision, /incidents
│       │   ├── simulation/      # SUMO/TraCI package
│       │   ├── incidents/       # incident state + notify
│       │   └── main.py
│       └── tests/
├── infrastructure/
│   └── docker/
├── docker-compose.yml            # services: web, api
└── .env.example
```

Two containers only: `web` (:3000) and `api` (:8000, runs the SUMO subprocess
internally). No `simulator`, `postgres`, or `redpanda` services yet.

`app/simulation/` is self-contained: exposes `SimulationRunner` with `start()`,
`tick()`, `get_vehicle_states()`, `trigger_collision(edge_id)`. Nothing outside this
package calls TraCI directly — routes only call `SimulationRunner`.

## Simulation Layer (SUMO/TraCI)

**Network**: SoMa core, roughly 4th/5th/6th St x Market/Howard/Folsom/Harrison (~25-30
blocks). Build via `netconvert` from an OSM extract of that bbox (osmwebwizard or a
manual `.osm.net.xml.gz` download). Network must be built with proper geo-referencing
(e.g. `--proj.utm`) so `traci.simulation.convertGeo` round-trips correctly to WGS84 —
verify this at network-build time.

**Background traffic**: `randomTrips.py` generates a continuous flow of civilian
vehicles (type `car`) with a period (~1 vehicle every 2-4s per entry edge) so streets
stay populated without hand-authored routes.

**Runner** (`app/simulation/runner.py`):
- Launches `sumo` (headless, not `sumo-gui`) as a subprocess, connects via
  `traci.start()`.
- Background asyncio task: loop of `traci.simulationStep()` -> broadcast ->
  `asyncio.sleep(tick_interval)`. Tick interval ~0.2-0.3s wall-clock; SUMO step length
  stays 1s sim-time (decoupled from wall clock for demo pacing).
- `get_vehicle_states()` returns `[{id, lat, lng, heading, speed, kind}]` via
  `traci.vehicle.getPosition()` + `convertGeo`.

**Collision mechanics** (deterministic, not SUMO's native collision detection):
- `trigger_collision(edge_id)` picks two vehicles on/near `edge_id` (or spawns two
  dedicated ones), forces `traci.vehicle.setSpeed(veh_id, 0)` plus a long-duration
  `traci.vehicle.setStop(...)` on that lane.
- The blocked lane + SUMO's existing car-following model produces realistic queuing
  behind it for free — no fake collision physics needed.
- On trigger, the runner emits an in-process incident event (callback/queue) that the
  `incidents` package turns into an `INC-xxxx` record.
- Clearing (`setSpeed(veh_id, -1)` + stop removal) is not exercised in this slice but
  the hook exists for a later phase.

## Backend API & Data Contracts

**Endpoints**:
- `WS /ws/simulation` — server pushes state every tick after connect.
- `POST /demo/trigger-collision` — body `{edge_id?: string}` (server picks a busy edge
  if omitted). Triggers `runner.trigger_collision()`, creates an incident record,
  returns `{incident_id}`. 400 if the target edge has no vehicles present.
- `GET /incidents` — list current incidents (in-memory).
- `GET /incidents/{id}` — single incident detail.

**WS message types** (JSON, tagged by `type`):

```json
{"type": "simulation.vehicles", "tick": 4821, "vehicles": [
  {"id": "car-101", "lat": 37.7765, "lng": -122.3946, "heading": 91, "speed": 10.4, "kind": "civilian"}
]}
```

```json
{"type": "incident.created", "incident": {
  "id": "INC-1042", "kind": "collision", "severity": "HIGH",
  "location": {"lat": 37.7765, "lng": -122.3946, "edge_id": "..."},
  "vehicles_involved": ["car-101", "car-204"], "created_at": "..."
}}
```

```json
{"type": "simulation.error", "message": "..."}
```

Only these three message types for this slice. `incident.cleared` is deferred.

**Incident state**: plain in-memory `dict[str, Incident]` in `app/incidents/`, guarded
by an asyncio lock (both the trigger route and the tick loop touch it). Pydantic
models only — no SQLAlchemy/Alembic/Postgres in this slice.

**Error handling**: if the TraCI subprocess dies, `/ws/simulation` keeps accepting
connections and sends `simulation.error` instead of hanging the socket.

## Frontend

**Stack**: Next.js + TS, `react-map-gl` (Mapbox base), `deck.gl` for vehicle
rendering, Zustand for WS-driven state, Tailwind + shadcn/ui for panels.

**Rendering**:
- `MapView`: `react-map-gl` `<Map>` bounded on the SoMa bbox; `deck.gl`
  `ScatterplotLayer`/`IconLayer` driven by the `vehicles` array in the WS store. Dots
  or simple glyphs only — no GLB models in this slice.
- Interpolation: WS ticks arrive ~200-300ms apart; frontend linearly interpolates each
  vehicle's position between its last two known points on every animation frame so
  motion isn't stepped.
- `IncidentToast`: on `incident.created`, show a toast/banner (🔔 NEW INCIDENT
  INC-xxxx ...) and push into `IncidentFeed`.
- Click ticket -> `mapRef.current.flyTo({center, zoom, duration: 2000})`. The vehicle
  layer keeps re-rendering off the same WS stream throughout — flyTo only moves the
  camera, never pauses the tick loop or WS connection.

**Layout** (subset of brief section 9): left = incident feed, center = map, right =
incident detail (static fields only — no AI copilot in this slice).

**Frontend error handling**: WS reconnect with backoff on drop; `simulation.error`
renders a dismissible banner; map keeps last-known vehicle positions frozen rather
than clearing them on disconnect.

## Testing

- `apps/api/tests` (pytest): `SimulationRunner` unit tests against a small fixture
  SUMO network (a handful of edges), not the full SoMa net, so tests run fast without
  the real OSM extract. Key case: `trigger_collision` blocks the edge and a following
  vehicle's speed drops to 0 within N steps.
- WS contract test: `starlette`/`httpx` TestClient WS session asserts
  `simulation.vehicles` frames are well-formed and Pydantic-validated.
- `apps/web` (Vitest): pure-function tests on the WS store/interpolation logic — feed
  fake ticks, assert interpolated position.
- Playwright deferred to a later slice once the UI is stable.
- No assertion on exact traffic-jam timing/shape — only that the block happens and
  following vehicles react; the qualitative jam is observed in the live demo, not unit
  tested.

## Docker Compose (this slice)

Two services: `web`, `api`. `api`'s image includes the `sumo` binary. No `postgres` /
`redpanda` services until later phases.

## Open items intentionally deferred to later specs

- Exact SoMa bbox coordinates (pick concrete lat/lng bounds during implementation,
  verify road geometry visually before building the network)
- Incident clearing UX
- Dispatch, Gemini, Kafka (phases 5-8)
