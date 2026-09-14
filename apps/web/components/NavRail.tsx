"use client";
import { useSimulationStore } from "../lib/store";
import { isHighPriority } from "../lib/severity";
import {
  AnalyticsIcon,
  DashboardIcon,
  DispatchIcon,
  PlayIcon,
  SettingsIcon,
  ShieldIcon,
  WarningIcon,
} from "./icons";

/**
 * Left operator rail from the Stitch "SideNavBar" component.
 *
 * The dashboard is a single view, so only "Overview" is a real destination.
 * The remaining entries are rendered as explicitly disabled controls rather
 * than dead `href="#"` links (as in the frame): they show the intended
 * information architecture without pretending to navigate anywhere.
 */
const PLANNED_VIEWS = [
  { label: "Live Simulation", Icon: PlayIcon },
  { label: "Dispatch", Icon: DispatchIcon },
  { label: "Analytics", Icon: AnalyticsIcon },
  { label: "Settings", Icon: SettingsIcon },
] as const;

export default function NavRail() {
  const incidents = useSimulationStore((s) => s.incidents);
  const connectionStatus = useSimulationStore((s) => s.connectionStatus);
  const highPriority = incidents.filter((i) => isHighPriority(i.severity)).length;
  const online = connectionStatus === "open";

  return (
    <nav
      data-testid="nav-rail"
      aria-label="Operator navigation"
      className="flex h-full w-[260px] shrink-0 flex-col justify-between border-r border-outline-variant bg-surface-container-lowest"
    >
      <div>
        <div className="border-b border-outline-variant p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-outline-variant bg-surface-container text-primary-container">
              <ShieldIcon className="h-5 w-5" />
            </div>
            <div>
              <span className="block text-headline-sm font-bold leading-none tracking-wide text-primary">
                TrafficWatch SF
              </span>
              <span className="mt-1 block text-mono-sm uppercase tracking-wider text-outline">
                TOC-Sector 4
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-1 px-2 py-3">
          <span
            aria-current="page"
            className="flex items-center gap-3 rounded-r border-l-2 border-primary-container bg-surface-container px-3 py-2.5 text-body-md font-semibold text-primary"
          >
            <DashboardIcon className="h-4 w-4 text-primary-container" />
            Overview
          </span>

          <div className="flex items-center justify-between rounded px-3 py-2.5 text-body-md text-on-surface-variant">
            <span className="flex items-center gap-3">
              <WarningIcon className="h-4 w-4" />
              Active Incidents
            </span>
            <span
              data-testid="nav-incident-count"
              className={
                highPriority > 0
                  ? "rounded border border-error/30 bg-error-container px-1.5 py-0.5 text-mono-sm font-bold text-error"
                  : "rounded border border-outline-variant bg-surface-container px-1.5 py-0.5 text-mono-sm font-bold text-on-surface-variant"
              }
            >
              {String(incidents.length).padStart(2, "0")}
            </span>
          </div>

          {PLANNED_VIEWS.map(({ label, Icon }) => (
            <button
              key={label}
              type="button"
              disabled
              title="Not available in this build"
              className="flex w-full cursor-not-allowed items-center gap-3 rounded px-3 py-2.5 text-body-md text-outline opacity-60"
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-outline-variant p-3">
        <div className="flex items-center justify-between text-mono-sm text-outline">
          <span className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${online ? "bg-tertiary" : "bg-error"}`}
            />
            {online ? "Telemetry Link Active" : "Telemetry Link Down"}
          </span>
          <span className="uppercase">SoMa · SUMO</span>
        </div>
      </div>
    </nav>
  );
}
