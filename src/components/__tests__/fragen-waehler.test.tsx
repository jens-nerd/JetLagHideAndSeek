/**
 * Prüft den Fragenwähler: welche Kategorien die Spielgröße hergibt, was das
 * Glücksrad davon wegnimmt und was der Hinweis dazu sagt.
 *
 * Die Unteransichten (Radius, Tentakel, …) sind ausgehängt, damit der Test
 * ohne Leaflet läuft.
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
        pickerOpen: box<boolean>(true),
        pendingPickerType: box<string | null>(null),
        bottomSheetState: box<string>("collapsed"),
        sessionParticipant: box<any>({ role: "seeker", token: "t" }),
        sessionCode: box<string | null>("ABCDEF"),
        wsStatus: box<string>("connected"),
        gameSize: box<"S" | "M" | "L" | null>("M"),
        sessionQuestions: box<any[]>([]),
        gesperrteKategorie: box<string | null>(null),
    };
});

vi.mock("@nanostores/react", () => ({ useStore: (s: any) => s.get() }));

vi.mock("@/lib/bottom-sheet-state", () => ({
    pickerOpen: stores.pickerOpen,
    pendingPickerType: stores.pendingPickerType,
    bottomSheetState: stores.bottomSheetState,
}));

vi.mock("@/lib/session-context", () => ({
    gameSize: stores.gameSize,
    leaveSession: vi.fn(),
    sessionCode: stores.sessionCode,
    sessionParticipant: stores.sessionParticipant,
    sessionQuestions: stores.sessionQuestions,
    wsStatus: stores.wsStatus,
}));

vi.mock("@/lib/deck-context", () => ({
    gesperrteKategorie: stores.gesperrteKategorie,
}));

vi.mock("@/i18n", () => ({
    useT: () => (key: string) => key,
    useTFmt: () => (key: string, vars?: Record<string, string | number>) =>
        vars ? `${key}|${Object.values(vars).join(",")}` : key,
}));

// Unteransichten und Beiwerk aushängen — sie ziehen Leaflet und den Karten-Store nach.
vi.mock("@/components/OptionDrawers", () => ({ OptionDrawers: () => null }));
vi.mock("../session/picker/PickerHeader", () => ({ PickerHeader: () => null }));
vi.mock("../session/picker/RadiusConfig", () => ({
    RadiusConfig: () => <div data-unteransicht="radius" />,
}));
vi.mock("../session/picker/PhotoConfig", () => ({
    PhotoConfig: () => <div data-unteransicht="photo" />,
}));
vi.mock("../session/picker/TentaclesConfig", () => ({
    TentaclesConfig: () => <div data-unteransicht="tentacles" />,
}));
vi.mock("../session/picker/MatchingConfig", () => ({
    MatchingConfig: () => <div data-unteransicht="matching" />,
}));
vi.mock("../session/picker/MeasuringConfig", () => ({
    MeasuringConfig: () => <div data-unteransicht="measuring" />,
}));
vi.mock("../session/picker/ThermometerConfig", () => ({
    ThermometerConfig: () => <div data-unteransicht="thermometer" />,
}));
vi.mock("../session/SessionQuestionPanel", () => ({
    QuestionList: () => null,
    SessionQuestionPanel: () => null,
}));

async function render() {
    const { QuestionPickerSheet } = await import("../session/QuestionPickerSheet");
    return renderToStaticMarkup(<QuestionPickerSheet />);
}

function kategorien(markup: string): string[] {
    return [...markup.matchAll(/data-kategorie="([a-z]+)"/g)].map((m) => m[1]);
}

describe("QuestionPickerSheet", () => {
    beforeEach(() => {
        stores.pickerOpen.set(true);
        stores.sessionParticipant.set({ role: "seeker", token: "t" });
        stores.gameSize.set("M");
        stores.gesperrteKategorie.set(null);
        vi.resetModules();
    });

    it("zeigt bei M alle sechs Kategorien", async () => {
        const markup = await render();

        expect(kategorien(markup)).toHaveLength(6);
        expect(kategorien(markup)).toContain("tentacles");
    });

    it("zeigt bei L alle sechs Kategorien", async () => {
        stores.gameSize.set("L");

        const markup = await render();

        expect(kategorien(markup)).toHaveLength(6);
        expect(kategorien(markup)).toContain("tentacles");
    });

    it("lässt bei S die Tentakelfrage weg", async () => {
        stores.gameSize.set("S");

        const markup = await render();

        expect(kategorien(markup)).toHaveLength(5);
        expect(kategorien(markup)).not.toContain("tentacles");
    });

    it("zeigt ohne Sperre alle Kategorien und keinen Hinweis", async () => {
        const markup = await render();

        expect(kategorien(markup)).toHaveLength(6);
        expect(markup).not.toContain("picker.lockedCategory");
    });

    it("nimmt die gesperrte Kategorie aus der Liste und nennt sie im Hinweis", async () => {
        stores.gesperrteKategorie.set("radius");

        const markup = await render();

        expect(kategorien(markup)).toHaveLength(5);
        expect(kategorien(markup)).not.toContain("radius");
        expect(markup).toContain("picker.lockedCategory|questionType.radius");
    });

    it("sperrt bei S zusätzlich zur fehlenden Tentakelfrage", async () => {
        stores.gameSize.set("S");
        stores.gesperrteKategorie.set("photo");

        const markup = await render();

        expect(kategorien(markup)).toHaveLength(4);
        expect(kategorien(markup)).not.toContain("photo");
        expect(kategorien(markup)).not.toContain("tentacles");
    });

    it("zeigt dem Versteckenden keine Kategoriekarten", async () => {
        stores.sessionParticipant.set({ role: "hider", token: "t" });

        const markup = await render();

        expect(kategorien(markup)).toHaveLength(0);
    });
});

describe("offeneUnteransicht", () => {
    async function fn() {
        const mod = await import("../session/QuestionPickerSheet");
        return mod.offeneUnteransicht;
    }

    it("lässt eine ungesperrte Unteransicht offen", async () => {
        expect((await fn())("radius", null)).toBe("radius");
        expect((await fn())("radius", "photo")).toBe("radius");
    });

    it("klappt die Unteransicht zu, wenn ihre Kategorie gesperrt wird", async () => {
        expect((await fn())("radius", "radius")).toBeNull();
    });

    it("bleibt bei geschlossener Unteransicht bei null", async () => {
        expect((await fn())(null, null)).toBeNull();
        expect((await fn())(null, "radius")).toBeNull();
    });
});
