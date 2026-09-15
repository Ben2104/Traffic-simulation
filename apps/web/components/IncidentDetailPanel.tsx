import type { Incident } from "../lib/types";
import { formatKind, severityStyle } from "../lib/severity";
import { CarIcon, PinIcon, ShieldIcon, WarningIcon } from "./icons";

export interface IncidentDetailPanelProps {
  incident: Incident | null;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-outline-variant/50 py-1.5 last:border-b-0">
      <span className="text-label-caps shrink-0 text-outline">{label}</span>
      <span className="truncate text-mono-md text-on-surface">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-outline-variant bg-surface-container-low">
      <h3 className="text-label-caps border-b border-outline-variant bg-surface-container px-3 py-1.5 text-primary">
        {title}
      </h3>
      <div className="px-3 py-2">{children}</div>
    </section>
  );
}

/**
 * Incident telemetry drawer, styled after the Stitch "Incident Details
 * Drawer" frame. The frame includes camera evidence feeds and a dispatch
 * action log; this system emits neither, so those panels are omitted rather
 * than mocked — what is shown is exactly what `Incident` carries.
 */
export default function IncidentDetailPanel({ incident }: IncidentDetailPanelProps) {
  if (!incident) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-surface-container-lowest px-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-outline-variant bg-surface-container text-outline">
          <ShieldIcon className="h-6 w-6" />
        </div>
        <p className="text-body-md text-on-surface-variant">
          Select an incident to see details.
        </p>
        <p className="text-mono-sm text-outline">
          Selecting a ticket flies the tactical camera to its coordinates.
        </p>
      </div>
    );
  }

  const style = severityStyle(incident.severity);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto bg-surface-container-lowest p-3">
      <header className="rounded border border-outline-variant bg-surface-container-low p-3">
        <div className="flex items-center gap-2">
          <span
            className={`rounded border px-1.5 py-0.5 text-mono-sm font-bold uppercase ${style.chipBg} ${style.border} ${style.text}`}
          >
            {style.label}
          </span>
          <span className="flex items-center gap-1 text-mono-sm text-outline">
            <WarningIcon className="h-3 w-3" />
            Incident Record
          </span>
        </div>
        {/* Rendered bare (no "#" prefix) so the id is addressable as its own
            exact text node — the dashboard test asserts on it directly. */}
        <h2 className="mt-2 text-headline-sm font-bold tracking-tight text-primary">
          {incident.id}
        </h2>
        <p className="mt-0.5 text-body-md text-on-surface">{formatKind(incident.kind)}</p>
      </header>

      <Section title="Core Incident Telemetry">
        <Row label="Severity" value={incident.severity} />
        <Row label="Kind" value={incident.kind} />
        <Row label="Network Edge" value={incident.location.edge_id} />
        <Row label="Latitude" value={incident.location.lat.toFixed(6)} />
        <Row label="Longitude" value={incident.location.lng.toFixed(6)} />
        <Row label="Detected" value={incident.created_at} />
      </Section>

      <Section title="Vehicles Involved">
        {incident.vehicles_involved.length === 0 ? (
          <p className="py-1 text-mono-sm text-outline">No vehicles reported for this incident.</p>
        ) : (
          <ul className="space-y-1.5">
            {incident.vehicles_involved.map((vehicleId) => (
              <li
                key={vehicleId}
                className="flex items-center gap-2 rounded border border-outline-variant bg-surface-container px-2 py-1.5 text-mono-md text-on-surface"
              >
                <CarIcon className="h-3.5 w-3.5 text-primary-container" />
                {vehicleId}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="mt-auto flex items-center gap-2 rounded border border-outline-variant bg-surface-container-low px-3 py-2 text-mono-sm text-outline">
        <PinIcon className="h-3.5 w-3.5 shrink-0 text-primary-container" />
        Camera locked to {incident.location.lat.toFixed(5)}, {incident.location.lng.toFixed(5)}
      </div>
    </div>
  );
}
