/**
 * Vollbild-Einschlag bei den Suchenden, wenn ein Fluch gespielt wird.
 * Baugleich zu AnswerOverlay.tsx: liegt über allem, verschwindet auf Tippen.
 *
 * Die Kosten der Karte bleiben draußen — sie betreffen den Versteckenden.
 */
import { useStore } from "@nanostores/react";

import { useT } from "@/i18n";
import { eingeschlagenerFluch } from "@/lib/deck-context";
import { sessionParticipant } from "@/lib/session-context";

export function FluchOverlay() {
    const tr = useT();
    const $participant = useStore(sessionParticipant);
    const $fluch = useStore(eingeschlagenerFluch);

    if (!$fluch || $participant?.role !== "seeker") return null;

    return (
        <div
            onClick={() => eingeschlagenerFluch.set(null)}
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 1400,
                background: "rgba(20,22,26,0.97)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 18,
                padding: "32px 24px",
                textAlign: "center",
                cursor: "pointer",
            }}
        >
            <span style={{ fontSize: 44 }}>🃏</span>

            <span style={{ color: "#D56062", fontSize: 16, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                {tr("cards.curseHit")}
            </span>

            <h2 style={{ color: "#fff", fontSize: 28, fontWeight: 800, margin: 0, fontFamily: "Poppins, sans-serif" }}>
                {$fluch.karte.name}
            </h2>

            <p style={{ color: "rgba(245,245,240,0.85)", fontSize: 15, lineHeight: 1.6, margin: 0, maxWidth: 420, whiteSpace: "pre-line" }}>
                {$fluch.karte.text}
            </p>

            <span
                style={{
                    marginTop: 12,
                    background: "var(--color-primary)",
                    borderRadius: "var(--radius-pill)",
                    padding: "12px 32px",
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: 15,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                }}
            >
                {tr("cards.curseUnderstood")}
            </span>
        </div>
    );
}
