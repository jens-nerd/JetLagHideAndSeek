/**
 * Kartendarstellung offener Session-Fragen (DraggableMarkers).
 *
 * Hintergrund: Der Block ab `$participant?.role === "hider" &&` zeichnet die
 * Umrisse aller noch nicht beantworteten Fragen — Marker, Radiuskreise und die
 * Thermometer-Linien. Er steuert damit alle fuenf Fragetypen, nicht nur Radius.
 *
 * Der Test prueft genau zwei Trennlinien:
 *   1. Rolle   — Seeker und Hider sehen dieselben Umrisse.
 *   2. Status  — eine abgelaufene Frage behaelt ihren Umriss.
 *
 * Aufbau ohne jsdom und ohne neue Abhaengigkeiten: react-leaflet und leaflet
 * werden ersetzt, die Komponente wird mit renderToStaticMarkup zu Markup
 * gerendert, und gezaehlt wird, was an Geometrie herauskommt.
 */
import * as turf from "@turf/turf";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Stores ────────────────────────────────────────────────────────────────────
// Minimale Attrappen mit .get(); useStore wird passend dazu ersetzt, damit
// weder nanostores-Abos noch localStorage im Node-Lauf gebraucht werden.
const stores = vi.hoisted(() => {
    const box = <T,>(initial: T) => ({
        value: initial,
        get() {
            return this.value;
        },
    });
    return {
        questions: box<any[]>([]),
        hiderMode: box<any>(false),
        autoSave: box(true),
        triggerLocalRefresh: box(0),
        sessionParticipant: box<any>(null),
        sessionQuestions: box<any[]>([]),
    };
});

vi.mock("@nanostores/react", () => ({
    useStore: (store: any) => store.get(),
}));

vi.mock("@/lib/context", () => ({
    questions: stores.questions,
    hiderMode: stores.hiderMode,
    autoSave: stores.autoSave,
    triggerLocalRefresh: stores.triggerLocalRefresh,
    questionModified: () => {},
    save: () => {},
}));

vi.mock("@/lib/session-context", () => ({
    sessionParticipant: stores.sessionParticipant,
    sessionQuestions: stores.sessionQuestions,
}));

// ── Leaflet und react-leaflet ─────────────────────────────────────────────────

vi.mock("leaflet", () => ({
    divIcon: (options: any) => ({ divIcon: options }),
    Icon: class {
        constructor(options: any) {
            Object.assign(this, options);
        }
    },
}));

vi.mock("react-leaflet", async () => {
    const { createElement: h } = await import("react");
    return {
        Marker: (props: any) =>
            h("div", {
                "data-marker": JSON.stringify(props.position),
            }),
        Circle: (props: any) =>
            h("div", {
                "data-circle": JSON.stringify({
                    center: props.center,
                    radius: props.radius,
                }),
            }),
        Polyline: (props: any) =>
            h("div", {
                "data-polyline": JSON.stringify(props.positions),
            }),
    };
});

// ── Umgebung der Komponente, die fuer diesen Test nichts beitraegt ────────────

vi.mock("@/components/ui/dialog", async () => {
    const { Fragment: F, createElement: h } = await import("react");
    return {
        Dialog: (props: any) => h(F, null, props.children),
        DialogContent: () => null,
    };
});

vi.mock("../QuestionCards", () => ({
    RadiusQuestionComponent: () => null,
    TentacleQuestionComponent: () => null,
    ThermometerQuestionComponent: () => null,
    MatchingQuestionComponent: () => null,
    MeasuringQuestionComponent: () => null,
}));

vi.mock("../LatLngPicker", () => ({ LatitudeLongitude: () => null }));
vi.mock("../ui/button", () => ({ Button: () => null }));
vi.mock("../ui/sidebar-l", () => ({ SidebarMenu: () => null }));

const { DraggableMarkers } = await import("../DraggableMarkers");

// ── Faelle ────────────────────────────────────────────────────────────────────

const LAT = 52.5;
const LNG = 13.4;

type Fall = {
    type: string;
    data: Record<string, number>;
    marker: number;
    kreise: number;
    linien: number;
    /** Erwarteter Kreisradius in Metern, falls der Typ einen Kreis hat. */
    radiusM?: number;
};

const FAELLE: Fall[] = [
    {
        type: "radius",
        data: { lat: LAT, lng: LNG, radius: 1, unit: "kilometers" as any },
        marker: 1,
        kreise: 1,
        linien: 0,
        radiusM: 1000,
    },
    {
        type: "tentacles",
        data: { lat: LAT, lng: LNG, radius: 3, unit: "kilometers" as any },
        marker: 1,
        kreise: 1,
        linien: 0,
        radiusM: 3000,
    },
    {
        type: "thermometer",
        data: { latA: LAT, lngA: LNG, latB: 52.6, lngB: 13.5 },
        marker: 2,
        kreise: 0,
        linien: 2,
    },
    {
        type: "matching",
        data: { lat: LAT, lng: LNG },
        marker: 1,
        kreise: 0,
        linien: 0,
    },
    {
        type: "measuring",
        data: { lat: LAT, lng: LNG },
        marker: 1,
        kreise: 0,
        linien: 0,
    },
];

const ROLLEN = ["seeker", "hider"] as const;
const STATUS = ["pending", "expired"] as const;

function zeichne(rolle: string, status: string, fall: Fall) {
    stores.sessionParticipant.value = { id: "p1", role: rolle };
    stores.sessionQuestions.value = [
        {
            id: "q1",
            type: fall.type,
            status,
            data: fall.data,
        },
    ];
    const markup = renderToStaticMarkup(createElement(DraggableMarkers));
    return {
        marker: markup.match(/data-marker=/g)?.length ?? 0,
        kreise: markup.match(/data-circle=/g)?.length ?? 0,
        linien: markup.match(/data-polyline=/g)?.length ?? 0,
        markup,
    };
}

beforeEach(() => {
    stores.questions.value = [];
    stores.hiderMode.value = false;
    stores.sessionParticipant.value = null;
    stores.sessionQuestions.value = [];
});

describe("Umrisse offener Fragen auf der Karte", () => {
    for (const rolle of ROLLEN) {
        for (const status of STATUS) {
            for (const fall of FAELLE) {
                it(`${rolle} sieht die Geometrie einer ${status}en ${fall.type}-Frage`, () => {
                    const gezeichnet = zeichne(rolle, status, fall);

                    expect({
                        marker: gezeichnet.marker,
                        kreise: gezeichnet.kreise,
                        linien: gezeichnet.linien,
                    }).toEqual({
                        marker: fall.marker,
                        kreise: fall.kreise,
                        linien: fall.linien,
                    });
                });
            }
        }
    }

    it("zeichnet den Radiuskreis fuer den Seeker an der richtigen Stelle und in Metern", () => {
        const fall = FAELLE[0];
        const { markup } = zeichne("seeker", "pending", fall);

        const treffer = markup.match(/data-circle="([^"]*)"/);
        expect(treffer, "kein Kreis im Markup").not.toBeNull();

        const kreis = JSON.parse(treffer![1].replace(/&quot;/g, '"'));
        expect(kreis.center).toEqual([LAT, LNG]);
        expect(kreis.radius).toBeCloseTo(
            turf.convertLength(1, "kilometers", "meters"),
            6,
        );
    });
});
