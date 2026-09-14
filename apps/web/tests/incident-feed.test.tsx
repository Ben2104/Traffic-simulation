import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import IncidentFeed from "../components/IncidentFeed";
import { useSimulationStore } from "../lib/store";

describe("IncidentFeed", () => {
  beforeEach(() => {
    useSimulationStore.setState({
      incidents: [
        {
          id: "INC-1042",
          kind: "collision",
          severity: "HIGH",
          location: { lat: 1, lng: 2, edge_id: "AB" },
          vehicles_involved: ["car-1"],
          created_at: "2026-09-12T00:00:00Z",
        },
      ],
    });
  });

  it("calls onSelectIncident with the clicked incident", () => {
    const onSelectIncident = vi.fn();
    render(<IncidentFeed onSelectIncident={onSelectIncident} selectedIncidentId={null} />);
    fireEvent.click(screen.getByTestId("incident-INC-1042"));
    expect(onSelectIncident).toHaveBeenCalledWith(expect.objectContaining({ id: "INC-1042" }));
  });
});
