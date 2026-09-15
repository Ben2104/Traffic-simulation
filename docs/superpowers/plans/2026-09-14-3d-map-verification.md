# 3D Map Slice — Manual Verification

Verification run against the Docker Compose stack (`docker compose up --build`,
web on `:3000`, api on `:8000`) on 2026-09-15, after the vehicle-rendering fix
described below.

## Known deviation from the plan: vehicles are not deck.gl icons

The original plan (Tasks 7-8) called for vehicles rendered as pre-tinted,
rotated car icons via a deck.gl `IconLayer`. During this verification pass,
vehicles were found not to render at all — confirmed with `gl.readPixels()`
called from inside deck.gl's own `onAfterRender` hook: correct viewport,
correct framebuffer, zero WebGL errors, deck's internal metrics reporting
successful draws every frame (`drawLayersCount: 3`, `framesRedrawn`
incrementing at 60/s), and the buffer still came back 100% transparent. This
reproduced identically for `IconLayer` and the `ScatterplotLayer` fallback, in
both `MapboxOverlay` "overlaid" and "interleaved" modes. A manual WebGL
triangle drawn to the same context via the same `readPixels` call rendered
correctly, ruling out a measurement error. Mapbox's own rendering (buildings,
tiles, and a native `circle` layer fed the same vehicle coordinates) rendered
correctly throughout.

**Fix:** vehicles now render as a native Mapbox GL `circle` layer — a
GeoJSON source updated via `source.setData()` every animation frame, with the
source/layer re-added on `style.load` (the same pattern already used for the
extrusion and terrain layers, since `setStyle()` destroys custom sources).
See `apps/web/components/MapView.tsx`.

**Consequence:** vehicles are plain dots with no heading indicator. `getAngle`
and the sprite atlas (`lib/car-sprites.ts`, `buildVehicleIconLayer`) are
unused dead code as of this fix, left in place in case deck.gl's defect gets
fixed upstream. Signals still render through deck.gl's `ColumnLayer` and are
suspected to carry the same defect — not confirmed either way, out of scope
for this fix.

## Step 1 — Start the stack

**Pass.** `docker compose up --build`, opened `http://localhost:3000`. Map
opens tilted (pitch 45°), buildings extruded, cars visible as cyan dots,
coloured posts at intersections.

## Step 2 — Verify vehicle rotation

**N/A — spec deviation.** Vehicles are circles, not rotated icons, as of the
fix above. There is no heading cue to verify. If heading needs to come back,
the path is a native Mapbox `symbol` layer with `icon-rotate` bound to
vehicle heading, not deck.gl.

## Step 3 — Verify signals

**Pass.** Watched the Harrison St / Shipley St intersection. At any given
instant, one approach's posts show red while the cross-street's show green —
confirmed both visually and by diffing two `signals` frames pulled over the
WebSocket 15 seconds apart: 24 of 58 traffic-light clusters changed state in
that window (e.g. `rrrrrrrGGGGGrrrrrrrr` → `GGGGGGGrrrrrrrrrrrrr`). No
intersection was uniformly one colour in any observed frame.

## Step 4 — Verify style switching survives two round trips

**Pass.** With 3D Buildings and Terrain both on: Standard → Satellite →
Standard → Satellite. After each switch, buildings stayed extruded and
terrain stayed applied — confirmed by screenshot after every leg of both
round trips. Vehicles and signals kept rendering across every switch too
(not a plan requirement, but worth noting since they use different code
paths — native Mapbox layer vs. deck.gl `MapboxOverlay`, both survive
`setStyle()` for different reasons: the vehicle source/layer replay on
`style.load` same as buildings/terrain, deck.gl's overlay lives outside the
style entirely).

## Step 5 — Verify frame rate

**Pass.** Measured via `requestAnimationFrame` sampling over a 10-second
window at pitch 45° / zoom 16.5 with ~300 vehicles active: 601 frames in
10009 ms — **60.0 fps sustained**, well above the 30 fps floor.

## Step 6 — Verify colours against the day preset

**Pass.** Triggered `POST /demo/trigger-collision` (`INC-1001`). The incident
marker — solid red, white outline — reads clearly against the Standard
basemap's light/day colours; zoomed screenshot confirms strong contrast
against both roads and building fill. No contrast fix needed.

## Step 7 — Record results

This document.

## Step 9 — Run both suites

- `cd apps/api && .venv/bin/pytest -q` → **79 passed**
- `cd apps/web && npm test -- --run` → **98 passed** (12 files)
- `cd apps/web && npx tsc --noEmit` → clean
- `cd apps/web && npm run lint` → clean (one pre-existing warning:
  unused `_kind` param in `lib/car-sprites.ts`, unrelated to this change)

## Outcome

Slice verified working end-to-end with one recorded deviation (vehicles are
dots, not rotated icons) driven by a deck.gl rendering defect discovered
during this pass, not by the original plan. Task 14 complete.
