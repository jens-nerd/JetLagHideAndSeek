# Mobile App: React Native / Expo

**Datum:** 2026-03-25
**Status:** Approved

## Ziel

Die bestehende JetLag Hide & Seek Web-App als native iOS- und Android-App in den App Store und Play Store bringen. Hauptgründe: Store-Auffindbarkeit, zuverlässige Background Geolocation und Push Notifications.

## Entscheidungen

- **Neues Repo** `hideandseek-mobile` - die Web-App bleibt auf aktuellem Stand erhalten
- **React Native mit Expo (Custom Development Build)** - React-Wissen übertragbar, native Performance, Expo vereinfacht Build/Deploy. MapLibre und expo-task-manager erfordern native Module → `expo prebuild` nötig, kein reiner Managed Workflow.
- **MapLibre** (`maplibre-react-native`) für Karten - OSM-basiert, kostenlos, Vektor-Tiles, kein Google Maps API Key nötig
- **Backend bleibt unverändert** bis auf 2 neue Endpoints

## Architektur

### Repo-Struktur

```
hideandseek-mobile/
├── app/                    # Expo Router (file-based routing)
│   ├── (tabs)/
│   │   ├── map.tsx         # Hauptkarte (MapLibre)
│   │   └── settings.tsx    # Einstellungen
│   ├── session/
│   │   ├── create.tsx      # Session erstellen (Schritt-für-Schritt)
│   │   ├── join.tsx        # Session beitreten
│   │   └── lobby.tsx       # Lobby / Rollenauswahl
│   └── _layout.tsx         # Root Layout
├── components/             # UI-Komponenten
├── hooks/                  # useSessionWebSocket, useGpsTracking, etc.
├── lib/                    # API-Client, Session-Store
├── assets/                 # Icons, Bilder
└── shared/                 # @hideandseek/shared Types
```

### Beziehung zum bestehenden System

```
┌─────────────────────┐     ┌──────────────────────┐
│  hideandseek-mobile  │     │  hideandseek (Web)    │
│  (React Native/Expo) │     │  (Astro/React PWA)    │
└──────────┬──────────┘     └──────────┬───────────┘
           │                            │
           │   REST + WebSocket         │
           └──────────┬────────────────┘
                      │
              ┌───────▼───────┐
              │    Backend     │
              │ (Hono + ws +   │
              │  SQLite)       │
              └───────────────┘
```

Beide Clients sprechen dasselbe Protokoll. Das Backend unterscheidet nicht zwischen Web- und Mobile-Client.

## Komponentenmigration

### Logik übertragbar (~70% Reuse)

| Web (aktuell) | Mobile (neu) | Änderung |
|---|---|---|
| `useSessionWebSocket.ts` | `hooks/useSessionWebSocket.ts` | WS-Logik übertragbar, aber braucht zusätzlich `AppState`-Listener: Bei App-Rückkehr aus Background muss WS reconnecten und State re-syncen |
| `useSessionMapSync.ts` | `hooks/useSessionMapSync.ts` | Gleiche Logik, MapLibre-API statt Leaflet-Layer |
| `session-api.ts` | `lib/session-api.ts` | 1:1 - `fetch` funktioniert in RN identisch |
| `session-context.ts` | `lib/session-store.ts` | Nanostores → Zustand + AsyncStorage-Persistenz |
| `useGpsTracking.ts` | `hooks/useGpsTracking.ts` | `navigator.geolocation` → `expo-location` |
| Shared Types/Events | `@hideandseek/shared` | Kein Umbau |

### UI komplett neu

| Web-Komponente | Mobile-Äquivalent | Anmerkung |
|---|---|---|
| `Map.tsx` (Leaflet) | `MapView` (maplibre-react-native) | Größter Umbau. Vektor-Tiles, OSM-Styling. |
| `BottomSheet.tsx` | `@gorhom/bottom-sheet` | Bewährte RN-Library, gleiche UX |
| `CreateSessionOverlay.tsx` | Screen-basierter Wizard (Expo Router) | 5 Schritte → 5 Screens statt Overlay |
| `SessionQuestionPanel.tsx` | Eigener Screen oder Bottom-Sheet-Content | Fragen-UI als native Views |
| `OptionDrawers.tsx` | Settings-Screen | Native UI-Elemente |
| `DraggableMarkers.tsx` | MapLibre Marker mit Drag-Support | AnnotationDraggable API |
| Photo-Question Upload | `expo-image-picker` + multipart upload | Foto-Aufnahme/Auswahl für Photo-Questions (ersetzt Browser File-Input) |
| Radix UI Komponenten | React Native Paper oder eigene | Radix hat kein RN-Äquivalent |
| Tailwind (CSS) | NativeWind oder StyleSheet.create() | NativeWind bringt Tailwind-Syntax nach RN |

### Karten: MapLibre

- `@maplibre/maplibre-react-native` als Karten-Library
- **Tile-Provider:** MapTiler Free Tier (100k Requests/Monat) für Entwicklung und kleine Nutzerbasis. Bei höherem Volumen Migration auf self-hosted Tiles (Protomaps) oder MapTiler Paid.
- GPU-beschleunigte Darstellung, performanter als Leaflet Raster-Tiles
- Volle Kontrolle über Styling (ähnlich flexibel wie Leaflet)
- Polygone, Marker, Custom Layers nativ unterstützt

## Native Features

### Background Geolocation

**Problem:** Browser-`watchPosition()` stoppt im Hintergrund. Für Seeker-Tracking unbrauchbar.

**Lösung:** `expo-location` + `expo-task-manager`

- **Foreground:** `Location.watchPositionAsync()` mit `Accuracy.High` - ersetzt `useGpsTracking.ts`
- **Background:** `Location.startLocationUpdatesAsync()` registriert nativen Task, liefert GPS auch bei gesperrtem Bildschirm
- **Wichtig:** Im Background ist kein WebSocket verfügbar (OS killt die Verbindung). Stattdessen sendet der Background-Task Positionen via `fetch` an einen neuen REST-Endpoint.

**Neuer Backend-Endpoint:**

```
POST /api/sessions/:code/gps
Headers: { x-participant-token: <token> }
Body: { lat, lng, timestamp }
→ Authentifiziert via x-participant-token (wie alle bestehenden REST-Endpoints)
→ Rate Limit: max 1 Update pro 10 Sekunden pro Participant
→ Broadcastet via WS-Manager an Room
```

~30 Zeilen Code am bestehenden Backend. Authentifizierung via `x-participant-token` Header (konsistent mit bestehenden REST-Endpoints).

**Hinweis:** Dieser Endpoint ist nur für Seeker gedacht. Hider senden ihre Position nicht (ihr Standort ist das Spielgeheimnis). Das Backend validiert die Rolle des Participants.

**App-Konfiguration (`app.json` / `app.config.js`):**
- iOS: `ios.infoPlist.UIBackgroundModes: ["location"]` - erforderlich damit `expo-task-manager` im Hintergrund läuft
- iOS: `NSLocationAlwaysAndWhenInUseUsageDescription` - "Tracks your position during the hide and seek game so other players can find you"
- Android: `ACCESS_BACKGROUND_LOCATION` + Policy Declaration

### Push Notifications

**Problem:** `navigator.vibrate()` und visuelle Overlays funktionieren nur bei offener App.

**Lösung:** `expo-notifications` + Expo Push Service (kostenlos, unbegrenzt)

**Foreground-Handling:** Wenn die App im Vordergrund ist, werden Push Notifications via `Notifications.setNotificationHandler()` abgefangen und als In-App-Banner/Alert angezeigt (ähnlich den bestehenden Web-Overlays für neue Fragen/Antworten). Ohne explizites Foreground-Handling werden Pushes auf iOS stumm geschluckt.

**Flow:**
1. App-Start → `expo-notifications` generiert Expo Push Token
2. Token wird an Backend gesendet: `POST /api/sessions/:code/participants/:id/push-token`
3. Backend speichert Token am Participant (neues DB-Feld `push_token`)
4. Bei Events (neue Frage, Antwort, Spielstart) sendet Backend Push via Expo Push API

**Expo Push API:**
```
POST https://exp.host/--/api/v2/push/send
Body: { to: expoPushToken, title: "Neue Frage!", body: "Wie heißt die nächste Straße?" }
```

**Backend-Erweiterung:**
- `push_token TEXT` Feld in participants-Tabelle
- Neuer Endpoint `POST /api/sessions/:code/participants/:id/push-token`
- Utility `sendPushNotification(tokens[], title, body)` (~30 Zeilen)
- Aufrufe im WS-Handler bei: neue Frage, Antwort eingegangen, Spiel gestartet

## Shared Types

`@hideandseek/shared` wird initial als Kopie in das mobile Repo übernommen. Migration zu NPM-Paket (GitHub Packages als private Registry) **vor dem ersten Store-Submit**, sodass beide Repos dieselbe Dependency nutzen und Type-Drift vermieden wird.

## State Management

- **Zustand** ersetzt Nanostores - besser etabliert im React Native Ökosystem
- **AsyncStorage** (via `@react-native-async-storage/async-storage`) ersetzt localStorage für Persistenz
- Gleiche Store-Struktur: sessionCode, participant, gameSize, etc.

## Build & Deploy

### Expo EAS

```bash
eas build --platform ios      # → .ipa (signiert)
eas build --platform android  # → .aab (signiert)
eas submit --platform ios     # → App Store Connect
eas submit --platform android # → Google Play Console
```

- **Kein Mac nötig** - EAS baut in der Cloud auf Apple-Hardware
- Code Signing wird automatisch via `eas credentials` gemanaged
- Kostenloser Tier: 30 Builds/Monat

### Accounts

- **Apple Developer Account:** $99/Jahr
- **Google Play Developer Account:** $25 einmalig
- **Expo Account:** Kostenloser Tier reicht

### Store-Anforderungen

**iOS:**
- Background Location Begründung im Review ("Real-time multiplayer geolocation game")
- Push Notification Entitlement
- Screenshots: 6.7" und 6.5" iPhone
- Datenschutzerklärung (URL) - Pflicht wegen Location-Tracking
- Review: 1-7 Tage (erster Submit länger)

**Android:**
- Background Location Policy Declaration + Demo-Video
- Screenshots: diverse Android-Größen
- Datenschutzerklärung (URL)
- Altersfreigabe-Fragebogen
- Review: 1-3 Tage

## Technologie-Stack Zusammenfassung

| Bereich | Technologie |
|---|---|
| Framework | React Native + Expo (Custom Dev Build via `expo prebuild`) |
| Navigation | Expo Router |
| Karten | maplibre-react-native + OSM Vektor-Tiles |
| State | Zustand + AsyncStorage |
| GPS (Foreground) | expo-location watchPositionAsync |
| GPS (Background) | expo-location startLocationUpdatesAsync + expo-task-manager |
| Push | expo-notifications + Expo Push Service |
| Bottom Sheet | @gorhom/bottom-sheet |
| Styling | NativeWind (Tailwind für RN) oder StyleSheet |
| Build/Deploy | EAS Build + EAS Submit |
| Shared Types | @hideandseek/shared (initial Kopie, später NPM) |

## Zukunftsthemen (nicht im Scope, aber bedenkenswert)

- **Deep Linking / Universal Links** - `hideandseek://join/ABCD` für Session-Einladungen via Messenger
- **Offline-Karten-Caching** - MapLibre unterstützt Offline-Packs
- **Monetarisierung / In-App Purchases**
- **Location-Sharing Consent Flow** - Apple kann bei Real-Time Location Sharing zwischen Nutzern zusätzliche In-App-Einwilligung verlangen; ggf. expliziten Consent-Dialog vor Spielstart einbauen

## Nicht im Scope

- Web-App Änderungen (bleibt wie ist)
- Backend-Refactoring (nur 2 neue Endpoints)
- Monetarisierung / In-App Purchases
