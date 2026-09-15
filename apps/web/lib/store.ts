import { create } from "zustand";
import type {
  VehicleState,
  Incident,
  ServerMessage,
  TrafficLightApproach,
} from "./types";

interface SimulationState {
  vehicles: VehicleState[];
  previousVehicles: VehicleState[];
  lastTickAt: number;
  incidents: Incident[];
  /**
   * Current signal phase per TLS id, replaced wholesale each tick. A frame
   * that omits the key leaves this untouched: a transient backend failure
   * should show stale signals, not blank every marker to grey.
   */
  signals: Record<string, string>;
  /** Static approach geometry, fetched once from GET /traffic-lights. */
  approaches: TrafficLightApproach[];
  setApproaches: (approaches: TrafficLightApproach[]) => void;
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
  signals: {},
  approaches: [],
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
          // Replaced, never merged: the backend sends the complete map every
          // tick, so merging would resurrect a stale TLS. Left alone entirely
          // when the key is absent.
          ...(message.signals ? { signals: message.signals } : {}),
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
  setApproaches: (approaches) => set({ approaches }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
}));
