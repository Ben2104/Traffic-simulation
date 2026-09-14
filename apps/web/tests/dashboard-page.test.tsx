import React, { act } from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useSimulationStore } from "../lib/store";

// jsdom has no WebGL context, so the real MapView (react-map-gl + deck.gl)
// cannot be rendered here. We mock the module boundary rather than the
// behavior under test: the mock is a plain component that records every
// render's props and how many times it has been mounted, so the layout
// test suite can make real assertions about (a) the surrounding dashboard
// UI (feed/toast/detail/error banner) and (b) the *contract* that clicking
// an incident re-renders MapView with a new flyToTarget without unmounting
// it or touching the WebSocket connection — the single most important
// behavioral requirement of the demo.
const mapViewMock = vi.hoisted(() => ({
  calls: [] as Array<{ mapboxToken: string; flyToTarget: unknown }>,
  mountCount: 0,
}));

function MockMapView(props: { mapboxToken: string; flyToTarget: unknown }) {
  mapViewMock.calls.push(props);
  React.useEffect(() => {
    mapViewMock.mountCount += 1;
  }, []);
  return <div data-testid="mock-map-view" />;
}

vi.mock("../components/MapView", () => ({
  default: MockMapView,
}));

const wsClientMock = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnects: [] as Array<ReturnType<typeof vi.fn>>,
}));

vi.mock("../lib/ws-client", () => ({
  connectSimulationSocket: (...args: unknown[]) => {
    wsClientMock.connect(...args);
    const disconnect = vi.fn();
    wsClientMock.disconnects.push(disconnect);
    return disconnect;
  },
}));

// Import after mocks so the mocked modules are in place when DashboardPage
// (and MapView) are evaluated.
const { default: DashboardPage } = await import("../app/page");

// The page seeds its incident feed from GET /incidents on mount. Stub fetch
// for every test in this file so none of them touch the network; individual
// tests override the resolved payload.
function stubFetch(payload: unknown[] | Error) {
  const mock = vi.fn(async () => {
    if (payload instanceof Error) throw payload;
    return { ok: true, json: async () => payload } as Response;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const apiIncident = (id: string, createdAt: string) => ({
  id,
  kind: "collision",
  severity: "HIGH",
  location: { lat: 37.78, lng: -122.4, edge_id: "XY" },
  vehicles_involved: ["car-1"],
  created_at: createdAt,
});

describe("DashboardPage", () => {
  beforeEach(() => {
    stubFetch([]);
    mapViewMock.calls.length = 0;
    mapViewMock.mountCount = 0;
    wsClientMock.connect.mockClear();
    wsClientMock.disconnects.length = 0;
    useSimulationStore.setState({
      incidents: [],
      errorMessage: null,
      vehicles: [],
      previousVehicles: [],
      connectionStatus: "connecting",
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("seeds the incident feed from GET /incidents on mount, newest first", async () => {
    // GET /incidents returns store-insertion order (oldest first); the feed
    // contract is newest-first, so the page must invert the response.
    const fetchMock = stubFetch([
      apiIncident("INC-1001", "2026-09-13T12:00:00Z"),
      apiIncident("INC-1002", "2026-09-13T12:05:00Z"),
    ]);

    render(<DashboardPage />);

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8000/incidents");

    await waitFor(() => {
      expect(screen.getByTestId("incident-INC-1002")).toBeInTheDocument();
    });
    expect(screen.getByTestId("incident-INC-1001")).toBeInTheDocument();
    expect(useSimulationStore.getState().incidents.map((i) => i.id)).toEqual([
      "INC-1002",
      "INC-1001",
    ]);

    // And a fetched incident is immediately clickable -- the whole point of
    // the seed is that the flyTo beat works after a refresh.
    fireEvent.click(screen.getByTestId("incident-INC-1002"));
    const lastCall = mapViewMock.calls[mapViewMock.calls.length - 1];
    expect(lastCall.flyToTarget).toEqual({ lat: 37.78, lng: -122.4, edge_id: "XY" });
  });

  it("does not crash or show an error banner when GET /incidents fails", async () => {
    stubFetch(new Error("connection refused"));

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId("incident-feed")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("error-banner")).not.toBeInTheDocument();
    expect(useSimulationStore.getState().incidents).toEqual([]);
  });

  it("does not clobber an incident the live stream delivered while the fetch was in flight", async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await pending;
        return { ok: true, json: async () => [apiIncident("INC-1001", "2026-09-13T12:00:00Z")] } as Response;
      })
    );

    render(<DashboardPage />);

    act(() => {
      useSimulationStore.getState().handleMessage({
        type: "incident.created",
        incident: apiIncident("INC-2001", "2026-09-13T13:00:00Z"),
      });
    });

    await act(async () => {
      resolveFetch(undefined);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(useSimulationStore.getState().incidents.map((i) => i.id)).toEqual(["INC-2001"]);
    });
  });

  it("renders the three-pane layout", () => {
    render(<DashboardPage />);
    expect(screen.getByTestId("incident-feed")).toBeInTheDocument();
    expect(screen.getByTestId("map-view")).toBeInTheDocument();
    expect(screen.getByTestId("incident-detail")).toBeInTheDocument();
  });

  it("connects the simulation WebSocket on mount and disconnects on unmount", () => {
    const { unmount } = render(<DashboardPage />);
    expect(wsClientMock.connect).toHaveBeenCalledTimes(1);
    const [options] = wsClientMock.connect.mock.calls[0] as [{ url: string }];
    expect(options.url).toBe("ws://localhost:8000/ws/simulation");
    expect(wsClientMock.disconnects[0]).not.toHaveBeenCalled();

    unmount();

    expect(wsClientMock.disconnects[0]).toHaveBeenCalledTimes(1);
  });

  it("does not leak a socket under React 19 StrictMode double-invoked effects", () => {
    const { unmount } = render(
      <React.StrictMode>
        <DashboardPage />
      </React.StrictMode>
    );

    // React 19 StrictMode double-invokes mount effects in dev/test builds
    // (mount -> cleanup -> mount) to surface effects that aren't safely
    // re-runnable. Every connect must be paired with a disconnect of ITS
    // OWN connection before the next connect happens, and exactly one
    // connection must remain live after settling.
    const connectCount = wsClientMock.connect.mock.calls.length;
    const settledDisconnects = wsClientMock.disconnects.filter((d) => d.mock.calls.length > 0).length;
    expect(connectCount).toBeGreaterThanOrEqual(1);
    expect(settledDisconnects).toBe(connectCount - 1); // all but the live one were cleaned up
    expect(wsClientMock.disconnects[wsClientMock.disconnects.length - 1]).not.toHaveBeenCalled();

    unmount();

    // After a real unmount, the last (live) connection must also be torn down.
    expect(wsClientMock.disconnects[wsClientMock.disconnects.length - 1]).toHaveBeenCalledTimes(1);
  });

  it("clicking an incident ticket updates MapView's flyToTarget without remounting the map or touching the WebSocket", () => {
    useSimulationStore.setState({
      incidents: [
        {
          id: "INC-9001",
          kind: "collision",
          severity: "HIGH",
          location: { lat: 37.78, lng: -122.4, edge_id: "XY" },
          vehicles_involved: ["car-1", "car-2"],
          created_at: "2026-09-13T00:00:00Z",
        },
      ],
    });

    render(<DashboardPage />);

    expect(mapViewMock.mountCount).toBe(1);
    expect(mapViewMock.calls[0].flyToTarget).toBeNull();
    expect(wsClientMock.connect).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("incident-INC-9001"));

    // MapView re-rendered with the new target...
    const lastCall = mapViewMock.calls[mapViewMock.calls.length - 1];
    expect(lastCall.flyToTarget).toEqual({ lat: 37.78, lng: -122.4, edge_id: "XY" });
    // ...but was never remounted (its mount effect fired exactly once)...
    expect(mapViewMock.mountCount).toBe(1);
    // ...and the WebSocket connection was never re-established or torn down.
    expect(wsClientMock.connect).toHaveBeenCalledTimes(1);
    expect(wsClientMock.disconnects[0]).not.toHaveBeenCalled();

    // The detail panel reflects the selection too.
    expect(screen.getByText("INC-9001")).toBeInTheDocument();
  });

  it("shows a dismissible error banner on simulation.error and lets the operator dismiss it", () => {
    render(<DashboardPage />);
    expect(screen.queryByTestId("error-banner")).not.toBeInTheDocument();

    act(() => {
      useSimulationStore.getState().handleMessage({
        type: "simulation.error",
        message: "SUMO connection lost",
      });
    });

    expect(screen.getByTestId("error-banner")).toBeInTheDocument();
    expect(screen.getByText("SUMO connection lost")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Dismiss"));

    expect(screen.queryByTestId("error-banner")).not.toBeInTheDocument();
  });
});
