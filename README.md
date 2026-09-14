# AI-Powered 911 Emergency Dispatch Digital Twin

A live digital twin of SoMa, San Francisco: a SUMO microscopic traffic
simulation streams vehicle positions over a WebSocket to a Next.js dashboard
that renders them on a Mapbox/deck.gl map. Triggering a deterministic
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

There is a second measured hazard: over 300 ticks from a cold start, the
busiest edge was a *junction-internal* edge (`:<junction>_<n>`) on 46 of them
(~15%). Triggering there succeeds, but it stops a car inside an intersection
on a link a few metres long — no queue, and it reads as a glitch.

So before presenting, pick a **single-lane** edge that carries traffic and
pass it explicitly via the `edge_id` body field. The incident marker and the
camera flyover work either way; the visible queue behind the blockage does
not.
