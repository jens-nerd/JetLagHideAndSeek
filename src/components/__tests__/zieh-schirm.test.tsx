/**
 * Prüft den Ziehschirm: Sichtbarkeit, Anzahl der angebotenen Karten und die
 * Abwurfaufforderung, wenn die Hand über sechs käme.
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
        pendingDraw: box<any>(null),
        hand: box<any[]>([]),
        sessionParticipant: box<any>({ role: "hider", token: "t" }),
        gameSize: box<"S" | "M" | "L" | null>("M"),
    };
});

vi.mock("@nanostores/react", () => ({ useStore: (s: any) => s.get() }));

vi.mock("@/lib/deck-context", () => ({
    pendingDraw: stores.pendingDraw,
    hand: stores.hand,
}));

vi.mock("@/lib/session-context", () => ({
    sessionParticipant: stores.sessionParticipant,
    gameSize: stores.gameSize,
}));

vi.mock("@/lib/cards-api", () => ({ behalten: vi.fn() }));

vi.mock("@/i18n", () => ({
    useT: () => (key: string) => key,
    useTFmt: () => (key: string, vars?: Record<string, string | number>) =>
        vars ? `${key}|${Object.values(vars).join(",")}` : key,
}));

const KARTE = (id: string, name: string) => ({
    id,
    karte: {
        id: `fluch-${id}`,
        art: "fluch",
        name,
        text: "Text.",
        gruppe: "aufgabe",
        dauerMin: null,
        anzahl: 1,
    },
});

const BONUSKARTE = (id: string, name: string) => ({
    id,
    karte: {
        id: "zeitbonus-3",
        art: "zeitbonus",
        name,
        text: "Text.",
        bonusMin: { S: 2, M: 3, L: 5 },
        anzahl: 1,
    },
});

const ZEITFLUCH = (id: string, name: string) => ({
    id,
    karte: {
        id: "fluch-zeit",
        art: "fluch",
        name,
        text: "Text.",
        gruppe: "bewegung",
        dauerMin: { S: 20, M: 40, L: 60 },
        anzahl: 1,
    },
});

async function render() {
    const { ZiehSchirm } = await import("../session/cards/ZiehSchirm");
    return renderToStaticMarkup(<ZiehSchirm />);
}

describe("ZiehSchirm", () => {
    beforeEach(() => {
        stores.pendingDraw.set(null);
        stores.hand.set([]);
        stores.sessionParticipant.set({ role: "hider", token: "t" });
        stores.gameSize.set("M");
        vi.resetModules();
    });

    it("zeichnet nichts ohne offenen Ziehvorgang", async () => {
        expect(await render()).toBe("");
    });

    it("zeichnet nichts für einen Suchenden", async () => {
        stores.sessionParticipant.set({ role: "seeker", token: "t" });
        stores.pendingDraw.set({
            questionId: "q1",
            angeboten: [KARTE("d1", "Eins")],
            behalten: 1,
        });

        expect(await render()).toBe("");
    });

    it("zeigt jede angebotene Karte", async () => {
        stores.pendingDraw.set({
            questionId: "q1",
            angeboten: [KARTE("d1", "Eins"), KARTE("d2", "Zwei"), KARTE("d3", "Drei")],
            behalten: 1,
        });

        const markup = await render();

        expect(markup.match(/data-angeboten=/g)?.length).toBe(3);
        expect(markup).toContain("Eins");
        expect(markup).toContain("Drei");
    });

    it("zeigt die Bonusminuten einer angebotenen Zeitbonuskarte", async () => {
        stores.gameSize.set("L");
        stores.pendingDraw.set({
            questionId: "q1",
            angeboten: [BONUSKARTE("d1", "Zeitbonus")],
            behalten: 1,
        });

        const markup = await render();

        expect(markup).toContain("cards.bonusValue|5");
    });

    it("zeigt die Laufzeit eines angebotenen Fluchs", async () => {
        stores.gameSize.set("S");
        stores.pendingDraw.set({
            questionId: "q1",
            angeboten: [ZEITFLUCH("d1", "Umweg")],
            behalten: 1,
        });

        const markup = await render();

        expect(markup).toContain("cards.durationValue|20");
    });

    it("zeigt den Wert auch auf den Karten der eigenen Hand", async () => {
        stores.hand.set(
            Array.from({ length: 6 }, (_, i) => BONUSKARTE(`h${i}`, `Alt ${i}`)),
        );
        stores.pendingDraw.set({
            questionId: "q1",
            angeboten: [ZEITFLUCH("d1", "Umweg"), ZEITFLUCH("d2", "Stau")],
            behalten: 1,
        });

        const markup = await render();

        expect(markup.match(/cards\.bonusValue\|3/g)?.length).toBe(6);
    });

    it("verlangt keinen Abwurf, solange die Hand Platz hat", async () => {
        stores.hand.set([KARTE("h1", "Alt")]);
        stores.pendingDraw.set({
            questionId: "q1",
            angeboten: [KARTE("d1", "Eins"), KARTE("d2", "Zwei")],
            behalten: 1,
        });

        const markup = await render();

        expect(markup).not.toContain("cards.discardPrompt");
    });

    it("verlangt einen Abwurf, wenn die Hand über sechs käme", async () => {
        stores.hand.set(
            Array.from({ length: 6 }, (_, i) => KARTE(`h${i}`, `Alt ${i}`)),
        );
        stores.pendingDraw.set({
            questionId: "q1",
            angeboten: [KARTE("d1", "Eins"), KARTE("d2", "Zwei")],
            behalten: 1,
        });

        const markup = await render();

        expect(markup).toContain("cards.discardPrompt");
        expect(markup.match(/data-handcard=/g)?.length).toBe(6);
    });
});
