import { ScatterplotLayer, IconLayer, ColumnLayer } from "@deck.gl/layers";
import type { Texture } from "@luma.gl/core";
import type { Incident, VehicleState, TrafficLightApproach } from "./types";
import { spriteKeyForVehicle, type SpriteAtlas } from "./car-sprites";

export function buildVehicleLayer(vehicles: VehicleState[]) {
  return new ScatterplotLayer({
    id: "vehicles",
    data: vehicles,
    getPosition: (v: VehicleState) => [v.lng, v.lat],
    getRadius: 6,
    // primary-container (#00d2ff) from the "Mission Tactical" design system,
    // so traffic reads as live telemetry against the dark basemap and stays
    // chromatically distinct from the red incident markers.
    getFillColor: [0, 210, 255],
  });
}

/**
 * Incident markers, drawn on top of the vehicle layer. Without these the
 * camera flies to the accident and the operator sees dots identical to every
 * other vehicle -- the visual payoff of the demo's climax. Big, red and
 * white-outlined so it reads instantly on a projector.
 */
export function buildIncidentLayer(incidents: Incident[]) {
  return new ScatterplotLayer({
    id: "incidents",
    data: incidents,
    getPosition: (incident: Incident) => [incident.location.lng, incident.location.lat],
    getRadius: 20,
    radiusMinPixels: 10,
    getFillColor: [230, 40, 40],
    stroked: true,
    getLineColor: [255, 255, 255],
    lineWidthMinPixels: 2,
  });
}

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
    // deck.gl's IconLayer typings only declare `iconAtlas?: string | Texture`,
    // but its runtime "image" prop pipeline (createTexture in
    // @deck.gl/core/lifecycle/prop-types) accepts an HTMLCanvasElement
    // directly and uploads it as a texture. deck.gl's own types are narrower
    // than its runtime here -- this cast bridges that gap without changing
    // the (correct) runtime value. Do NOT "fix" this by converting the
    // canvas to a real Texture; there is nothing to fix.
    iconAtlas: sprites.canvas as unknown as Texture,
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
