import { describe, it, expect } from "vitest";
import { approachColor, buildSignalLayer } from "../lib/layers";
import type { TrafficLightApproach } from "../lib/types";

const approach: TrafficLightApproach = {
  tls_id: "tls-1",
  lane_id: "north_0",
  link_indices: [0, 1],
  lat: 37.7765,
  lng: -122.3946,
  heading: 90,
};

describe("approachColor", () => {
  it.each([
    ["r", "red"],
    ["s", "red"],
    ["y", "amber"],
    ["u", "amber"],
    ["g", "green"],
    ["G", "green"],
    ["o", "off"],
    ["O", "off"],
  ])("maps SUMO state character %s to %s", (char, expected) => {
    expect(approachColor(char, [0])).toBe(expected);
  });

  it("takes the most permissive state across an approach's links", () => {
    // An approach owns several links -- a protected left can be red while the
    // through movement is green. The marker answers one question only: "can
    // traffic from this lane move?" So any green wins.
    expect(approachColor("rG", [0, 1])).toBe("green");
    expect(approachColor("Gr", [0, 1])).toBe("green");
    expect(approachColor("ry", [0, 1])).toBe("amber");
    expect(approachColor("rr", [0, 1])).toBe("red");
  });

  it("ranks red above off, so a dark link never masks a live red", () => {
    expect(approachColor("or", [0, 1])).toBe("red");
  });

  it("reads only the indices the approach owns", () => {
    expect(approachColor("rrGG", [0, 1])).toBe("red");
    expect(approachColor("rrGG", [2, 3])).toBe("green");
  });

  it("returns off for an unknown state character", () => {
    expect(approachColor("?", [0])).toBe("off");
  });

  it("returns off when the TLS has no state this tick", () => {
    expect(approachColor(undefined, [0, 1])).toBe("off");
  });

  it("returns off when an index runs past the end of the state string", () => {
    expect(approachColor("r", [7])).toBe("off");
  });
});

describe("buildSignalLayer", () => {
  it("builds an extruded column layer with the approach data", () => {
    const layer = buildSignalLayer([approach], { "tls-1": "GG" });
    expect(layer.id).toBe("signals");
    expect(layer.props.data).toEqual([approach]);
    expect(layer.props.extruded).toBe(true);
  });

  it("positions columns at [lng, lat]", () => {
    const layer = buildSignalLayer([approach], {});
    const getPosition = layer.props.getPosition as (a: TrafficLightApproach) => number[];
    expect(getPosition(approach)).toEqual([-122.3946, 37.7765]);
  });

  it("colours a green approach green and a red one red", () => {
    const green = buildSignalLayer([approach], { "tls-1": "GG" });
    const red = buildSignalLayer([approach], { "tls-1": "rr" });
    const colorOf = (l: ReturnType<typeof buildSignalLayer>) =>
      (l.props.getFillColor as (a: TrafficLightApproach) => number[])(approach);
    expect(colorOf(green)).not.toEqual(colorOf(red));
    expect(colorOf(green)[1]).toBeGreaterThan(colorOf(green)[0]);
    expect(colorOf(red)[0]).toBeGreaterThan(colorOf(red)[1]);
  });

  it("declares an updateTrigger on the signal map", () => {
    // Without this deck.gl caches the colour attribute and the signals never
    // change colour again after the first frame -- a bug that looks exactly
    // like "the simulation froze".
    const signals = { "tls-1": "GG" };
    const layer = buildSignalLayer([approach], signals);
    const { updateTriggers } = layer.props as {
      updateTriggers: { getFillColor: unknown[] };
    };
    const trigger = updateTriggers.getFillColor;
    expect(trigger).toHaveLength(1);
    // Reference identity, not deep equality: deck.gl invalidates on object
    // identity, so a fresh object each render would defeat the trigger while
    // still satisfying toEqual.
    expect(trigger[0]).toBe(signals);
  });

  it("handles an empty approach list", () => {
    expect(buildSignalLayer([], {}).props.data).toEqual([]);
  });
});
