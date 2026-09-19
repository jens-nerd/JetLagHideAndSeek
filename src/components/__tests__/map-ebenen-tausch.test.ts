/**
 * Prüft, dass die Kartenebenen erst getauscht werden, wenn der Aufbau
 * durchgelaufen ist – und dass ein gescheiterter Aufbau die alten Ebenen
 * stehen lässt, statt eine leere Karte zu hinterlassen.
 *
 * Die Tauschlogik liegt als reine Funktion in einer eigenen Datei, damit der
 * Test sie ohne Leaflet und DOM laden kann.
 */
import { describe, expect, it } from "vitest";

import { ebenenTauschen, istEigeneEbene } from "../map-ebenen-tausch";

/** Minimale Karten-Attrappe: nur eachLayer, removeLayer, addLayer. */
function karteMit(ebenen: any[]) {
    const drauf = [...ebenen];
    return {
        drauf,
        eachLayer(fn: (layer: any) => void) {
            [...drauf].forEach(fn);
        },
        removeLayer(layer: any) {
            const i = drauf.indexOf(layer);
            if (i !== -1) drauf.splice(i, 1);
        },
        addLayer(layer: any) {
            drauf.push(layer);
        },
    };
}

const kachel = { name: "kachel" };
const frageAlt = { name: "frage-alt", questionKey: "abc" };
const maskeAlt = { name: "maske-alt", eliminationGeoJSON: true };

describe("istEigeneEbene", () => {
    it("erkennt Frage- und Maskenebenen", () => {
        expect(istEigeneEbene(frageAlt)).toBe(true);
        expect(istEigeneEbene(maskeAlt)).toBe(true);
        expect(istEigeneEbene({ questionKey: 0 })).toBe(true);
    });

    it("lässt fremde Ebenen aus", () => {
        expect(istEigeneEbene(kachel)).toBe(false);
        expect(istEigeneEbene({ hidingZoneActive: true })).toBe(false);
        expect(istEigeneEbene(undefined)).toBe(false);
    });
});

describe("ebenenTauschen", () => {
    it("ersetzt die alten Ebenen, wenn der Aufbau gelingt", async () => {
        const karte = karteMit([kachel, frageAlt, maskeAlt]);
        const frageNeu = { name: "frage-neu", questionKey: "abc" };
        const maskeNeu = { name: "maske-neu", eliminationGeoJSON: true };

        const daten = await ebenenTauschen(karte, async () => ({
            ebenen: [frageNeu, maskeNeu],
            daten: "geodaten",
        }));

        expect(daten).toBe("geodaten");
        expect(karte.drauf).toEqual([kachel, frageNeu, maskeNeu]);
    });

    it("lässt die alten Ebenen stehen, wenn der Aufbau wirft", async () => {
        const karte = karteMit([kachel, frageAlt, maskeAlt]);

        await expect(
            ebenenTauschen(karte, async () => {
                throw new Error("Overpass abgewiesen");
            }),
        ).rejects.toThrow("Overpass abgewiesen");

        expect(karte.drauf).toEqual([kachel, frageAlt, maskeAlt]);
    });

    it("entfernt nie fremde Ebenen", async () => {
        const marker = { name: "marker" };
        const zone = { name: "zone", hidingZoneActive: true };
        const karte = karteMit([kachel, marker, zone, frageAlt]);

        await ebenenTauschen(karte, async () => ({ ebenen: [], daten: null }));

        expect(karte.drauf).toEqual([kachel, marker, zone]);
    });
});
