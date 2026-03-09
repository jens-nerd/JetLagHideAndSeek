/**
 * Shared location utilities for question config pickers.
 * Extracted to avoid duplication across MatchingConfig, MeasuringConfig,
 * RadiusConfig, TentaclesConfig, ThermometerConfig.
 */

/** Format lat/lng as "51.3512° N, 10.4590° E" */
export function formatCoord(lat: number, lng: number): string {
    const latDir = lat >= 0 ? "N" : "S";
    const lngDir = lng >= 0 ? "E" : "W";
    return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lng).toFixed(4)}° ${lngDir}`;
}

/** Parse clipboard text to coordinates — supports "51.3,10.4" and "51.3° N 10.4° E" */
export function parseClipboardCoords(text: string): { lat: number; lng: number } | null {
    const t = text.trim();
    // "48.1234, 9.1234" or "48.1234,9.1234"
    const simple = t.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (simple) {
        const lat = parseFloat(simple[1]);
        const lng = parseFloat(simple[2]);
        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
    }
    // "48.1234° N 9.1234° E" or "48.1234° 9.1234°"
    const degree = t.match(/^(-?\d+(?:\.\d+)?)\s*°?\s*[NSns]?\s+(-?\d+(?:\.\d+)?)\s*°?\s*[EWew]?$/);
    if (degree) {
        const lat = parseFloat(degree[1]);
        const lng = parseFloat(degree[2]);
        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
    }
    return null;
}

/** Search the Photon (Komoot) geocoding API */
export async function searchPhoton(query: string): Promise<{ lat: number; lng: number; name: string }[]> {
    if (!query.trim()) return [];
    const resp = await fetch(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`,
    );
    const data = await resp.json();
    return (data.features ?? []).map((f: any) => ({
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
        name: [f.properties.name, f.properties.city, f.properties.country]
            .filter(Boolean)
            .join(", "),
    }));
}
