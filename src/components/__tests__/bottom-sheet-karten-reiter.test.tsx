/**
 * Prüft, wann der Kartenreiter erscheint und wie er heißt.
 *
 * Die Berechnung liegt als reine Funktion in einer eigenen Datei, damit der
 * Test sie ohne Leaflet, WebSocket und Astro laden kann.
 */
import { describe, expect, it } from "vitest";

import { kartenReiter } from "../session/cards/karten-reiter-tab";

const tr = (key: string) => key;

describe("kartenReiter", () => {
    it("liefert nichts, wenn die Kartenmechanik aus ist", () => {
        expect(
            kartenReiter({ cardsEnabled: false, istHider: true, handAnzahl: 3, fluchAnzahl: 0, tr }),
        ).toBeNull();
    });

    it("liefert nichts ohne Rolle", () => {
        expect(
            kartenReiter({ cardsEnabled: true, istHider: null, handAnzahl: 0, fluchAnzahl: 0, tr }),
        ).toBeNull();
    });

    it("heißt beim Versteckenden Hand und zählt die Karten", () => {
        const reiter = kartenReiter({
            cardsEnabled: true, istHider: true, handAnzahl: 4, fluchAnzahl: 1, tr,
        });
        expect(reiter!.id).toBe("karten");
        expect(reiter!.label).toBe("cards.tabHand 4");
    });

    it("heißt bei den Suchenden Flüche und zählt die laufenden", () => {
        const reiter = kartenReiter({
            cardsEnabled: true, istHider: false, handAnzahl: 0, fluchAnzahl: 2, tr,
        });
        expect(reiter!.id).toBe("karten");
        expect(reiter!.label).toBe("cards.tabCurses 2");
    });

    it("lässt die Zahl weg, wenn nichts zu zählen ist", () => {
        const alsHider = kartenReiter({
            cardsEnabled: true, istHider: true, handAnzahl: 0, fluchAnzahl: 0, tr,
        });
        expect(alsHider!.label).toBe("cards.tabHand");

        const alsSeeker = kartenReiter({
            cardsEnabled: true, istHider: false, handAnzahl: 0, fluchAnzahl: 0, tr,
        });
        expect(alsSeeker!.label).toBe("cards.tabCurses");
    });
});
