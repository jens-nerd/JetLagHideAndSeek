/**
 * Die laufenden Flüche einer Sitzung.
 *
 * Zeitflüche zeigen einen Countdown, der clientseitig aus expiresAt gerechnet
 * wird — so wie QuestionCountdown in SessionQuestionPanel.tsx. Aufgabenflüche
 * laufen, bis ein Suchender "erledigt" meldet.
 */
import type { Fluch } from "@hideandseek/shared";
import { useStore } from "@nanostores/react";
import { useEffect, useState } from "react";
import { toast } from "react-toastify";

import { useT } from "@/i18n";
import { fluchBeenden } from "@/lib/cards-api";
import { activeCurses } from "@/lib/deck-context";
import { sessionParticipant } from "@/lib/session-context";

/** MM:SS aus einem ISO-Zeitstempel, jede Sekunde neu. */
function Countdown({ curseId, expiresAt }: { curseId: string; expiresAt: string }) {
    const tr = useT();

    function rest(): number {
        return new Date(expiresAt).getTime() - Date.now();
    }

    const [remainingMs, setRemainingMs] = useState<number>(rest);

    useEffect(() => {
        setRemainingMs(rest());
        const interval = setInterval(() => {
            const ms = rest();
            setRemainingMs(ms);
            if (ms <= 0) clearInterval(interval);
        }, 1000);
        return () => clearInterval(interval);
    // expiresAt ist ein stabiler ISO-String
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [expiresAt]);

    if (remainingMs <= 0) {
        return (
            <span data-countdown={curseId} style={{ color: "#D56062", fontWeight: 700, fontSize: 13 }}>
                ⏰ {tr("cards.expired")}
            </span>
        );
    }

    const totalSec = Math.ceil(remainingMs / 1000);
    const minuten = Math.floor(totalSec / 60);
    const sekunden = totalSec % 60;
    const text = `${String(minuten).padStart(2, "0")}:${String(sekunden).padStart(2, "0")}`;

    const rot = remainingMs < 60_000;
    const orange = !rot && remainingMs < 5 * 60_000;
    const farbe = rot ? "#D56062" : orange ? "#F37748" : "rgba(255,255,255,0.85)";

    return (
        <span
            data-countdown={curseId}
            className="tabular-nums"
            style={{ color: farbe, fontWeight: 700, fontSize: 13 }}
        >
            ⏱ {text}
        </span>
    );
}

export function FluchListe() {
    const tr = useT();
    const $participant = useStore(sessionParticipant);
    const $curses = useStore(activeCurses);
    const [laufend, setLaufend] = useState<string | null>(null);

    const istHider = $participant?.role === "hider";

    async function beenden(curse: Fluch) {
        if (!$participant?.token || laufend) return;
        setLaufend(curse.id);
        try {
            await fluchBeenden(curse.id, $participant.token);
            // Die Liste aktualisiert sich über das curse_ended-Ereignis.
        } catch (e) {
            toast.error((e as Error).message);
        } finally {
            setLaufend(null);
        }
    }

    if ($curses.length === 0) {
        return (
            <p style={{ color: "rgba(245,245,240,0.6)", fontSize: 14, padding: "12px 4px", margin: 0 }}>
                {tr("cards.noCurses")}
            </p>
        );
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {$curses.map((curse) => (
                <div
                    key={curse.id}
                    data-curse={curse.id}
                    style={{
                        background: "var(--color-panel)",
                        border: "2px solid rgba(245,245,240,0.08)",
                        borderRadius: "var(--radius-default)",
                        padding: "12px 14px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                    }}
                >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                        <span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>
                            {curse.karte.name}
                        </span>
                        {curse.expiresAt ? (
                            <Countdown curseId={curse.id} expiresAt={curse.expiresAt} />
                        ) : (
                            <span style={{ color: "rgba(245,245,240,0.5)", fontSize: 12 }}>
                                {curse.karte.dauerText ?? tr("cards.noDuration")}
                            </span>
                        )}
                    </div>

                    <p style={{ color: "rgba(245,245,240,0.8)", fontSize: 13, lineHeight: 1.5, margin: 0, whiteSpace: "pre-line" }}>
                        {curse.karte.text}
                    </p>

                    {curse.karte.nachweis ? (
                        <p style={{ color: "rgba(245,245,240,0.55)", fontSize: 12, margin: 0 }}>
                            <strong>{tr("cards.proof")}:</strong> {curse.karte.nachweis}
                        </p>
                    ) : null}

                    {curse.karte.ausweichregel ? (
                        <p style={{ color: "rgba(245,245,240,0.55)", fontSize: 12, margin: 0 }}>
                            <strong>{tr("cards.fallback")}:</strong> {curse.karte.ausweichregel}
                        </p>
                    ) : null}

                    <button
                        onClick={() => void beenden(curse)}
                        disabled={laufend === curse.id}
                        style={{
                            alignSelf: "flex-start",
                            marginTop: 2,
                            background: istHider ? "transparent" : "var(--color-primary)",
                            border: istHider ? "2px solid rgba(245,245,240,0.2)" : "none",
                            borderRadius: "var(--radius-pill)",
                            padding: "8px 20px",
                            color: "#fff",
                            fontWeight: 700,
                            fontSize: 13,
                            cursor: laufend === curse.id ? "default" : "pointer",
                            opacity: laufend === curse.id ? 0.5 : 1,
                        }}
                    >
                        {istHider ? tr("cards.lift") : tr("cards.done")}
                    </button>
                </div>
            ))}
        </div>
    );
}
