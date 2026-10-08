/**
 * Gespeicherte Fragen muessen auch dann lesbar bleiben, wenn ein Eintrag nicht
 * mehr zum Schema passt.
 *
 * Vorher stand in src/lib/context.ts `questionsSchema.parse(JSON.parse(x))` als
 * `decode` des questions-Atoms. `parse` wirft, und zwar nicht beim Modulladen,
 * sondern beim ersten Lesen des Atoms: `decode` steht in `restore()`, und
 * `restore()` haengt in `onMount` (@nanostores/persistent/index.js:68-73).
 * Ein einziger Eintrag aus einer aelteren Fassung - etwa die nie im Schema
 * angelegte "street"-Frage - legte damit jede Komponente lahm, die `questions`
 * liest.
 *
 * Ein Rueckfall auf [] waere schlimmer als der Wurf: dieses Atom treibt den
 * Zuschnitt der Karte. Eine leere Liste heisst "keine Einschraenkung", und zwar
 * dauerhaft. Deshalb wird jede Frage einzeln geprueft, die lesbaren bleiben,
 * und wenn etwas fehlt, erfaehrt der Spieler es.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    fragenLesen,
    fragenUnvollstaendig,
    verworfeneFragenMelden,
} from "../context";
import { t } from "@/i18n";

/** Eine Frage, die das Schema kennt. Alles ausser lat/lng hat Vorgabewerte. */
function gueltigeFrage(key: number) {
    return { id: "radius", key, data: { lat: 53.55, lng: 10.0 } };
}

/**
 * "Strasse oder Weg" stand im Menue, aber nie im Schema. Genau so sieht eine
 * Frage aus einer Sitzung von damals im localStorage aus.
 */
function kaputteFrage() {
    return {
        id: "matching",
        key: 99,
        data: { type: "street", same: true, seekerStreet: "Hauptstrasse" },
    };
}

describe("fragenLesen", () => {
    beforeEach(() => {
        fragenUnvollstaendig.set(false);
    });

    it("behaelt die lesbaren Fragen und verwirft nur die kaputte", () => {
        const fragen = fragenLesen(
            JSON.stringify([
                gueltigeFrage(1),
                gueltigeFrage(2),
                kaputteFrage(),
                gueltigeFrage(3),
            ]),
        );

        expect(fragen).toHaveLength(3);
        expect(fragen.map((f) => f.key)).toEqual([1, 2, 3]);
        expect(fragenUnvollstaendig.get()).toBe(true);
    });

    it("gibt bei kaputtem JSON eine leere Liste, ohne zu werfen", () => {
        // Abgeschnittener Speicher: der Browser hat beim Schreiben abgebrochen.
        let fragen: unknown;
        expect(() => {
            fragen = fragenLesen('[{"id":"radius","key":1,"da');
        }).not.toThrow();

        expect(fragen).toEqual([]);
        expect(fragenUnvollstaendig.get()).toBe(true);
    });

    it("gibt bei etwas, das keine Liste ist, eine leere Liste, ohne zu werfen", () => {
        // Gueltiges JSON, falsche Gestalt - fremder Inhalt unter demselben
        // Schluessel. `questionsSchema.parse` warf hier genauso.
        let fragen: unknown;
        expect(() => {
            fragen = fragenLesen('{"id":"radius"}');
        }).not.toThrow();

        expect(fragen).toEqual([]);
        expect(fragenUnvollstaendig.get()).toBe(true);
    });

    it("laesst eine vollstaendig gueltige Liste unveraendert und meldet nichts", () => {
        // Die Rettung darf nichts fressen, was gut ist, und nicht grundlos
        // eine Meldung ausloesen.
        const fragen = fragenLesen(
            JSON.stringify([gueltigeFrage(1), gueltigeFrage(2)]),
        );

        expect(fragen).toHaveLength(2);
        expect(fragen[0]).toMatchObject({
            id: "radius",
            key: 1,
            data: { lat: 53.55, lng: 10.0 },
        });
        expect(fragenUnvollstaendig.get()).toBe(false);
    });

    it("gibt bei leerem Speicherinhalt eine leere Liste, ohne zu melden", () => {
        // `JSON.stringify([])` ist der normale Zustand ohne Fragen. Daraus darf
        // keine Meldung werden.
        const fragen = fragenLesen("[]");

        expect(fragen).toEqual([]);
        expect(fragenUnvollstaendig.get()).toBe(false);
    });
});

describe("verworfeneFragenMelden", () => {
    beforeEach(() => {
        fragenUnvollstaendig.set(false);
    });

    it("meldet nichts, wenn alles lesbar war", () => {
        const melden = vi.fn();

        verworfeneFragenMelden(melden);

        expect(melden).not.toHaveBeenCalled();
    });

    it("meldet genau einmal, auch wenn die Karte neu mountet", () => {
        // Der Aufruf steht in einem useEffect von Map.tsx. Mountet die Karte
        // erneut - Wechsel der Ansicht, Vollbild -, laeuft der Effekt wieder.
        // Der Speicher wird aber nur einmal je Sitzung gelesen, also darf die
        // Meldung nicht erneut kommen.
        fragenUnvollstaendig.set(true);
        const melden = vi.fn();

        verworfeneFragenMelden(melden);
        verworfeneFragenMelden(melden);

        expect(melden).toHaveBeenCalledTimes(1);
        expect(fragenUnvollstaendig.get()).toBe(false);
    });
});

describe("Wortlaut der Meldung", () => {
    it("steht in beiden Sprachen und faellt nicht auf Deutsch zurueck", () => {
        // t() faellt bei einem fehlenden Schluessel still auf Deutsch zurueck
        // (src/i18n/index.ts:31-35). Ein nur in de.ts angelegter Schluessel
        // wuerde englischen Spielern also unbemerkt Deutsch zeigen.
        const de = t("toast.map.questionsDropped", "de");
        const en = t("toast.map.questionsDropped", "en");

        expect(de).not.toBe("toast.map.questionsDropped");
        expect(en).not.toBe("toast.map.questionsDropped");
        expect(en).not.toBe(de);
    });

    it("sagt, was der Spieler davon hat, nicht nur dass etwas schiefging", () => {
        // Nicht "Fehler beim Laden der Fragen", sondern: die Karte zeigt
        // gerade nicht alle Einschraenkungen.
        expect(t("toast.map.questionsDropped", "de")).toMatch(
            /nicht alle Einschränkungen/,
        );
        expect(t("toast.map.questionsDropped", "en")).toMatch(
            /not showing every restriction/,
        );
    });
});
