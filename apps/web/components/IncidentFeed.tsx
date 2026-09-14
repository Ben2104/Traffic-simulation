"use client";
import { useEffect, useMemo, useState } from "react";
import { useSimulationStore } from "../lib/store";
import { formatKind, severityStyle } from "../lib/severity";
import type { Incident } from "../lib/types";
import { ChevronRightIcon, PinIcon, ShieldIcon } from "./icons";

export interface IncidentFeedProps {
  onSelectIncident: (incident: Incident) => void;
  selectedIncidentId: string | null;
}

const ALL = "ALL";

function relativeTime(createdAt: string, nowMs: number): string {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return "—";
  const seconds = Math.max(0, Math.round((nowMs - created) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

/**
 * Right-hand incident queue, styled after the Stitch "Active Incidents" panel.
 *
 * The frame's filter chips are a fixed CRITICAL/HIGH/DISPATCHED set; the API
 * types severity as a free-form string, so the chips are derived from the
 * severities actually present in the feed instead of being hardcoded to a set
 * the backend may never emit.
 */
export default function IncidentFeed({ onSelectIncident, selectedIncidentId }: IncidentFeedProps) {
  const incidents = useSimulationStore((s) => s.incidents);
  const [filter, setFilter] = useState<string>(ALL);
  // Relative timestamps are wall-clock derived; keep them off the server
  // render and tick them once a second after mount.
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    // Seeded via timeout, not a synchronous setState in the effect body —
    // see the same note in TopBar.
    const seed = setTimeout(() => setNowMs(Date.now()), 0);
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      clearTimeout(seed);
      clearInterval(id);
    };
  }, []);

  const severities = useMemo(
    () => [...new Set(incidents.map((i) => i.severity.toUpperCase()))],
    [incidents]
  );

  // A filter whose severity has aged out of the feed would otherwise hide
  // every ticket with no way back except clicking a chip that is gone.
  const activeFilter = filter !== ALL && !severities.includes(filter) ? ALL : filter;
  const visible =
    activeFilter === ALL
      ? incidents
      : incidents.filter((i) => i.severity.toUpperCase() === activeFilter);

  return (
    <div className="flex h-full flex-col bg-surface-container-lowest">
      <div className="flex items-center justify-between border-b border-outline-variant px-3 py-2.5">
        <h2 className="flex items-center gap-2 text-headline-sm font-bold text-on-surface">
          <ShieldIcon className="h-4 w-4 text-primary-container" />
          Active Incidents ({incidents.length})
        </h2>
        <span className="rounded border border-outline-variant bg-surface-container px-1.5 py-0.5 text-mono-sm uppercase text-outline">
          Queue
        </span>
      </div>

      {severities.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-outline-variant px-3 py-2">
          {[ALL, ...severities].map((value) => {
            const selected = value === activeFilter;
            const count =
              value === ALL
                ? incidents.length
                : incidents.filter((i) => i.severity.toUpperCase() === value).length;
            return (
              <button
                key={value}
                type="button"
                data-testid={`feed-filter-${value.toLowerCase()}`}
                aria-pressed={selected}
                onClick={() => setFilter(value)}
                className={`rounded border px-2 py-0.5 text-mono-sm uppercase transition-colors ${
                  selected
                    ? "border-primary-container bg-primary-container/15 text-primary"
                    : "border-outline-variant bg-surface-container text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {value === ALL ? "All" : value} ({count})
              </button>
            );
          })}
        </div>
      )}

      <ul className="flex-1 space-y-2 overflow-y-auto p-3">
        {visible.length === 0 && (
          <li
            data-testid="feed-empty-state"
            className="mt-10 flex flex-col items-center px-4 text-center"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-outline-variant bg-surface-container text-tertiary">
              <ShieldIcon className="h-7 w-7" />
            </div>
            <p className="mt-4 text-headline-sm font-semibold text-on-surface">
              {incidents.length === 0 ? "All Corridors Clear" : "No Matching Incidents"}
            </p>
            <p className="mt-2 text-body-sm text-on-surface-variant">
              {incidents.length === 0
                ? "No incidents reported. SUMO simulation is actively monitoring the SoMa network."
                : "No incidents at this severity. Clear the filter to see the full queue."}
            </p>
          </li>
        )}

        {visible.map((incident) => {
          const style = severityStyle(incident.severity);
          const selected = incident.id === selectedIncidentId;
          return (
            <li key={incident.id}>
              <button
                type="button"
                data-testid={`incident-${incident.id}`}
                aria-pressed={selected}
                onClick={() => onSelectIncident(incident)}
                className={`w-full overflow-hidden rounded border bg-surface-container-low text-left transition-colors hover:bg-surface-container ${
                  selected ? "border-primary-container" : style.border
                }`}
              >
                <span className={`block h-0.5 w-full ${style.bar}`} />
                <span className="block p-2.5">
                  <span className="flex items-center justify-between">
                    <span
                      className={`rounded border px-1.5 py-0.5 text-mono-sm font-bold uppercase ${style.chipBg} ${style.border} ${style.text}`}
                    >
                      {style.label}
                    </span>
                    <span className="text-mono-sm text-outline">
                      {nowMs === null ? "—" : relativeTime(incident.created_at, nowMs)}
                    </span>
                  </span>

                  <span className="mt-1.5 block text-body-md font-semibold text-on-surface">
                    {formatKind(incident.kind)}
                  </span>

                  <span className="mt-1 flex items-center gap-1 text-mono-sm text-on-surface-variant">
                    <PinIcon className="h-3 w-3 shrink-0 text-outline" />
                    <span className="truncate">Edge {incident.location.edge_id}</span>
                  </span>

                  <span className="mt-2 flex items-center justify-between border-t border-outline-variant/60 pt-2 text-mono-sm text-outline">
                    <span className="truncate">#{incident.id}</span>
                    <span
                      className={`flex items-center gap-1 ${
                        selected ? "text-primary" : "text-on-surface-variant"
                      }`}
                    >
                      {selected ? "Tracking" : "Open"}
                      <ChevronRightIcon className="h-3 w-3" />
                    </span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
