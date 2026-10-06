/**
 * Spaet eintreffendes GPS in den fuenf Fragen-Formularen.
 *
 * Hintergrund (05.10.2026, Spieltest): Die Formulare lasen die eigene Position
 * einmalig beim Rendern (`ownGpsPosition.get()`). Haengte die Standortfreigabe,
 * blieb der Sendeknopf auf "Warte auf GPS…" stehen, auch wenn das Signal zehn
 * Sekunden spaeter kam - man musste das Formular schliessen und neu oeffnen.
 *
 * Anders als `gps-fragen.test.tsx` und `distanz-stufen.test.tsx` rendert dieser
 * Test in happy-dom mit laufenden Effekten und echten nanostores-Atoms, denn
 * genau der Uebergang nach dem ersten Rendern ist hier die Frage.
 *
 * Der Selbstabruf der LocationCard (`autoFetchGps`) haengt in diesem Test
 * absichtlich: `getCurrentPosition` ruft nie zurueck. Damit bleibt der
 * `ownGpsPosition`-Store die einzige Quelle, so wie im Fehlerfall im Spiel.
 *
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { atom } from "nanostores";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const defaultUnit = atom<string>("kilometers");
const leafletMapContext = atom<any>(null);
const questions = atom<any[]>([]);
const gebietsausdehnungKm = atom<number | null>(null);
const ownGpsPosition = atom<{ lat: number; lng: number } | null>(null);
const sessionCode = atom<string | null>("ABCDEF");
const sessionParticipant = atom<any>({ role: "seeker", token: "t" });
const gameSize = atom<string | null>("M");
const revealedHidingZone = atom<any>(null);
const pendingDraftKey = atom<number | null>(null);
const thermometerGpsTracking = atom<any>(null);
const pickerOpen = atom(true);
const bottomSheetState = atom("expanded");

const layer: any = {
    addTo: () => layer,
    on: () => layer,
    setLatLng: () => layer,
    setRadius: () => layer,
    setStyle: () => layer,
    remove: () => layer,
};

vi.mock("leaflet", () => ({
    circle: () => layer,
    circleMarker: () => layer,
    marker: () => layer,
    polygon: () => layer,
    polyline: () => layer,
    geoJSON: () => layer,
    divIcon: () => ({}),
}));
vi.mock("react-toastify", () => ({ toast: { error: () => {}, success: () => {} } }));
vi.mock("@/lib/context", () => ({
    defaultUnit,
    leafletMapContext,
    questions,
    gebietsausdehnungKm,
    addQuestion: () => {},
}));
vi.mock("@/lib/session-context", () => ({
    sessionCode,
    sessionParticipant,
    ownGpsPosition,
    gameSize,
    revealedHidingZone,
    pendingDraftKey,
    thermometerGpsTracking,
}));
vi.mock("@/lib/bottom-sheet-state", () => ({ pickerOpen, bottomSheetState }));
vi.mock("@/lib/session-api", () => ({
    addQuestion: async () => {},
    findNearestPoi: async () => null,
}));
vi.mock("@/lib/handle-submit-error", () => ({ handleSubmitError: () => {} }));
vi.mock("@/maps/api/overpass", () => ({
    findAdminBoundary: async () => null,
    findAdminLevelsAt: async () => [],
}));

// Die Formulare werden erst in beforeAll geladen: Ein statischer Import liefe
// vor der Initialisierung der Atoms oben los und stirbt in deren TDZ.
const FORMULARE: [string, string][] = [
    ["Radius", "RadiusConfig"],
    ["Tentakel", "TentaclesConfig"],
    ["Matching", "MatchingConfig"],
    ["Measuring", "MeasuringConfig"],
    ["Thermometer", "ThermometerConfig"],
];

const LADER: Record<string, () => Promise<any>> = {
    RadiusConfig: () => import("../session/picker/RadiusConfig"),
    TentaclesConfig: () => import("../session/picker/TentaclesConfig"),
    MatchingConfig: () => import("../session/picker/MatchingConfig"),
    MeasuringConfig: () => import("../session/picker/MeasuringConfig"),
    ThermometerConfig: () => import("../session/picker/ThermometerConfig"),
};

const komponenten: Record<string, any> = {};

beforeAll(async () => {
    for (const [, modul] of FORMULARE) {
        komponenten[modul] = (await LADER[modul]())[modul];
    }
});

/** Kartenmitte als Platzhalter, derselbe Wert wie in gps-fragen.test.tsx. */
const KARTENMITTE = { lat: 51.1, lng: 10.4 };
/** Das spaet eintreffende GPS-Signal. */
const SPAET = { lat: 53.5511, lng: 9.9937 };

let container: HTMLDivElement;
let root: Root;

function mount(Komponente: any) {
    act(() => {
        root.render(
            <Komponente
                wsStatus="connected"
                onBack={() => {}}
                onSettings={() => {}}
                onClose={() => {}}
            />,
        );
    });
}

/** Der erste Knopf im Fuss, derselbe Griff wie in gps-fragen.test.tsx. */
function hauptknopf() {
    const knopf = [...container.querySelectorAll("button")].find((b) =>
        /starten|senden|absenden|stellen|Warte/i.test(b.textContent ?? ""),
    );
    if (!knopf) throw new Error("Hauptknopf nicht gefunden");
    return { text: knopf.textContent ?? "", gesperrt: (knopf as HTMLButtonElement).disabled };
}

function knopfMitText(muster: RegExp) {
    const knopf = [...container.querySelectorAll("button")].find((b) =>
        muster.test(b.textContent ?? ""),
    );
    if (!knopf) throw new Error(`Knopf ${muster} nicht gefunden`);
    return knopf;
}

function klick(el: Element) {
    act(() => {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
}

/** Setzt die Breite von Hand, so wie der Spieler es im Handbetrieb tut. */
function breiteEingeben(wert: string) {
    klick(knopfMitText(/manuell eingeben/));
    const eingabe = container.querySelector('input[type="number"]') as HTMLInputElement;
    if (!eingabe) throw new Error("Breiten-Eingabe nicht gefunden");
    const setzen = Object.getOwnPropertyDescriptor(
        globalThis.HTMLInputElement.prototype,
        "value",
    )?.set;
    act(() => {
        setzen?.call(eingabe, wert);
        eingabe.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

beforeEach(() => {
    ownGpsPosition.set(null);
    gebietsausdehnungKm.set(null);
    leafletMapContext.set({
        getCenter: () => KARTENMITTE,
        getZoom: () => 14,
        setView: () => {},
        removeLayer: () => {},
        addLayer: () => {},
    });
    Object.defineProperty(globalThis.navigator, "geolocation", {
        configurable: true,
        value: { getCurrentPosition: () => {}, watchPosition: () => 0, clearWatch: () => {} },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

describe("GPS trifft erst nach dem Rendern ein", () => {
    it.each(FORMULARE)("%s hebt die Sperre auf, ohne neu zu oeffnen", (_name, modul) => {
        mount(komponenten[modul]);
        expect(hauptknopf().gesperrt).toBe(true);
        expect(hauptknopf().text).toMatch(/Warte auf GPS/);

        act(() => ownGpsPosition.set(SPAET));

        // Der Knopf traegt wieder seine eigene Beschriftung, die Sperre aus
        // absendeSperre() ist weg. Bei Tentakel und Thermometer bleibt er
        // trotzdem disabled, solange keine Distanz gewaehlt ist - deshalb wird
        // hier die Beschriftung geprueft und nicht das disabled-Attribut.
        expect(hauptknopf().text).not.toMatch(/Warte auf GPS/);
        expect(container.textContent).toContain("53.5511° N, 9.9937° E");
    });
});

describe("Von Hand gesetzte Koordinate", () => {
    it.each(FORMULARE)("%s behaelt sie, wenn GPS spaeter eintrifft", (_name, modul) => {
        mount(komponenten[modul]);
        breiteEingeben("48.1372");
        expect(container.textContent).toContain("48.1372° N, 10.4000° E");
        // Eine Eingabe von Hand reicht fuer das Absenden, GPS ist nicht noetig.
        expect(hauptknopf().text).not.toMatch(/Warte auf GPS/);

        act(() => ownGpsPosition.set(SPAET));

        expect(container.textContent).toContain("48.1372° N, 10.4000° E");
        expect(container.textContent).not.toContain("53.5511° N, 9.9937° E");
    });
});
