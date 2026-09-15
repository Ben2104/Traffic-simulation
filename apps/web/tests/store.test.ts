import { describe, it, expect, beforeEach } from "vitest";
import { useSimulationStore } from "../lib/store";
import type { VehicleState, Incident, TrafficLightApproach } from "../lib/types";

const initialState = useSimulationStore.getState();

beforeEach(() => {
  useSimulationStore.setState(initialState, true);
});

const vehicleA: VehicleState = {
  id: "car-101",
  lat: 37.7765,
  lng: -122.3946,
  heading: 91,
  speed: 10.4,
  kind: "civilian",
};

const vehicleB: VehicleState = {
  id: "car-102",
  lat: 37.78,
  lng: -122.4,
  heading: 45,
  speed: 8.1,
  kind: "civilian",
};

const incidentA: Incident = {
  id: "INC-1042",
  kind: "collision",
  severity: "HIGH",
  location: { lat: 37.7765, lng: -122.3946, edge_id: "edge-1" },
  vehicles_involved: ["car-101", "car-204"],
  created_at: "2026-09-13T12:00:00Z",
};

const incidentB: Incident = {
  id: "INC-1043",
  kind: "stall",
  severity: "LOW",
  location: { lat: 37.78, lng: -122.4, edge_id: "edge-2" },
  vehicles_involved: ["car-300"],
  created_at: "2026-09-13T12:05:00Z",
};

describe("useSimulationStore", () => {
  it("updates vehicles, moves prior vehicles into previousVehicles, and advances lastTickAt on simulation.vehicles", () => {
    useSimulationStore.setState({ vehicles: [vehicleA] });
    const beforeTick = useSimulationStore.getState().lastTickAt;

    useSimulationStore.getState().handleMessage({
      type: "simulation.vehicles",
      tick: 4821,
      vehicles: [vehicleB],
    });

    const state = useSimulationStore.getState();
    expect(state.vehicles).toEqual([vehicleB]);
    expect(state.previousVehicles).toEqual([vehicleA]);
    expect(state.lastTickAt).toBeGreaterThanOrEqual(beforeTick);
  });

  it("appends to incidents (newest-first) on incident.created", () => {
    useSimulationStore.getState().handleMessage({ type: "incident.created", incident: incidentA });
    useSimulationStore.getState().handleMessage({ type: "incident.created", incident: incidentB });

    const state = useSimulationStore.getState();
    expect(state.incidents).toEqual([incidentB, incidentA]);
  });

  it("replaces the incident list via setIncidents", () => {
    useSimulationStore.getState().setIncidents([incidentB, incidentA]);
    expect(useSimulationStore.getState().incidents).toEqual([incidentB, incidentA]);

    useSimulationStore.getState().setIncidents([]);
    expect(useSimulationStore.getState().incidents).toEqual([]);
  });

  it("keeps the newest-first invariant after setIncidents seeds the feed", () => {
    // Feed seeded from GET /incidents (already inverted by the caller to
    // newest-first); a later live incident must still land at the front.
    useSimulationStore.getState().setIncidents([incidentB, incidentA]);

    const incidentC: Incident = {
      ...incidentA,
      id: "INC-1044",
      created_at: "2026-09-13T12:10:00Z",
    };
    useSimulationStore.getState().handleMessage({ type: "incident.created", incident: incidentC });

    expect(useSimulationStore.getState().incidents).toEqual([incidentC, incidentB, incidentA]);
  });

  it("does not disturb other state when setting incidents", () => {
    useSimulationStore.setState({ vehicles: [vehicleA], errorMessage: "boom" });

    useSimulationStore.getState().setIncidents([incidentA]);

    const state = useSimulationStore.getState();
    expect(state.vehicles).toEqual([vehicleA]);
    expect(state.errorMessage).toBe("boom");
  });

  it("sets errorMessage without clearing vehicles on simulation.error", () => {
    useSimulationStore.setState({ vehicles: [vehicleA] });

    useSimulationStore.getState().handleMessage({
      type: "simulation.error",
      message: "simulation crashed",
    });

    const state = useSimulationStore.getState();
    expect(state.errorMessage).toBe("simulation crashed");
    expect(state.vehicles).toEqual([vehicleA]);
  });

  it("updates connectionStatus via setConnectionStatus", () => {
    useSimulationStore.getState().setConnectionStatus("open");
    expect(useSimulationStore.getState().connectionStatus).toBe("open");

    useSimulationStore.getState().setConnectionStatus("error");
    expect(useSimulationStore.getState().connectionStatus).toBe("error");
  });
});

describe("traffic signals", () => {
  beforeEach(() => {
    useSimulationStore.setState({ signals: {}, approaches: [] });
  });

  it("starts with no signals and no approaches", () => {
    expect(useSimulationStore.getState().signals).toEqual({});
    expect(useSimulationStore.getState().approaches).toEqual([]);
  });

  it("updates signals from a vehicle frame", () => {
    useSimulationStore.getState().handleMessage({
      type: "simulation.vehicles",
      tick: 1,
      vehicles: [],
      signals: { "tls-1": "rrGG" },
    });
    expect(useSimulationStore.getState().signals).toEqual({ "tls-1": "rrGG" });
  });

  it("retains the previous signals when a frame omits the key", () => {
    // A transient backend signal-read failure omits `signals`. Blanking ~800
    // markers to grey for a frame is worse than showing state one tick stale.
    const store = useSimulationStore.getState();
    store.handleMessage({
      type: "simulation.vehicles",
      tick: 1,
      vehicles: [],
      signals: { "tls-1": "rrGG" },
    });
    store.handleMessage({ type: "simulation.vehicles", tick: 2, vehicles: [] });
    expect(useSimulationStore.getState().signals).toEqual({ "tls-1": "rrGG" });
  });

  it("replaces signals wholesale rather than merging", () => {
    // The backend sends the complete map every tick, so a merge would
    // resurrect a TLS that has since dropped out of the simulation.
    const store = useSimulationStore.getState();
    store.handleMessage({
      type: "simulation.vehicles",
      tick: 1,
      vehicles: [],
      signals: { "tls-1": "rr", "tls-2": "GG" },
    });
    store.handleMessage({
      type: "simulation.vehicles",
      tick: 2,
      vehicles: [],
      signals: { "tls-1": "GG" },
    });
    expect(useSimulationStore.getState().signals).toEqual({ "tls-1": "GG" });
  });

  it("stores approaches via setApproaches", () => {
    const approaches: TrafficLightApproach[] = [
      {
        tls_id: "tls-1",
        lane_id: "north_0",
        link_indices: [0],
        lat: 37.7,
        lng: -122.4,
        heading: 0,
      },
    ];
    useSimulationStore.getState().setApproaches(approaches);
    expect(useSimulationStore.getState().approaches).toEqual(approaches);
  });
});
