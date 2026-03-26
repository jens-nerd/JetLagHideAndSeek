# Spec B: Mobile Hider Gameplay

**Scope:** Fragen beantworten (Hiderify + GPS-Autoberechnung mit manuellem Override), Antwort-Visualisierung auf Karte, Kartenkosten/Card Draw, Spielstatus setzen, Planning Mode — 1:1 Feature-Parität mit der Web-App.

**Repo:** `/Users/jensvielhaben-nl001/hideandseek-mobile/`

**Vorbedingung:** Spielgebiet wird in der Web-App definiert. Die Mobile App liest `session.mapLocation` aus dem Backend (`GET /api/sessions/:code`) und baut daraus das Basis-Polygon für die Visualisierungspipeline. Spec A (eigene Gebietsdefinition in der Mobile App) wird nachgelagert umgesetzt.

---

## 1. Übersicht

Der Hider in der Mobile App empfängt Fragen per WebSocket (`question_added`), beantwortet sie, und sieht die Antwort-Visualisierung (Eliminierungszonen) auf der MapLibre-Karte. Die zentrale Neuerung gegenüber der Web-App: **Die Hider-Position kommt vom Geräte-GPS** statt von einem manuell gesetzten Marker.

**Kernflow:**
1. Push-Notification + WS-Event: "Neue Frage!" → Hider öffnet Fragen-Panel
2. Hiderify berechnet Antwort automatisch aus GPS-Position
3. Hider sieht Live-Preview der berechneten Antwort
4. Hider kann manuell überschreiben (Override)
5. Hider sendet Antwort → Card-Draw-Overlay
6. Karte zeigt kumulative Eliminierungszonen

---

## 2. Hiderify-Logik

### 2.1 Architektur

Die Hiderify-Logik wird 1:1 aus der Web-App portiert. Jeder Fragetyp hat eine eigene Hiderify-Funktion, die aus der Hider-Position und den Frage-Parametern die Antwort berechnet.

**Dateien:**
```
lib/maps/
  hiderify.ts              — Dispatcher (hiderifyQuestion)
  questions/
    radius.ts              — hiderifyRadius
    thermometer.ts         — hiderifyThermometer
    tentacles.ts           — hiderifyTentacles
    matching.ts            — hiderifyMatching
    measuring.ts           — hiderifyMeasuring
  geo-utils/
    voronoi.ts             — geoSpatialVoronoi (d3-geo-voronoi)
    operators.ts           — safeUnion, modifyMapData, arcBuffer, arcBufferToPoint, holedMask
    index.ts               — Barrel exports
```

### 2.2 GPS-Position als Hider-Position

Statt `hiderMode.get()` (Web-App Nanostores Atom) liest die Mobile App die GPS-Position aus dem Zustand-Store:

```typescript
// Quelle: useSessionStore.getState().ownGpsPosition
// Typ: { lat: number; lng: number } | null
```

**Voraussetzung:** Der bestehende `useGpsTracking` Hook trackt GPS aktuell **nur für Seeker** (Guard: `if (role !== "seeker") return`). Dieser Hook muss erweitert werden, damit er auch für Hider läuft:
- Hider: GPS-Position wird in `ownGpsPosition` im Store geschrieben (identisch zu Seeker)
- Hider: Position wird **nicht** per WS/REST an den Server gesendet (die Hider-Position ist geheim!)
- Hider: Nur Foreground-Tracking nötig (kein Background-Task, da Hider die App aktiv nutzt zum Beantworten)

Änderung in `hooks/useGpsTracking.ts`: Guard auf `if (!sessionCode) return` ändern, WS-Broadcast nur wenn `role === "seeker"`.

### 2.3 Hiderify-Dispatcher

```typescript
// lib/maps/hiderify.ts
import type { SessionQuestion } from "../../shared/types";

export async function hiderifyQuestion(
  question: SessionQuestion,
  hiderPosition: { lat: number; lng: number },
): Promise<{ answerData: Record<string, unknown>; preview: AnswerPreview }> {
  switch (question.type) {
    case "radius":      return hiderifyRadius(question, hiderPosition);
    case "thermometer": return hiderifyThermometer(question, hiderPosition);
    case "tentacles":   return hiderifyTentacles(question, hiderPosition);
    case "matching":    return hiderifyMatching(question, hiderPosition);
    case "measuring":   return hiderifyMeasuring(question, hiderPosition);
    case "photo":       return { answerData: {}, preview: { label: "Foto-Frage", positive: true } };
    default:            throw new Error(`Unknown question type: ${question.type}`);
  }
}

interface AnswerPreview {
  label: string;       // z.B. "Im Radius ✓" oder "Außerhalb ✗"
  positive: boolean;   // true = grün, false = rot
}
```

**Unterschied zur Web-App:** Die Position wird als Parameter übergeben statt aus einem globalen Atom gelesen. Das macht die Funktionen testbar und ermöglicht den manuellen Override.

### 2.4 Fragetypen — Hiderify-Logik

**Radius:**
- Berechnet Distanz (Turf `distance`) vom Fragezentrum zur Hider-Position
- `within = distance <= question.data.radius`
- Preview: "Im Radius" (grün) / "Außerhalb" (rot)

**Thermometer:**
- Erstellt Voronoi-Diagramm aus Punkt A + Punkt B (`geoSpatialVoronoi`)
- Prüft mit `booleanPointInPolygon` in welcher Hälfte der Hider ist
- `warmer = true/false`
- Preview: "Wärmer" (rot) / "Kälter" (blau)

**Tentacles:**
- Lädt POI-Liste (aus `question.data.places` oder via Overpass-Backend-Proxy)
- Filtert POIs innerhalb des Radius (`filterPointsWithinRadius`)
- Erstellt Voronoi über POIs
- Findet POI, dessen Voronoi-Zelle den Hider enthält
- Wenn Hider außerhalb des Radius: `location = false`
- Preview: POI-Name oder "Außerhalb"

**Matching:**
- Komplexe Logik mit verschiedenen Boundary-Typen (Voronoi, Admin-Boundary, Letter-Zone)
- Für Home-Game POIs (Aquarium, Zoo etc.): nächster POI zu Seeker vs. nächster POI zu Hider → `same = true/false`
- Für andere: Boundary-Berechnung + Punkt-in-Polygon-Test
- Preview: "Gleich" / "Unterschiedlich"

**Measuring:**
- Ähnlich wie Matching, aber mit Distanz-Vergleich
- `hiderCloser = hiderDistance < seekerDistance`
- Preview: "Näher" / "Weiter weg"

### 2.5 Overpass-Proxy

Tentacles, Matching und Measuring brauchen Overpass-API-Queries für POI-Daten. Die Mobile App nutzt denselben Backend-Proxy wie die Web-App:

```typescript
// lib/overpass.ts
import { BACKEND_URL } from "./config";

export async function overpassFetch(query: string, timeoutMs = 60_000): Promise<unknown> {
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

---

## 3. Antwort-Flow (Hider UI)

### 3.1 Frage empfangen

1. WebSocket `question_added` Event → `upsertSessionQuestion()` im Store
2. Push-Notification zeigt "Neue Frage: [Typ]"
3. Hider öffnet App → QuestionPanel (Bottom Sheet) zeigt neue Frage

### 3.2 Frage beantworten

**UI im QuestionPanel (erweitert):**

```
┌─────────────────────────────────┐
│ 🌡️ Thermometer-Frage           │
│ Status: Ausstehend  ⏱ 04:32    │
│                                 │
│ ┌─ GPS-Vorschlag ─────────────┐ │
│ │ 📍 Berechnet: "Wärmer"      │ │
│ │    (basierend auf GPS)       │ │
│ │ [Antwort senden]             │ │
│ │                              │ │
│ │ ⚙ Manuell überschreiben     │ │
│ └──────────────────────────────┘ │
└─────────────────────────────────┘
```

**Flow:**
1. Frage wird expandiert → `hiderifyQuestion()` wird mit aktueller GPS-Position aufgerufen
2. Preview zeigt berechnete Antwort (grün/rot Label)
3. **Standard:** Hider tippt "Antwort senden" → sendet die auto-berechnete Antwort
4. **Override:** Hider tippt "Manuell überschreiben" → Toggle-Buttons erscheinen:
   - Radius: "Im Radius" / "Außerhalb"
   - Thermometer: "Wärmer" / "Kälter"
   - Tentacles: Dropdown mit POI-Liste
   - Matching: "Gleich" / "Unterschiedlich"
   - Measuring: "Näher" / "Weiter weg"
5. Nach Override: "Antwort senden" sendet die manuell gewählte Antwort

### 3.3 Foto-Fragen

Sonderfall — keine GPS-Berechnung nötig:
1. Zeigt Foto-Challenge-Beschreibung
2. Zwei Buttons: "Foto aufnehmen" (Kamera/Galerie via `expo-image-picker`) / "Nicht möglich"
3. PhotoCapture-Komponente existiert bereits
4. Upload via `uploadPhoto()` → `answerQuestion()` mit `photoUrl`

### 3.4 API-Call & answerData-Contract

```typescript
// Existiert bereits in lib/session-api.ts:
answerQuestion(questionId: string, token: string, body: AnswerQuestionRequest)
```

**answerData-Format:** Das Backend speichert `answerData` als opaken JSON-Blob (`unknown` in der Shared-Typdefinition, `JSON.stringify()` auf Backend-Seite). Es gibt **keine serverseitige Validierung** der Struktur — das Backend prüft nur, dass `answerData` vorhanden ist.

Die Hiderify-Funktionen geben `answerData` zurück, das die komplette modifizierte Frage-Daten enthält — identisch zum Web-App-Format. Beispiele:

| Fragetyp | answerData |
|----------|-----------|
| Radius | `{ ...questionData, within: true }` |
| Thermometer | `{ ...questionData, warmer: true }` |
| Tentacles | `{ ...questionData, location: { name: "POI", ... } }` |
| Matching | `{ ...questionData, same: true }` |
| Measuring | `{ ...questionData, hiderCloser: true }` |
| Photo | `{ photoUrl: "...", completed: true }` |

Das `answerData`-Objekt enthält die gesamte Frage-`data` plus die berechnete Antwort. So kann die Seeker-App (und später die Mobile-Seeker-Ansicht) die Antwort interpretieren und visualisieren.

---

## 4. Kartenkosten / Card Draw

### 4.1 Kosten-Definition

```typescript
// lib/card-costs.ts (neu)
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

### 4.2 Card-Draw-Overlay

Nach erfolgreichem `answerQuestion()`:
1. Overlay/Modal zeigt: "Du darfst Karten ziehen!"
2. Visuell: `draw` Karten-Emojis (blass) → Pfeil → `keep` Karten-Emojis (leuchtend)
3. Text: "Ziehe {draw}, behalte {keep}"
4. "Weiter"-Button schließt Overlay

Implementiert als React Native Modal oder Alert — kein Bottom Sheet, sondern zentriertes Overlay.

---

## 5. Antwort-Visualisierung auf Karte

### 5.1 Architektur

Die Karte zeigt kumulative Eliminierungszonen als GeoJSON-Layer. Jede beantwortete Frage schränkt den verbleibenden Bereich ein.

**Pipeline (identisch zur Web-App):**
```
Alle beantworteten Fragen
  → für jede: adjustMapGeoDataForQuestion(question, currentMapData)
  → progressive Intersection
  → Ergebnis = verbleibendes Gebiet als GeoJSON Polygon
```

### 5.2 Dateien

```
lib/maps/
  pipeline.ts             — applyQuestionsToMapGeoData (Master-Pipeline)
  questions/
    radius.ts             — adjustPerRadius (+ hiderify, planning)
    thermometer.ts        — adjustPerThermometer (+ hiderify, planning)
    tentacles.ts          — adjustPerTentacle (+ hiderify, planning)
    matching.ts           — adjustPerMatching (+ hiderify, planning)
    measuring.ts          — adjustPerMeasuring (+ hiderify, planning)
```

### 5.3 Adjust-Funktionen (pro Typ)

**Radius:**
- `arcBuffer()` erstellt geodätischen Kreis um Fragezentrum
- `modifyMapData(mapData, circle, within)`:
  - `within=true` → Intersection (nur innerhalb des Kreises bleibt)
  - `within=false` → Differenz (alles außerhalb bleibt)

**Thermometer:**
- Voronoi teilt Raum in zwei Halbebenen
- Intersection mit der passenden Halbebene (`warmer` → features[1], sonst features[0])

**Tentacles:**
- Voronoi über POIs + Kreis-Buffer → dreifache Intersection:
  `intersect(mapData, correctVoronoiCell, circleBuffer)`

**Matching:**
- Boundary-Berechnung (Voronoi, Admin-Boundary, oder Letter-Zone je nach Typ)
- `modifyMapData(mapData, boundary, same)`

**Measuring:**
- Buffer vom Fragezentrum zu POIs → `arcBufferToPoint()`
- `modifyMapData(mapData, buffer, hiderCloser)`

### 5.4 Karten-Rendering

**Hinweis:** `GameMap.tsx` nutzt aktuell `react-native-maps` (`MapView`, `Marker`, `UrlTile`), nicht MapLibre RN. Für GeoJSON-Overlay-Rendering gibt es zwei Optionen:

**Option A (empfohlen): `react-native-maps` `<Geojson>` Komponente:**
```typescript
import { Geojson } from "react-native-maps";

// In GameMap.tsx:
{eliminationGeoJSON && (
  <Geojson
    geojson={eliminationGeoJSON}
    fillColor="rgba(255, 0, 0, 0.3)"
    strokeColor="rgba(255, 0, 0, 0.6)"
    strokeWidth={1}
  />
)}
```

**Option B: Migration zu MapLibre RN** — bietet bessere GeoJSON-Performance (ShapeSource/FillLayer), aber erfordert Umbau von `GameMap.tsx`. Kann als Follow-up gemacht werden.

Die Pipeline liefert das **verbleibende** Gebiet. Das **eliminierte** Gebiet ist die Differenz zum Spielgebiet (aus Spec A). Beide werden als separate `<Geojson>` Layer angezeigt:
- Verbleibendes Gebiet: keine Füllung (klar sichtbare Karte)
- Eliminiertes Gebiet: rote semi-transparente Füllung

### 5.5 Trigger

Die Pipeline wird neu berechnet bei:
- Neuer beantworteter Frage (`question_answered` Event)
- App-Start (aus gespeicherten Fragen)

Ergebnis wird im lokalen State gecacht — nicht im Zustand-Store (zu groß für Persistierung).

---

## 6. Planning Mode

### 6.1 Funktionsweise

Planning Mode zeigt semi-transparente Umrisse der Frage-Geometrie für **unbeantwortete** Fragen. Der Hider sieht, welche Bereiche bei verschiedenen Antworten eliminiert würden.

### 6.2 Toggle

Neuer Toggle im QuestionPanel-Header (Zahnrad-Icon oder Switch):

```typescript
// Neuer State im Store:
planningModeEnabled: boolean  // default: false
setPlanningModeEnabled: (enabled: boolean) => void
```

### 6.3 Planning-Polygon-Berechnung

Für jede unbeantwortete Frage mit `status === "pending"`:

```typescript
// lib/maps/pipeline.ts
determinePlanningPolygon(question, planningModeEnabled):
  → radiusPlanningPolygon(question)        // Kreis-Umriss
  → thermometerPlanningPolygon(question)   // Voronoi-Trennlinie
  → tentaclesPlanningPolygon(question)     // Voronoi-Zellen innerhalb Kreis
  → matchingPlanningPolygon(question)      // Boundary-Umriss
  → measuringPlanningPolygon(question)     // Buffer-Umriss
```

Jede Funktion gibt eine `FeatureCollection` mit **LineStrings** zurück (keine gefüllten Polygone — nur Umrisse).

### 6.4 Karten-Rendering

```typescript
// Mit react-native-maps <Geojson>:
{planningGeoJSON && (
  <Geojson
    geojson={planningGeoJSON}
    strokeColor="rgba(255, 255, 0, 0.6)"
    strokeWidth={2}
    lineDashPattern={[4, 4]}
  />
)}
```

---

## 7. Spielstatus

### 7.1 Status-Übergänge

```
waiting → active → finished
```

- **waiting:** Session erstellt, Teilnehmer können beitreten
- **active:** Spiel läuft (Seeker setzt Status via WebSocket `set_status`)
- **finished:** Spiel beendet

### 7.2 Hider-seitige Aktionen

Der Hider hat keinen Button zum Starten/Beenden — das macht der Seeker. Aber der Hider muss auf Status-Changes reagieren:

**WebSocket `session_status_changed` Event:**
- Bereits im `useSessionWebSocket` Hook behandelbar
- Update: `setCurrentSession({ ...currentSession, status: newStatus })`

**UI-Auswirkungen:**
- `finished` → QuestionPanel zeigt "Spiel beendet", Antwort-Buttons deaktiviert
- `finished` → GPS-Tracking kann gestoppt werden
- `active` → Normale Gameplay-Ansicht
- `waiting` → Warte-Screen (Session-Code teilen)

### 7.3 Store-Erweiterung

```typescript
// Bereits vorhanden in session-store.ts:
currentSession: Session | null  // Session.status enthält den Status
```

Keine Store-Änderung nötig — der Status ist Teil des `Session`-Objekts.

---

## 8. Dependencies

### Neue npm-Pakete

| Paket | Zweck | Größe |
|-------|-------|-------|
| `@turf/distance` | Distanzberechnung | ~5KB |
| `@turf/boolean-point-in-polygon` | Punkt-in-Polygon | ~3KB |
| `@turf/buffer` | Geodätischer Buffer | ~15KB |
| `@turf/helpers` | Feature/FeatureCollection Factories | ~5KB |
| `@turf/bbox` | Bounding Box | ~2KB |
| `@turf/intersect` | Polygon-Intersection | ~10KB |
| `@turf/union` | Polygon-Vereinigung (für safeUnion) | ~10KB |
| `@turf/difference` | Polygon-Differenz (für holedMask) | ~8KB |
| `@turf/polygon-to-line` | Polygon → LineString (Planning Mode) | ~3KB |
| `@turf/nearest-point` | Nächster Punkt (Matching/Measuring) | ~3KB |
| `@turf/simplify` | Polygon-Vereinfachung | ~5KB |
| `@turf/bbox-polygon` | BBox → Polygon | ~2KB |
| `@turf/bbox-clip` | BBox-Clipping | ~3KB |
| `@turf/line-to-polygon` | Linie → Polygon (Coastline) | ~3KB |
| `d3-geo-voronoi` | Geo-Voronoi-Diagramme | ~25KB |
| `osmtogeojson` | OSM-Daten → GeoJSON | ~15KB |

Gesamt: ~120KB zusätzliche Bundle-Size.

**Hermes-Kompatibilität:** `d3-geo-voronoi` und `@turf/*` sind reine JS-Bibliotheken ohne DOM-Abhängigkeiten — laufen auf Hermes. `osmtogeojson` muss mit **JSON-Input** (nicht XML) gefüttert werden, was der Overpass-Proxy bereits sicherstellt (`[out:json]` im Query).

---

## 9. Dateien

### Neue Dateien

| Datei | Zweck |
|-------|-------|
| `lib/maps/hiderify.ts` | Hiderify-Dispatcher |
| `lib/maps/pipeline.ts` | applyQuestionsToMapGeoData + determinePlanningPolygon |
| `lib/maps/questions/radius.ts` | Radius: hiderify + adjust + planning |
| `lib/maps/questions/thermometer.ts` | Thermometer: hiderify + adjust + planning |
| `lib/maps/questions/tentacles.ts` | Tentacles: hiderify + adjust + planning |
| `lib/maps/questions/matching.ts` | Matching: hiderify + adjust + planning |
| `lib/maps/questions/measuring.ts` | Measuring: hiderify + adjust + planning |
| `lib/maps/geo-utils/voronoi.ts` | geoSpatialVoronoi (d3-geo-voronoi) |
| `lib/maps/geo-utils/operators.ts` | safeUnion, modifyMapData, arcBuffer, holedMask |
| `lib/maps/geo-utils/index.ts` | Barrel exports |
| `lib/overpass.ts` | Overpass-Backend-Proxy-Client |
| `lib/card-costs.ts` | CARD_COSTS Definition + getCardCost |
| `components/CardDrawOverlay.tsx` | Card-Draw-Modal nach Antwort |

### Geänderte Dateien

| Datei | Änderung |
|-------|----------|
| `hooks/useGpsTracking.ts` | Erweitert: GPS-Tracking auch für Hider (ohne Server-Broadcast) |
| `components/QuestionPanel.tsx` | Erweitert: GPS-Autoberechnung, Override-UI, Card-Draw |
| `components/QuestionAnswerSheet.tsx` | Erweitert: Preview-Label, Override-Toggle |
| `components/GameMap.tsx` | Erweitert: Elimination-Layer + Planning-Layer (`<Geojson>` Komponenten) |
| `hooks/useSessionWebSocket.ts` | Erweitert: `session_status_changed` Event handling |
| `lib/session-store.ts` | Erweitert: `planningModeEnabled` + `setPlanningModeEnabled` |
| `app/(tabs)/settings.tsx` | Erweitert: Planning-Mode-Toggle |

---

## 10. Abgrenzung

**Nicht in dieser Spec:**
- Seeker-seitige Features (Frage-Konfiguration, Frage stellen, Thermometer GPS Layer)
- Seeker-seitige Kartenansicht der Eliminierungszonen
- Timer/Countdown-Logik für Frage-Deadlines (existiert auf Backend-Seite, wird über WS `question_expired` gepusht)
- Overpass-Caching (Web-App hat ein Zwei-Ebenen-Cache-System — kann als Follow-up ergänzt werden)
- `computedGeoJSON` Optimierung (Pre-computed GeoJSON auf Frage-Ebene — Performance-Optimierung für spätere Iteration)

---

## 11. Error-Handling & Offline

- **Hiderify-Fehler** (Overpass-Timeout, GPS null, Voronoi auf degeneriertem Input): Loading-Spinner während async Berechnung, Error-Banner mit Retry-Button bei Fehler, automatischer Fallback auf manuellen Override.
- **Offline bei Overpass-abhängigen Fragetypen** (Tentacles, Matching, Measuring): Error-Meldung "Keine Verbindung — bitte manuell antworten" + Override-UI.
- **WS-Abbruch während Antwort-Submit:** Bestehende Retry-Logik in `answerQuestion()` greift (HTTP-Call, nicht WS-abhängig).
- **Elimination-GeoJSON:** Ephemerer lokaler State, wird bei App-Neustart aus den gespeicherten Fragen (Zustand-Store) recomputed. Kein AsyncStorage-Caching nötig.
- **Card Costs:** Client-seitig hardcoded, identisch zur Web-App. Keine Backend-Validierung — bei Änderungen müssen beide Apps aktualisiert werden.
