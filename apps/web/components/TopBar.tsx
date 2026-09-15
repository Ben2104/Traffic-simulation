"use client";
import { useEffect, useState } from "react";
import { useSimulationStore } from "../lib/store";
import { ClockIcon } from "./icons";

const STATUS_COPY: Record<string, { label: string; dot: string; text: string }> = {
  connecting: {
    label: "Connecting • TraCI WebSocket handshake",
    dot: "bg-warning",
    text: "text-warning",
  },
  open: {
    label: "Simulation Live • TraCI WebSocket Connected",
    dot: "bg-primary-container",
    text: "text-primary",
  },
  closed: {
    label: "Disconnected • TraCI WebSocket closed",
    dot: "bg-error",
    text: "text-error",
  },
  error: {
    label: "Link Fault • TraCI WebSocket error",
    dot: "bg-error",
    text: "text-error",
  },
};

/**
 * Header row from the Stitch "TopNavBar" component: view title, live link
 * pill driven by the real WebSocket status, and a wall clock.
 *
 * The clock renders empty on the server and fills in after mount — a
 * server-rendered timestamp would never match the client's first paint and
 * would trip a hydration mismatch.
 */
export default function TopBar() {
  const connectionStatus = useSimulationStore((s) => s.connectionStatus);
  const [now, setNow] = useState<Date | null>(null);
  const status = STATUS_COPY[connectionStatus] ?? STATUS_COPY.connecting;

  useEffect(() => {
    // The first sample is scheduled rather than set synchronously: a sync
    // setState in an effect body cascades an extra render (and trips
    // react-hooks/set-state-in-effect). A 0ms timeout lands in the same
    // frame for the operator.
    const seed = setTimeout(() => setNow(new Date()), 0);
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => {
      clearTimeout(seed);
      clearInterval(id);
    };
  }, []);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-outline-variant bg-surface-container-low px-4">
      <div className="flex items-center gap-4">
        <h1 className="text-headline-sm font-bold tracking-tight text-on-surface">
          Operations Overview
        </h1>
        <div
          data-testid="link-status"
          className="flex items-center gap-2 rounded border border-outline-variant bg-surface-container-lowest px-2.5 py-1"
        >
          <span className="relative flex h-2 w-2">
            {connectionStatus === "open" && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-container opacity-75" />
            )}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${status.dot}`} />
          </span>
          <span className={`text-mono-sm tracking-wide ${status.text}`}>{status.label}</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden items-center gap-1.5 text-mono-sm uppercase text-outline xl:flex">
          <ClockIcon className="h-3.5 w-3.5" />
          <span suppressHydrationWarning>
            {now
              ? now.toLocaleString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hour12: false,
                })
              : "—"}
          </span>
        </div>
        <span className="rounded border border-outline-variant bg-surface-container px-2 py-1 text-mono-sm text-on-surface-variant">
          SoMa Sector · SUMO Digital Twin
        </span>
      </div>
    </header>
  );
}
