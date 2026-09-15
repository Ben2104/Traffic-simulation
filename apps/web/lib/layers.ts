import { ScatterplotLayer, IconLayer } from "@deck.gl/layers";
import type { Texture } from "@luma.gl/core";
import type { Incident, VehicleState } from "./types";
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
    // directly and uploads it as a texture -- this cast bridges that typing
    // gap without changing the (correct) runtime value.
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
