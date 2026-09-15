import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { useSimulationStore } from "../lib/store";

// react-map-gl needs a real WebGL context, so the map itself is stubbed. What
// is under test here is the wiring: the initial camera, the controls being
// mounted, and the approach fetch -- not Mapbox's rendering.
const initialViewStates: unknown[] = [];

vi.mock("react-map-gl/mapbox", () => ({
  default: (props: { initialViewState: unknown; children: React.ReactNode }) => {
    initialViewStates.push(props.initialViewState);
    return <div data-testid="map-stub">{props.children}</div>;
  },
  useControl: () => ({ setProps: () => {} }),
}));

vi.mock("@deck.gl/mapbox", () => ({ MapboxOverlay: class {} }));

import MapView from "../components/MapView";

describe("MapView", () => {
  beforeEach(() => {
    initialViewStates.length = 0;
    useSimulationStore.setState({ approaches: [], signals: {} });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          approaches: [
            {
              tls_id: "tls-1",
              lane_id: "north_0",
              link_indices: [0],
              lat: 37.7765,
              lng: -122.3946,
              heading: 90,
            },
          ],
        }),
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the camera tilted at zoom 16.5", () => {
    render(<MapView mapboxToken="tok" flyToTarget={null} />);
    expect(initialViewStates[0]).toMatchObject({
      pitch: 45,
      bearing: -17,
      zoom: 16.5,
    });
  });

  it("mounts the map controls", () => {
    render(<MapView mapboxToken="tok" flyToTarget={null} />);
    expect(screen.getByTestId("map-controls")).toBeInTheDocument();
  });

  it("fetches approach geometry once and stores it", async () => {
    render(<MapView mapboxToken="tok" flyToTarget={null} />);
    await waitFor(() => {
      expect(useSimulationStore.getState().approaches).toHaveLength(1);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("http://localhost:8000/traffic-lights");
  });

  it("renders the map even when the approach fetch fails", async () => {
    // Signal geometry is decorative and the API may simply not be up yet.
    // First paint must never be blocked on it.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<MapView mapboxToken="tok" flyToTarget={null} />);
    expect(screen.getByTestId("map-stub")).toBeInTheDocument();
    await waitFor(() => {
      expect(useSimulationStore.getState().approaches).toEqual([]);
    });
  });

  it("does not store approaches on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    );
    render(<MapView mapboxToken="tok" flyToTarget={null} />);
    await waitFor(() => {
      expect(useSimulationStore.getState().approaches).toEqual([]);
    });
  });
});
