# Dispatch dashboard (`apps/web`)

Next.js front end for the 911 Emergency Dispatch Digital Twin. It opens a
WebSocket to the FastAPI backend (`apps/api`), renders live SUMO vehicle
positions over a Mapbox basemap with deck.gl, and lets the operator click an
incident ticket to fly the camera to the accident while background traffic
keeps moving.

See the repo-root `README.md` for the full demo loop and Docker instructions.

## Layout

- `app/page.tsx` — three-pane dashboard (feed / map / detail), owns the WS
  connection and the mount-time `GET /incidents` seed.
- `components/MapView.tsx` — `react-map-gl` map with a `MapboxOverlay`
  hosting the deck.gl vehicle and incident layers.
- `lib/store.ts` — Zustand store fed by the three WS message types
  (`simulation.vehicles`, `incident.created`, `simulation.error`).
- `lib/interpolation.ts` — smooths vehicle motion between ~250 ms ticks.
- `lib/layers.ts` — pure deck.gl layer builders.
- `lib/ws-client.ts` — WebSocket connection with reconnect backoff.

## Local development

```bash
npm install
echo 'NEXT_PUBLIC_MAPBOX_TOKEN=pk.your_token' > .env.local   # or export it
npm run dev        # http://localhost:3000
```

The backend must be running on `http://localhost:8000` for vehicles and
incidents to appear. Without a Mapbox token the basemap renders blank; the
deck.gl layers still draw.

## Commands

```bash
npm test           # Vitest + React Testing Library
npx tsc --noEmit   # type check
npm run lint
npm run build      # production build (inlines NEXT_PUBLIC_* at build time)
```
