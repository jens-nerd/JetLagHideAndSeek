/**
 * ThermometerGpsLayer
 *
 * Mounted **inside** the React-Leaflet MapContainer (sibling of DraggableMarkers)
 * so it keeps running even when the sidebar Sheet is closed.
 *
 * Responsibilities:
 *  - Manage navigator.geolocation.watchPosition lifecycle
 *  - Compute travelled distance and detect stillstand / accuracy warnings
 *  - Auto-stop when target distance is reached
 *  - Render hot / cold Voronoi polygons on the map
 *  - Render a compact tracking-status overlay (top-right corner) via portal
 */
import { useStore } from "@nanostores/react";
import * as turf from "@turf/turf";
import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";
import { Polygon, useMap } from "react-leaflet";
import { toast } from "react-toastify";

import { questions as questionsAtom } from "@/lib/context";
import { bottomSheetState } from "@/lib/bottom-sheet-state";
import {
    pendingDraftKey,
    thermometerGpsTracking,
} from "@/lib/session-context";

// ── Voronoi helper ────────────────────────────────────────────────────────────

/**
 * Returns [coldPolygon, warmPolygon] as arrays of [lat, lng] pairs,
 * or null when the two points are identical (degenerate case).
 */
function computeVoronoi(
    latA: number, lngA: number,
    latB: number, lngB: number,
): [[number, number][], [number, number][]] | null {
    if (latA === latB && lngA === lngB) return null;
    try {
        const midLat = (latA + latB) / 2;
        const midLng = (lngA + lngB) / 2;
        const span = Math.max(
            Math.abs(latA - latB),
            Math.abs(lngA - lngB),
            0.05,
        );
        const pad = span * 3 + 1.5;
        const bbox = [
            midLng - pad, midLat - pad,
            midLng + pad, midLat + pad,
        ] as [number, number, number, number];
        const points = turf.featureCollection([
            turf.point([lngA, latA]),
            turf.point([lngB, latB]),
        ]);
        const voronoi = turf.voronoi(points, { bbox });
        if (!voronoi || voronoi.features.length < 2) return null;

        const toLatLng = (feature: any): [number, number][] =>
            (feature.geometry.coordinates[0] as [number, number][]).map(
                ([lng, lat]) => [lat, lng] as [number, number],
            );

        return [
            toLatLng(voronoi.features[0]),
            toLatLng(voronoi.features[1]),
        ];
    } catch {
        return null;
    }
}

// ── Main component ────────────────────────────────────────────────────────────

export function ThermometerGpsLayer() {
    const tracking = useStore(thermometerGpsTracking);
    const map = useMap();
    // Stable ref so the watchPosition callback always reads current tracking state
    const trackingRef = useRef(tracking);
    trackingRef.current = tracking;

    // ── watchPosition lifecycle ───────────────────────────────────────────────
    // Effect only re-runs when a NEW tracking session starts (questionKey changes),
    // not on every GPS position update.
    useEffect(() => {
        if (!tracking) return;

        const watchId = navigator.geolocation.watchPosition(
            (pos) => {
                const current = trackingRef.current;
                if (!current) return; // tracking was cancelled

                const { latitude, longitude, accuracy } = pos.coords;

                // Distance from start (Haversine via turf)
                const traveled = turf.distance(
                    [current.startLng, current.startLat],
                    [longitude, latitude],
                    { units: "kilometers" },
                );

                // Stillstand: consider "moved" if >5 m from last known position
                const movedM =
                    turf.distance(
                        [current.currentLng, current.currentLat],
                        [longitude, latitude],
                        { units: "kilometers" },
                    ) * 1000;
                const lastMoveTime = movedM > 5 ? Date.now() : current.lastMoveTime;

                // ── Auto-stop when target distance is reached ─────────────
                if (traveled >= current.targetKm) {
                    navigator.geolocation.clearWatch(watchId);

                    // Update the draft question with the final B coordinates.
                    // Cast through any to avoid strict union-type mismatch on data shape.
                    const qs = questionsAtom.get();
                    const updated = qs.map((q) => {
                        if (q.key !== current.questionKey) return q;
                        return {
                            ...q,
                            data: { ...(q.data as any), latB: latitude, lngB: longitude },
                        } as typeof q;
                    });
                    questionsAtom.set(updated);

                    // Clear tracking state
                    thermometerGpsTracking.set(null);

                    // Expand bottom sheet so the "Frage senden" button is visible
                    bottomSheetState.set("default");

                    // Haptic feedback
                    navigator.vibrate?.([200, 100, 200]);

                    // Toast
                    toast.success("🎯 Thermometer-Strecke erreicht!");
                    return;
                }

                // ── Regular position update ───────────────────────────────
                thermometerGpsTracking.set({
                    ...current,
                    currentLat: latitude,
                    currentLng: longitude,
                    traveled,
                    lastMoveTime,
                    accuracy: accuracy ?? null,
                    signalLost: false,
                });
            },
            () => {
                const current = trackingRef.current;
                if (!current) return;
                thermometerGpsTracking.set({ ...current, signalLost: true });
            },
            { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
        );

        return () => navigator.geolocation.clearWatch(watchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tracking?.questionKey]);

    if (!tracking) return null;

    const {
        startLat, startLng,
        currentLat, currentLng,
        targetKm, traveled,
        lastMoveTime, accuracy, signalLost,
    } = tracking;

    // ── Computed values ───────────────────────────────────────────────────────
    const remaining = Math.max(0, targetKm - traveled);
    const isStillstanding = Date.now() - lastMoveTime > 30_000;
    const hasAccuracyWarning = accuracy !== null && accuracy > 50;
    const voronoi = computeVoronoi(startLat, startLng, currentLat, currentLng);

    // ── Cancel handler ────────────────────────────────────────────────────────
    function handleCancel() {
        const key = pendingDraftKey.get();
        if (key !== null) {
            questionsAtom.set(questionsAtom.get().filter((q) => q.key !== key));
            pendingDraftKey.set(null);
        }
        thermometerGpsTracking.set(null);
    }

    // ── Format helpers ────────────────────────────────────────────────────────
    function fmtKm(km: number) {
        return km >= 10 ? `${km.toFixed(1)} km` : `${km.toFixed(2)} km`;
    }

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <>
            {/* Hot / cold Voronoi areas */}
            {voronoi && (
                <>
                    {/* Cold area (near A = start) — dark blue */}
                    <Polygon
                        positions={voronoi[0]}
                        pathOptions={{
                            color: "#1a3a6b",
                            fillColor: "#1a3a6b",
                            fillOpacity: 0.18,
                            weight: 1,
                            opacity: 0.4,
                        }}
                    />
                    {/* Warm area (near B = current) — red */}
                    <Polygon
                        positions={voronoi[1]}
                        pathOptions={{
                            color: "#c0392b",
                            fillColor: "#c0392b",
                            fillOpacity: 0.18,
                            weight: 1,
                            opacity: 0.4,
                        }}
                    />
                </>
            )}

            {/* Tracking pill — fixed above the BottomSheet */}
            {createPortal(
                <div
                    className="hs-bottom-sheet"
                    style={{
                        position: "fixed",
                        bottom: 84,
                        left: 0,
                        right: 0,
                        zIndex: 1002,
                        pointerEvents: "auto",
                        padding: "0 8px",
                    }}
                >
                    <div
                        style={{
                            background: "rgba(6,123,194,0.93)",
                            borderRadius: 12,
                            padding: "8px 14px",
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                            backdropFilter: "blur(8px)",
                            boxShadow: "0 -2px 12px rgba(0,0,0,0.3)",
                            borderColor: signalLost || isStillstanding || hasAccuracyWarning
                                ? "#FBBF24"
                                : "transparent",
                            borderWidth: 2,
                            borderStyle: "solid",
                        }}
                    >
                        {/* Row 1: Cold gradient bar Warm + distance */}
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ fontSize: 12 }}>❄️</span>
                            <div style={{
                                flex: 1,
                                height: 8,
                                borderRadius: 4,
                                backgroundColor: "rgba(255,255,255,0.15)",
                                overflow: "hidden",
                            }}>
                                <div style={{
                                    height: "100%",
                                    borderRadius: 4,
                                    width: `${Math.min(100, (traveled / targetKm) * 100).toFixed(1)}%`,
                                    background: "linear-gradient(to right, #2A81CB, #CB2B3E)",
                                    transition: "width 0.5s ease",
                                }} />
                            </div>
                            <span style={{ fontSize: 12 }}>🔥</span>
                            <span style={{
                                color: "#ECC30B",
                                fontSize: 13,
                                fontWeight: 800,
                                fontFamily: "Poppins, monospace",
                                whiteSpace: "nowrap",
                                minWidth: 72,
                                textAlign: "right",
                            }}>
                                {fmtKm(remaining)} übrig
                            </span>
                        </div>

                        {/* Row 2: Status + cancel */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span style={{ color: "#84BCDA", fontSize: 11 }}>
                                {signalLost
                                    ? "⚠️ GPS-Signal verloren"
                                    : isStillstanding
                                        ? "⏸️ Kein Fortschritt"
                                        : hasAccuracyWarning
                                            ? `📡 ±${Math.round(accuracy!)} m`
                                            : `🛰️ ${fmtKm(traveled)} / ${fmtKm(targetKm)}`}
                            </span>
                            <button
                                type="button"
                                onClick={handleCancel}
                                style={{
                                    color: "#84BCDA",
                                    fontSize: 11,
                                    fontWeight: 600,
                                    textDecoration: "underline",
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    fontFamily: "inherit",
                                    padding: 0,
                                }}
                            >
                                Abbrechen
                            </button>
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
}
