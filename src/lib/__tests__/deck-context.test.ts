/**
 * Prüft die Zustandsübergänge des Kartenstores. Reine Datenlogik, kein React.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
    activeCurses,
    applyCardsSync,
    applyCurseEnded,
    applyCursePlayed,
    applyHandUpdated,
    applyLockedCategory,
    cardsEnabled,
    deckRest,
    gesperrteKategorie,
    hand,
    nachschlagZug,
    pendingDraw,
    resetDeckState,
} from "../deck-context";

const KARTE = {
    id: "fluch-test",
    art: "fluch" as const,
    name: "Testfluch",
    text: "Tu etwas.",
    gruppe: "aufgabe" as const,
    dauerMin: null,
    anzahl: 1,
};

const FLUCH = {
    id: "c1",
    karte: KARTE,
    playedAt: "2026-09-19T10:00:00.000Z",
    expiresAt: null,
    endedAt: null,
    endedBy: null,
};

describe("deck-context", () => {
    beforeEach(() => resetDeckState());

    it("startet leer und ausgeschaltet", () => {
        expect(cardsEnabled.get()).toBe(false);
        expect(hand.get()).toEqual([]);
        expect(deckRest.get()).toBe(0);
        expect(pendingDraw.get()).toBeNull();
        expect(nachschlagZug.get()).toBeNull();
        expect(activeCurses.get()).toEqual([]);
        expect(gesperrteKategorie.get()).toBeNull();
    });

    it("übernimmt die Kartenfelder aus dem sync-Ereignis", () => {
        applyCardsSync({
            cardsEnabled: true,
            hand: [{ id: "d1", karte: KARTE }],
            deckRest: 70,
            pendingDraw: null,
            activeCurses: [FLUCH],
        });

        expect(cardsEnabled.get()).toBe(true);
        expect(hand.get()).toHaveLength(1);
        expect(deckRest.get()).toBe(70);
        expect(activeCurses.get()).toHaveLength(1);
    });

    it("leert die Kartenfelder, wenn sync sie weglässt", () => {
        applyCardsSync({
            cardsEnabled: true,
            hand: [{ id: "d1", karte: KARTE }],
            deckRest: 70,
            activeCurses: [FLUCH],
        });
        // Zweites sync, etwa nach einem Rollenwechsel: keine Handfelder mehr
        applyCardsSync({ cardsEnabled: true, activeCurses: [] });

        expect(hand.get()).toEqual([]);
        expect(deckRest.get()).toBe(0);
        expect(activeCurses.get()).toEqual([]);
    });

    it("ersetzt die Hand bei hand_updated", () => {
        applyHandUpdated({ hand: [{ id: "d2", karte: KARTE }], deckRest: 69 });

        expect(hand.get().map((k) => k.id)).toEqual(["d2"]);
        expect(deckRest.get()).toBe(69);
    });

    it("hängt einen gespielten Fluch an", () => {
        applyCursePlayed({ curse: FLUCH });

        expect(activeCurses.get()).toHaveLength(1);
    });

    it("spielt denselben Fluch nicht doppelt ein", () => {
        applyCursePlayed({ curse: FLUCH });
        applyCursePlayed({ curse: FLUCH });

        expect(activeCurses.get()).toHaveLength(1);
    });

    it("entfernt einen beendeten Fluch", () => {
        applyCursePlayed({ curse: FLUCH });
        applyCurseEnded({
            curseId: "c1",
            endedBy: "suchende",
            endedAt: "2026-09-19T10:05:00.000Z",
        });

        expect(activeCurses.get()).toEqual([]);
    });

    it("lässt den Nachschlag beim sync leer, weil das Ereignis ihn nicht trägt", () => {
        nachschlagZug.set({ rest: 2 });
        applyCardsSync({
            cardsEnabled: true,
            pendingDraw: {
                questionId: "q1",
                angeboten: [{ id: "d1", karte: KARTE }],
                behalten: 1,
            },
            activeCurses: [],
        });

        expect(pendingDraw.get()).not.toBeNull();
        expect(nachschlagZug.get()).toBeNull();
    });

    it("räumt den Nachschlag zusammen mit dem Ziehvorgang ab", () => {
        nachschlagZug.set({ rest: 1 });
        applyHandUpdated({ hand: [], deckRest: 60 });

        expect(pendingDraw.get()).toBeNull();
        expect(nachschlagZug.get()).toBeNull();
    });

    it("ignoriert das Ende eines unbekannten Fluchs", () => {
        applyCursePlayed({ curse: FLUCH });
        applyCurseEnded({
            curseId: "gibt-es-nicht",
            endedBy: "ablauf",
            endedAt: "2026-09-19T10:05:00.000Z",
        });

        expect(activeCurses.get()).toHaveLength(1);
    });

    it("übernimmt die gesperrte Kategorie aus dem sync-Ereignis", () => {
        applyCardsSync({
            cardsEnabled: true,
            activeCurses: [],
            gesperrteKategorie: "radius",
        });

        expect(gesperrteKategorie.get()).toBe("radius");
    });

    it("leert die gesperrte Kategorie, wenn sync sie weglässt", () => {
        applyLockedCategory({ curseId: "c1", kategorie: "photo" });
        applyCardsSync({ cardsEnabled: true, activeCurses: [] });

        expect(gesperrteKategorie.get()).toBeNull();
    });

    it("setzt die gesperrte Kategorie beim locked_category-Ereignis", () => {
        applyLockedCategory({ curseId: "c1", kategorie: "matching" });

        expect(gesperrteKategorie.get()).toBe("matching");
    });

    it("überschreibt die gesperrte Kategorie beim nächsten Los", () => {
        applyLockedCategory({ curseId: "c1", kategorie: "matching" });
        applyLockedCategory({ curseId: "c1", kategorie: "measuring" });

        expect(gesperrteKategorie.get()).toBe("measuring");
    });

    it("hebt die Sperre auf, wenn das Glücksrad endet", () => {
        const rad = { ...FLUCH, id: "c-rad", karte: { ...KARTE, id: "fluch-gluecksrad" } };
        applyCursePlayed({ curse: rad });
        applyLockedCategory({ curseId: "c-rad", kategorie: "photo" });

        applyCurseEnded({
            curseId: "c-rad",
            endedBy: "suchende",
            endedAt: "2026-09-19T10:05:00.000Z",
        });

        expect(gesperrteKategorie.get()).toBeNull();
    });

    it("lässt die Sperre stehen, wenn ein anderer Fluch endet", () => {
        const rad = { ...FLUCH, id: "c-rad", karte: { ...KARTE, id: "fluch-gluecksrad" } };
        applyCursePlayed({ curse: rad });
        applyCursePlayed({ curse: FLUCH });
        applyLockedCategory({ curseId: "c-rad", kategorie: "photo" });

        applyCurseEnded({
            curseId: "c1",
            endedBy: "suchende",
            endedAt: "2026-09-19T10:05:00.000Z",
        });

        expect(gesperrteKategorie.get()).toBe("photo");
    });

    it("räumt die gesperrte Kategorie beim Zurücksetzen ab", () => {
        applyLockedCategory({ curseId: "c1", kategorie: "thermometer" });
        resetDeckState();

        expect(gesperrteKategorie.get()).toBeNull();
    });
});
