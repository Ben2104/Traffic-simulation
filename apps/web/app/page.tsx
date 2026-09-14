"use client";
import { useEffect, useState } from "react";
import MapView from "../components/MapView";
import IncidentFeed from "../components/IncidentFeed";
import IncidentToast from "../components/IncidentToast";
import IncidentDetailPanel from "../components/IncidentDetailPanel";
import { useSimulationStore } from "../lib/store";
import { connectSimulationSocket } from "../lib/ws-client";
import type { Incident } from "../lib/types";

export default function DashboardPage() {
  const handleMessage = useSimulationStore((s) => s.handleMessage);
  const setConnectionStatus = useSimulationStore((s) => s.setConnectionStatus);
  const errorMessage = useSimulationStore((s) => s.errorMessage);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  // The store auto-clears errorMessage on the next simulation.vehicles tick
  // (a parked, human-ruled decision — see task brief). Dismissal is tracked
  // locally by remembering which error text the operator already dismissed,
  // so a *new* error message (different text) reappears even if the operator
  // dismissed a previous one, but a re-render of the same still-live error
  // does not resurrect a banner the operator already closed.
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const showError = errorMessage !== null && errorMessage !== dismissedError;

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_API_WS_URL ?? "ws://localhost:8000/ws/simulation";
    const disconnect = connectSimulationSocket({
      url: wsUrl,
      onMessage: handleMessage,
      onStatusChange: setConnectionStatus,
    });
    return disconnect;
  }, [handleMessage, setConnectionStatus]);

  return (
    <div className="grid grid-cols-[280px_1fr_320px] h-screen">
      <aside data-testid="incident-feed" className="border-r overflow-y-auto">
        <IncidentFeed onSelectIncident={setSelectedIncident} selectedIncidentId={selectedIncident?.id ?? null} />
      </aside>
      <main data-testid="map-view" className="relative">
        <IncidentToast />
        {showError && (
          <div
            data-testid="error-banner"
            role="alert"
            className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between bg-red-700 px-4 py-2 text-sm text-white"
          >
            <span>{errorMessage}</span>
            <button
              onClick={() => setDismissedError(errorMessage)}
              className="ml-4 font-semibold"
            >
              Dismiss
            </button>
          </div>
        )}
        <MapView
          mapboxToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ""}
          flyToTarget={selectedIncident ? selectedIncident.location : null}
        />
      </main>
      <aside data-testid="incident-detail" className="border-l overflow-y-auto">
        <IncidentDetailPanel incident={selectedIncident} />
      </aside>
    </div>
  );
}
