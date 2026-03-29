# HERE Places POI Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace direct Overpass POI queries in frontend Picker configs with a backend POI proxy that uses HERE Browse API as primary source and falls back to Overpass.

**Architecture:** New `POST /api/poi/nearest` endpoint in the backend. Frontend Picker configs (Measuring, Matching, Tentacles) call this instead of building Overpass queries themselves. The backend tries HERE first (if `HERE_API_KEY` is set), then falls back to the existing Overpass multi-endpoint logic.

**Tech Stack:** Hono (backend router), HERE Geocoding & Search API v1/browse, existing Overpass proxy logic.

**Spec:** `docs/superpowers/specs/2026-03-29-here-places-poi-proxy-design.md`

---

### Task 1: Backend — Create POI router with HERE + Overpass fallback

**Files:**
- Create: `backend/src/routes/poi.ts`
- Modify: `backend/src/app.ts:21-60`

- [ ] **Step 1: Create `backend/src/routes/poi.ts`**

```typescript
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

// Name filters for Overpass results (substring match)
const OSM_NAME_FILTERS: Record<string, RegExp> = {
    mcdonalds: /McDonald/i,
    seven11:   /7.Eleven|Seven.Eleven/i,
};

// ── Shared types ───────────────────────────────────────────────────────────

interface PoiResult {
    name: string;
    lat: number;
    lng: number;
    dist: number; // km
}

interface PoiResponse {
    source: "here" | "overpass";
    pois: PoiResult[];
}

// ── Cache ──────────────────────────────────────────────────────────────────

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

// ── Haversine ──────────────────────────────────────────────────────────────

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

// ── HERE fetch ─────────────────────────────────────────────────────────────

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
                dist: (item.distance ?? 0) / 1000, // meters → km
            }));

        if (nameFilter) {
            const regex = new RegExp(nameFilter, "i");
            pois = pois.filter((p) => regex.test(p.name));
        }

        // Sort by distance (HERE usually returns sorted, but ensure it)
        pois.sort((a, b) => a.dist - b.dist);

        return pois;
    } catch (err: any) {
        console.warn(`[poi] HERE fetch failed: ${err?.message ?? err}`);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

// ── Overpass fetch (reuses the multi-endpoint logic from overpass.ts) ──────

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

// ── Route ──────────────────────────────────────────────────────────────────

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

        // ── Cache check ─────────────────────────────────────────────────
        evictExpired();
        const key = cacheKey(lat, lng, category, radiusM, nameFilter);
        const cached = cache.get(key);
        if (cached && cached.expiresAt > Date.now()) {
            return c.json(cached.data);
        }

        // ── 1. Try HERE ─────────────────────────────────────────────────
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

        // ── 2. Fallback: Overpass ───────────────────────────────────────
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
```

- [ ] **Step 2: Register the POI router in `backend/src/app.ts`**

Add the import and route registration. In `backend/src/app.ts`, add after line 24:

```typescript
import { createPoiRouter } from "./routes/poi.js";
```

And after line 59 (`app.route("/api", createOverpassRouter());`), add:

```typescript
    app.route("/api", createPoiRouter());
```

- [ ] **Step 3: Verify backend compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/poi.ts backend/src/app.ts
git commit -m "feat: add /api/poi/nearest with HERE primary + Overpass fallback"
```

---

### Task 2: Frontend — Add `findNearestPoi` API client

**Files:**
- Modify: `src/lib/session-api.ts`

- [ ] **Step 1: Add the `findNearestPoi` function**

In `src/lib/session-api.ts`, after the `addQuestion` function (around line 165), add:

```typescript
// ── POI endpoints ────────────────────────────────────────────────────────────

export interface PoiResult {
    name: string;
    lat: number;
    lng: number;
    dist: number;
}

export interface PoiResponse {
    source: "here" | "overpass";
    pois: PoiResult[];
}

export function findNearestPoi(body: {
    lat: number;
    lng: number;
    category: string;
    radiusM: number;
    nameFilter?: string;
}): Promise<PoiResponse> {
    return apiFetch("/api/poi/nearest", {
        method: "POST",
        body: JSON.stringify(body),
    });
}
```

- [ ] **Step 2: Verify frontend compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/session-api.ts
git commit -m "feat: add findNearestPoi API client"
```

---

### Task 3: Frontend — Migrate MeasuringConfig to use POI proxy

**Files:**
- Modify: `src/components/session/picker/MeasuringConfig.tsx`

- [ ] **Step 1: Replace `handleFindNearest` in MeasuringConfig**

In `src/components/session/picker/MeasuringConfig.tsx`:

1. Add import at the top (after other imports):

```typescript
import { findNearestPoi } from "@/lib/session-api";
```

2. Replace the `handleFindNearest` function (starts around line 274) — the entire function body from `async function handleFindNearest() {` to its closing `}`. Replace with:

```typescript
    async function handleFindNearest() {
        // Coastline uses a custom geometry query — not a POI search
        if (measType === "coastline") {
            await handleFindNearestCoastline();
            return;
        }

        setNearestLoading(true);
        setNearestResult(null);
        try {
            const data = await findNearestPoi({
                lat: centerLat,
                lng: centerLng,
                category: measType,
                radiusM: 50_000,
            });

            if (data.pois.length === 0) {
                toast.info("Keine Treffer im Umkreis von 50 km gefunden.");
                setNearestLoading(false);
                return;
            }

            const nearest = data.pois[0];
            setNearestResult(nearest);

            // Draw marker on map
            const m = leafletMapContext.get();
            if (m) {
                if (nearestMarkerRef.current) m.removeLayer(nearestMarkerRef.current);
                nearestMarkerRef.current = L.circleMarker([nearest.lat, nearest.lng], {
                    radius: 8,
                    color: "#E8323A",
                    fillColor: "#E8323A",
                    fillOpacity: 0.85,
                    weight: 2,
                }).addTo(m).bindPopup(nearest.name);
            }
        } catch {
            toast.error("POI-Suche nicht erreichbar.");
        } finally {
            setNearestLoading(false);
        }
    }
```

3. The `TYPE_TO_OSM` constant and `OsmTag` type at the top of the file are no longer used by `handleFindNearest` — but they may still be referenced by `handleFindNearestCoastline`. Check: if `handleFindNearestCoastline` does NOT use `TYPE_TO_OSM`, remove both `OsmTag` and `TYPE_TO_OSM`. If it does, keep them.

4. The `haversineKm` function is no longer needed in this file (the backend computes distances). Check if it's used by `handleFindNearestCoastline`. If not, remove it.

- [ ] **Step 2: Verify frontend compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/session/picker/MeasuringConfig.tsx
git commit -m "refactor: MeasuringConfig uses /api/poi/nearest"
```

---

### Task 4: Frontend — Migrate MatchingConfig to use POI proxy

**Files:**
- Modify: `src/components/session/picker/MatchingConfig.tsx`

- [ ] **Step 1: Replace `handleFindNearest` in MatchingConfig**

In `src/components/session/picker/MatchingConfig.tsx`:

1. Add import at the top:

```typescript
import { findNearestPoi } from "@/lib/session-api";
```

2. Replace the `handleFindNearest` function (starts around line 367) with:

```typescript
    async function handleFindNearest() {
        setNearestLoading(true);
        setNearestResult(null);
        try {
            const data = await findNearestPoi({
                lat: centerLat,
                lng: centerLng,
                category: matchType,
                radiusM: 50_000,
            });

            if (data.pois.length === 0) {
                toast.info("Keine Treffer im Umkreis von 50 km gefunden.");
                setNearestLoading(false);
                return;
            }

            const nearest = data.pois[0];
            setNearestResult(nearest);

            // Draw marker on map
            const m = leafletMapContext.get();
            if (m) {
                if (nearestMarkerRef.current) m.removeLayer(nearestMarkerRef.current);
                nearestMarkerRef.current = L.circleMarker([nearest.lat, nearest.lng], {
                    radius: 8,
                    color: "#E8323A",
                    fillColor: "#E8323A",
                    fillOpacity: 0.85,
                    weight: 2,
                }).addTo(m).bindPopup(nearest.name);
            }
        } catch {
            toast.error("POI-Suche nicht erreichbar.");
        } finally {
            setNearestLoading(false);
        }
    }
```

3. Remove the `OsmTag` type, `TYPE_TO_OSM` constant, and `haversineKm` function — they are no longer used. Keep the `overpassFetch` import if it's used elsewhere in the file (e.g. for zone queries via `findAdminBoundary`). The `findAdminBoundary` and `findAdminLevelsAt` imports from `@/maps/api/overpass` must stay.

4. The `canFindNearest` derived value (around line 515) currently checks `matchType in TYPE_TO_OSM`. Change it to check whether the type is NOT a station type and NOT a zone type:

```typescript
    const canFindNearest = !isStation && matchType !== "zone" && matchType !== "letter-zone" && matchType !== "street";
```

- [ ] **Step 2: Verify frontend compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/session/picker/MatchingConfig.tsx
git commit -m "refactor: MatchingConfig uses /api/poi/nearest"
```

---

### Task 5: Frontend — Migrate TentaclesConfig to use POI proxy

**Files:**
- Modify: `src/components/session/picker/TentaclesConfig.tsx`

- [ ] **Step 1: Replace `fetchOverpassPois` in TentaclesConfig**

In `src/components/session/picker/TentaclesConfig.tsx`:

1. Add import at the top:

```typescript
import { findNearestPoi } from "@/lib/session-api";
```

2. Replace the `fetchOverpassPois` function (lines ~60-85) with:

```typescript
async function fetchPois(
    lat: number,
    lng: number,
    radiusM: number,
    cat: Category,
    signal: AbortSignal,
): Promise<Poi[]> {
    // Use the POI proxy which tries HERE first, then Overpass
    const data = await findNearestPoi({
        lat,
        lng,
        category: cat.type,
        radiusM: Math.round(radiusM),
    });
    // Note: signal is not passed to findNearestPoi since it uses apiFetch.
    // The AbortSignal check happens at the caller level.
    if (signal.aborted) return [];
    return data.pois.map((p) => ({ lat: p.lat, lng: p.lng, name: p.name }));
}
```

3. Update the call site that invokes this function — search for `fetchOverpassPois(` (around line 191) and rename it to `fetchPois(`. The arguments are the same.

4. Remove the `overpassFetch` import (`import("@/maps/api/overpass-fetch")`) if it's no longer used anywhere in the file.

5. The `osm` field on the `Category` type and `CATEGORIES` constant is no longer needed by the fetch function. However, removing it would be a larger refactor. Leave it for now — it's harmless.

- [ ] **Step 2: Verify frontend compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/session/picker/TentaclesConfig.tsx
git commit -m "refactor: TentaclesConfig uses /api/poi/nearest"
```

---

### Task 6: Verify end-to-end

- [ ] **Step 1: Build shared package**

Run: `cd shared && npm run build`
Expected: No errors.

- [ ] **Step 2: Build backend**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Build frontend**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Test without HERE_API_KEY (pure Overpass fallback)**

Start backend without HERE_API_KEY and verify POI queries still work via Overpass:

Run: `cd backend && npx tsx src/index.ts`

Then test manually:
```bash
curl -s -X POST http://localhost:3001/api/poi/nearest \
  -H 'Content-Type: application/json' \
  -d '{"lat":53.4905,"lng":10.2869,"category":"rail-measure","radiusM":8000}' | jq '.source, .pois[0]'
```

Expected: `source: "overpass"`, first POI should be a nearby railway station/halt.

- [ ] **Step 5: Test with HERE_API_KEY**

Restart backend with `HERE_API_KEY=<your-key>` and repeat the same curl.

Expected: `source: "here"`, first POI should be a nearby railway station.

- [ ] **Step 6: Commit any fixes**

If any adjustments were needed, commit them.
