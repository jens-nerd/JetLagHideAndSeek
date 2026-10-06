import { describe, expect, it } from "vitest";

import {
    ausdehnungKmAusExtent,
    fristenMs,
    radiusStufenM,
    RADIUS_STUFEN_FALLBACK_M,
    stufenBeschriftung,
    tentakelStufenM,
    TENTAKEL_STUFEN_FALLBACK_M,
    thermometerPunktBAbstandKm,
    thermometerStufenM,
    THERMOMETER_STUFEN_FALLBACK_M,
} from "../groessen.js";

/** Stadtteil-Gebiet wie im Spieltest: 1,5 km breit, 1,2 km hoch. */
const STADTTEIL = [53.57, 10.02, 53.5592, 10.0427];

/** Normales Stadtgebiet: knapp 12 km laengste Kante. */
const STADT = [53.61, 9.9, 53.52, 10.08];

/** Startwert von mapGeoLocation in src/lib/context.ts: ganz Deutschland. */
const DEUTSCHLAND = [55.0581, 5.8663, 47.2701, 15.0419];

describe("ausdehnungKmAusExtent", () => {
    it("nimmt die laengere Kante des Stadtteils", () => {
        const l = ausdehnungKmAusExtent(STADTTEIL);
        expect(l).not.toBeNull();
        // Breite 1,5 km schlaegt Hoehe 1,2 km
        expect(l!).toBeCloseTo(1.5, 1);
    });

    it("rechnet ein grosses Stadtgebiet auf knapp 12 km", () => {
        expect(ausdehnungKmAusExtent(STADT)!).toBeCloseTo(11.9, 1);
    });

    it("rechnet den Deutschland-Startwert auf rund 870 km", () => {
        expect(ausdehnungKmAusExtent(DEUTSCHLAND)!).toBeGreaterThan(800);
    });

    it("meldet fehlendes oder unbrauchbares Extent mit null", () => {
        expect(ausdehnungKmAusExtent(undefined)).toBeNull();
        expect(ausdehnungKmAusExtent(null)).toBeNull();
        expect(ausdehnungKmAusExtent([])).toBeNull();
        expect(ausdehnungKmAusExtent([1, 2, 3])).toBeNull();
        expect(ausdehnungKmAusExtent([1, 2, 3, Number.NaN])).toBeNull();
        // Punkt ohne Ausdehnung
        expect(ausdehnungKmAusExtent([53.5, 10, 53.5, 10])).toBeNull();
    });
});

describe("Distanzstufen", () => {
    it("trifft beim Stadtteil die Zielwerte aus dem Spieltest", () => {
        const l = ausdehnungKmAusExtent(STADTTEIL);
        expect(radiusStufenM(l)).toEqual([100, 200, 400, 800, 1500]);
        expect(thermometerStufenM(l)).toEqual([200, 400, 800, 1500]);
    });

    it("bleibt bei einem Stadtgebiet in brauchbaren Groessen", () => {
        const l = ausdehnungKmAusExtent(STADT);
        expect(radiusStufenM(l)).toEqual([800, 1500, 3000, 6000, 11900]);
        expect(thermometerStufenM(l)).toEqual([1500, 3000, 6000, 11900]);
        expect(tentakelStufenM(l)).toEqual([1500, 3000, 6000, 11900]);
    });

    it("deckelt den Deutschland-Startwert bei 80 km", () => {
        const l = ausdehnungKmAusExtent(DEUTSCHLAND);
        expect(radiusStufenM(l)).toEqual([5000, 10000, 20000, 40000, 80000]);
        expect(thermometerStufenM(l)).toEqual([10000, 20000, 40000, 80000]);
    });

    it("faellt ohne Gebiet auf die alten Festwerte zurueck", () => {
        expect(radiusStufenM(null)).toEqual(RADIUS_STUFEN_FALLBACK_M);
        expect(thermometerStufenM(undefined)).toEqual(THERMOMETER_STUFEN_FALLBACK_M);
        expect(tentakelStufenM(null)).toEqual(TENTAKEL_STUFEN_FALLBACK_M);
    });

    it("liefert aufsteigende Stufen ohne Dopplungen, auch bei Winzgebieten", () => {
        const stufen = radiusStufenM(0.4);
        expect(stufen).toEqual([...stufen].sort((a, b) => a - b));
        expect(new Set(stufen).size).toBe(stufen.length);
    });

    it("macht die oberste Stufe nie kleiner als das Gebiet", () => {
        for (const l of [1.449, 1.5, 2.3, 7.7, 11.887, 40]) {
            const stufen = radiusStufenM(l);
            expect(stufen[stufen.length - 1]).toBeGreaterThanOrEqual(l * 1000);
        }
    });
});

describe("thermometerPunktBAbstandKm", () => {
    it("nimmt ein Viertel der Gebietsausdehnung", () => {
        expect(thermometerPunktBAbstandKm(8)).toBe(2);
        expect(thermometerPunktBAbstandKm(1.5)).toBeCloseTo(0.375, 3);
    });

    it("bleibt ohne Gebiet bei den alten 2 km", () => {
        expect(thermometerPunktBAbstandKm(null)).toBe(2);
    });
});

describe("stufenBeschriftung", () => {
    it("schreibt metrisch Meter unter und Kilometer ab 1 km", () => {
        expect(stufenBeschriftung(100, "metrisch")).toBe("100 m");
        expect(stufenBeschriftung(800, "metrisch")).toBe("800 m");
        expect(stufenBeschriftung(1500, "metrisch")).toBe("1.5 km");
        expect(stufenBeschriftung(12000, "metrisch")).toBe("12 km");
    });

    it("schreibt imperial Yards unter und Meilen ab 1000 yd", () => {
        expect(stufenBeschriftung(100, "imperial")).toBe("110 yd");
        expect(stufenBeschriftung(1500, "imperial")).toBe("0.9 mi");
        expect(stufenBeschriftung(80000, "imperial")).toBe("49.7 mi");
    });
});

describe("fristenMs", () => {
    const min = 60 * 1000;

    it("trifft die vier Anker", () => {
        expect(fristenMs(1.5)).toEqual({ frageMs: 3 * min, fotoMs: 5 * min });
        expect(fristenMs(12)).toEqual({ frageMs: 5 * min, fotoMs: 15 * min });
    });

    it("klemmt an beiden Enden", () => {
        expect(fristenMs(0.5)).toEqual({ frageMs: 3 * min, fotoMs: 5 * min });
        expect(fristenMs(900)).toEqual({ frageMs: 5 * min, fotoMs: 15 * min });
    });

    it("interpoliert dazwischen", () => {
        const mitte = fristenMs((1.5 + 12) / 2);
        expect(mitte.frageMs).toBe(4 * min);
        expect(mitte.fotoMs).toBe(10 * min);
    });

    it("bleibt ohne Gebiet bei den Werten aus types.ts", () => {
        expect(fristenMs(null)).toEqual({ frageMs: 5 * min, fotoMs: 15 * min });
    });
});
