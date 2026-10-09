/**
 * Der Verstecker sucht sein Gebiet im PlacePicker, der es `mapGeoLocation`
 * aber nicht zuweist, sondern an `additionalMapGeoLocations` haengt. Erst
 * "Gebiet bestaetigen" befoerdert es zum Hauptgebiet und nimmt es aus den
 * Zusatzgebieten heraus.
 *
 * Damit aendert sich der Zuschnitt: vorher Deutschland vereinigt mit dem
 * Stadtteil, also Deutschland. Nachher der Stadtteil allein. `mapGeoJSON`
 * haelt zu diesem Zeitpunkt den alten, deutschlandgrossen Umriss - und
 * `refreshQuestions` in Map.tsx liest ihn als Erstes und ueberspringt bei
 * einem Treffer die ganze Beschaffung. Die Karte blieb dann auf Deutschland
 * zugeschnitten, was im Spiel wie "gar nicht eingegrenzt" aussieht.
 *
 * Jede andere Stelle, die den Zuschnitt aendert, raeumt `mapGeoJSON` auf
 * (PlacePicker an acht Stellen, applyServerMapLocation, leaveSession,
 * hiding-zone-loader). Diese war die Ausnahme.
 *
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    additionalMapGeoLocations,
    mapGeoJSON,
    mapGeoLocation,
    polyGeoJSON,
} from "@/lib/context";
import { hiderAreaConfirmed } from "@/lib/session-context";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Zieht Leaflet nicht mit herein; die Suche selbst ist hier nicht die Frage.
vi.mock("@/components/PlacePicker", () => ({ PlacePicker: () => null }));
vi.mock("@/i18n", () => ({ useT: () => (key: string) => key }));

const { HiderAreaSearch } = await import("../session/HiderAreaSearch");

/** Der Vorgabewert aus context.ts, auf den leaveSession zuruecksetzt. */
function deutschland() {
    return {
        geometry: { coordinates: [51.1657, 10.4515], type: "Point" },
        type: "Feature",
        properties: {
            osm_type: "R",
            osm_id: 51477,
            extent: [55.0581, 5.8663, 47.2701, 15.0419],
            name: "Germany",
            type: "country",
        },
    } as any;
}

/** Hamburg-Hamm, OSM-Relation 1455385 - das Gebiet aus Spiel CNNM2F. */
function hamm() {
    return {
        type: "Feature",
        properties: {
            osm_type: "R",
            osm_id: 1455385,
            name: "Hamm",
            extent: [53.5661079, 10.0376053, 53.5377541, 10.0707064],
        },
        geometry: { coordinates: [10.0512944, 53.5534434], type: "Point" },
    } as any;
}

/** Steht fuer den deutschlandgrossen Umriss aus dem Lauf vor der Bestaetigung. */
function alterUmriss() {
    return {
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                properties: {},
                geometry: {
                    type: "Polygon",
                    coordinates: [
                        [
                            [5.8663, 47.2701],
                            [15.0419, 47.2701],
                            [15.0419, 55.0581],
                            [5.8663, 47.2701],
                        ],
                    ],
                },
            },
        ],
    } as any;
}

let container: HTMLDivElement;
let root: Root;

function bestaetigen() {
    const knopf = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "area.confirm",
    );
    if (!knopf) throw new Error("Knopf 'Gebiet bestaetigen' nicht gefunden");
    act(() => {
        knopf.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
}

describe("Gebiet bestaetigen", () => {
    beforeEach(() => {
        // Ausgangslage wie im Spiel: Hauptgebiet noch der Vorgabewert, der
        // gesuchte Stadtteil als Zusatzgebiet, und der Umriss des alten
        // Zuschnitts schon berechnet.
        mapGeoLocation.set(deutschland());
        additionalMapGeoLocations.set([
            { added: true, location: hamm(), base: false } as any,
        ]);
        mapGeoJSON.set(alterUmriss());
        polyGeoJSON.set(null);
        hiderAreaConfirmed.set(false);

        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => {
            root.render(<HiderAreaSearch />);
        });
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it("befoerdert das Zusatzgebiet zum Hauptgebiet", () => {
        bestaetigen();

        expect((mapGeoLocation.get() as any).properties.osm_id).toBe(1455385);
        expect(additionalMapGeoLocations.get()).toEqual([]);
        expect(hiderAreaConfirmed.get()).toBe(true);
    });

    it("verwirft den Umriss des alten Zuschnitts", () => {
        bestaetigen();

        expect(mapGeoJSON.get()).toBeNull();
    });

    it("laesst ein selbst gezeichnetes Vieleck stehen", () => {
        // `polyGeoJSON` heisst "der Nutzer hat ein eigenes Vieleck"; das darf
        // die Bestaetigung nicht wegwerfen, sonst ist das Gebiet verloren.
        polyGeoJSON.set(alterUmriss());

        bestaetigen();

        expect(polyGeoJSON.get()).not.toBeNull();
    });
});
