# Unique Player Pins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each player appears exactly once on the map — Seeker in red, Hider in green — with no duplicate pins from Follow-Me or GPS coexistence.

**Architecture:** Replace `SeekerMarkers.tsx` with `PlayerMarkers.tsx` that handles both roles. Remove the imperative Follow-Me marker from `Map.tsx`. Change Hider icon color to green in `DraggableMarkers.tsx`.

**Tech Stack:** React-Leaflet (CircleMarker, Tooltip), nanostores, existing `useGpsTracking` hook + `ownGpsPosition` atom.

**Spec:** `docs/superpowers/specs/2026-03-29-unique-player-pins-design.md`

---

### Task 1: Rename SeekerMarkers → PlayerMarkers and update colors

**Files:**
- Delete: `src/components/SeekerMarkers.tsx`
- Create: `src/components/PlayerMarkers.tsx`
- Modify: `src/components/Map.tsx` (import path)

- [ ] **Step 1: Create `src/components/PlayerMarkers.tsx`**

```tsx
/**
 * PlayerMarkers — renders player position pins on the map.
 *
 * - Every player sees their own pin (Seeker=red, Hider=green), labeled "Ich"
 * - Hider additionally sees all Seeker positions as red pins with displayName
 * - GPS position (`ownGpsPosition`) is the sole source for the own marker
 * - Seeker positions are deduplicated by id before rendering
 */
import { useStore } from "@nanostores/react";
import { CircleMarker, Tooltip } from "react-leaflet";

import { sessionParticipant, seekerPositions, ownGpsPosition } from "@/lib/session-context";

const COLOR_SEEKER = "#E8323A";
const COLOR_HIDER = "#22C55E";

export function PlayerMarkers() {
    const participant = useStore(sessionParticipant);
    const positions = useStore(seekerPositions);
    const ownPos = useStore(ownGpsPosition);

    if (!participant) return null;

    const ownColor = participant.role === "hider" ? COLOR_HIDER : COLOR_SEEKER;

    // Deduplicate seeker positions by id (keep last occurrence)
    const uniqueSeekers = [...new Map(positions.map((s) => [s.id, s])).values()];

    return (
        <>
            {/* Own position pin (both roles) */}
            {ownPos && (
                <CircleMarker
                    center={[ownPos.lat, ownPos.lng]}
                    radius={8}
                    pathOptions={{
                        color: ownColor,
                        fillColor: ownColor,
                        fillOpacity: 0.85,
                        weight: 2,
                    }}
                >
                    <Tooltip
                        permanent
                        direction="top"
                        offset={[0, -10]}
                        className="seeker-name-tooltip"
                    >
                        Ich
                    </Tooltip>
                </CircleMarker>
            )}

            {/* Hider sees all seeker positions */}
            {participant.role === "hider" &&
                uniqueSeekers.map((seeker) => (
                    <CircleMarker
                        key={seeker.id}
                        center={[seeker.lat, seeker.lng]}
                        radius={8}
                        pathOptions={{
                            color: COLOR_SEEKER,
                            fillColor: COLOR_SEEKER,
                            fillOpacity: 0.85,
                            weight: 2,
                        }}
                    >
                        <Tooltip
                            permanent
                            direction="top"
                            offset={[0, -10]}
                            className="seeker-name-tooltip"
                        >
                            {seeker.displayName}
                        </Tooltip>
                    </CircleMarker>
                ))}
        </>
    );
}
```

- [ ] **Step 2: Delete old `SeekerMarkers.tsx`**

Delete: `src/components/SeekerMarkers.tsx`

- [ ] **Step 3: Update import in `Map.tsx`**

In `src/components/Map.tsx`, find:
```typescript
import { SeekerMarkers } from "./SeekerMarkers";
```
Replace with:
```typescript
import { PlayerMarkers } from "./PlayerMarkers";
```

Then find the JSX usage:
```tsx
<SeekerMarkers />
```
Replace with:
```tsx
<PlayerMarkers />
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/PlayerMarkers.tsx src/components/Map.tsx
git rm src/components/SeekerMarkers.tsx
git commit -m "feat: PlayerMarkers with role-based colors and dedup"
```

---

### Task 2: Remove Follow-Me marker from Map.tsx

**Files:**
- Modify: `src/components/Map.tsx`

- [ ] **Step 1: Remove Follow-Me state variables**

In `src/components/Map.tsx`, remove these lines from the imports (around line 14):
```typescript
    followMe,
```
(Remove it from the destructured import from `@/lib/context`.)

Remove these lines from inside the `Map` component (around lines 67-77):
```typescript
    const $followMe = useStore(followMe);

    const followMeMarkerRef = useMemo(
        () => ({ current: null as L.Marker | null }),
        [],
    );
    const geoWatchIdRef = useMemo(
        () => ({ current: null as number | null }),
        [],
    );
```

- [ ] **Step 2: Remove the Follow-Me useEffect**

Remove the entire `useEffect` block that starts around line 321:
```typescript
    useEffect(() => {
        if (!map) return;
        if (!$followMe) {
            ...
        }
        geoWatchIdRef.current = navigator.geolocation.watchPosition(
            ...
        );
        return () => {
            ...
        };
    }, [$followMe, map]);
```

This is the block from approximately line 321 to line 369.

- [ ] **Step 3: Clean up unused imports**

Check if `toast` from `react-toastify` is still used elsewhere in Map.tsx. If the Follow-Me error handler was the only usage, remove the import. Same for `useMemo` from React if no longer used.

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/Map.tsx
git commit -m "refactor: remove Follow-Me marker from Map.tsx"
```

---

### Task 3: Change Hider icon to green in DraggableMarkers.tsx

**Files:**
- Modify: `src/components/DraggableMarkers.tsx`

- [ ] **Step 1: Update `HIDER_ICON` color**

In `src/components/DraggableMarkers.tsx`, find the `HIDER_ICON` constant (around line 35):

```typescript
const HIDER_ICON = divIcon({
    className: "",
    html: `<div style="
        width:20px;height:20px;
        background:#E8323A;
        border-radius:50%;
        border:3px solid #fff;
        box-shadow:0 0 0 4px rgba(232,50,58,0.35),0 2px 8px rgba(0,0,0,0.5);
        box-sizing:border-box;
    "></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
});
```

Replace with:

```typescript
const HIDER_ICON = divIcon({
    className: "",
    html: `<div style="
        width:20px;height:20px;
        background:#22C55E;
        border-radius:50%;
        border:3px solid #fff;
        box-shadow:0 0 0 4px rgba(34,197,94,0.35),0 2px 8px rgba(0,0,0,0.5);
        box-sizing:border-box;
    "></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
});
```

Changes: `#E8323A` → `#22C55E` (green), `rgba(232,50,58,0.35)` → `rgba(34,197,94,0.35)` (green glow).

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/DraggableMarkers.tsx
git commit -m "fix: hider marker color red → green"
```

---

### Task 4: Enable GPS tracking for Hider role

**Files:**
- Modify: `src/hooks/useGpsTracking.ts`

Currently `useGpsTracking` only activates for seekers (line 32: `participant.role !== "seeker"`). The hider also needs GPS to show their own "Ich" pin. However, hiders should NOT broadcast their position via WebSocket.

- [ ] **Step 1: Update `useGpsTracking` to track GPS for both roles**

In `src/hooks/useGpsTracking.ts`, find the guard (line 32):

```typescript
        if (!participant || participant.role !== "seeker" || !ws) {
            return;
        }
```

Replace with:

```typescript
        if (!participant) {
            return;
        }
```

Then in the `sendPosition` function, add a role check so only seekers broadcast:

Find:
```typescript
        function sendPosition() {
            const pos = latestPosRef.current;
            if (!pos || !ws || ws.readyState !== WebSocket.OPEN) return;
```

Replace with:
```typescript
        function sendPosition() {
            const pos = latestPosRef.current;
            if (!pos || !ws || ws.readyState !== WebSocket.OPEN) return;
            // Only seekers broadcast their position to the server
            if (participant.role !== "seeker") return;
```

Also update the outer effect dependencies — remove the `ws` requirement for the GPS watch to start (hider may not need WS for local GPS). Find:

```typescript
        if (!navigator.geolocation) {
```

Before this line, add:
```typescript
        // Hider tracks GPS locally but doesn't need WS
        const needsWs = participant.role === "seeker";
        if (needsWs && !ws) return;
```

And remove `!ws` from the original guard (already done in step above).

The full updated effect start should be:

```typescript
    useEffect(() => {
        if (!participant) {
            return;
        }

        if (!navigator.geolocation) {
            console.warn("[useGpsTracking] Geolocation not supported");
            return;
        }

        // Hider tracks GPS locally but doesn't need WS
        const needsWs = participant.role === "seeker";
        if (needsWs && !ws) return;

        function sendPosition() {
            const pos = latestPosRef.current;
            if (!pos || !ws || ws.readyState !== WebSocket.OPEN) return;
            // Only seekers broadcast their position to the server
            if (participant!.role !== "seeker") return;

            const now = Date.now();
            if (now - lastSentRef.current < SEND_INTERVAL_MS) return;

            lastSentRef.current = now;
            ws.send(
                JSON.stringify({
                    type: "position_update",
                    lat: pos.lat,
                    lng: pos.lng,
                }),
            );
        }
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useGpsTracking.ts
git commit -m "feat: enable GPS tracking for hider (local only, no broadcast)"
```

---

### Task 5: Remove Follow-Me toggle from settings

**Files:**
- Modify: `src/components/settings/GeneralSettings.tsx`

- [ ] **Step 1: Remove Follow-Me toggle**

In `src/components/settings/GeneralSettings.tsx`:

1. Remove `followMe` from the import from `@/lib/context` (line 8)
2. Remove `const $followMe = useStore(followMe);` (line 29)
3. Remove the entire switch/toggle JSX for followMe (around lines 88-95 — the block with `checked={$followMe}` and `onCheckedChange={(v) => followMe.set(v)}`)

- [ ] **Step 2: Clean up AdvancedSettings if needed**

In `src/components/settings/AdvancedSettings.tsx`:

1. Check if `followMe` is imported but not used in the rendered JSX. If so, remove the import (line 9) and the `const $followMe = useStore(followMe);` (line 50).

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/GeneralSettings.tsx src/components/settings/AdvancedSettings.tsx
git commit -m "chore: remove Follow-Me toggle from settings"
```

---

### Task 6: Verify end-to-end

- [ ] **Step 1: Full type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Check no remaining references to SeekerMarkers**

Run: `grep -r "SeekerMarkers" src/`
Expected: No matches.

- [ ] **Step 3: Check no remaining followMeMarkerRef references**

Run: `grep -r "followMeMarkerRef\|geoWatchIdRef" src/components/Map.tsx`
Expected: No matches.

- [ ] **Step 4: Commit any fixes**
