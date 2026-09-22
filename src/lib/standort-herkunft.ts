/**
 * Woher die Koordinate in einem Fragen-Formular stammt.
 *
 * Die Formulare starten auf der Kartenmitte, weil ein Formular ohne Zahl
 * schlecht aussieht. Nur ist die Kartenmitte keine Antwort auf "wo bist du":
 * Am 22.09.2026 gingen zwei Radiusfragen mit ihr raus, waehrend der Spieler in
 * Hamburg stand. Am Wert selbst ist das nicht zu erkennen, also fuehrt jedes
 * Formular mit, woher seine Koordinate kommt.
 */

/** "karte" = Vorgabe aus dem Kartenausschnitt, also noch keine echte Angabe. */
export type Herkunft = "karte" | "gps" | "eingabe";

export interface Standort {
    lat: number;
    lng: number;
    herkunft: Herkunft;
}

/** Geografische Mitte Deutschlands - nur, damit ueberhaupt eine Zahl dasteht. */
const NOTNAGEL = { lat: 51.1, lng: 10.4 };

/**
 * Startwert eines Formulars: die eigene Position, sonst die Kartenmitte.
 *
 * @param gps    Position aus dem laufenden GPS-Empfang (`ownGpsPosition`), die
 *               dieselbe ist, die der "Ich"-Punkt auf der Karte zeigt.
 * @param mitte  Mitte des Kartenausschnitts, falls es eine Karte gibt.
 */
export function startStandort(
    gps: { lat: number; lng: number } | null | undefined,
    mitte: { lat: number; lng: number } | null | undefined,
): Standort {
    if (gps) return { lat: gps.lat, lng: gps.lng, herkunft: "gps" };
    const m = mitte ?? NOTNAGEL;
    return { lat: m.lat, lng: m.lng, herkunft: "karte" };
}

/**
 * Darf die Frage raus? Nur, wenn jede beteiligte Koordinate aus GPS oder aus
 * einer Eingabe stammt. Beim Thermometer sind es zwei, und dann zaehlt auch,
 * welcher fehlt: Beim eigenen Standort hilft Warten auf GPS, beim zweiten
 * Punkt nicht - den muss man setzen.
 *
 * `fehlt` ist der Platz des ersten Punktes ohne Angabe, sonst null.
 */
export function absendeSperre(
    ...herkuenfte: Herkunft[]
): { gesperrt: boolean; fehlt: number | null } {
    const fehlt = herkuenfte.findIndex((h) => h === "karte");
    return { gesperrt: fehlt !== -1, fehlt: fehlt === -1 ? null : fehlt };
}
