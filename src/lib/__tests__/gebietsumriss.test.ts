/**
 * Der Gebietsumriss muss einen Neustart der App ueberleben.
 *
 * Hintergrund (Spiel CNNM2F, 05.10.2026): Nach einem Start aus dem Hintergrund
 * war die Karte beim Suchenden nicht eingeschraenkt, die ausgeschlossenen
 * Gebiete kamen erst nach einigen Sekunden. Grund: In der Sitzung steht nur ein
 * Punkt mit Namen und Bounding-Box, nicht der Umriss der OSM-Relation. Den holt
 * der Client ueber Overpass - gemessen 0,27 s bis 3,7 s, und zwei von sieben
 * Versuchen endeten mit HTTP 504. Solange er fehlt, gibt es nichts
 * zuzuschneiden, und die Karte sieht unbeschraenkt aus.
 *
 * `mapGeoJSON` lebt nur im Speicher, also war der Umriss nach jedem Start weg.
 * Jetzt liegt er in `gebietsumrissSpeicher`, zusammen mit der Kennung des
 * Gebiets, zu dem er gehoert.
 *
 * Die Gegenrichtung ist genauso wichtig: Erweitert der Verstecker das Gebiet um
 * einen Stadtteil, DARF der alte Umriss nicht mehr benutzt werden, sonst spielt
 * der Suchende auf einer Karte von vorgestern. Das faellt im Spiel noch spaeter
 * auf als eine unbeschraenkte Karte, deshalb stehen beide Richtungen hier.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";

import {
    additionalMapGeoLocations,
    gebietsumrissSpeicher,
    isLoading,
    mapGeoJSON,
    mapGeoLocation,
    polyGeoJSON,
} from "../context";
import { gebietskennung, umrissAblegen, umrissBesorgen } from "../gebietsumriss";
import { applyServerMapLocation } from "../session-context";
import { t } from "@/i18n";

/**
 * Die echte Gebietsangabe aus CNNM2F, wie sie in `sessions.map_location`
 * steht: Hamburg-Hamm, OSM-Relation 1455385. Die `geometry` ist ein Point,
 * der Umriss der Relation steht nicht darin.
 */
function hammGebiet() {
    return {
        lat: 10.0512944,
        lng: 53.5534434,
        name: "Hamm",
        osmFeature: {
            type: "Feature",
            properties: {
                osm_type: "R",
                osm_id: 1455385,
                osm_key: "place",
                osm_value: "suburb",
                type: "district",
                name: "Hamm",
                city: "Hamburg",
                country: "Deutschland",
                countrycode: "DE",
                extra: { admin_level: "10" },
                extent: [53.5661079, 10.0376053, 53.5377541, 10.0707064],
            },
            geometry: {
                type: "Point",
                coordinates: [53.5534434, 10.0512944],
            },
        },
    } as any;
}

/** Ein zweiter Stadtteil, den der Verstecker dem Gebiet hinzufuegen kann. */
function hornFeature() {
    return {
        type: "Feature",
        properties: {
            osm_type: "R",
            osm_id: 1455386,
            name: "Horn",
            extent: [53.56, 10.07, 53.54, 10.11],
        },
        geometry: { type: "Point", coordinates: [53.55, 10.09] },
    } as any;
}

/** Der ueber Overpass geholte Umriss - der Wert, um den es geht. */
function umriss(): FeatureCollection<Polygon | MultiPolygon> {
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
                            [10.0376, 53.5377],
                            [10.0707, 53.5661],
                            [10.0376, 53.5661],
                            [10.0376, 53.5377],
                        ],
                    ],
                },
            },
        ],
    };
}

/**
 * Die Entscheidung, die Map.tsx trifft: Passt der gespeicherte Umriss zum
 * Gebiet, das gerade gilt? Nur dann wird er benutzt, statt neu zu holen.
 */
function umrissVerwendbar(): boolean {
    const kennung = gebietskennung(
        mapGeoLocation.get(),
        additionalMapGeoLocations.get(),
    );
    const gespeichert = gebietsumrissSpeicher.get();
    return kennung !== null && gespeichert?.kennung === kennung;
}

describe("gebietskennung", () => {
    it("beschreibt das Hauptgebiet ueber Typ und OSM-Kennung", () => {
        expect(gebietskennung(hammGebiet().osmFeature, [])).toBe("R/1455385");
    });

    it("nimmt Zusatzgebiete mit auf", () => {
        const k = gebietskennung(hammGebiet().osmFeature, [
            { location: hornFeature(), added: true },
        ]);
        expect(k).toBe("R/1455385+R/1455386:1");
    });

    it("unterscheidet ein hinzugefuegtes von einem abgezogenen Zusatzgebiet", () => {
        const dazu = gebietskennung(hammGebiet().osmFeature, [
            { location: hornFeature(), added: true },
        ]);
        const abgezogen = gebietskennung(hammGebiet().osmFeature, [
            { location: hornFeature(), added: false },
        ]);
        expect(dazu).not.toBe(abgezogen);
    });

    it("unterscheidet ein Gebiet mit Zusatz von einem ohne", () => {
        expect(gebietskennung(hammGebiet().osmFeature, [])).not.toBe(
            gebietskennung(hammGebiet().osmFeature, [
                { location: hornFeature(), added: true },
            ]),
        );
    });

    it("liefert null, wenn das Hauptgebiet keine OSM-Kennung hat", () => {
        expect(gebietskennung({ properties: { name: "Irgendwo" } }, [])).toBeNull();
        expect(gebietskennung(null, [])).toBeNull();
    });
});

describe("umrissAblegen", () => {
    const HAMM = "R/1455385";
    const HAMM_MIT_HORN = "R/1455385+R/1455386:1";

    it("legt ab, wenn die Kennung nach dem Abruf noch passt", () => {
        const ablegen = vi.fn();

        const stand = umrissAblegen({
            kennungVorher: HAMM,
            kennungJetzt: () => HAMM,
            umriss: umriss(),
            ablegen,
        });

        expect(stand).toBe("abgelegt");
        expect(ablegen).toHaveBeenCalledWith({
            kennung: HAMM,
            umriss: umriss(),
        });
    });

    it("verwirft, wenn waehrend des Abrufs ein Zusatzgebiet hinzukam", () => {
        // Der gefaehrlichste Fall des ganzen Umbaus. Der Abruf dauert
        // Sekunden; kommt in dieser Zeit ein Stadtteil dazu, gehoert der
        // gelieferte Umriss zum erweiterten Gebiet, die vorher berechnete
        // Kennung aber zum alten. Abgelegt wuerde er beim naechsten Start als
        // gueltig gelten: Die Karte waere dann nicht unbeschraenkt, sondern
        // falsch beschraenkt - und das faellt im Spiel am spaetesten auf.
        const ablegen = vi.fn();

        const stand = umrissAblegen({
            kennungVorher: HAMM,
            kennungJetzt: () => HAMM_MIT_HORN,
            umriss: umriss(),
            ablegen,
        });

        expect(stand).toBe("verworfen");
        expect(ablegen).not.toHaveBeenCalled();
    });

    it("verwirft, wenn waehrend des Abrufs ein Zusatzgebiet wegfiel", () => {
        const ablegen = vi.fn();

        const stand = umrissAblegen({
            kennungVorher: HAMM_MIT_HORN,
            kennungJetzt: () => HAMM,
            umriss: umriss(),
            ablegen,
        });

        expect(stand).toBe("verworfen");
        expect(ablegen).not.toHaveBeenCalled();
    });

    it("verwirft ohne Kennung", () => {
        const ablegen = vi.fn();

        const stand = umrissAblegen({
            kennungVorher: null,
            kennungJetzt: () => null,
            umriss: umriss(),
            ablegen,
        });

        expect(stand).toBe("verworfen");
        expect(ablegen).not.toHaveBeenCalled();
    });

    it("erhebt die Kennung wirklich neu, statt die alte zu glauben", () => {
        // Ein Wert statt einer Funktion waere vom Aufrufer vor dem Abruf
        // berechnet worden und wuerde genau den Fall verschweigen, um den es
        // geht. Also muss die Funktion auch aufgerufen werden.
        const kennungJetzt = vi.fn().mockReturnValue(HAMM);

        umrissAblegen({
            kennungVorher: HAMM,
            kennungJetzt,
            umriss: umriss(),
            ablegen: vi.fn(),
        });

        expect(kennungJetzt).toHaveBeenCalledTimes(1);
    });

    it("faengt einen vollen Speicher ab, statt zu werfen", () => {
        // Der Aufruf steht in Map.tsx vor dem try-Block von refreshQuestions.
        // Ein Wurf wuerde `isLoading` auf true stehen lassen, und die Karte
        // wuerde sich fuer den Rest der Sitzung nicht mehr erneuern - also
        // schlimmer als der Mangel, den der Speicher behebt.
        const ablegen = vi.fn().mockImplementation(() => {
            throw new DOMException("quota", "QuotaExceededError");
        });

        let stand: string | undefined;
        expect(() => {
            stand = umrissAblegen({
                kennungVorher: HAMM,
                kennungJetzt: () => HAMM,
                umriss: umriss(),
                ablegen,
            });
        }).not.toThrow();
        expect(stand).toBe("gescheitert");
    });
});

describe("Meldung an den Spieler", () => {
    it("steht in beiden Sprachen und faellt nicht auf Deutsch zurueck", () => {
        // t() faellt bei einem fehlenden Schluessel still auf Deutsch zurueck
        // (src/i18n/index.ts:31-35). Ein nur in de.ts angelegter Schluessel
        // wuerde englischen Spielern also unbemerkt Deutsch zeigen.
        const de = t("toast.map.boundaryMissing", "de");
        const en = t("toast.map.boundaryMissing", "en");

        expect(de).not.toBe("toast.map.boundaryMissing");
        expect(en).not.toBe("toast.map.boundaryMissing");
        expect(en).not.toBe(de);
    });

    it("sagt, was der Spieler davon hat, nicht nur dass etwas schiefging", () => {
        // Vorgabe aus dem Auftrag: nicht "Fehler beim Laden der Kartendaten",
        // sondern der Hinweis, dass die Karte gerade mehr zeigt als erlaubt.
        expect(t("toast.map.boundaryMissing", "de")).toMatch(/mehr Fläche/);
        expect(t("toast.map.boundaryMissing", "en")).toMatch(/more ground/);
    });
});

describe("Gebietsumriss ueber den Neustart", () => {
    beforeEach(() => {
        // Ausgangslage wie unmittelbar nach einem erfolgreichen Umriss-Abruf:
        // Gebiet gesetzt, Umriss abgelegt, keine Zusatzgebiete.
        mapGeoLocation.set(hammGebiet().osmFeature);
        additionalMapGeoLocations.set([]);
        polyGeoJSON.set(null);
        mapGeoJSON.set(umriss());
        isLoading.set(false);
        gebietsumrissSpeicher.set({
            kennung: gebietskennung(hammGebiet().osmFeature, [])!,
            umriss: umriss(),
        });
    });

    it("behaelt den Umriss, wenn dieselbe Gebietsangabe erneut eintrifft", () => {
        // Genau das passiert bei jedem Start: einmal ueber getSession (REST),
        // einmal ueber die WebSocket-sync. Beide Male dasselbe Gebiet. Vorher
        // musste der Umriss danach neu ueber das Netz geholt werden.
        applyServerMapLocation(hammGebiet());

        expect(umrissVerwendbar()).toBe(true);
        expect(gebietsumrissSpeicher.get()?.umriss).toEqual(umriss());
    });

    it("verwirft den Umriss, wenn sich das Hauptgebiet aendert", () => {
        const anderes = hammGebiet();
        anderes.osmFeature.properties.osm_id = 1455999;
        anderes.osmFeature.properties.name = "Hammerbrook";

        applyServerMapLocation(anderes);

        expect(umrissVerwendbar()).toBe(false);
    });

    it("verwirft den Umriss, wenn der Verstecker ein Zusatzgebiet hinzufuegt", () => {
        const erweitert = hammGebiet();
        erweitert.additionalOsmFeatures = [
            { location: hornFeature(), added: true },
        ];

        applyServerMapLocation(erweitert);

        expect(umrissVerwendbar()).toBe(false);
    });

    it("verwirft den Umriss, wenn ein Zusatzgebiet wegfaellt", () => {
        additionalMapGeoLocations.set([
            { added: true, location: hornFeature(), base: false } as any,
        ]);
        gebietsumrissSpeicher.set({
            kennung: gebietskennung(hammGebiet().osmFeature, [
                { location: hornFeature(), added: true },
            ])!,
            umriss: umriss(),
        });

        // Dieselbe Angabe wie oben, aber ohne das Zusatzgebiet.
        applyServerMapLocation(hammGebiet());

        expect(umrissVerwendbar()).toBe(false);
    });

    it("verwirft den Umriss, wenn ein Zusatzgebiet abgewaehlt wird", () => {
        gebietsumrissSpeicher.set({
            kennung: gebietskennung(hammGebiet().osmFeature, [
                { location: hornFeature(), added: true },
            ])!,
            umriss: umriss(),
        });

        const abgewaehlt = hammGebiet();
        abgewaehlt.additionalOsmFeatures = [
            { location: hornFeature(), added: false },
        ];

        applyServerMapLocation(abgewaehlt);

        expect(umrissVerwendbar()).toBe(false);
    });

    it("verwirft weiterhin ein selbst gezeichnetes Vieleck", () => {
        // Absichtlich unveraendert: `polyGeoJSON` heisst "der Nutzer hat ein
        // eigenes Vieleck" und schaltet im PlacePicker die Gebietsauswahl ab.
        // Eine Gebietsangabe vom Server loest das ab. Darum liegt der
        // zwischengespeicherte Umriss in einem eigenen Atom und nicht hier.
        polyGeoJSON.set(umriss());

        applyServerMapLocation(hammGebiet());

        expect(polyGeoJSON.get()).toBeNull();
    });
});

describe("umrissBesorgen", () => {
    const immerGueltig = () => true;
    const sofort = () => Promise.resolve();

    it("gibt den Umriss beim ersten Versuch zurueck", async () => {
        const holen = vi.fn().mockResolvedValue(umriss());

        const e = await umrissBesorgen({
            holen,
            nochGueltig: immerGueltig,
            warten: sofort,
        });

        expect(e).toEqual({ ok: true, umriss: umriss() });
        expect(holen).toHaveBeenCalledTimes(1);
    });

    it("wiederholt nach einem Fehlschlag und nimmt den spaeteren Erfolg", async () => {
        // Genau der gemessene Fall: HTTP 504, und der naechste Versuch
        // antwortet in 0,27 s.
        const holen = vi
            .fn()
            .mockRejectedValueOnce(new Error("HTTP 504"))
            .mockResolvedValue(umriss());
        const warten = vi.fn().mockResolvedValue(undefined);

        const e = await umrissBesorgen({
            holen,
            nochGueltig: immerGueltig,
            warten,
        });

        expect(e.ok).toBe(true);
        expect(holen).toHaveBeenCalledTimes(2);
        expect(warten).toHaveBeenCalledWith(1000);
    });

    it("meldet einen Fehler, wenn alle Versuche scheitern", async () => {
        const holen = vi.fn().mockRejectedValue(new Error("HTTP 504"));

        const e = await umrissBesorgen({
            holen,
            nochGueltig: immerGueltig,
            warten: sofort,
        });

        expect(e).toMatchObject({ ok: false, grund: "fehler", versuche: 3 });
        expect(holen).toHaveBeenCalledTimes(3);
    });

    it("steigt mit den Rueckstellungen", async () => {
        const holen = vi.fn().mockRejectedValue(new Error("HTTP 504"));
        const warten = vi.fn().mockResolvedValue(undefined);

        await umrissBesorgen({ holen, nochGueltig: immerGueltig, warten });

        expect(warten.mock.calls.map((c) => c[0])).toEqual([1000, 3000]);
    });

    it("bricht ohne Fehlermeldung ab, wenn das Gebiet gewechselt hat", async () => {
        // Kein Fehler, sondern ein ueberholtes Ergebnis: Map.tsx soll dafuer
        // keine Meldung zeigen, sondern den Lauf fuer das neue Gebiet abwarten.
        const holen = vi.fn().mockResolvedValue(umriss());

        const e = await umrissBesorgen({
            holen,
            nochGueltig: () => false,
            warten: sofort,
        });

        expect(e).toEqual({ ok: false, grund: "veraltet" });
        expect(holen).not.toHaveBeenCalled();
    });

    it("fasst gleichzeitige Abrufe fuer dasselbe Gebiet zusammen", async () => {
        // Beim Start der App laufen bis zu drei refreshQuestions-Durchgaenge
        // ueberlappend. Ohne Zusammenfassung ginge dieselbe Abfrage dreimal
        // raus, mit der Wiederholung im schlechtesten Fall neunmal.
        let fertig: (w: unknown) => void = () => {};
        const holen = vi.fn().mockImplementation(
            () => new Promise((r) => { fertig = r; }),
        );

        const laeufe = [
            umrissBesorgen({ holen, nochGueltig: immerGueltig, warten: sofort, schluessel: "R/1455385" }),
            umrissBesorgen({ holen, nochGueltig: immerGueltig, warten: sofort, schluessel: "R/1455385" }),
            umrissBesorgen({ holen, nochGueltig: immerGueltig, warten: sofort, schluessel: "R/1455385" }),
        ];
        await Promise.resolve();
        fertig(umriss());
        const ergebnisse = await Promise.all(laeufe);

        expect(holen).toHaveBeenCalledTimes(1);
        for (const e of ergebnisse) expect(e).toEqual({ ok: true, umriss: umriss() });
    });

    it("trennt Abrufe fuer verschiedene Gebiete", async () => {
        const holen = vi.fn().mockResolvedValue(umriss());

        await Promise.all([
            umrissBesorgen({ holen, nochGueltig: immerGueltig, warten: sofort, schluessel: "R/1455385" }),
            umrissBesorgen({ holen, nochGueltig: immerGueltig, warten: sofort, schluessel: "R/1455386" }),
        ]);

        expect(holen).toHaveBeenCalledTimes(2);
    });

    it("fragt beim Wiederholversuch wirklich neu an", async () => {
        // Der zusammengefasste Abruf muss nach dem Scheitern aus der Liste
        // verschwinden, sonst wuerde die Wiederholung denselben Fehlschlag
        // erneut abwarten statt neu anzufragen.
        const holen = vi
            .fn()
            .mockRejectedValueOnce(new Error("HTTP 504"))
            .mockResolvedValue(umriss());

        const e = await umrissBesorgen({
            holen,
            nochGueltig: immerGueltig,
            warten: sofort,
            schluessel: "R/1455385",
        });

        expect(e.ok).toBe(true);
        expect(holen).toHaveBeenCalledTimes(2);
    });

    it("verwirft ein Ergebnis, das waehrend des Abrufs ueberholt wurde", async () => {
        let gueltig = true;
        const holen = vi.fn().mockImplementation(async () => {
            gueltig = false;
            return umriss();
        });

        const e = await umrissBesorgen({
            holen,
            nochGueltig: () => gueltig,
            warten: sofort,
        });

        expect(e).toEqual({ ok: false, grund: "veraltet" });
    });
});
