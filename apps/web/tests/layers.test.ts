import { describe, it, expect } from "vitest";
import { buildVehicleLayer } from "../lib/layers";

describe("buildVehicleLayer", () => {
  it("builds a scatterplot layer with vehicle data", () => {
    const vehicles = [{ id: "car-1", lat: 1, lng: 2, heading: 0, speed: 0, kind: "civilian" }];
    const layer = buildVehicleLayer(vehicles);
    expect(layer.id).toBe("vehicles");
    expect(layer.props.data).toEqual(vehicles);
  });
});
