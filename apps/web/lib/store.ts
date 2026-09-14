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
  /**
   * Replace the incident list wholesale. Used to seed the feed from
   * `GET /incidents` on mount, so an incident created before the browser was
   * open (or before a refresh / WS reconnect) is still clickable.
   *
   * The store's ordering contract is newest-first, the same order
   * `incident.created` maintains by prepending. Callers are responsible for
   * handing over an already-newest-first array; the API returns
   * store-insertion order (oldest first), so its response must be inverted
   * before it gets here.
   */
  setIncidents: (incidents: Incident[]) => void;
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
  setIncidents: (incidents) => set({ incidents }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
}));
