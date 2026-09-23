/**
 * Eine Karte im Volltext, mit dem passenden Knopf: Flüche werden ausgespielt,
 * Zeitboni abgeworfen. Beides mit Rückfrage, weil abgeworfene Zeitboni
 * verfallen und ein ausgespielter Fluch nicht zurückkommt.
 */
import type { HandKarte } from "@hideandseek/shared";
import { useStore } from "@nanostores/react";
import { useState } from "react";
import { toast } from "react-toastify";

import { useT, useTFmt } from "@/i18n";
import { gameSize } from "@/lib/session-context";

import { KartenKopf } from "./KartenKopf";
import { kartenArt, kartenFlaeche, kartenName, kartenText, kartenZusatz } from "./karten-stil";
import { kartenWert } from "./karten-wert";

export function KartenAnsicht({
    karte,
    onZurueck,
    onAusspielen,
    onAbwerfen,
}: {
    karte: HandKarte;
    onZurueck: () => void;
    onAusspielen: (k: HandKarte) => Promise<void>;
    onAbwerfen: (k: HandKarte) => Promise<void>;
}) {
    const tr = useT();
    const trf = useTFmt();
    const $gameSize = useStore(gameSize);
    const [laufend, setLaufend] = useState(false);
    const istFluch = karte.karte.art === "fluch";
    const wert = kartenWert({ karte: karte.karte, gameSize: $gameSize, tr, trf });

    async function handeln() {
        const frage = istFluch
            ? trf("cards.confirmPlay", { name: karte.karte.name })
            : trf("cards.confirmDiscard", { name: karte.karte.name });
        if (!window.confirm(frage)) return;

        setLaufend(true);
        try {
            if (istFluch) await onAusspielen(karte);
            else await onAbwerfen(karte);
            onZurueck();
        } catch (e) {
            toast.error((e as Error).message);
        } finally {
            setLaufend(false);
        }
    }

    return (
        <div data-kartenansicht={karte.id} style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 2px" }}>
            <button
                onClick={onZurueck}
                style={{
                    alignSelf: "flex-start",
                    background: "transparent",
                    border: "none",
                    color: "rgba(245,245,240,0.6)",
                    fontSize: 14,
                    cursor: "pointer",
                    padding: 0,
                }}
            >
                ← {tr("cards.back")}
            </button>

            <div style={kartenFlaeche(kartenArt(karte.karte.art).farbe)}>
                <KartenKopf art={karte.karte.art} />

                <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "14px 16px" }}>
                    <h3 style={kartenName}>{karte.karte.name}</h3>

                    <p style={kartenText}>{karte.karte.text}</p>

                    {wert ? (
                        <p style={kartenZusatz}>
                            <strong>{wert.label}:</strong> {wert.wert}
                        </p>
                    ) : null}

                    {karte.karte.kosten ? (
                        <p style={kartenZusatz}>
                            <strong>{tr("cards.cost")}:</strong> {karte.karte.kosten}
                        </p>
                    ) : null}

                    {karte.karte.nachweis ? (
                        <p style={kartenZusatz}>
                            <strong>{tr("cards.proof")}:</strong> {karte.karte.nachweis}
                        </p>
                    ) : null}

                    {karte.karte.ausweichregel ? (
                        <p style={kartenZusatz}>
                            <strong>{tr("cards.fallback")}:</strong> {karte.karte.ausweichregel}
                        </p>
                    ) : null}
                </div>
            </div>

            <button
                onClick={() => void handeln()}
                disabled={laufend}
                style={{
                    marginTop: 4,
                    background: istFluch ? "var(--color-primary)" : "transparent",
                    border: istFluch ? "none" : "2px solid rgba(245,245,240,0.2)",
                    borderRadius: "var(--radius-pill)",
                    padding: "12px 28px",
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: 14,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    cursor: laufend ? "default" : "pointer",
                    opacity: laufend ? 0.5 : 1,
                }}
            >
                {istFluch ? tr("cards.play") : tr("cards.discard")}
            </button>
        </div>
    );
}
