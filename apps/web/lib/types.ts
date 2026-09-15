export interface VehicleState {
  id: string;
  lat: number;
  lng: number;
  heading: number;
  speed: number;
  kind: string;
}

export interface IncidentLocation {
  lat: number;
  lng: number;
  edge_id: string;
}

export interface Incident {
  id: string;
  kind: string;
  severity: string;
  location: IncidentLocation;
  vehicles_involved: string[];
  created_at: string;
}

/**
 * One signalised approach. `link_indices` are offsets into its TLS's state
 * string, which is how a single marker resolves the colour of every movement
 * the lane controls.
 */
export interface TrafficLightApproach {
  tls_id: string;
  lane_id: string;
  link_indices: number[];
  lat: number;
  lng: number;
  heading: number;
}

export type ServerMessage =
  | {
      type: "simulation.vehicles";
      tick: number;
      vehicles: VehicleState[];
      // Absent when the backend's signal read failed. Absent means "keep the
      // previous state", not "everything is off".
      signals?: Record<string, string>;
    }
  | { type: "incident.created"; incident: Incident }
  | { type: "simulation.error"; message: string };
