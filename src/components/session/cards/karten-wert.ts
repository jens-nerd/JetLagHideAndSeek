/**
 * Der Zahlenwert einer Karte: Bonusminuten beim Zeitbonus, Laufzeit beim
 * Fluch.
 *
 * Eigene Datei ohne React-Import, damit die Regeln im Test ohne Leaflet und
 * WebSocket geladen werden können.
 */
import type { Karte } from "@hideandseek/shared";

import type { TranslationKey } from "@/i18n";

export interface KartenWert {
    label: string;
    wert: string;
}

/** Gibt null zurück, wenn die Karte keinen Wert trägt. */
export function kartenWert({
    karte,
    gameSize,
    tr,
    trf,
}: {
    karte: Karte;
    gameSize: "S" | "M" | "L" | null;
    tr: (key: TranslationKey) => string;
    trf: (key: TranslationKey, vars: Record<string, string | number>) => string;
}): KartenWert | null {
    const groesse = gameSize ?? "M";

    if (karte.art === "zeitbonus") {
        if (!karte.bonusMin) return null;
        return {
            label: tr("cards.bonus"),
            wert: trf("cards.bonusValue", { n: karte.bonusMin[groesse] }),
        };
    }

    // Die wörtliche Dauer hat Vorrang: sie steht auf Karten, deren Laufzeit
    // sich nicht in Minuten fassen lässt.
    const wert = karte.dauerText
        ? karte.dauerText
        : karte.dauerMin
          ? trf("cards.durationValue", { n: karte.dauerMin[groesse] })
          : tr("cards.noDuration");

    return { label: tr("cards.duration"), wert };
}
