"use client";
import { useEffect, useState } from "react";
import MapView from "../components/MapView";
import IncidentFeed from "../components/IncidentFeed";
import IncidentToast from "../components/IncidentToast";
import IncidentDetailPanel from "../components/IncidentDetailPanel";
import NavRail from "../components/NavRail";
import TopBar from "../components/TopBar";
import KpiStrip from "../components/KpiStrip";
import StatusBar from "../components/StatusBar";
import { WarningIcon } from "../components/icons";
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
    // Layout mirrors the Stitch "Operations Overview" frame: operator rail,
    // then a header + KPI strip stacked over the tactical map, with the
    // incident queue and the selected ticket's telemetry down the right side.
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <NavRail />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <KpiStrip />

        <div className="flex min-h-0 flex-1">
          <main
            data-testid="map-view"
            className="relative min-w-0 flex-1 bg-surface-container-lowest"
          >
            <IncidentToast />
            {showError && (
              <div
                data-testid="error-banner"
                role="alert"
                className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 border-b border-error/50 bg-error-container/90 px-4 py-2 backdrop-blur-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <WarningIcon className="h-4 w-4 shrink-0 text-on-error-container" />
                  <span className="text-label-caps shrink-0 text-on-error-container">
                    Simulation Fault
                  </span>
                  <span className="truncate text-mono-md text-on-error-container">
                    {errorMessage}
                  </span>
                </span>
                <button
                  onClick={() => setDismissedError(errorMessage)}
                  className="shrink-0 rounded border border-on-error-container/40 px-2 py-0.5 text-mono-sm text-on-error-container transition-colors hover:bg-on-error-container/10"
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

          <aside
            data-testid="incident-feed"
            className="w-[320px] shrink-0 overflow-hidden border-l border-outline-variant"
          >
            <IncidentFeed
              onSelectIncident={setSelectedIncident}
              selectedIncidentId={selectedIncident?.id ?? null}
            />
          </aside>

          <aside
            data-testid="incident-detail"
            className="hidden w-[340px] shrink-0 overflow-hidden border-l border-outline-variant xl:block"
          >
            <IncidentDetailPanel incident={selectedIncident} />
          </aside>
        </div>

        <StatusBar />
      </div>
    </div>
  );
}
