import { describe, it, expect } from "vitest";
import { buildIncidentLayer, buildVehicleLayer, buildVehicleIconLayer } from "../lib/layers";
import { buildSpriteAtlas, spriteKeyForVehicle } from "../lib/car-sprites";
import type { SpriteAtlas } from "../lib/car-sprites";
import type { Incident, VehicleState } from "../lib/types";

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

// buildVehicleIconLayer's return type is the deliberate union
// `IconLayer<VehicleState> | ScatterplotLayer<VehicleState>` -- that union is
// what lets the jsdom/SSR fallback share this call site with the icon path.
// Four of the assertions below therefore cast `layer.props` at the access
// point (rather than casting the individual property, which TS rejects
// before the cast is even applied, since the property doesn't exist on the
// scatterplot half of the union). Test-side-only amendment, coordinator-
// authorized, to keep `tsc --noEmit` clean without touching the production
// return type.
describe("buildVehicleIconLayer", () => {
  const vehicle: VehicleState = {
    id: "veh42",
    lat: 37.7765,
    lng: -122.3946,
    heading: 90,
    speed: 8,
    kind: "civilian",
  };

  // jsdom has no canvas backend, so a real atlas is unavailable here. This
  // fake carries the same shape the icon path consumes.
  const fakeAtlas = {
    canvas: {} as HTMLCanvasElement,
    mapping: { "sedan-0": { x: 0, y: 0, width: 64, height: 128, mask: false } },
  } as SpriteAtlas;

  it("falls back to the scatterplot layer when no atlas is available", () => {
    expect(buildSpriteAtlas()).toBeNull();
    const layer = buildVehicleIconLayer([vehicle], null);
    expect(layer.id).toBe("vehicles");
    expect(layer.props.data).toEqual([vehicle]);
  });

  it("keeps the layer id stable across both paths", () => {
    expect(buildVehicleIconLayer([vehicle], fakeAtlas).id).toBe(
      buildVehicleIconLayer([vehicle], null).id
    );
  });

  it("negates the heading, because deck.gl angles are counter-clockwise", () => {
    // SUMO's getAngle() is degrees clockwise from north; deck.gl's getAngle
    // is counter-clockwise. Getting this wrong points every car the wrong way
    // in a manner that still looks plausible in a screenshot.
    const layer = buildVehicleIconLayer([vehicle], fakeAtlas);
    const { getAngle } = layer.props as { getAngle: (v: VehicleState) => number };
    expect(getAngle(vehicle)).toBe(-90);
    expect(getAngle({ ...vehicle, heading: 217 })).toBe(-217);
  });

  it("positions icons at [lng, lat]", () => {
    const layer = buildVehicleIconLayer([vehicle], fakeAtlas);
    const getPosition = layer.props.getPosition as (v: VehicleState) => number[];
    expect(getPosition(vehicle)).toEqual([-122.3946, 37.7765]);
  });

  it("selects the icon by the vehicle's stable sprite key", () => {
    const layer = buildVehicleIconLayer([vehicle], fakeAtlas);
    const { getIcon } = layer.props as { getIcon: (v: VehicleState) => string };
    expect(getIcon(vehicle)).toBe(spriteKeyForVehicle("veh42", "civilian"));
  });

  it("sizes icons in metres with a pixel floor so they survive zooming out", () => {
    // A real 4.5m car is about 2px at z15. Without the floor, vehicles vanish.
    const layer = buildVehicleIconLayer([vehicle], fakeAtlas);
    const { sizeUnits, sizeMinPixels } = layer.props as {
      sizeUnits: string;
      sizeMinPixels: number;
    };
    expect(sizeUnits).toBe("meters");
    expect(sizeMinPixels).toBe(14);
  });

  it("lays icons flat on the ground plane rather than billboarding", () => {
    // billboard: true would make every car face the camera under pitch,
    // destroying the heading cue entirely.
    expect(buildVehicleIconLayer([vehicle], fakeAtlas).props.billboard).toBe(false);
  });

  it("handles an empty vehicle list", () => {
    expect(buildVehicleIconLayer([], fakeAtlas).props.data).toEqual([]);
  });
});
