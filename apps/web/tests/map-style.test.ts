import { describe, it, expect } from "vitest";
import {
  DEFAULT_VIEW_STATE,
  INITIAL_MAP_STYLE,
  STYLE_URL,
  mapStyleReducer,
  reapplyPlan,
} from "../lib/map-style";

describe("DEFAULT_VIEW_STATE", () => {
  it("opens tilted at the zoom where Standard shows road detail", () => {
    // Mapbox Standard only renders lane markings, crosswalks and turn arrows
    // from roughly z16; at the previous z15.5 default none of it appeared.
    expect(DEFAULT_VIEW_STATE.pitch).toBe(45);
    expect(DEFAULT_VIEW_STATE.bearing).toBe(-17);
    expect(DEFAULT_VIEW_STATE.zoom).toBe(16.5);
  });
});

describe("mapStyleReducer", () => {
  it("defaults to Standard, 3D buildings on, day lighting, no terrain", () => {
    expect(INITIAL_MAP_STYLE).toEqual({
      basemap: "standard",
      buildings3d: true,
      terrain: false,
      night: false,
    });
  });

  it("switches basemap without disturbing the toggles", () => {
    const next = mapStyleReducer(
      { basemap: "standard", buildings3d: true, terrain: true, night: true },
      { type: "setBasemap", basemap: "satellite" }
    );
    expect(next).toEqual({
      basemap: "satellite",
      buildings3d: true,
      terrain: true,
      night: true,
    });
  });

  it.each(["buildings3d", "terrain", "night"] as const)("flips %s", (key) => {
    const next = mapStyleReducer(INITIAL_MAP_STYLE, { type: "toggle", key });
    expect(next[key]).toBe(!INITIAL_MAP_STYLE[key]);
  });

  it("does not mutate the input state", () => {
    const state = { ...INITIAL_MAP_STYLE };
    mapStyleReducer(state, { type: "toggle", key: "terrain" });
    expect(state).toEqual(INITIAL_MAP_STYLE);
  });

  it("maps each basemap to its style URL", () => {
    expect(STYLE_URL.standard).toBe("mapbox://styles/mapbox/standard");
    expect(STYLE_URL.satellite).toBe("mapbox://styles/mapbox/satellite-streets-v12");
  });
});

describe("reapplyPlan", () => {
  it("drives Standard's buildings through its config property", () => {
    // A custom fill-extrusion layer cannot be added to Standard: it does not
    // expose its source schema. Buildings are a style config there.
    const plan = reapplyPlan({
      basemap: "standard",
      buildings3d: true,
      terrain: false,
      night: false,
    });
    expect(plan).toContainEqual({
      op: "setConfigProperty",
      property: "show3dObjects",
      value: true,
    });
    expect(plan).not.toContainEqual({ op: "addExtrusionLayer" });
  });

  it("drives Satellite's buildings through a manual extrusion layer", () => {
    // satellite-streets-v12 is a classic style with no config properties, so
    // the same toggle needs a completely different implementation.
    const plan = reapplyPlan({
      basemap: "satellite",
      buildings3d: true,
      terrain: false,
      night: false,
    });
    expect(plan).toContainEqual({ op: "addExtrusionLayer" });
    expect(plan.some((i) => i.op === "setConfigProperty")).toBe(false);
  });

  it("removes the extrusion layer when buildings are off on Satellite", () => {
    const plan = reapplyPlan({
      basemap: "satellite",
      buildings3d: false,
      terrain: false,
      night: false,
    });
    expect(plan).toContainEqual({ op: "removeExtrusionLayer" });
  });

  it("selects the light preset from the night toggle", () => {
    const day = reapplyPlan(INITIAL_MAP_STYLE);
    const night = reapplyPlan({ ...INITIAL_MAP_STYLE, night: true });
    expect(day).toContainEqual({
      op: "setConfigProperty",
      property: "lightPreset",
      value: "day",
    });
    expect(night).toContainEqual({
      op: "setConfigProperty",
      property: "lightPreset",
      value: "night",
    });
  });

  it("always emits exactly one terrain instruction", () => {
    for (const terrain of [true, false]) {
      const plan = reapplyPlan({ ...INITIAL_MAP_STYLE, terrain });
      const terrainOps = plan.filter(
        (i) => i.op === "addTerrain" || i.op === "removeTerrain"
      );
      expect(terrainOps).toHaveLength(1);
      expect(terrainOps[0].op).toBe(terrain ? "addTerrain" : "removeTerrain");
    }
  });

  it("emits a complete plan every time, so a style reload restores everything", () => {
    // setStyle() destroys every custom source and layer. The plan is replayed
    // wholesale on style.load, so it must describe the full desired state
    // rather than a delta.
    const plan = reapplyPlan({
      basemap: "satellite",
      buildings3d: true,
      terrain: true,
      night: false,
    });
    expect(plan).toEqual([{ op: "addExtrusionLayer" }, { op: "addTerrain" }]);
  });
});
