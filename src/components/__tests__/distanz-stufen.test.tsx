/**
 * Die Distanz-Chips in den drei Formularen haengen an der Gebietsausdehnung.
 *
 * Hintergrund (05.10.2026): Jens hat in einem Stadtteil von 1 bis 2 km
 * Ausdehnung gespielt. Die Stufen standen als Festwerte im Code (1 km bis
 * 80 km) und waren fuer das Gebiet samt und sonders zu gross. Die Rechnung
 * steht jetzt in shared/src/groessen.ts; dieser Test prueft, dass die
 * Formulare sie auch benutzen.
 *
 * Statisches Rendern: Effekte laufen nicht, die Chips stehen also genau so im
 * Markup, wie sie beim Oeffnen des Pickers erscheinen.
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
            getCenter: () => ({ lat: 53.5646, lng: 10.0314 }),
            getZoom: () => 14,
        }),
        ownGpsPosition: box<{ lat: number; lng: number } | null>({
            lat: 53.5646,
            lng: 10.0314,
        }),
        sessionCode: box<string | null>("ABCDEF"),
        sessionParticipant: box<any>({ role: "seeker", token: "t" }),
        gameSize: box<string>("M"),
        revealedHidingZone: box<any>(null),
        pickerOpen: box(true),
        bottomSheetState: box("expanded"),
        pendingDraftKey: box<number | null>(null),
        thermometerGpsTracking: box<any>(null),
        questions: box<any[]>([]),
        gebietsausdehnungKm: box<number | null>(null),
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
    gebietsausdehnungKm: stores.gebietsausdehnungKm,
}));
vi.mock("@/lib/session-context", () => ({
    sessionCode: stores.sessionCode,
    sessionParticipant: stores.sessionParticipant,
    ownGpsPosition: stores.ownGpsPosition,
    gameSize: stores.gameSize,
    revealedHidingZone: stores.revealedHidingZone,
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

import { RadiusConfig } from "../session/picker/RadiusConfig";
import { TentaclesConfig } from "../session/picker/TentaclesConfig";
import { ThermometerConfig } from "../session/picker/ThermometerConfig";

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

/** Alle Chip-Beschriftungen, die nach einer Distanz aussehen. */
function distanzChips(html: string): string[] {
    return [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)]
        .map((m) => m[1])
        .filter((t) => /^[\d.]+\s(m|km|yd|mi)$/.test(t));
}

describe("Distanz-Chips bei einem Stadtteil von 1,5 km", () => {
    beforeEach(() => {
        stores.defaultUnit.set("kilometers");
        stores.gebietsausdehnungKm.set(1.5);
    });

    it("Radius: 100 m bis 1,5 km, Freieingabe bleibt", () => {
        const html = render(RadiusConfig);
        expect(distanzChips(html)).toEqual([
            "100 m",
            "200 m",
            "400 m",
            "800 m",
            "1.5 km",
        ]);
        expect(html).not.toContain("80 km");
        // Der Knopf fuer die Freieingabe steht weiter da
        expect(html).toContain(">Custom<");
    });

    it("Thermometer: 200 m bis 1,5 km", () => {
        const html = render(ThermometerConfig);
        expect(distanzChips(html)).toEqual(["200 m", "400 m", "800 m", "1.5 km"]);
    });

    it("Tentakel: 200 m bis 1,5 km", () => {
        const html = render(TentaclesConfig);
        expect(distanzChips(html)).toEqual(["200 m", "400 m", "800 m", "1.5 km"]);
    });
});

describe("Distanz-Chips ohne Gebiet", () => {
    beforeEach(() => {
        stores.defaultUnit.set("kilometers");
        stores.gebietsausdehnungKm.set(null);
    });

    it("Radius faellt auf die alten Festwerte zurueck", () => {
        expect(distanzChips(render(RadiusConfig))).toEqual([
            "300 m",
            "500 m",
            "1 km",
            "3 km",
            "8 km",
            "25 km",
            "80 km",
        ]);
    });

    it("Thermometer faellt auf die alten Festwerte zurueck", () => {
        expect(distanzChips(render(ThermometerConfig))).toEqual([
            "1 km",
            "3 km",
            "8 km",
            "25 km",
            "80 km",
        ]);
    });
});

describe("Distanz-Chips in Meilen", () => {
    beforeEach(() => {
        stores.defaultUnit.set("miles");
        stores.gebietsausdehnungKm.set(1.5);
    });

    it("Radius beschriftet die gleichen Stufen imperial", () => {
        expect(distanzChips(render(RadiusConfig))).toEqual([
            "110 yd",
            "220 yd",
            "440 yd",
            "870 yd",
            "0.9 mi",
        ]);
    });
});
