# Spec A: Mobile Hider Session-Setup

**Scope:** Spielgebiet bestimmen (OSM-Suche, Multi-Zone) + Spielgröße (S/M/L) — 1:1 Feature-Parität mit der Web-App.

**Repo:** `/Users/jensvielhaben-nl001/hideandseek-mobile/`

---

## 1. Übersicht

Der aktuelle Create-Flow der Mobile App sammelt nur einen `displayName` und erstellt sofort die Session. Es fehlen zwei Schritte aus der Web-App:

1. **Spielgebiet bestimmen** — Hider sucht Orte via Photon-API (komoot), wählt eine primäre Zone + optionale weitere Zonen (hinzufügen/entfernen/ein-/ausschließen).
2. **Spielgröße wählen** — S / M / L Auswahl, client-seitig im Zustand-Store persistiert.

Beide Schritte werden in den Create-Flow eingebaut, **bevor** die Session am Backend erstellt wird. Das Backend akzeptiert bereits `mapLocation` in `CreateSessionRequest` — keine Backend-Änderungen nötig.

---

## 2. Create-Flow (neu)

```
Home → Create-Screen:
  Step 1: displayName (existiert bereits)
  Step 2: Spielgebiet (NEU)
  Step 3: Spielgröße (NEU)
  → createSession({ displayName, mapLocation })
  Step 4: Session-Code anzeigen + teilen
  → Navigation zur Karte
```

Implementiert als Multi-Step innerhalb von `app/session/create.tsx` mit einem `step`-State (`"name" | "area" | "size" | "code"`).

**Navigation:** Zurück-Button (Header oder Android Back) navigiert zum vorherigen Step. Von Step "name" zurück → Home. Von Step "code" kein Zurück (Session ist erstellt).

**Error-Handling:** Wenn `createSession()` fehlschlägt (Netzwerk, Backend down), wird ein Alert angezeigt und der User bleibt auf Step "size" mit Retry-Möglichkeit.

**Loading:** Während `createSession()` läuft, wird ein ActivityIndicator angezeigt und der Size-Button deaktiviert (kein Doppel-Tap).

---

## 3. Spielgebiet bestimmen

### 3.1 Komponente: `components/AreaSearch.tsx`

Neue Komponente, die im Step "area" des Create-Flows eingebettet wird.

**UI-Aufbau:**
- **Suchfeld** (TextInput) oben — Debounce 400ms
- **Ergebnisliste** (FlatList) unter dem Suchfeld — zeigt Name + Typ (City, State, Country)
- **Ausgewählte Zonen** (ScrollView) unterhalb — Chips/Tags mit +/- Toggle und X-Button
- **Kartenvorschau** (optional, falls Platz) — kleines MapLibre-Preview der ausgewählten Zonen

### 3.2 OpenStreetMapFeature Typ

Photon-API gibt GeoJSON-Features zurück. Der Typ wird in `shared/geocode-types.ts` definiert — identisch zur Web-App (`OpenStreetMap` in `src/maps/api/types.ts`):

```typescript
// shared/geocode-types.ts
export interface OpenStreetMapFeature {
  type: "Feature";
  geometry: {
    type: string;
    coordinates: number[];  // [lat, lng] nach Konvertierung
  };
  properties: {
    osm_id: number;
    osm_type: string;       // "R" = Relation (Admin-Boundary), "N" = Node, "W" = Way
    name: string;
    country?: string;
    state?: string;
    city?: string;
    type?: string;           // "city", "state", "country", etc.
    extent?: number[];       // [maxLat, minLon, minLat, maxLon] nach Konvertierung
    [key: string]: unknown;  // Weitere Properties möglich
  };
}
```

**Hinweis:** `MapLocation.osmFeature` und `additionalOsmFeatures[].location` sind in `shared/types.ts` als `unknown` typisiert. Das ist korrekt — die Objekte werden als opake JSON-Blobs ans Backend geschickt und beim Lesen (Seeker-Sync) wieder als `OpenStreetMapFeature` gecastet. Kein Typ-Mismatch zur Laufzeit.

### 3.3 Geocoding: Photon API (komoot)

Identisch zur Web-App — direkter Aufruf an `https://photon.komoot.io/api/`.

```typescript
// lib/geocode.ts
import type { OpenStreetMapFeature } from "../shared/geocode-types";

export async function geocode(query: string, lang = "en"): Promise<OpenStreetMapFeature[]> {
  if (query.trim().length < 2) return [];

  let resp: Response;
  try {
    resp = await fetch(`https://photon.komoot.io/api/?lang=${lang}&q=${encodeURIComponent(query)}`);
  } catch {
    throw new Error("Netzwerkfehler bei der Suche. Bitte Verbindung prüfen.");
  }
  if (!resp.ok) throw new Error(`Suche fehlgeschlagen (${resp.status})`);

  const data = await resp.json();
  const features: OpenStreetMapFeature[] = data.features;

  features.forEach((f) => {
    // Photon liefert [lon, lat] → umwandeln in [lat, lng]
    f.geometry.coordinates = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
    // Extent normalisieren: Photon [minLon, minLat, maxLon, maxLat] → [maxLat, minLon, minLat, maxLon]
    if (f.properties.extent) {
      const e = f.properties.extent;
      f.properties.extent = [e[1], e[0], e[3], e[2]];
    }
  });

  // Nur Relations (Admin-Boundaries), dedupliziert nach osm_id
  const seen = new Set<number>();
  return features.filter((f) => {
    if (f.properties.osm_type !== "R") return false;
    if (seen.has(f.properties.osm_id)) return false;
    seen.add(f.properties.osm_id);
    return true;
  });
}
```

**Kein Backend-Proxy nötig** — Photon ist ein öffentlicher, kostenloser Service ohne Auth. Bei Rate-Limiting durch Photon wird der Fehler dem User als Toast angezeigt.

### 3.4 Zonen-State

Lokaler State im Create-Flow (React `useState`, nicht im Zustand-Store — wird nur für die Session-Erstellung gebraucht):

```typescript
// Im Create-Flow als lokaler State:
primaryZone: OpenStreetMapFeature | null
additionalZones: Array<{ location: OpenStreetMapFeature; added: boolean }>
```

**Hinweis zum `base`-Feld:** Die Web-App verwendet intern ein `base: boolean`-Feld in `additionalMapGeoLocations`. Dieses Feld wird **nicht** ans Backend gesendet — `MapLocation.additionalOsmFeatures` enthält nur `{ location, added }`. Da die Mobile App keinen Deutschland-Default hat und die Primary separat verwaltet, wird `base` nicht benötigt.

**Operationen:**
- **Zone hinzufügen:** Tap auf Suchergebnis → wird zu `additionalZones` mit `added: true` hinzugefügt. Falls `primaryZone === null`, wird sie stattdessen zur Primary.
- **Zone ein-/ausschließen:** Toggle `added` Flag (grünes + → rotes -, rotes - → grünes +).
- **Zone entfernen:** X-Button entfernt aus Liste. Wenn Primary entfernt wird und es andere `added` Zonen gibt, rückt die erste `added` Zone zur Primary auf. Primary ohne Ersatz → Fehlermeldung (Alert).
- **Kein Default:** Der User startet mit leerem State und muss mindestens eine Zone suchen und auswählen.

**UX-Details:**
- Suchfeld: `keyboardShouldPersistTaps="handled"` auf der FlatList, damit Tap auf Ergebnis bei offener Tastatur funktioniert.
- Mindestlänge: Queries unter 2 Zeichen werden nicht gesendet (bereits in `geocode()` behandelt).
- Leeres Suchfeld: Ergebnisliste wird sofort geleert.

### 3.4 MapLocation bauen

Vor dem API-Call wird aus dem Zonen-State ein `MapLocation`-Objekt gebaut:

```typescript
function buildMapLocation(): MapLocation | null {
  if (!primaryZone) return null;
  const coords = primaryZone.geometry.coordinates as [number, number];
  return {
    lat: coords[0],
    lng: coords[1],
    name: primaryZone.properties.name ?? "",
    osmFeature: primaryZone,
    additionalOsmFeatures: additionalZones.length > 0
      ? additionalZones.map((z) => ({ location: z.location, added: z.added }))
      : undefined,
  };
}
```

### 3.5 Confirm & Weiter

"Weiter"-Button (disabled solange `primaryZone === null`) → wechselt zu Step "size".

---

## 4. Spielgröße (S/M/L)

### 4.1 UI

Einfacher Screen mit 3 großen Buttons/Cards:

| Größe | Label | Beschreibung |
|-------|-------|-------------|
| S | Klein | Stadtteil / kleines Gebiet |
| M | Mittel | Stadt / Region |
| L | Groß | Land / große Region |

### 4.2 Persistierung

Auswahl wird in `useSessionStore` gespeichert:
```typescript
setGameSize(size: "S" | "M" | "L")  // existiert bereits im Store
```

Wird **nicht** ans Backend gesendet — identisch zur Web-App. Game Size ist rein client-seitig und beeinflusst später die verfügbaren Fragetypen.

### 4.3 Confirm & Session erstellen

Tap auf eine Größe → `setGameSize(size)` → `createSession({ displayName, mapLocation })` → weiter zu Step "code".

---

## 5. Session-Code anzeigen

Nach erfolgreicher Session-Erstellung: Step "code" zeigt den 6-stelligen Code groß an mit:
- **Copy-Button** — `Clipboard.setStringAsync(code)` (aus `expo-clipboard`, muss installiert werden)
- **Share-Button** — `Share.share({ message: "Join my Hide & Seek game: CODE" })` (aus `react-native`, built-in)
- **Weiter-Button** → Navigation zur Karte (`router.replace("/(tabs)/map")`)

---

## 6. Dateien

### Neue Dateien
| Datei | Zweck |
|-------|-------|
| `lib/geocode.ts` | Photon-API Geocoding + Koordinaten-Konvertierung |
| `components/AreaSearch.tsx` | Suchfeld + Ergebnisliste + Zonen-Management |
| `shared/geocode-types.ts` | `OpenStreetMapFeature` Typ-Definition |

### Geänderte Dateien
| Datei | Änderung |
|-------|----------|
| `app/session/create.tsx` | Multi-Step Flow (name → area → size → code) |
| `lib/session-store.ts` | Keine Änderung nötig — `gameSize` + `setGameSize` existieren bereits |

### Neue Dependency
| Paket | Zweck |
|-------|-------|
| `expo-clipboard` | Copy-to-Clipboard für Session-Code |

### Nicht geändert
- Backend — akzeptiert bereits `mapLocation` in `CreateSessionRequest`
- `shared/types.ts` — `MapLocation`, `CreateSessionRequest` sind korrekt definiert

---

## 7. Offene Entscheidungen

**Kartenvorschau in AreaSearch:** Die Web-App zeigt die ausgewählten Zonen auf der Leaflet-Karte im Hintergrund. Für die Mobile App wäre eine kleine MapLibre-Vorschau möglich, aber nicht zwingend — die Zonen-Chips mit Namen reichen für die erste Version. Kartenvorschau kann als Follow-up ergänzt werden.

**Sprache der Geocoding-Ergebnisse:** Die Web-App nutzt `lang=en`. Für die Mobile App könnte man die Gerätesprache (`Localization.locale`) verwenden. Erstmal `en` wie in der Web-App.

---

## 8. Abgrenzung

**Nicht in dieser Spec:**
- Overpass-API-Queries (werden erst für Fragen-Visualisierung in Spec B gebraucht)
- Seeker-seitige Kartenansicht der Zonen (Seeker bekommt die Zonen via `getSession` — die Map-Darstellung ist Spec B)
- Fragen-System, Hiderify, Kartenkosten, Planning Mode → alles Spec B
