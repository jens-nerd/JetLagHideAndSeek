/**
 * MyZonePanel — simplified hiding zone selection for the hider.
 *
 * Self-contained: loads stations via Overpass based on the station type filter,
 * shows a searchable list, and only the selected zone is drawn on the map.
 *
 * States:
 *   - Loading stations (after type selection)
 *   - Station list with search filter → select one
 *   - Zone set: info card + "Zone ändern" + "Endgame freigeben"
 *   - Zone revealed: Same as set, but "Endgame aktiv" (disabled)
 */
import { useStore } from "@nanostores/react";
import osmtogeojson from "osmtogeojson";
import { useEffect, useState } from "react";
import { toast } from "react-toastify";

import {
    displayHidingZonesOptions,
    hidingRadius,
    hidingRadiusUnits,
    isLoading,
    leafletMapContext,
} from "@/lib/context";
import { findPlacesInZone } from "@/maps/api";
import { locale, t, useT, type TranslationKey } from "@/i18n";
import {
    activeHidingZone,
    sessionParticipant,
    wsInstance,
} from "@/lib/session-context";

// ── Station type options (same as ZoneSidebar) ──────────────────────────────

const STATION_TYPE_OPTIONS: { label: TranslationKey; value: string }[] = [
    { label: "placeType.railwayStations", value: "[railway~'station|halt']" },
    { label: "placeType.tramStops", value: "[railway=tram_stop]" },
    { label: "placeType.busStops", value: "[highway=bus_stop]" },
    { label: "placeType.ferryTerminals", value: "[amenity=ferry_terminal]" },
    { label: "placeType.subwayStations", value: "[railway=station][subway=yes]" },
];

// ── Styles ──────────────────────────────────────────────────────────────────

const sectionLabel: React.CSSProperties = {
    color: "#99A1AF",
    fontSize: "12px",
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
};

const selectStyle: React.CSSProperties = {
    background: "#1E1E2A",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 10,
    color: "#fff",
    fontSize: "14px",
    fontWeight: 600,
    padding: "10px 14px",
    width: "100%",
    outline: "none",
    fontFamily: "inherit",
};

// ── Component ───────────────────────────────────────────────────────────────

export function MyZonePanel() {
    const tr = useT();
    const $zone = useStore(activeHidingZone);
    const $ws = useStore(wsInstance);
    const $participant = useStore(sessionParticipant);
    const $hidingRadius = useStore(hidingRadius);
    const $hidingRadiusUnits = useStore(hidingRadiusUnits);
    const $zoneOptions = useStore(displayHidingZonesOptions);
    const $isLoading = useStore(isLoading);

    const [stations, setStations] = useState<any[]>([]);
    const [stationsLoaded, setStationsLoaded] = useState(false);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [confirmReveal, setConfirmReveal] = useState(false);

    const isHider = $participant?.role === "hider";
    if (!isHider) return null;

    // ── Load stations when zone options change ──────────────────────────────
    async function loadStations() {
        if ($zoneOptions.length === 0) {
            toast.error("Bitte wähle mindestens einen Stationstyp.");
            return;
        }
        setLoading(true);
        try {
            const loc = locale.get();
            const places = osmtogeojson(
                await findPlacesInZone(
                    $zoneOptions[0],
                    t("zone.findingStations", loc),
                    "nwr",
                    "center",
                    $zoneOptions.slice(1),
                ),
            ).features;
            setStations(places);
            setStationsLoaded(true);
        } catch {
            toast.error("Stationen konnten nicht geladen werden.");
        } finally {
            setLoading(false);
        }
    }

    function sendSetZone(station: any) {
        if (!$ws || $ws.readyState !== WebSocket.OPEN) {
            toast.error("Keine Verbindung zum Server.");
            return;
        }
        const props = station.properties ?? station.properties?.properties;
        const name =
            props?.["name:en"] ||
            props?.name ||
            "Unbekannt";
        const coords = station.geometry?.coordinates;
        if (!coords) return;
        const [lng, lat] = coords;

        $ws.send(JSON.stringify({
            type: "set_hiding_zone",
            stationName: name,
            lat,
            lng,
            radius: $hidingRadius,
            radiusUnit: $hidingRadiusUnits,
        }));

        setSearchQuery("");
        toast.success(`Versteckzone gesetzt: ${name}`);
    }

    function sendReveal() {
        if (!$ws || $ws.readyState !== WebSocket.OPEN) {
            toast.error("Keine Verbindung zum Server.");
            return;
        }
        $ws.send(JSON.stringify({ type: "reveal_hiding_zone" }));
        setConfirmReveal(false);
        toast.success("Endgame freigegeben!");
    }

    // ── Confirm reveal dialog ────────────────────────────────────────────────
    if (confirmReveal) {
        return (
            <div style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: "16px 0",
                textAlign: "center",
            }}>
                <p style={{ color: "#E5E7EB", fontSize: "14px", margin: 0 }}>
                    Die Zone wird für alle Seeker sichtbar. Fortfahren?
                </p>
                <button
                    type="button"
                    onClick={sendReveal}
                    style={{
                        background: "#E8323A",
                        color: "#fff",
                        border: "none",
                        borderRadius: 10,
                        padding: "12px",
                        fontWeight: 800,
                        fontSize: "15px",
                        cursor: "pointer",
                        fontFamily: "Poppins, sans-serif",
                    }}
                >
                    Endgame freigeben
                </button>
                <button
                    type="button"
                    onClick={() => setConfirmReveal(false)}
                    style={{
                        color: "#99A1AF",
                        textDecoration: "underline",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: "12px",
                        fontWeight: 600,
                        fontFamily: "inherit",
                    }}
                >
                    Abbrechen
                </button>
            </div>
        );
    }

    // ── Zone info (when set) ─────────────────────────────────────────────────
    const zoneInfoCard = $zone && (
        <div style={{
            background: "rgba(34,197,94,0.08)",
            border: "1px solid rgba(34,197,94,0.25)",
            borderRadius: 10,
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
        }}>
            <span style={{ color: "#22C55E", fontSize: "15px", fontWeight: 700 }}>
                {$zone.stationName}
            </span>
            <span style={{ color: "#99A1AF", fontSize: "12px" }}>
                Radius: {$zone.radius} {$zone.radiusUnit === "miles" ? "mi" : "km"}
            </span>
            {$zone.revealed && (
                <span style={{ color: "#F59E0B", fontSize: "12px", fontWeight: 600, marginTop: 2 }}>
                    Endgame aktiv — Seeker sehen diese Zone
                </span>
            )}
        </div>
    );

    // ── Filter stations by search ────────────────────────────────────────────
    const filtered = stations.filter((s) => {
        if (!searchQuery) return true;
        const props = s.properties ?? {};
        const name = (props["name:en"] || props.name || "").toLowerCase();
        return name.includes(searchQuery.toLowerCase());
    });

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "8px 0" }}>

            {/* Zone info (if set) */}
            {zoneInfoCard}

            {/* Endgame buttons (if zone set) */}
            {$zone && (
                <>
                    {!$zone.revealed ? (
                        <button
                            type="button"
                            onClick={() => setConfirmReveal(true)}
                            style={{
                                background: "#E8323A",
                                color: "#fff",
                                border: "none",
                                borderRadius: 10,
                                padding: "12px",
                                fontWeight: 800,
                                fontSize: "14px",
                                cursor: "pointer",
                                fontFamily: "Poppins, sans-serif",
                                width: "100%",
                            }}
                        >
                            Endgame freigeben
                        </button>
                    ) : (
                        <button
                            type="button"
                            disabled
                            style={{
                                background: "#2A2A3A",
                                color: "#6B7280",
                                border: "none",
                                borderRadius: 10,
                                padding: "12px",
                                fontWeight: 800,
                                fontSize: "14px",
                                cursor: "not-allowed",
                                fontFamily: "Poppins, sans-serif",
                                width: "100%",
                            }}
                        >
                            Endgame aktiv
                        </button>
                    )}
                </>
            )}

            {/* Divider */}
            {$zone && (
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", margin: "4px 0" }} />
            )}

            {/* Station type filter */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={sectionLabel}>Stationstyp</span>
                <select
                    value={$zoneOptions[0] ?? ""}
                    onChange={(e) => {
                        displayHidingZonesOptions.set([e.target.value]);
                        setStationsLoaded(false);
                        setStations([]);
                    }}
                    style={selectStyle}
                >
                    {STATION_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {t(opt.label, locale.get())}
                        </option>
                    ))}
                </select>
            </div>

            {/* Load stations button */}
            <button
                type="button"
                onClick={loadStations}
                disabled={loading || $zoneOptions.length === 0}
                style={{
                    background: stationsLoaded ? "transparent" : "#22C55E",
                    color: stationsLoaded ? "#22C55E" : "#fff",
                    border: stationsLoaded ? "2px solid #22C55E" : "none",
                    borderRadius: 10,
                    padding: "12px",
                    fontWeight: 700,
                    fontSize: "14px",
                    cursor: loading ? "wait" : "pointer",
                    opacity: loading ? 0.6 : 1,
                    fontFamily: "Poppins, sans-serif",
                    width: "100%",
                }}
            >
                {loading
                    ? "Stationen werden geladen…"
                    : stationsLoaded
                        ? `Stationen neu laden (${stations.length})`
                        : "Stationen laden"}
            </button>

            {/* Station search + list (only when loaded) */}
            {stationsLoaded && stations.length > 0 && (
                <>
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Versteckzone suchen…"
                        style={{
                            ...selectStyle,
                            fontSize: "13px",
                            padding: "8px 12px",
                        }}
                    />
                    <div style={{
                        maxHeight: 250,
                        overflowY: "auto",
                        borderRadius: 8,
                        border: "1px solid rgba(255,255,255,0.08)",
                    }}>
                        {filtered.length === 0 && (
                            <p style={{ color: "#6B7280", fontSize: "13px", padding: "10px 12px", margin: 0 }}>
                                Keine Ergebnisse
                            </p>
                        )}
                        {filtered.map((s, i) => {
                            const props = s.properties ?? {};
                            const name = props["name:en"] || props.name || "Unbekannt";
                            const isSelected = $zone?.stationName === name;
                            return (
                                <button
                                    key={props.id ?? `${s.geometry?.coordinates?.[1]},${s.geometry?.coordinates?.[0]}` ?? i}
                                    type="button"
                                    onClick={() => sendSetZone(s)}
                                    style={{
                                        display: "block",
                                        width: "100%",
                                        textAlign: "left",
                                        padding: "9px 12px",
                                        background: isSelected ? "rgba(34,197,94,0.12)" : "transparent",
                                        border: "none",
                                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                                        color: isSelected ? "#22C55E" : "#E5E7EB",
                                        fontSize: "13px",
                                        fontWeight: isSelected ? 700 : 400,
                                        cursor: "pointer",
                                        fontFamily: "inherit",
                                    }}
                                >
                                    {isSelected && "● "}{name}
                                </button>
                            );
                        })}
                    </div>
                </>
            )}

            {stationsLoaded && stations.length === 0 && !loading && (
                <p style={{ color: "#F59E0B", fontSize: "12px", margin: 0 }}>
                    Keine Stationen im Spielgebiet gefunden. Versuche einen anderen Stationstyp.
                </p>
            )}
        </div>
    );
}
