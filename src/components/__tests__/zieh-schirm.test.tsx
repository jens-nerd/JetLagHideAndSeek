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
    };
});

vi.mock("@nanostores/react", () => ({ useStore: (s: any) => s.get() }));

vi.mock("@/lib/deck-context", () => ({
    pendingDraw: stores.pendingDraw,
    hand: stores.hand,
}));

vi.mock("@/lib/session-context", () => ({
    sessionParticipant: stores.sessionParticipant,
}));

vi.mock("@/lib/cards-api", () => ({ behalten: vi.fn() }));

vi.mock("@/i18n", () => ({
    useT: () => (key: string) => key,
    useTFmt: () => (key: string) => key,
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

async function render() {
    const { ZiehSchirm } = await import("../session/cards/ZiehSchirm");
    return renderToStaticMarkup(<ZiehSchirm />);
}

describe("ZiehSchirm", () => {
    beforeEach(() => {
        stores.pendingDraw.set(null);
        stores.hand.set([]);
        stores.sessionParticipant.set({ role: "hider", token: "t" });
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
