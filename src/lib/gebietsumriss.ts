/**
 * Gebietsumriss: Kennung und Abruf.
 *
 * Der Umriss des Spielgebiets steht nicht in der Sitzung - dort liegen nur ein
 * Punkt, ein Name und eine Bounding-Box. Den Umriss der OSM-Relation holt der
 * Client ueber Overpass. Gemessen am 07.10.2026, siebenmal dieselbe Abfrage
 * fuer Hamburg-Hamm: 0,27 s bis 3,7 s, und zwei von sieben Versuchen endeten
 * mit HTTP 504. Ohne Umriss gibt es nichts zuzuschneiden, die Karte sieht dann
 * unbeschraenkt aus.
 *
 * Darum zwei Dinge hier, beide ohne Stores und ohne Leaflet, damit sie
 * einzeln pruefbar bleiben:
 *
 *  - `gebietskennung` beschreibt, aus welchen OSM-Objekten ein Umriss gebaut
 *    wurde. Der Zwischenspeicher legt sie neben den Umriss. Aendert sich das
 *    Gebiet, passt die Kennung nicht mehr, und der alte Umriss wird nicht
 *    benutzt. Veralten kann er deshalb nicht.
 *  - `umrissBesorgen` wiederholt einen gescheiterten Abruf, statt den Fehler
 *    zu verschlucken.
 */

/** Ein Zusatzgebiet, wie es in `additionalMapGeoLocations` steht. */
export interface Gebietsteil {
    location: unknown;
    added?: boolean;
}

function osmTeil(feature: unknown): string | null {
    const props = (feature as any)?.properties;
    const id = props?.osm_id;
    const typ = props?.osm_type;
    if (id === undefined || id === null || !typ) return null;
    return `${typ}/${id}`;
}

/**
 * Kennung des Gebiets, aus dem `determineMapBoundaries()` den Umriss baut:
 * das Hauptgebiet plus jedes Zusatzgebiet mit seinem Zustand. `added` gehoert
 * dazu, weil ein abgewaehltes Zusatzgebiet nicht vereinigt, sondern
 * abgezogen wird - derselbe Satz Gebiete ergibt je nach Zustand einen anderen
 * Umriss.
 *
 * Die Reihenfolge der Zusatzgebiete bleibt erhalten. Wird sie vertauscht,
 * passt die Kennung nicht mehr und der Umriss wird einmal neu geholt. Das ist
 * eine Abfrage zu viel, nie eine falsche Karte.
 *
 * @returns `null`, wenn das Hauptgebiet keine OSM-Kennung hat. Dann laesst
 *          sich nichts zwischenspeichern, und `null` passt auf keine
 *          gespeicherte Kennung.
 */
export function gebietskennung(
    haupt: unknown,
    zusatz: readonly Gebietsteil[] = [],
): string | null {
    const basis = osmTeil(haupt);
    if (basis === null) return null;

    const teile = zusatz.map((z) => {
        const teil = osmTeil(z.location);
        return `${teil ?? "?"}:${z.added === false ? 0 : 1}`;
    });

    return [basis, ...teile].join("+");
}

/**
 * Rueckstellungen zwischen den Versuchen. Drei Versuche insgesamt.
 *
 * Bewusst knapp gehalten: der Stellvertreter im Backend probiert pro Anfrage
 * schon drei Overpass-Endpunkte und wiederholt bei 429/503/504 einmal. Ein
 * Fehlschlag beim Client heisst also, dass dort bereits alles durch war. Mehr
 * als drei Versuche wuerden den Spieler nur laenger im Unklaren lassen, und
 * der naechste Auslöser (WebSocket-sync, beantwortete Frage) startet ohnehin
 * einen neuen Lauf.
 */
export const UMRISS_RUECKSTELLUNGEN_MS = [1000, 3000] as const;

/**
 * Laufende Abrufe, nach Gebietskennung.
 *
 * Beim Start der App laeuft `refreshQuestions` mehrfach an: einmal beim
 * Einhaengen der Karte, einmal auf die Gebietsangabe aus der REST-Abfrage,
 * einmal auf die aus der WebSocket-sync. Die Sperre dagegen (`isLoading`) wird
 * von `applyServerMapLocation` bedingungslos geoeffnet, also koennen die Laeufe
 * sich ueberlappen. Ohne diese Zusammenfassung wuerde jeder von ihnen eigene
 * Versuche an Overpass schicken - mit der Wiederholung unten im schlechtesten
 * Fall neunmal dieselbe Abfrage. Overpass antwortet auf zu viele Anfragen mit
 * 429, das waere also gegen uns selbst gerichtet.
 */
const laufendeAbrufe = new Map<string, Promise<unknown>>();

function gemeinsamHolen<T>(
    schluessel: string | null,
    holen: () => Promise<T>,
): Promise<T> {
    if (schluessel === null) return holen();

    const laufend = laufendeAbrufe.get(schluessel) as Promise<T> | undefined;
    if (laufend) return laufend;

    const abruf = holen();
    laufendeAbrufe.set(schluessel, abruf);
    // Nach dem Abschluss raus, damit ein Wiederholversuch wirklich neu anfragt.
    // `void` statt `return`: der Aufrufer soll `abruf` selbst bekommen, nicht
    // die Kette danach, sonst haengt die Aufraeumung in seinem Fehlerpfad.
    void abruf.then(
        () => laufendeAbrufe.delete(schluessel),
        () => laufendeAbrufe.delete(schluessel),
    );
    return abruf;
}

export type UmrissErgebnis<T> =
    | { ok: true; umriss: T }
    /** Das Gebiet hat sich waehrend des Abrufs geaendert, das Ergebnis passt nicht mehr. */
    | { ok: false; grund: "veraltet" }
    | { ok: false; grund: "fehler"; fehler: unknown; versuche: number };

/**
 * Holt den Umriss und wiederholt bei einem Fehler mit Rueckstellung.
 *
 * Bricht sofort ab, wenn `nochGueltig()` falsch wird - dann hat der Spieler
 * ein anderes Gebiet, und ein Ergebnis fuer das alte waere schlimmer als
 * keines. Dieser Fall ist ausdruecklich kein Fehler: der Aufrufer soll dafuer
 * keine Meldung zeigen, sondern den Lauf fuer das neue Gebiet abwarten.
 */
export async function umrissBesorgen<T>({
    holen,
    nochGueltig,
    warten,
    schluessel = null,
    rueckstellungen = UMRISS_RUECKSTELLUNGEN_MS,
}: {
    holen: () => Promise<T>;
    nochGueltig: () => boolean;
    warten: (ms: number) => Promise<void>;
    /**
     * Gebietskennung. Mehrere gleichzeitige Aufrufe mit derselben Kennung
     * teilen sich einen Abruf. `null` schaltet das ab.
     */
    schluessel?: string | null;
    rueckstellungen?: readonly number[];
}): Promise<UmrissErgebnis<T>> {
    let letzterFehler: unknown;

    for (let versuch = 0; versuch <= rueckstellungen.length; versuch++) {
        if (versuch > 0) await warten(rueckstellungen[versuch - 1]);
        if (!nochGueltig()) return { ok: false, grund: "veraltet" };

        try {
            const umriss = await gemeinsamHolen(schluessel, holen);
            if (!nochGueltig()) return { ok: false, grund: "veraltet" };
            return { ok: true, umriss };
        } catch (fehler) {
            letzterFehler = fehler;
        }
    }

    return {
        ok: false,
        grund: "fehler",
        fehler: letzterFehler,
        versuche: rueckstellungen.length + 1,
    };
}
