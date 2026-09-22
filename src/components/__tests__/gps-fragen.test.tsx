/**
 * Startpunkt und Absende-Sperre in allen fuenf Fragen-Formularen.
 *
 * Hintergrund (22.09.2026): Alle Formulare starteten auf der Kartenmitte. Bei
 * Radius fiel das auf, weil die Kreise mitten in Deutschland landeten; die
 * anderen vier hatten dieselbe Bauart. Jens' Vorgabe: Es zaehlt eine echte
 * GPS-Position oder eine Ortsangabe von Hand, die Kartenmitte allein nicht.
 *
 * Gerendert wird statisch, ohne jsdom. Effekte laufen dabei nicht, der
 * GPS-Abruf der LocationCard also auch nicht - sichtbar ist genau der
 * Startzustand. Die Uebergaenge (GPS kommt an, Ort von Hand eingegeben) sind
 * reine Zustandslogik und stehen in `src/lib/__tests__/standort-herkunft.test.ts`.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stores = vi.hoisted(() => {
    function box<T>(initial: T) {
        return {
            value: initial,
            get() { return this.value; },
            set(v: T) { this.value = v; },
        };
    }
    return {
        defaultUnit: box<string>("kilometers"),
        leafletMapContext: box<any>({
            getCenter: () => ({ lat: 51.1, lng: 10.4 }),
            getZoom: () => 6,
        }),
        ownGpsPosition: box<{ lat: number; lng: number } | null>(null),
        sessionCode: box<string | null>("ABCDEF"),
        sessionParticipant: box<any>({ role: "seeker", token: "t" }),
        gameSize: box<string>("M"),
        pickerOpen: box(true),
        bottomSheetState: box("expanded"),
        pendingDraftKey: box<number | null>(null),
        thermometerGpsTracking: box<any>(null),
        questions: box<any[]>([]),
    };
});

vi.mock("@nanostores/react", () => ({ useStore: (s: any) => s.get() }));
vi.mock("leaflet", () => ({
    circle: () => ({ addTo: () => ({}) }),
    marker: () => ({ addTo: () => ({}), on: () => ({}) }),
    polygon: () => ({ addTo: () => ({}) }),
    divIcon: () => ({}),
}));
vi.mock("react-toastify", () => ({ toast: { error: () => {}, success: () => {} } }));
vi.mock("@/lib/context", () => ({
    defaultUnit: stores.defaultUnit,
    leafletMapContext: stores.leafletMapContext,
    questions: stores.questions,
    addQuestion: () => {},
}));
vi.mock("@/lib/session-context", () => ({
    sessionCode: stores.sessionCode,
    sessionParticipant: stores.sessionParticipant,
    ownGpsPosition: stores.ownGpsPosition,
    gameSize: stores.gameSize,
    pendingDraftKey: stores.pendingDraftKey,
    thermometerGpsTracking: stores.thermometerGpsTracking,
}));
vi.mock("@/lib/bottom-sheet-state", () => ({
    pickerOpen: stores.pickerOpen,
    bottomSheetState: stores.bottomSheetState,
}));
vi.mock("@/lib/session-api", () => ({
    addQuestion: async () => {},
    findNearestPoi: async () => null,
}));
vi.mock("@/lib/handle-submit-error", () => ({ handleSubmitError: () => {} }));
vi.mock("@/maps/api/overpass", () => ({
    findAdminBoundary: async () => null,
    findAdminLevelsAt: async () => [],
}));

import { MatchingConfig } from "../session/picker/MatchingConfig";
import { MeasuringConfig } from "../session/picker/MeasuringConfig";
import { RadiusConfig } from "../session/picker/RadiusConfig";
import { TentaclesConfig } from "../session/picker/TentaclesConfig";
import { ThermometerConfig } from "../session/picker/ThermometerConfig";

const FORMULARE: [string, any][] = [
    ["Radius", RadiusConfig],
    ["Tentakel", TentaclesConfig],
    ["Matching", MatchingConfig],
    ["Measuring", MeasuringConfig],
    ["Thermometer", ThermometerConfig],
];

function render(Komponente: any) {
    return renderToStaticMarkup(
        createElement(Komponente, {
            wsStatus: "connected",
            onBack: () => {},
            onSettings: () => {},
            onClose: () => {},
        }),
    );
}

/** Beschriftung und disabled-Zustand des ersten Knopfes im Fuss. */
function hauptknopf(html: string) {
    const treffer = [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)];
    const knopf = treffer.find((m) => /starten|senden|absenden|stellen|Warte/i.test(m[1]));
    const roh = knopf ? knopf[0] : "";
    return { text: knopf ? knopf[1] : "", gesperrt: roh.includes("disabled") };
}

describe("Fragen-Formulare: Startpunkt", () => {
    beforeEach(() => {
        stores.ownGpsPosition.set(null);
    });

    it.each(FORMULARE)("%s startet an der eigenen GPS-Position", (_name, Komponente) => {
        stores.ownGpsPosition.set({ lat: 53.5511, lng: 9.9937 });
        const html = render(Komponente);
        expect(html).toContain("53.5511° N, 9.9937° E");
        expect(html).not.toContain("51.1000° N, 10.4000° E");
    });

    it.each(FORMULARE)("%s faellt ohne GPS auf die Kartenmitte zurueck", (_name, Komponente) => {
        const html = render(Komponente);
        expect(html).toContain("51.1000° N, 10.4000° E");
    });
});

describe("Fragen-Formulare: Absende-Sperre", () => {
    beforeEach(() => {
        stores.ownGpsPosition.set(null);
    });

    it.each(FORMULARE)("%s sperrt das Absenden, solange nur die Kartenmitte dasteht", (_name, Komponente) => {
        const { text, gesperrt } = hauptknopf(render(Komponente));
        expect(gesperrt).toBe(true);
        expect(text).toMatch(/Warte auf GPS/);
    });

    it.each(FORMULARE)("%s gibt das Absenden mit eigener GPS-Position frei", (_name, Komponente) => {
        stores.ownGpsPosition.set({ lat: 53.5511, lng: 9.9937 });
        const { text } = hauptknopf(render(Komponente));
        expect(text).not.toMatch(/Warte auf GPS/);
    });
});
