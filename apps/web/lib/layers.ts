import { ScatterplotLayer } from "@deck.gl/layers";
import type { VehicleState } from "./types";

export function buildVehicleLayer(vehicles: VehicleState[]) {
  return new ScatterplotLayer({
    id: "vehicles",
    data: vehicles,
    getPosition: (v: VehicleState) => [v.lng, v.lat],
    getRadius: 6,
    getFillColor: [255, 200, 0],
  });
}
