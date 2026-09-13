import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import DashboardPage from "../app/page";

describe("DashboardPage", () => {
  it("renders the three-pane layout", () => {
    render(<DashboardPage />);
    expect(screen.getByTestId("incident-feed")).toBeInTheDocument();
    expect(screen.getByTestId("map-view")).toBeInTheDocument();
    expect(screen.getByTestId("incident-detail")).toBeInTheDocument();
  });
});
