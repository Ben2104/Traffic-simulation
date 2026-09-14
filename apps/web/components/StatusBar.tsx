"use client";
import { useSimulationStore } from "../lib/store";

/**
 * Bottom diagnostics strip from the Stitch frames. Every readout here is
 * real store state — connection status, vehicle count, queue depth — so the
 * bar stays a diagnostic surface rather than decoration.
 */
export default function StatusBar() {
  const connectionStatus = useSimulationStore((s) => s.connectionStatus);
  const vehicles = useSimulationStore((s) => s.vehicles);
  const incidents = useSimulationStore((s) => s.incidents);
  const errorMessage = useSimulationStore((s) => s.errorMessage);

  const healthy = connectionStatus === "open" && errorMessage === null;

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-outline-variant bg-surface-container-lowest px-4 text-mono-sm">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${healthy ? "bg-tertiary" : "bg-error"}`}
          />
          <span className={healthy ? "text-tertiary" : "text-error"}>
            {healthy ? "Operator Active" : "Attention Required"}
          </span>
        </span>
        <span className="text-outline">
          WS {connectionStatus.toUpperCase()} · ws://localhost:8000/ws/simulation
        </span>
      </div>

      <div className="flex items-center gap-4 text-outline">
        <span>VEHICLES {vehicles.length}</span>
        <span>QUEUE {incidents.length}</span>
        <span className="uppercase">SUMO · SoMa San Francisco</span>
      </div>
    </footer>
  );
}
