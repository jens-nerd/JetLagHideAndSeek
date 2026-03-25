/**
 * NotificationOverlay — full-screen overlay for:
 *   - Seeker: when the hider answers a question
 *   - Hider: when a new question arrives from a seeker
 *
 * Tap to dismiss → opens the Fragen tab with the relevant question expanded.
 */
import { useStore } from "@nanostores/react";

import {
    autoExpandQuestionId,
    newQuestionReceived,
    recentlyAnswered,
    sessionParticipant,
} from "@/lib/session-context";
import { bottomSheetState } from "@/lib/bottom-sheet-state";

const QUESTION_ICONS: Record<string, string> = {
    radius: "⭕",
    thermometer: "🌡️",
    tentacles: "🐙",
    matching: "🔀",
    measuring: "📏",
    photo: "📸",
};

const QUESTION_LABELS: Record<string, string> = {
    radius: "Radius",
    thermometer: "Thermometer",
    tentacles: "Tentakel",
    matching: "Matching",
    measuring: "Messen",
    photo: "Foto",
};

/** Exposed so BottomSheetPanel can switch to the Fragen tab */
export const overlayTapped = {
    _cb: null as (() => void) | null,
    onTap(cb: () => void) { this._cb = cb; },
    fire() { this._cb?.(); },
};

export function AnswerOverlay() {
    const $answered = useStore(recentlyAnswered);
    const $newQuestion = useStore(newQuestionReceived);
    const $participant = useStore(sessionParticipant);

    const isSeeker = $participant?.role === "seeker";
    const isHider = $participant?.role === "hider";

    // Seeker overlay: hider answered
    if ($answered && isSeeker) {
        return (
            <OverlayCard
                icon={$answered.positive ? "✅" : "❌"}
                title="Neue Antwort!"
                subtitle="Tippe um Details zu sehen"
                color={$answered.positive ? "#22C55E" : "#E8323A"}
                onTap={() => {
                    autoExpandQuestionId.set($answered.id);
                    bottomSheetState.set("expanded");
                    overlayTapped.fire();
                    recentlyAnswered.set(null);
                }}
            />
        );
    }

    // Hider overlay: new question from seeker
    if ($newQuestion && isHider) {
        const icon = QUESTION_ICONS[$newQuestion.type] ?? "❓";
        const label = QUESTION_LABELS[$newQuestion.type] ?? "Frage";
        return (
            <OverlayCard
                icon={icon}
                title="Neue Frage!"
                subtitle={`${label} — Tippe um zu antworten`}
                color="#F59E0B"
                onTap={() => {
                    autoExpandQuestionId.set($newQuestion.id);
                    bottomSheetState.set("expanded");
                    overlayTapped.fire();
                    newQuestionReceived.set(null);
                }}
            />
        );
    }

    return null;
}

function OverlayCard({
    icon,
    title,
    subtitle,
    color,
    onTap,
}: {
    icon: string;
    title: string;
    subtitle: string;
    color: string;
    onTap: () => void;
}) {
    return (
        <div
            onClick={onTap}
            style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 1050,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0,0,0,0.6)",
                cursor: "pointer",
                animation: "fadeIn 0.2s ease-out",
            }}
        >
            <div
                style={{
                    background: `${color}18`,
                    border: `3px solid ${color}`,
                    borderRadius: 16,
                    padding: "32px 40px",
                    textAlign: "center",
                    boxShadow: `0 0 40px ${color}4D`,
                }}
            >
                <div style={{ fontSize: 40, marginBottom: 8 }}>
                    {icon}
                </div>
                <div style={{
                    color: "#fff",
                    fontSize: 22,
                    fontWeight: 800,
                    fontFamily: "Poppins, sans-serif",
                }}>
                    {title}
                </div>
                <div style={{
                    color: "#99A1AF",
                    fontSize: 14,
                    marginTop: 8,
                }}>
                    {subtitle}
                </div>
            </div>
        </div>
    );
}
