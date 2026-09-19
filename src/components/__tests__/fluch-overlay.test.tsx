/**
 * Prüft das Vollbild-Overlay, das bei den Suchenden aufschlägt, wenn ein
 * Fluch gespielt wird.
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
        eingeschlagenerFluch: box<any>(null),
        sessionParticipant: box<any>({ role: "seeker", token: "t" }),
    };
});

vi.mock("@nanostores/react", () => ({ useStore: (s: any) => s.get() }));

vi.mock("@/lib/deck-context", () => ({
    eingeschlagenerFluch: stores.eingeschlagenerFluch,
}));

vi.mock("@/lib/session-context", () => ({
    sessionParticipant: stores.sessionParticipant,
}));

vi.mock("@/i18n", () => ({ useT: () => (key: string) => key }));

const FLUCH = {
    id: "c1",
    karte: {
        id: "fluch-brueckenzoll",
        art: "fluch",
        name: "Brückenzoll",
        text: "Stellt euch unter eine Brücke.",
        kosten: "Mindestabstand.",
        gruppe: "aufgabe",
        dauerMin: null,
        anzahl: 1,
    },
    playedAt: new Date().toISOString(),
    expiresAt: null,
    endedAt: null,
    endedBy: null,
};

async function render() {
    const { FluchOverlay } = await import("../session/cards/FluchOverlay");
    return renderToStaticMarkup(<FluchOverlay />);
}

describe("FluchOverlay", () => {
    beforeEach(() => {
        stores.eingeschlagenerFluch.set(null);
        stores.sessionParticipant.set({ role: "seeker", token: "t" });
        vi.resetModules();
    });

    it("zeichnet nichts, solange kein Fluch eingeschlagen ist", async () => {
        expect(await render()).toBe("");
    });

    it("zeigt Name und Text des Fluchs", async () => {
        stores.eingeschlagenerFluch.set(FLUCH);

        const markup = await render();

        expect(markup).toContain("cards.curseHit");
        expect(markup).toContain("Brückenzoll");
        expect(markup).toContain("Stellt euch unter eine Brücke.");
    });

    it("zeigt die Kosten der Karte nicht", async () => {
        // Die Kosten betreffen den Versteckenden; die Suchenden gehen sie nichts an.
        stores.eingeschlagenerFluch.set(FLUCH);

        const markup = await render();

        expect(markup).not.toContain("Mindestabstand.");
    });

    it("zeichnet beim Versteckenden nichts", async () => {
        stores.sessionParticipant.set({ role: "hider", token: "t" });
        stores.eingeschlagenerFluch.set(FLUCH);

        expect(await render()).toBe("");
    });
});
