/**
 * Prüft, welcher Zahlenwert auf einer Karte steht: Bonusminuten beim
 * Zeitbonus, Laufzeit beim Fluch.
 *
 * Die Berechnung liegt als reine Funktion in einer eigenen Datei, damit der
 * Test sie ohne Leaflet, WebSocket und Astro laden kann.
 */
import { describe, expect, it } from "vitest";

import { kartenWert } from "../session/cards/karten-wert";

const tr = (key: string) => key;
const trf = (key: string, vars: Record<string, string | number>) =>
    `${key}|${vars.n}`;

const BONUS = {
    id: "zeitbonus-3",
    art: "zeitbonus",
    name: "Zeitbonus",
    text: "Text.",
    bonusMin: { S: 2, M: 3, L: 5 },
    anzahl: 1,
} as any;

const FLUCH = (rest: Record<string, unknown>) =>
    ({
        id: "fluch-test",
        art: "fluch",
        name: "Fluch",
        text: "Text.",
        gruppe: "aufgabe",
        anzahl: 1,
        ...rest,
    }) as any;

describe("kartenWert", () => {
    it("nimmt beim Zeitbonus die Minuten der Spielgröße", () => {
        expect(kartenWert({ karte: BONUS, gameSize: "S", tr, trf })!.wert)
            .toBe("cards.bonusValue|2");
        expect(kartenWert({ karte: BONUS, gameSize: "M", tr, trf })!.wert)
            .toBe("cards.bonusValue|3");
        expect(kartenWert({ karte: BONUS, gameSize: "L", tr, trf })!.wert)
            .toBe("cards.bonusValue|5");
    });

    it("beschriftet den Zeitbonus als Zeitbonus", () => {
        expect(kartenWert({ karte: BONUS, gameSize: "M", tr, trf })!.label)
            .toBe("cards.bonus");
    });

    it("fällt ohne Spielgröße auf M zurück", () => {
        expect(kartenWert({ karte: BONUS, gameSize: null, tr, trf })!.wert)
            .toBe("cards.bonusValue|3");

        const fluch = FLUCH({ dauerMin: { S: 20, M: 40, L: 60 } });
        expect(kartenWert({ karte: fluch, gameSize: null, tr, trf })!.wert)
            .toBe("cards.durationValue|40");
    });

    it("nimmt beim Fluch die Laufzeit der Spielgröße", () => {
        const fluch = FLUCH({ dauerMin: { S: 20, M: 40, L: 60 } });
        expect(kartenWert({ karte: fluch, gameSize: "L", tr, trf })).toEqual({
            label: "cards.duration",
            wert: "cards.durationValue|60",
        });
    });

    it("zeigt eine wörtliche Dauer wörtlich", () => {
        const fluch = FLUCH({ dauerMin: null, dauerText: "bis Rundenende" });
        expect(kartenWert({ karte: fluch, gameSize: "M", tr, trf })!.wert)
            .toBe("bis Rundenende");
    });

    it("lässt die wörtliche Dauer vor den Minuten gelten", () => {
        const fluch = FLUCH({
            dauerMin: { S: 20, M: 40, L: 60 },
            dauerText: "drei beantwortete Fragen",
        });
        expect(kartenWert({ karte: fluch, gameSize: "M", tr, trf })!.wert)
            .toBe("drei beantwortete Fragen");
    });

    it("sagt beim Aufgabenfluch, dass er bis zur Meldung läuft", () => {
        const fluch = FLUCH({ dauerMin: null });
        expect(kartenWert({ karte: fluch, gameSize: "M", tr, trf })).toEqual({
            label: "cards.duration",
            wert: "cards.noDuration",
        });
    });
});
