# Hiding-Zone-Auswahl & Endgame-Reveal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the hider select a single hiding zone (station circle) that is always visible on their map, changeable via card draw, and revealable to seekers as an "Endgame" action.

**Architecture:** New `hiding_zone` JSON field on the `sessions` DB table. Dedicated WS events (`set_hiding_zone`, `reveal_hiding_zone`, `hiding_zone_updated`, `hiding_zone_revealed`) keep hider and seeker in sync. The sync event delivers the zone role-filtered. Frontend adds an `activeHidingZone` atom, a simplified "Meine Zone" sub-tab in the Versteckzonen panel, and a persistent Leaflet circle on the map.

**Tech Stack:** TypeScript, Hono (backend), better-sqlite3 + Drizzle ORM, Nanostores, React, Leaflet

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `shared/src/types.ts` | Add `HidingZone` interface |
| Modify | `shared/src/events.ts` | Add 4 new WS event variants |
| Modify | `backend/src/db/schema.ts` | Add `hidingZone` column to sessions |
| Modify | `backend/src/db/migrate.ts` | Migration v5: `hiding_zone` column |
| Modify | `backend/src/ws/handler.ts` | Handle `set_hiding_zone` + `reveal_hiding_zone`, extend `sync` |
| Modify | `src/lib/session-context.ts` | Add `activeHidingZone` + `revealedHidingZone` atoms, extend `leaveSession()` |
| Modify | `src/hooks/useSessionWebSocket.ts` | Handle new events, extend `sync` |
| Create | `src/components/session/MyZonePanel.tsx` | "Meine Zone" sub-tab UI |
| Modify | `src/components/BottomSheetPanel.tsx` | Sub-tab navigation in Versteckzonen tab |
| Modify | `src/components/Map.tsx` | Render persistent hiding zone circle |

---

### Task 1: Shared Types — `HidingZone` Interface

**Files:**
- Modify: `shared/src/types.ts`

- [ ] **Step 1: Add `HidingZone` interface**

Add at the end of the file, before the HTTP request/response section (before line 95):

```typescript
// ── Hiding Zone ─────────────────────────────────────────────────────────────

export interface HidingZone {
    stationName: string;
    lat: number;
    lng: number;
    radius: number;
    radiusUnit: "kilometers" | "miles";
    revealed: boolean;
}
```

- [ ] **Step 2: Commit**

```bash
git add shared/src/types.ts
git commit -m "feat(shared): add HidingZone interface"
```

---

### Task 2: Shared Events — New WS Event Types

**Files:**
- Modify: `shared/src/events.ts`

- [ ] **Step 1: Add import for `HidingZone`**

Update the import on line 1:

```typescript
import type { HidingZone, MapLocation, SessionQuestion, SessionStatus } from "./types.js";
```

- [ ] **Step 2: Add new ServerToClient events**

Add before the closing semicolon of `ServerToClientEvent` (after the `seeker_positions` variant, line 60):

```typescript
    | {
          /** Sent to hider after they set or change their hiding zone */
          type: "hiding_zone_updated";
          hidingZone: HidingZone;
      }
    | {
          /** Broadcast to all seekers when hider reveals their zone (endgame) */
          type: "hiding_zone_revealed";
          hidingZone: HidingZone;
      };
```

- [ ] **Step 3: Add new ClientToServer events**

Add before the closing semicolon of `ClientToServerEvent` (after the `position_update` variant, line 96):

```typescript
    | {
          /** Hider sets or changes their hiding zone */
          type: "set_hiding_zone";
          stationName: string;
          lat: number;
          lng: number;
          radius: number;
          radiusUnit: "kilometers" | "miles";
      }
    | {
          /** Hider reveals their hiding zone to all seekers */
          type: "reveal_hiding_zone";
      };
```

- [ ] **Step 4: Extend `sync` event payload**

Add `hidingZone` field to the `sync` variant (after `participants` field):

```typescript
          /** Hider's hiding zone — null for seekers unless revealed */
          hidingZone: HidingZone | null;
```

- [ ] **Step 5: Commit**

```bash
git add shared/src/events.ts
git commit -m "feat(shared): add hiding zone WS events and extend sync"
```

---

### Task 3: Database — Schema + Migration

**Files:**
- Modify: `backend/src/db/schema.ts`
- Modify: `backend/src/db/migrate.ts`

- [ ] **Step 1: Add column to Drizzle schema**

In `backend/src/db/schema.ts`, add after the `mapLocation` field on the sessions table (after line 10):

```typescript
    hidingZone: text("hiding_zone"), // JSON: HidingZone | null
```

- [ ] **Step 2: Add migration v5**

In `backend/src/db/migrate.ts`, add at the end (before `console.log("Database migrated successfully:"...)`):

```typescript
// ── Migration v5: hiding_zone column on sessions ──────────────────────────

const sessionCols = (sqlite.pragma("table_info(sessions)") as { name: string }[]).map(
    (r) => r.name,
);

if (!sessionCols.includes("hiding_zone")) {
    console.log("Applying migration v5: sessions hiding_zone…");
    sqlite.exec(`
        ALTER TABLE sessions ADD COLUMN hiding_zone TEXT;
    `);
    console.log("Migration v5 applied.");
}
```

- [ ] **Step 3: Run the migration**

```bash
cd backend && npx tsx src/db/migrate.ts
```

Expected: `Migration v5 applied.` then `Database migrated successfully`

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/schema.ts backend/src/db/migrate.ts
git commit -m "feat(backend): add hiding_zone column to sessions table"
```

---

### Task 4: Backend WS Handler — `set_hiding_zone`, `reveal_hiding_zone`, Extend `sync`

**Files:**
- Modify: `backend/src/ws/handler.ts`

- [ ] **Step 1: Extend `sync` to include hiding zone (role-filtered)**

In `handleWsOpen`, replace the `ws.send(JSON.stringify({...}))` block (lines 139–155) with:

```typescript
    // Role-filtered hiding zone: hiders always see it; seekers only if revealed.
    let hidingZone = null;
    if (sessionRow.hidingZone) {
        const parsed = JSON.parse(sessionRow.hidingZone);
        if (client.role === "hider" || parsed.revealed === true) {
            hidingZone = parsed;
        }
    }

    ws.send(
        JSON.stringify({
            type: "sync",
            questions: questionRows.map((r) => toSessionQuestion(r, pMap)),
            mapLocation: sessionRow.mapLocation
                ? JSON.parse(sessionRow.mapLocation)
                : null,
            status: sessionRow.status,
            seekerCount: wsManager.seekerCount(code),
            hiderConnected: wsManager.hiderConnected(code),
            participants: participantRows.map((p) => ({
                id: p.id,
                role: p.role as "hider" | "seeker",
                displayName: p.displayName,
            })),
            hidingZone,
        }),
    );
```

- [ ] **Step 2: Handle `set_hiding_zone` event**

In `handleWsMessage`, add a new case in the switch statement (after the `position_update` case, before the closing `}`):

```typescript
        case "set_hiding_zone": {
            if (client.role !== "hider") return;

            const sessionRow = await db.query.sessions.findFirst({
                where: eq(schema.sessions.code, code),
            });
            if (!sessionRow) return;

            const hidingZone = {
                stationName: event.stationName,
                lat: event.lat,
                lng: event.lng,
                radius: event.radius,
                radiusUnit: event.radiusUnit,
                revealed: false,
            };

            // Preserve revealed state if already revealed
            if (sessionRow.hidingZone) {
                const existing = JSON.parse(sessionRow.hidingZone);
                if (existing.revealed) {
                    hidingZone.revealed = true;
                }
            }

            await db
                .update(schema.sessions)
                .set({ hidingZone: JSON.stringify(hidingZone) })
                .where(eq(schema.sessions.id, sessionRow.id));

            const updatedEvent = {
                type: "hiding_zone_updated" as const,
                hidingZone,
            };
            wsManager.sendToRole(code, "hider", updatedEvent);
            void wsManager.persistEvent(db, client.sessionId, client.participantId, updatedEvent);

            // If already revealed, also notify seekers of the change
            if (hidingZone.revealed) {
                const revealEvent = {
                    type: "hiding_zone_revealed" as const,
                    hidingZone,
                };
                wsManager.sendToRole(code, "seeker", revealEvent);
            }
            break;
        }

        case "reveal_hiding_zone": {
            if (client.role !== "hider") return;

            const sessionRow = await db.query.sessions.findFirst({
                where: eq(schema.sessions.code, code),
            });
            if (!sessionRow || !sessionRow.hidingZone) return;

            const hidingZone = JSON.parse(sessionRow.hidingZone);
            hidingZone.revealed = true;

            await db
                .update(schema.sessions)
                .set({ hidingZone: JSON.stringify(hidingZone) })
                .where(eq(schema.sessions.id, sessionRow.id));

            const revealEvent = {
                type: "hiding_zone_revealed" as const,
                hidingZone,
            };
            wsManager.sendToRole(code, "seeker", revealEvent);
            void wsManager.persistEvent(db, client.sessionId, client.participantId, revealEvent);

            // Also confirm to hider
            wsManager.sendToRole(code, "hider", {
                type: "hiding_zone_updated" as const,
                hidingZone,
            });
            break;
        }
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/ws/handler.ts
git commit -m "feat(backend): handle set_hiding_zone and reveal_hiding_zone WS events"
```

---

### Task 5: Frontend State — Atoms + leaveSession Cleanup

**Files:**
- Modify: `src/lib/session-context.ts`

- [ ] **Step 1: Import `HidingZone` type**

Update the import from `@hideandseek/shared` (line 7):

```typescript
import type {
    HidingZone,
    MapLocation,
    ParticipantWithToken,
    Role,
    Session,
    SessionQuestion,
} from "@hideandseek/shared";
```

- [ ] **Step 2: Add atoms**

Add after `hiderConnected` atom (around line 112):

```typescript
/** Hider's active hiding zone (set via WS sync/hiding_zone_updated) */
export const activeHidingZone = atom<HidingZone | null>(null);

/** Seeker: revealed hiding zone (set via WS sync/hiding_zone_revealed) */
export const revealedHidingZone = atom<HidingZone | null>(null);
```

- [ ] **Step 3: Extend `leaveSession()`**

Add after `thermometerGpsTracking.set(null);` (line 176):

```typescript
    activeHidingZone.set(null);
    revealedHidingZone.set(null);
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/session-context.ts
git commit -m "feat(frontend): add activeHidingZone and revealedHidingZone atoms"
```

---

### Task 6: Frontend WS Hook — Handle New Events

**Files:**
- Modify: `src/hooks/useSessionWebSocket.ts`

- [ ] **Step 1: Import new atoms**

Add `activeHidingZone` and `revealedHidingZone` to the import from `@/lib/session-context` (find the existing import block and extend it):

```typescript
import {
    activeHidingZone,
    revealedHidingZone,
    // ... existing imports
} from "@/lib/session-context";
```

- [ ] **Step 2: Handle `hidingZone` in `sync` event**

In the `sync` case handler, add after `onSync?.();` (line 100):

```typescript
                        // Hiding zone: set appropriate atom based on role
                        if (event.hidingZone) {
                            if (getRole() === "hider") {
                                activeHidingZone.set(event.hidingZone);
                            } else {
                                revealedHidingZone.set(event.hidingZone);
                            }
                        } else {
                            // No zone set (or not revealed for seeker)
                            if (getRole() === "hider") {
                                activeHidingZone.set(null);
                            }
                        }
```

- [ ] **Step 3: Handle `hiding_zone_updated` and `hiding_zone_revealed`**

Add new cases in the switch statement (after the `seeker_positions` case):

```typescript
                    case "hiding_zone_updated":
                        activeHidingZone.set(event.hidingZone);
                        break;

                    case "hiding_zone_revealed":
                        revealedHidingZone.set(event.hidingZone);
                        break;
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useSessionWebSocket.ts
git commit -m "feat(frontend): handle hiding zone WS events in useSessionWebSocket"
```

---

### Task 7: MyZonePanel — "Meine Zone" UI Component

**Files:**
- Create: `src/components/session/MyZonePanel.tsx`

- [ ] **Step 1: Create the component**

```typescript
/**
 * MyZonePanel — simplified hiding zone selection for the hider.
 *
 * States:
 *   - No zone: "Versteckzone wählen" button → station search
 *   - Zone set: Station name + radius display, "Zone ändern" + "Endgame freigeben"
 *   - Zone revealed: Same as set, but "Endgame aktiv" (disabled)
 */
import { useStore } from "@nanostores/react";
import { useState } from "react";
import { toast } from "react-toastify";

import { hidingRadius, hidingRadiusUnits } from "@/lib/context";
import {
    activeHidingZone,
    sessionCode,
    sessionParticipant,
    wsInstance,
} from "@/lib/session-context";

export function MyZonePanel({ stations }: {
    stations: Array<{
        properties: {
            properties: { id: string; name?: string; "name:en"?: string };
            geometry: { coordinates: [number, number] };
        };
    }>;
}) {
    const $zone = useStore(activeHidingZone);
    const $ws = useStore(wsInstance);
    const $code = useStore(sessionCode);
    const $participant = useStore(sessionParticipant);
    const $hidingRadius = useStore(hidingRadius);
    const $hidingRadiusUnits = useStore(hidingRadiusUnits);

    const [searching, setSearching] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [confirmReveal, setConfirmReveal] = useState(false);

    const isHider = $participant?.role === "hider";
    if (!isHider) return null;

    function sendSetZone(station: typeof stations[number]) {
        if (!$ws || $ws.readyState !== WebSocket.OPEN) {
            toast.error("Keine Verbindung zum Server.");
            return;
        }
        const name =
            station.properties.properties["name:en"] ||
            station.properties.properties.name ||
            "Unbekannt";
        const [lng, lat] = station.properties.geometry.coordinates;

        $ws.send(JSON.stringify({
            type: "set_hiding_zone",
            stationName: name,
            lat,
            lng,
            radius: $hidingRadius,
            radiusUnit: $hidingRadiusUnits,
        }));

        setSearching(false);
        setSearchQuery("");
        toast.success(`Versteckzone gesetzt: ${name}`);
    }

    function sendReveal() {
        if (!$ws || $ws.readyState !== WebSocket.OPEN) {
            toast.error("Keine Verbindung zum Server.");
            return;
        }
        $ws.send(JSON.stringify({ type: "reveal_hiding_zone" }));
        setConfirmReveal(false);
        toast.success("Endgame freigegeben!");
    }

    // ── Station search view ──────────────────────────────────────────────────
    if (searching) {
        const filtered = stations.filter((s) => {
            const name = (
                s.properties.properties["name:en"] ||
                s.properties.properties.name ||
                ""
            ).toLowerCase();
            return name.includes(searchQuery.toLowerCase());
        });

        return (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 0" }}>
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Versteckzone suchen…"
                    autoFocus
                    style={{
                        background: "#1E1E2A",
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 10,
                        color: "#fff",
                        fontSize: "14px",
                        padding: "10px 14px",
                        outline: "none",
                        fontFamily: "inherit",
                    }}
                />
                <div style={{ maxHeight: 300, overflowY: "auto" }}>
                    {filtered.length === 0 && (
                        <p style={{ color: "#6B7280", fontSize: "13px", padding: "8px 0" }}>
                            Keine Ergebnisse
                        </p>
                    )}
                    {filtered.map((s) => {
                        const name =
                            s.properties.properties["name:en"] ||
                            s.properties.properties.name ||
                            "Unbekannt";
                        return (
                            <button
                                key={s.properties.properties.id}
                                type="button"
                                onClick={() => sendSetZone(s)}
                                style={{
                                    display: "block",
                                    width: "100%",
                                    textAlign: "left",
                                    padding: "10px 12px",
                                    background: "transparent",
                                    border: "none",
                                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                                    color: "#E5E7EB",
                                    fontSize: "14px",
                                    cursor: "pointer",
                                    fontFamily: "inherit",
                                }}
                            >
                                {name}
                            </button>
                        );
                    })}
                </div>
                <button
                    type="button"
                    onClick={() => { setSearching(false); setSearchQuery(""); }}
                    style={{
                        color: "#99A1AF",
                        textDecoration: "underline",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: "12px",
                        fontWeight: 600,
                        fontFamily: "inherit",
                        padding: "4px 0",
                    }}
                >
                    Abbrechen
                </button>
            </div>
        );
    }

    // ── Confirm reveal dialog ────────────────────────────────────────────────
    if (confirmReveal) {
        return (
            <div style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: "16px 0",
                textAlign: "center",
            }}>
                <p style={{ color: "#E5E7EB", fontSize: "14px", margin: 0 }}>
                    Die Zone wird für alle Seeker sichtbar. Fortfahren?
                </p>
                <button
                    type="button"
                    onClick={sendReveal}
                    style={{
                        background: "#E8323A",
                        color: "#fff",
                        border: "none",
                        borderRadius: 10,
                        padding: "12px",
                        fontWeight: 800,
                        fontSize: "15px",
                        cursor: "pointer",
                        fontFamily: "Poppins, sans-serif",
                    }}
                >
                    Endgame freigeben
                </button>
                <button
                    type="button"
                    onClick={() => setConfirmReveal(false)}
                    style={{
                        color: "#99A1AF",
                        textDecoration: "underline",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: "12px",
                        fontWeight: 600,
                        fontFamily: "inherit",
                    }}
                >
                    Abbrechen
                </button>
            </div>
        );
    }

    // ── No zone set ──────────────────────────────────────────────────────────
    if (!$zone) {
        return (
            <div style={{ padding: "16px 0", textAlign: "center" }}>
                <p style={{ color: "#6B7280", fontSize: "13px", marginBottom: 12 }}>
                    Noch keine Versteckzone gewählt.
                </p>
                <button
                    type="button"
                    onClick={() => setSearching(true)}
                    disabled={stations.length === 0}
                    style={{
                        background: "#22C55E",
                        color: "#fff",
                        border: "none",
                        borderRadius: 10,
                        padding: "14px 24px",
                        fontWeight: 800,
                        fontSize: "15px",
                        cursor: stations.length === 0 ? "not-allowed" : "pointer",
                        opacity: stations.length === 0 ? 0.4 : 1,
                        fontFamily: "Poppins, sans-serif",
                        width: "100%",
                    }}
                >
                    Versteckzone wählen
                </button>
                {stations.length === 0 && (
                    <p style={{ color: "#F59E0B", fontSize: "12px", marginTop: 8 }}>
                        Aktiviere zuerst Versteckzonen im "Alle Zonen"-Tab.
                    </p>
                )}
            </div>
        );
    }

    // ── Zone set ─────────────────────────────────────────────────────────────
    const unitLabel = $zone.radiusUnit === "miles" ? "mi" : "km";

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "8px 0" }}>
            {/* Zone info card */}
            <div style={{
                background: "rgba(34,197,94,0.08)",
                border: "1px solid rgba(34,197,94,0.25)",
                borderRadius: 10,
                padding: "14px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 4,
            }}>
                <span style={{ color: "#22C55E", fontSize: "15px", fontWeight: 700 }}>
                    {$zone.stationName}
                </span>
                <span style={{ color: "#99A1AF", fontSize: "12px" }}>
                    Radius: {$zone.radius} {unitLabel}
                </span>
                {$zone.revealed && (
                    <span style={{ color: "#F59E0B", fontSize: "12px", fontWeight: 600, marginTop: 2 }}>
                        Endgame aktiv — Seeker sehen diese Zone
                    </span>
                )}
            </div>

            {/* Action buttons */}
            <button
                type="button"
                onClick={() => setSearching(true)}
                disabled={stations.length === 0}
                style={{
                    background: "transparent",
                    color: "#22C55E",
                    border: "2px solid #22C55E",
                    borderRadius: 10,
                    padding: "12px",
                    fontWeight: 700,
                    fontSize: "14px",
                    cursor: stations.length === 0 ? "not-allowed" : "pointer",
                    opacity: stations.length === 0 ? 0.4 : 1,
                    fontFamily: "Poppins, sans-serif",
                    width: "100%",
                }}
            >
                Zone ändern
            </button>

            {!$zone.revealed ? (
                <button
                    type="button"
                    onClick={() => setConfirmReveal(true)}
                    style={{
                        background: "#E8323A",
                        color: "#fff",
                        border: "none",
                        borderRadius: 10,
                        padding: "12px",
                        fontWeight: 800,
                        fontSize: "14px",
                        cursor: "pointer",
                        fontFamily: "Poppins, sans-serif",
                        width: "100%",
                    }}
                >
                    Endgame freigeben
                </button>
            ) : (
                <button
                    type="button"
                    disabled
                    style={{
                        background: "#2A2A3A",
                        color: "#6B7280",
                        border: "none",
                        borderRadius: 10,
                        padding: "12px",
                        fontWeight: 800,
                        fontSize: "14px",
                        cursor: "not-allowed",
                        fontFamily: "Poppins, sans-serif",
                        width: "100%",
                    }}
                >
                    Endgame aktiv
                </button>
            )}
        </div>
    );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/session/MyZonePanel.tsx
git commit -m "feat(frontend): add MyZonePanel component for hider zone selection"
```

---

### Task 8: BottomSheetPanel — Sub-Tab Navigation in Versteckzonen

**Files:**
- Modify: `src/components/BottomSheetPanel.tsx`

- [ ] **Step 1: Import MyZonePanel and session atoms**

Add to the imports at the top:

```typescript
import { MyZonePanel } from "./session/MyZonePanel";
import { trainStations } from "@/lib/context";
```

Note: `trainStations` is the atom in `context.ts` that holds the computed station list. If this atom doesn't exist, we'll use the `stations` state from ZoneSidebar. Check first — if it's only local state in ZoneSidebar, we need to lift it. See step 3 for the alternative approach.

- [ ] **Step 2: Add sub-tab state and stations access**

We need the station list from ZoneSidebar to pass to MyZonePanel. The simplest approach: ZoneSidebar already has a `stations` local state. We'll lift it to a module-level atom so MyZonePanel can access it.

In `src/components/ZoneSidebar.tsx`, find the `stations` state declaration (it's a `useState` inside the component) and add an exported atom alongside it:

Find in ZoneSidebar.tsx:
```typescript
const [stations, setStations] = useState<...>([]);
```

Add a new exported atom at module level (before the component function):
```typescript
import { atom } from "nanostores";

/** Shared station list — set by ZoneSidebar, read by MyZonePanel */
export const zoneSidebarStations = atom<any[]>([]);
```

Then inside ZoneSidebar, after every `setStations(...)` call, also call:
```typescript
zoneSidebarStations.set(newStations);
```

- [ ] **Step 3: Replace the Versteckzonen tab content in BottomSheetPanel**

Replace the zonen div (line 156-158):

```typescript
                <div style={{ display: activeTab === "zonen" ? "block" : "none" }}>
                    <ZoneSidebar />
                </div>
```

with:

```typescript
                <div style={{ display: activeTab === "zonen" ? "block" : "none" }}>
                    {isHider && inSession ? (
                        <ZoneSubTabs />
                    ) : (
                        <ZoneSidebar />
                    )}
                </div>
```

- [ ] **Step 4: Add the ZoneSubTabs component**

Add inside BottomSheetPanel.tsx (before the `BottomSheetPanel` export or after it):

```typescript
import { zoneSidebarStations } from "./ZoneSidebar";

function ZoneSubTabs() {
    const [subTab, setSubTab] = useState<"meine" | "alle">("meine");
    const $stations = useStore(zoneSidebarStations);

    const tabStyle = (active: boolean): React.CSSProperties => ({
        flex: 1,
        padding: "8px 0",
        background: "none",
        border: "none",
        borderBottom: active ? "2px solid #22C55E" : "2px solid transparent",
        color: active ? "#fff" : "#6B7280",
        fontSize: "13px",
        fontWeight: active ? 700 : 500,
        cursor: "pointer",
        fontFamily: "inherit",
    });

    return (
        <div>
            <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <button type="button" onClick={() => setSubTab("meine")} style={tabStyle(subTab === "meine")}>
                    Meine Zone
                </button>
                <button type="button" onClick={() => setSubTab("alle")} style={tabStyle(subTab === "alle")}>
                    Alle Zonen
                </button>
            </div>
            <div style={{ display: subTab === "meine" ? "block" : "none", padding: "0 8px" }}>
                <MyZonePanel stations={$stations} />
            </div>
            <div style={{ display: subTab === "alle" ? "block" : "none" }}>
                <ZoneSidebar />
            </div>
        </div>
    );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/BottomSheetPanel.tsx src/components/ZoneSidebar.tsx
git commit -m "feat(frontend): add sub-tab navigation for Meine Zone / Alle Zonen"
```

---

### Task 9: Map — Persistent Hiding Zone Circle

**Files:**
- Modify: `src/components/Map.tsx`

- [ ] **Step 1: Find the Map component and add the hiding zone circle effect**

Import the atoms at the top:

```typescript
import { activeHidingZone, revealedHidingZone, sessionParticipant } from "@/lib/session-context";
```

Add a `useEffect` that renders the circle. Place it among the existing map effects:

```typescript
    // ── Persistent hiding zone circle ────────────────────────────────────────
    useEffect(() => {
        const map = leafletMapContext.get();
        if (!map) return;

        // Remove existing hiding zone circle
        map.eachLayer((layer: any) => {
            if (layer.hidingZoneActive) map.removeLayer(layer);
        });

        const role = sessionParticipant.get()?.role;
        const zone = role === "hider"
            ? activeHidingZone.get()
            : revealedHidingZone.get();

        if (!zone) return;

        const radiusM = zone.radiusUnit === "miles"
            ? zone.radius * 1609.34
            : zone.radius * 1000;

        const circle = L.circle([zone.lat, zone.lng], {
            radius: radiusM,
            color: "#22C55E",
            fillColor: "#22C55E",
            fillOpacity: 0.15,
            weight: 2,
        }) as any;
        circle.hidingZoneActive = true;
        circle.addTo(map);

        // Add station name popup
        circle.bindPopup(`<b>${zone.stationName}</b>`);
    });
```

However, this effect needs to re-run when the atoms change. Since we're using Nanostores (not React state), we need to subscribe:

```typescript
    useEffect(() => {
        const map = leafletMapContext.get();
        if (!map) return;

        function drawZoneCircle() {
            // Remove existing
            map!.eachLayer((layer: any) => {
                if (layer.hidingZoneActive) map!.removeLayer(layer);
            });

            const role = sessionParticipant.get()?.role;
            const zone = role === "hider"
                ? activeHidingZone.get()
                : revealedHidingZone.get();

            if (!zone) return;

            const radiusM = zone.radiusUnit === "miles"
                ? zone.radius * 1609.34
                : zone.radius * 1000;

            const circle = L.circle([zone.lat, zone.lng], {
                radius: radiusM,
                color: "#22C55E",
                fillColor: "#22C55E",
                fillOpacity: 0.15,
                weight: 2,
            }) as any;
            circle.hidingZoneActive = true;
            circle.addTo(map!);
            circle.bindPopup(`<b>${zone.stationName}</b>`);
        }

        drawZoneCircle();

        const unsub1 = activeHidingZone.subscribe(drawZoneCircle);
        const unsub2 = revealedHidingZone.subscribe(drawZoneCircle);

        return () => {
            unsub1();
            unsub2();
            map.eachLayer((layer: any) => {
                if (layer.hidingZoneActive) map.removeLayer(layer);
            });
        };
    }, []); // Run once after mount — subscriptions handle updates
```

- [ ] **Step 2: Add toast for seeker when zone is revealed**

In `src/hooks/useSessionWebSocket.ts`, in the `hiding_zone_revealed` case handler, add a toast:

```typescript
                    case "hiding_zone_revealed":
                        revealedHidingZone.set(event.hidingZone);
                        toast.info("Der Hider hat seine Versteckzone freigegeben!");
                        break;
```

Add the toast import if not already present:

```typescript
import { toast } from "react-toastify";
```

- [ ] **Step 3: Clean up circle in leaveSession**

In `src/lib/session-context.ts`, inside `leaveSession()`, add after `hiderMode.set(false);`:

```typescript
    // Remove hiding zone circle from map
    const currentMap = leafletMapContext.get();
    if (currentMap) {
        currentMap.eachLayer((layer: any) => {
            if (layer.hidingZoneActive) currentMap.removeLayer(layer);
        });
    }
```

Add `leafletMapContext` to the imports from `@/lib/context` if not already there (it's already imported on line 28).

- [ ] **Step 4: Commit**

```bash
git add src/components/Map.tsx src/hooks/useSessionWebSocket.ts src/lib/session-context.ts
git commit -m "feat(frontend): render persistent hiding zone circle on map + toast on reveal"
```

---

### Task 10: TypeScript Check + Manual Testing

- [ ] **Step 1: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 2: Run backend**

```bash
cd backend && npx tsx src/index.ts
```

Expected: Server starts, migration v5 applies on first run.

- [ ] **Step 3: Manual test flow**

1. Open browser, create a session as hider
2. Go to Versteckzonen tab → see "Meine Zone" sub-tab (default) + "Alle Zonen" sub-tab
3. Switch to "Alle Zonen", enable Versteckzonen, configure stations
4. Switch back to "Meine Zone" → click "Versteckzone wählen"
5. Search for a station, select it → green circle appears on map
6. Click "Zone ändern" → select different station → circle moves
7. Click "Endgame freigeben" → confirm dialog → sends reveal
8. Open second browser as seeker → should NOT see zone before reveal
9. After reveal: green circle appears on seeker map + toast

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: hiding zone selection and endgame reveal"
```
