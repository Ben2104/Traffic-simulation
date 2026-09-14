import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import IncidentToast from "../components/IncidentToast";
import { useSimulationStore } from "../lib/store";
import type { Incident } from "../lib/types";

const initialState = useSimulationStore.getState();

beforeEach(() => {
  // Replace-state reset (same pattern as tests/store.test.ts) so no test's
  // leftover incidents can leak into another test and mask a real failure.
  useSimulationStore.setState(initialState, true);
});

const incidentA: Incident = {
  id: "INC-1001",
  kind: "collision",
  severity: "HIGH",
  location: { lat: 1, lng: 2, edge_id: "AB" },
  vehicles_involved: [],
  created_at: "2026-09-12T00:00:00Z",
};

const incidentB: Incident = {
  id: "INC-1002",
  kind: "stall",
  severity: "LOW",
  location: { lat: 3, lng: 4, edge_id: "CD" },
  vehicles_involved: [],
  created_at: "2026-09-12T00:05:00Z",
};

describe("IncidentToast", () => {
  it("shows the latest incident and hides it after dismiss", () => {
    useSimulationStore.setState({ incidents: [incidentA] });
    render(<IncidentToast />);
    expect(screen.getByTestId("incident-toast")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Dismiss"));
    expect(screen.queryByTestId("incident-toast")).not.toBeInTheDocument();
  });

  it("shows the most recently arrived incident (array index 0), not the first one ever seen", () => {
    // Drive the store through handleMessage with two real incident.created
    // messages, exactly as the WebSocket would deliver them, arriving in
    // INC-1001 then INC-1002 order. The store prepends (newest-first), so
    // INC-1002 must end up at index 0 and INC-1001 at index 1. This pins
    // both the toast's index arithmetic AND the store's ordering contract.
    useSimulationStore.getState().handleMessage({ type: "incident.created", incident: incidentA });
    useSimulationStore.getState().handleMessage({ type: "incident.created", incident: incidentB });
    expect(useSimulationStore.getState().incidents).toEqual([incidentB, incidentA]);

    render(<IncidentToast />);

    // Must show the newest incident (INC-1002), not the oldest (INC-1001).
    // Under the buggy incidents[incidents.length - 1] indexing this would
    // show INC-1001 instead and this assertion would fail.
    expect(screen.getByText(/INC-1002/)).toBeInTheDocument();
    expect(screen.queryByText(/INC-1001/)).not.toBeInTheDocument();
  });
});
