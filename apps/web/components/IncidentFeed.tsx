"use client";
import { useSimulationStore } from "../lib/store";
import type { Incident } from "../lib/types";

export interface IncidentFeedProps {
  onSelectIncident: (incident: Incident) => void;
  selectedIncidentId: string | null;
}

export default function IncidentFeed({ onSelectIncident, selectedIncidentId }: IncidentFeedProps) {
  const incidents = useSimulationStore((s) => s.incidents);
  return (
    <ul>
      {incidents.map((incident) => (
        <li key={incident.id}>
          <button
            data-testid={`incident-${incident.id}`}
            aria-pressed={incident.id === selectedIncidentId}
            onClick={() => onSelectIncident(incident)}
          >
            {incident.kind} — {incident.id}
          </button>
        </li>
      ))}
    </ul>
  );
}
