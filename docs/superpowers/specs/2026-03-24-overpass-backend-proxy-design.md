# Overpass Backend-Proxy

## Problem

Die Overpass-API ist auf dem VPS komplett nicht erreichbar. Alle 4 Fallback-Endpoints schlagen fehl. Betroffen: Tentakel-, Matching- und Mess-Fragen. Vermutliche Ursache: CSP-Header, URL-Laengenlimits oder IP-basiertes Rate-Limiting der oeffentlichen Overpass-Server.

## Loesung

Overpass-Queries laufen ueber einen eigenen Backend-Proxy statt direkt vom Browser. Das Backend leitet Queries via POST an Overpass weiter, cached Ergebnisse in-memory und bietet Retry-Logik.

## Architektur

```
Browser --> POST /api/overpass --> Backend (Cache-Check) --> Overpass-Endpoints (POST, Fallback)
                                      |
                                  In-Memory Cache (5 Min TTL)
```

## Backend: `POST /api/overpass`

### Request
```json
{ "query": "[out:json];node(1);out;" }
```

### Response
Overpass-JSON direkt durchgereicht.

### Cache
- Key: SHA-256 Hash der Query
- TTL: 5 Minuten
- Storage: In-Memory Map mit Timestamp
- Cleanup: Lazy bei jedem Request (abgelaufene Eintraege entfernen)

### Overpass-Anfrage
- **POST** statt GET (vermeidet URL-Laengenlimits)
- Body: `data=<url-encoded-query>` (application/x-www-form-urlencoded)
- Endpoints in Reihenfolge:
  1. overpass-api.de
  2. maps.mail.ru
  3. overpass.kumi.systems
  4. overpass.private.coffee
- Timeout: 30s pro Endpoint
- Retry: 1x bei HTTP 429/503 mit 2s Pause

### Fehlerbehandlung
- Alle Endpoints fehlgeschlagen: HTTP 502 mit `{ error: "All Overpass endpoints failed", details: [...] }`
- Einzelne Endpoint-Fehler: geloggt, naechster versucht

## Frontend-Aenderungen

### `overpass-fetch.ts`
- Sendet Query als JSON POST an `${PUBLIC_BACKEND_URL}/api/overpass`
- Fallback-Endpoint-Logik entfaellt (lebt jetzt im Backend)
- Timeout + AbortSignal bleiben erhalten

### `constants.ts`
- `OVERPASS_ENDPOINTS` Array wird nicht mehr vom Frontend benoetigt
- `OVERPASS_API` Konstante entfaellt

### Cache-Ebenen (unveraendert)
| Ebene | Was | TTL |
|-------|-----|-----|
| Backend In-Memory | Query-Hash -> Response | 5 Min |
| Frontend Session-Cache | URL -> Response | Tab-Lebensdauer |
| Frontend Permanent-Cache | Geometrien, Coastline | localStorage |

## Betroffene Dateien

| Datei | Aenderung |
|-------|----------|
| `backend/src/routes/overpass.ts` | Neu: Proxy-Route + Cache |
| `backend/src/index.ts` | Route registrieren |
| `src/maps/api/overpass-fetch.ts` | Auf eigenen Backend umstellen |
| `src/maps/api/constants.ts` | OVERPASS_ENDPOINTS/OVERPASS_API aufraumen |
| `src/maps/api/overpass.ts` | getOverpassData vereinfachen |
