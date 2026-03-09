/**
 * RadiusConfig — Radar question configuration.
 *
 * Two modes (same pattern as ThermometerConfig):
 *   "gps"    — distance chips + "GPS-Tracking starten" (default)
 *   "manual" — ConfigCard (red, "Mein Standort") with CoordPicker + chips +
 *              live circle preview on the map
 *
 * Footer GPS:    "🏁 GPS-Tracking starten" · "Manuell" · Abbrechen
 * Footer Manual: "🎯 Radar starten" · Abbrechen
 */
import { useStore } from "@nanostores/react";
import * as L from "leaflet";
import { useEffect, useRef, useState } from "react";

import { bottomSheetState, pickerOpen } from "@/lib/bottom-sheet-state";
import {
    defaultUnit,
    leafletMapContext,
} from "@/lib/context";
import { addQuestion } from "@/lib/session-api";
import { sessionCode, sessionParticipant } from "@/lib/session-context";
import { toast } from "react-toastify";
import { LocationCard } from "./LocationCard";
import { PickerFooter } from "./PickerFooter";
import { PickerHeader, type WsStatus } from "./PickerHeader";

// ── Helpers ────────────────────────────────────────────────────────────────────

function toMeters(value: number, unit: "kilometers" | "miles"): number {
    return unit === "miles" ? value * 1609.34 : value * 1000;
}

// ── Types ──────────────────────────────────────────────────────────────────────

type Chip = { label: string; value: number; unit: "kilometers" | "miles" };

// ── Main component ─────────────────────────────────────────────────────────────

export interface RadiusConfigProps {
    wsStatus: WsStatus;
    onBack: () => void;
    onSettings: () => void;
    onClose: () => void;
    /** Called after a question has been successfully staged, so the parent can reset to the category list. */
    onDone?: () => void;
}

export function RadiusConfig({ wsStatus, onBack, onSettings, onClose, onDone }: RadiusConfigProps) {
    const $defaultUnit = useStore(defaultUnit);
    const isMetric = $defaultUnit !== "miles";

    const [submitting, setSubmitting] = useState(false);
    const [selectedChip, setSelectedChip] = useState<Chip | null>(null);

    // Center coordinate — driven by LocationCard
    const map = leafletMapContext.get();
    const center = map?.getCenter() ?? { lat: 51.1, lng: 10.4 };
    const [lat, setLat] = useState(center.lat);
    const [lng, setLng] = useState(center.lng);

    // Live preview circle
    const circleRef = useRef<L.Circle | null>(null);

    // Distance chips
    const chips: Chip[] = isMetric
        ? [
            { label: "1 km",  value: 1,  unit: "kilometers" },
            { label: "3 km",  value: 3,  unit: "kilometers" },
            { label: "8 km",  value: 8,  unit: "kilometers" },
            { label: "25 km", value: 25, unit: "kilometers" },
            { label: "80 km", value: 80, unit: "kilometers" },
          ]
        : [
            { label: "½ mi",  value: 0.5,  unit: "miles" },
            { label: "5 mi",  value: 5,    unit: "miles" },
            { label: "15 mi", value: 15,   unit: "miles" },
            { label: "50 mi", value: 50,   unit: "miles" },
          ];

    // ── Live preview circle ────────────────────────────────────────────────────

    useEffect(() => {
        const currentMap = leafletMapContext.get();
        if (!currentMap) return;

        if (circleRef.current) {
            currentMap.removeLayer(circleRef.current);
            circleRef.current = null;
        }

        if (selectedChip) {
            const radiusM = toMeters(selectedChip.value, selectedChip.unit);
            const circle = L.circle([lat, lng], {
                radius: radiusM,
                color: "#E8323A",
                fillColor: "#E8323A",
                fillOpacity: 0.12,
                weight: 2,
                dashArray: "6 4",
            });
            circle.addTo(currentMap);
            circleRef.current = circle;
            currentMap.flyTo([lat, lng], currentMap.getZoom(), { duration: 0.5 });
        }

        return () => {
            if (circleRef.current) {
                currentMap.removeLayer(circleRef.current);
                circleRef.current = null;
            }
        };
    }, [lat, lng, selectedChip]);

    // ── Submit ─────────────────────────────────────────────────────────────────

    async function handleSubmit() {
        const code = sessionCode.get();
        const participant = sessionParticipant.get();
        if (!selectedChip || !code || !participant) return;

        const data = { lat, lng, radius: selectedChip.value, unit: selectedChip.unit, within: true };
        setSubmitting(true);
        try {
            await addQuestion(code, participant.token, { type: "radius", data });
            setSubmitting(false);
            onDone?.();
            pickerOpen.set(false);
            bottomSheetState.set("collapsed");
        } catch {
            toast.error("Server derzeit nicht erreichbar. Bitte probiere die Frage gleich nochmal zu senden.");
            setSubmitting(false);
        }
    }

    // ── Render ─────────────────────────────────────────────────────────────────

    return (
        <>
            <PickerHeader
                title="Radius 🎯"
                wsStatus={wsStatus}
                onBack={onBack}
                onSettings={onSettings}
                onClose={onClose}
            />

            <div style={{
                flex: 1,
                overflowY: "auto",
                overflowX: "hidden",
                padding: "16px 16px 8px",
                scrollbarWidth: "thin",
                scrollbarColor: "var(--color-primary) transparent",
            }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

                    {/* ── Dein Standort ───────────────────────────────── */}
                    <LocationCard
                        accentColor="red"
                        title="Dein Standort"
                        lat={lat}
                        lng={lng}
                        onChange={(newLat, newLng) => { setLat(newLat); setLng(newLng); }}
                    />

                    {/* ── Zielradius chips ────────────────────────────── */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        <span style={{
                            color: "#99A1AF",
                            fontSize: "12px",
                            fontWeight: 600,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                        }}>
                            Zielradius
                        </span>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                            {chips.map((chip) => (
                                <button
                                    key={chip.label}
                                    type="button"
                                    onClick={() => setSelectedChip(chip)}
                                    style={{
                                        padding: "8px 18px",
                                        borderRadius: 999,
                                        border: "none",
                                        cursor: "pointer",
                                        fontSize: "14px",
                                        fontWeight: 700,
                                        fontFamily: "Poppins, sans-serif",
                                        transition: "background 0.15s, color 0.15s",
                                        background: selectedChip?.label === chip.label
                                            ? "var(--color-primary)"
                                            : "#2A2A3A",
                                        color: selectedChip?.label === chip.label ? "#fff" : "#99A1AF",
                                    }}
                                >
                                    {chip.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Footer ─────────────────────────────────────────────────── */}
            <PickerFooter
                primaryLabel={submitting ? "Wird gesendet…" : "🎯 Radar starten"}
                primaryDisabled={!selectedChip || submitting}
                onPrimary={handleSubmit}
                onCancel={onBack}
                cancelDisabled={submitting}
            />
        </>
    );
}
