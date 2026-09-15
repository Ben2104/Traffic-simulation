"use client";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import Map, { MapRef, useControl } from "react-map-gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer } from "@deck.gl/core";
import type mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  buildIncidentLayer,
  buildSignalLayer,
  buildVehicleIconLayer,
} from "../lib/layers";
import { buildSpriteAtlas } from "../lib/car-sprites";
import {
  DEFAULT_VIEW_STATE,
  DEM_SOURCE_ID,
  DEM_SOURCE_URL,
  EXTRUSION_LAYER_ID,
  INITIAL_MAP_STYLE,
  STYLE_URL,
  TERRAIN_EXAGGERATION,
  mapStyleReducer,
  reapplyPlan,
  type Instruction,
} from "../lib/map-style";
import MapControls from "./MapControls";
import { useSimulationStore } from "../lib/store";
import { interpolateVehicles } from "../lib/interpolation";
import type { TrafficLightApproach, VehicleState } from "../lib/types";

// Vehicle ticks arrive over the WebSocket at this cadence (backend default
// `tick_interval = 0.25` seconds, see apps/api Settings); used to pace the
// rAF-driven interpolation between the previous and current tick's positions.
const TICK_DURATION_MS = 250;

// Same hardcoded host as the WebSocket URL and the incidents fetch in
// page.tsx; no env-var indirection exists in this project yet.
const TRAFFIC_LIGHTS_URL = "http://localhost:8000/traffic-lights";

/**
 * Renders deck.gl layers as a native mapbox-gl control (via MapboxOverlay),
 * so the vehicle layer automatically tracks the base map's camera on every
 * pan/zoom/flyTo. A plain `<DeckGL>` nested inside `<Map>` would NOT do this:
 * DeckGL only inherits a parent map's viewport when DeckGL is the outer
 * component (react-map-gl's `<Map>` nested under it); nested the other way,
 * DeckGL renders its own frozen viewport that never follows the base map.
 *
 * MapboxOverlay also survives setStyle(), which is why the deck.gl layers
 * need no part in the style re-application below.
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
  const [style, dispatch] = useReducer(mapStyleReducer, INITIAL_MAP_STYLE);
  const [buildingsDisabled, setBuildingsDisabled] = useState(false);
  // The underlying mapbox-gl instance is created asynchronously (react-map-gl
  // imports mapbox-gl lazily), so `mapRef.current` is still null on the first
  // commit. `onLoad` fires once that instance exists AND its initial style
  // has finished loading, which is the earliest point `mapRef.current?.getMap()`
  // is usable -- gating the style-wiring effect on it (rather than polling or
  // a ref callback) is what makes that effect ever run at all.
  const [mapReady, setMapReady] = useState(false);

  const incidents = useSimulationStore((s) => s.incidents);
  const signals = useSimulationStore((s) => s.signals);
  const approaches = useSimulationStore((s) => s.approaches);
  const setApproaches = useSimulationStore((s) => s.setApproaches);

  // Built once: rasterising 60 cells on every render would thrash the GPU
  // texture upload. Null under SSR and in jsdom, where the layer falls back.
  const sprites = useMemo(() => buildSpriteAtlas(), []);

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
    // Signal geometry is static, so this runs once. It is also decorative:
    // the API may not be up yet, and first paint must never wait on it.
    let cancelled = false;
    fetch(TRAFFIC_LIGHTS_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data: { approaches: TrafficLightApproach[] }) => {
        if (cancelled || !Array.isArray(data?.approaches)) return;
        setApproaches(data.approaches);
      })
      .catch(() => {
        // Silent on purpose: no signal markers is a degraded map, not a fault.
      });
    return () => {
      cancelled = true;
    };
  }, [setApproaches]);

  useEffect(() => {
    if (flyToTarget && mapRef.current) {
      mapRef.current.flyTo({
        center: [flyToTarget.lng, flyToTarget.lat],
        zoom: 17,
        duration: 2000,
      });
    }
  }, [flyToTarget]);

  /** Executes one instruction from the re-apply plan against the live map. */
  const runInstruction = useCallback((map: mapboxgl.Map, instruction: Instruction) => {
    switch (instruction.op) {
      case "setConfigProperty":
        map.setConfigProperty("basemap", instruction.property, instruction.value);
        break;

      case "addExtrusionLayer": {
        if (map.getLayer(EXTRUSION_LAYER_ID)) break;
        // Classic styles carry building footprints with a `height` property on
        // the composite source. If this style does not, withdraw the toggle
        // rather than throwing.
        if (!map.getSource("composite")) {
          setBuildingsDisabled(true);
          break;
        }
        setBuildingsDisabled(false);
        map.addLayer({
          id: EXTRUSION_LAYER_ID,
          type: "fill-extrusion",
          source: "composite",
          "source-layer": "building",
          filter: ["==", "extrude", "true"],
          minzoom: 14,
          paint: {
            "fill-extrusion-color": "#8d949e",
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-base": ["get", "min_height"],
            "fill-extrusion-opacity": 0.7,
          },
        });
        break;
      }

      case "removeExtrusionLayer":
        if (map.getLayer(EXTRUSION_LAYER_ID)) map.removeLayer(EXTRUSION_LAYER_ID);
        break;

      case "addTerrain":
        if (!map.getSource(DEM_SOURCE_ID)) {
          map.addSource(DEM_SOURCE_ID, {
            type: "raster-dem",
            url: DEM_SOURCE_URL,
            tileSize: 512,
            maxzoom: 14,
          });
        }
        map.setTerrain({ source: DEM_SOURCE_ID, exaggeration: TERRAIN_EXAGGERATION });
        break;

      case "removeTerrain":
        map.setTerrain(null);
        break;
    }
  }, []);

  const applyStyle = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || !map.isStyleLoaded()) return;
    for (const instruction of reapplyPlan(style)) runInstruction(map, instruction);
  }, [style, runInstruction]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    // setStyle() destroys every custom source and layer, so the full plan is
    // replayed on each style load. Map-level listeners survive setStyle, and
    // this handler is the ONLY path that adds these sources and layers --
    // toggling merely changes state and re-runs the same function.
    map.on("style.load", applyStyle);
    // Eager, deliberate: by the time `mapReady` flips (onLoad fired), the
    // initial style has already finished loading, so this call is what
    // actually applies the very first plan -- the "style.load" handler above
    // only covers basemap switches from here on.
    applyStyle();
    return () => {
      map.off("style.load", applyStyle);
    };
  }, [applyStyle, mapReady]);

  return (
    <>
      <MapControls
        state={style}
        dispatch={dispatch}
        // The toggle is always valid on Standard -- it owns its own buildings
        // via setConfigProperty and never runs addExtrusionLayer at all, so
        // `buildingsDisabled` (a leftover from a *previous* satellite visit)
        // must never leak into that branch. Structural, not another flag to
        // track: the only basemap that can withdraw the toggle is satellite.
        buildingsDisabled={style.basemap === "satellite" && buildingsDisabled}
      />
      <Map
        ref={mapRef}
        mapboxAccessToken={mapboxToken}
        initialViewState={DEFAULT_VIEW_STATE}
        mapStyle={STYLE_URL[style.basemap]}
        onLoad={() => setMapReady(true)}
      >
        {/* Signals first (ground furniture), then vehicles, then incidents on
            top so the demo's climax is never occluded by traffic. */}
        <DeckGLOverlay
          layers={[
            buildSignalLayer(approaches, signals),
            buildVehicleIconLayer(displayedVehicles, sprites),
            buildIncidentLayer(incidents),
          ]}
        />
      </Map>
    </>
  );
}
