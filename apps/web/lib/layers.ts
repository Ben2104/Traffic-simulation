import { ScatterplotLayer } from "@deck.gl/layers";
import type { Incident, VehicleState } from "./types";

export function buildVehicleLayer(vehicles: VehicleState[]) {
  return new ScatterplotLayer({
    id: "vehicles",
    data: vehicles,
    getPosition: (v: VehicleState) => [v.lng, v.lat],
    getRadius: 6,
    getFillColor: [255, 200, 0],
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
