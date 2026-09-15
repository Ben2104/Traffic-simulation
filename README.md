# AI-Powered 911 Emergency Dispatch Digital Twin

A live digital twin of SoMa, San Francisco: a SUMO microscopic traffic
simulation streams vehicle positions over a WebSocket to a Next.js dashboard
that renders them on a Mapbox map (vehicles as a native Mapbox layer,
signals and incidents via deck.gl). Triggering a deterministic
collision blocks a lane, creates an incident ticket, and pushes it to the
operator's feed; clicking the ticket flies the camera to the accident while
background traffic keeps moving the whole time. Two services, `api`
(FastAPI + TraCI) and `web` (Next.js), with an in-memory incident store.

## Prerequisites

- Docker + Docker Compose (for the containerised run), or
- Python 3.12+ and Node 20+ (for local dev)
- A Mapbox access token (`pk....`) — without it the basemap renders blank

## Run with Docker Compose

Next.js inlines `NEXT_PUBLIC_*` variables at **build** time, so the Mapbox
token must be present when the image is built, not just when it runs.

```bash
cp .env.example .env          # then put your real token in .env
docker compose build          # reads NEXT_PUBLIC_MAPBOX_TOKEN from .env
docker compose up
```

- Dashboard: <http://localhost:3000>
- API: <http://localhost:8000> (`/incidents`, `/ws/simulation`)

`docker compose down` when you're finished.

## Map controls

The panel in the top-right corner of the map controls how the basemap is
drawn. Nothing in it touches the simulation — it is purely how the world is
rendered.

**Basemap** (radio, pick one):

| Option | Style | Notes |
| --- | --- | --- |
| Standard | `mapbox://styles/mapbox/standard` | Default. Draws lane markings, crosswalks, turn arrows and 3D trees from about z16. |
| Satellite | `mapbox://styles/mapbox/satellite-streets-v12` | Classic style: imagery plus road labels. |

**Layers** (independent toggles):

- **3D Buildings** — on by default. The two basemaps implement this in
  completely different ways: Standard owns its buildings, so the toggle sets
  the `show3dObjects` style config property; `satellite-streets-v12` has no
  config properties, so the toggle adds or removes a `fill-extrusion` layer
  built from the `composite` source's `building` layer. The checkbox disables
  itself if a loaded classic style turns out to carry no building geometry.
- **Terrain** — off by default. Adds the `mapbox-dem` raster-DEM source and
  applies it at 1.5× exaggeration. SoMa is close to flat, so the effect is
  subtle; it is most visible looking south towards Potrero Hill.
- **Night** — off by default, and only shown on Standard. It switches the
  style's `lightPreset` between `day` and `night`. Light presets are a
  Standard-style feature, so the control is withdrawn rather than left inert
  when Satellite is selected.

`map.setStyle()` destroys every custom source and layer, so switching the
basemap would otherwise silently drop terrain and the extrusion layer. The
toggle state is therefore kept in a pure reducer (`apps/web/lib/map-style.ts`)
that produces a *complete* instruction list — never a delta — which a single
`style.load` handler in `MapView` replays after every style change.

### Where the traffic lights come from

The coloured posts at intersections are **not** external map data. Mapbox
publishes no traffic-signal dataset — `mapbox-traffic-v1` carries congestion
on road lines and nothing else. The signals come from the SUMO network's own
`tlLogic` programs (51 of them across 112 signalised junctions in the SoMa
net): the backend reads each junction's controlled links, projects the
stop-line position of every incoming lane to WGS84, and streams the live
red/yellow/green state alongside the vehicle positions on each tick. So the
phases you see are the ones the simulation is actually obeying.

Signal state is cosmetic by design. If the traffic-light read fails, the
`signals` key is omitted from the frame, the frontend keeps the last known
phases, and vehicle rendering and the connection banner are unaffected.

### Why vehicles are plain dots, not rotated car icons

deck.gl's `MapboxOverlay` does not render in this stack: `gl.readPixels()`
called from inside deck's own `onAfterRender` hook reads back a fully
transparent framebuffer every frame, despite deck's internal metrics
reporting successful draws (`drawLayersCount`, `framesRedrawn` both healthy)
and zero WebGL errors. Reproduced identically for `IconLayer` and
`ScatterplotLayer`, in both `MapboxOverlay` "overlaid" and "interleaved"
modes. Mapbox's own rendering — including a native `circle` layer fed the
same coordinates — works correctly throughout, which is why vehicles render
as a Mapbox GeoJSON source/layer (`apps/web/components/MapView.tsx`) instead.
The pre-tinted sprite atlas and rotated `IconLayer` (`lib/car-sprites.ts`,
`buildVehicleIconLayer` in `lib/layers.ts`) are unused as of this fix, kept
in case the underlying deck.gl defect gets resolved upstream. Signals still
render through deck.gl's `ColumnLayer` and are suspected to carry the same
defect — unconfirmed. See
`docs/superpowers/plans/2026-09-14-3d-map-verification.md` for the full
investigation.

## Local development

Backend:

```bash
cd apps/api
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

SUMO ships as a Python wheel (`eclipse-sumo`), so no separate SUMO install is
needed — but the `sumo` console script lands in `.venv/bin`, which means the
venv must be on `PATH`.

Frontend:

```bash
cd apps/web
npm install
echo 'NEXT_PUBLIC_MAPBOX_TOKEN=pk.your_token' > .env.local
npm run dev                   # http://localhost:3000
```

## Tests

```bash
cd apps/api && .venv/bin/pytest -q     # pytest + pytest-asyncio (~20s, starts real SUMO)
cd apps/web && npm test                # Vitest + React Testing Library
```

The backend suite runs with or without the venv activated
(`apps/api/tests/conftest.py` puts the running interpreter's `bin` directory
on `PATH`). Playwright is deliberately deferred.

## Trigger a collision

```bash
curl -X POST http://localhost:8000/demo/trigger-collision
# -> {"incident_id":"INC-1001"}
```

With an explicit edge:

```bash
curl -X POST http://localhost:8000/demo/trigger-collision \
  -H 'Content-Type: application/json' -d '{"edge_id":"YOUR_EDGE_ID"}'
```

Returns 400 if the target edge has no vehicles, or none that can brake to a
stop before the lane ends.

### Pick your demo edge deliberately

**Don't rely on `pick_busy_edge()` for the live demo.** Measured on the real
SoMa network: it lands on a *multi-lane* edge about 66% of the time, and the
collision only blocks lane 0 — traffic simply routes around through the open
lanes and no jam forms. Even on a single-lane edge the queue tops out at
roughly 3–4 halting vehicles.

`pick_busy_edge()` also skips junction-internal edges (ids starting with
`:`), so it will never hand `trigger_collision` a few-metres-long internal
link to stop a car on. (It used to: measured over 300 ticks from a cold
start, the busiest edge was junction-internal on 46 of them, ~15% — that
path is closed now.)

The remaining, still-accurate caveat is the multi-lane one above: a random
busy edge is multi-lane about two-thirds of the time, and blocking just lane
0 of a multi-lane arterial will not produce a big jam — traffic routes
around through the open lanes. So before presenting, pick a **single-lane**
edge that carries traffic and pass it explicitly via the `edge_id` body
field. The incident marker and the camera flyover work either way; the
visible queue behind the blockage does not.
