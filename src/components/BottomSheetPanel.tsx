/**
 * BottomSheetPanel — renders the bottom sheet with tabs:
 *   1. "Fragen" — session questions (with countdown for hider)
 *   2. "Versteckzonen" — hiding zone configuration
 *   3. "Settings" — opened via gear icon
 */
import { useStore } from "@nanostores/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/i18n";

import { BottomSheet } from "@/components/ui/BottomSheet";
import type { BottomSheetTab } from "@/components/ui/BottomSheet";
import { OptionDrawersInline } from "@/components/OptionDrawers";
import { sessionCode, sessionParticipant, sessionQuestions } from "@/lib/session-context";
import { bottomSheetState, pickerOpen } from "@/lib/bottom-sheet-state";
import { useSessionMapSync } from "@/hooks/useSessionMapSync";
import { useSessionInit } from "@/hooks/useSessionInit";
import { useMapLocationSync } from "@/hooks/useMapLocationSync";
import { useSessionWebSocket } from "@/hooks/useSessionWebSocket";
import { useGpsTracking } from "@/hooks/useGpsTracking";

import { SessionManager } from "./session/SessionManager";
import { QuestionPickerSheet } from "./session/QuestionPickerSheet";
import { ZoneSidebar } from "./ZoneSidebar";
import { AnswerOverlay, answerOverlayTapped } from "./AnswerOverlay";

// ── Category icons for the Fragen tab countdown ─────────────────────────────
const QUESTION_ICONS: Record<string, string> = {
    radius: "⭕",
    thermometer: "🌡️",
    tentacles: "🐙",
    matching: "🔀",
    measuring: "📏",
    photo: "📸",
};

const ZONE_ICON = (
    <svg width="18" height="18" viewBox="0 0 18 18">
        <circle cx="9" cy="9" r="7" fill="none" stroke="#22C55E" strokeWidth="2.5" />
        <circle cx="9" cy="9" r="2.5" fill="#22C55E" />
    </svg>
);

function formatCountdown(ms: number): string {
    if (ms <= 0) return "0:00";
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, "0")}`;
}

export const BottomSheetPanel = () => {
    const [activeTab, setActiveTab] = useState("fragen");
    const [now, setNow] = useState(Date.now());

    const tr = useT();

    useSessionMapSync();
    useSessionInit();
    useMapLocationSync();
    useGpsTracking();

    const $participant = useStore(sessionParticipant);
    const $code = useStore(sessionCode);
    const sqList = useStore(sessionQuestions);

    // WS hook lives here (always mounted) so the connection survives sheet collapse.
    useSessionWebSocket(
        $participant && $code
            ? { code: $code, token: $participant.token }
            : { code: "", token: "" },
    );

    const inSession = $participant !== null;
    const isHider = $participant?.role === "hider";

    // Find the newest pending question (for countdown)
    const pendingQuestion = useMemo(
        () => [...sqList].reverse().find((q) => q.status === "pending") ?? null,
        [sqList],
    );

    // Register callback so AnswerOverlay can switch to the Fragen tab
    useEffect(() => {
        answerOverlayTapped.onTap(() => setActiveTab("fragen"));
    }, []);

    // Track if a new pending question just arrived (for vibration)
    const prevPendingIdRef = useRef<string | null>(null);
    useEffect(() => {
        if (pendingQuestion && isHider && pendingQuestion.id !== prevPendingIdRef.current) {
            // New pending question — vibrate
            if (navigator.vibrate) {
                navigator.vibrate([200, 100, 200]);
            }
        }
        prevPendingIdRef.current = pendingQuestion?.id ?? null;
    }, [pendingQuestion?.id, isHider]);

    // Tick every second for countdown
    useEffect(() => {
        if (!pendingQuestion || !isHider) return;
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, [pendingQuestion, isHider]);

    // Collapse sheet when entering a session
    useEffect(() => {
        if (inSession) bottomSheetState.set("collapsed");
    }, [inSession]);

    // Build dynamic Fragen tab label
    const fragenTab: BottomSheetTab = useMemo(() => {
        if (isHider && pendingQuestion?.deadline) {
            const remaining = new Date(pendingQuestion.deadline).getTime() - now;
            const icon = QUESTION_ICONS[pendingQuestion.type] ?? "❓";
            return {
                id: "fragen",
                label: `${icon} ${formatCountdown(remaining)}`,
                pulse: remaining > 0,
            };
        }
        return { id: "fragen", label: "Fragen" };
    }, [isHider, pendingQuestion, now]);

    const tabs: BottomSheetTab[] = useMemo(
        () => [fragenTab, { id: "zonen", label: "Versteckzonen", icon: ZONE_ICON }],
        [fragenTab],
    );

    function handleTabChange(tabId: string) {
        // Seeker: tapping "Fragen" opens the question picker
        if (tabId === "fragen" && inSession && $participant?.role === "seeker") {
            pickerOpen.set(true);
        }
        setActiveTab(tabId);
    }

    return (
        <>
            <BottomSheet
                tabs={tabs}
                activeTab={activeTab}
                onTabChange={handleTabChange}
                onSettingsClick={() => {
                    setActiveTab("settings");
                    if (bottomSheetState.get() === "collapsed") bottomSheetState.set("default");
                }}
            >
                {/* Both tabs stay mounted to preserve map layers & state */}
                <div style={{ display: activeTab === "fragen" ? "block" : "none" }}>
                    <div className="px-3 py-2">
                        {$participant ? <SessionManager /> : null}
                    </div>
                </div>
                <div style={{ display: activeTab === "zonen" ? "block" : "none" }}>
                    <ZoneSidebar />
                </div>
                <div style={{ display: activeTab === "settings" ? "block" : "none" }}>
                    <OptionDrawersInline />
                </div>
            </BottomSheet>
            <QuestionPickerSheet />
            <AnswerOverlay />
        </>
    );
};
