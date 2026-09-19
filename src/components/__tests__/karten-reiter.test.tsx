/**
 * Prüft, was der Kartenreiter je nach Rolle zeigt: der Versteckende seine
 * Hand, die Suchenden nur die laufenden Flüche.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stores = vi.hoisted(() => {
    function box<T>(initial: T) {
        return {
            value: initial,
            get() {
                return this.value;
            },
            set(v: T) {
                this.value = v;
            },
        };
    }
    return {
        hand: box<any[]>([]),
        deckRest: box(70),
        activeCurses: box<any[]>([]),
        sessionParticipant: box<any>({ role: "hider", token: "t" }),
        sessionCode: box<string | null>("ABCDEF"),
        gameSize: box<"S" | "M" | "L" | null>("M"),
    };
});

vi.mock("@nanostores/react", () => ({ useStore: (s: any) => s.get() }));

vi.mock("@/lib/deck-context", () => ({
    hand: stores.hand,
    deckRest: stores.deckRest,
    activeCurses: stores.activeCurses,
    bonusMinutenAufDerHand: (karten: any[], g: string) =>
        karten.reduce((n: number, k: any) => n + (k.karte.bonusMin?.[g ?? "M"] ?? 0), 0),
}));

vi.mock("@/lib/session-context", () => ({
    sessionParticipant: stores.sessionParticipant,
    sessionCode: stores.sessionCode,
    gameSize: stores.gameSize,
}));

vi.mock("@/lib/cards-api", () => ({
    fluchSpielen: vi.fn(),
    fluchBeenden: vi.fn(),
}));

vi.mock("@/i18n", () => ({
    useT: () => (key: string) => key,
    useTFmt: () => (key: string) => key,
    locale: { get: () => "de" },
}));

const FLUCHKARTE = {
    id: "fluch-brueckenzoll",
    art: "fluch",
    name: "Brückenzoll",
    text: "Unter eine Brücke.",
    gruppe: "aufgabe",
    dauerMin: null,
    anzahl: 1,
};

const BONUSKARTE = {
    id: "zeitbonus-10",
    art: "zeitbonus",
    name: "Anschluss weg",
    text: "Zählt am Rundenende.",
    bonusMin: { S: 4, M: 6, L: 10 },
    anzahl: 13,
};

async function render() {
    const { KartenReiter } = await import("../session/cards/KartenReiter");
    return renderToStaticMarkup(<KartenReiter />);
}

describe("KartenReiter", () => {
    beforeEach(() => {
        stores.hand.set([]);
        stores.activeCurses.set([]);
        stores.sessionParticipant.set({ role: "hider", token: "t" });
        vi.resetModules();
    });

    it("sagt dem Versteckenden, wenn seine Hand leer ist", async () => {
        const markup = await render();
        expect(markup).toContain("cards.handEmpty");
    });

    it("zeichnet je Handkarte eine Zeile", async () => {
        stores.hand.set([
            { id: "d1", karte: FLUCHKARTE },
            { id: "d2", karte: BONUSKARTE },
            { id: "d3", karte: BONUSKARTE },
        ]);

        const markup = await render();

        expect(markup.match(/data-handcard=/g)?.length).toBe(3);
    });

    it("zeigt die Namen der Handkarten", async () => {
        stores.hand.set([{ id: "d1", karte: FLUCHKARTE }]);

        const markup = await render();

        expect(markup).toContain("Brückenzoll");
    });

    it("zeigt einem Suchenden keine Hand, auch wenn der Store eine hätte", async () => {
        stores.sessionParticipant.set({ role: "seeker", token: "t" });
        stores.hand.set([{ id: "d1", karte: FLUCHKARTE }]);

        const markup = await render();

        expect(markup).not.toContain("data-handcard=");
        expect(markup).not.toContain("Brückenzoll");
    });

    it("zeigt beiden Rollen die laufenden Flüche", async () => {
        stores.activeCurses.set([
            {
                id: "c1",
                karte: FLUCHKARTE,
                playedAt: new Date().toISOString(),
                expiresAt: null,
                endedAt: null,
                endedBy: null,
            },
        ]);

        const alsHider = await render();
        expect(alsHider).toContain("data-curse=");

        vi.resetModules();
        stores.sessionParticipant.set({ role: "seeker", token: "t" });
        const alsSeeker = await render();
        expect(alsSeeker).toContain("data-curse=");
    });
});
