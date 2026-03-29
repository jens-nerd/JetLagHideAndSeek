# HERE Places als primäre POI-Quelle mit Overpass-Fallback

**Datum:** 2026-03-29
**Status:** Approved

## Problem

Die App nutzt ausschließlich die öffentliche Overpass API für POI-Suchen (nächster Bahnhof, Flughafen, Museum etc.). Die öffentlichen Overpass-Endpoints sind häufig überlastet (429/503/504), was dazu führt, dass Fragen nicht gestellt werden können.

## Lösung

HERE Geocoding & Search API (`/v1/browse`) als primäre POI-Quelle einbinden. Overpass dient als Fallback wenn HERE nicht verfügbar ist oder die Kategorie nicht gemappt werden kann.

## Architektur

```
Frontend (MatchingConfig, MeasuringConfig, TentaclesConfig)
    │
    │  POST /api/poi/nearest  { lat, lng, category, radiusM, nameFilter? }
    │
    ▼
Backend POI-Router (backend/src/routes/poi.ts)
    │
    ├─ 1. HERE Browse API  (primär, wenn HERE_API_KEY gesetzt)
    │     GET https://browse.search.hereapi.com/v1/browse
    │
    └─ 2. Overpass Proxy   (Fallback)
          Bestehende Multi-Endpoint-Logik aus overpass.ts
```

### Was sich ändert

- Neuer Backend-Endpoint `POST /api/poi/nearest`
- Frontend-POI-Queries in MeasuringConfig, MatchingConfig, TentaclesConfig nutzen neuen Endpoint
- `HERE_API_KEY` als optionale Env-Variable

### Was sich NICHT ändert

- `/api/overpass` bleibt unverändert für:
  - Admin-Boundaries (`findAdminBoundary`, `findAdminLevelsAt`)
  - Zone-/Letter-Zone-Matching-Fragen
  - Coastline-Queries
  - Karten-Boundary-Fetches (`getOverpassData`)
  - Hider-Antwort-Logik (`hiderifyQuestion` in `maps/questions/`)
- Ohne `HERE_API_KEY` läuft alles wie bisher über Overpass (kein Breaking Change)

## Backend: POST /api/poi/nearest

### Request

```typescript
{
  lat: number,
  lng: number,
  category: string,     // App-interner Typ, z.B. "hospital", "airport"
  radiusM: number,      // Suchradius in Metern (max 50000)
  nameFilter?: string   // Optional: Substring-Filter auf Name (z.B. "McDonald")
}
```

### Response

```typescript
{
  source: "here" | "overpass",
  pois: Array<{
    name: string,
    lat: number,
    lng: number,
    dist: number   // Distanz in km vom Anfragepunkt
  }>
}
```

### Logik

1. Validiere Request (lat/lng range, radiusM <= 50000, category nicht leer)
2. Cache prüfen (SHA-256 über `lat,lng,category,radiusM,nameFilter`, 5min TTL)
3. Wenn `HERE_API_KEY` gesetzt UND Kategorie im HERE-Mapping existiert:
   a. HERE Browse API aufrufen
   b. Response normalisieren (title → name, position → lat/lng, distance → dist in km)
   c. Optional: `nameFilter` als case-insensitive Substring auf `name` anwenden
   d. Bei Erfolg: cachen + zurückgeben mit `source: "here"`
   e. Bei Fehler (429/5xx/Timeout): weiter zu Schritt 4
4. Overpass-Fallback:
   a. Kategorie im OSM-Tag-Mapping nachschlagen
   b. Overpass-Query bauen (node/way/relation mit `alt`-Tags)
   c. Über bestehende Multi-Endpoint-Logik aus overpass.ts ausführen
   d. Haversine-Distanz berechnen, sortieren
   e. Cachen + zurückgeben mit `source: "overpass"`
5. Wenn beide fehlschlagen: HTTP 502 mit Fehlermeldung

## Kategorie-Mapping

### HERE Category Codes

```typescript
const HERE_CATEGORIES: Record<string, string> = {
    "airport":              "400-4000-4581",
    "hospital":             "800-8000-0159",
    "hospital-full":        "800-8000-0159",
    "museum":               "300-3100-0027",
    "museum-full":          "300-3100-0027",
    "zoo":                  "550-5520-0208",
    "zoo-full":             "550-5520-0208",
    "aquarium":             "550-5520-0211",
    "aquarium-full":        "550-5520-0211",
    "theme_park":           "550-5520-0207",
    "theme_park-full":      "550-5520-0207",
    "cinema":               "200-2100-0019",
    "cinema-full":          "200-2100-0019",
    "library":              "800-8200-0174",
    "library-full":         "800-8200-0174",
    "golf_course":          "550-5510-0202",
    "golf_course-full":     "550-5510-0202",
    "park":                 "550-5510-0358",
    "park-full":            "550-5510-0358",
    "peak":                 "350-3500-0306",
    "peak-full":            "350-3500-0306",
    "consulate":            "600-6400-0000",
    "consulate-full":       "600-6400-0000",
    // Railway: station + halt sind in HERE ein einziger Typ
    "rail-measure":                         "400-4100-0035",
    "highspeed-measure-shinkansen":         "400-4100-0035",
    "same-first-letter-station":            "400-4100-0035",
    "same-length-station":                  "400-4100-0035",
    "same-train-line":                      "400-4100-0035",
};
```

### Overpass-Fallback Tags

Bestehende `TYPE_TO_OSM`-Mappings aus MeasuringConfig/MatchingConfig werden ins Backend verschoben (DRY).

### Kategorien die IMMER Overpass nutzen

- `city` / `major-city` — HERE hat keine "Großstadt"-Kategorie
- `coastline` — Geometrie-Query, kein POI
- `mcdonalds`, `seven11` — HERE hat die Kategorie, aber der Name-Filter ist unzuverlässiger als bei Overpass

## Frontend-Änderungen

### Neuer API-Client

```typescript
// src/lib/session-api.ts
export function findNearestPoi(body: {
    lat: number; lng: number;
    category: string; radiusM: number;
    nameFilter?: string;
}): Promise<{ source: string; pois: Array<{ name: string; lat: number; lng: number; dist: number }> }> {
    return apiFetch("/api/poi/nearest", {
        method: "POST",
        body: JSON.stringify(body),
    });
}
```

### Picker-Config-Änderungen

In MeasuringConfig, MatchingConfig und TentaclesConfig:
- `handleFindNearest()` ruft `findNearestPoi()` statt direkt `overpassFetch()` auf
- Die Overpass-Query-Bau-Logik und das `TYPE_TO_OSM`-Mapping werden aus dem Frontend entfernt
- Haversine-Berechnung entfällt (Backend liefert `dist`)
- Response-Mapping vereinfacht: `pois[0]` ist bereits der nächste

## Env-Konfiguration

```bash
# Optional — ohne Key läuft alles über Overpass
HERE_API_KEY=your_api_key_here
```

## Caching

Gleiche Strategie wie bestehender Overpass-Cache:
- In-Memory Map mit SHA-256 Key
- TTL: 5 Minuten
- Lazy Eviction bei jedem Request
