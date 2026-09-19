/**
 * Inhalt des Kartenreiters im Bottom Sheet.
 *
 * Der Versteckende sieht seine Hand und darunter die laufenden Flüche, die
 * Suchenden nur die Flüche. Die Hand wird niemals für einen Suchenden
 * gezeichnet, auch wenn der Store wider Erwarten Karten enthielte.
 */
import type { HandKarte } from "@hideandseek/shared";
import { useStore } from "@nanostores/react";
import { useState } from "react";

import { useT, useTFmt } from "@/i18n";
import { fluchSpielen } from "@/lib/cards-api";
import { bonusMinutenAufDerHand, deckRest, hand } from "@/lib/deck-context";
import { gameSize, sessionCode, sessionParticipant } from "@/lib/session-context";

import { FluchListe } from "./FluchListe";
import { KartenAnsicht } from "./KartenAnsicht";

export function KartenReiter() {
    const tr = useT();
    const trf = useTFmt();
    const $participant = useStore(sessionParticipant);
    const $code = useStore(sessionCode);
    const $hand = useStore(hand);
    const $deckRest = useStore(deckRest);
    const $gameSize = useStore(gameSize);
    const [offen, setOffen] = useState<HandKarte | null>(null);

    const istHider = $participant?.role === "hider";

    async function ausspielen(karte: HandKarte) {
        if (!$code || !$participant?.token) return;
        await fluchSpielen($code, $participant.token, karte.id);
        // Hand und Fluchliste kommen über hand_updated und curse_played zurück.
    }

    async function abwerfen(_karte: HandKarte) {
        // Abwerfen außerhalb eines Ziehvorgangs gibt es in dieser Ausbaustufe
        // nicht: Karten werden nur beim Behalten abgeworfen, wenn die Hand
        // sonst über sechs käme. Der Knopf bleibt deshalb ohne Wirkung.
        throw new Error(tr("cards.discardNotAvailable"));
    }

    if (offen) {
        return (
            <KartenAnsicht
                karte={offen}
                onZurueck={() => setOffen(null)}
                onAusspielen={ausspielen}
                onAbwerfen={abwerfen}
            />
        );
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "4px 2px" }}>
            {istHider ? (
                <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <h3 style={{ color: "#fff", fontSize: 16, fontWeight: 800, margin: 0 }}>
                            {tr("cards.handTitle")}
                        </h3>
                        <span style={{ color: "rgba(245,245,240,0.5)", fontSize: 12 }}>
                            {trf("cards.deckLeft", { n: String($deckRest) })}
                        </span>
                    </div>

                    {$hand.length === 0 ? (
                        <p style={{ color: "rgba(245,245,240,0.6)", fontSize: 14, margin: 0 }}>
                            {tr("cards.handEmpty")}
                        </p>
                    ) : (
                        <>
                            <span style={{ color: "rgba(245,245,240,0.5)", fontSize: 12 }}>
                                {trf("cards.bonusSum", {
                                    n: String(bonusMinutenAufDerHand($hand, $gameSize)),
                                })}
                            </span>
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                {$hand.map((karte) => (
                                    <button
                                        key={karte.id}
                                        data-handcard={karte.id}
                                        onClick={() => setOffen(karte)}
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            gap: 10,
                                            background: "var(--color-panel)",
                                            border: `2px solid ${karte.karte.art === "fluch" ? "var(--color-primary)" : "rgba(245,245,240,0.08)"}`,
                                            borderRadius: "var(--radius-default)",
                                            padding: "12px 14px",
                                            cursor: "pointer",
                                            textAlign: "left",
                                        }}
                                    >
                                        <span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>
                                            {karte.karte.name}
                                        </span>
                                        <span style={{ color: "rgba(245,245,240,0.5)", fontSize: 12 }}>
                                            {karte.karte.art === "fluch"
                                                ? "🃏"
                                                : `+${karte.karte.bonusMin?.[$gameSize ?? "M"]} min`}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </section>
            ) : null}

            <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <h3 style={{ color: "#fff", fontSize: 16, fontWeight: 800, margin: 0 }}>
                    {tr("cards.activeCurses")}
                </h3>
                <FluchListe />
            </section>
        </div>
    );
}
