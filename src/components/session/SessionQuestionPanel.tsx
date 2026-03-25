/**
 * Shown inside the sidebar when a multiplayer session is active.
 *
 * - SEEKER: sees a "Frage stellen" button + list of pending/answered questions
 * - HIDER:  sees pending questions with a two-step answer flow:
 *             1. Click "Antworten" → enters preview mode
 *             2. Position the green pin (GPS or drag on map)
 *             3. See live preview of the result
 *             4. Click "Antwort senden" to actually submit
 */
import { useStore } from "@nanostores/react";
import { CheckCircle, ChevronDown, Clock, MapPin, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";

import * as L from "leaflet";
import * as turf from "@turf/turf";

import { Button } from "@/components/ui/button";
import {
    MatchingQuestionComponent,
    MeasuringQuestionComponent,
    RadiusQuestionComponent,
    TentacleQuestionComponent,
    ThermometerQuestionComponent,
} from "@/components/QuestionCards";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    addQuestion as addLocalQuestion,
    hiderMode,
    isLoading,
    leafletMapContext,
    mapGeoJSON,
    questions as questions_atom,
} from "@/lib/context";
import { SidebarContext } from "@/components/ui/sidebar-l-context";
import { adjustMapGeoDataForQuestion, hiderifyQuestion } from "@/maps";
import { addQuestion, answerQuestion } from "@/lib/session-api";
import { atom } from "nanostores";
import { getCardCost } from "@/lib/card-costs";

/** Temporary store for photo answer data — set by PhotoAnswerUI, read by submitAnswer */
const photoAnswerData = atom<unknown>(null);

const BACKEND_URL_DETAIL =
    (typeof import.meta !== "undefined" && (import.meta as any).env?.PUBLIC_BACKEND_URL) ||
    "http://localhost:3001";
import { handleSubmitError } from "@/lib/handle-submit-error";
import { LocationCard } from "./picker/LocationCard";
import {
    pendingDraftKey,
    recentlyAnswered,
    sessionCode,
    sessionParticipant,
    sessionQuestions,
    thermometerGpsTracking,
} from "@/lib/session-context";
import { pendingPickerType, pickerOpen } from "@/lib/bottom-sheet-state";
import type { SessionQuestion } from "@hideandseek/shared";
import { locale, t, useT, type TranslationKey } from "@/i18n";

// ── Voronoi helper for thermometer answer overlay ──────────────────────────────

/**
 * Returns [coldPolygon, warmPolygon] as [lat,lng][] arrays representing the
 * two Voronoi half-planes separated by the perpendicular bisector of A–B.
 * coldPolygon = region closer to A (index 0), warmPolygon = region closer to B (index 1).
 * Returns null when A === B (degenerate case).
 */
function computeThermometerVoronoi(
    latA: number, lngA: number,
    latB: number, lngB: number,
): [[number, number][], [number, number][]] | null {
    if (latA === latB && lngA === lngB) return null;
    try {
        const midLat = (latA + latB) / 2;
        const midLng = (lngA + lngB) / 2;
        const span = Math.max(Math.abs(latA - latB), Math.abs(lngA - lngB), 0.05);
        const pad = span * 3 + 1.5;
        const bbox = [midLng - pad, midLat - pad, midLng + pad, midLat + pad] as [number, number, number, number];
        const pts = turf.featureCollection([turf.point([lngA, latA]), turf.point([lngB, latB])]);
        const voronoi = turf.voronoi(pts, { bbox });
        if (!voronoi || voronoi.features.length < 2) return null;
        const toLatLng = (f: any): [number, number][] =>
            (f.geometry.coordinates[0] as [number, number][]).map(([lng, lat]) => [lat, lng] as [number, number]);
        return [toLatLng(voronoi.features[0]), toLatLng(voronoi.features[1])];
    } catch {
        return null;
    }
}

// ── Lateness helper ───────────────────────────────────────────────────────────

/**
 * Returns a human-readable "X min zu spät" / "Xs zu spät" string.
 * `ms` must be > 0.
 */
function formatLateness(ms: number): string {
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s zu spät`;
    const mins = Math.round(secs / 60);
    return `${mins} min zu spät`;
}

/** Format an ISO8601 timestamp as "HH:MM" in the user's local timezone. */
function formatTime(iso: string): string {
    // SQLite datetime('now') returns UTC without Z suffix (e.g. "2026-03-25 12:08:00").
    // Append Z if missing so Date parses it as UTC, not local time.
    const normalized = iso.endsWith("Z") || iso.includes("+") || iso.includes("T")
        ? iso
        : iso + "Z";
    const d = new Date(normalized);
    return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

// ── Translation-backed label helpers ─────────────────────────────────────────

function getQuestionLabel(type: string): string {
    const key = `questionType.${type}` as TranslationKey;
    return t(key, locale.get()) ?? type;
}

function getLocTypeLabel(type: string): string {
    const key = `locType.${type}` as TranslationKey;
    return t(key, locale.get()) ?? type;
}

function getMeasTypeLabel(type: string): string {
    const key = `measType.${type}` as TranslationKey;
    return t(key, locale.get()) ?? type;
}

function getMatchTypeLabel(type: string): string {
    const key = `matchType.${type}` as TranslationKey;
    return t(key, locale.get()) ?? type;
}

function getUnitLabel(unit: string): string {
    const key = `unit.${unit}` as TranslationKey;
    return t(key, locale.get()) ?? unit;
}

/** Emoji icon per question type for card headers */
function getQuestionIcon(type: string): string {
    switch (type) {
        case "radius": return "🎯";
        case "thermometer": return "🌡️";
        case "tentacles": return "🐙";
        case "matching": return "🔄";
        case "measuring": return "📏";
        case "photo": return "📸";
        default: return "❓";
    }
}

// ── Kurztext-Beschreibung je Fragetyp ─────────────────────────────────────────

function describeQuestion(
    type: string,
    data: any,
    answerData?: any,
): string | null {
    if (!data) return null;
    const loc = locale.get();
    switch (type) {
        case "radius": {
            const dir = data.within === false ? t("sqp.descOutside", loc) : t("sqp.descInside", loc);
            const unit = getUnitLabel(data.unit ?? "");
            if (typeof data.lat === "number" && typeof data.lng === "number") {
                return `${dir} ${data.radius} ${unit} von ${data.lat.toFixed(4)}°N, ${data.lng.toFixed(4)}°E`;
            }
            return `${dir} ${data.radius} ${unit}`;
        }
        case "thermometer": {
            const dir = data.warmer === false ? t("sqp.descColder", loc) : t("sqp.descWarmer", loc);
            return `${dir} ${t("sqp.descThan", loc)}`;
        }
        case "tentacles": {
            const locLabel = getLocTypeLabel(data.locationType ?? "");
            const unit = getUnitLabel(data.unit ?? "");
            const answeredName =
                answerData?.location?.properties?.name ??
                answerData?.location?.properties?.display_name ??
                null;
            if (answeredName) {
                return `${locLabel}: ${answeredName}`;
            }
            if (answerData && answerData.location === false) {
                return `${locLabel}: ${t("sqp.descNoLocation", loc)}`;
            }
            return `${t("sqp.descNearest", loc)} ${locLabel} (${data.radius} ${unit})`;
        }
        case "matching": {
            const dir = data.same === false ? t("sqp.descOther", loc) : t("sqp.descSame", loc);
            const typeLabel = getMatchTypeLabel(data.type ?? "");
            // For zone types, append the zone name and admin level
            if ((data.type === "zone" || data.type === "letter-zone") && data.cat?.zoneName) {
                return `${dir} ${typeLabel}: ${data.cat.zoneName} (Stufe ${data.cat.adminLevel})`;
            }
            return `${dir} ${typeLabel}`;
        }
        case "measuring": {
            const dir =
                data.hiderCloser === false
                    ? t("sqp.descSeekerCloser", loc)
                    : t("sqp.descHiderCloser", loc);
            const typeLabel = getMeasTypeLabel(data.type ?? "");
            return `${dir} ${typeLabel}`;
        }
        case "photo": {
            const photoTypeKey = `photoType.${data.photoType}` as TranslationKey;
            return `📸 ${t(photoTypeKey, loc) ?? data.photoType}`;
        }
        default:
            return null;
    }
}

// ── Strukturierte Detail-Chips (aufgeklappt) ──────────────────────────────────

function QuestionDetails({
    sq,
    answered = false,
}: {
    sq: {
        type: string; data: unknown; status: string; answerData?: unknown;
        createdAt?: string;
        answeredAt?: string;
        createdByDisplayName?: string;
        answeredByDisplayName?: string;
    };
    answered?: boolean;
}) {
    const d = sq.data as any;
    const a = sq.answerData as any;
    if (!d) return null;

    const rows: { icon: string; text: string }[] = [];

    // ── Timestamps + Autor ────────────────────────────────────────────────
    if (sq.createdAt) {
        const time = formatTime(sq.createdAt);
        const by = sq.createdByDisplayName ? ` von ${sq.createdByDisplayName}` : "";
        rows.push({ icon: "🕐", text: `Gestellt um ${time}${by}` });
    }
    if (sq.answeredAt) {
        const time = formatTime(sq.answeredAt);
        const by = sq.answeredByDisplayName ? ` von ${sq.answeredByDisplayName}` : "";
        rows.push({ icon: "✏️", text: `Beantwortet um ${time}${by}` });
    }

    // Koordinaten (Hauptpunkt)
    if (typeof d.lat === "number" && typeof d.lng === "number") {
        rows.push({
            icon: "📍",
            text: `${d.lat.toFixed(4)}° N, ${d.lng.toFixed(4)}° E`,
        });
    }
    const loc = locale.get();
    // Thermometer: zwei Punkte
    if (sq.type === "thermometer") {
        if (typeof d.latA === "number") {
            rows.push({
                icon: "🅰️",
                text: `${t("sqp.detailPunktA", loc)} ${d.latA.toFixed(4)}° N, ${d.lngA.toFixed(4)}° E`,
            });
        }
        if (typeof d.latB === "number") {
            rows.push({
                icon: "🅱️",
                text: `${t("sqp.detailPunktB", loc)} ${d.latB.toFixed(4)}° N, ${d.lngB.toFixed(4)}° E`,
            });
        }
    }
    // Radius
    if (typeof d.radius === "number" && sq.type !== "thermometer") {
        const unit = getUnitLabel(d.unit ?? "");
        rows.push({ icon: "⭕", text: `${t("sqp.detailRadius", loc)} ${d.radius} ${unit}` });
    }
    // Standorttyp (tentacles)
    if (sq.type === "tentacles" && d.locationType) {
        const label = getLocTypeLabel(d.locationType);
        rows.push({ icon: "🏛️", text: `${t("sqp.detailStandorttyp", loc)} ${label}` });
    }
    // Sub-Typ (matching / measuring)
    if ((sq.type === "matching" || sq.type === "measuring") && d.type) {
        const label =
            sq.type === "matching"
                ? getMatchTypeLabel(d.type)
                : getMeasTypeLabel(d.type);
        rows.push({ icon: "🔎", text: `${t("sqp.detailTyp", loc)} ${label}` });
        // Admin-Level + Zonenname bei Zone
        if (d.cat?.adminLevel != null) {
            const zoneText = d.cat.zoneName
                ? `${d.cat.zoneName} (Stufe ${d.cat.adminLevel})`
                : `${t("sqp.detailVerwaltungsebene", loc)} ${d.cat.adminLevel}`;
            rows.push({
                icon: "🗺️",
                text: zoneText,
            });
        }
    }

    // Photo: Titel + Regeln
    if (sq.type === "photo" && d.photoType) {
        const titleKey = `photoType.${d.photoType}` as TranslationKey;
        const rulesKey = `photoRules.${d.photoType}` as TranslationKey;
        rows.push({ icon: "📸", text: t(titleKey, loc) ?? d.photoType });
        rows.push({ icon: "📋", text: t(rulesKey, loc) ?? "" });
    }

    // ── Measuring: Abstände + Ortsnamen (nur Hider) ─────────────────────────
    const currentRole = sessionParticipant.get()?.role;
    if (sq.type === "measuring" && a && currentRole === "hider") {
        const hDist = a.measuredHiderDistance as number | undefined;
        const sDist = a.measuredSeekerDistance as number | undefined;
        const hPlace = a.measuredHiderPlace as string | null | undefined;
        const sPlace = a.measuredSeekerPlace as string | null | undefined;
        if (typeof hDist === "number" && typeof sDist === "number") {
            rows.push({
                icon: "📏",
                text: hPlace
                    ? `Dein Abstand zu ${hPlace}: ${hDist} km`
                    : `Dein Abstand: ${hDist} km`,
            });
            rows.push({
                icon: "📏",
                text: sPlace
                    ? `Seeker Abstand zu ${sPlace}: ${sDist} km`
                    : `Seeker Abstand: ${sDist} km`,
            });
        }
    }

    // ── Photo answer (Foto oder "Nicht möglich") ─────────────────────────────
    if (sq.status === "answered" && a && sq.type === "photo") {
        if (a.completed === false) {
            rows.push({ icon: "❌", text: "Foto nicht möglich" });
        } else if (a.photoUrl) {
            rows.push({ icon: "📸", text: "Foto aufgenommen" });
        }
    }

    // ── Antwort des Hiders (answerData) ──────────────────────────────────────
    if (sq.status === "answered" && a) {
        if (sq.type === "tentacles") {
            const locName =
                a.location?.properties?.name ??
                a.location?.properties?.display_name ??
                null;
            if (locName) {
                rows.push({ icon: "✅", text: `${t("sqp.detailAntwort", loc)} ${locName}` });
            } else if (a.location === false) {
                rows.push({ icon: "❌", text: t("sqp.detailKeinStandort", loc) });
            }
        }
    }

    // ── Card costs (answered questions, hider only) ────────────────────────
    if (sq.status === "answered" && currentRole === "hider") {
        const cost = getCardCost(sq.type);
        if (cost) {
            rows.push({
                icon: "🃏",
                text: `Ziehe ${cost.draw}, behalte ${cost.keep}`,
            });
        }
    }

    // Erwartete Antwort (nur bei noch offenen Fragen sinnvoll als Frage)
    if (sq.status !== "answered") {
        const expectation = (() => {
            switch (sq.type) {
                case "radius":
                    return d.within === false
                        ? t("sqp.expectOutside", loc)
                        : t("sqp.expectInside", loc);
                case "thermometer":
                    return d.warmer === false
                        ? t("sqp.expectColder", loc)
                        : t("sqp.expectWarmer", loc);
                case "tentacles":
                    return t("sqp.expectNearestStation", loc);
                case "matching":
                    return d.same === false
                        ? t("sqp.expectOtherZone", loc)
                        : t("sqp.expectSameZone", loc);
                case "measuring":
                    return d.hiderCloser === false
                        ? t("sqp.expectSeekerCloser", loc)
                        : t("sqp.expectHiderCloser", loc);
                default:
                    return null;
            }
        })();
        if (expectation) rows.push({ icon: "", text: expectation });
    }

    // Photo image (if answered with a photo)
    const photoUrl = sq.status === "answered" && a?.photoUrl ? a.photoUrl as string : null;

    return (
        <div className="flex flex-col gap-0.5">
            {rows.map((row, i) => (
                <p key={i} className="text-xs font-medium text-white/90">
                    {row.icon ? `${row.icon} ${row.text}` : row.text}
                </p>
            ))}
            {photoUrl && (
                <a
                    href={`${BACKEND_URL_DETAIL}${photoUrl}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ marginTop: 4, borderRadius: 6, overflow: "hidden", display: "block" }}
                >
                    <img
                        src={`${BACKEND_URL_DETAIL}${photoUrl}`}
                        alt="Fotobeweis"
                        style={{ width: "100%", maxHeight: 150, objectFit: "cover", borderRadius: 6 }}
                    />
                </a>
            )}
        </div>
    );
}

// ── Preview label extraction ──────────────────────────────────────────────────

interface PreviewResult {
    /** Short human-readable result text */
    label: string;
    /** True = positive / inside / closer / same; False = negative */
    positive: boolean;
}

function extractPreviewLabel(
    type: string,
    data: unknown,
): PreviewResult | null {
    const d = data as any;
    if (!d) return null;

    const loc = locale.get();
    switch (type) {
        case "radius":
            if (typeof d.within === "boolean") {
                return {
                    label: d.within ? `✅ ${t("sqp.previewInside", loc)}` : `❌ ${t("sqp.previewOutside", loc)}`,
                    positive: d.within,
                };
            }
            break;
        case "thermometer":
            if (typeof d.warmer === "boolean") {
                return {
                    label: d.warmer ? `🔥 ${t("sqp.previewWarmer", loc)}` : `🧊 ${t("sqp.previewColder", loc)}`,
                    positive: d.warmer,
                };
            }
            break;
        case "tentacles": {
            if (d.location === false) {
                return {
                    label: `❌ ${t("sqp.previewOutsideRadius" as TranslationKey, loc)}`,
                    positive: false,
                };
            }
            const name =
                (d.location as any)?.properties?.name ??
                (d.location as any)?.properties?.display_name ??
                null;
            return {
                label: name
                    ? `📍 ${t("sqp.previewNearestPlace", loc)}: ${name}`
                    : `📍 ${t("sqp.previewPlaceFound", loc)}`,
                positive: true,
            };
        }
        case "measuring":
            if (typeof d.hiderCloser === "boolean") {
                const hiderDist = d.measuredHiderDistance as number | undefined;
                const seekerDist = d.measuredSeekerDistance as number | undefined;
                const hiderPlace = d.measuredHiderPlace as string | null | undefined;
                const seekerPlace = d.measuredSeekerPlace as string | null | undefined;

                let label = d.hiderCloser
                    ? t("sqp.previewHiderCloser", loc)
                    : t("sqp.previewSeekerCloser", loc);

                if (typeof hiderDist === "number" && typeof seekerDist === "number") {
                    const hiderLabel = hiderPlace
                        ? `Dein Abstand zu ${hiderPlace}: ${hiderDist} km`
                        : `Dein Abstand: ${hiderDist} km`;
                    const seekerLabel = seekerPlace
                        ? `Seeker Abstand zu ${seekerPlace}: ${seekerDist} km`
                        : `Seeker Abstand: ${seekerDist} km`;
                    label += `\n${hiderLabel}\n${seekerLabel}`;
                }

                return {
                    label,
                    positive: d.hiderCloser,
                };
            }
            break;
        case "matching":
            if (typeof d.same === "boolean") {
                const hiderPlace = (d as any).matchedHiderPlace ?? null;
                if (d.same && hiderPlace) {
                    return {
                        label: `✅ ${t("sqp.previewSamePlace" as TranslationKey, loc)}: ${hiderPlace}`,
                        positive: true,
                    };
                }
                if (!d.same && hiderPlace) {
                    return {
                        label: `❌ ${t("sqp.previewDifferentPlace" as TranslationKey, loc)}: ${hiderPlace}`,
                        positive: false,
                    };
                }
                // Fallback for types without place names (zone, full-variants)
                return {
                    label: d.same ? `✅ ${t("sqp.previewSameZone", loc)}` : `❌ ${t("sqp.previewOtherZone", loc)}`,
                    positive: d.same,
                };
            }
            break;
        case "photo":
            return {
                label: `📸 ${t("photo.confirmed" as TranslationKey, loc)}`,
                positive: true,
            };
    }
    return null;
}

// ── Main component ────────────────────────────────────────────────────────────

export function SessionQuestionPanel() {
    const tr = useT();
    const participant = useStore(sessionParticipant);
    const code = useStore(sessionCode);
    const sqList = useStore(sessionQuestions);
    const $hiderMode = useStore(hiderMode);
    const $isLoading = useStore(isLoading);
    const $localQuestions = useStore(questions_atom);
    const $gpsTracking = useStore(thermometerGpsTracking);
    const [sendingType, setSendingType] = useState<string | null>(null);
    /**
     * Key of the locally-added question that is staged but not yet sent.
     * Stored in a global atom so it survives the sidebar Sheet unmounting
     * on mobile (when the user closes the panel to look at the map).
     */
    const pendingLocalKey = useStore(pendingDraftKey);
    const $pendingPickerType = useStore(pendingPickerType);

    // ── Hider answer state ──────────────────────────────────────────────────
    /** The session question currently being answered (preview mode) */
    const [pendingAnswerSq, setPendingAnswerSq] =
        useState<SessionQuestion | null>(null);
    /** Live-computed preview of the answer */
    const [previewResult, setPreviewResult] = useState<PreviewResult | null>(
        null,
    );
    /** The last fully computed answerData – sent when Hider clicks "Antwort senden" */
    const latestAnswerDataRef = useRef<unknown>(null);
    /** Tracks which question ID has already received the "deadline passed" toast to avoid duplicates */
    const lateNotifiedIdRef = useRef<string | null>(null);
    /** Leaflet polygons showing the Voronoi half-planes while the hider answers a thermometer question */
    const answerColdPolygonRef = useRef<L.Polygon | null>(null);
    /** Leaflet GeoJSON layer showing the Voronoi cell restriction while answering a tentacle question */
    const answerTentacleLayerRef = useRef<L.GeoJSON | null>(null);
    const answerWarmPolygonRef = useRef<L.Polygon | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [loadingGPS, setLoadingGPS] = useState(false);
    const [cardDrawOverlay, setCardDrawOverlay] = useState<{ draw: number; keep: number } | null>(null);
    /** Show GPS-vs-manual dialog when the hider starts answering without a pin */
    const [showLocationDialog, setShowLocationDialog] = useState(false);

    // ── React to question type selected in QuestionPickerSheet ──────────────
    useEffect(() => {
        if ($pendingPickerType === null) return;
        pendingPickerType.set(null);
        stageQuestion($pendingPickerType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [$pendingPickerType]);

    // ── Notify hider when the question being answered expires ───────────────
    // (We no longer cancel — late answers are still accepted by the server.)
    useEffect(() => {
        if (!pendingAnswerSq) {
            lateNotifiedIdRef.current = null;
            return;
        }
        const updated = sqList.find((q) => q.id === pendingAnswerSq.id);
        if (
            updated &&
            updated.status === "expired" &&
            lateNotifiedIdRef.current !== pendingAnswerSq.id
        ) {
            lateNotifiedIdRef.current = pendingAnswerSq.id;
            toast.warning(tr("sqp.deadlinePassedLate"));
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sqList, pendingAnswerSq?.id]);

    // ── Live preview: recompute whenever hiderMode or pending question changes
    useEffect(() => {
        // Photo questions have no geo computation — previewResult and
        // latestAnswerDataRef are already set in startAnswering().
        if (pendingAnswerSq?.type === "photo") return;

        if (!pendingAnswerSq || $hiderMode === false) {
            setPreviewResult(null);
            latestAnswerDataRef.current = null;
            return;
        }

        let cancelled = false;
        hiderifyQuestion({
            id: pendingAnswerSq.type,
            key: 0,
            // Merge drag: true so hiderifyQuestion always runs the hider-side computation,
            // even for questions created before drag was explicitly set in the seeker's config.
            data: { ...(pendingAnswerSq.data as object), drag: true },
        } as any)
            .then(async (answered) => {
                if (cancelled) return;

                // Set preview + answer data immediately so the submit button
                // becomes enabled without waiting for the GeoJSON computation.
                setPreviewResult(
                    extractPreviewLabel(pendingAnswerSq.type, answered.data),
                );
                latestAnswerDataRef.current = { ...answered.data };

                // Pre-compute the resulting GeoJSON so the map restriction
                // survives page reloads without re-querying Overpass.
                const currentMapData = mapGeoJSON.get();
                if (currentMapData) {
                    try {
                        const result = await adjustMapGeoDataForQuestion(
                            { id: pendingAnswerSq.type, data: { ...answered.data, drag: false } },
                            currentMapData,
                        );
                        if (result && !cancelled) {
                            latestAnswerDataRef.current = {
                                ...answered.data,
                                computedGeoJSON: result,
                            };
                        }
                    } catch { /* best-effort: regular Overpass path used as fallback */ }
                }
            })
            .catch((err) => {
                console.warn("[SessionQuestionPanel] hiderify error:", err);
                // Don't clear previewResult — hiderifyQuestion may have
                // succeeded but adjustMapGeoDataForQuestion failed.
            });

        return () => {
            cancelled = true;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [$hiderMode, pendingAnswerSq]);

    // ── Map overlay: show Voronoi half-planes while hider answers a thermometer question
    // The cold polygon (A-side, blue) and warm polygon (B-side, red) are rendered on the
    // Leaflet map and highlight based on the hider's current pin position.
    useEffect(() => {
        const currentMap = leafletMapContext.get();

        // Clean up existing polygons
        if (answerColdPolygonRef.current) {
            currentMap?.removeLayer(answerColdPolygonRef.current);
            answerColdPolygonRef.current = null;
        }
        if (answerWarmPolygonRef.current) {
            currentMap?.removeLayer(answerWarmPolygonRef.current);
            answerWarmPolygonRef.current = null;
        }

        if (!currentMap || !pendingAnswerSq || pendingAnswerSq.type !== "thermometer" || $hiderMode === false) return;

        const d = pendingAnswerSq.data as Record<string, unknown>;
        const latA = typeof d.latA === "number" ? d.latA : null;
        const lngA = typeof d.lngA === "number" ? d.lngA : null;
        const latB = typeof d.latB === "number" ? d.latB : null;
        const lngB = typeof d.lngB === "number" ? d.lngB : null;
        if (latA === null || lngA === null || latB === null || lngB === null) return;

        const voronoi = computeThermometerVoronoi(latA, lngA, latB, lngB);
        if (!voronoi) return;

        const [coldCoords, warmCoords] = voronoi;
        const isWarmer = previewResult?.positive ?? null;
        // While computing (isWarmer === null), show both halves at medium opacity
        // so the bisector boundary is clearly visible.
        const noneSelected = isWarmer === null;

        // Cold polygon — A-side, blue — highlighted when hider is on the colder (closer-to-A) side
        answerColdPolygonRef.current = L.polygon(coldCoords, {
            color:       "#1a3a6b",
            fillColor:   "#1a3a6b",
            fillOpacity: isWarmer === false ? 0.40 : noneSelected ? 0.18 : 0.05,
            weight:      isWarmer === false ? 2.0  : noneSelected ? 1.5  : 0.5,
            opacity:     isWarmer === false ? 0.8  : noneSelected ? 0.5  : 0.15,
        }).addTo(currentMap);

        // Warm polygon — B-side, red — highlighted when hider is on the warmer (closer-to-B) side
        answerWarmPolygonRef.current = L.polygon(warmCoords, {
            color:       "#c0392b",
            fillColor:   "#c0392b",
            fillOpacity: isWarmer === true ? 0.40 : noneSelected ? 0.18 : 0.05,
            weight:      isWarmer === true ? 2.0  : noneSelected ? 1.5  : 0.5,
            opacity:     isWarmer === true ? 0.8  : noneSelected ? 0.5  : 0.15,
        }).addTo(currentMap);

        return () => {
            const m = leafletMapContext.get();
            if (answerColdPolygonRef.current) { m?.removeLayer(answerColdPolygonRef.current); answerColdPolygonRef.current = null; }
            if (answerWarmPolygonRef.current) { m?.removeLayer(answerWarmPolygonRef.current); answerWarmPolygonRef.current = null; }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingAnswerSq, $hiderMode, previewResult]);

    // ── Map overlay: show Voronoi cell restriction while hider answers a tentacle question
    // Renders the pre-computed GeoJSON (Voronoi cell ∩ radius ∩ map boundary) as a
    // semi-transparent polygon so the hider can see how the map will be restricted.
    useEffect(() => {
        const currentMap = leafletMapContext.get();

        // Clean up existing layer
        if (answerTentacleLayerRef.current) {
            currentMap?.removeLayer(answerTentacleLayerRef.current);
            answerTentacleLayerRef.current = null;
        }

        if (!currentMap || !pendingAnswerSq || pendingAnswerSq.type !== "tentacles") return;

        // Only show overlay when a location IS found (hider inside radius)
        const answerData = latestAnswerDataRef.current as any;
        if (!answerData?.computedGeoJSON || answerData?.location === false) return;

        const geoJSON = answerData.computedGeoJSON;
        const isPositive = previewResult?.positive ?? false;

        answerTentacleLayerRef.current = L.geoJSON(geoJSON, {
            style: {
                color:       isPositive ? "#16A34A" : "#E8323A",
                fillColor:   isPositive ? "#16A34A" : "#E8323A",
                fillOpacity: 0.20,
                weight:      2,
                opacity:     0.6,
            },
        }).addTo(currentMap);

        return () => {
            const m = leafletMapContext.get();
            if (answerTentacleLayerRef.current) {
                m?.removeLayer(answerTentacleLayerRef.current);
                answerTentacleLayerRef.current = null;
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingAnswerSq, $hiderMode, previewResult]);

    if (!participant || !code) return null;

    const isHider = participant.role === "hider";

    // ── Seeker: step 1 – add question locally so the seeker can configure it ─

    /** Internal helper: stage a question with explicit data (bypasses map-center defaults) */
    function stageQuestionWithData(type: string, data: Record<string, unknown>) {
        addLocalQuestion({ id: type as any, data });
        const added = [...questions_atom.get()].reverse().find((q) => q.id === type);
        if (added) pendingDraftKey.set(added.key as number);
    }

    function stageQuestion(type: string) {
        const map = leafletMapContext.get();
        if (!map) return;
        const center = map.getCenter();

        let questionData: Record<string, unknown>;
        if (type === "tentacles") {
            // Start with theme_park so schemaFifteen's default is used initially;
            // the user can then switch to any locationType in the question card.
            questionData = { lat: center.lat, lng: center.lng, locationType: "theme_park" };
        } else {
            questionData = { lat: center.lat, lng: center.lng };
        }

        stageQuestionWithData(type, questionData);
    }

    // ── Seeker: step 2 – send the staged question to the hider ───────────────
    async function sendPendingQuestion() {
        if (!code || !participant || pendingLocalKey === null) return;
        const match = questions_atom.get().find((q) => q.key === pendingLocalKey);
        if (!match) {
            toast.error(t("sqp.questionNotFound", locale.get()));
            pendingDraftKey.set(null);
            return;
        }
        setSendingType(match.id);
        try {
            await addQuestion(code, participant.token, {
                type: match.id,
                data: match.data,
            });
            toast.success(t("sqp.questionSent", locale.get()));
            pendingDraftKey.set(null);
        } catch (e: unknown) {
            handleSubmitError(e);
        } finally {
            setSendingType(null);
        }
    }

    // ── Seeker: cancel – remove the staged local question without sending ─────
    function cancelPendingQuestion() {
        if (pendingLocalKey === null) return;
        const current = questions_atom.get();
        questions_atom.set(current.filter((q) => q.key !== pendingLocalKey));
        pendingDraftKey.set(null);
    }

    // ── Hider: enter preview mode for a question ────────────────────────────
    function startAnswering(sq: SessionQuestion) {
        if (sq.type === "photo") {
            // Photo questions skip GPS — the PhotoAnswerUI handles the answer data
            setPendingAnswerSq(sq);
            setPreviewResult(null);
            latestAnswerDataRef.current = null;
            return;
        }
        setPendingAnswerSq(sq);
        setPreviewResult(null);
        latestAnswerDataRef.current = null;
        // If hiderMode is not yet set, ask the hider how they want to position
        // their pin before computing an answer.
        if (hiderMode.get() === false) {
            setShowLocationDialog(true);
        }
    }

    function cancelAnswering() {
        setPendingAnswerSq(null);
        setPreviewResult(null);
        latestAnswerDataRef.current = null;
        setShowLocationDialog(false);
    }

    // ── Hider: request GPS position and activate the hider pin ─────────────
    async function loadGPS() {
        setShowLocationDialog(false);
        setLoadingGPS(true);
        try {
            const pos = await new Promise<GeolocationPosition>(
                (resolve, reject) =>
                    navigator.geolocation.getCurrentPosition(resolve, reject, {
                        timeout: 10_000,
                        enableHighAccuracy: true,
                    }),
            );
            hiderMode.set({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
            });
        } catch {
            toast.error(t("sqp.gpsUnavailable", locale.get()));
        } finally {
            setLoadingGPS(false);
        }
    }

    // ── Hider: place pin at map center for manual positioning ───────────────
    function placeManualPin() {
        setShowLocationDialog(false);
        // Use the current map center as the starting position for the pin.
        // The hider can then drag it to the correct location.
        const map = leafletMapContext.get();
        if (map) {
            const center = map.getCenter();
            hiderMode.set({ latitude: center.lat, longitude: center.lng });
        } else {
            // Fallback: use a default location; the hider will drag it
            hiderMode.set({ latitude: 0, longitude: 0 });
        }
    }

    // ── Hider: submit the computed answer ───────────────────────────────────
    async function submitAnswer() {
        if (!pendingAnswerSq || !code || !participant) return;
        // Photo questions use a separate store for answer data
        const answerPayload = pendingAnswerSq.type === "photo"
            ? photoAnswerData.get()
            : latestAnswerDataRef.current;
        if (!answerPayload) {
            toast.error(t("sqp.noAnswerYet", locale.get()));
            return;
        }
        setSubmitting(true);
        try {
            const answeredType = pendingAnswerSq.type;
            await answerQuestion(pendingAnswerSq.id, participant.token, {
                answerData: answerPayload,
            });
            toast.success(t("sqp.answerSent", locale.get()));
            // Show card draw overlay
            const cost = getCardCost(answeredType);
            if (cost) setCardDrawOverlay(cost);
            setPendingAnswerSq(null);
            setPreviewResult(null);
            latestAnswerDataRef.current = null;
        } catch (e: unknown) {
            handleSubmitError(e);
        } finally {
            setSubmitting(false);
        }
    }

    // ── Seeker view ──────────────────────────────────────────────────────────
    const pendingLocalQuestion =
        pendingLocalKey !== null
            ? $localQuestions.find((q) => q.key === pendingLocalKey) ?? null
            : null;

    if (!isHider) {
        return (
            <div className="flex flex-col gap-3 mt-2">
                {/* ── GPS tracking active indicator ────────────────────────── */}
                {$gpsTracking !== null &&
                    $gpsTracking.questionKey === pendingLocalKey && (
                    <div className="rounded-md px-3 py-2 text-xs text-white flex items-center gap-2"
                        style={{ backgroundColor: "#067BC2" }}>
                        <span>🛰️</span>
                        <span>
                            GPS-Tracking läuft…{" "}
                            {$gpsTracking.traveled.toFixed(2)} /{" "}
                            {$gpsTracking.targetKm} km
                        </span>
                    </div>
                )}


                <QuestionList
                    questions={sqList}
                    isHider={false}
                    pendingLocalQuestion={pendingLocalQuestion}
                    sendingType={sendingType}
                    onCancelPending={cancelPendingQuestion}
                    onSendPending={
                        // Disable send while GPS tracking is still running for this question
                        $gpsTracking !== null && $gpsTracking.questionKey === pendingLocalKey
                            ? undefined
                            : sendPendingQuestion
                    }
                />
            </div>
        );
    }

    // ── Hider view ───────────────────────────────────────────────────────────

    // Card draw overlay (shown after answering)
    if (cardDrawOverlay) {
        return (
            <div style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 16,
                padding: "32px 20px",
                textAlign: "center",
            }}>
                <span style={{ fontSize: 28, fontWeight: 800, color: "#fff", fontFamily: "Poppins, sans-serif" }}>
                    Du darfst Karten ziehen!
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {Array.from({ length: cardDrawOverlay.draw }, (_, i) => (
                        <span key={`d${i}`} style={{ fontSize: 32, opacity: 0.4 }}>🃏</span>
                    ))}
                    <span style={{ color: "#6B7280", fontSize: 20, fontWeight: 700, margin: "0 4px" }}>›</span>
                    {Array.from({ length: cardDrawOverlay.keep }, (_, i) => (
                        <span key={`k${i}`} style={{ fontSize: 32 }}>🃏</span>
                    ))}
                </div>
                <span style={{ color: "#99A1AF", fontSize: 14 }}>
                    Ziehe {cardDrawOverlay.draw}, behalte {cardDrawOverlay.keep}
                </span>
                <button
                    onClick={() => setCardDrawOverlay(null)}
                    style={{
                        marginTop: 8,
                        background: "var(--color-primary)",
                        borderRadius: "var(--radius-pill)",
                        border: "none",
                        cursor: "pointer",
                        padding: "12px 32px",
                        color: "#fff",
                        fontWeight: 700,
                        fontSize: "15px",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                    }}
                >
                    Weiter
                </button>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3 mt-2">
            {/* GPS vs. manual pin selection dialog */}
            <Dialog
                open={showLocationDialog}
                onOpenChange={(open) => {
                    if (!open) setShowLocationDialog(false);
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{tr("sqp.locationDialogTitle")}</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        {tr("sqp.locationDialogDesc")}
                    </p>
                    <div className="flex flex-col gap-2 mt-2">
                        <Button
                            onClick={loadGPS}
                            disabled={loadingGPS}
                            className="w-full text-white border-0 disabled:opacity-40"
                            style={{ backgroundColor: "#067BC2" }}
                        >
                            {loadingGPS
                                ? tr("sqp.loadingGps")
                                : `📍 ${tr("sqp.useGps")}`}
                        </Button>
                        <Button
                            variant="outline"
                            onClick={placeManualPin}
                            className="w-full border-2 font-medium"
                            style={{ borderColor: "#067BC2", color: "#067BC2" }}
                        >
                            🗺️ {tr("sqp.placeManualPin")}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <QuestionList
                questions={sqList.filter((sq) => sq.status !== "answered")}
                isHider={true}
                onAnswer={startAnswering}
                pendingAnswerId={pendingAnswerSq?.id ?? null}
                hiderMode={$hiderMode}
                previewResult={previewResult}
                submitting={submitting}
                onHiderLocationChange={(lat, lng) => hiderMode.set({ latitude: lat, longitude: lng })}
                onSubmitAnswer={submitAnswer}
                onCancelAnswering={cancelAnswering}
                pendingAnswerType={pendingAnswerSq?.type ?? null}
            />

            {/* Answered questions (read-only) */}
            {sqList.some((sq) => sq.status === "answered") && (
                <QuestionList
                    questions={sqList.filter((sq) => sq.status === "answered")}
                    isHider={false}
                />
            )}
        </div>
    );
}

// ── Pending question configuration (Seeker) ──────────────────────────────────

function PendingQuestionConfig({ question }: { question: ReturnType<typeof questions_atom.get>[number] }) {
    switch (question.id) {
        case "radius":
            return (
                <RadiusQuestionComponent
                    data={question.data}
                    questionKey={question.key as number}
                    embedded
                />
            );
        case "thermometer":
            return (
                <ThermometerQuestionComponent
                    data={question.data}
                    questionKey={question.key as number}
                    embedded
                />
            );
        case "tentacles":
            return (
                <TentacleQuestionComponent
                    data={question.data}
                    questionKey={question.key as number}
                    embedded
                />
            );
        case "matching":
            return (
                <MatchingQuestionComponent
                    data={question.data}
                    questionKey={question.key as number}
                    embedded
                />
            );
        case "measuring":
            return (
                <MeasuringQuestionComponent
                    data={question.data}
                    questionKey={question.key as number}
                    embedded
                />
            );
        case "photo":
            return null; // Photo questions are sent directly from PhotoConfig — no inline config
        default:
            return null;
    }
}

// ── Countdown timer component ─────────────────────────────────────────────────

/**
 * Displays a live MM:SS countdown derived from an ISO8601 deadline string.
 * Colour transitions: white → orange (< 60 s) → red+pulse (< 10 s).
 * Shows "Zeit abgelaufen" once the timer reaches zero.
 */
function QuestionCountdown({ deadline }: { deadline: string }) {
    const tr = useT();

    function getRemainingMs(): number {
        return new Date(deadline).getTime() - Date.now();
    }

    const [remainingMs, setRemainingMs] = useState<number>(getRemainingMs);

    useEffect(() => {
        // Sync immediately in case of mount delay
        setRemainingMs(getRemainingMs());

        const interval = setInterval(() => {
            const ms = getRemainingMs();
            setRemainingMs(ms);
            if (ms <= 0) clearInterval(interval);
        }, 1000);

        return () => clearInterval(interval);
    // deadline is stable (ISO string) so no dep needed
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deadline]);

    if (remainingMs <= 0) {
        return (
            <span className="text-xs font-bold" style={{ color: "#D56062" }}>
                ⏰ {tr("sqp.timeExpired")}
            </span>
        );
    }

    const totalSec = Math.ceil(remainingMs / 1000);
    const minutes = Math.floor(totalSec / 60);
    const seconds = totalSec % 60;
    const formatted = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

    const isRed = remainingMs < 10_000;
    const isOrange = !isRed && remainingMs < 60_000;

    const color = isRed ? "#D56062" : isOrange ? "#F37748" : "rgba(255,255,255,0.85)";

    return (
        <span
            className={`text-xs font-bold tabular-nums${isRed ? " animate-pulse" : ""}`}
            style={{ color }}
        >
            ⏱ {formatted}
        </span>
    );
}

// ── Shared question list ─────────────────────────────────────────────────────

export function QuestionList({
    questions,
    isHider,
    onAnswer,
    pendingAnswerId,
    pendingLocalQuestion,
    sendingType,
    onCancelPending,
    onSendPending,
    // Hider inline answer props
    hiderMode: $hiderMode,
    previewResult,
    submitting,
    onHiderLocationChange,
    onSubmitAnswer,
    onCancelAnswering,
    pendingAnswerType,
}: {
    questions: SessionQuestion[];
    isHider: boolean;
    onAnswer?: (q: SessionQuestion) => void;
    /** ID of the question currently in preview mode – disables its button */
    pendingAnswerId?: string | null;
    /** Seeker only: the locally staged question not yet sent */
    pendingLocalQuestion?: ReturnType<typeof questions_atom.get>[number] | null;
    /** Seeker only: sending state for the staged question */
    sendingType?: string | null;
    /** Seeker only: cancel staging */
    onCancelPending?: () => void;
    /** Seeker only: send staged question */
    onSendPending?: () => void;
    // ── Hider inline answer UI props ──
    hiderMode?: { latitude: number; longitude: number } | false;
    previewResult?: PreviewResult | null;
    submitting?: boolean;
    /** Called when hider changes their location (GPS, manual input, search, clipboard) */
    onHiderLocationChange?: (lat: number, lng: number) => void;
    onSubmitAnswer?: () => void;
    onCancelAnswering?: () => void;
    pendingAnswerType?: string | null;
}) {
    const tr = useT();
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const $flash = useStore(recentlyAnswered);

    const hasAnyQuestion = questions.length > 0 || !!pendingLocalQuestion;

    // Only the newest pending question is "active" and gets a countdown.
    const activePendingId =
        [...questions].reverse().find((q) => q.status === "pending")?.id ?? null;

    if (!hasAnyQuestion) {
        return (
            <p className="text-xs text-muted-foreground italic">
                {tr("sqp.noQuestionsYet")}
            </p>
        );
    }

    // ── Inline styles ──────────────────────────────────────────────────────
    const actionLinkStyle: React.CSSProperties = {
        color: "#22C55E",
        fontSize: "12px",
        fontWeight: 600,
        background: "none",
        border: "none",
        cursor: "pointer",
        textAlign: "left" as const,
        padding: 0,
        fontFamily: "inherit",
    };
    const submitBtnStyle: React.CSSProperties = {
        background: "#E8323A",
        color: "#fff",
        border: "none",
        borderRadius: 10,
        padding: "14px",
        fontWeight: 800,
        fontSize: "15px",
        fontFamily: "Poppins, sans-serif",
        width: "100%",
        cursor: "pointer",
        opacity: 1,
    };
    const submitBtnDisabledStyle: React.CSSProperties = {
        ...submitBtnStyle,
        opacity: 0.4,
        cursor: "not-allowed",
    };

    return (
        <div className="flex flex-col gap-2">
            {/* ── State A: staged local question (Seeker only, not yet sent) ─── */}
            {pendingLocalQuestion && (
                <div className="rounded-md p-2 text-sm flex flex-col gap-2"
                    style={{ backgroundColor: "#067BC2" }}>
                    {/* Header */}
                    <div className="flex items-center gap-2">
                        <Send className="h-4 w-4 shrink-0 text-white" />
                        <span className="font-bold flex-1 min-w-0 text-white">
                            {getQuestionLabel(pendingLocalQuestion.id)}
                            {/* Only show "konfigurieren" for types that still need inline setup */}
                            {(pendingLocalQuestion.id === "matching" || pendingLocalQuestion.id === "measuring") && (
                                <span className="ml-2 text-xs font-normal" style={{ color: "#84BCDA" }}>
                                    {tr("sqp.configure")}
                                </span>
                            )}
                        </span>
                    </div>
                    {/* Inline config UI — only for types without a dedicated picker (matching, measuring).
                        Thermometer, radius and tentacles are fully configured before staging. */}
                    {(pendingLocalQuestion.id === "matching" || pendingLocalQuestion.id === "measuring") && (
                        <div className="rounded-md p-2" style={{ backgroundColor: "rgba(255,255,255,0.12)" }}>
                            <PendingQuestionConfig question={pendingLocalQuestion} />
                        </div>
                    )}
                    {/* Action buttons */}
                    <div className="flex flex-col items-start gap-1">
                        <Button
                            size="sm"
                            disabled={sendingType !== null || onSendPending === undefined}
                            onClick={onSendPending}
                            className="border-0 font-bold disabled:opacity-40"
                            style={{ backgroundColor: "#ECC30B", color: "#000" }}
                        >
                            {sendingType !== null
                                ? tr("sqp.sending")
                                : onSendPending === undefined
                                    ? "🛰️ Tracking läuft…"
                                    : tr("sqp.sendQuestion")}
                            {onSendPending !== undefined && <Send className="ml-1 h-3 w-3" />}
                        </Button>
                        <button
                            type="button"
                            onClick={onCancelPending}
                            disabled={sendingType !== null}
                            className="text-xs underline font-medium disabled:opacity-40"
                            style={{ color: "#84BCDA" }}
                        >
                            {tr("sqp.cancel")}
                        </button>
                    </div>
                </div>
            )}

            {/* ── States B / C / D: sent session questions ──────────────── */}
            {[...questions].reverse().map((sq) => {
                const shortDesc = describeQuestion(sq.type, sq.data as any, sq.answerData as any);
                const isExpanded = expandedId === sq.id;
                const isAnswered = sq.status === "answered";
                const isExpired = sq.status === "expired";
                const isPending = sq.status === "pending";
                const isActive = sq.id === activePendingId;
                const isBeingAnswered = isHider && pendingAnswerId === sq.id;

                // ── ConfigCard-style accent colors ──
                const accentBorder = isBeingAnswered
                    ? "#22C55E"
                    : isAnswered
                        ? "#067BC2"
                        : isExpired
                            ? "#6B7280"
                            : "#F59E0B";

                const badgeColor = isBeingAnswered
                    ? "#22C55E"
                    : isAnswered
                        ? "#067BC2"
                        : isExpired
                            ? "#6B7280"
                            : "#F59E0B";

                const statusLabel = isBeingAnswered
                    ? tr("sqp.inProgress")
                    : isAnswered
                        ? tr("sqp.answered")
                        : isExpired
                            ? tr("sqp.expired")
                            : tr("sqp.pending");

                // Lateness: how many seconds/minutes after the deadline was the question answered?
                const lateMs =
                    isAnswered && sq.answeredAt && sq.deadline
                        ? new Date(sq.answeredAt).getTime() - new Date(sq.deadline).getTime()
                        : 0;
                const lateLabel = lateMs > 0 ? formatLateness(lateMs) : null;

                const qData = sq.data as any;

                const flashClass =
                    $flash?.id === sq.id
                        ? $flash.positive ? "hs-flash-positive" : "hs-flash-negative"
                        : "";

                return (
                    <div
                        key={sq.id}
                        className={flashClass}
                        style={{
                            background: "#2A2A3A",
                            borderRadius: 12,
                            borderLeft: `4px solid ${accentBorder}`,
                            padding: "14px 16px",
                            display: "flex",
                            flexDirection: "column",
                            gap: 10,
                        }}
                    >
                        {/* ── Header row: icon + label + status badge pill ── */}
                        <div
                            className="flex items-center gap-2 cursor-pointer select-none"
                            onClick={() =>
                                setExpandedId(isExpanded ? null : sq.id)
                            }
                        >
                            <span style={{ fontSize: "16px", lineHeight: 1 }}>
                                {getQuestionIcon(sq.type)}
                            </span>
                            <span style={{
                                fontWeight: 700,
                                flex: 1,
                                minWidth: 0,
                                color: "#fff",
                                fontSize: "14px",
                            }}>
                                {getQuestionLabel(sq.type)}
                            </span>
                            <span style={{
                                fontSize: "11px",
                                fontWeight: 600,
                                padding: "3px 10px",
                                borderRadius: 999,
                                background: `${badgeColor}22`,
                                color: badgeColor,
                                whiteSpace: "nowrap",
                            }}>
                                {statusLabel}
                            </span>
                            <ChevronDown
                                className={`transition-transform shrink-0 ${isExpanded ? "rotate-180" : ""}`}
                                style={{ width: 14, height: 14, color: "#99A1AF" }}
                            />
                        </div>

                        {/* ── Short description ── */}
                        {shortDesc && !isBeingAnswered && (
                            <p style={{ margin: 0, fontSize: "12px", color: "#99A1AF", lineHeight: 1.4 }}>
                                {shortDesc}
                            </p>
                        )}

                        {/* ── Countdown: only on the active (newest pending) question ── */}
                        {(isActive || isBeingAnswered) && sq.deadline && (
                            <QuestionCountdown deadline={sq.deadline} />
                        )}

                        {/* ── Expired notice ── */}
                        {isExpired && !isBeingAnswered && (
                            <p style={{ margin: 0, fontSize: "12px", fontWeight: 500, color: "#6B7280" }}>
                                ⏰ {tr("sqp.countdownExpired")}
                            </p>
                        )}

                        {/* ── Late label ── */}
                        {lateLabel && (
                            <p style={{ margin: 0, fontSize: "11px", fontWeight: 500, color: "#F59E0B" }}>
                                {lateLabel}
                            </p>
                        )}

                        {/* ── Hider answer button (when NOT already answering) ── */}
                        {isHider && (isPending || isExpired) && !isBeingAnswered && onAnswer && (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onAnswer(sq);
                                }}
                                style={{
                                    background: "#E8323A",
                                    color: "#fff",
                                    border: "none",
                                    borderRadius: 10,
                                    padding: "12px",
                                    fontWeight: 800,
                                    fontSize: "14px",
                                    fontFamily: "Poppins, sans-serif",
                                    width: "100%",
                                    cursor: "pointer",
                                }}
                            >
                                {tr("sqp.answer")}
                            </button>
                        )}

                        {/* ══════════════════════════════════════════════════════════
                            ── INLINE ANSWER UI (Hider, when answering this question)
                            ══════════════════════════════════════════════════════════ */}
                        {isBeingAnswered && sq.type === "photo" && (
                            <PhotoAnswerUI
                                qData={qData}
                                submitting={submitting ?? false}
                                onSubmit={onSubmitAnswer!}
                                onCancel={onCancelAnswering!}
                            />
                        )}

                        {isBeingAnswered && sq.type !== "photo" && (
                            <>
                                {/* Sub-card: question description */}
                                <div style={{
                                    background: "#1E1E2A",
                                    borderRadius: 8,
                                    padding: "10px 12px",
                                    border: "1px solid rgba(255,255,255,0.08)",
                                }}>
                                    <p style={{ margin: 0, fontWeight: 700, color: "#fff", fontSize: "14px", display: "flex", alignItems: "center", gap: 6 }}>
                                        <span style={{ color: "#E8323A" }}>📍</span>
                                        {(() => {
                                            // Show type-specific label
                                            if (sq.type === "matching") {
                                                const matchLabel = getMatchTypeLabel(qData?.type ?? "");
                                                return matchLabel;
                                            }
                                            if (sq.type === "tentacles") {
                                                return getLocTypeLabel(qData?.locationType ?? "");
                                            }
                                            return getQuestionLabel(sq.type);
                                        })()}
                                    </p>
                                    <p style={{ margin: "4px 0 0", color: "#99A1AF", fontSize: "12px", lineHeight: 1.4 }}>
                                        {shortDesc}
                                    </p>
                                </div>

                                {/* Hider location — GPS + manual input via shared LocationCard */}
                                <LocationCard
                                    accentColor="green"
                                    title="Dein Standort (Hider)"
                                    lat={$hiderMode && typeof $hiderMode === "object" ? $hiderMode.latitude : 0}
                                    lng={$hiderMode && typeof $hiderMode === "object" ? $hiderMode.longitude : 0}
                                    onChange={(lat, lng) => onHiderLocationChange?.(lat, lng)}
                                    autoFetchGps={false}
                                />

                                {/* Preview result */}
                                {$hiderMode === false ? (
                                    <p style={{ margin: 0, fontSize: "12px", color: "#6B7280" }}>
                                        {tr("sqp.setPinHint")}
                                    </p>
                                ) : previewResult ? (
                                    <div style={{
                                        background: previewResult.positive
                                            ? "rgba(34,197,94,0.15)"
                                            : "rgba(232,50,58,0.15)",
                                        border: `1px solid ${previewResult.positive ? "#22C55E" : "#E8323A"}`,
                                        borderRadius: 8,
                                        padding: "8px 12px",
                                    }}>
                                        <span style={{
                                            color: previewResult.positive ? "#22C55E" : "#E8323A",
                                            fontWeight: 700,
                                            fontSize: "13px",
                                            whiteSpace: "pre-line",
                                        }}>
                                            {previewResult.label}
                                        </span>
                                    </div>
                                ) : (
                                    <p style={{ margin: 0, fontSize: "12px", color: "#6B7280" }}>
                                        {tr("sqp.computing")}
                                    </p>
                                )}

                                {/* Submit button */}
                                <button
                                    type="button"
                                    disabled={
                                        submitting ||
                                        !previewResult ||
                                        $hiderMode === false
                                    }
                                    onClick={onSubmitAnswer}
                                    style={
                                        (submitting || !previewResult || $hiderMode === false)
                                            ? submitBtnDisabledStyle
                                            : submitBtnStyle
                                    }
                                >
                                    {submitting ? tr("sqp.sending") : tr("sqp.sendAnswer")}
                                </button>

                                {/* Cancel */}
                                <button
                                    type="button"
                                    onClick={onCancelAnswering}
                                    disabled={submitting}
                                    style={{
                                        ...actionLinkStyle,
                                        color: "#99A1AF",
                                        textDecoration: "underline",
                                        opacity: submitting ? 0.4 : 1,
                                        textAlign: "center",
                                        width: "100%",
                                    }}
                                >
                                    {tr("sqp.cancel")}
                                </button>
                            </>
                        )}

                        {/* ── Expanded details (text only – no config UI) ── */}
                        {isExpanded && !isBeingAnswered && (
                            <div style={{
                                paddingTop: 8,
                                borderTop: "1px solid rgba(255,255,255,0.1)",
                            }}>
                                <QuestionDetails
                                    sq={{
                                        type: sq.type,
                                        data: sq.data,
                                        status: sq.status,
                                        answerData: sq.answerData,
                                        createdAt: sq.createdAt,
                                        answeredAt: sq.answeredAt,
                                        createdByDisplayName: sq.createdByDisplayName,
                                        answeredByDisplayName: sq.answeredByDisplayName,
                                    }}
                                    answered={isAnswered}
                                />
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ── Photo answer UI (hider) ─────────────────────────────────────────────────

const BACKEND_URL =
    (typeof import.meta !== "undefined" && (import.meta as any).env?.PUBLIC_BACKEND_URL) ||
    "http://localhost:3001";

function PhotoAnswerUI({
    qData,
    submitting,
    onSubmit,
    onCancel,
}: {
    qData: any;
    submitting: boolean;
    onSubmit: () => void;
    onCancel: () => void;
}) {
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const loc = locale.get();

    async function handleFile(file: File) {
        // Show local preview
        const reader = new FileReader();
        reader.onload = () => setPhotoPreview(reader.result as string);
        reader.readAsDataURL(file);

        // Upload to server
        setUploading(true);
        try {
            const form = new FormData();
            form.append("image", file);
            const resp = await fetch(`${BACKEND_URL}/api/upload`, {
                method: "POST",
                body: form,
            });
            if (!resp.ok) throw new Error("Upload failed");
            const { url } = await resp.json();

            // Set answer data — the parent's latestAnswerDataRef is updated
            // via the previewResult flow, but for photo we set it directly
            // on the ref that submitAnswer reads.
            photoAnswerData.set({ photoUrl: url, completed: true });
        } catch {
            toast.error("Foto-Upload fehlgeschlagen");
            setPhotoPreview(null);
        } finally {
            setUploading(false);
        }
    }

    function handleNotPossible() {
        photoAnswerData.set({ completed: false });
        setPhotoPreview("NOT_POSSIBLE");
    }

    const ready = photoPreview !== null && !uploading;

    return (
        <>
            {/* Challenge info */}
            <div style={{
                background: "#1E1E2A",
                borderRadius: 8,
                padding: "10px 12px",
                border: "1px solid rgba(255,255,255,0.08)",
            }}>
                <p style={{ margin: 0, fontWeight: 700, color: "#fff", fontSize: "14px" }}>
                    📸 {t(`photoType.${qData?.photoType}` as TranslationKey, loc)}
                </p>
                <p style={{ margin: "4px 0 0", color: "#99A1AF", fontSize: "12px", lineHeight: 1.4 }}>
                    {t(`photoRules.${qData?.photoType}` as TranslationKey, loc)}
                </p>
            </div>

            {/* Photo preview */}
            {photoPreview && photoPreview !== "NOT_POSSIBLE" && (
                <div style={{ borderRadius: 8, overflow: "hidden", maxHeight: 200 }}>
                    <img
                        src={photoPreview}
                        alt="Foto-Vorschau"
                        style={{ width: "100%", height: "auto", objectFit: "cover", maxHeight: 200 }}
                    />
                </div>
            )}

            {photoPreview === "NOT_POSSIBLE" && (
                <div style={{
                    background: "rgba(232,50,58,0.15)",
                    border: "1px solid #E8323A",
                    borderRadius: 8,
                    padding: "10px 12px",
                    color: "#E8323A",
                    fontSize: 13,
                    fontWeight: 600,
                    textAlign: "center",
                }}>
                    ❌ Foto nicht möglich
                </div>
            )}

            {/* Action buttons */}
            {!photoPreview && (
                <div style={{ display: "flex", gap: 8 }}>
                    <input
                        ref={fileRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        style={{ display: "none" }}
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFile(file);
                        }}
                    />
                    <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        disabled={uploading}
                        style={{
                            flex: 1,
                            background: "#067BC2",
                            color: "#fff",
                            border: "none",
                            borderRadius: 10,
                            padding: "12px",
                            fontWeight: 700,
                            fontSize: "14px",
                            cursor: "pointer",
                        }}
                    >
                        📷 Foto aufnehmen
                    </button>
                    <button
                        type="button"
                        onClick={handleNotPossible}
                        style={{
                            background: "transparent",
                            color: "#E8323A",
                            border: "2px solid #E8323A",
                            borderRadius: 10,
                            padding: "12px",
                            fontWeight: 700,
                            fontSize: "14px",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                        }}
                    >
                        ❌ Nicht möglich
                    </button>
                </div>
            )}

            {/* Submit */}
            {ready && (
                <button
                    type="button"
                    disabled={submitting}
                    onClick={onSubmit}
                    style={{
                        background: "#22C55E",
                        color: "#fff",
                        border: "none",
                        borderRadius: 10,
                        padding: "14px",
                        fontWeight: 800,
                        fontSize: "15px",
                        width: "100%",
                        cursor: submitting ? "not-allowed" : "pointer",
                        opacity: submitting ? 0.4 : 1,
                    }}
                >
                    {submitting ? "Senden..." : "📸 Antwort senden"}
                </button>
            )}

            {/* Cancel */}
            <button
                type="button"
                onClick={onCancel}
                disabled={submitting}
                style={{
                    background: "none",
                    border: "none",
                    color: "#99A1AF",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    textDecoration: "underline",
                    padding: 0,
                    opacity: submitting ? 0.4 : 1,
                }}
            >
                Abbrechen
            </button>
        </>
    );
}
