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
        gesperrteKategorie: box<string | null>(null),
        sessionParticipant: box<any>({ role: "seeker", token: "t" }),
        sessionCode: box<string | null>("ABCDEF"),
    };
});

vi.mock("@nanostores/react", () => ({
    useStore: (store: any) => store.get(),
}));

vi.mock("@/lib/deck-context", () => ({
    activeCurses: stores.activeCurses,
    gesperrteKategorie: stores.gesperrteKategorie,
    applyCurseNachweise: vi.fn(),
}));

// FotoBeweis hängt sein Overlay über DialogContent in einen DOM-Knoten; das
// gibt es in dieser Umgebung nicht. Der Platzhalter trägt die Bildadresse, so
// prüft der Test dasselbe, was der echte Knopf anzeigt.
vi.mock("../session/FotoBeweis", () => ({
    FotoBeweis: ({ src }: { src: string }) => <div data-fotobeweis={src} />,
}));

vi.mock("@/lib/session-context", () => ({
    sessionParticipant: stores.sessionParticipant,
    sessionCode: stores.sessionCode,
}));

vi.mock("@/lib/cards-api", () => ({
    fluchBeenden: vi.fn(),
    nachweiseHochladen: vi.fn(),
}));

vi.mock("@/i18n", () => ({
    t: (key: string) => key,
    useT: () => (key: string) => key,
    useTFmt: () => (key: string, vars?: Record<string, string | number>) =>
        vars ? `${key}|${Object.values(vars).join(",")}` : key,
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

const GLUECKSRAD = {
    id: "fluch-gluecksrad",
    art: "fluch",
    name: "Glücksrad",
    text: "Eine Kategorie ist gesperrt.",
    gruppe: "fragen",
    dauerMin: null,
    anzahl: 1,
};

function fluch(karte: any, expiresAt: string | null, nachweise: any[] = []) {
    return {
        id: `c-${karte.id}`,
        karte,
        playedAt: new Date().toISOString(),
        expiresAt,
        endedAt: null,
        endedBy: null,
        nachweise,
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
        stores.gesperrteKategorie.set(null);
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

    it("nennt am Glücksrad die gerade gesperrte Kategorie", async () => {
        stores.activeCurses.set([fluch(GLUECKSRAD, null)]);
        stores.gesperrteKategorie.set("radius");

        const markup = await render();

        expect(markup).toContain("cards.lockedCategory|questionType.radius");
    });

    it("zeigt dem Versteckenden dieselbe Sperre", async () => {
        stores.sessionParticipant.set({ role: "hider", token: "t" });
        stores.activeCurses.set([fluch(GLUECKSRAD, null)]);
        stores.gesperrteKategorie.set("photo");

        const markup = await render();

        expect(markup).toContain("cards.lockedCategory|questionType.photo");
    });

    it("hängt die Sperre nicht an einen anderen Fluch", async () => {
        stores.activeCurses.set([fluch(KARTE_OHNE_DAUER, null)]);
        stores.gesperrteKategorie.set("radius");

        const markup = await render();

        expect(markup).not.toContain("cards.lockedCategory");
    });

    it("schreibt nichts ans Glücksrad, solange nichts gesperrt ist", async () => {
        stores.activeCurses.set([fluch(GLUECKSRAD, null)]);

        const markup = await render();

        expect(markup).not.toContain("cards.lockedCategory");
    });
});

describe("FluchListe, Nachweise", () => {
    beforeEach(() => {
        stores.activeCurses.set([]);
        stores.sessionParticipant.set({ role: "seeker", token: "t" });
        stores.gesperrteKategorie.set(null);
        vi.resetModules();
    });

    it("gibt einem Bild-Fluch einen Hochladeknopf", async () => {
        const karte = { ...KARTE_OHNE_DAUER, nachweisUpload: "bild" };
        stores.activeCurses.set([fluch(karte, null)]);

        const markup = await render();

        expect(markup).toContain('data-nachweis-knopf="c-fluch-brueckenzoll"');
        expect(markup).toContain("cards.proofUpload");
        expect(markup).not.toContain("cards.proofVideoAtEnd");
    });

    it("gibt einem beides-Fluch einen Hochladeknopf", async () => {
        const karte = { ...KARTE_OHNE_DAUER, id: "fluch-warteschlange", nachweisUpload: "beides" };
        stores.activeCurses.set([fluch(karte, null)]);

        const markup = await render();

        expect(markup).toContain('data-nachweis-knopf="c-fluch-warteschlange"');
    });

    it("gibt einem Video-Fluch keinen Hochladeknopf, sondern den Satz", async () => {
        // Kegelbahn verlangt einen Film; hochgeladen wird er nicht, er wird am
        // Spielende gezeigt.
        const karte = { ...KARTE_OHNE_DAUER, id: "fluch-kegelbahn", nachweisUpload: "video" };
        stores.activeCurses.set([fluch(karte, null)]);

        const markup = await render();

        expect(markup).not.toContain("data-nachweis-knopf");
        expect(markup).not.toContain("cards.proofUpload");
        expect(markup).toContain('data-videohinweis="c-fluch-kegelbahn"');
        expect(markup).toContain("cards.proofVideoAtEnd");
    });

    it("sagt dasselbe am Vogelkino", async () => {
        const karte = { ...KARTE_OHNE_DAUER, id: "fluch-vogelkino", nachweisUpload: "video" };
        stores.activeCurses.set([fluch(karte, null)]);

        const markup = await render();

        expect(markup).toContain('data-videohinweis="c-fluch-vogelkino"');
        expect(markup).toContain("cards.proofVideoAtEnd");
        expect(markup).not.toContain("data-nachweis-knopf");
    });

    it("stellt den Satz vor den Knopf erledigt", async () => {
        const karte = { ...KARTE_OHNE_DAUER, id: "fluch-vogelkino", nachweisUpload: "video" };
        stores.activeCurses.set([fluch(karte, null)]);

        const markup = await render();

        expect(markup.indexOf("cards.proofVideoAtEnd")).toBeLessThan(
            markup.indexOf("cards.done"),
        );
    });

    it("sagt dem Versteckenden dasselbe", async () => {
        stores.sessionParticipant.set({ role: "hider", token: "t" });
        const karte = { ...KARTE_OHNE_DAUER, id: "fluch-vogelkino", nachweisUpload: "video" };
        stores.activeCurses.set([fluch(karte, null)]);

        const markup = await render();

        expect(markup).toContain("cards.proofVideoAtEnd");
    });

    it("gibt einem Fluch ohne nachweisUpload keinen Hochladeknopf", async () => {
        // Auch dann nicht, wenn die Karte eine Nachweis-Zeile trägt: die haben
        // nur sechs der zwölf, sie ist eine Abschrift und keine Funktion.
        const karte = { ...KARTE_OHNE_DAUER, nachweis: "Foto beider Türme." };
        stores.activeCurses.set([fluch(karte, null)]);

        const markup = await render();

        expect(markup).not.toContain("data-nachweis-knopf");
    });

    it("haengt den Satz nicht an eine Karte ohne nachweisUpload", async () => {
        // Zwölf Flüche tragen nachweisUpload, die übrigen gar keinen; dort gibt
        // es auch kein Video, über das etwas zu sagen wäre.
        stores.activeCurses.set([fluch(KARTE_OHNE_DAUER, null)]);

        const markup = await render();

        expect(markup).not.toContain("cards.proofVideoAtEnd");
        expect(markup).not.toContain("data-nachweis-knopf");
        expect(markup).not.toContain("data-nachweisfeld");
    });

    it("gibt auch dem Versteckenden den Hochladeknopf", async () => {
        // fluch-warteschlange verlangt Nachweise von beiden Seiten.
        stores.sessionParticipant.set({ role: "hider", token: "t" });
        const karte = { ...KARTE_OHNE_DAUER, nachweisUpload: "beides" };
        stores.activeCurses.set([fluch(karte, null)]);

        const markup = await render();

        expect(markup).toContain("data-nachweis-knopf");
    });

    it("zeigt die vorhandenen Nachweise als Vorschaubilder", async () => {
        const karte = { ...KARTE_OHNE_DAUER, nachweisUpload: "bild" };
        stores.activeCurses.set([
            fluch(karte, null, [
                { url: "/uploads/eins.jpg", art: "bild", von: "p1", am: "2026-10-06T10:00:00.000Z" },
                { url: "/uploads/zwei.jpg", art: "bild", von: "p1", am: "2026-10-06T10:01:00.000Z" },
            ]),
        ]);

        const markup = await render();

        expect(markup).toContain('/uploads/eins.jpg"');
        expect(markup).toContain('/uploads/zwei.jpg"');
        expect(markup).toContain("cards.proofsUploaded");
    });

    it("zeichnet gar kein Nachweisfeld, wenn die Karte keinen verlangt", async () => {
        stores.activeCurses.set([fluch(KARTE_OHNE_DAUER, null)]);

        const markup = await render();

        expect(markup).not.toContain("data-nachweisfeld");
    });

    it("zeigt vorhandene Nachweise auch an einem Video-Fluch", async () => {
        // Flos Endpunkt lässt an einer Video-Karte ein Bild durch (seine
        // Abweichung 4). Angekommene Nachweise sollen dann sichtbar sein,
        // auch wenn hier kein Knopf steht.
        const karte = { ...KARTE_OHNE_DAUER, id: "fluch-kegelbahn", nachweisUpload: "video" };
        stores.activeCurses.set([
            fluch(karte, null, [
                { url: "/uploads/wurf.jpg", art: "bild", von: "p1", am: "2026-10-06T10:00:00.000Z" },
            ]),
        ]);

        const markup = await render();

        expect(markup).toContain('/uploads/wurf.jpg"');
        expect(markup).not.toContain("data-nachweis-knopf");
    });
});
