"use client";
import { useEffect, useRef, useState } from "react";
import Map, { MapRef, useControl } from "react-map-gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer } from "@deck.gl/core";
import "mapbox-gl/dist/mapbox-gl.css";
import { buildVehicleLayer } from "../lib/layers";
import { useSimulationStore } from "../lib/store";
import { interpolateVehicles } from "../lib/interpolation";
import type { VehicleState } from "../lib/types";

// SoMa network extent (measured): lon -122.41217..-122.38750, lat 37.77156..37.79076
const SOMA_VIEW = {
  longitude: -122.4,
  latitude: 37.781,
  zoom: 15,
};

// Vehicle ticks arrive over the WebSocket at this cadence (backend default
// `tick_interval = 0.25` seconds, see apps/api Settings); used to pace the
// rAF-driven interpolation between the previous and current tick's positions.
const TICK_DURATION_MS = 250;

/**
 * Renders deck.gl layers as a native mapbox-gl control (via MapboxOverlay),
 * so the vehicle layer automatically tracks the base map's camera on every
 * pan/zoom/flyTo. A plain `<DeckGL>` nested inside `<Map>` would NOT do this:
 * DeckGL only inherits a parent map's viewport when DeckGL is the outer
 * component (react-map-gl's `<Map>` nested under it); nested the other way,
 * DeckGL renders its own frozen viewport that never follows the base map.
 */
function DeckGLOverlay(props: { layers: Layer[] }) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

export interface MapViewProps {
  mapboxToken: string;
  flyToTarget: { lat: number; lng: number } | null;
}

export default function MapView({ mapboxToken, flyToTarget }: MapViewProps) {
  const mapRef = useRef<MapRef | null>(null);
  const [displayedVehicles, setDisplayedVehicles] = useState<VehicleState[]>([]);

  useEffect(() => {
    let rafId: number;

    const tick = () => {
      const { vehicles, previousVehicles, lastTickAt } = useSimulationStore.getState();
      const elapsedMs = Date.now() - lastTickAt;
      setDisplayedVehicles(
        interpolateVehicles(previousVehicles, vehicles, TICK_DURATION_MS, elapsedMs)
      );
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafId);
  }, []);

  useEffect(() => {
    if (flyToTarget && mapRef.current) {
      mapRef.current.flyTo({
        center: [flyToTarget.lng, flyToTarget.lat],
        zoom: 17,
        duration: 2000,
      });
    }
  }, [flyToTarget]);

  return (
    <Map
      ref={mapRef}
      mapboxAccessToken={mapboxToken}
      initialViewState={SOMA_VIEW}
      mapStyle="mapbox://styles/mapbox/dark-v11"
    >
      <DeckGLOverlay layers={[buildVehicleLayer(displayedVehicles)]} />
    </Map>
  );
}
