/**
 * Prüft die Einzelansicht einer Handkarte: Volltext, die Zusatzzeilen und der
 * Zahlenwert der Karte.
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
    return { gameSize: box<"S" | "M" | "L" | null>("M") };
});

vi.mock("@nanostores/react", () => ({ useStore: (s: any) => s.get() }));

vi.mock("@/lib/session-context", () => ({ gameSize: stores.gameSize }));

vi.mock("@/i18n", () => ({
    useT: () => (key: string) => key,
    useTFmt: () => (key: string, vars?: Record<string, string | number>) =>
        vars ? `${key}|${Object.values(vars).join(",")}` : key,
}));

const BONUS = {
    id: "h1",
    karte: {
        id: "zeitbonus-3",
        art: "zeitbonus",
        name: "Zeitbonus",
        text: "Text.",
        bonusMin: { S: 2, M: 3, L: 5 },
        anzahl: 1,
    },
};

const AUFGABENFLUCH = {
    id: "h2",
    karte: {
        id: "fluch-aufgabe",
        art: "fluch",
        name: "Aufgabe",
        text: "Text.",
        gruppe: "aufgabe",
        dauerMin: null,
        anzahl: 1,
    },
};

async function render(karte: any) {
    const { KartenAnsicht } = await import("../session/cards/KartenAnsicht");
    return renderToStaticMarkup(
        <KartenAnsicht
            karte={karte}
            onZurueck={() => {}}
            onAusspielen={async () => {}}
            onAbwerfen={async () => {}}
        />,
    );
}

describe("KartenAnsicht", () => {
    beforeEach(() => {
        stores.gameSize.set("M");
        vi.resetModules();
    });

    it("zeigt die Bonusminuten der Spielgröße", async () => {
        stores.gameSize.set("L");
        const markup = await render(BONUS);

        expect(markup).toContain("cards.bonus");
        expect(markup).toContain("cards.bonusValue|5");
    });

    it("zeigt beim Aufgabenfluch, dass er bis zur Meldung läuft", async () => {
        const markup = await render(AUFGABENFLUCH);

        expect(markup).toContain("cards.duration");
        expect(markup).toContain("cards.noDuration");
    });
});
