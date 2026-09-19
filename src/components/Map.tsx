import "leaflet/dist/leaflet.css";

import { useStore } from "@nanostores/react";
import * as turf from "@turf/turf";
import * as L from "leaflet";
import { useEffect, useMemo } from "react";
import { MapContainer, ScaleControl, TileLayer, useMapEvents } from "react-leaflet";
import { toast } from "react-toastify";

import {
    additionalMapGeoLocations,
    animateMapMovements,
    autoZoom,
    hiderMode,
    highlightTrainLines,
    isLoading,
    leafletMapContext,
    mapGeoJSON,
    mapGeoLocation,
    planningModeEnabled,
    polyGeoJSON,
    questionFinishedMapData,
    questions,
    thunderforestApiKey,
    triggerLocalRefresh,
} from "@/lib/context";
import { DEFAULT_VIEWPORT } from "@hideandseek/shared";
import { locale, t } from "@/i18n";
import { cn } from "@/lib/utils";
import { applyQuestionsToMapGeoData, holedMask } from "@/maps";
import { hiderifyQuestion } from "@/maps";
import { clearCache, determineMapBoundaries } from "@/maps/api";

import { activeHidingZone, revealedHidingZone, sessionParticipant } from "@/lib/session-context";
import { bottomSheetState } from "@/lib/bottom-sheet-state";
import { DraggableMarkers } from "./DraggableMarkers";
import { ebenenTauschen } from "./map-ebenen-tausch";
import { PlayerMarkers } from "./PlayerMarkers";
import { LeafletFullScreenButton } from "./LeafletFullScreenButton";
import { MapPrint } from "./MapPrint";
import { PolygonDraw } from "./PolygonDraw";
import { ThermometerGpsLayer } from "./ThermometerGpsLayer";
import { HidingTimerOverlay } from "./HidingTimerOverlay";

/**
 * Kachel-URL der CARTO-Grundkarte.
 *
 * CARTO verlangt fuer die Raster-Kacheln einen Schluessel. Ohne ihn kommt die
 * Kachel weiterhin mit HTTP 200 und als gueltiges PNG zurueck, nur mit
 * "API KEY REQUIRED" ueber dem Bild - Leaflet hat also nichts, woran es sich
 * stoeren koennte, und es gibt nichts abzufangen.
 *
 * Der Schluessel kommt zur Bauzeit aus PUBLIC_CARTO_API_KEY (siehe
 * .env.example). Ist er nicht gesetzt, bleibt es bei der URL ohne Parameter,
 * damit ein Bau ohne .env durchlaeuft.
 */
const CARTO_TILE_URL =
    "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" +
    (import.meta.env.PUBLIC_CARTO_API_KEY
        ? `?key=${import.meta.env.PUBLIC_CARTO_API_KEY}`
        : "");

/**
 * Collapses the bottom sheet when the user left-clicks on the map.
 * Must be rendered inside a <MapContainer> to use useMapEvents.
 */
function MapClickHandler() {
    useMapEvents({
        click: () => {
            if (bottomSheetState.get() !== "collapsed") {
                bottomSheetState.set("collapsed");
            }
        },
    });
    return null;
}

export const Map = ({ className }: { className?: string }) => {
    useStore(additionalMapGeoLocations);
    const $mapGeoLocation = useStore(mapGeoLocation);
    const $questions = useStore(questions);
    const $highlightTrainLines = useStore(highlightTrainLines);
    const $thunderforestApiKey = useStore(thunderforestApiKey);
    const $hiderMode = useStore(hiderMode);
    const $isLoading = useStore(isLoading);
    const map = useStore(leafletMapContext);

    const refreshQuestions = async (focus: boolean = false) => {
        if (!map) return;

        // Read directly from the atom, not the closure snapshot. The setTimeout
        // retry path (further below) calls the stale closure where $isLoading
        // was still true, so we must check the live atom value here.
        if (isLoading.get()) return;

        isLoading.set(true);

        if ($questions.length === 0) {
            await clearCache();
        }

        // Snapshot location before any async work so we can detect mid-fetch changes.
        // Use osm_id for stable comparison — applyServerMapLocation creates new
        // object references for the same logical location, so === would always fail.
        const locationAtStart = mapGeoLocation.get();
        const osmIdAtStart = (locationAtStart as any)?.properties?.osm_id;
        let mapGeoData = mapGeoJSON.get();

        if (!mapGeoData) {
            const polyGeoData = polyGeoJSON.get();
            if (polyGeoData) {
                mapGeoData = polyGeoData;
                mapGeoJSON.set(polyGeoData);
            } else {
                await toast.promise(
                    determineMapBoundaries()
                        .then((x) => {
                            // Only cache the result when the location hasn't changed
                            // during the async Overpass fetch (race-condition guard).
                            // Compare by osm_id (stable) instead of object reference.
                            const currentOsmId = (mapGeoLocation.get() as any)?.properties?.osm_id;
                            if (currentOsmId === osmIdAtStart) {
                                mapGeoJSON.set(x);
                                mapGeoData = x;
                            }
                        })
                        .catch((error) => console.log(error)),
                    {
                        error: "Error refreshing map data",
                    },
                );
            }
        }

        // Location changed while we were loading (e.g. Seeker joined mid-fetch):
        // the stale boundary was discarded above. Reset loading and schedule a
        // fresh fetch for the new location.
        if (!mapGeoData) {
            isLoading.set(false);
            const currentOsmId = (mapGeoLocation.get() as any)?.properties?.osm_id;
            if (currentOsmId !== osmIdAtStart) {
                setTimeout(() => refreshQuestions(true), 0);
            }
            return;
        }

        if ($hiderMode !== false) {
            for (const question of $questions) {
                await hiderifyQuestion(question);
            }

            triggerLocalRefresh.set(Math.random()); // Refresh the question sidebar with new information but not this map
        }

        try {
            // Erst bauen, dann tauschen: die vorhandenen Ebenen bleiben stehen,
            // bis die neuen fertig sind. Wirft der Aufbau, behaelt der Spieler
            // seine Ansicht statt einer leeren Karte.
            const eingangsGeoData = mapGeoData;

            mapGeoData = await ebenenTauschen(map, async () => {
                // Sammelbehaelter: die Gruppe kommt nie auf die Karte, ihre
                // Ebenen werden einzeln gesetzt – sonst stimmen die Zaehlungen
                // ueber questionKey / eliminationGeoJSON nicht mehr.
                const neueEbenen = L.layerGroup();

                const gebaut = await applyQuestionsToMapGeoData(
                    $questions,
                    eingangsGeoData,
                    planningModeEnabled.get(),
                    (geoJSONObj, question) => {
                        const geoJSONPlane = L.geoJSON(geoJSONObj);
                        // @ts-expect-error This is a check such that only this type of layer is removed
                        geoJSONPlane.questionKey = question.key;
                        neueEbenen.addLayer(geoJSONPlane);
                    },
                );

                const maskiert = {
                    type: "FeatureCollection" as const,
                    features: [holedMask(gebaut!)!],
                };

                const g = L.geoJSON(maskiert);
                // @ts-expect-error This is a check such that only this type of layer is removed
                g.eliminationGeoJSON = true;
                neueEbenen.addLayer(g);

                return { ebenen: neueEbenen.getLayers(), daten: maskiert };
            });

            questionFinishedMapData.set(mapGeoData);

            if (autoZoom.get() && focus) {
                const bbox = turf.bbox(holedMask(mapGeoData) as any);
                const bounds = [
                    [bbox[1], bbox[0]],
                    [bbox[3], bbox[2]],
                ];

                if (animateMapMovements.get()) {
                    map.flyToBounds(bounds as any);
                } else {
                    map.fitBounds(bounds as any);
                }
            }
        } catch (error) {
            console.error(error);

            isLoading.set(false);
            // Feste toastId statt DOM-Abfrage: react-toastify entdoppelt damit
            // zuverlaessig, auch wenn gerade ein anderer Toast sichtbar ist.
            toast.error(t("toast.map.refreshFailed", locale.get()), {
                toastId: "map-refresh-failed",
            });
        } finally {
            isLoading.set(false);
            // If location changed while we processed questions, re-run for
            // the new location (handles the Seeker-join race condition when
            // mapGeoJSON was already populated before applyServerMapLocation ran).
            const finalOsmId = (mapGeoLocation.get() as any)?.properties?.osm_id;
            if (finalOsmId !== osmIdAtStart) {
                setTimeout(() => refreshQuestions(true), 0);
            }
        }
    };

    const displayMap = useMemo(
        () => (
            <MapContainer
                center={DEFAULT_VIEWPORT.center}
                zoom={DEFAULT_VIEWPORT.zoom}
                className={cn("w-[500px] h-[500px]", className)}
                ref={leafletMapContext.set}
            >
                {!($highlightTrainLines && $thunderforestApiKey) && (
                    <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors; &copy; <a href="https://carto.com/attributions">CARTO</a>; &copy; <a href="http://www.thunderforest.com/">Thunderforest</a>; Powered by Esri and Turf.js'
                        url={CARTO_TILE_URL}
                        subdomains="abcd"
                        maxZoom={20} // This technically should be 6, but once the ratelimiting starts this can take over
                        minZoom={2}
                        noWrap
                    />
                )}
                {$highlightTrainLines && $thunderforestApiKey && (
                    <TileLayer
                        url={`https://tile.thunderforest.com/transport/{z}/{x}/{y}.png?apikey=${$thunderforestApiKey}`}
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors; &copy; <a href="https://carto.com/attributions">CARTO</a>; &copy; <a href="http://www.thunderforest.com/">Thunderforest</a>; Powered by Esri and Turf.js'
                        maxZoom={22}
                        minZoom={2}
                        noWrap
                    />
                )}
                <MapClickHandler />
                <DraggableMarkers />
                <PlayerMarkers />
                <ThermometerGpsLayer />
                <HidingTimerOverlay />
                <div className="leaflet-top leaflet-right">
                    <div className="leaflet-control flex-col flex gap-2">
                        <LeafletFullScreenButton />
                    </div>
                </div>
                <PolygonDraw />
                <ScaleControl position="bottomleft" />
                {/* <MapPrint
                    position="topright"
                    sizeModes={["Current", "A4Portrait", "A4Landscape"]}
                    hideControlContainer={false}
                    hideClasses={[
                        "leaflet-full-screen-specific-name",
                        "leaflet-top",
                        "leaflet-control-easyPrint",
                        "leaflet-draw",
                    ]}
                    title="Print"
                /> */}
            </MapContainer>
        ),
        [map, $highlightTrainLines, $thunderforestApiKey],
    );

    useEffect(() => {
        if (!map) return;

        refreshQuestions(true);
    }, [$questions, map, $hiderMode, $mapGeoLocation]);

    useEffect(() => {
        const intervalId = setInterval(async () => {
            if (!map) return;
            let layerCount = 0;
            map.eachLayer((layer: any) => {
                if (layer.eliminationGeoJSON) {
                    // Hopefully only geoJSON layers
                    layerCount++;
                }
            });
            if (layerCount > 1) {
                console.log("Too many layers, refreshing...");
                refreshQuestions(false);
            }
        }, 1000);

        return () => clearInterval(intervalId);
    }, [map]);

    useEffect(() => {
        const handleFullscreenChange = () => {
            const mainElement: HTMLElement | null =
                document.querySelector("main");

            if (mainElement) {
                if (document.fullscreenElement) {
                    mainElement.classList.add("fullscreen");
                } else {
                    mainElement.classList.remove("fullscreen");
                }
            }
        };

        document.addEventListener("fullscreenchange", handleFullscreenChange);

        return () => {
            document.removeEventListener(
                "fullscreenchange",
                handleFullscreenChange,
            );
        };
    }, []);

    // ── Persistent hiding zone circle ────────────────────────────────────────
    useEffect(() => {
        if (!map) return;

        function drawZoneCircle() {
            map!.eachLayer((layer: any) => {
                if (layer.hidingZoneActive) map!.removeLayer(layer);
            });

            const role = sessionParticipant.get()?.role;
            const zone = role === "hider"
                ? activeHidingZone.get()
                : revealedHidingZone.get();

            if (!zone) return;

            const radiusM = zone.radiusUnit === "miles"
                ? zone.radius * 1609.34
                : zone.radius * 1000;

            const circle = L.circle([zone.lat, zone.lng], {
                radius: radiusM,
                color: "#22C55E",
                fillColor: "#22C55E",
                fillOpacity: 0.15,
                weight: 2,
            }) as any;
            circle.hidingZoneActive = true;
            circle.addTo(map!);
            circle.bindPopup(`<b>${zone.stationName}</b>`);
        }

        drawZoneCircle();

        const unsub1 = activeHidingZone.subscribe(drawZoneCircle);
        const unsub2 = revealedHidingZone.subscribe(drawZoneCircle);

        return () => {
            unsub1();
            unsub2();
            map.eachLayer((layer: any) => {
                if (layer.hidingZoneActive) map.removeLayer(layer);
            });
        };
    }, [map]);

    return displayMap;
};
