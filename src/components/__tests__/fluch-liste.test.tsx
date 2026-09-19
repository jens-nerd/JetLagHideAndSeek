/**
 * Prüft, dass die Fluchliste je nach Rolle und Kartenart die richtigen
 * Bedienelemente zeigt: Countdown bei Zeitflüchen, "erledigt" bei den
 * Suchenden, "aufheben" beim Versteckenden.
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
        activeCurses: box<any[]>([]),
        sessionParticipant: box<any>({ role: "seeker", token: "t" }),
        sessionCode: box<string | null>("ABCDEF"),
    };
});

vi.mock("@nanostores/react", () => ({
    useStore: (store: any) => store.get(),
}));

vi.mock("@/lib/deck-context", () => ({
    activeCurses: stores.activeCurses,
}));

vi.mock("@/lib/session-context", () => ({
    sessionParticipant: stores.sessionParticipant,
    sessionCode: stores.sessionCode,
}));

vi.mock("@/lib/cards-api", () => ({
    fluchBeenden: vi.fn(),
}));

vi.mock("@/i18n", () => ({
    useT: () => (key: string) => key,
    locale: { get: () => "de" },
}));

const KARTE_MIT_DAUER = {
    id: "fluch-rechtsdrall",
    art: "fluch",
    name: "Rechtsdrall",
    text: "Nur rechts abbiegen.",
    gruppe: "bewegung",
    dauerMin: { S: 20, M: 40, L: 60 },
    anzahl: 1,
};

const KARTE_OHNE_DAUER = {
    id: "fluch-brueckenzoll",
    art: "fluch",
    name: "Brückenzoll",
    text: "Unter eine Brücke.",
    gruppe: "aufgabe",
    dauerMin: null,
    anzahl: 1,
};

function fluch(karte: any, expiresAt: string | null) {
    return {
        id: `c-${karte.id}`,
        karte,
        playedAt: new Date().toISOString(),
        expiresAt,
        endedAt: null,
        endedBy: null,
    };
}

async function render() {
    const { FluchListe } = await import("../session/cards/FluchListe");
    return renderToStaticMarkup(<FluchListe />);
}

describe("FluchListe", () => {
    beforeEach(() => {
        stores.activeCurses.set([]);
        stores.sessionParticipant.set({ role: "seeker", token: "t" });
        vi.resetModules();
    });

    it("zeigt einen Hinweis, wenn kein Fluch läuft", async () => {
        const markup = await render();
        expect(markup).toContain("cards.noCurses");
    });

    it("zeigt den Namen jedes laufenden Fluchs", async () => {
        stores.activeCurses.set([
            fluch(KARTE_MIT_DAUER, new Date(Date.now() + 600_000).toISOString()),
            fluch(KARTE_OHNE_DAUER, null),
        ]);

        const markup = await render();

        expect(markup).toContain("Rechtsdrall");
        expect(markup).toContain("Brückenzoll");
    });

    it("zeigt bei einem Zeitfluch einen Countdown", async () => {
        stores.activeCurses.set([
            fluch(KARTE_MIT_DAUER, new Date(Date.now() + 600_000).toISOString()),
        ]);

        const markup = await render();

        expect(markup).toContain('data-countdown="c-fluch-rechtsdrall"');
    });

    it("zeigt bei einem Aufgabenfluch keinen Countdown", async () => {
        stores.activeCurses.set([fluch(KARTE_OHNE_DAUER, null)]);

        const markup = await render();

        expect(markup).not.toContain("data-countdown");
        expect(markup).toContain("cards.noDuration");
    });

    it("zeigt eine wörtliche Dauer statt der allgemeinen Beschriftung", async () => {
        // Drei Karten tragen dauerText, etwa "bis Rundenende".
        const mitText = { ...KARTE_OHNE_DAUER, dauerText: "bis Rundenende" };
        stores.activeCurses.set([fluch(mitText, null)]);

        const markup = await render();

        expect(markup).toContain("bis Rundenende");
        expect(markup).not.toContain("cards.noDuration");
    });

    it("gibt den Suchenden den Knopf erledigt", async () => {
        stores.activeCurses.set([fluch(KARTE_OHNE_DAUER, null)]);

        const markup = await render();

        expect(markup).toContain("cards.done");
        expect(markup).not.toContain("cards.lift");
    });

    it("gibt dem Versteckenden den Knopf aufheben", async () => {
        stores.sessionParticipant.set({ role: "hider", token: "t" });
        stores.activeCurses.set([fluch(KARTE_OHNE_DAUER, null)]);

        const markup = await render();

        expect(markup).toContain("cards.lift");
        expect(markup).not.toContain("cards.done");
    });

    it("zeichnet je Fluch genau eine Zeile", async () => {
        stores.activeCurses.set([
            fluch(KARTE_MIT_DAUER, new Date(Date.now() + 600_000).toISOString()),
            fluch(KARTE_OHNE_DAUER, null),
        ]);

        const markup = await render();

        expect(markup.match(/data-curse=/g)?.length).toBe(2);
    });
});
