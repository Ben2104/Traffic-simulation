import { describe, it, expect, beforeEach } from "vitest";
import { useSimulationStore } from "../lib/store";
import type { VehicleState, Incident } from "../lib/types";

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
