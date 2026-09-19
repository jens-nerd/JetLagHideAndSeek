/**
 * Erst bauen, dann tauschen: die alten Kartenebenen bleiben stehen, bis die
 * neuen fertig sind. Scheitert der Aufbau, behält der Spieler die Ansicht, die
 * er hatte – statt einer leeren Karte.
 *
 * Eigene Datei ohne React-Import, damit die Regel im Test ohne Leaflet geladen
 * werden kann.
 */

/** Das Wenige, was der Tausch von einer Leaflet-Karte braucht. */
export interface TauschKarte {
    eachLayer(fn: (layer: any) => void): void;
    removeLayer(layer: any): void;
    addLayer(layer: any): void;
}

/**
 * Ebenen, die Map.tsx selbst aufgebaut hat. Fremde Ebenen (Kacheln, Marker,
 * Versteckzone) tragen keine dieser Kennungen und werden nie angefasst.
 */
export function istEigeneEbene(layer: any): boolean {
    if (!layer) return false;
    return Boolean(layer.questionKey) || layer.questionKey === 0 || Boolean(layer.eliminationGeoJSON);
}

/**
 * Führt `bauen` aus und tauscht die Ebenen erst danach. Wirft `bauen`, bleibt
 * die Karte unverändert und der Fehler wird durchgereicht.
 */
export async function ebenenTauschen<T>(
    karte: TauschKarte,
    bauen: () => Promise<{ ebenen: unknown[]; daten: T }>,
): Promise<T> {
    const { ebenen, daten } = await bauen();

    const alte: any[] = [];
    karte.eachLayer((layer) => {
        if (istEigeneEbene(layer)) alte.push(layer);
    });

    for (const layer of alte) karte.removeLayer(layer);
    for (const layer of ebenen) karte.addLayer(layer);

    return daten;
}
