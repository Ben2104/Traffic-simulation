import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import IncidentToast from "../components/IncidentToast";
import { useSimulationStore } from "../lib/store";

describe("IncidentToast", () => {
  beforeEach(() => {
    useSimulationStore.setState({
      incidents: [
        {
          id: "INC-1042",
          kind: "collision",
          severity: "HIGH",
          location: { lat: 1, lng: 2, edge_id: "AB" },
          vehicles_involved: [],
          created_at: "2026-09-12T00:00:00Z",
        },
      ],
    });
  });

  it("shows the latest incident and hides it after dismiss", () => {
    render(<IncidentToast />);
    expect(screen.getByTestId("incident-toast")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Dismiss"));
    expect(screen.queryByTestId("incident-toast")).not.toBeInTheDocument();
  });
});
