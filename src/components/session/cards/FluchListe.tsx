/**
 * Die laufenden Flüche einer Sitzung.
 *
 * Zeitflüche zeigen einen Countdown, der clientseitig aus expiresAt gerechnet
 * wird — so wie QuestionCountdown in SessionQuestionPanel.tsx. Aufgabenflüche
 * laufen, bis ein Suchender "erledigt" meldet.
 */
import type { Fluch } from "@hideandseek/shared";
import { GLUECKSRAD_ID } from "@hideandseek/shared";
import { useStore } from "@nanostores/react";
import { useEffect, useState } from "react";
import { toast } from "react-toastify";

import { useT, useTFmt } from "@/i18n";
import { fluchBeenden } from "@/lib/cards-api";
import { activeCurses, gesperrteKategorie } from "@/lib/deck-context";
import { sessionParticipant } from "@/lib/session-context";

import { KartenKopf } from "./KartenKopf";
import { kartenArt, kartenFlaeche, kartenName, kartenText, kartenZusatz } from "./karten-stil";

// Die Restzeit steht in der Kopfzeile der Karte, also auf dunklem Rot. Die
// satten Warnfarben von vorher verschwinden dort; diese hellen Töne bleiben
// auseinanderzuhalten und lesbar.
const EILIG = "#FFD0D1";
const KNAPP = "#FFDCA8";

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
            <span data-countdown={curseId} style={{ color: EILIG, fontWeight: 800, fontSize: 13 }}>
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
    const farbe = rot ? EILIG : orange ? KNAPP : "#fff";

    return (
        <span
            data-countdown={curseId}
            className="tabular-nums"
            style={{ color: farbe, fontWeight: rot ? 800 : 700, fontSize: 13 }}
        >
            ⏱ {text}
        </span>
    );
}

export function FluchListe() {
    const tr = useT();
    const trFmt = useTFmt();
    const $participant = useStore(sessionParticipant);
    const $curses = useStore(activeCurses);
    const $gesperrt = useStore(gesperrteKategorie);
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
            <p style={{ color: "rgba(245,245,240,0.6)", fontSize: 15, padding: "12px 4px", margin: 0 }}>
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
                    style={kartenFlaeche(kartenArt("fluch").farbe)}
                >
                    <KartenKopf
                        art="fluch"
                        rechts={
                            curse.expiresAt ? (
                                <Countdown curseId={curse.id} expiresAt={curse.expiresAt} />
                            ) : (
                                curse.karte.dauerText ?? tr("cards.noDuration")
                            )
                        }
                    />

                    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px" }}>
                        <h4 style={kartenName}>{curse.karte.name}</h4>

                        <p style={kartenText}>
                            {curse.karte.text}
                        </p>

                        {curse.karte.id === GLUECKSRAD_ID && $gesperrt ? (
                            <p
                                data-gesperrt={$gesperrt}
                                style={{ color: "#F37748", fontSize: 14, fontWeight: 700, margin: 0 }}
                            >
                                {trFmt("cards.lockedCategory", {
                                    kategorie: tr(`questionType.${$gesperrt}` as any),
                                })}
                            </p>
                        ) : null}

                        {curse.karte.nachweis ? (
                            <p style={kartenZusatz}>
                                <strong>{tr("cards.proof")}:</strong> {curse.karte.nachweis}
                            </p>
                        ) : null}

                        {curse.karte.ausweichregel ? (
                            <p style={kartenZusatz}>
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
                                padding: "11px 24px",
                                color: "#fff",
                                fontWeight: 700,
                                fontSize: 15,
                                cursor: laufend === curse.id ? "default" : "pointer",
                                opacity: laufend === curse.id ? 0.5 : 1,
                            }}
                        >
                            {istHider ? tr("cards.lift") : tr("cards.done")}
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}
