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
    gebietsumrissSpeicher,
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
    verworfeneFragenMelden,
} from "@/lib/context";
import {
    gebietskennung,
    umrissAblegen,
    umrissBesorgen,
} from "@/lib/gebietsumriss";
import { DEFAULT_VIEWPORT } from "@hideandseek/shared";
import { locale, t } from "@/i18n";
import { cn } from "@/lib/utils";
import { applyQuestionsToMapGeoData, holedMask } from "@/maps";
import { hiderifyQuestion } from "@/maps";
import { clearCache, determineMapBoundaries } from "@/maps/api";

import { activeHidingZone, pendingDraftKey, revealedHidingZone, sessionParticipant } from "@/lib/session-context";
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
            const kennung = gebietskennung(
                locationAtStart,
                additionalMapGeoLocations.get(),
            );
            const gespeichert = gebietsumrissSpeicher.get();

            if (polyGeoData) {
                // Ein selbst gezeichnetes oder geladenes Vieleck hat Vorrang.
                mapGeoData = polyGeoData;
                mapGeoJSON.set(polyGeoData);
            } else if (kennung !== null && gespeichert?.kennung === kennung) {
                // Umriss aus einem frueheren Abruf, fuer genau dieses Gebiet.
                // Spart den Netzabruf beim Start der App - der Grund, warum die
                // Karte nach einem Neustart eine Weile unbeschraenkt aussah.
                mapGeoData = gespeichert.umriss;
                mapGeoJSON.set(gespeichert.umriss);
            } else {
                const ergebnis = await umrissBesorgen({
                    holen: determineMapBoundaries,
                    // Wechselt das Gebiet mitten im Abruf (z. B. der Suchende
                    // tritt bei), passt das Ergebnis nicht mehr. Vergleich ueber
                    // osm_id, weil applyServerMapLocation fuer dasselbe Gebiet
                    // ein neues Objekt anlegt und === immer fehlschlagen wuerde.
                    nochGueltig: () =>
                        (mapGeoLocation.get() as any)?.properties?.osm_id ===
                        osmIdAtStart,
                    warten: (ms) =>
                        new Promise((fertig) => setTimeout(fertig, ms)),
                    // Die ueberlappenden Laeufe beim Start teilen sich einen
                    // Abruf, statt dieselbe Abfrage mehrfach zu schicken.
                    schluessel: kennung,
                });

                if (ergebnis.ok) {
                    mapGeoJSON.set(ergebnis.umriss);
                    mapGeoData = ergebnis.umriss;

                    // Ob der Umriss abgelegt werden darf, entscheidet
                    // `umrissAblegen` - samt der Neuerhebung der Kennung und
                    // dem Abfangen eines vollen localStorage. Beides steht
                    // dort und nicht hier, damit es einen Test hat: diese
                    // Datei ist wegen Leaflet nicht pruefbar.
                    const stand = umrissAblegen({
                        kennungVorher: kennung,
                        kennungJetzt: () =>
                            gebietskennung(
                                mapGeoLocation.get(),
                                additionalMapGeoLocations.get(),
                            ),
                        umriss: ergebnis.umriss,
                        ablegen: (eintrag) =>
                            gebietsumrissSpeicher.set(eintrag),
                    });
                    if (stand === "gescheitert") {
                        console.warn(
                            "[Map] Gebietsumriss nicht gespeichert, vermutlich voller Speicher",
                        );
                    }
                } else if (ergebnis.grund === "fehler") {
                    // Frueher verschluckte ein .catch(console.log) diesen Fehler,
                    // und weil das ueberwachte Versprechen damit erfuellt war,
                    // erschien nicht einmal eine Meldung: Der Spieler sah eine
                    // unbeschraenkte Karte und hatte keinen Hinweis darauf.
                    console.error(
                        "[Map] Gebietsumriss nach",
                        ergebnis.versuche,
                        "Versuchen nicht geladen:",
                        ergebnis.fehler,
                    );
                    toast.error(t("toast.map.boundaryMissing", locale.get()), {
                        toastId: "map-boundary-missing",
                    });
                }
                // grund === "veraltet": stillschweigend weiter, der Lauf fuer
                // das neue Gebiet wird unten eingeplant.
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

                // Der Entwurf des Seekers bleibt vom Schnitt ausgenommen. Punkt B
                // ist bis zum Ende der Strecke geraten, 100 m oestlich von A, und
                // das Schema setzt warmer auf true: die Karte wuerde die halbe
                // Flaeche wegschneiden, bevor der Hider ueberhaupt geantwortet hat.
                // Im Atom bleibt der Entwurf, dort haengen die ziehbaren A/B-Marker
                // und der Absende-Knopf. Nach dem Absenden ist pendingDraftKey null,
                // dann schneidet die Frage wie jede andere.
                const entwurfsKey = pendingDraftKey.get();
                const gebaut = await applyQuestionsToMapGeoData(
                    $questions.filter((q) => q.key !== entwurfsKey),
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

    // Beim Lesen der gespeicherten Fragen wurde etwas verworfen (siehe
    // fragenLesen in lib/context.ts). Die Meldung kann nicht von dort kommen:
    // `decode` laeuft in `restore()` innerhalb von `onMount`, also waehrend
    // eines Renders. Hier ist sie richtig, weil das `useStore(questions)` oben
    // genau dieses Lesen ausloest - der Merker steht also, wenn dieser Effekt
    // laeuft - und weil die uebrigen Meldungen zum Kartenzustand ebenfalls hier
    // stehen (toast.map.boundaryMissing oben in refreshQuestions).
    useEffect(() => {
        verworfeneFragenMelden(() =>
            toast.error(t("toast.map.questionsDropped", locale.get()), {
                toastId: "map-questions-dropped",
            }),
        );
    }, []);

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
