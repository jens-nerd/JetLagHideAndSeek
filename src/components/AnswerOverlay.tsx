/**
 * AnswerOverlay — full-screen overlay shown to seekers when the hider answers.
 *
 * Tap to dismiss → opens the Fragen tab with the answered question expanded.
 */
import { useStore } from "@nanostores/react";

import {
    autoExpandQuestionId,
    recentlyAnswered,
    sessionParticipant,
} from "@/lib/session-context";
import { bottomSheetState } from "@/lib/bottom-sheet-state";

/** Exposed so BottomSheetPanel can switch to the Fragen tab */
export const answerOverlayTapped = {
    _cb: null as (() => void) | null,
    onTap(cb: () => void) { this._cb = cb; },
    fire() { this._cb?.(); },
};

export function AnswerOverlay() {
    const $answered = useStore(recentlyAnswered);
    const $participant = useStore(sessionParticipant);

    if (!$answered || $participant?.role !== "seeker") return null;

    function handleTap() {
        if (!$answered) return;
        // Tell QuestionListInner to expand this question
        autoExpandQuestionId.set($answered.id);
        // Open the bottom sheet
        bottomSheetState.set("expanded");
        // Tell BottomSheetPanel to switch to Fragen tab
        answerOverlayTapped.fire();
        // Clear the overlay
        recentlyAnswered.set(null);
    }

    const positive = $answered.positive;

    return (
        <div
            onClick={handleTap}
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
                    background: positive ? "rgba(34,197,94,0.15)" : "rgba(232,50,58,0.15)",
                    border: `3px solid ${positive ? "#22C55E" : "#E8323A"}`,
                    borderRadius: 16,
                    padding: "32px 40px",
                    textAlign: "center",
                    boxShadow: `0 0 40px ${positive ? "rgba(34,197,94,0.3)" : "rgba(232,50,58,0.3)"}`,
                }}
            >
                <div style={{ fontSize: 40, marginBottom: 8 }}>
                    {positive ? "✅" : "❌"}
                </div>
                <div style={{
                    color: "#fff",
                    fontSize: 22,
                    fontWeight: 800,
                    fontFamily: "Poppins, sans-serif",
                }}>
                    Neue Antwort!
                </div>
                <div style={{
                    color: "#99A1AF",
                    fontSize: 14,
                    marginTop: 8,
                }}>
                    Tippe um Details zu sehen
                </div>
            </div>
        </div>
    );
}
