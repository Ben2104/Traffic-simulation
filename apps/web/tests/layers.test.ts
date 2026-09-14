import { describe, it, expect } from "vitest";
import { buildIncidentLayer, buildVehicleLayer } from "../lib/layers";
import type { Incident } from "../lib/types";

describe("buildVehicleLayer", () => {
  it("builds a scatterplot layer with vehicle data", () => {
    const vehicles = [{ id: "car-1", lat: 1, lng: 2, heading: 0, speed: 0, kind: "civilian" }];
    const layer = buildVehicleLayer(vehicles);
    expect(layer.id).toBe("vehicles");
    expect(layer.props.data).toEqual(vehicles);
  });
});

describe("buildIncidentLayer", () => {
  const incident: Incident = {
    id: "INC-1042",
    kind: "collision",
    severity: "HIGH",
    location: { lat: 37.7765, lng: -122.3946, edge_id: "edge-1" },
    vehicles_involved: ["car-101", "car-204"],
    created_at: "2026-09-13T12:00:00Z",
  };

  it("builds a separate scatterplot layer with incident data", () => {
    const layer = buildIncidentLayer([incident]);
    expect(layer.id).toBe("incidents");
    expect(layer.props.data).toEqual([incident]);
  });

  it("positions markers at the incident location as [lng, lat]", () => {
    const layer = buildIncidentLayer([incident]);
    const getPosition = layer.props.getPosition as (i: Incident) => [number, number];
    expect(getPosition(incident)).toEqual([-122.3946, 37.7765]);
  });

  it("is visually distinct from the vehicle layer (red and larger)", () => {
    const incidentLayer = buildIncidentLayer([incident]);
    const vehicleLayer = buildVehicleLayer([]);
    expect(incidentLayer.props.getFillColor).toEqual([230, 40, 40]);
    expect(incidentLayer.props.getFillColor).not.toEqual(vehicleLayer.props.getFillColor);
    expect(incidentLayer.props.getRadius as number).toBeGreaterThan(
      vehicleLayer.props.getRadius as number
    );
  });

  it("handles an empty incident list", () => {
    expect(buildIncidentLayer([]).props.data).toEqual([]);
  });
});
