import { describe, it, expect } from "vitest";
import { interpolateVehicles } from "../lib/interpolation";

describe("interpolateVehicles", () => {
  it("interpolates halfway between previous and current position", () => {
    const previous = [{ id: "car-1", lat: 37.0, lng: -122.0, heading: 0, speed: 5, kind: "civilian" }];
    const current = [{ id: "car-1", lat: 37.1, lng: -122.1, heading: 0, speed: 5, kind: "civilian" }];
    const result = interpolateVehicles(previous, current, 1000, 500);
    expect(result[0].lat).toBeCloseTo(37.05, 5);
    expect(result[0].lng).toBeCloseTo(-122.05, 5);
  });

  it("returns current position unchanged for a vehicle with no previous tick", () => {
    const current = [{ id: "car-2", lat: 1, lng: 2, heading: 0, speed: 0, kind: "civilian" }];
    const result = interpolateVehicles([], current, 1000, 500);
    expect(result[0]).toEqual(current[0]);
  });
});
