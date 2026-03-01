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
    defaultUnit,
    hiderMode,
    isLoading,
    leafletMapContext,
    questions as questions_atom,
} from "@/lib/context";
import { SidebarContext } from "@/components/ui/sidebar-l-context";
import { hiderifyQuestion } from "@/maps";
import { addQuestion, answerQuestion } from "@/lib/session-api";
import {
    pendingDraftKey,
    sessionCode,
    sessionParticipant,
    sessionQuestions,
    thermometerGpsTracking,
} from "@/lib/session-context";
import type { SessionQuestion } from "@hideandseek/shared";
import { locale, t, useT, type TranslationKey } from "@/i18n";

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
        default:
            return null;
    }
}

// ── Strukturierte Detail-Chips (aufgeklappt) ──────────────────────────────────

function QuestionDetails({
    sq,
    answered = false,
}: {
    sq: { type: string; data: unknown; status: string; answerData?: unknown };
    answered?: boolean;
}) {
    const d = sq.data as any;
    const a = sq.answerData as any;
    if (!d) return null;

    const rows: { icon: string; text: string }[] = [];

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
        // Admin-Level bei Zone
        if (d.cat?.adminLevel != null) {
            rows.push({
                icon: "🗺️",
                text: `${t("sqp.detailVerwaltungsebene", loc)} ${d.cat.adminLevel}`,
            });
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

    return (
        <div className="flex flex-col gap-0.5">
            {rows.map((row, i) => (
                <p key={i} className="text-xs font-medium text-white/90">
                    {row.icon ? `${row.icon} ${row.text}` : row.text}
                </p>
            ))}
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
            const name =
                (d.location as any)?.properties?.name ??
                (d.location as any)?.properties?.display_name ??
                null;
            return {
                label: name ? `📍 ${t("sqp.previewNearestPlace", loc)}: ${name}` : `📍 ${t("sqp.previewPlaceFound", loc)}`,
                positive: !!d.location,
            };
        }
        case "measuring":
            if (typeof d.hiderCloser === "boolean") {
                return {
                    label: d.hiderCloser
                        ? `📏 ${t("sqp.previewHiderCloser", loc)}`
                        : `📏 ${t("sqp.previewSeekerCloser", loc)}`,
                    positive: d.hiderCloser,
                };
            }
            break;
        case "matching":
            if (typeof d.same === "boolean") {
                return {
                    label: d.same ? `✅ ${t("sqp.previewSameZone", loc)}` : `❌ ${t("sqp.previewOtherZone", loc)}`,
                    positive: d.same,
                };
            }
            break;
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
    const $defaultUnit = useStore(defaultUnit);
    const $gpsTracking = useStore(thermometerGpsTracking);
    const [sendingType, setSendingType] = useState<string | null>(null);
    /** Active thermometer GPS setup dialog: { selectedKm: null | number } | null */
    const [thermometerSetup, setThermometerSetup] = useState<{
        selectedKm: number | null;
        loadingGps: boolean;
        errorMsg: string | null;
    } | null>(null);
    /**
     * Key of the locally-added question that is staged but not yet sent.
     * Stored in a global atom so it survives the sidebar Sheet unmounting
     * on mobile (when the user closes the panel to look at the map).
     */
    const pendingLocalKey = useStore(pendingDraftKey);

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
    const [submitting, setSubmitting] = useState(false);
    const [loadingGPS, setLoadingGPS] = useState(false);
    /** Show GPS-vs-manual dialog when the hider starts answering without a pin */
    const [showLocationDialog, setShowLocationDialog] = useState(false);

    // ── Live preview: recompute whenever hiderMode or pending question changes
    useEffect(() => {
        if (!pendingAnswerSq || $hiderMode === false) {
            setPreviewResult(null);
            latestAnswerDataRef.current = null;
            return;
        }

        let cancelled = false;
        hiderifyQuestion({
            id: pendingAnswerSq.type,
            key: 0,
            data: pendingAnswerSq.data,
        } as any)
            .then((answered) => {
                if (cancelled) return;
                latestAnswerDataRef.current = answered.data;
                setPreviewResult(
                    extractPreviewLabel(pendingAnswerSq.type, answered.data),
                );
            })
            .catch(() => {
                if (!cancelled) setPreviewResult(null);
            });

        return () => {
            cancelled = true;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [$hiderMode, pendingAnswerSq]);

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
        // Thermometer: show GPS-setup dialog first instead of staging directly
        if (type === "thermometer") {
            setThermometerSetup({ selectedKm: null, loadingGps: false, errorMsg: null });
            return;
        }

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

    // ── Seeker: GPS thermometer start ─────────────────────────────────────────
    async function startGpsTracking(targetKm: number) {
        setThermometerSetup((s) => s ? { ...s, loadingGps: true, errorMsg: null } : s);
        try {
            const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 15_000,
                }),
            );
            const { latitude: lat, longitude: lng } = pos.coords;

            // Stage thermometer with GPS start as A; B = 100 m east (placeholder, updated when done)
            const dest = turf.destination([lng, lat], 0.1, 90, { units: "kilometers" });
            stageQuestionWithData("thermometer", {
                latA: lat,
                lngA: lng,
                latB: dest.geometry.coordinates[1],
                lngB: dest.geometry.coordinates[0],
            });

            // Kick off tracking (ThermometerGpsLayer picks this up)
            thermometerGpsTracking.set({
                questionKey: pendingDraftKey.get()!,
                targetKm,
                startLat: lat,
                startLng: lng,
                currentLat: lat,
                currentLng: lng,
                traveled: 0,
                lastMoveTime: Date.now(),
                accuracy: pos.coords.accuracy ?? null,
                signalLost: false,
            });

            setThermometerSetup(null);
            // Close sidebar so the user can see the map + overlay
            SidebarContext.get().setOpenMobile(false);
        } catch {
            setThermometerSetup((s) =>
                s ? { ...s, loadingGps: false, errorMsg: t("sqp.gpsUnavailable", locale.get()) } : s,
            );
        }
    }

    // ── Seeker: manual thermometer (classic flow) ─────────────────────────────
    function stageThermometerManual() {
        const map = leafletMapContext.get();
        if (!map) return;
        const center = map.getCenter();
        const dest = turf.destination([center.lng, center.lat], 5, 90, { units: "miles" });
        stageQuestionWithData("thermometer", {
            latA: center.lat,
            lngA: center.lng,
            latB: dest.geometry.coordinates[1],
            lngB: dest.geometry.coordinates[0],
        });
        setThermometerSetup(null);
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
            toast.error((e as Error).message);
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
        if (!latestAnswerDataRef.current) {
            toast.error(t("sqp.noAnswerYet", locale.get()));
            return;
        }
        setSubmitting(true);
        try {
            await answerQuestion(pendingAnswerSq.id, participant.token, {
                answerData: latestAnswerDataRef.current,
            });
            toast.success(t("sqp.answerSent", locale.get()));
            setPendingAnswerSq(null);
            setPreviewResult(null);
            latestAnswerDataRef.current = null;
        } catch (e: unknown) {
            toast.error((e as Error).message);
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
        // ── Distance chips for GPS thermometer setup ──────────────────────────
        const isMetric = $defaultUnit !== "miles";
        const distanceChips: { label: string; km: number }[] = isMetric
            ? [
                { label: "1 km",  km: 1  },
                { label: "3 km",  km: 3  },
                { label: "8 km",  km: 8  },
                { label: "25 km", km: 25 },
                { label: "80 km", km: 80 },
              ]
            : [
                { label: "½ mi", km: 0.80  },
                { label: "5 mi", km: 8.05  },
                { label: "15 mi", km: 24.14 },
                { label: "50 mi", km: 80.47 },
              ];

        return (
            <div className="flex flex-col gap-3 mt-2">
                {/* ── Section header */}
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#067BC2" }}>
                    {tr("sqp.askQuestion")}
                </p>

                {/* ── Thermometer GPS setup card ──────────────────────────── */}
                {thermometerSetup !== null && (
                    <div className="rounded-md p-3 flex flex-col gap-2" style={{ backgroundColor: "#067BC2" }}>
                        <p className="text-sm font-bold text-white">🌡️ Thermometer konfigurieren</p>

                        {/* Distance chips */}
                        <p className="text-xs text-white/80">Zieldistanz:</p>
                        <div className="flex flex-wrap gap-1.5">
                            {distanceChips.map((chip) => (
                                <button
                                    key={chip.km}
                                    type="button"
                                    onClick={() =>
                                        setThermometerSetup((s) =>
                                            s ? { ...s, selectedKm: chip.km } : s,
                                        )
                                    }
                                    className="px-3 py-1 rounded-full text-xs font-bold transition-colors"
                                    style={
                                        thermometerSetup.selectedKm === chip.km
                                            ? { backgroundColor: "#ECC30B", color: "#000" }
                                            : { backgroundColor: "rgba(255,255,255,0.15)", color: "#fff" }
                                    }
                                >
                                    {chip.label}
                                </button>
                            ))}
                        </div>

                        {/* Error message */}
                        {thermometerSetup.errorMsg && (
                            <p className="text-xs text-red-200">{thermometerSetup.errorMsg}</p>
                        )}

                        {/* Action buttons */}
                        <div className="flex flex-col gap-1 mt-1">
                            <Button
                                size="sm"
                                disabled={
                                    thermometerSetup.selectedKm === null ||
                                    thermometerSetup.loadingGps
                                }
                                onClick={() =>
                                    thermometerSetup.selectedKm !== null &&
                                    startGpsTracking(thermometerSetup.selectedKm)
                                }
                                className="border-0 font-bold disabled:opacity-40"
                                style={{ backgroundColor: "#ECC30B", color: "#000" }}
                            >
                                {thermometerSetup.loadingGps ? "GPS wird geladen…" : "🛰️ GPS-Tracking starten"}
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={stageThermometerManual}
                                disabled={thermometerSetup.loadingGps}
                                className="border-0 font-medium disabled:opacity-40"
                                style={{ backgroundColor: "rgba(255,255,255,0.15)", color: "#fff" }}
                            >
                                Manuell
                            </Button>
                            <button
                                type="button"
                                onClick={() => setThermometerSetup(null)}
                                disabled={thermometerSetup.loadingGps}
                                className="text-xs underline font-medium disabled:opacity-40"
                                style={{ color: "#84BCDA" }}
                            >
                                Abbrechen
                            </button>
                        </div>
                    </div>
                )}

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

                {/* ── Question-type buttons (hidden while setup shown) ─────── */}
                {thermometerSetup === null && (
                    <div className="flex flex-wrap gap-1.5">
                        {["radius", "thermometer", "tentacles", "matching", "measuring"].map((type) => (
                            <Button
                                key={type}
                                size="sm"
                                disabled={
                                    sendingType !== null ||
                                    $isLoading ||
                                    pendingLocalKey !== null ||
                                    $gpsTracking !== null
                                }
                                onClick={() => stageQuestion(type)}
                                className="text-white border-0 disabled:opacity-40"
                                style={{ backgroundColor: "#067BC2" }}
                            >
                                {getQuestionLabel(type)}
                            </Button>
                        ))}
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
            {/* GPS / Pin status bar */}
            <div className="flex items-center gap-2 flex-wrap rounded-md px-2 py-1.5" style={{ backgroundColor: "#84BCDA" }}>
                <MapPin className="h-4 w-4 shrink-0 text-white" />
                {$hiderMode && typeof $hiderMode === "object" ? (
                    <>
                        <span className="text-xs font-medium text-white">
                            GPS:{" "}
                            {$hiderMode.latitude.toFixed(4)},{" "}
                            {$hiderMode.longitude.toFixed(4)}
                        </span>
                        <button
                            type="button"
                            className="ml-auto text-xs underline font-medium"
                            style={{ color: "#D56062" }}
                            onClick={() => hiderMode.set(false)}
                        >
                            {tr("sqp.removePin")}
                        </button>
                    </>
                ) : (
                    <span className="text-xs text-white/80">
                        {tr("sqp.noPinSet")}
                    </span>
                )}
            </div>

            {/* ── Active answer preview panel ─────────────────────────────── */}
            {pendingAnswerSq && (
                <div className="rounded-md p-3 flex flex-col gap-2" style={{ backgroundColor: "#067BC2" }}>
                    <p className="text-sm font-bold text-white">
                        {getQuestionLabel(pendingAnswerSq.type)}{" "}
                        – {tr("sqp.prepareAnswer")}
                    </p>

                    {/* GPS button */}
                    <Button
                        size="sm"
                        disabled={loadingGPS}
                        onClick={loadGPS}
                        className="self-start border-0 font-bold disabled:opacity-40"
                        style={{ backgroundColor: "#84BCDA", color: "#fff" }}
                    >
                        {loadingGPS ? tr("sqp.loadingGps") : `📍 ${tr("sqp.useGpsShort")}`}
                    </Button>

                    {/* Live preview */}
                    {$hiderMode === false ? (
                        <p className="text-xs text-white/70">
                            {tr("sqp.setPinHint")}
                        </p>
                    ) : previewResult ? (
                        <div
                            className="rounded px-3 py-2 text-sm font-bold text-white"
                            style={{ backgroundColor: previewResult.positive ? "#ECC30B" : "#D56062",
                                     color: previewResult.positive ? "#000" : "#fff" }}
                        >
                            {previewResult.label}
                        </div>
                    ) : (
                        <p className="text-xs text-white/70">
                            {tr("sqp.computing")}
                        </p>
                    )}

                    {/* Action buttons */}
                    <div className="flex flex-col items-start gap-1 mt-1">
                        <Button
                            size="sm"
                            disabled={
                                submitting ||
                                !latestAnswerDataRef.current ||
                                $hiderMode === false
                            }
                            onClick={submitAnswer}
                            className="border-0 font-bold disabled:opacity-40"
                            style={{ backgroundColor: "#ECC30B", color: "#000" }}
                        >
                            {submitting ? tr("sqp.sending") : tr("sqp.sendAnswer")}
                        </Button>
                        <button
                            type="button"
                            onClick={cancelAnswering}
                            disabled={submitting}
                            className="text-xs underline font-medium disabled:opacity-40"
                            style={{ color: "#84BCDA" }}
                        >
                            {tr("sqp.cancel")}
                        </button>
                    </div>
                </div>
            )}

            <QuestionList
                questions={sqList}
                isHider={true}
                onAnswer={startAnswering}
                pendingAnswerId={pendingAnswerSq?.id ?? null}
            />
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
        default:
            return null;
    }
}

// ── Shared question list ─────────────────────────────────────────────────────

function QuestionList({
    questions,
    isHider,
    onAnswer,
    pendingAnswerId,
    pendingLocalQuestion,
    sendingType,
    onCancelPending,
    onSendPending,
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
}) {
    const tr = useT();
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const hasAnyQuestion = questions.length > 0 || !!pendingLocalQuestion;

    if (!hasAnyQuestion) {
        return (
            <p className="text-xs text-muted-foreground italic">
                {tr("sqp.noQuestionsYet")}
            </p>
        );
    }

    return (
        <div className="flex flex-col gap-2">
            {/* Section header */}
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#067BC2" }}>
                {tr("sqp.questions")} ({questions.length + (pendingLocalQuestion ? 1 : 0)})
            </p>

            {/* ── State A: staged local question (Seeker only, not yet sent) ─── */}
            {pendingLocalQuestion && (
                <div className="rounded-md p-2 text-sm flex flex-col gap-2"
                    style={{ backgroundColor: "#067BC2" }}>
                    {/* Header */}
                    <div className="flex items-center gap-2">
                        <Send className="h-4 w-4 shrink-0 text-white" />
                        <span className="font-bold flex-1 min-w-0 text-white">
                            {getQuestionLabel(pendingLocalQuestion.id)}
                            <span className="ml-2 text-xs font-normal" style={{ color: "#84BCDA" }}>
                                {tr("sqp.configure")}
                            </span>
                        </span>
                    </div>
                    {/* Inline config UI — editable, white background for form readability */}
                    <div className="rounded-md p-2" style={{ backgroundColor: "rgba(255,255,255,0.12)" }}>
                        <PendingQuestionConfig question={pendingLocalQuestion} />
                    </div>
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

            {/* ── States B + C: sent session questions ─────────────────────── */}
            {[...questions].reverse().map((sq) => {
                const shortDesc = describeQuestion(sq.type, sq.data as any, sq.answerData as any);
                const isExpanded = expandedId === sq.id;
                const isAnswered = sq.status === "answered";
                // State C (answered): solid #84BCDA; State B (pending): solid #F37748
                const bgColor = isAnswered ? "#84BCDA" : "#F37748";
                const accentColor = isAnswered ? "#067BC2" : "#ECC30B";
                return (
                    <div
                        key={sq.id}
                        className="rounded-md p-2 text-sm"
                        style={{ backgroundColor: bgColor }}
                    >
                        {/* ── Header row: icon + label + chevron + action button ── */}
                        <div
                            className="flex items-center gap-2 cursor-pointer select-none"
                            onClick={() =>
                                setExpandedId(isExpanded ? null : sq.id)
                            }
                        >
                            {isAnswered ? (
                                <CheckCircle className="h-4 w-4 shrink-0 text-white" />
                            ) : (
                                <Clock className="h-4 w-4 shrink-0 text-white" />
                            )}
                            <span className="font-semibold flex-1 min-w-0 text-white">
                                {getQuestionLabel(sq.type)}
                                <span className="ml-2 text-xs font-normal" style={{ color: accentColor }}>
                                    {isAnswered ? tr("sqp.answered") : tr("sqp.pending")}
                                </span>
                            </span>
                            <ChevronDown
                                className={`h-3 w-3 transition-transform shrink-0 text-white ${isExpanded ? "rotate-180" : ""}`}
                            />
                            {isHider && sq.status === "pending" && onAnswer && (
                                <Button
                                    size="sm"
                                    disabled={pendingAnswerId === sq.id}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onAnswer(sq);
                                    }}
                                    className="border-0 font-bold disabled:opacity-40"
                                    style={{ backgroundColor: "#ECC30B", color: "#000" }}
                                >
                                    {pendingAnswerId === sq.id
                                        ? tr("sqp.inProgress")
                                        : tr("sqp.answer")}
                                </Button>
                            )}
                        </div>

                        {/* ── Short description (always visible) ── */}
                        {shortDesc && (
                            <p className="text-xs mt-0.5 ml-6 leading-snug text-white/80">
                                {shortDesc}
                            </p>
                        )}

                        {/* ── Expanded details (text only – no config UI) ── */}
                        {isExpanded && (
                            <div className="mt-2 ml-6 pt-2 border-t border-white/30">
                                <QuestionDetails
                                    sq={{
                                        type: sq.type,
                                        data: sq.data,
                                        status: sq.status,
                                        answerData: sq.answerData,
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
