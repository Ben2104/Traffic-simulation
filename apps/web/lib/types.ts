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

export type ServerMessage =
  | { type: "simulation.vehicles"; tick: number; vehicles: VehicleState[] }
  | { type: "incident.created"; incident: Incident }
  | { type: "simulation.error"; message: string };
