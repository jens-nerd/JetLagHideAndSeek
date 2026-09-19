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

    it("gibt jedem Zeitbonus einen Minutenwert je Spielgröße", () => {
        for (const z of KARTEN.filter((k) => k.art === "zeitbonus")) {
            expect(z.bonusMin, `${z.id} ohne Minutenwerte`).toBeDefined();
            expect(z.bonusMin!.S).toBeGreaterThan(0);
            expect(z.bonusMin!.M).toBeGreaterThan(0);
            expect(z.bonusMin!.L).toBeGreaterThan(0);
        }
    });

    it("summiert die Zeitboni-Deckzeit auf 198 / 297 / 495 Minuten", () => {
        const zeitboni = KARTEN.filter((k) => k.art === "zeitbonus");
        const summe = (groesse: "S" | "M" | "L") =>
            zeitboni.reduce((n, z) => n + z.bonusMin![groesse] * z.anzahl, 0);
        expect(summe("S")).toBe(198);
        expect(summe("M")).toBe(297);
        expect(summe("L")).toBe(495);
    });

    it("gibt genau drei Flüchen eine wörtliche Dauer-Angabe", () => {
        const mitDauerText = KARTEN.filter((k) => k.art === "fluch" && k.dauerText !== undefined);
        expect(mitDauerText.map((k) => k.id).sort()).toEqual([
            "fluch-gluecksrad",
            "fluch-nicht-waehrend-der-fahrt",
            "fluch-ohne-gewaehr",
        ]);
    });

    it("gibt jeder Karte einen nichtleeren Text", () => {
        for (const k of KARTEN) {
            expect(k.text.trim().length, `${k.id} ohne Text`).toBeGreaterThan(0);
        }
    });

    it("markiert genau den Nachschlag als geheim", () => {
        const geheime = KARTEN.filter((k) => k.geheim);
        expect(geheime.map((k) => k.id)).toEqual(["fluch-nachschlag"]);
        expect(findeKarte("fluch-nachschlag")!.geheim).toBe(true);
    });

    it("findet Karten über findeKarte", () => {
        const erste = KARTEN[0];
        expect(findeKarte(erste.id)).toEqual(erste);
        expect(findeKarte("gibt-es-nicht")).toBeUndefined();
    });
});
