# Eindeutige Spieler-Pins auf der Karte

**Datum:** 2026-03-29
**Status:** Approved

## Problem

1. Spieler erscheinen mehrfach auf der Karte — der Follow-Me-Marker (imperativer `L.marker` in Map.tsx) und der Session-Marker (CircleMarker in SeekerMarkers.tsx) existieren parallel.
2. Farben sind inkonsistent: Hider-Marker ist rot (#E8323A), sollte grün sein. Seeker sieht sich selbst blau (#2A81CB), sollte rot sein.
3. `seekerPositions`-Array kann Duplikate enthalten, wodurch der Hider denselben Seeker mehrfach sieht.

## Lösung

### Farbschema

| Rolle | Eigener Marker | Fremde Marker (Hider-Sicht) |
|-------|---------------|----------------------------|
| Seeker | Rot (#E8323A), Tooltip "Ich" | Rot (#E8323A), Tooltip = displayName |
| Hider | Grün (#22C55E), Tooltip "Ich" | — (Hider ist für Seeker nicht sichtbar) |

### Sichtbarkeit

- **Hider** sieht: sich selbst (grün) + alle Seeker (rot)
- **Seeker** sieht: nur sich selbst (rot)

### Positionsquelle-Priorität

GPS hat immer Vorrang solange aktiv:
- GPS an → eigener Marker folgt GPS, manuelles Setzen deaktiviert
- GPS aus → eigener Marker zeigt manuell gewählten Standort (oder keinen Pin)
- GPS wird ausgeschaltet → Marker verschwindet, bis manuell ein Standort gesetzt wird

## Änderungen

### 1. SeekerMarkers.tsx → PlayerMarkers.tsx

Umbenennen und erweitern:
- Rendert den **eigenen Marker** für beide Rollen (Seeker und Hider)
  - Farbe nach Rolle: Seeker=rot, Hider=grün
  - Tooltip: "Ich" (de) / "Me" (en)
  - Positionsquelle: `ownGpsPosition`-Atom (GPS hat Vorrang)
- Rendert **andere Seeker** (nur wenn eigene Rolle = Hider)
  - Farbe: rot (#E8323A)
  - Tooltip: displayName des Seekers
  - `seekerPositions` vor dem Rendern nach `id` deduplizieren (nur letzter Eintrag pro id)
- GPS-Tracking-Logik (`navigator.geolocation.watchPosition`) wird aus Map.tsx hierher verschoben

### 2. Map.tsx — Follow-Me-Marker entfernen

Entfernen:
- Die gesamte Follow-Me-Marker-Logik (imperativer `L.marker` mit `followMeMarkerRef`)
- `followMe`-Atom-Subscriptions und `watchPosition`-Calls in Map.tsx
- Der Follow-Me-Toggle in den Einstellungen wird durch einen "GPS an/aus"-Toggle in PlayerMarkers ersetzt

Das `followMe`-Atom selbst bleibt bestehen — es steuert jetzt ob GPS-Tracking aktiv ist (wird von PlayerMarkers gelesen).

### 3. DraggableMarkers.tsx — Hider-Marker grün

- `HIDER_ICON`: Farbe von rot (#E8323A) → grün (#22C55E) ändern
- Box-Shadow/Glow ebenfalls auf grün anpassen

### 4. Duplikat-Schutz seekerPositions

In `PlayerMarkers.tsx` vor dem Rendern:
```typescript
const uniqueSeekers = [...new Map(seekerPositions.map(s => [s.id, s])).values()];
```

## Was sich NICHT ändert

- Backend-Logik für `seeker_positions` WebSocket-Event
- `ownGpsPosition`-Atom und `useGpsTracking`-Hook
- `hiderMode`-Atom (wird weiterhin für die Hider-Antwort-Logik genutzt, nicht für den Marker)
- ThermometerGpsLayer (Voronoi-Zonen sind keine Spieler-Marker)
- Frage-Marker in DraggableMarkers (die bleiben wie sie sind)
