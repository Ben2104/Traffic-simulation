/**
 * Severity → tactical signal colour, per the "Mission Tactical" design system.
 *
 * The API types `severity` as a free-form string (apps/api
 * `app/incidents/models.py`) and today only ever emits "HIGH", so every lookup
 * is case-insensitive and falls back to the neutral outline treatment rather
 * than assuming a closed set.
 */
export interface SeverityStyle {
  /** Uppercase label as rendered on the incident ticket. */
  label: string;
  /** Left accent bar + chip text colour. */
  text: string;
  /** Chip background. */
  chipBg: string;
  /** Chip / card border. */
  border: string;
  /** Accent bar background (solid). */
  bar: string;
}

const STYLES: Record<string, SeverityStyle> = {
  CRITICAL: {
    label: "CRITICAL",
    text: "text-error",
    chipBg: "bg-error-container/40",
    border: "border-error/50",
    bar: "bg-error",
  },
  HIGH: {
    label: "HIGH",
    text: "text-error",
    chipBg: "bg-error-container/25",
    border: "border-error/40",
    bar: "bg-error",
  },
  MEDIUM: {
    label: "MEDIUM",
    text: "text-warning",
    chipBg: "bg-warning/10",
    border: "border-warning/40",
    bar: "bg-warning",
  },
  LOW: {
    label: "LOW",
    text: "text-primary",
    chipBg: "bg-primary-container/10",
    border: "border-primary-container/40",
    bar: "bg-primary-container",
  },
};

const UNKNOWN: SeverityStyle = {
  label: "UNKNOWN",
  text: "text-on-surface-variant",
  chipBg: "bg-surface-container-high",
  border: "border-outline-variant",
  bar: "bg-outline",
};

export function severityStyle(severity: string): SeverityStyle {
  const style = STYLES[severity.toUpperCase()];
  if (style) return style;
  // Preserve whatever the backend sent so an unmapped severity is still
  // legible on the ticket instead of being flattened to "UNKNOWN".
  return { ...UNKNOWN, label: severity.toUpperCase() || UNKNOWN.label };
}

/** Severities that count toward the "High Priority" KPI tile. */
export function isHighPriority(severity: string): boolean {
  const normalized = severity.toUpperCase();
  return normalized === "HIGH" || normalized === "CRITICAL";
}

/** "collision" -> "Collision", "red_light_violation" -> "Red Light Violation" */
export function formatKind(kind: string): string {
  return kind
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}
