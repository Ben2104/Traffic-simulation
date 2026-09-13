import { create } from "zustand";
import type { VehicleState, Incident, ServerMessage } from "./types";

interface SimulationState {
  vehicles: VehicleState[];
  previousVehicles: VehicleState[];
  lastTickAt: number;
  incidents: Incident[];
  connectionStatus: "connecting" | "open" | "closed" | "error";
  errorMessage: string | null;
  handleMessage: (message: ServerMessage) => void;
  setConnectionStatus: (status: SimulationState["connectionStatus"]) => void;
}

export const useSimulationStore = create<SimulationState>((set, get) => ({
  vehicles: [],
  previousVehicles: [],
  lastTickAt: Date.now(),
  incidents: [],
  connectionStatus: "connecting",
  errorMessage: null,
  handleMessage: (message) => {
    switch (message.type) {
      case "simulation.vehicles":
        set({
          previousVehicles: get().vehicles,
          vehicles: message.vehicles,
          lastTickAt: Date.now(),
          errorMessage: null,
        });
        break;
      case "incident.created":
        set({ incidents: [message.incident, ...get().incidents] });
        break;
      case "simulation.error":
        set({ errorMessage: message.message });
        break;
    }
  },
  setConnectionStatus: (status) => set({ connectionStatus: status }),
}));
