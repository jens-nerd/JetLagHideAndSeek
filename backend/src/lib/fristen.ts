/**
 * Antwortfristen einer Frage, abgeleitet aus der Ausdehnung des Spielgebiets.
 *
 * Die Ausdehnung steckt in der Spalte `sessions.map_location`. Dort liegt ein
 * JSON-serialisiertes `MapLocation` (shared/src/types.ts), und das Feature des
 * Geocoders haengt darin unter `osmFeature` — der Pfad ist also
 * `osmFeature.properties.extent` und nicht `properties.extent`. Geschrieben
 * wird das von `buildMapLocationFromContext()` in src/lib/session-context.ts.
 * Die vier Zahlen stehen als `[nord, west, sued, ost]` (normalisiert in
 * src/maps/api/geocode.ts).
 *
 * Faellt an dieser Kette irgendetwas aus — Spalte null, JSON unlesbar, kein
 * Extent, Extent unbrauchbar —, gelten die Festwerte QUESTION_DEADLINE_MS und
 * PHOTO_DEADLINE_MS. Ein fehlendes Gebiet darf niemandem eine kurze Frist
 * bescheren, waehrend er quer durch die Stadt laeuft.
 *
 * Nur die Hauptzone zaehlt. `additionalOsmFeatures` bleibt aussen vor, damit
 * das Backend dieselbe Kennzahl benutzt wie `gebietsausdehnungKm` im Frontend.
 */
import {
    ausdehnungKmAusExtent,
    fristenMs,
    PHOTO_DEADLINE_MS,
    QUESTION_DEADLINE_MS,
} from "@hideandseek/shared";

/**
 * Laengste Kante des Spielgebiets in km, aus der rohen Spalte gelesen.
 *
 * @param mapLocation Inhalt von `sessions.map_location` (JSON-Text oder null)
 * @returns km, oder null wenn kein brauchbares Gebiet hinterlegt ist
 */
export function ausdehnungKmAusMapLocation(
    mapLocation: string | null | undefined,
): number | null {
    if (!mapLocation) return null;

    let geparst: unknown;
    try {
        geparst = JSON.parse(mapLocation);
    } catch {
        return null;
    }

    const extent = (geparst as { osmFeature?: { properties?: { extent?: unknown } } })
        ?.osmFeature?.properties?.extent;
    if (!Array.isArray(extent)) return null;

    return ausdehnungKmAusExtent(extent as number[]);
}

/**
 * Frist in Millisekunden fuer eine neu gestellte Frage dieser Sitzung.
 *
 * @param mapLocation Inhalt von `sessions.map_location`
 * @param questionType Fragetyp; "photo" bekommt die lange Frist
 */
export function fristMsFuerFrage(
    mapLocation: string | null | undefined,
    questionType: string,
): number {
    const ausdehnungKm = ausdehnungKmAusMapLocation(mapLocation);

    if (ausdehnungKm == null) {
        return questionType === "photo" ? PHOTO_DEADLINE_MS : QUESTION_DEADLINE_MS;
    }

    const { frageMs, fotoMs } = fristenMs(ausdehnungKm);
    return questionType === "photo" ? fotoMs : frageMs;
}
