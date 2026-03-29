/**
 * POI proxy route.
 *
 * POST /api/poi/nearest — finds nearby POIs by category.
 * Primary: HERE Browse API (if HERE_API_KEY is set).
 * Fallback: Overpass API (existing multi-endpoint logic).
 */
import { createHash } from "node:crypto";
import { Hono } from "hono";

// ── HERE category mapping ──────────────────────────────────────────────────

const HERE_CATEGORIES: Record<string, string> = {
    airport:                        "400-4000-4581",
    hospital:                       "800-8000-0159",
    "hospital-full":                "800-8000-0159",
    museum:                         "300-3100-0027",
    "museum-full":                  "300-3100-0027",
    zoo:                            "550-5520-0208",
    "zoo-full":                     "550-5520-0208",
    aquarium:                       "550-5520-0211",
    "aquarium-full":                "550-5520-0211",
    theme_park:                     "550-5520-0207",
    "theme_park-full":              "550-5520-0207",
    cinema:                         "200-2100-0019",
    "cinema-full":                  "200-2100-0019",
    library:                        "800-8200-0174",
    "library-full":                 "800-8200-0174",
    golf_course:                    "550-5510-0202",
    "golf_course-full":             "550-5510-0202",
    park:                           "550-5510-0358",
    "park-full":                    "550-5510-0358",
    peak:                           "350-3500-0306",
    "peak-full":                    "350-3500-0306",
    consulate:                      "600-6400-0000",
    "consulate-full":               "600-6400-0000",
    "rail-measure":                 "400-4100-0035",
    "highspeed-measure-shinkansen": "400-4100-0035",
    "same-first-letter-station":    "400-4100-0035",
    "same-length-station":          "400-4100-0035",
    "same-train-line":              "400-4100-0035",
};

// ── Overpass OSM tag mapping (fallback) ────────────────────────────────────

type OsmTag = { key: string; value: string; alt?: { key: string; value: string }[] };

const OSM_TAGS: Record<string, OsmTag> = {
    airport:                        { key: "aeroway", value: "aerodrome" },
    city:                           { key: "place", value: "city" },
    "major-city":                   { key: "place", value: "city" },
    "highspeed-measure-shinkansen": { key: "railway", value: "station", alt: [{ key: "railway", value: "halt" }] },
    hospital:                       { key: "amenity", value: "hospital" },
    "hospital-full":                { key: "amenity", value: "hospital" },
    museum:                         { key: "tourism", value: "museum" },
    "museum-full":                  { key: "tourism", value: "museum" },
    zoo:                            { key: "tourism", value: "zoo" },
    "zoo-full":                     { key: "tourism", value: "zoo" },
    aquarium:                       { key: "tourism", value: "aquarium" },
    "aquarium-full":                { key: "tourism", value: "aquarium" },
    theme_park:                     { key: "tourism", value: "theme_park" },
    "theme_park-full":              { key: "tourism", value: "theme_park" },
    cinema:                         { key: "amenity", value: "cinema" },
    "cinema-full":                  { key: "amenity", value: "cinema" },
    library:                        { key: "amenity", value: "library" },
    "library-full":                 { key: "amenity", value: "library" },
    golf_course:                    { key: "leisure", value: "golf_course" },
    "golf_course-full":             { key: "leisure", value: "golf_course" },
    park:                           { key: "leisure", value: "park" },
    "park-full":                    { key: "leisure", value: "park" },
    peak:                           { key: "natural", value: "peak" },
    "peak-full":                    { key: "natural", value: "peak" },
    consulate:                      { key: "office", value: "diplomatic" },
    "consulate-full":               { key: "office", value: "diplomatic" },
    "rail-measure":                 { key: "railway", value: "station", alt: [{ key: "railway", value: "halt" }] },
    "same-first-letter-station":    { key: "railway", value: "station", alt: [{ key: "railway", value: "halt" }] },
    "same-length-station":          { key: "railway", value: "station", alt: [{ key: "railway", value: "halt" }] },
    "same-train-line":              { key: "railway", value: "station", alt: [{ key: "railway", value: "halt" }] },
    mcdonalds:                      { key: "amenity", value: "fast_food" },
    seven11:                        { key: "shop", value: "convenience" },
};

const OSM_NAME_FILTERS: Record<string, RegExp> = {
    mcdonalds: /McDonald/i,
    seven11:   /7.Eleven|Seven.Eleven/i,
};

interface PoiResult {
    name: string;
    lat: number;
    lng: number;
    dist: number;
}

interface PoiResponse {
    source: "here" | "overpass";
    pois: PoiResult[];
}

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
    data: PoiResponse;
    expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(lat: number, lng: number, category: string, radiusM: number, nameFilter?: string): string {
    const raw = `${lat.toFixed(4)},${lng.toFixed(4)},${category},${radiusM},${nameFilter ?? ""}`;
    return createHash("sha256").update(raw).digest("hex");
}

function evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of cache) {
        if (entry.expiresAt <= now) cache.delete(key);
    }
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(a));
}

const HERE_API_KEY = process.env.HERE_API_KEY ?? "";
const HERE_TIMEOUT_MS = 10_000;

async function fetchHere(
    lat: number,
    lng: number,
    hereCategory: string,
    radiusM: number,
    nameFilter?: string,
): Promise<PoiResult[] | null> {
    if (!HERE_API_KEY) return null;

    const url = new URL("https://browse.search.hereapi.com/v1/browse");
    url.searchParams.set("at", `${lat},${lng}`);
    url.searchParams.set("categories", hereCategory);
    url.searchParams.set("in", `circle:${lat},${lng};r=${Math.round(radiusM)}`);
    url.searchParams.set("limit", "20");
    url.searchParams.set("apiKey", HERE_API_KEY);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HERE_TIMEOUT_MS);

    try {
        const resp = await fetch(url.toString(), { signal: controller.signal });
        if (!resp.ok) {
            console.warn(`[poi] HERE returned HTTP ${resp.status}`);
            return null;
        }
        const data = await resp.json() as {
            items?: Array<{
                title?: string;
                position?: { lat: number; lng: number };
                distance?: number;
            }>;
        };

        let pois: PoiResult[] = (data.items ?? [])
            .filter((item) => item.position)
            .map((item) => ({
                name: item.title ?? "Unbekannt",
                lat: item.position!.lat,
                lng: item.position!.lng,
                dist: (item.distance ?? 0) / 1000,
            }));

        if (nameFilter) {
            const regex = new RegExp(nameFilter, "i");
            pois = pois.filter((p) => regex.test(p.name));
        }

        pois.sort((a, b) => a.dist - b.dist);
        return pois;
    } catch (err: any) {
        console.warn(`[poi] HERE fetch failed: ${err?.message ?? err}`);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
];
const OVERPASS_TIMEOUT_MS = 60_000;
const RETRY_DELAY_MS = 3_000;
const RETRYABLE_STATUSES = new Set([429, 503, 504]);

async function fetchOverpassEndpoint(endpoint: string, query: string): Promise<any | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
    try {
        let resp = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `data=${encodeURIComponent(query)}`,
            signal: controller.signal,
        });
        if (RETRYABLE_STATUSES.has(resp.status)) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
            resp = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: `data=${encodeURIComponent(query)}`,
                signal: controller.signal,
            });
        }
        if (!resp.ok) return null;
        return await resp.json();
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function fetchOverpassPois(
    lat: number,
    lng: number,
    category: string,
    radiusM: number,
    nameFilter?: string,
): Promise<PoiResult[] | null> {
    const osm = OSM_TAGS[category];
    if (!osm) return null;

    const r = Math.round(radiusM);
    const allTags = [{ key: osm.key, value: osm.value }, ...(osm.alt ?? [])];
    const unions = allTags
        .map(({ key, value }) =>
            `node["${key}"="${value}"](around:${r},${lat},${lng});` +
            `way["${key}"="${value}"](around:${r},${lat},${lng});` +
            `relation["${key}"="${value}"](around:${r},${lat},${lng});`,
        )
        .join("");
    const query = `[out:json][timeout:25];(${unions});out center;`;

    let data: any = null;
    for (const endpoint of OVERPASS_ENDPOINTS) {
        data = await fetchOverpassEndpoint(endpoint, query);
        if (data) break;
    }
    if (!data) return null;

    const nameRegex = nameFilter ? new RegExp(nameFilter, "i") : OSM_NAME_FILTERS[category] ?? null;

    let pois: PoiResult[] = (data.elements ?? [])
        .map((el: any) => ({
            name: el.tags?.name ?? el.tags?.["name:de"] ?? "Unbekannt",
            lat: el.lat ?? el.center?.lat ?? 0,
            lng: el.lon ?? el.center?.lon ?? 0,
        }))
        .filter((p: any) => p.lat !== 0)
        .map((p: any) => ({
            ...p,
            dist: haversineKm(lat, lng, p.lat, p.lng),
        }));

    if (nameRegex) {
        pois = pois.filter((p) => nameRegex.test(p.name));
    }

    pois.sort((a, b) => a.dist - b.dist);
    return pois;
}

export function createPoiRouter(): Hono {
    const router = new Hono();

    router.post("/poi/nearest", async (c) => {
        const body = await c.req.json<{
            lat?: number;
            lng?: number;
            category?: string;
            radiusM?: number;
            nameFilter?: string;
        }>().catch(() => null);

        if (
            !body ||
            typeof body.lat !== "number" ||
            typeof body.lng !== "number" ||
            !body.category ||
            typeof body.radiusM !== "number"
        ) {
            return c.json({ error: "Missing or invalid fields: lat, lng, category, radiusM" }, 400);
        }

        const { lat, lng, category, radiusM, nameFilter } = body;

        if (radiusM > 50_000) {
            return c.json({ error: "radiusM must not exceed 50000" }, 400);
        }

        evictExpired();
        const key = cacheKey(lat, lng, category, radiusM, nameFilter);
        const cached = cache.get(key);
        if (cached && cached.expiresAt > Date.now()) {
            return c.json(cached.data);
        }

        const hereCategory = HERE_CATEGORIES[category];
        if (hereCategory && HERE_API_KEY) {
            const herePois = await fetchHere(lat, lng, hereCategory, radiusM, nameFilter);
            if (herePois !== null) {
                const result: PoiResponse = { source: "here", pois: herePois };
                cache.set(key, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
                return c.json(result);
            }
            console.warn(`[poi] HERE failed for category=${category}, falling back to Overpass`);
        }

        const overpassPois = await fetchOverpassPois(lat, lng, category, radiusM, nameFilter);
        if (overpassPois !== null) {
            const result: PoiResponse = { source: "overpass", pois: overpassPois };
            cache.set(key, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
            return c.json(result);
        }

        return c.json({ error: "All POI sources failed", pois: [] }, 502);
    });

    return router;
}
