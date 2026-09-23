/**
 * Vollbildschirm für "N ansehen, M behalten".
 *
 * Sichtbar, solange der Store einen offenen Ziehvorgang kennt. Der Vorgang
 * kommt aus dem sync-Ereignis zurück, ein Neuladen mitten im Ziehen verliert
 * also nichts.
 */
import type { HandKarte } from "@hideandseek/shared";
import { useStore } from "@nanostores/react";
import { useRef, useState } from "react";
import { toast } from "react-toastify";

import { useT, useTFmt } from "@/i18n";
import { behalten as behaltenApi } from "@/lib/cards-api";
import { applyHandUpdated, hand, nachschlagZug, pendingDraw } from "@/lib/deck-context";
import { gameSize, sessionParticipant } from "@/lib/session-context";

import { KartenKopf } from "./KartenKopf";
import { kartenArt, kartenFlaeche, kartenName, kartenText } from "./karten-stil";
import { kartenWert } from "./karten-wert";

const HANDLIMIT = 6;

export function ZiehSchirm() {
    const tr = useT();
    const trf = useTFmt();
    const $participant = useStore(sessionParticipant);
    const $pendingDraw = useStore(pendingDraw);
    const $nachschlag = useStore(nachschlagZug);
    const $hand = useStore(hand);
    const $gameSize = useStore(gameSize);

    const [gewaehlt, setGewaehlt] = useState<string[]>([]);
    const [abwurf, setAbwurf] = useState<string[]>([]);
    const [laufend, setLaufend] = useState(false);
    const laufendRef = useRef(false);

    if (!$pendingDraw || $participant?.role !== "hider") return null;

    const noetig = Math.min($pendingDraw.behalten, $pendingDraw.angeboten.length);
    const zuViel = $hand.length + noetig - HANDLIMIT;
    const noetigerAbwurf = Math.max(0, zuViel);
    const bereit =
        gewaehlt.length === noetig && abwurf.length === noetigerAbwurf && !laufend;

    function umschalten(liste: string[], id: string, max: number): string[] {
        if (liste.includes(id)) return liste.filter((x) => x !== id);
        if (liste.length >= max) return liste;
        return [...liste, id];
    }

    async function absenden() {
        if (!bereit || laufendRef.current || !$participant?.token) return;
        laufendRef.current = true;
        setLaufend(true);
        try {
            const antwort = await behaltenApi(
                $pendingDraw!.questionId,
                $participant.token,
                {
                    behalten: gewaehlt,
                    abwerfen: abwurf.length > 0 ? abwurf : undefined,
                },
            );
            // Die Antwort direkt anwenden, statt auf hand_updated zu warten:
            // applyHandUpdated setzt pendingDraw auf null und schliesst damit
            // den Schirm. Reisst die WebSocket-Verbindung ab, waehrend der
            // Aufruf durchgeht, saesse der Versteckende sonst in einem Vollbild
            // ohne Schliessknopf fest. Das spaetere Ereignis setzt dieselben
            // Werte noch einmal und schadet nicht.
            applyHandUpdated({ hand: antwort.hand, deckRest: antwort.deckRest });
            setGewaehlt([]);
            setAbwurf([]);
        } catch (e) {
            toast.error((e as Error).message);
        } finally {
            laufendRef.current = false;
            setLaufend(false);
        }
    }

    function kartenKnopf(
        karte: HandKarte,
        aktiv: boolean,
        onClick: () => void,
        marker: "angeboten" | "handcard",
    ) {
        const wert = kartenWert({ karte: karte.karte, gameSize: $gameSize, tr, trf });
        return (
            <button
                key={karte.id}
                {...(marker === "angeboten"
                    ? { "data-angeboten": karte.id }
                    : { "data-handcard": karte.id })}
                onClick={onClick}
                disabled={laufend}
                style={{
                    ...kartenFlaeche(kartenArt(karte.karte.art).farbe),
                    // Das Gewähltsein hängt nicht an einer Farbe: heller Ring
                    // um die Karte, Haken in der Kopfzeile.
                    boxShadow: aktiv ? "0 0 0 3px var(--hs-light)" : "none",
                    padding: 0,
                    cursor: "pointer",
                    textAlign: "left",
                    width: "100%",
                    font: "inherit",
                }}
            >
                <KartenKopf art={karte.karte.art} rechts={aktiv ? "✓" : null} />
                <span
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-start",
                        gap: 8,
                        padding: "12px 14px",
                    }}
                >
                    <span style={kartenName}>{karte.karte.name}</span>
                    {wert ? (
                        <span
                            data-kartenwert={karte.id}
                            style={{
                                background: "rgba(0,0,0,0.28)",
                                borderRadius: "var(--radius-pill)",
                                padding: "3px 10px",
                                color: "#fff",
                                fontWeight: 700,
                                fontSize: 14,
                            }}
                        >
                            {wert.wert}
                        </span>
                    ) : null}
                    <span style={kartenText}>{karte.karte.text}</span>
                </span>
            </button>
        );
    }

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 1300,
                background: "var(--hs-dark, #14161A)",
                overflowY: "auto",
                padding: "24px 16px 32px",
                display: "flex",
                flexDirection: "column",
                gap: 14,
            }}
        >
            <h2 style={{ color: "#fff", fontSize: 22, fontWeight: 800, margin: 0, fontFamily: "Poppins, sans-serif" }}>
                {tr("cards.drawTitle")}
            </h2>
            <p style={{ color: "rgba(245,245,240,0.6)", fontSize: 14, margin: 0 }}>
                {trf("cards.drawHint", {
                    draw: $pendingDraw.angeboten.length,
                    keep: noetig,
                })}
            </p>
            {$nachschlag ? (
                <p
                    data-nachschlag
                    style={{ color: "#F5C451", fontSize: 14, fontWeight: 600, margin: 0 }}
                >
                    {$nachschlag.rest === null
                        ? tr("cards.extraDrawLast")
                        : trf("cards.extraDrawHint", { n: $nachschlag.rest })}
                </p>
            ) : null}

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {$pendingDraw.angeboten.map((karte) =>
                    kartenKnopf(
                        karte,
                        gewaehlt.includes(karte.id),
                        () => setGewaehlt((l) => umschalten(l, karte.id, noetig)),
                        "angeboten",
                    ),
                )}
            </div>

            {noetigerAbwurf > 0 ? (
                <>
                    <p style={{ color: "#F37748", fontSize: 14, fontWeight: 600, margin: "8px 0 0" }}>
                        {trf("cards.discardPrompt", { n: noetigerAbwurf })}
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {$hand.map((karte) =>
                            kartenKnopf(
                                karte,
                                abwurf.includes(karte.id),
                                () => setAbwurf((l) => umschalten(l, karte.id, noetigerAbwurf)),
                                "handcard",
                            ),
                        )}
                    </div>
                </>
            ) : null}

            <span style={{ color: "rgba(245,245,240,0.5)", fontSize: 13 }}>
                {trf("cards.keepCount", { gewaehlt: gewaehlt.length, noetig })}
            </span>

            <button
                onClick={() => void absenden()}
                disabled={!bereit}
                style={{
                    marginTop: 4,
                    background: "var(--color-primary)",
                    border: "none",
                    borderRadius: "var(--radius-pill)",
                    padding: "14px 32px",
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: 15,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    cursor: bereit ? "pointer" : "default",
                    opacity: bereit ? 1 : 0.4,
                }}
            >
                {tr("cards.keepButton")}
            </button>
        </div>
    );
}
