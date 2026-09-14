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
  const setIncidents = useSimulationStore((s) => s.setIncidents);
  const setConnectionStatus = useSimulationStore((s) => s.setConnectionStatus);
  const errorMessage = useSimulationStore((s) => s.errorMessage);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  // The store auto-clears errorMessage on the next simulation.vehicles tick
  // (a parked, human-ruled decision — see task brief). Dismissal is tracked
  // locally by remembering which error text the operator already dismissed,
  // so a *new* error message (different text) reappears even if the operator
  // dismissed a previous one, but a re-render of the same still-live error
  // does not resurrect a banner the operator already closed.
  // Known limitation: dismissal keys off exact error text, so if the same
  // error string recurs later (e.g. the same fault happens twice), the
  // banner will not resurface for the second occurrence. Acceptable for
  // this slice; revisit if error UX needs per-occurrence surfacing later.
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const showError = errorMessage !== null && errorMessage !== dismissedError;

  useEffect(() => {
    // NEXT_PUBLIC_API_WS_URL is never set in this slice (no env-var
    // indirection was introduced per controller resolution #3), so the
    // hardcoded fallback is always the operative URL in practice.
    const wsUrl = process.env.NEXT_PUBLIC_API_WS_URL ?? "ws://localhost:8000/ws/simulation";
    const disconnect = connectSimulationSocket({
      url: wsUrl,
      onMessage: handleMessage,
      onStatusChange: setConnectionStatus,
    });
    return disconnect;
  }, [handleMessage, setConnectionStatus]);

  useEffect(() => {
    // Without this the feed is WS-only: an incident triggered before the
    // browser was open -- or before a refresh, or before a WS reconnect --
    // is invisible, and the click-to-flyTo beat is unreachable with no
    // recovery short of triggering another collision.
    //
    // Same hardcoded host as the WebSocket URL above (no env-var indirection
    // in this slice); port 8000 is published by docker compose too.
    //
    // GET /incidents returns store-insertion order (oldest first) while the
    // store is newest-first, so the response is inverted rather than sorted
    // on created_at: inverting matches the server's actual contract exactly,
    // whereas Date parsing truncates Python's microseconds to milliseconds
    // and would order two near-simultaneous incidents arbitrarily.
    let cancelled = false;
    fetch("http://localhost:8000/incidents")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data: Incident[]) => {
        if (cancelled || !Array.isArray(data) || data.length === 0) return;
        // Seed only; never clobber anything the live stream already
        // delivered while this request was in flight.
        if (useSimulationStore.getState().incidents.length > 0) return;
        setIncidents([...data].reverse());
      })
      .catch(() => {
        // The API may simply not be up yet. The WS stream still populates
        // the feed as incidents occur, so this stays silent on purpose --
        // no banner, no crash.
      });
    return () => {
      cancelled = true;
    };
  }, [setIncidents]);

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
