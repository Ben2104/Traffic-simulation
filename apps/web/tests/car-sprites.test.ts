import { describe, it, expect } from "vitest";
import {
  BODY_KEYS,
  CIVILIAN_PALETTE,
  buildSpriteAtlas,
  hashVehicleId,
  spriteKeyForVehicle,
} from "../lib/car-sprites";

describe("CIVILIAN_PALETTE", () => {
  it("has 20 colours", () => {
    expect(CIVILIAN_PALETTE).toHaveLength(20);
  });

  it("contains no duplicates", () => {
    expect(new Set(CIVILIAN_PALETTE).size).toBe(CIVILIAN_PALETTE.length);
  });

  it("reserves red for the emergency liveries in a later slice", () => {
    // A civilian car tinted fire-engine red is indistinguishable from an
    // emergency unit at 14px, which is the whole point of the palette.
    for (const hex of CIVILIAN_PALETTE) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const dominantlyRed = r > 150 && r - g > 60 && r - b > 60;
      expect(dominantlyRed, `${hex} is too red for a civilian vehicle`).toBe(false);
    }
  });
});

describe("hashVehicleId", () => {
  it("is stable across calls for the same id", () => {
    // Load-bearing, not cosmetic: re-randomising per frame makes every car
    // strobe through the palette at the render rate.
    expect(hashVehicleId("veh42")).toBe(hashVehicleId("veh42"));
  });

  it("returns a non-negative integer", () => {
    for (const id of ["veh0", "veh1", "a", "", "veh999999"]) {
      const h = hashVehicleId(id);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
    }
  });

  it("distinguishes adjacent ids", () => {
    expect(hashVehicleId("veh1")).not.toBe(hashVehicleId("veh2"));
  });
});

describe("spriteKeyForVehicle", () => {
  it("is stable for the same id", () => {
    expect(spriteKeyForVehicle("veh42", "civilian")).toBe(
      spriteKeyForVehicle("veh42", "civilian")
    );
  });

  it("only ever returns a key in the atlas mapping", () => {
    const valid = new Set<string>();
    for (const body of BODY_KEYS) {
      for (let i = 0; i < CIVILIAN_PALETTE.length; i += 1) valid.add(`${body}-${i}`);
    }
    for (let i = 0; i < 1000; i += 1) {
      expect(valid.has(spriteKeyForVehicle(`veh${i}`, "civilian"))).toBe(true);
    }
  });

  it("spreads 1000 vehicles across every palette colour", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      seen.add(spriteKeyForVehicle(`veh${i}`, "civilian").split("-")[1]);
    }
    expect(seen.size).toBe(CIVILIAN_PALETTE.length);
  });

  it("spreads 1000 vehicles across every body type", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      seen.add(spriteKeyForVehicle(`veh${i}`, "civilian").split("-")[0]);
    }
    expect(seen.size).toBe(BODY_KEYS.length);
  });
});

describe("buildSpriteAtlas", () => {
  it("returns null when no 2D canvas context is available", () => {
    // jsdom has no canvas implementation, and neither does the Next.js
    // server render. Returning null lets the layer builder fall back to the
    // scatterplot instead of throwing during SSR.
    expect(buildSpriteAtlas()).toBeNull();
  });
});
