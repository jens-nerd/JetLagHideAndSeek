/**
 * MatchingConfig — Matching question configuration screen.
 *
 * Two modes (same pattern as TentaclesConfig):
 *   "gps"    — Category dropdown + GPS-based Standort + Fragevorschau (default)
 *   "manual" — Same layout but with manual coordinate input inside the location card
 *
 * Footer GPS:    "Frage senden" · Abbrechen
 * Footer Manual: "Frage senden" · Zurück zu GPS
 */
import { useStore } from "@nanostores/react";
import * as L from "leaflet";
import { LocateFixed } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";

import { findAdminBoundary, findAdminLevelsAt } from "@/maps/api/overpass";
import { bottomSheetState, pickerOpen } from "@/lib/bottom-sheet-state";
import {
    leafletMapContext,
} from "@/lib/context";
import { addQuestion } from "@/lib/session-api";
import {
    gameSize,
    sessionCode,
    sessionParticipant,
} from "@/lib/session-context";
import { locale, t, type TranslationKey } from "@/i18n";
import { ConfigCard } from "./ConfigCard";
import { LocationCard } from "./LocationCard";
import { PickerFooter } from "./PickerFooter";
import { PickerHeader, type WsStatus } from "./PickerHeader";

// ── Matching type definitions ────────────────────────────────────────────────

type MatchTypeDef = {
    value: string;
    /** Only for Small+Medium games (the "-full" variants) */
    smOnly?: boolean;
    /** Optgroup label for grouped types */
    group?: string;
};

const MATCH_TYPES: MatchTypeDef[] = [
    // Standard (all sizes, no group)
    { value: "airport" },
    { value: "major-city" },
    { value: "zone" },
    { value: "letter-zone" },
    // S/M full variants (no group, hidden when L)
    { value: "aquarium-full", smOnly: true },
    { value: "zoo-full", smOnly: true },
    { value: "theme_park-full", smOnly: true },
    { value: "peak-full", smOnly: true },
    { value: "museum-full", smOnly: true },
    { value: "hospital-full", smOnly: true },
    { value: "cinema-full", smOnly: true },
    { value: "library-full", smOnly: true },
    { value: "golf_course-full", smOnly: true },
    { value: "consulate-full", smOnly: true },
    { value: "park-full", smOnly: true },
    // Hiding Zone Mode — Station types
    { value: "same-first-letter-station", group: "Versteckzonen-Modus" },
    { value: "same-length-station", group: "Versteckzonen-Modus" },
    { value: "same-train-line", group: "Versteckzonen-Modus" },
    // Hiding Zone Mode — POI types
    { value: "aquarium", group: "Versteckzonen-Modus" },
    { value: "zoo", group: "Versteckzonen-Modus" },
    { value: "theme_park", group: "Versteckzonen-Modus" },
    { value: "peak", group: "Versteckzonen-Modus" },
    { value: "museum", group: "Versteckzonen-Modus" },
    { value: "hospital", group: "Versteckzonen-Modus" },
    { value: "cinema", group: "Versteckzonen-Modus" },
    { value: "library", group: "Versteckzonen-Modus" },
    { value: "golf_course", group: "Versteckzonen-Modus" },
    { value: "consulate", group: "Versteckzonen-Modus" },
    { value: "park", group: "Versteckzonen-Modus" },
];

// OSM tag mapping for "find nearest" Overpass queries
const TYPE_TO_OSM: Record<string, { key: string; value: string }> = {
    airport: { key: "aeroway", value: "aerodrome" },
    aquarium: { key: "tourism", value: "aquarium" },
    "aquarium-full": { key: "tourism", value: "aquarium" },
    zoo: { key: "tourism", value: "zoo" },
    "zoo-full": { key: "tourism", value: "zoo" },
    theme_park: { key: "tourism", value: "theme_park" },
    "theme_park-full": { key: "tourism", value: "theme_park" },
    peak: { key: "natural", value: "peak" },
    "peak-full": { key: "natural", value: "peak" },
    museum: { key: "tourism", value: "museum" },
    "museum-full": { key: "tourism", value: "museum" },
    hospital: { key: "amenity", value: "hospital" },
    "hospital-full": { key: "amenity", value: "hospital" },
    cinema: { key: "amenity", value: "cinema" },
    "cinema-full": { key: "amenity", value: "cinema" },
    library: { key: "amenity", value: "library" },
    "library-full": { key: "amenity", value: "library" },
    golf_course: { key: "leisure", value: "golf_course" },
    "golf_course-full": { key: "leisure", value: "golf_course" },
    consulate: { key: "office", value: "diplomatic" },
    "consulate-full": { key: "office", value: "diplomatic" },
    park: { key: "leisure", value: "park" },
    "park-full": { key: "leisure", value: "park" },
    "same-first-letter-station": { key: "railway", value: "station" },
    "same-length-station": { key: "railway", value: "station" },
    "same-train-line": { key: "railway", value: "station" },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function getMatchLabel(type: string): string {
    const key = `matchType.${type}` as TranslationKey;
    return t(key, locale.get()) ?? type;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Question preview with highlighted keywords ───────────────────────────────

function Hl({ children }: { children: React.ReactNode }) {
    return <span style={{ color: "#22C55E", fontWeight: 700 }}>{children}</span>;
}

function renderPreview(
    matchType: string,
    same: boolean,
    adminLevel: number,
    zoneName: string | null,
): React.ReactNode {
    const label = getMatchLabel(matchType);

    if (matchType === "zone") {
        const zoneLabel = zoneName ? `${zoneName} (Stufe ${adminLevel})` : `Zone (Stufe ${adminLevel})`;
        if (same) return <>Bist du in derselben <Hl>{zoneLabel}</Hl> wie ich?</>;
        return <>Bist du in einer anderen <Hl>{zoneLabel}</Hl> als ich?</>;
    }
    if (matchType === "letter-zone") {
        const zoneLabel = zoneName ? `${zoneName} (Stufe ${adminLevel})` : `Zone (Stufe ${adminLevel})`;
        if (same) return <>Beginnt der Name deiner <Hl>{zoneLabel}</Hl> mit demselben Buchstaben wie meiner?</>;
        return <>Beginnt der Name deiner <Hl>{zoneLabel}</Hl> mit einem anderen Buchstaben als meiner?</>;
    }
    if (matchType === "same-first-letter-station") {
        if (same) return <>Beginnt der Name deines nächsten <Hl>Bahnhofs</Hl> mit demselben Buchstaben wie meiner?</>;
        return <>Beginnt der Name deines nächsten <Hl>Bahnhofs</Hl> mit einem anderen Buchstaben als meiner?</>;
    }
    if (matchType === "same-length-station") {
        if (same) return <>Hat der Name deines nächsten <Hl>Bahnhofs</Hl> die gleiche Länge wie meiner?</>;
        return <>Hat der Name deines nächsten <Hl>Bahnhofs</Hl> eine andere Länge als meiner?</>;
    }
    if (matchType === "same-train-line") {
        if (same) return <>Liegt dein nächster <Hl>Bahnhof</Hl> an derselben Zugstrecke wie meiner?</>;
        return <>Liegt dein nächster <Hl>Bahnhof</Hl> an einer anderen Zugstrecke als meiner?</>;
    }
    // Default: nearest X
    if (same) {
        return <>Ist die nächstgelegene <Hl>{label}</Hl> zu dir dieselbe wie die nächstgelegene <Hl>{label}</Hl> zu mir?</>;
    }
    return <>Ist die nächstgelegene <Hl>{label}</Hl> zu dir eine andere als die nächstgelegene <Hl>{label}</Hl> zu mir?</>;
}

function getInfoHint(matchType: string): string {
    const label = getMatchLabel(matchType);
    if (matchType === "zone" || matchType === "letter-zone") {
        return `Der Hider prüft, ob er in derselben ${label} ist wie du. Ein Match grenzt das Suchgebiet stark ein!`;
    }
    if (matchType.includes("station") || matchType === "same-train-line") {
        return `Der Hider vergleicht seinen nächsten Bahnhof mit deinem. Ein Match bedeutet eine starke Eingrenzung!`;
    }
    return `Der Hider vergleicht seine nächstgelegene ${label} mit deiner. Ein Match bedeutet eine starke Eingrenzung!`;
}

// ── Styles ───────────────────────────────────────────────────────────────────

const selectStyle: React.CSSProperties = {
    background: "#1E1E2A",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 10,
    color: "#fff",
    fontSize: "15px",
    fontWeight: 600,
    padding: "12px 40px 12px 14px",
    width: "100%",
    outline: "none",
    appearance: "none" as const,
    fontFamily: "inherit",
    backgroundImage:
        `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='7' viewBox='0 0 12 7'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%236B7280' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 14px center",
    cursor: "pointer",
};

const sectionLabel: React.CSSProperties = {
    color: "#99A1AF",
    fontSize: "12px",
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
};

// ── Main component ──────────────────────────────────────────────────────────

export interface MatchingConfigProps {
    wsStatus: WsStatus;
    onBack: () => void;
    onSettings: () => void;
    onClose: () => void;
    onDone?: () => void;
}

export function MatchingConfig({
    wsStatus,
    onBack,
    onSettings,
    onClose,
    onDone,
}: MatchingConfigProps) {
    const $gameSize = useStore(gameSize);

    const [matchType, setMatchType] = useState("airport");
    const [same, setSame] = useState(true);
    const [adminLevel, setAdminLevel] = useState(3);
    const [adminLevels, setAdminLevels] = useState<{ level: number; name: string }[]>([]);
    const [adminLevelsLoading, setAdminLevelsLoading] = useState(false);

    // ── Center coordinate ────────────────────────────────────────────────────
    const mapInst = leafletMapContext.get();
    const rawCenter = mapInst?.getCenter() ?? { lat: 51.1, lng: 10.4 };
    const [centerLat, setCenterLat] = useState(rawCenter.lat);
    const [centerLng, setCenterLng] = useState(rawCenter.lng);

    // ── Find nearest state ───────────────────────────────────────────────────
    const [nearestResult, setNearestResult] = useState<{
        name: string;
        lat: number;
        lng: number;
        dist: number;
    } | null>(null);
    const [nearestLoading, setNearestLoading] = useState(false);

    // ── Submit state ─────────────────────────────────────────────────────────
    const [submitting, setSubmitting] = useState(false);

    // ── Zone preview state ──────────────────────────────────────────────────
    const [zonePreviewLoading, setZonePreviewLoading] = useState(false);

    // ── Leaflet refs ─────────────────────────────────────────────────────────
    const markerRef = useRef<L.CircleMarker | null>(null);
    const nearestMarkerRef = useRef<L.CircleMarker | null>(null);
    const zoneLayerRef = useRef<L.GeoJSON | null>(null);

    // ── Filter match types by game size ──────────────────────────────────────
    const filteredTypes = MATCH_TYPES.filter((mt) => {
        if ($gameSize === "L" && mt.smOnly) return false;
        return true;
    });

    const ungrouped = filteredTypes.filter((mt) => !mt.group);
    const groups = [...new Set(filteredTypes.filter((mt) => mt.group).map((mt) => mt.group!))];

    // ── Draw seeker marker on map ────────────────────────────────────────────
    useEffect(() => {
        const m = leafletMapContext.get();
        if (!m) return;
        if (markerRef.current) m.removeLayer(markerRef.current);
        markerRef.current = L.circleMarker([centerLat, centerLng], {
            radius: 8,
            color: "#22C55E",
            fillColor: "#22C55E",
            fillOpacity: 0.85,
            weight: 2,
        }).addTo(m);
        m.setView([centerLat, centerLng], m.getZoom(), { animate: true });
    }, [centerLat, centerLng]);

    // ── Clean up all markers on unmount ───────────────────────────────────────
    useEffect(() => () => {
        const m = leafletMapContext.get();
        if (!m) return;
        if (markerRef.current) m.removeLayer(markerRef.current);
        if (nearestMarkerRef.current) m.removeLayer(nearestMarkerRef.current);
        if (zoneLayerRef.current) m.removeLayer(zoneLayerRef.current);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Fetch available admin levels when zone type is selected ──────────────
    useEffect(() => {
        if (matchType !== "zone" && matchType !== "letter-zone") return;
        setAdminLevelsLoading(true);
        const timer = setTimeout(async () => {
            try {
                const levels = await findAdminLevelsAt(centerLat, centerLng);
                setAdminLevels(levels);
                // Auto-select first level if current selection is not available
                if (levels.length > 0 && !levels.some((l) => l.level === adminLevel)) {
                    setAdminLevel(levels[0].level);
                }
            } catch {
                setAdminLevels([]); // Fallback: empty → hardcoded dropdown
            } finally {
                setAdminLevelsLoading(false);
            }
        }, 500);
        return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [matchType, centerLat, centerLng]);

    // ── Clear "find nearest" result + zone preview when type or position changes
    useEffect(() => {
        setNearestResult(null);
        const m = leafletMapContext.get();
        if (nearestMarkerRef.current && m) {
            m.removeLayer(nearestMarkerRef.current);
            nearestMarkerRef.current = null;
        }
        if (zoneLayerRef.current && m) {
            m.removeLayer(zoneLayerRef.current);
            zoneLayerRef.current = null;
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [matchType, centerLat, centerLng]);

    // ── Update zone layer color when same/different changes ──────────────────
    useEffect(() => {
        if (!zoneLayerRef.current) return;
        const color = same ? "#22C55E" : "#E8323A";
        zoneLayerRef.current.setStyle({
            color,
            fillColor: color,
            fillOpacity: same ? 0.15 : 0.10,
            weight: 2,
            dashArray: same ? undefined : "6 4",
        });
    }, [same]);

    // ── Find nearest POI via Overpass ─────────────────────────────────────────
    async function handleFindNearest() {
        const osm = TYPE_TO_OSM[matchType];
        if (!osm) return;

        setNearestLoading(true);
        setNearestResult(null);
        try {
            const radiusM = 50_000;
            const { key, value } = osm;
            const query =
                `[out:json][timeout:25];` +
                `(node["${key}"="${value}"](around:${radiusM},${centerLat},${centerLng});` +
                `way["${key}"="${value}"](around:${radiusM},${centerLat},${centerLng});` +
                `relation["${key}"="${value}"](around:${radiusM},${centerLat},${centerLng}););out center;`;

            const { overpassFetch } = await import("@/maps/api/overpass-fetch");
            const data = await overpassFetch(query, { timeoutMs: 25_000 });

            const pois = (data.elements ?? [])
                .map((el: any) => ({
                    lat: el.lat ?? el.center?.lat ?? 0,
                    lng: el.lon ?? el.center?.lon ?? 0,
                    name: el.tags?.name ?? el.tags?.["name:de"] ?? "Unbekannt",
                }))
                .filter((p: any) => p.lat !== 0);

            if (pois.length === 0) {
                toast.info("Keine Treffer im Umkreis von 50 km gefunden.");
                setNearestLoading(false);
                return;
            }

            // Find nearest by haversine
            let nearest = pois[0];
            let nearestDist = haversineKm(centerLat, centerLng, nearest.lat, nearest.lng);
            for (const p of pois) {
                const d = haversineKm(centerLat, centerLng, p.lat, p.lng);
                if (d < nearestDist) {
                    nearest = p;
                    nearestDist = d;
                }
            }

            setNearestResult({ ...nearest, dist: nearestDist });

            // Draw marker on map
            const m = leafletMapContext.get();
            if (m) {
                if (nearestMarkerRef.current) m.removeLayer(nearestMarkerRef.current);
                nearestMarkerRef.current = L.circleMarker([nearest.lat, nearest.lng], {
                    radius: 8,
                    color: "#E8323A",
                    fillColor: "#E8323A",
                    fillOpacity: 0.85,
                    weight: 2,
                }).addTo(m).bindPopup(nearest.name);
            }
        } catch {
            toast.error("Overpass-API nicht erreichbar.");
        } finally {
            setNearestLoading(false);
        }
    }

    // ── Zone preview on map ─────────────────────────────────────────────────
    function drawZoneOnMap(feature: any) {
        const m = leafletMapContext.get();
        if (!m) return;
        if (zoneLayerRef.current) m.removeLayer(zoneLayerRef.current);

        const color = same ? "#22C55E" : "#E8323A";
        zoneLayerRef.current = L.geoJSON(feature, {
            style: {
                color,
                fillColor: color,
                fillOpacity: same ? 0.15 : 0.10,
                weight: 2,
                dashArray: same ? undefined : "6 4",
            },
        }).addTo(m);

        m.fitBounds(zoneLayerRef.current.getBounds(), { padding: [30, 30] });
    }

    async function handleZonePreview() {
        setZonePreviewLoading(true);
        try {
            const feature = await findAdminBoundary(
                centerLat,
                centerLng,
                adminLevel as 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,
            );
            if (!feature) {
                toast.info("Keine Zone für diese Stufe gefunden.");
                return;
            }
            drawZoneOnMap(feature);
        } catch {
            toast.error("Zone konnte nicht geladen werden.");
        } finally {
            setZonePreviewLoading(false);
        }
    }

    // ── Submit ───────────────────────────────────────────────────────────────
    async function handleSubmit() {
        const code = sessionCode.get();
        const participant = sessionParticipant.get();
        if (!code || !participant) return;

        const data: Record<string, unknown> = {
            lat: centerLat,
            lng: centerLng,
            type: matchType,
            same,
        };

        // Add admin level + zone name for zone types
        if (matchType === "zone" || matchType === "letter-zone") {
            data.cat = { adminLevel, zoneName: selectedZoneName };
        }

        // Add length comparison for station length type
        if (matchType === "same-length-station") {
            data.lengthComparison = "same";
        }

        setSubmitting(true);
        try {
            await addQuestion(code, participant.token, { type: "matching", data });
            setSubmitting(false);
            onDone?.();
            pickerOpen.set(false);
            bottomSheetState.set("collapsed");
        } catch {
            toast.error("Server derzeit nicht erreichbar. Bitte probiere die Frage gleich nochmal zu senden.");
            setSubmitting(false);
        }
    }

    // ── Derived ──────────────────────────────────────────────────────────────
    const canFindNearest = matchType in TYPE_TO_OSM;
    const selectedZoneName = adminLevels.find((al) => al.level === adminLevel)?.name ?? null;

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <>
            <PickerHeader
                title="Matching konfigurieren"
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

                    {/* ── Dein Standort ────────────────────────────────────── */}
                    <LocationCard
                        accentColor="red"
                        title="Dein Standort"
                        lat={centerLat}
                        lng={centerLng}
                        onChange={(lat, lng) => { setCenterLat(lat); setCenterLng(lng); }}
                    />

                    {/* ── Kategorie dropdown ──────────────────────────────── */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <span style={sectionLabel}>Kategorie</span>
                        <select
                            value={matchType}
                            onChange={(e) => setMatchType(e.target.value)}
                            style={selectStyle}
                        >
                            {ungrouped.map((mt) => (
                                <option key={mt.value} value={mt.value}>
                                    {getMatchLabel(mt.value)}
                                </option>
                            ))}
                            {groups.map((groupName) => (
                                <optgroup key={groupName} label={groupName}>
                                    {filteredTypes
                                        .filter((mt) => mt.group === groupName)
                                        .map((mt) => (
                                            <option key={mt.value} value={mt.value}>
                                                {getMatchLabel(mt.value)}
                                            </option>
                                        ))}
                                </optgroup>
                            ))}
                        </select>
                    </div>

                    {/* ── Admin level for zone types ──────────────────────── */}
                    {(matchType === "zone" || matchType === "letter-zone") && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <span style={sectionLabel}>Admin-Stufe</span>
                            {adminLevelsLoading ? (
                                <span style={{ color: "#6B7280", fontSize: "13px", padding: "12px 0" }}>
                                    Zonen werden geladen…
                                </span>
                            ) : adminLevels.length > 0 ? (
                                <select
                                    value={adminLevel}
                                    onChange={(e) => setAdminLevel(parseInt(e.target.value))}
                                    style={selectStyle}
                                >
                                    {adminLevels.map((al) => (
                                        <option key={al.level} value={al.level}>
                                            Stufe {al.level} — {al.name}
                                        </option>
                                    ))}
                                </select>
                            ) : (
                                /* Fallback: hardcoded levels when API fails */
                                <select
                                    value={adminLevel}
                                    onChange={(e) => setAdminLevel(parseInt(e.target.value))}
                                    style={selectStyle}
                                >
                                    {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((lvl) => (
                                        <option key={lvl} value={lvl}>
                                            {t(`osmZone.${lvl}` as TranslationKey, locale.get()) ?? `Stufe ${lvl}`}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </div>
                    )}

                    {/* ── Fragevorschau ────────────────────────────────────── */}
                    <ConfigCard accentColor="green" title="Fragevorschau">
                        <p style={{ margin: 0, color: "#E5E7EB", fontSize: "14px", lineHeight: 1.55 }}>
                            {renderPreview(matchType, same, adminLevel, selectedZoneName)}
                        </p>

                        {/* Compact same/different pills */}
                        <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                            <button
                                type="button"
                                onClick={() => setSame(true)}
                                style={{
                                    padding: "6px 12px",
                                    borderRadius: 999,
                                    border: same
                                        ? "1px solid rgba(34,197,94,0.4)"
                                        : "1px solid rgba(255,255,255,0.1)",
                                    cursor: "pointer",
                                    fontSize: "12px",
                                    fontWeight: 600,
                                    background: same ? "rgba(34,197,94,0.2)" : "transparent",
                                    color: same ? "#22C55E" : "#6B7280",
                                    transition: "all 0.15s",
                                }}
                            >
                                ✅ Gleich
                            </button>
                            <button
                                type="button"
                                onClick={() => setSame(false)}
                                style={{
                                    padding: "6px 12px",
                                    borderRadius: 999,
                                    border: !same
                                        ? "1px solid rgba(232,50,58,0.4)"
                                        : "1px solid rgba(255,255,255,0.1)",
                                    cursor: "pointer",
                                    fontSize: "12px",
                                    fontWeight: 600,
                                    background: !same ? "rgba(232,50,58,0.2)" : "transparent",
                                    color: !same ? "#E8323A" : "#6B7280",
                                    transition: "all 0.15s",
                                }}
                            >
                                ❌ Anders
                            </button>
                        </div>

                        {/* Zone map preview button (only for zone/letter-zone) */}
                        {(matchType === "zone" || matchType === "letter-zone") && (
                            <button
                                type="button"
                                onClick={handleZonePreview}
                                disabled={zonePreviewLoading}
                                style={{
                                    background: "none",
                                    border: "none",
                                    cursor: zonePreviewLoading ? "wait" : "pointer",
                                    color: "#22C55E",
                                    fontSize: "12px",
                                    fontWeight: 600,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 4,
                                    padding: 0,
                                    marginTop: 2,
                                }}
                            >
                                🗺️ {zonePreviewLoading ? "Zone wird geladen…" : "Vorschau auf der Karte"}
                            </button>
                        )}
                    </ConfigCard>

                    {/* ── Find nearest button ──────────────────────────────── */}
                    {canFindNearest && (
                        <button
                            type="button"
                            onClick={handleFindNearest}
                            disabled={nearestLoading}
                            style={{
                                padding: "14px 16px",
                                borderRadius: 10,
                                border: "2px solid #22C55E",
                                background: "transparent",
                                color: "#fff",
                                fontSize: "14px",
                                fontWeight: 600,
                                fontFamily: "Poppins, sans-serif",
                                cursor: nearestLoading ? "wait" : "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 8,
                                width: "100%",
                            }}
                        >
                            <LocateFixed size={16} color="#22C55E" />
                            {nearestLoading
                                ? "Wird gesucht…"
                                : `Zeige mir meine nächstgelegene ${getMatchLabel(matchType)}`}
                        </button>
                    )}

                    {/* Find nearest result */}
                    {nearestResult && (
                        <div style={{
                            background: "rgba(34,197,94,0.08)",
                            border: "1px solid rgba(34,197,94,0.25)",
                            borderRadius: 10,
                            padding: "12px 14px",
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                        }}>
                            <span style={{ color: "#22C55E", fontSize: "14px", fontWeight: 700 }}>
                                📍 {nearestResult.name}
                            </span>
                            <span style={{ color: "#99A1AF", fontSize: "12px" }}>
                                {nearestResult.dist < 1
                                    ? `${Math.round(nearestResult.dist * 1000)} m entfernt`
                                    : `${nearestResult.dist.toFixed(1)} km entfernt`}
                            </span>
                        </div>
                    )}

                    {/* ── Info hint ────────────────────────────────────────── */}
                    <div style={{
                        background: "#2A2A3A",
                        borderRadius: 10,
                        padding: "12px 14px",
                        fontSize: "13px",
                        color: "#99A1AF",
                        lineHeight: 1.5,
                    }}>
                        💡 {getInfoHint(matchType)}
                    </div>
                </div>
            </div>

            {/* ── Footer ──────────────────────────────────────────────── */}
            <PickerFooter
                primaryLabel={submitting ? "Wird gesendet…" : "Frage senden  ✈"}
                primaryDisabled={submitting}
                onPrimary={handleSubmit}
                onCancel={onBack}
                cancelDisabled={submitting}
            />
        </>
    );
}
