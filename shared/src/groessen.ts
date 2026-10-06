/**
 * Groessen: alles, was sich aus der Ausdehnung des Spielgebiets ergibt.
 *
 * Das Gebiet kommt als Bounding-Box aus dem Geocoder, normalisiert auf
 * `[nord, west, sued, ost]` (siehe src/maps/api/geocode.ts). Daraus rechnen wir
 * eine einzige Kennzahl L — die laengere der beiden Kanten in km — und haengen
 * die Distanzstufen der Fragen und die Antwortfristen daran.
 *
 * Liegt die Box nicht vor (`mapLocation` ist in der Datenbank nullable, und
 * `properties.extent` ist beim Geocoder optional), liefert
 * `ausdehnungKmAusExtent` null und alle Aufrufer fallen auf die Werte zurueck,
 * die vor dieser Rechnung fest im Code standen. Ein fehlendes Gebiet soll
 * niemandem Mini-Distanzen bescheren.
 *
 * Diese Datei liegt in shared/, weil das Backend dieselbe Rechnung fuer die
 * Fristen braucht.
 */

const ERDRADIUS_KM = 6371.0088;

function haversineKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
): number {
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * ERDRADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Laengste Kante der Bounding-Box in km.
 *
 * Breite auf mittlerer Breitengrad-Hoehe gemessen, Hoehe entlang des
 * Westrands. Keine Flaeche: gebraucht wird eine Laenge fuer die
 * Distanzstufen, und die Box gibt sie direkt her.
 *
 * @param extent `[nord, west, sued, ost]` in Grad
 * @returns km, oder null wenn kein brauchbares Extent vorliegt
 */
export function ausdehnungKmAusExtent(
    extent: number[] | null | undefined,
): number | null {
    if (!extent || extent.length < 4) return null;
    const [nord, west, sued, ost] = extent;
    if (![nord, west, sued, ost].every((x) => Number.isFinite(x))) return null;

    const mittlereBreite = (nord + sued) / 2;
    const hoeheKm = haversineKm(sued, west, nord, west);
    const breiteKm = haversineKm(mittlereBreite, west, mittlereBreite, ost);

    const laengsteKante = Math.max(hoeheKm, breiteKm);
    return laengsteKante > 0 ? laengsteKante : null;
}

// ── Distanzstufen ─────────────────────────────────────────────────────────────

/**
 * Obergrenze fuer L in der Stufenregel. 80 km war die groesste Stufe, solange
 * die Werte fest im Code standen.
 *
 * Der Deckel ist noetig, weil `mapGeoLocation` vor dem Setzen eines Gebiets auf
 * ganz Deutschland steht (src/lib/context.ts) — rund 865 km laengste Kante.
 * Ohne Deckel stuenden dort Chips im dreistelligen Kilometerbereich.
 */
export const AUSDEHNUNG_DECKEL_KM = 80;

/** Stufen in Metern, solange sie fest im Code standen. Rueckfall ohne Gebiet. */
export const RADIUS_STUFEN_FALLBACK_M = [300, 500, 1000, 3000, 8000, 25000, 80000];
export const THERMOMETER_STUFEN_FALLBACK_M = [1000, 3000, 8000, 25000, 80000];
export const TENTAKEL_STUFEN_FALLBACK_M = [1000, 3000, 8000, 25000];

/** Teiler von L. Verdopplungsreihe, die bei der Gebietsausdehnung endet. */
const RADIUS_TEILER = [16, 8, 4, 2, 1];
const THERMOMETER_TEILER = [8, 4, 2, 1];
const TENTAKEL_TEILER = [8, 4, 2, 1];

/**
 * Auf die naechsten 100 m aufgerundet, mindestens 100 m.
 *
 * Aufrunden statt kaufmaennisch runden, damit die oberste Stufe nie kleiner
 * ausfaellt als das Gebiet selbst: bei L = 1,449 km wuerde kaufmaennisches
 * Runden daraus 1,4 km machen, und ein Radar-Ring kleiner als das Spielgebiet
 * hilft keinem. Einheitliches 100-m-Raster ueber den ganzen Bereich, weil ein
 * 50-m-Raster unterhalb von 1 km L/2 bei L = 1,5 km auf 750 m stehen liesse
 * statt auf den gewuenschten 800 m.
 */
function rundeStufe(meter: number): number {
    return Math.max(100, Math.ceil(meter / 100) * 100);
}

function stufenM(
    ausdehnungKm: number | null | undefined,
    teiler: number[],
    fallback: number[],
): number[] {
    if (ausdehnungKm == null || !Number.isFinite(ausdehnungKm) || ausdehnungKm <= 0) {
        return [...fallback];
    }
    const l = Math.min(ausdehnungKm, AUSDEHNUNG_DECKEL_KM) * 1000;
    const stufen = teiler.map((t) => rundeStufe(l / t));
    // Bei sehr kleinen Gebieten fallen die untersten Stufen aufs selbe Raster.
    return [...new Set(stufen)].sort((a, b) => a - b);
}

/** Zielradius der Radar-Frage, in Metern. */
export function radiusStufenM(ausdehnungKm: number | null | undefined): number[] {
    return stufenM(ausdehnungKm, RADIUS_TEILER, RADIUS_STUFEN_FALLBACK_M);
}

/** Schwellen der Thermometer-Frage, in Metern. */
export function thermometerStufenM(ausdehnungKm: number | null | undefined): number[] {
    return stufenM(ausdehnungKm, THERMOMETER_TEILER, THERMOMETER_STUFEN_FALLBACK_M);
}

/** Suchradius der Tentakel-Frage, in Metern. */
export function tentakelStufenM(ausdehnungKm: number | null | undefined): number[] {
    return stufenM(ausdehnungKm, TENTAKEL_TEILER, TENTAKEL_STUFEN_FALLBACK_M);
}

/**
 * Vorschlag fuer Punkt B im Thermometer-Handbetrieb: ein Viertel der
 * Gebietsausdehnung oestlich von Punkt A. Entsprach bei L = 8 km den fruehen
 * 2 km, die hier fest im Code standen.
 */
export function thermometerPunktBAbstandKm(
    ausdehnungKm: number | null | undefined,
): number {
    if (ausdehnungKm == null || !Number.isFinite(ausdehnungKm) || ausdehnungKm <= 0) {
        return 2;
    }
    return Math.min(ausdehnungKm, AUSDEHNUNG_DECKEL_KM) / 4;
}

// ── Beschriftung ──────────────────────────────────────────────────────────────

export type Einheitensystem = "metrisch" | "imperial";

function kurz(zahl: number): string {
    return (Math.round(zahl * 10) / 10).toString();
}

/**
 * Beschriftung einer Stufe. Die Stufen selbst sind in Metern, die Anzeige
 * haengt an der Einheitenwahl des Spielers.
 */
export function stufenBeschriftung(
    meter: number,
    system: Einheitensystem,
): string {
    if (system === "imperial") {
        const yards = meter / 0.9144;
        if (yards < 1000) return `${Math.round(yards / 10) * 10} yd`;
        return `${kurz(meter / 1609.34)} mi`;
    }
    if (meter < 1000) return `${meter} m`;
    return `${kurz(meter / 1000)} km`;
}

// ── Fristen ───────────────────────────────────────────────────────────────────

const MINUTE_MS = 60 * 1000;

/** Anker der Fristen-Interpolation, in km. */
export const FRIST_ANKER_KLEIN_KM = 1.5;
export const FRIST_ANKER_GROSS_KM = 12;

/**
 * Antwortfristen aus der Gebietsausdehnung. Linear zwischen zwei Ankern,
 * an beiden Enden geklemmt:
 *
 * - Foto: 5 min bei 1,5 km, 15 min bei 12 km
 * - uebrige Fragen: 3 min bei 1,5 km, 5 min bei 12 km
 *
 * Beide teilen denselben geklemmten Mischwert, deshalb eine Rechnung statt
 * zwei. Ohne Gebiet die Werte, die heute in types.ts stehen (5 bzw. 15 min).
 */
export function fristenMs(ausdehnungKm: number | null | undefined): {
    frageMs: number;
    fotoMs: number;
} {
    if (ausdehnungKm == null || !Number.isFinite(ausdehnungKm) || ausdehnungKm <= 0) {
        return { frageMs: 5 * MINUTE_MS, fotoMs: 15 * MINUTE_MS };
    }
    const anteil = Math.min(
        1,
        Math.max(
            0,
            (ausdehnungKm - FRIST_ANKER_KLEIN_KM) /
                (FRIST_ANKER_GROSS_KM - FRIST_ANKER_KLEIN_KM),
        ),
    );
    return {
        frageMs: Math.round((3 + anteil * 2) * MINUTE_MS),
        fotoMs: Math.round((5 + anteil * 10) * MINUTE_MS),
    };
}
