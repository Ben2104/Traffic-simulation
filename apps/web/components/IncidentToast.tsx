"use client";
import { useState } from "react";
import { useSimulationStore } from "../lib/store";
import { formatKind, severityStyle } from "../lib/severity";
import { CloseIcon, WarningIcon } from "./icons";

/**
 * Critical-alert banner overlaid on the map, per the Stitch "Operations
 * Overview" frame's incident dispatch toast.
 */
export default function IncidentToast() {
  const incidents = useSimulationStore((s) => s.incidents);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  // incidents is ordered newest-first (the store prepends new incidents),
  // so the latest incident is at index 0, not the last index.
  const latest = incidents[0];

  if (!latest || dismissedIds.has(latest.id)) return null;

  const style = severityStyle(latest.severity);

  return (
    <div
      data-testid="incident-toast"
      role="alert"
      className={`pointer-events-auto absolute bottom-4 left-1/2 z-20 w-[min(30rem,calc(100%-2rem))] -translate-x-1/2 rounded border ${style.border} bg-surface-container-high/95 shadow-[0_0_24px_rgba(0,0,0,0.55)] backdrop-blur-sm`}
    >
      <span className={`block h-0.5 w-full rounded-t ${style.bar}`} />
      <div className="flex items-start gap-3 p-3">
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded border ${style.border} ${style.chipBg} ${style.text}`}
        >
          <WarningIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-label-caps ${style.text}`}>
            {style.label} ALERT DISPATCHED — {latest.id}
          </p>
          <p className="mt-1 text-body-sm text-on-surface">
            {formatKind(latest.kind)} detected at edge {latest.location.edge_id}. Select the
            ticket to fly the camera to the scene.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDismissedIds((prev) => new Set(prev).add(latest.id))}
          className="flex shrink-0 items-center gap-1 rounded border border-outline-variant bg-surface-container px-2 py-1 text-mono-sm text-on-surface-variant transition-colors hover:text-on-surface"
        >
          <CloseIcon className="h-3 w-3" />
          Dismiss
        </button>
      </div>
    </div>
  );
}
