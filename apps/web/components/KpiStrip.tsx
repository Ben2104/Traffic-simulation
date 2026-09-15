"use client";
import { useEffect, useState } from "react";
import { useSimulationStore } from "../lib/store";
import { formatKind, isHighPriority } from "../lib/severity";
import { CarIcon, CrisisIcon, LinkIcon, WarningIcon } from "./icons";

/**
 * KPI summary row from the Stitch "Operations Overview" frame.
 *
 * The frame mocks up dispatch-fleet metrics (units available, avg response
 * time) that this system has no source of truth for — the backend exposes
 * vehicles, incidents and the WebSocket link only. Rather than render
 * invented numbers in an operations console, the four tiles are filled with
 * telemetry the simulation actually reports; the layout and treatment are
 * the frame's.
 */
function Tile({
  label,
  value,
  detail,
  detailTone = "text-outline",
  valueTone = "text-on-surface",
  icon,
  iconTone = "text-primary-container",
  testId,
}: {
  label: string;
  value: string;
  detail: string;
  detailTone?: string;
  valueTone?: string;
  icon: React.ReactNode;
  iconTone?: string;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex items-center justify-between rounded border border-outline-variant bg-surface-container-low px-3 py-2"
    >
      <div className="min-w-0">
        <div className="text-label-caps text-outline">{label}</div>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className={`text-headline-lg font-bold ${valueTone}`}>{value}</span>
          <span className={`truncate text-mono-sm ${detailTone}`}>{detail}</span>
        </div>
      </div>
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded border border-outline-variant bg-surface-container ${iconTone}`}
      >
        {icon}
      </div>
    </div>
  );
}

export default function KpiStrip() {
  const incidents = useSimulationStore((s) => s.incidents);
  const vehicles = useSimulationStore((s) => s.vehicles);
  const connectionStatus = useSimulationStore((s) => s.connectionStatus);
  const lastTickAt = useSimulationStore((s) => s.lastTickAt);
  const [tickAgeMs, setTickAgeMs] = useState<number | null>(null);

  // Tick age is wall-clock derived, so it only becomes meaningful after mount
  // (same hydration reasoning as the clock in TopBar).
  useEffect(() => {
    const update = () => setTickAgeMs(Date.now() - useSimulationStore.getState().lastTickAt);
    // Seeded via timeout, not a synchronous setState in the effect body —
    // see the same note in TopBar.
    const seed = setTimeout(update, 0);
    const id = setInterval(update, 500);
    return () => {
      clearTimeout(seed);
      clearInterval(id);
    };
  }, [lastTickAt]);

  const highPriority = incidents.filter((i) => isHighPriority(i.severity)).length;
  const kinds = [...new Set(incidents.filter((i) => isHighPriority(i.severity)).map((i) => i.kind))];
  const linkLive = connectionStatus === "open";

  return (
    <section className="grid shrink-0 grid-cols-2 gap-3 border-b border-outline-variant bg-surface-container-lowest px-4 py-2 xl:grid-cols-4">
      <Tile
        testId="kpi-active-incidents"
        label="Active Incidents"
        value={String(incidents.length).padStart(2, "0")}
        detail={highPriority > 0 ? `${highPriority} high priority` : "none escalated"}
        detailTone={highPriority > 0 ? "text-warning" : "text-outline"}
        icon={<WarningIcon className="h-5 w-5" />}
        iconTone={incidents.length > 0 ? "text-warning" : "text-outline"}
      />
      <Tile
        testId="kpi-high-priority"
        label="High Priority"
        value={String(highPriority).padStart(2, "0")}
        detail={kinds.length > 0 ? kinds.map(formatKind).join(" • ") : "sector nominal"}
        detailTone={highPriority > 0 ? "text-error" : "text-outline"}
        valueTone={highPriority > 0 ? "text-error" : "text-on-surface"}
        icon={<CrisisIcon className="h-5 w-5" />}
        iconTone={highPriority > 0 ? "text-error" : "text-outline"}
      />
      <Tile
        testId="kpi-vehicles"
        label="Vehicles Tracked"
        value={String(vehicles.length)}
        detail="in SUMO network"
        valueTone={vehicles.length > 0 ? "text-tertiary" : "text-on-surface"}
        icon={<CarIcon className="h-5 w-5" />}
        iconTone={vehicles.length > 0 ? "text-tertiary" : "text-outline"}
      />
      <Tile
        testId="kpi-link"
        label="Telemetry Link"
        value={linkLive ? "LIVE" : connectionStatus.toUpperCase()}
        detail={
          tickAgeMs === null
            ? "awaiting first tick"
            : `last tick ${(tickAgeMs / 1000).toFixed(1)}s ago`
        }
        valueTone={linkLive ? "text-primary" : "text-error"}
        detailTone={tickAgeMs !== null && tickAgeMs > 3000 ? "text-warning" : "text-outline"}
        icon={<LinkIcon className="h-5 w-5" />}
        iconTone={linkLive ? "text-primary-container" : "text-error"}
      />
    </section>
  );
}
