# Hiding-Zone-Auswahl & Endgame-Reveal — Design Spec

**Datum:** 2026-03-28
**Status:** Approved

## Ziel

Der Hider kann jederzeit während des Spiels **eine einzelne Versteckzone** (Bahnhofskreis) auswählen, die dauerhaft auf seiner Karte angezeigt wird. Er kann die Zone nachträglich wechseln (anderer Bahnhof, gleicher Radius). Per "Endgame freigeben" wird die Zone auch für alle Seeker sichtbar — rein visuell, ohne Spielregel-Änderung.

## Datenmodell

### DB: `sessions`-Tabelle

Neues Feld `hiding_zone` (TEXT, nullable) — JSON-serialisiert:

```typescript
interface HidingZone {
  stationName: string;      // z.B. "Hamburg Hbf"
  lat: number;
  lng: number;
  radius: number;           // aus bestehendem hidingRadius-Atom
  radiusUnit: "kilometers" | "miles";
  revealed: boolean;        // false = nur Hider sieht es, true = alle
}
```

Definiert als `HidingZone`-Interface in `shared/src/types.ts`.

### Rollenbasierte Filterung

Beim `sync`-Event prüft der Server: wenn `revealed === false` und der Client ein Seeker ist, wird `hidingZone` als `null` ausgeliefert. Der Hider erhält die Zone immer.

## WebSocket-Events

### Neue ClientToServer-Events

| Event | Sender | Payload | Aktion |
|-------|--------|---------|--------|
| `set_hiding_zone` | Hider | `{ stationName, lat, lng, radius, radiusUnit }` | Speichert Zone in DB (`revealed: false`). Sendet `hiding_zone_updated` an Hider. |
| `reveal_hiding_zone` | Hider | `{}` | Setzt `revealed: true` in DB. Broadcastet `hiding_zone_revealed` an alle Seeker. |

### Neue ServerToClient-Events

| Event | Empfänger | Payload | Zweck |
|-------|-----------|---------|-------|
| `hiding_zone_updated` | Nur Hider | `{ hidingZone: HidingZone }` | Bestätigt dem Hider seine gesetzte/geänderte Zone. |
| `hiding_zone_revealed` | Alle Seeker | `{ hidingZone: HidingZone }` | Seeker erhalten die Zone beim Endgame. |

### Bestehendes `sync`-Event

Neues Feld im Sync-Payload:

```typescript
hidingZone: HidingZone | null
```

Server-Logik: Rolle = Seeker UND `revealed === false` → `null`. Sonst die volle Zone.

## Frontend — Hider

### State

Neuer Atom in `session-context.ts`:

```typescript
activeHidingZone: atom<HidingZone | null>(null)
```

Gesetzt via `sync` und `hiding_zone_updated` Events.

### Versteckzonen-Tab

Das bestehende Versteckzonen-Tab im BottomSheet erhält eine **Sub-Tab-Leiste**:

- **Tab "Meine Zone"** — neues vereinfachtes Panel (self-contained, lädt Stationen unabhängig von "Alle Zonen"):
  - **Stationstyp-Dropdown** (single-select) + "Stationen laden"-Button → eigener Overpass-Fetch via `findPlacesInZone`
  - **Stationstyp-Liste**: Bewusst verkürzt und single-select. Erster Eintrag `placeType.railwayStations` mappt auf den zusammengeführten Filter `[railway~'station|halt']`, damit der Hider bei single-select Bahnhöfe inkl. Halte in einem Schritt wählen kann. `ZoneSidebar.tsx` bleibt multi-select mit separaten `station`/`halt`/`stop`-Einträgen und zusätzlichen Typen (`railwayExcludingSubway`, `lightRail*`, `funicular`, `aerialway`, `ferryPlatforms`). Die Listen divergieren absichtlich; ein gemeinsames `STATION_TYPE_OPTIONS`-Konstantenobjekt wäre eine falsche Abstraktion.
  - **Kein Zone gesetzt**: Suchfeld + Trefferliste → Hider tippt auf einen Bahnhof → Kreis wird als `activeHidingZone` gesetzt via `set_hiding_zone`.
  - **Zone gesetzt**: Zeigt Stationsname + Radius. Plus Endgame-Button:
    - "Endgame freigeben" → Bestätigungsdialog ("Zone wird für alle Seeker sichtbar. Fortfahren?") → sendet `reveal_hiding_zone`
    - Zone ändern = einfach einen anderen Bahnhof in derselben Liste antippen (neuer `set_hiding_zone`-Event).
  - **Zone revealed**: Wie "Zone gesetzt", aber "Endgame aktiv" (disabled/grau) statt "Endgame freigeben"

- **Tab "Alle Zonen"** — das bestehende volle ZoneSidebar-Panel (Konfiguration, Stationstypen, Radius, etc.)

### Karte (Leaflet)

Dauerhafter grüner Kreis (`L.circle`) um die gewählte Station:
- Layer-Marker: `layer.hidingZoneActive = true` (unterscheidbar von normalen Hiding-Zone-Layern)
- Wird bei Zone-Änderung aktualisiert
- Wird bei `leaveSession()` entfernt

## Frontend — Seeker

### State

Neuer Atom in `session-context.ts`:

```typescript
revealedHidingZone: atom<HidingZone | null>(null)
```

Gesetzt via `sync` (wenn `revealed === true`) und `hiding_zone_revealed` Event.

### Verhalten

- **Vor Endgame**: Kein Versteckzonen-Tab, kein Kreis auf der Karte.
- **Nach Endgame**: Grüner Kreis auf der Karte (gleicher Style wie beim Hider). Toast: "Der Hider hat seine Versteckzone freigegeben!" Kein Versteckzonen-Tab — der Seeker sieht die Zone nur auf der Karte.

## Abgrenzung

- Der Radius wird aus der bestehenden `hidingRadius`-Einstellung übernommen (konfigurierbar im "Alle Zonen"-Tab). Der aktuelle Wert wird zum Zeitpunkt des `set_hiding_zone`-Aufrufs mitgesendet und in der DB gespeichert. Nachträgliche Radius-Änderungen im "Alle Zonen"-Tab wirken sich nicht auf die bereits gesetzte Zone aus.
- Zonenwechsel = anderer Bahnhof, gleicher Radius.
- Endgame = rein visuell, keine Änderung an Spielregeln oder Fragelogik.
- Keine Pflicht-Auswahl im Onboarding — der Hider wählt die Zone jederzeit über das Versteckzonen-Tab.
