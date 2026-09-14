import type { Incident } from "../lib/types";

export interface IncidentDetailPanelProps {
  incident: Incident | null;
}

export default function IncidentDetailPanel({ incident }: IncidentDetailPanelProps) {
  if (!incident) {
    return <p className="p-4 text-sm text-gray-500">Select an incident to see details.</p>;
  }
  return (
    <div className="p-4">
      <h2 className="font-semibold">{incident.id}</h2>
      <p>{incident.kind}</p>
      <p>Severity: {incident.severity}</p>
      <p>Vehicles involved: {incident.vehicles_involved.join(", ")}</p>
    </div>
  );
}
