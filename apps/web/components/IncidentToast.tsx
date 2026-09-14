"use client";
import { useState } from "react";
import { useSimulationStore } from "../lib/store";

export default function IncidentToast() {
  const incidents = useSimulationStore((s) => s.incidents);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  // incidents is ordered newest-first (the store prepends new incidents),
  // so the latest incident is at index 0, not the last index.
  const latest = incidents[0];

  if (!latest || dismissedIds.has(latest.id)) return null;

  return (
    <div data-testid="incident-toast" role="alert">
      <p>🔔 NEW INCIDENT — {latest.id}</p>
      <p>{latest.kind} at edge {latest.location.edge_id}</p>
      <button onClick={() => setDismissedIds((prev) => new Set(prev).add(latest.id))}>
        Dismiss
      </button>
    </div>
  );
}
