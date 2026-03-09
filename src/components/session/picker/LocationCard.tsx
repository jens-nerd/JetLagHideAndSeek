/**
 * LocationCard — unified GPS / manual coordinate input card.
 *
 * Wraps a ConfigCard with two internal modes:
 *   • GPS mode:   "GPS aktualisieren" + coordinate display + "→ Standort manuell eingeben"
 *   • Manual mode: Ort-Suche + Lat/Lng inputs + GPS + Clipboard + "← Zurück"
 *
 * Matches the pattern from MatchingConfig / MeasuringConfig.
 */
import { LocateFixed, MapPin, Navigation, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { formatCoord, parseClipboardCoords, searchPhoton } from "./location-utils";
import { ConfigCard } from "./ConfigCard";

// ── Styles ────────────────────────────────────────────────────────────────────

const greenLink: React.CSSProperties = {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "#22C55E",
    fontSize: "13px",
    fontWeight: 600,
    padding: 0,
    textAlign: "left",
    display: "flex",
    alignItems: "center",
    gap: 4,
};

const inputStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    color: "#fff",
    fontSize: "13px",
    padding: "8px 10px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    fontFamily: "inherit",
};

// ── Props ─────────────────────────────────────────────────────────────────────

export interface LocationCardProps {
    /** Accent color for the ConfigCard border. Default: "red" */
    accentColor?: "red" | "green";
    /** Title shown inside the card header. Default: "Dein Standort" */
    title?: string;
    /** Current latitude */
    lat: number;
    /** Current longitude */
    lng: number;
    /** Called when coordinates change (GPS, search, manual input, clipboard) */
    onChange: (lat: number, lng: number) => void;
    /** Whether to auto-fetch GPS on mount. Default: true */
    autoFetchGps?: boolean;
    /** Initial internal mode. Default: "gps" */
    initialMode?: "gps" | "manual";
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LocationCard({
    accentColor = "red",
    title = "Dein Standort",
    lat,
    lng,
    onChange,
    autoFetchGps = true,
    initialMode = "gps",
}: LocationCardProps) {
    const [mode, setMode] = useState<"gps" | "manual">(initialMode);

    // GPS state
    const [gpsLoading, setGpsLoading] = useState(false);
    const [gpsError, setGpsError] = useState<string | null>(null);

    // Manual state
    const [latStr, setLatStr] = useState(lat.toFixed(6));
    const [lngStr, setLngStr] = useState(lng.toFixed(6));
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<{ lat: number; lng: number; name: string }[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [coordError, setCoordError] = useState<string | null>(null);
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Keep input strings in sync when parent changes lat/lng externally
    useEffect(() => { setLatStr(lat.toFixed(6)); }, [lat]);
    useEffect(() => { setLngStr(lng.toFixed(6)); }, [lng]);

    // ── Auto-fetch GPS on mount ──────────────────────────────────────────────
    useEffect(() => {
        if (autoFetchGps) fetchGps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── GPS fetch ────────────────────────────────────────────────────────────
    async function fetchGps() {
        setGpsLoading(true);
        setGpsError(null);
        try {
            const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 15_000,
                }),
            );
            const newLat = pos.coords.latitude;
            const newLng = pos.coords.longitude;
            onChange(newLat, newLng);
        } catch {
            setGpsError("GPS nicht verfügbar. Bitte Berechtigungen prüfen.");
        } finally {
            setGpsLoading(false);
        }
    }

    // ── Manual mode helpers ──────────────────────────────────────────────────

    function applyLatStr(s: string) {
        setLatStr(s);
        const v = parseFloat(s);
        if (!isNaN(v) && v >= -90 && v <= 90) onChange(v, lng);
    }

    function applyLngStr(s: string) {
        setLngStr(s);
        const v = parseFloat(s);
        if (!isNaN(v) && v >= -180 && v <= 180) onChange(lat, v);
    }

    function handleSearchChange(q: string) {
        setSearchQuery(q);
        setSearchResults([]);
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        if (!q.trim()) return;
        searchTimeoutRef.current = setTimeout(async () => {
            setSearchLoading(true);
            try {
                setSearchResults(await searchPhoton(q));
            } catch { /* ignore */ }
            finally { setSearchLoading(false); }
        }, 400);
    }

    function selectResult(r: { lat: number; lng: number }) {
        onChange(r.lat, r.lng);
        setSearchQuery("");
        setSearchResults([]);
    }

    async function pasteClipboard() {
        setCoordError(null);
        try {
            const text = await navigator.clipboard.readText();
            const coords = parseClipboardCoords(text);
            if (!coords) { setCoordError("Ungültige Koordinaten"); return; }
            onChange(coords.lat, coords.lng);
        } catch {
            setCoordError("Zwischenablage nicht verfügbar");
        }
    }

    // ── Render ───────────────────────────────────────────────────────────────

    return (
        <ConfigCard accentColor={accentColor}>
            {/* Card header with icon */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <LocateFixed size={18} color="#fff" />
                <span style={{ color: "#fff", fontSize: "16px", fontWeight: 700 }}>
                    {title}
                </span>
            </div>

            {mode === "gps" ? (
                /* ── GPS mode ──────────────────────────────────────────── */
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <button
                        type="button"
                        onClick={fetchGps}
                        disabled={gpsLoading}
                        style={{ ...greenLink, cursor: gpsLoading ? "wait" : "pointer" }}
                    >
                        <Navigation size={14} />
                        {gpsLoading ? "GPS wird geladen…" : "GPS aktualisieren"}
                    </button>

                    <span style={{
                        color: "#fff",
                        fontSize: "14px",
                        fontWeight: 500,
                        fontFamily: "monospace",
                    }}>
                        {formatCoord(lat, lng)}
                    </span>

                    {gpsError && (
                        <span style={{ color: "#FCA5A5", fontSize: "12px" }}>{gpsError}</span>
                    )}

                    <button
                        type="button"
                        onClick={() => setMode("manual")}
                        style={greenLink}
                    >
                        → Standort manuell eingeben
                    </button>
                </div>
            ) : (
                /* ── Manual mode ───────────────────────────────────────── */
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <span style={{ color: "#fff", fontSize: "13px", fontWeight: 600, fontFamily: "monospace" }}>
                        {formatCoord(lat, lng)}
                    </span>

                    {/* Place search */}
                    <div style={{ position: "relative" }}>
                        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                            <Search size={14} color="#6B7280" style={{ position: "absolute", left: 10, pointerEvents: "none" }} />
                            <input
                                type="text"
                                placeholder="Ort suchen…"
                                value={searchQuery}
                                onChange={(e) => handleSearchChange(e.target.value)}
                                style={{ ...inputStyle, paddingLeft: 32 }}
                            />
                        </div>
                        {(searchResults.length > 0 || searchLoading) && (
                            <div style={{
                                position: "absolute",
                                top: "100%",
                                left: 0,
                                right: 0,
                                marginTop: 4,
                                background: "#1E1E2A",
                                border: "1px solid rgba(255,255,255,0.1)",
                                borderRadius: 8,
                                zIndex: 10,
                                maxHeight: 180,
                                overflowY: "auto",
                            }}>
                                {searchLoading && (
                                    <div style={{ padding: "10px 12px", color: "#6B7280", fontSize: "12px" }}>
                                        Suche läuft…
                                    </div>
                                )}
                                {searchResults.map((r, i) => (
                                    <button
                                        key={i}
                                        type="button"
                                        onClick={() => selectResult(r)}
                                        style={{
                                            display: "block",
                                            width: "100%",
                                            textAlign: "left",
                                            background: "none",
                                            border: "none",
                                            borderBottom: i < searchResults.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
                                            padding: "10px 12px",
                                            color: "#fff",
                                            fontSize: "13px",
                                            cursor: "pointer",
                                        }}
                                    >
                                        {r.name || formatCoord(r.lat, r.lng)}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Lat / Lng inputs */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <label style={{ color: "#6B7280", fontSize: "11px", fontWeight: 600, letterSpacing: "0.06em" }}>
                                BREITE
                            </label>
                            <input type="number" value={latStr} onChange={(e) => applyLatStr(e.target.value)} step="0.000001" style={inputStyle} />
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <label style={{ color: "#6B7280", fontSize: "11px", fontWeight: 600, letterSpacing: "0.06em" }}>
                                LÄNGE
                            </label>
                            <input type="number" value={lngStr} onChange={(e) => applyLngStr(e.target.value)} step="0.000001" style={inputStyle} />
                        </div>
                    </div>

                    {/* GPS + Clipboard + Back */}
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        <button
                            type="button"
                            onClick={fetchGps}
                            disabled={gpsLoading}
                            style={{
                                background: "none", border: "none",
                                cursor: gpsLoading ? "wait" : "pointer",
                                color: "var(--color-primary)", fontSize: "12px", fontWeight: 600,
                                padding: 0, display: "flex", alignItems: "center", gap: 4,
                            }}
                        >
                            <MapPin size={12} />
                            {gpsLoading ? "GPS…" : "GPS"}
                        </button>
                        <button
                            type="button"
                            onClick={pasteClipboard}
                            style={{
                                background: "none", border: "none", cursor: "pointer",
                                color: "var(--color-primary)", fontSize: "12px", fontWeight: 600, padding: 0,
                            }}
                        >
                            Aus Zwischenablage
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode("gps")}
                            style={{
                                background: "none", border: "none", cursor: "pointer",
                                color: "#22C55E", fontSize: "12px", fontWeight: 600, padding: 0,
                            }}
                        >
                            ← Zurück
                        </button>
                    </div>

                    {coordError && (
                        <span style={{ color: "#FCA5A5", fontSize: "12px" }}>{coordError}</span>
                    )}
                </div>
            )}
        </ConfigCard>
    );
}
