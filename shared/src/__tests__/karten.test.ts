import { describe, expect, it } from "vitest";

import { KARTEN, findeKarte } from "../karten.js";

describe("Kartensatz", () => {
    it("enthält genau 77 Kartenexemplare", () => {
        const summe = KARTEN.reduce((n, k) => n + k.anzahl, 0);
        expect(summe).toBe(77);
    });

    it("enthält 28 Flüche, jeden genau einmal", () => {
        const flueche = KARTEN.filter((k) => k.art === "fluch");
        expect(flueche).toHaveLength(28);
        for (const f of flueche) {
            expect(f.anzahl, `${f.id} liegt mehrfach im Deck`).toBe(1);
        }
    });

    it("enthält 49 Zeitboni", () => {
        const summe = KARTEN.filter((k) => k.art === "zeitbonus")
            .reduce((n, k) => n + k.anzahl, 0);
        expect(summe).toBe(49);
    });

    it("vergibt jede Kennung nur einmal", () => {
        const ids = KARTEN.map((k) => k.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("gibt jedem Fluch eine Gruppe und eine ausdrückliche Dauer", () => {
        for (const f of KARTEN.filter((k) => k.art === "fluch")) {
            expect(f.gruppe, `${f.id} ohne Gruppe`).toBeDefined();
            // null ist erlaubt (Aufgabenfluch), undefined nicht
            expect(f.dauerMin, `${f.id} ohne Dauer-Angabe`).not.toBeUndefined();
            if (f.dauerMin !== null) {
                expect(f.dauerMin!.S).toBeGreaterThan(0);
                expect(f.dauerMin!.M).toBeGreaterThan(0);
                expect(f.dauerMin!.L).toBeGreaterThan(0);
            }
        }
    });

    it("gibt jedem Zeitbonus einen Minutenwert", () => {
        for (const z of KARTEN.filter((k) => k.art === "zeitbonus")) {
            expect(z.bonusMin, `${z.id} ohne Minutenwert`).toBeGreaterThan(0);
        }
    });

    it("gibt jeder Karte einen nichtleeren Text", () => {
        for (const k of KARTEN) {
            expect(k.text.trim().length, `${k.id} ohne Text`).toBeGreaterThan(0);
        }
    });

    it("findet Karten über findeKarte", () => {
        const erste = KARTEN[0];
        expect(findeKarte(erste.id)).toEqual(erste);
        expect(findeKarte("gibt-es-nicht")).toBeUndefined();
    });
});
