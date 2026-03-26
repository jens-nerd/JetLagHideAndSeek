# Mobile Hider Gameplay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the hider in the mobile app to answer questions (with GPS auto-calculation + manual override), see cumulative elimination zones on the map, draw cards after answering, see planning mode outlines, and react to game status changes.

**Architecture:** Port the web app's Turf.js geometry pipeline to React Native. Replace `@arcgis/core` geodesic buffering with `@turf/buffer`. Hider position comes from device GPS (not manual marker). Game area is read from the backend (defined in web app). All geo-computation runs client-side; Overpass queries go through the existing backend proxy.

**Tech Stack:** React Native, Expo, Zustand, `@turf/*` (individual modules), `d3-geo-voronoi`, `d3-geo-projection`, `osmtogeojson`, `react-native-maps` `<Geojson>` component

**Spec:** `docs/superpowers/specs/2026-03-26-mobile-hider-gameplay-design.md`

**Working directory:** `/Users/jensvielhaben-nl001/hideandseek-mobile/`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `lib/maps/geo-utils/voronoi.ts` | Geo-spatial Voronoi via d3-geo-voronoi |
| `lib/maps/geo-utils/operators.ts` | safeUnion, modifyMapData, turfBuffer (replaces arcBuffer), holedMask |
| `lib/maps/geo-utils/index.ts` | Barrel exports |
| `lib/maps/questions/radius.ts` | hiderifyRadius, adjustPerRadius, radiusPlanningPolygon |
| `lib/maps/questions/thermometer.ts` | hiderifyThermometer, adjustPerThermometer, thermometerPlanningPolygon |
| `lib/maps/questions/tentacles.ts` | hiderifyTentacles, adjustPerTentacle, tentaclesPlanningPolygon |
| `lib/maps/questions/matching.ts` | hiderifyMatching, adjustPerMatching, matchingPlanningPolygon |
| `lib/maps/questions/measuring.ts` | hiderifyMeasuring, adjustPerMeasuring, measuringPlanningPolygon |
| `lib/maps/hiderify.ts` | hiderifyQuestion dispatcher |
| `lib/maps/pipeline.ts` | applyQuestionsToMapGeoData, adjustMapGeoDataForQuestion, determinePlanningPolygon |
| `lib/maps/blank-geojson.ts` | World-extent blank GeoJSON for holedMask |
| `lib/overpass.ts` | Overpass backend proxy client |
| `lib/overpass-queries.ts` | findTentacleLocations, findPlacesInZone, findAdminBoundary etc. |
| `lib/card-costs.ts` | CARD_COSTS + getCardCost |
| `components/CardDrawOverlay.tsx` | Modal after answering showing draw/keep cards |
| `lib/maps/__tests__/geo-utils.test.ts` | Tests for voronoi, operators |
| `lib/maps/__tests__/hiderify.test.ts` | Tests for hiderify per question type |
| `lib/maps/__tests__/pipeline.test.ts` | Tests for pipeline |

### Modified Files

| File | Change |
|------|--------|
| `hooks/useGpsTracking.ts` | Enable GPS for hiders (local only, no broadcast) |
| `hooks/useSessionWebSocket.ts` | Handle `session_status_changed` event |
| `components/QuestionPanel.tsx` | GPS auto-answer, manual override, card draw trigger |
| `components/QuestionAnswerSheet.tsx` | Hiderify preview, override toggle |
| `components/GameMap.tsx` | Elimination zone + planning mode GeoJSON layers |
| `lib/session-store.ts` | Add `planningModeEnabled`, `eliminationGeoJSON`, `planningGeoJSON` |
| `app/(tabs)/settings.tsx` | Planning mode toggle |

---

## Phase 1: Foundation (Geo-Utils + Dependencies)

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Turf.js individual modules + geo libs**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
npm install @turf/helpers @turf/distance @turf/boolean-point-in-polygon @turf/buffer @turf/intersect @turf/union @turf/difference @turf/polygon-to-line @turf/nearest-point @turf/simplify @turf/bbox @turf/bbox-polygon @turf/bbox-clip @turf/line-to-polygon @turf/feature-collection @turf/combine @turf/point @turf/meta @turf/centroid @turf/projection
npm install d3-geo-voronoi d3-geo-projection d3-geo
npm install osmtogeojson
npm install -D @types/d3-geo @types/geojson
```

- [ ] **Step 2: Verify no install errors**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
npx tsc --noEmit 2>&1 | head -5
```

Expected: No new errors from these packages.

- [ ] **Step 3: Commit**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
git add package.json package-lock.json
git commit -m "feat: add turf.js, d3-geo-voronoi, osmtogeojson dependencies"
```

---

### Task 2: Geo-Utils — Voronoi

**Files:**
- Create: `lib/maps/geo-utils/voronoi.ts`
- Create: `lib/maps/__tests__/geo-utils.test.ts`

- [ ] **Step 1: Write test for geoSpatialVoronoi**

```typescript
// lib/maps/__tests__/geo-utils.test.ts
import { geoSpatialVoronoi } from "../geo-utils/voronoi";
import { featureCollection, point } from "@turf/helpers";

describe("geoSpatialVoronoi", () => {
  it("splits two points into two Voronoi polygons", () => {
    const points = featureCollection([
      point([10, 50]),  // [lng, lat]
      point([12, 50]),
    ]);
    const result = geoSpatialVoronoi(points);

    expect(result.type).toBe("FeatureCollection");
    expect(result.features).toHaveLength(2);
    expect(result.features[0].geometry.type).toMatch(/Polygon|MultiPolygon/);
    expect(result.features[1].geometry.type).toMatch(/Polygon|MultiPolygon/);
  });

  it("creates three polygons for three points", () => {
    const points = featureCollection([
      point([10, 50]),
      point([12, 50]),
      point([11, 52]),
    ]);
    const result = geoSpatialVoronoi(points);
    expect(result.features).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
npx jest lib/maps/__tests__/geo-utils.test.ts --no-cache
```

Expected: FAIL — `Cannot find module '../geo-utils/voronoi'`

- [ ] **Step 3: Implement geoSpatialVoronoi**

```typescript
// lib/maps/geo-utils/voronoi.ts
import { featureCollection as fc, point as turfPoint } from "@turf/helpers";
import { coordEach } from "@turf/meta";
import { geoMercator } from "d3-geo";
// @ts-expect-error No type declarations
import { geoProject, geoStitch } from "d3-geo-projection";
// @ts-expect-error No type declarations
import { geoVoronoi } from "d3-geo-voronoi";
import type { FeatureCollection, MultiPolygon, Point, Polygon } from "geojson";

// Mercator projection reference for coordinate scaling
const toMercator = (coord: [number, number]): [number, number] => {
  const d2r = Math.PI / 180;
  const R = 6378137; // WGS84 semi-major axis
  return [
    R * coord[0] * d2r,
    R * Math.log(Math.tan(Math.PI / 4 + (coord[1] * d2r) / 2)),
  ];
};

const scaleRef = toMercator([180, 90]);

export const geoSpatialVoronoi = (
  points: FeatureCollection<Point>,
): FeatureCollection<Polygon | MultiPolygon> => {
  const voronoi = geoVoronoi()(points).polygons();
  const projected = geoProject(
    geoStitch(voronoi),
    geoMercator().translate([0, 0]).precision(0.005),
  );

  const ratio = scaleRef[0] / 480.5;

  coordEach(projected, (coord: number[]) => {
    coord[0] = coord[0] * ratio;
    coord[1] = coord[1] * -ratio;
  });

  // Convert back from Mercator to WGS84
  const R = 6378137;
  const d2r = Math.PI / 180;
  coordEach(projected, (coord: number[]) => {
    coord[0] = (coord[0] / R) / d2r;
    coord[1] = (2 * Math.atan(Math.exp(coord[1] / R)) - Math.PI / 2) / d2r;
  });

  return projected as FeatureCollection<Polygon | MultiPolygon>;
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
npx jest lib/maps/__tests__/geo-utils.test.ts --no-cache
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
git add lib/maps/
git commit -m "feat: add geoSpatialVoronoi geo-util"
```

---

### Task 3: Geo-Utils — Operators (safeUnion, modifyMapData, turfBuffer, holedMask)

**Files:**
- Create: `lib/maps/geo-utils/operators.ts`
- Create: `lib/maps/geo-utils/index.ts`
- Create: `lib/maps/blank-geojson.ts`
- Modify: `lib/maps/__tests__/geo-utils.test.ts`

**Note:** The web app uses `@arcgis/core` for `arcBuffer`. We replace it with `@turf/buffer` which does geodesic buffering. The API differs but the result is equivalent for our use case.

- [ ] **Step 1: Create blank GeoJSON (world extent polygon for holedMask)**

```typescript
// lib/maps/blank-geojson.ts
import { featureCollection, polygon } from "@turf/helpers";

// A polygon covering the entire world — used by holedMask to invert geometries
export const BLANK_GEOJSON = featureCollection([
  polygon([[
    [-180, -90],
    [180, -90],
    [180, 90],
    [-180, 90],
    [-180, -90],
  ]]),
]);
```

- [ ] **Step 2: Write tests for operators**

Add to `lib/maps/__tests__/geo-utils.test.ts`:

```typescript
import { safeUnion, modifyMapData, turfBuffer, holedMask } from "../geo-utils/operators";
import { featureCollection, polygon, point } from "@turf/helpers";

describe("safeUnion", () => {
  it("returns single feature as-is", () => {
    const poly = polygon([[[0,0],[1,0],[1,1],[0,1],[0,0]]]);
    const fc = featureCollection([poly]);
    const result = safeUnion(fc);
    expect(result).toBe(poly);
  });

  it("unions two overlapping polygons", () => {
    const a = polygon([[[0,0],[2,0],[2,2],[0,2],[0,0]]]);
    const b = polygon([[[1,1],[3,1],[3,3],[1,3],[1,1]]]);
    const result = safeUnion(featureCollection([a, b]));
    expect(result).toBeDefined();
    expect(result!.geometry.type).toMatch(/Polygon|MultiPolygon/);
  });
});

describe("turfBuffer", () => {
  it("creates a buffered polygon around a point", () => {
    const pt = point([10, 50]);
    const result = turfBuffer(featureCollection([pt]), 10, "kilometers");
    expect(result).toBeDefined();
    expect(result!.geometry.type).toMatch(/Polygon|MultiPolygon/);
  });
});

describe("modifyMapData", () => {
  const mapData = featureCollection([
    polygon([[[0,0],[10,0],[10,10],[0,10],[0,0]]]),
  ]);
  const modifier = polygon([[[2,2],[8,2],[8,8],[2,8],[2,2]]]);

  it("intersects when withinModifications=true", () => {
    const result = modifyMapData(mapData, modifier, true);
    expect(result).toBeDefined();
  });

  it("excludes when withinModifications=false", () => {
    const result = modifyMapData(mapData, modifier, false);
    expect(result).toBeDefined();
  });
});

describe("holedMask", () => {
  it("inverts a polygon", () => {
    const poly = polygon([[[0,0],[1,0],[1,1],[0,1],[0,0]]]);
    const result = holedMask(poly);
    expect(result).toBeDefined();
    // The holed mask should be a polygon with a hole
    expect(result!.geometry.type).toMatch(/Polygon|MultiPolygon/);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
npx jest lib/maps/__tests__/geo-utils.test.ts --no-cache
```

Expected: FAIL — `Cannot find module '../geo-utils/operators'`

- [ ] **Step 4: Implement operators**

```typescript
// lib/maps/geo-utils/operators.ts
import { featureCollection as fc, point } from "@turf/helpers";
import union from "@turf/union";
import intersect from "@turf/intersect";
import difference from "@turf/difference";
import buffer from "@turf/buffer";
import centroid from "@turf/centroid";
import turfDistance from "@turf/distance";
import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
} from "geojson";

import { BLANK_GEOJSON } from "../blank-geojson";

export { geoSpatialVoronoi } from "./voronoi";

export const safeUnion = (
  input: FeatureCollection<Polygon | MultiPolygon>,
): Feature<Polygon | MultiPolygon> => {
  if (input.features.length === 1) return input.features[0];
  const result = union(input);
  if (result) return result;
  throw new Error("safeUnion: no features");
};

export const holedMask = (
  input:
    | Feature<Polygon | MultiPolygon>
    | FeatureCollection<Polygon | MultiPolygon>,
): Feature<Polygon | MultiPolygon> | null => {
  return difference(
    fc([
      BLANK_GEOJSON.features[0] as Feature<Polygon>,
      "features" in input ? safeUnion(input) : input,
    ]),
  );
};

export const modifyMapData = (
  mapData: FeatureCollection<Polygon | MultiPolygon>,
  modifications:
    | FeatureCollection<Polygon | MultiPolygon>
    | Feature<Polygon | MultiPolygon>,
  withinModifications: boolean,
): Feature<Polygon | MultiPolygon> | null => {
  const safeModifications =
    "features" in modifications ? safeUnion(modifications) : modifications;

  if (withinModifications) {
    return intersect(fc([safeUnion(mapData), safeModifications]));
  }
  const mask = holedMask(safeModifications);
  if (!mask) return null;
  return intersect(fc([safeUnion(mapData), mask]));
};

/**
 * Geodesic buffer using @turf/buffer.
 * Replaces the web app's arcBuffer which uses @arcgis/core (not available in RN).
 * @turf/buffer uses geodesic calculations when units are specified.
 */
export const turfBuffer = (
  geometry: FeatureCollection,
  distance: number,
  unit: string = "miles",
): Feature<Polygon | MultiPolygon> | null => {
  // Buffer each feature and union the results
  const buffered = geometry.features
    .map((f) => buffer(f, distance, { units: unit as any }))
    .filter((f): f is Feature<Polygon | MultiPolygon> => f != null);

  if (buffered.length === 0) return null;
  if (buffered.length === 1) return buffered[0];

  return safeUnion(fc(buffered) as FeatureCollection<Polygon | MultiPolygon>);
};

/**
 * Buffer from multiple geometries to a specific point.
 * Uses the minimum distance from any geometry to the point as the buffer radius.
 * Replaces the web app's arcBufferToPoint (@arcgis/core).
 */
export const turfBufferToPoint = (
  geometry: FeatureCollection,
  lat: number,
  lng: number,
): Feature<Polygon | MultiPolygon> | null => {
  const targetPoint = point([lng, lat]);

  // Compute distance from each feature's centroid to the target point
  const distances = geometry.features.map((f) => {
    const c = centroid(f);
    return turfDistance(c, targetPoint, { units: "miles" });
  });

  const minDist = Math.min(...distances);
  return turfBuffer(geometry, minDist, "miles");
};
```

- [ ] **Step 5: Create barrel export**

```typescript
// lib/maps/geo-utils/index.ts
export {
  safeUnion,
  holedMask,
  modifyMapData,
  turfBuffer,
  turfBufferToPoint,
} from "./operators";
export { geoSpatialVoronoi } from "./voronoi";
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
npx jest lib/maps/__tests__/geo-utils.test.ts --no-cache
```

Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
git add lib/maps/
git commit -m "feat: add geo-utils (safeUnion, modifyMapData, turfBuffer, holedMask)"
```

---

## Phase 2: Hiderify + Overpass

### Task 4: Overpass Client

**Files:**
- Create: `lib/overpass.ts`

- [ ] **Step 1: Implement overpass fetch client**

```typescript
// lib/overpass.ts
import { BACKEND_URL } from "./config";

export async function overpassFetch(
  query: string,
  timeoutMs = 60_000,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${BACKEND_URL}/api/overpass`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`Overpass error: ${resp.status}`);
    return resp.json();
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
git add lib/overpass.ts
git commit -m "feat: add Overpass backend proxy client"
```

---

### Task 5: Hiderify — Radius

**Files:**
- Create: `lib/maps/questions/radius.ts`
- Create: `lib/maps/__tests__/hiderify.test.ts`

- [ ] **Step 1: Write test for hiderifyRadius**

```typescript
// lib/maps/__tests__/hiderify.test.ts
import { hiderifyRadius } from "../questions/radius";

describe("hiderifyRadius", () => {
  const baseQuestion = {
    lat: 50,
    lng: 10,
    radius: 5,
    unit: "kilometers" as const,
  };

  it("returns within=true when hider is inside radius", () => {
    // Hider at ~2km from center
    const result = hiderifyRadius(baseQuestion, { lat: 50.01, lng: 10.01 });
    expect(result.answerData.within).toBe(true);
    expect(result.preview.positive).toBe(true);
  });

  it("returns within=false when hider is outside radius", () => {
    // Hider at ~100km from center
    const result = hiderifyRadius(baseQuestion, { lat: 51, lng: 11 });
    expect(result.answerData.within).toBe(false);
    expect(result.preview.positive).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
npx jest lib/maps/__tests__/hiderify.test.ts --no-cache
```

Expected: FAIL — `Cannot find module '../questions/radius'`

- [ ] **Step 3: Implement radius hiderify + adjust + planning**

```typescript
// lib/maps/questions/radius.ts
import distance from "@turf/distance";
import { point, featureCollection } from "@turf/helpers";
import polygonToLine from "@turf/polygon-to-line";
import type { FeatureCollection, Polygon, MultiPolygon } from "geojson";

import { turfBuffer, modifyMapData } from "../geo-utils";

interface AnswerPreview {
  label: string;
  positive: boolean;
}

export function hiderifyRadius(
  questionData: { lat: number; lng: number; radius: number; unit: string },
  hiderPosition: { lat: number; lng: number },
): { answerData: Record<string, unknown>; preview: AnswerPreview } {
  const dist = distance(
    point([questionData.lng, questionData.lat]),
    point([hiderPosition.lng, hiderPosition.lat]),
    { units: questionData.unit as any },
  );

  const within = dist <= questionData.radius;

  return {
    answerData: { ...questionData, within },
    preview: {
      label: within ? "Im Radius" : "Außerhalb",
      positive: within,
    },
  };
}

export async function adjustPerRadius(
  questionData: { lat: number; lng: number; radius: number; unit: string; within: boolean },
  mapData: FeatureCollection<Polygon | MultiPolygon>,
) {
  const pt = point([questionData.lng, questionData.lat]);
  const circle = turfBuffer(
    featureCollection([pt]),
    questionData.radius,
    questionData.unit,
  );
  if (!circle) return mapData;
  return modifyMapData(mapData, circle, questionData.within);
}

export async function radiusPlanningPolygon(
  questionData: { lat: number; lng: number; radius: number; unit: string },
) {
  const pt = point([questionData.lng, questionData.lat]);
  const circle = turfBuffer(
    featureCollection([pt]),
    questionData.radius,
    questionData.unit,
  );
  if (!circle) return null;
  return polygonToLine(circle as any);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
npx jest lib/maps/__tests__/hiderify.test.ts --no-cache
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
git add lib/maps/
git commit -m "feat: add radius hiderify, adjust, and planning polygon"
```

---

### Task 6: Hiderify — Thermometer

**Files:**
- Create: `lib/maps/questions/thermometer.ts`
- Modify: `lib/maps/__tests__/hiderify.test.ts`

- [ ] **Step 1: Write test for hiderifyThermometer**

Add to `lib/maps/__tests__/hiderify.test.ts`:

```typescript
import { hiderifyThermometer } from "../questions/thermometer";

describe("hiderifyThermometer", () => {
  const baseQuestion = {
    latA: 50, lngA: 10,   // Point A
    latB: 50, lngB: 12,   // Point B (east of A)
  };

  it("returns warmer or colder based on hider position", () => {
    // Hider near point B → warmer
    const result = hiderifyThermometer(baseQuestion, { lat: 50, lng: 11.5 });
    expect(typeof result.answerData.warmer).toBe("boolean");
    expect(result.preview.label).toMatch(/Wärmer|Kälter/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
npx jest lib/maps/__tests__/hiderify.test.ts --no-cache
```

Expected: FAIL — `Cannot find module '../questions/thermometer'`

- [ ] **Step 3: Implement thermometer hiderify + adjust + planning**

```typescript
// lib/maps/questions/thermometer.ts
import { point, featureCollection } from "@turf/helpers";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import intersect from "@turf/intersect";
import polygonToLine from "@turf/polygon-to-line";
import type { FeatureCollection, Polygon, MultiPolygon } from "geojson";

import { geoSpatialVoronoi, safeUnion } from "../geo-utils";

interface AnswerPreview {
  label: string;
  positive: boolean;
}

export function hiderifyThermometer(
  questionData: { latA: number; lngA: number; latB: number; lngB: number },
  hiderPosition: { lat: number; lng: number },
): { answerData: Record<string, unknown>; preview: AnswerPreview } {
  const pointA = point([questionData.lngA, questionData.latA]);
  const pointB = point([questionData.lngB, questionData.latB]);

  const voronoi = geoSpatialVoronoi(featureCollection([pointA, pointB]));
  const hiderPoint = point([hiderPosition.lng, hiderPosition.lat]);

  const warmer = booleanPointInPolygon(hiderPoint, voronoi.features[1]) === true;

  return {
    answerData: { ...questionData, warmer },
    preview: {
      label: warmer ? "Wärmer" : "Kälter",
      positive: warmer,
    },
  };
}

export function adjustPerThermometer(
  questionData: { latA: number; lngA: number; latB: number; lngB: number; warmer: boolean },
  mapData: FeatureCollection<Polygon | MultiPolygon>,
) {
  const pointA = point([questionData.lngA, questionData.latA]);
  const pointB = point([questionData.lngB, questionData.latB]);
  const voronoi = geoSpatialVoronoi(featureCollection([pointA, pointB]));

  const region = questionData.warmer ? voronoi.features[1] : voronoi.features[0];
  return intersect(featureCollection([safeUnion(mapData), region]));
}

export function thermometerPlanningPolygon(
  questionData: { latA: number; lngA: number; latB: number; lngB: number },
) {
  const pointA = point([questionData.lngA, questionData.latA]);
  const pointB = point([questionData.lngB, questionData.latB]);
  const voronoi = geoSpatialVoronoi(featureCollection([pointA, pointB]));

  return featureCollection(
    voronoi.features
      .map((f: any) => polygonToLine(f))
      .flatMap((line: any) =>
        line.type === "FeatureCollection" ? line.features : [line],
      ),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
npx jest lib/maps/__tests__/hiderify.test.ts --no-cache
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
git add lib/maps/
git commit -m "feat: add thermometer hiderify, adjust, and planning polygon"
```

---

### Task 7: Hiderify — Tentacles, Matching, Measuring

**Files:**
- Create: `lib/maps/questions/tentacles.ts`
- Create: `lib/maps/questions/matching.ts`
- Create: `lib/maps/questions/measuring.ts`
- Create: `lib/overpass-queries.ts`

**Note:** These are the most complex question types. Port the logic from the web app (`src/maps/questions/tentacles.ts`, `matching.ts`, `measuring.ts`). The key differences from web:
- Replace `hiderMode.get()` → hiderPosition parameter
- Replace `arcBuffer` → `turfBuffer`
- Replace `arcBufferToPoint` → `turfBufferToPoint`
- Replace `@turf/turf` → individual imports
- Replace `import.meta.env` → config imports
- Replace toast notifications → console.warn (or throw)

- [ ] **Step 1: Create Overpass query helpers**

Port from `src/maps/api/overpass.ts` — the key functions needed are `findTentacleLocations`, `findPlacesInZone`, `findPlacesSpecificInZone`, `findAdminBoundary`. Adapt imports for RN.

```typescript
// lib/overpass-queries.ts
import osmtogeojson from "osmtogeojson";
import { overpassFetch } from "./overpass";
// ... port the query functions from web app's src/maps/api/overpass.ts
// Key adaptations:
// - Replace overpassFetch import path
// - Replace any browser-specific APIs
// - Use osmtogeojson with JSON input only
```

Save as `lib/overpass-queries.ts`. This file will be ~200-300 lines porting the Overpass query builders.

- [ ] **Step 2: Implement tentacles**

Port from `src/maps/questions/tentacles.ts`. Key adaptations:
- `hiderifyTentacles(questionData, hiderPosition)` — takes position as param
- Replace `arcBuffer` → `turfBuffer`
- Replace `hiderMode.get()` → `hiderPosition`

Save as `lib/maps/questions/tentacles.ts`.

- [ ] **Step 3: Implement matching**

Port from `src/maps/questions/matching.ts`. Key adaptations:
- `hiderifyMatching(questionData, hiderPosition)` — takes position as param
- Replace `arcBuffer` → `turfBuffer`
- Replace `mapGeoJSON.get()` / `polyGeoJSON.get()` → pass mapGeoData as parameter
- Memoization: use simple Map cache keyed by JSON.stringify of params

Save as `lib/maps/questions/matching.ts`.

- [ ] **Step 4: Implement measuring**

Port from `src/maps/questions/measuring.ts`. Key adaptations:
- `hiderifyMeasuring(questionData, hiderPosition)` — takes position as param
- Replace `arcBuffer` → `turfBuffer`, `arcBufferToPoint` → `turfBufferToPoint`
- Replace `mapGeoJSON.get()` → pass mapGeoData as parameter

Save as `lib/maps/questions/measuring.ts`.

- [ ] **Step 5: Write tests for all three**

Add to `lib/maps/__tests__/hiderify.test.ts`:

```typescript
import { hiderifyTentacles } from "../questions/tentacles";
import { hiderifyMatching } from "../questions/matching";
import { hiderifyMeasuring } from "../questions/measuring";

// Note: These tests need mocked Overpass responses.
// Mock the overpass module:
jest.mock("../../overpass", () => ({
  overpassFetch: jest.fn().mockResolvedValue({ elements: [] }),
}));

describe("hiderifyTentacles", () => {
  it("returns location=false when hider is outside radius", async () => {
    const q = {
      lat: 50, lng: 10, radius: 5, unit: "kilometers",
      locationType: "custom", places: [],
    };
    const result = await hiderifyTentacles(q, { lat: 60, lng: 20 });
    expect(result.answerData.location).toBe(false);
  });
});

// Add similar basic tests for matching and measuring
```

- [ ] **Step 6: Run tests**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
npx jest lib/maps/__tests__/hiderify.test.ts --no-cache
```

Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
git add lib/maps/ lib/overpass-queries.ts
git commit -m "feat: add tentacles, matching, measuring hiderify + overpass queries"
```

---

### Task 8: Hiderify Dispatcher + Pipeline

**Files:**
- Create: `lib/maps/hiderify.ts`
- Create: `lib/maps/pipeline.ts`
- Create: `lib/maps/__tests__/pipeline.test.ts`

- [ ] **Step 1: Implement hiderify dispatcher**

```typescript
// lib/maps/hiderify.ts
import type { SessionQuestion } from "../../shared/types";
import { hiderifyRadius } from "./questions/radius";
import { hiderifyThermometer } from "./questions/thermometer";
import { hiderifyTentacles } from "./questions/tentacles";
import { hiderifyMatching } from "./questions/matching";
import { hiderifyMeasuring } from "./questions/measuring";

export interface AnswerPreview {
  label: string;
  positive: boolean;
}

export interface HiderifyResult {
  answerData: Record<string, unknown>;
  preview: AnswerPreview;
}

export async function hiderifyQuestion(
  question: SessionQuestion,
  hiderPosition: { lat: number; lng: number },
): Promise<HiderifyResult> {
  const data = question.data as Record<string, any>;

  switch (question.type) {
    case "radius":
      return hiderifyRadius(data as any, hiderPosition);
    case "thermometer":
      return hiderifyThermometer(data as any, hiderPosition);
    case "tentacles":
      return hiderifyTentacles(data as any, hiderPosition);
    case "matching":
      return hiderifyMatching(data as any, hiderPosition);
    case "measuring":
      return hiderifyMeasuring(data as any, hiderPosition);
    case "photo":
      return { answerData: {}, preview: { label: "Foto-Frage", positive: true } };
    default:
      throw new Error(`Unknown question type: ${question.type}`);
  }
}
```

- [ ] **Step 2: Implement pipeline**

```typescript
// lib/maps/pipeline.ts
import { featureCollection } from "@turf/helpers";
import intersect from "@turf/intersect";
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from "geojson";

import { safeUnion } from "./geo-utils";
import { adjustPerRadius, radiusPlanningPolygon } from "./questions/radius";
import { adjustPerThermometer, thermometerPlanningPolygon } from "./questions/thermometer";
import { adjustPerTentacle, tentaclesPlanningPolygon } from "./questions/tentacles";
import { adjustPerMatching, matchingPlanningPolygon } from "./questions/matching";
import { adjustPerMeasuring, measuringPlanningPolygon } from "./questions/measuring";

export async function adjustMapGeoDataForQuestion(
  question: { type: string; data: any },
  mapGeoData: FeatureCollection<Polygon | MultiPolygon>,
): Promise<FeatureCollection<Polygon | MultiPolygon>> {
  // Shortcut: pre-computed GeoJSON
  if (question.data?.computedGeoJSON) {
    try {
      const precomputed = question.data.computedGeoJSON;
      const feature =
        precomputed.type === "FeatureCollection"
          ? safeUnion(precomputed)
          : precomputed;
      if (feature) {
        const result = intersect(featureCollection([safeUnion(mapGeoData), feature]));
        if (result) return { type: "FeatureCollection", features: [result] };
      }
    } catch { /* fall through */ }
  }

  try {
    let result: any;
    switch (question.type) {
      case "radius":
        result = await adjustPerRadius(question.data, mapGeoData);
        break;
      case "thermometer":
        result = adjustPerThermometer(question.data, mapGeoData);
        break;
      case "tentacles":
        if (question.data.location === false) {
          result = await adjustPerRadius({ ...question.data, within: false }, mapGeoData);
        } else {
          result = await adjustPerTentacle(question.data, mapGeoData);
        }
        break;
      case "matching":
        result = await adjustPerMatching(question.data, mapGeoData);
        break;
      case "measuring":
        result = await adjustPerMeasuring(question.data, mapGeoData);
        break;
      default:
        return mapGeoData;
    }
    if (!result) return mapGeoData;
    if (result.type !== "FeatureCollection") {
      return { type: "FeatureCollection", features: [result] };
    }
    return result;
  } catch (err) {
    console.error(`[adjustMapGeoDataForQuestion] Failed for type="${question.type}":`, err);
    return mapGeoData;
  }
}

export async function determinePlanningPolygon(
  question: { type: string; data: any; status: string },
  planningModeEnabled: boolean,
) {
  // Planning polygons only for pending (unanswered) questions in planning mode
  if (!planningModeEnabled || question.status !== "pending") return undefined;

  switch (question.type) {
    case "radius":      return radiusPlanningPolygon(question.data);
    case "thermometer": return thermometerPlanningPolygon(question.data);
    case "tentacles":   return tentaclesPlanningPolygon(question.data);
    case "matching":    return matchingPlanningPolygon(question.data);
    case "measuring":   return measuringPlanningPolygon(question.data);
  }
}

export async function applyQuestionsToMapGeoData(
  questions: Array<{ type: string; data: any; status: string }>,
  mapGeoData: FeatureCollection<Polygon | MultiPolygon>,
  planningModeEnabled: boolean,
  planningModeCallback?: (polygon: any, question: any) => void,
): Promise<FeatureCollection<Polygon | MultiPolygon>> {
  for (const question of questions) {
    if (planningModeCallback) {
      const planningPolygon = await determinePlanningPolygon(question, planningModeEnabled);
      if (planningPolygon) planningModeCallback(planningPolygon, question);
    }
    // Only adjust answered questions (planning mode still shows elimination from past answers)
    if (question.status !== "answered") continue;

    mapGeoData = await adjustMapGeoDataForQuestion(question, mapGeoData);

    if (!mapGeoData) return { type: "FeatureCollection", features: [] };
    if (mapGeoData.type !== "FeatureCollection") {
      mapGeoData = { type: "FeatureCollection", features: [mapGeoData as any] };
    }
  }
  return mapGeoData;
}
```

- [ ] **Step 3: Write pipeline test**

```typescript
// lib/maps/__tests__/pipeline.test.ts
import { adjustMapGeoDataForQuestion } from "../pipeline";
import { featureCollection, polygon } from "@turf/helpers";

describe("pipeline", () => {
  const worldPoly = featureCollection([
    polygon([[[-180,-90],[180,-90],[180,90],[-180,90],[-180,-90]]]),
  ]);

  it("adjusts map data for a radius question", async () => {
    const question = {
      type: "radius",
      data: { lat: 50, lng: 10, radius: 100, unit: "kilometers", within: true },
    };
    const result = await adjustMapGeoDataForQuestion(question, worldPoly as any);
    expect(result.type).toBe("FeatureCollection");
    expect(result.features.length).toBeGreaterThan(0);
  });

  it("returns mapData unchanged for unknown question type", async () => {
    const question = { type: "unknown", data: {} };
    const result = await adjustMapGeoDataForQuestion(question, worldPoly as any);
    expect(result).toBe(worldPoly);
  });
});
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
npx jest lib/maps/__tests__/pipeline.test.ts --no-cache
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
git add lib/maps/
git commit -m "feat: add hiderify dispatcher and map data pipeline"
```

---

## Phase 3: GPS + Store + Card Costs

### Task 9: Enable GPS for Hiders

**Files:**
- Modify: `hooks/useGpsTracking.ts`

- [ ] **Step 1: Update GPS tracking guard to include hiders**

In `hooks/useGpsTracking.ts`, change the role guard. Hiders get GPS tracking but do NOT broadcast position to server.

Find the line:
```typescript
if (role !== "seeker" || !sessionCode) return;
```

Replace with:
```typescript
if (!role || !sessionCode) return;
```

Then wrap TWO things in a role check:

1. **Background location registration** — only seekers need background GPS. Wrap the `requestBackgroundPermissionsAsync()` + `TaskManager` registration in:
```typescript
if (role === "seeker") {
  // ... background permission request + task registration
}
```

2. **WS/REST position broadcast** — only seekers send position to server. Find where `postGpsPosition` or WS position update is called and wrap it:
```typescript
if (role === "seeker") {
  // ... existing WS/REST position broadcast code
}
```

The `setOwnGpsPosition` call and foreground `Location.watchPositionAsync` should remain for BOTH roles.

- [ ] **Step 2: Verify existing tests still pass**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
npx jest --no-cache
```

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
git add hooks/useGpsTracking.ts
git commit -m "feat: enable GPS tracking for hiders (local only, no broadcast)"
```

---

### Task 10: Store Extensions + Card Costs

**Files:**
- Modify: `lib/session-store.ts`
- Create: `lib/card-costs.ts`

- [ ] **Step 1: Add planning mode and geo state to store**

In `lib/session-store.ts`, add to the interface and initial state:

```typescript
// Add to SessionState interface:
planningModeEnabled: boolean;
setPlanningModeEnabled: (enabled: boolean) => void;

// Add to initialInMemoryState:
planningModeEnabled: false,

// Add to the create() body:
setPlanningModeEnabled: (enabled) => set({ planningModeEnabled: enabled }),
```

- [ ] **Step 2: Create card costs**

```typescript
// lib/card-costs.ts
export const CARD_COSTS: Record<string, { draw: number; keep: number }> = {
  radius:      { draw: 2, keep: 1 },
  matching:    { draw: 3, keep: 1 },
  measuring:   { draw: 3, keep: 1 },
  thermometer: { draw: 2, keep: 1 },
  photo:       { draw: 1, keep: 1 },
  tentacles:   { draw: 4, keep: 2 },
};

export function getCardCost(type: string): { draw: number; keep: number } | null {
  return CARD_COSTS[type] ?? null;
}
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
npx jest --no-cache
```

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
git add lib/session-store.ts lib/card-costs.ts
git commit -m "feat: add planning mode to store and card cost definitions"
```

---

## Phase 4: UI — Answer Flow + Card Draw

### Task 11: Card Draw Overlay

**Files:**
- Create: `components/CardDrawOverlay.tsx`

- [ ] **Step 1: Implement card draw modal**

```typescript
// components/CardDrawOverlay.tsx
import React from "react";
import { Modal, View, Text, Pressable, StyleSheet } from "react-native";

interface CardDrawOverlayProps {
  visible: boolean;
  draw: number;
  keep: number;
  onDismiss: () => void;
}

export function CardDrawOverlay({ visible, draw, keep, onDismiss }: CardDrawOverlayProps) {
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Du darfst Karten ziehen!</Text>

          <View style={styles.cardRow}>
            {Array.from({ length: draw }, (_, i) => (
              <Text key={`d${i}`} style={[styles.cardEmoji, styles.faded]}>🃏</Text>
            ))}
            <Text style={styles.arrow}>›</Text>
            {Array.from({ length: keep }, (_, i) => (
              <Text key={`k${i}`} style={styles.cardEmoji}>🃏</Text>
            ))}
          </View>

          <Text style={styles.subtitle}>
            Ziehe {draw}, behalte {keep}
          </Text>

          <Pressable style={styles.button} onPress={onDismiss}>
            <Text style={styles.buttonText}>Weiter</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    width: "80%",
  },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 16 },
  subtitle: { fontSize: 14, color: "#666", marginTop: 8 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  cardEmoji: { fontSize: 36 },
  faded: { opacity: 0.4 },
  arrow: { fontSize: 24, marginHorizontal: 8, color: "#999" },
  button: {
    marginTop: 20,
    backgroundColor: "#1F2F3F",
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
```

- [ ] **Step 2: Commit**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
git add components/CardDrawOverlay.tsx
git commit -m "feat: add CardDrawOverlay component"
```

---

### Task 12: Update QuestionAnswerSheet — Hiderify Preview + Override

**Files:**
- Modify: `components/QuestionAnswerSheet.tsx`

- [ ] **Step 1: Rewrite QuestionAnswerSheet with hiderify integration**

Replace the current GPS-only answer logic with:
1. On mount/question change: call `hiderifyQuestion()` with GPS position
2. Show preview label (green/red)
3. "Antwort senden" sends auto-calculated answer
4. "Manuell überschreiben" shows type-specific override controls
5. After successful answer: trigger CardDrawOverlay

Key changes:
- Import `hiderifyQuestion` from `lib/maps/hiderify`
- Import `getCardCost` from `lib/card-costs`
- Add states: `hiderifyResult`, `isOverriding`, `overrideValue`, `cardDraw`, `loading`
- `useEffect` on question to auto-compute hiderify
- Override UI varies by question type (toggle buttons, dropdown etc.)
- On submit success: set `cardDraw` state from `getCardCost(question.type)`

Photo questions remain unchanged (existing PhotoCapture flow).

- [ ] **Step 2: Verify app compiles**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
git add components/QuestionAnswerSheet.tsx
git commit -m "feat: integrate hiderify preview and manual override in answer sheet"
```

---

### Task 13: Update QuestionPanel — Card Draw Integration

**Files:**
- Modify: `components/QuestionPanel.tsx`

- [ ] **Step 1: Add CardDrawOverlay to QuestionPanel**

Import and render `CardDrawOverlay`. When `QuestionAnswerSheet` signals a successful answer with card cost, show the overlay.

Add state:
```typescript
const [cardDraw, setCardDraw] = useState<{ draw: number; keep: number } | null>(null);
```

Pass `onAnswerSuccess={(cost) => setCardDraw(cost)}` to QuestionAnswerSheet.

Render:
```typescript
<CardDrawOverlay
  visible={cardDraw !== null}
  draw={cardDraw?.draw ?? 0}
  keep={cardDraw?.keep ?? 0}
  onDismiss={() => setCardDraw(null)}
/>
```

- [ ] **Step 2: Commit**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
git add components/QuestionPanel.tsx
git commit -m "feat: add card draw overlay to question panel"
```

---

## Phase 5: Map Visualization

### Task 14: GameMap — Elimination Zones + Planning Overlays

**Files:**
- Modify: `components/GameMap.tsx`

- [ ] **Step 1: Add GeoJSON layer imports and state**

Import `Geojson` from `react-native-maps`. Add state for elimination and planning GeoJSON. Add a `useEffect` that runs the pipeline when answered questions change.

```typescript
import { Geojson } from "react-native-maps";
import { applyQuestionsToMapGeoData } from "../lib/maps/pipeline";

// In component:
const [eliminationGeoJSON, setEliminationGeoJSON] = useState<any>(null);
const [planningGeoJSON, setPlanningGeoJSON] = useState<any>(null);
const questions = useSessionStore((s) => s.sessionQuestions);
const currentSession = useSessionStore((s) => s.currentSession);
const planningMode = useSessionStore((s) => s.planningModeEnabled);
const role = useSessionStore((s) => s.getRole());
```

- [ ] **Step 2: Build base polygon from session mapLocation**

```typescript
useEffect(() => {
  if (role !== "hider" || !currentSession?.mapLocation) return;

  async function computeElimination() {
    // Build base polygon from session's map location
    // For now, use a large bounding box as fallback
    const baseGeoJSON = /* parse from session.mapLocation.osmFeature or world bbox */;

    const answeredQuestions = questions
      .filter((q) => q.status === "answered" && q.answerData)
      .map((q) => ({ type: q.type, data: q.answerData, status: q.status }));

    if (answeredQuestions.length === 0) {
      setEliminationGeoJSON(null);
      return;
    }

    const planningPolygons: any[] = [];
    const result = await applyQuestionsToMapGeoData(
      answeredQuestions,
      baseGeoJSON,
      planningMode,
      (polygon) => planningPolygons.push(polygon),
    );

    setEliminationGeoJSON(result);
    if (planningPolygons.length > 0) {
      setPlanningGeoJSON({
        type: "FeatureCollection",
        features: planningPolygons.flatMap((p) =>
          p.type === "FeatureCollection" ? p.features : [p]
        ),
      });
    }
  }

  computeElimination().catch(console.error);
}, [questions, currentSession, planningMode, role]);
```

- [ ] **Step 3: Render GeoJSON layers**

```typescript
// Inside MapView:
{eliminationGeoJSON && role === "hider" && (
  <Geojson
    geojson={eliminationGeoJSON}
    fillColor="rgba(0, 150, 0, 0.15)"
    strokeColor="rgba(0, 150, 0, 0.5)"
    strokeWidth={2}
  />
)}

{planningGeoJSON && role === "hider" && (
  <Geojson
    geojson={planningGeoJSON}
    strokeColor="rgba(255, 255, 0, 0.6)"
    strokeWidth={2}
  />
)}
```

- [ ] **Step 4: Verify app compiles and renders**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
git add components/GameMap.tsx
git commit -m "feat: add elimination zone and planning mode GeoJSON layers to map"
```

---

## Phase 6: Game Status + Planning Toggle

### Task 15: WebSocket — Game Status Handling

**Files:**
- Modify: `hooks/useSessionWebSocket.ts`

- [ ] **Step 1: Add session_status_changed handler**

In `useSessionWebSocket.ts`, find the message handler switch. The `session_status_changed` case should already exist from the initial implementation. Verify it updates `currentSession.status`:

```typescript
case "session_status_changed": {
  const current = useSessionStore.getState().currentSession;
  if (current) {
    useSessionStore.getState().setCurrentSession({
      ...current,
      status: event.status,
    });
  }
  break;
}
```

If it doesn't exist, add it.

- [ ] **Step 2: Update QuestionPanel to respect game status**

In `QuestionPanel.tsx`, disable answer buttons when session status is "finished":

```typescript
const sessionStatus = useSessionStore((s) => s.currentSession?.status);
// ... in render:
{sessionStatus === "finished" && (
  <Text style={styles.finishedBanner}>Spiel beendet</Text>
)}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
git add hooks/useSessionWebSocket.ts components/QuestionPanel.tsx
git commit -m "feat: handle game status changes and disable answers when finished"
```

---

### Task 16: Planning Mode Toggle

**Files:**
- Modify: `app/(tabs)/settings.tsx`

- [ ] **Step 1: Add planning mode switch to settings**

```typescript
import { Switch } from "react-native";
// ...
const planningMode = useSessionStore((s) => s.planningModeEnabled);
const setPlanningMode = useSessionStore((s) => s.setPlanningModeEnabled);
// ...
// Add to the settings UI, after the session info section:
{role === "hider" && (
  <View style={styles.settingRow}>
    <Text style={styles.settingLabel}>Planning Mode</Text>
    <Switch value={planningMode} onValueChange={setPlanningMode} />
  </View>
)}
```

- [ ] **Step 2: Verify app compiles**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
git add app/(tabs)/settings.tsx
git commit -m "feat: add planning mode toggle to settings screen"
```

---

## Phase 7: Integration Test

### Task 17: End-to-End Verification

- [ ] **Step 1: Run all tests**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
npx jest --no-cache
```

Expected: All tests PASS.

- [ ] **Step 2: TypeScript check**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Manual test checklist**

Test with the web app running as seeker + mobile app as hider:

1. Create session in web app (with game area defined)
2. Join session in mobile app as hider
3. Seeker sends radius question → hider sees "Neue Frage" push notification
4. Open question panel → hiderify auto-calculates "Im Radius" / "Außerhalb"
5. Tap "Antwort senden" → card draw overlay shows
6. Map shows elimination zone (green overlay)
7. Toggle planning mode in settings → see yellow dashed outlines for pending questions
8. Seeker finishes game → "Spiel beendet" banner appears

- [ ] **Step 4: Final commit**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
git add -A
git commit -m "feat: complete hider gameplay — hiderify, visualization, card draw, planning mode"
```
