/**
 * Das gemeinsame Aussehen einer Spielkarte: Kartenfläche mit eigenem Rand und
 * eine Kopfzeile, die die Kartenart benennt.
 *
 * Die Art steht in drei Merkmalen zugleich da — Farbe, Wort und Zeichen. Am
 * Handy in der Sonne und bei Farbfehlsichtigkeit trägt die Farbe allein nicht.
 *
 * Eigene Datei ohne React-Import, damit die Regeln im Test ohne Leaflet und
 * WebSocket geladen werden können.
 */
import type { CSSProperties } from "react";

import type { TranslationKey } from "@/i18n";

export interface KartenArt {
    /** Der Rand der Karte — die volle Farbe der Kartenart. */
    farbe: string;
    /** Die Kopfzeile — dieselbe Farbe, abgedunkelt. */
    kopfFarbe: string;
    label: TranslationKey;
    zeichen: string;
}

/**
 * Die Kopfzeile trägt weiße Schrift. Auf dem vollen Rot kommt die nur auf
 * 4,2:1; abgedunkelt sind es 6,4:1, und das liest sich draußen bei Sonne.
 * Kennt der Browser color-mix nicht, bleibt die Kopfzeile ohne Fläche — die
 * Schrift steht dann auf dem Kartengrund und ist immer noch lesbar.
 */
function abgedunkelt(farbe: string): string {
    return `color-mix(in srgb, ${farbe} 78%, #000)`;
}

export function kartenArt(art: "fluch" | "zeitbonus"): KartenArt {
    const farbe = art === "fluch" ? "var(--color-primary)" : "var(--color-bonus)";
    return {
        farbe,
        kopfFarbe: abgedunkelt(farbe),
        label: art === "fluch" ? "cards.curse" : "cards.bonus",
        zeichen: art === "fluch" ? "🃏" : "⏱",
    };
}

/** Die Fläche der Karte. `overflow: hidden` hält die Kopfzeile in der Rundung. */
export function kartenFlaeche(farbe: string): CSSProperties {
    return {
        display: "flex",
        flexDirection: "column",
        background: "var(--color-panel)",
        border: `2px solid ${farbe}`,
        borderRadius: "var(--radius-karte)",
        overflow: "hidden",
    };
}

/** Der Kartenname. Deutlich größer als die Wirkung darunter. */
export const kartenName: CSSProperties = {
    color: "#fff",
    fontFamily: "Poppins, sans-serif",
    fontSize: 20,
    fontWeight: 800,
    lineHeight: 1.2,
    margin: 0,
};

/** Die Wirkung der Karte. 15px, damit sie am Handy ohne Zoom lesbar ist. */
export const kartenText: CSSProperties = {
    color: "rgba(245,245,240,0.88)",
    fontSize: 15,
    lineHeight: 1.55,
    margin: 0,
    whiteSpace: "pre-line",
};

/** Nachweis, Ausweichregel, Kosten — nachgeordnet, aber noch lesbar. */
export const kartenZusatz: CSSProperties = {
    color: "rgba(245,245,240,0.65)",
    fontSize: 14,
    lineHeight: 1.45,
    margin: 0,
};
