/**
 * Herkunft einer Koordinate im Fragen-Formular.
 *
 * Hintergrund (22.09.2026): Die Formulare starteten auf der Kartenmitte und
 * liessen sich absenden, bevor GPS geantwortet hatte. In der Produktion landeten
 * so zwei Radiusfragen mitten in Deutschland. Der Wert allein verraet das nicht,
 * die Kartenmitte ist eine ganz gewoehnliche Koordinate - also zaehlt, woher sie
 * stammt.
 */
import { describe, expect, it } from "vitest";

import { absendeSperre, startStandort } from "../standort-herkunft";

describe("startStandort", () => {
    it("nimmt die eigene GPS-Position, wenn sie bekannt ist", () => {
        const s = startStandort({ lat: 53.5511, lng: 9.9937 }, { lat: 51.1, lng: 10.4 });
        expect(s).toEqual({ lat: 53.5511, lng: 9.9937, herkunft: "gps" });
    });

    it("faellt ohne GPS auf die Kartenmitte zurueck und merkt sich das", () => {
        const s = startStandort(null, { lat: 51.1, lng: 10.4 });
        expect(s).toEqual({ lat: 51.1, lng: 10.4, herkunft: "karte" });
    });

    it("kommt ohne Karte aus", () => {
        const s = startStandort(null, null);
        expect(s.herkunft).toBe("karte");
        expect(typeof s.lat).toBe("number");
        expect(typeof s.lng).toBe("number");
    });
});

describe("absendeSperre", () => {
    it("sperrt, solange die Koordinate von der Karte stammt", () => {
        expect(absendeSperre("karte").gesperrt).toBe(true);
    });

    it("gibt nach einer GPS-Antwort frei", () => {
        expect(absendeSperre("gps").gesperrt).toBe(false);
    });

    it("gibt nach einer Eingabe von Hand frei", () => {
        expect(absendeSperre("eingabe").gesperrt).toBe(false);
    });

    it("sperrt bei zwei Punkten, solange einer von der Karte stammt", () => {
        expect(absendeSperre("eingabe", "karte").gesperrt).toBe(true);
        expect(absendeSperre("karte", "gps").gesperrt).toBe(true);
        expect(absendeSperre("gps", "eingabe").gesperrt).toBe(false);
    });
});
