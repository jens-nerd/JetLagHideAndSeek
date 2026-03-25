# Hide & Seek Mobile App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React Native/Expo mobile app for iOS and Android that connects to the existing Hide & Seek backend, with background GPS tracking and push notifications.

**Architecture:** New Expo repo (`hideandseek-mobile`) with Expo Router for navigation, MapLibre for OSM maps, Zustand for state, and expo-location/expo-notifications for native features. The existing Hono backend gets 2 new REST endpoints (GPS post, push token). Shared types are copied initially.

**Tech Stack:** React Native, Expo (Custom Dev Build), Expo Router, MapLibre React Native, Zustand, NativeWind, expo-location, expo-task-manager, expo-notifications, expo-image-picker

**Spec:** `docs/superpowers/specs/2026-03-25-mobile-app-react-native-design.md`

---

## Phase 1: Project Scaffold & Foundation

### Task 1: Initialize Expo Project

**Files:**
- Create: `hideandseek-mobile/` (new repo, sibling to hideandseek)
- Create: `hideandseek-mobile/app.config.ts`
- Create: `hideandseek-mobile/tsconfig.json`

**Prerequisites:** Node.js >= 20, npm/yarn installed

- [ ] **Step 1: Create Expo project with Expo Router template**

```bash
cd /Users/jensvielhaben-nl001
npx create-expo-app@latest hideandseek-mobile --template tabs
cd hideandseek-mobile
```

- [ ] **Step 2: Install core dependencies**

```bash
npx expo install expo-location expo-task-manager expo-notifications expo-image-picker expo-device expo-constants @react-native-async-storage/async-storage
npm install zustand nativewind tailwindcss @gorhom/bottom-sheet react-native-reanimated react-native-gesture-handler
npm install @maplibre/maplibre-react-native lucide-react-native
npm install -D jest jest-expo @testing-library/react-native @types/jest ts-jest
```

- [ ] **Step 3: Configure `app.config.ts` with native permissions**

Replace the default app config with:

```typescript
// app.config.ts
import { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Hide & Seek",
  slug: "hideandseek",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "hideandseek",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  ios: {
    supportsTablet: false,
    bundleIdentifier: "com.hideandseek.app",
    infoPlist: {
      UIBackgroundModes: ["location"],
      NSLocationAlwaysAndWhenInUseUsageDescription:
        "Tracks your position during the hide and seek game so other players can find you.",
      NSLocationWhenInUseUsageDescription:
        "Shows your position on the map during the game.",
      NSCameraUsageDescription:
        "Take photos to answer photo questions in the game.",
      NSPhotoLibraryUsageDescription:
        "Select photos to answer photo questions in the game.",
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/images/adaptive-icon.png",
      backgroundColor: "#1F2F3F",
    },
    package: "com.hideandseek.app",
    permissions: [
      "ACCESS_FINE_LOCATION",
      "ACCESS_COARSE_LOCATION",
      "ACCESS_BACKGROUND_LOCATION",
      "CAMERA",
      "READ_EXTERNAL_STORAGE",
    ],
  },
  plugins: [
    "expo-router",
    [
      "expo-location",
      { locationAlwaysAndWhenInUsePermission: "Tracks your position during the hide and seek game." },
    ],
    [
      "expo-notifications",
      { icon: "./assets/images/notification-icon.png", color: "#1F2F3F" },
    ],
    ["expo-image-picker", { photosPermission: "Select photos for photo questions." }],
  ],
});
```

- [ ] **Step 4: Configure Jest for testing**

Create `jest.config.js`:
```javascript
module.exports = {
  preset: "jest-expo",
  setupFiles: ["./jest.setup.js"],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|nativewind)"
  ],
};
```

Create `jest.setup.js`:
```javascript
require("@react-native-async-storage/async-storage/jest/async-storage-mock");
```

Verify tests infrastructure works:
```bash
npx jest --version
```

- [ ] **Step 5: Set up NativeWind (Tailwind for RN)**

Create `tailwind.config.js`:
```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary: "#1F2F3F",
      },
    },
  },
  plugins: [],
};
```

Create `global.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

Add NativeWind preset to `babel.config.js`:
```javascript
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
  };
};
```

Add NativeWind to `metro.config.js`:
```javascript
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);
module.exports = withNativeWind(config, { input: "./global.css" });
```

- [ ] **Step 6: Run `expo prebuild` to generate native projects**

```bash
npx expo prebuild
```

This generates `ios/` and `android/` directories needed for MapLibre and background location native modules.

- [ ] **Step 7: Verify the app starts on a simulator/device**

```bash
npx expo run:ios
# or
npx expo run:android
```

Expected: Default tabs template loads without errors.

- [ ] **Step 8: Verify `.gitignore` covers native build artifacts**

Check that `.gitignore` includes `ios/`, `android/`, `node_modules/`, `.env*`. The Expo template usually covers this, but verify after `expo prebuild`.

- [ ] **Step 9: Initialize git and commit**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
git init
git add .
git commit -m "feat: initialize Expo project with core dependencies"
```

---

### Task 2: Copy Shared Types

**Files:**
- Create: `hideandseek-mobile/shared/types.ts`
- Create: `hideandseek-mobile/shared/events.ts`

**Reference:** `hideandseek/shared/src/types.ts`, `hideandseek/shared/src/events.ts`

- [ ] **Step 1: Copy shared type files**

```bash
mkdir -p /Users/jensvielhaben-nl001/hideandseek-mobile/shared
cp /Users/jensvielhaben-nl001/hideandseek/shared/src/types.ts /Users/jensvielhaben-nl001/hideandseek-mobile/shared/types.ts
cp /Users/jensvielhaben-nl001/hideandseek/shared/src/events.ts /Users/jensvielhaben-nl001/hideandseek-mobile/shared/events.ts
```

- [ ] **Step 2: Fix imports — remove `.js` extensions (not needed in RN bundler)**

In both files, replace any `import ... from "./types.js"` with `import ... from "./types"` etc.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add shared/
git commit -m "feat: copy shared types from web project"
```

---

### Task 3: Session Store (Zustand + AsyncStorage)

**Files:**
- Create: `hideandseek-mobile/lib/session-store.ts`
- Create: `hideandseek-mobile/lib/__tests__/session-store.test.ts`

**Reference:** `hideandseek/src/lib/session-context.ts` — same atom structure, adapted to Zustand.

- [ ] **Step 1: Write test for session store**

```typescript
// lib/__tests__/session-store.test.ts
import { useSessionStore } from "../session-store";

describe("session-store", () => {
  beforeEach(() => {
    useSessionStore.getState().leaveSession();
  });

  it("starts with no session", () => {
    const state = useSessionStore.getState();
    expect(state.sessionCode).toBeNull();
    expect(state.sessionParticipant).toBeNull();
    expect(state.isInSession()).toBe(false);
  });

  it("sets session after join", () => {
    const store = useSessionStore.getState();
    store.setSessionCode("ABC123");
    store.setSessionParticipant({
      id: "p1",
      sessionId: "s1",
      role: "seeker",
      displayName: "Test",
      token: "tok123",
      joinedAt: new Date().toISOString(),
    });
    expect(useSessionStore.getState().isInSession()).toBe(true);
    expect(useSessionStore.getState().getRole()).toBe("seeker");
  });

  it("leaveSession clears all state", () => {
    const store = useSessionStore.getState();
    store.setSessionCode("ABC123");
    store.setSessionParticipant({
      id: "p1", sessionId: "s1", role: "hider",
      displayName: "H", token: "t", joinedAt: new Date().toISOString(),
    });
    store.leaveSession();
    expect(useSessionStore.getState().sessionCode).toBeNull();
    expect(useSessionStore.getState().sessionParticipant).toBeNull();
    expect(useSessionStore.getState().sessionQuestions).toEqual([]);
  });

  it("upserts questions", () => {
    const q = {
      id: "q1", sessionId: "s1", createdByParticipantId: "p1",
      type: "radius", data: {}, status: "pending" as const,
      createdAt: new Date().toISOString(),
    };
    useSessionStore.getState().upsertSessionQuestion(q);
    expect(useSessionStore.getState().sessionQuestions).toHaveLength(1);

    // Update same question
    useSessionStore.getState().upsertSessionQuestion({ ...q, status: "answered" });
    expect(useSessionStore.getState().sessionQuestions).toHaveLength(1);
    expect(useSessionStore.getState().sessionQuestions[0].status).toBe("answered");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest lib/__tests__/session-store.test.ts
```

Expected: FAIL — `Cannot find module '../session-store'`

- [ ] **Step 3: Implement session store**

```typescript
// lib/session-store.ts
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Session, SessionQuestion, ParticipantWithToken } from "../shared/types";

interface SeekerPosition {
  id: string;
  displayName: string;
  lat: number;
  lng: number;
}

interface SessionMember {
  id: string;
  role: "hider" | "seeker";
  displayName: string;
}

interface SessionState {
  // Persisted
  sessionCode: string | null;
  sessionParticipant: ParticipantWithToken | null;
  gameSize: "S" | "M" | "L" | null;

  // In-memory
  currentSession: Session | null;
  sessionQuestions: SessionQuestion[];
  wsStatus: "disconnected" | "connecting" | "connected";
  sessionMembers: SessionMember[];
  seekerPositions: SeekerPosition[];
  seekerCount: number;
  hiderConnected: boolean;
  recentlyAnswered: { id: string; positive: boolean } | null;
  newQuestionReceived: { id: string; type: string } | null;
  ownGpsPosition: { lat: number; lng: number } | null;

  // Actions
  setSessionCode: (code: string | null) => void;
  setSessionParticipant: (p: ParticipantWithToken | null) => void;
  setGameSize: (size: "S" | "M" | "L" | null) => void;
  setCurrentSession: (s: Session | null) => void;
  setWsStatus: (status: "disconnected" | "connecting" | "connected") => void;
  setSessionMembers: (members: SessionMember[]) => void;
  setSeekerPositions: (positions: SeekerPosition[]) => void;
  setSeekerCount: (count: number) => void;
  setHiderConnected: (connected: boolean) => void;
  setRecentlyAnswered: (data: { id: string; positive: boolean } | null) => void;
  setNewQuestionReceived: (data: { id: string; type: string } | null) => void;
  setOwnGpsPosition: (pos: { lat: number; lng: number } | null) => void;
  upsertSessionQuestion: (q: SessionQuestion) => void;
  setSessionQuestions: (questions: SessionQuestion[]) => void;
  leaveSession: () => void;

  // Derived
  isInSession: () => boolean;
  getRole: () => "hider" | "seeker" | null;
  getToken: () => string | null;
}

const initialInMemoryState = {
  currentSession: null,
  sessionQuestions: [],
  wsStatus: "disconnected" as const,
  sessionMembers: [],
  seekerPositions: [],
  seekerCount: 0,
  hiderConnected: false,
  recentlyAnswered: null,
  newQuestionReceived: null,
  ownGpsPosition: null,
};

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      // Persisted
      sessionCode: null,
      sessionParticipant: null,
      gameSize: null,

      // In-memory
      ...initialInMemoryState,

      // Actions
      setSessionCode: (code) => set({ sessionCode: code }),
      setSessionParticipant: (p) => set({ sessionParticipant: p }),
      setGameSize: (size) => set({ gameSize: size }),
      setCurrentSession: (s) => set({ currentSession: s }),
      setWsStatus: (status) => set({ wsStatus: status }),
      setSessionMembers: (members) => set({ sessionMembers: members }),
      setSeekerPositions: (positions) => set({ seekerPositions: positions }),
      setSeekerCount: (count) => set({ seekerCount: count }),
      setHiderConnected: (connected) => set({ hiderConnected: connected }),
      setRecentlyAnswered: (data) => set({ recentlyAnswered: data }),
      setNewQuestionReceived: (data) => set({ newQuestionReceived: data }),
      setOwnGpsPosition: (pos) => set({ ownGpsPosition: pos }),
      setSessionQuestions: (questions) => set({ sessionQuestions: questions }),

      upsertSessionQuestion: (q) =>
        set((state) => {
          const idx = state.sessionQuestions.findIndex((sq) => sq.id === q.id);
          if (idx >= 0) {
            const updated = [...state.sessionQuestions];
            updated[idx] = q;
            return { sessionQuestions: updated };
          }
          return { sessionQuestions: [...state.sessionQuestions, q] };
        }),

      leaveSession: () =>
        set({
          sessionCode: null,
          sessionParticipant: null,
          gameSize: null,
          ...initialInMemoryState,
        }),

      // Derived
      isInSession: () => {
        const s = get();
        return s.sessionCode !== null && s.sessionParticipant !== null;
      },
      getRole: () => get().sessionParticipant?.role ?? null,
      getToken: () => get().sessionParticipant?.token ?? null,
    }),
    {
      name: "hideandseek-session",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        sessionCode: state.sessionCode,
        sessionParticipant: state.sessionParticipant,
        gameSize: state.gameSize,
      }),
    }
  )
);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest lib/__tests__/session-store.test.ts
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ shared/
git commit -m "feat: add Zustand session store with AsyncStorage persistence"
```

---

### Task 4: API Client

**Files:**
- Create: `hideandseek-mobile/lib/session-api.ts`
- Create: `hideandseek-mobile/lib/__tests__/session-api.test.ts`
- Create: `hideandseek-mobile/lib/config.ts`

**Reference:** `hideandseek/src/lib/session-api.ts` — same endpoints, adapted for RN.

- [ ] **Step 1: Create config for backend URL**

```typescript
// lib/config.ts
// In development, use your machine's local IP (not localhost — simulators can't reach it)
// In production, use the deployed backend URL
export const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? "http://192.168.1.100:3001";
export const BACKEND_WS_URL = process.env.EXPO_PUBLIC_BACKEND_WS_URL ?? "ws://192.168.1.100:3001";
```

- [ ] **Step 2: Write test for API client**

```typescript
// lib/__tests__/session-api.test.ts
import { createSession, getSession, joinSession } from "../session-api";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("session-api", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("createSession sends POST and returns session + participant", async () => {
    const mockResponse = {
      session: { id: "s1", code: "ABC123", status: "waiting" },
      participant: { id: "p1", token: "tok", role: "hider", displayName: "Host" },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await createSession({ displayName: "Host" });
    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/sessions"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("getSession sends GET", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ session: { id: "s1", code: "ABC123" } }),
    });

    const result = await getSession("ABC123");
    expect(result.session.code).toBe("ABC123");
  });

  it("throws ApiError on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "Session not found" }),
    });

    await expect(getSession("NOPE")).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx jest lib/__tests__/session-api.test.ts
```

Expected: FAIL — `Cannot find module '../session-api'`

- [ ] **Step 4: Implement API client**

```typescript
// lib/session-api.ts
import { BACKEND_URL } from "./config";
import type {
  CreateSessionRequest,
  JoinSessionRequest,
  AddQuestionRequest,
  AnswerQuestionRequest,
  UpdateMapLocationRequest,
  Session,
  SessionQuestion,
  ParticipantWithToken,
} from "../shared/types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<T> {
  const { token, ...fetchOptions } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["x-participant-token"] = token;
  }

  let response: Response;
  try {
    response = await fetch(`${BACKEND_URL}${path}`, { ...fetchOptions, headers });
  } catch (e) {
    throw new ApiError(0, "Network error — check your connection.");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new ApiError(response.status, body.error ?? `HTTP ${response.status}`);
  }

  return response.json();
}

// --- Session endpoints ---

interface CreateSessionResponse {
  session: Session;
  participant: ParticipantWithToken;
}

export function createSession(body: CreateSessionRequest): Promise<CreateSessionResponse> {
  return apiFetch("/api/sessions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

interface GetSessionResponse {
  session: Session;
  questions: SessionQuestion[];
  seekerCount: number;
  hiderConnected: boolean;
}

export function getSession(code: string): Promise<GetSessionResponse> {
  return apiFetch(`/api/sessions/${code}`);
}

interface JoinSessionResponse {
  session: Session;
  participant: ParticipantWithToken;
}

export function joinSession(code: string, body: JoinSessionRequest): Promise<JoinSessionResponse> {
  return apiFetch(`/api/sessions/${code}/join`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateMapLocation(code: string, token: string, body: UpdateMapLocationRequest) {
  return apiFetch(`/api/sessions/${code}/map`, {
    method: "PATCH",
    token,
    body: JSON.stringify(body),
  });
}

// --- Question endpoints ---

export function addQuestion(code: string, token: string, body: AddQuestionRequest) {
  return apiFetch<{ question: SessionQuestion }>(`/api/sessions/${code}/questions`, {
    method: "POST",
    token,
    body: JSON.stringify(body),
  });
}

export function answerQuestion(questionId: string, token: string, body: AnswerQuestionRequest) {
  return apiFetch<{ question: SessionQuestion }>(`/api/questions/${questionId}/answer`, {
    method: "POST",
    token,
    body: JSON.stringify(body),
  });
}

export function getQuestions(code: string, token: string) {
  return apiFetch<{ questions: SessionQuestion[] }>(`/api/sessions/${code}/questions`, {
    token,
  });
}

// --- GPS endpoint (new, for background location) ---

export function postGpsPosition(code: string, token: string, lat: number, lng: number) {
  return apiFetch(`/api/sessions/${code}/gps`, {
    method: "POST",
    token,
    body: JSON.stringify({ lat, lng, timestamp: new Date().toISOString() }),
  });
}

// --- Push token endpoint (new) ---

export function registerPushToken(code: string, participantId: string, token: string, pushToken: string) {
  return apiFetch(`/api/sessions/${code}/participants/${participantId}/push-token`, {
    method: "POST",
    token,
    body: JSON.stringify({ pushToken }),
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx jest lib/__tests__/session-api.test.ts
```

Expected: All 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/
git commit -m "feat: add API client with all session/question/gps/push endpoints"
```

---

## Phase 2: Backend Extensions

### Task 5: GPS POST Endpoint

**Files:**
- Modify: `hideandseek/backend/src/routes/sessions.ts` (add GPS route)
- Create: `hideandseek/backend/src/routes/__tests__/gps.test.ts`

**Note:** These changes are in the ORIGINAL `hideandseek` repo, not the mobile repo.

- [ ] **Step 1: Write test for GPS endpoint**

```typescript
// backend/src/routes/__tests__/gps.test.ts
// Test that:
// 1. POST /api/sessions/:code/gps with valid seeker token → 200, broadcasts position
// 2. POST without token → 401
// 3. POST with hider token → 403 (seeker-only)
// 4. POST too frequently (< 10s) → 429
```

Write a test using the existing test setup pattern in the backend. Check `backend/` for existing test patterns (vitest or jest).

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/jensvielhaben-nl001/hideandseek/backend
npx jest routes/__tests__/gps.test.ts
# or npx vitest run if using vitest
```

Expected: FAIL — route does not exist.

- [ ] **Step 3: Implement GPS endpoint**

Add to `backend/src/routes/sessions.ts` (or create new file `backend/src/routes/gps.ts`):

```typescript
// Rate limit map: participantId → lastTimestamp
const gpsRateLimit = new Map<string, number>();

app.post("/api/sessions/:code/gps", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const token = c.req.header("x-participant-token");
  if (!token) return c.json({ error: "Missing token" }, 401);

  // Find session
  const session = await db.query.sessions.findFirst({
    where: eq(schema.sessions.code, code),
  });
  if (!session) return c.json({ error: "Session not found" }, 404);

  // Find participant by token
  const participant = await db.query.participants.findFirst({
    where: and(
      eq(schema.participants.token, token),
      eq(schema.participants.sessionId, session.id)
    ),
  });
  if (!participant) return c.json({ error: "Invalid token" }, 403);
  if (participant.role !== "seeker") return c.json({ error: "Only seekers can send GPS" }, 403);

  // Rate limit: 1 update per 10 seconds
  const now = Date.now();
  const lastUpdate = gpsRateLimit.get(participant.id) ?? 0;
  if (now - lastUpdate < 10_000) {
    return c.json({ error: "Too many updates" }, 429);
  }
  gpsRateLimit.set(participant.id, now);

  const { lat, lng } = await c.req.json();

  // Broadcast seeker position to hiders via WS manager.
  // The WS handler normally stores positions on ConnectedClient objects,
  // but REST has no WS client. Add a new method to wsManager:
  wsManager.broadcastSeekerPositionFromRest(session.code, participant.id, participant.displayName, lat, lng);

  return c.json({ ok: true });
});
```

**Important:** Add this method to `backend/src/ws/manager.ts`:

```typescript
// In WebSocketManager class
broadcastSeekerPositionFromRest(
  sessionCode: string,
  participantId: string,
  displayName: string,
  lat: number,
  lng: number
) {
  // Build positions array: combine connected seeker positions + this REST position
  const room = this.rooms.get(sessionCode);
  if (!room) return;

  const positions = [];

  // Add positions from connected WS seekers
  for (const client of room.values()) {
    if (client.role === "seeker" && client.lat != null && client.lng != null) {
      positions.push({ id: client.participantId, displayName: client.displayName, lat: client.lat, lng: client.lng });
    }
  }

  // Add/update the REST-based seeker position
  const existingIdx = positions.findIndex((p) => p.id === participantId);
  if (existingIdx >= 0) {
    positions[existingIdx] = { id: participantId, displayName, lat, lng };
  } else {
    positions.push({ id: participantId, displayName, lat, lng });
  }

  // Broadcast to hiders
  this.sendToRole(sessionCode, "hider", { type: "seeker_positions", positions });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/jensvielhaben-nl001/hideandseek/backend
npx jest routes/__tests__/gps.test.ts
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit (in hideandseek repo)**

```bash
cd /Users/jensvielhaben-nl001/hideandseek
git add backend/src/routes/
git commit -m "feat: add POST /api/sessions/:code/gps endpoint for background GPS"
```

---

### Task 6: Push Token Endpoint & Send Utility

**Files:**
- Modify: `hideandseek/backend/src/db/schema.ts` (add push_token field)
- Create: `hideandseek/backend/src/lib/push.ts` (push notification utility)
- Modify: `hideandseek/backend/src/routes/sessions.ts` (add push-token route)
- Modify: `hideandseek/backend/src/ws/handler.ts` (trigger push on events)

**Note:** These changes are in the ORIGINAL `hideandseek` repo.

- [ ] **Step 1: Add `pushToken` field to participants schema**

In `backend/src/db/schema.ts`, add to participants table:

```typescript
pushToken: text("push_token"),
```

- [ ] **Step 2: Run migration**

```bash
cd /Users/jensvielhaben-nl001/hideandseek/backend
npx tsx src/db/migrate.ts
```

Check the existing migration approach in `backend/src/db/migrate.ts`. May need `ALTER TABLE participants ADD COLUMN push_token TEXT`.

- [ ] **Step 3: Create push notification utility**

```typescript
// backend/src/lib/push.ts

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export async function sendPushNotifications(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  const validTokens = tokens.filter(Boolean);
  if (validTokens.length === 0) return;

  const messages: PushMessage[] = validTokens.map((token) => ({
    to: token,
    title,
    body,
    ...(data ? { data } : {}),
  }));

  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messages),
    });
  } catch (err) {
    console.error("Failed to send push notifications:", err);
  }
}
```

- [ ] **Step 4: Add push-token registration endpoint**

In `backend/src/routes/sessions.ts`:

```typescript
app.post("/api/sessions/:code/participants/:participantId/push-token", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const participantId = c.req.param("participantId");
  const token = c.req.header("x-participant-token");
  if (!token) return c.json({ error: "Missing token" }, 401);

  const session = await db.query.sessions.findFirst({
    where: eq(schema.sessions.code, code),
  });
  if (!session) return c.json({ error: "Session not found" }, 404);

  const participant = await db.query.participants.findFirst({
    where: and(
      eq(schema.participants.id, participantId),
      eq(schema.participants.token, token),
      eq(schema.participants.sessionId, session.id)
    ),
  });
  if (!participant) return c.json({ error: "Invalid token" }, 403);

  const { pushToken } = await c.req.json();

  await db.update(schema.participants)
    .set({ pushToken })
    .where(eq(schema.participants.id, participantId));

  return c.json({ ok: true });
});
```

- [ ] **Step 5: Add push triggers in WS handler**

In `backend/src/ws/handler.ts`, after broadcasting `question_added`:

```typescript
// After question_added broadcast — notify hider(s) via push
const hiderParticipants = await db.query.participants.findMany({
  where: and(
    eq(schema.participants.sessionId, sessionId),
    eq(schema.participants.role, "hider")
  ),
});
const hiderTokens = hiderParticipants.map((p) => p.pushToken).filter(Boolean);
await sendPushNotifications(hiderTokens, "Neue Frage!", `${senderName} hat eine Frage gestellt.`);
```

Similarly after `question_answered`:

```typescript
// Notify question creator via push
const creator = await db.query.participants.findFirst({
  where: eq(schema.participants.id, question.createdByParticipantId),
});
if (creator?.pushToken) {
  await sendPushNotifications([creator.pushToken], "Frage beantwortet!", "Deine Frage wurde beantwortet.");
}
```

- [ ] **Step 6: Test manually — start backend, register a push token, trigger a question**

```bash
cd /Users/jensvielhaben-nl001/hideandseek/backend
npx tsx src/index.ts
```

Use curl to register a test push token and verify the endpoint works.

- [ ] **Step 7: Commit (in hideandseek repo)**

```bash
cd /Users/jensvielhaben-nl001/hideandseek
git add backend/
git commit -m "feat: add push notification support (token registration + send utility)"
```

---

## Phase 3: Core Mobile Features

### Task 7: WebSocket Hook with AppState Handling

**Files:**
- Create: `hideandseek-mobile/hooks/useSessionWebSocket.ts`
- Create: `hideandseek-mobile/hooks/__tests__/useSessionWebSocket.test.ts`

**Reference:** `hideandseek/src/hooks/useSessionWebSocket.ts`

- [ ] **Step 1: Write test for WebSocket hook**

Test core behavior:
- Connects with correct URL pattern (`ws://host/ws/:code?token=:token`)
- Sets wsStatus to "connected" on open
- Handles `sync` event (updates store)
- Handles `question_added` event (upserts question)
- Reconnects on unexpected close (not 1000, 4401, 4403, 4404)
- Reconnects on AppState change from background → active

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement WebSocket hook**

```typescript
// hooks/useSessionWebSocket.ts
import { useEffect, useRef, useCallback } from "react";
import { AppState, AppStateStatus } from "react-native";
import { BACKEND_WS_URL } from "../lib/config";
import { useSessionStore } from "../lib/session-store";
import type { ServerToClientEvent } from "../shared/events";

const PING_INTERVAL = 25_000;
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];
const NO_RECONNECT_CODES = [1000, 4401, 4403, 4404];

export function useSessionWebSocket(onSync?: () => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttempt = useRef(0);
  const appStateRef = useRef(AppState.currentState);

  const sessionCode = useSessionStore((s) => s.sessionCode);
  const token = useSessionStore((s) => s.getToken());

  const connect = useCallback(() => {
    if (!sessionCode || !token) return;

    const store = useSessionStore.getState();
    store.setWsStatus("connecting");

    const ws = new WebSocket(`${BACKEND_WS_URL}/ws/${sessionCode}?token=${token}`);

    ws.onopen = () => {
      store.setWsStatus("connected");
      reconnectAttempt.current = 0;

      // Start ping
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, PING_INTERVAL);
    };

    ws.onmessage = (event) => {
      const data: ServerToClientEvent = JSON.parse(event.data);
      const s = useSessionStore.getState();

      switch (data.type) {
        case "sync":
          s.setSessionQuestions(data.questions ?? []);
          s.setSeekerCount(data.seekerCount ?? 0);
          s.setHiderConnected(data.hiderConnected ?? false);
          s.setSessionMembers(data.participants ?? []);
          if (data.mapLocation && s.currentSession) {
            s.setCurrentSession({ ...s.currentSession, mapLocation: data.mapLocation });
          }
          onSync?.();
          break;
        case "map_location_updated":
          // Skip if we are the hider (avoid feedback loop, same as web app)
          if (s.getRole() !== "hider" && s.currentSession) {
            s.setCurrentSession({ ...s.currentSession, mapLocation: data.mapLocation });
          }
          break;
        case "question_added":
          s.upsertSessionQuestion(data.question);
          if (s.getRole() === "hider") {
            s.setNewQuestionReceived({ id: data.question.id, type: data.question.type });
          }
          break;
        case "question_answered":
          s.upsertSessionQuestion(data.question);
          break;
        case "question_expired":
          // Mark question expired locally
          const q = s.sessionQuestions.find((sq) => sq.id === data.questionId);
          if (q) s.upsertSessionQuestion({ ...q, status: "expired" });
          break;
        case "session_status_changed":
          if (s.currentSession) {
            s.setCurrentSession({ ...s.currentSession, status: data.status });
          }
          break;
        case "participant_joined":
          if (data.role === "seeker") s.setSeekerCount(s.seekerCount + 1);
          if (data.role === "hider") s.setHiderConnected(true);
          s.setSessionMembers([...s.sessionMembers, {
            id: data.participantId, role: data.role, displayName: data.displayName,
          }]);
          break;
        case "participant_left":
          s.setSessionMembers(s.sessionMembers.filter((m) => m.id !== data.participantId));
          break;
        case "seeker_positions":
          s.setSeekerPositions(data.positions);
          break;
      }
    };

    ws.onclose = (event) => {
      store.setWsStatus("disconnected");
      if (pingRef.current) clearInterval(pingRef.current);

      if (!NO_RECONNECT_CODES.includes(event.code)) {
        const delay = RECONNECT_DELAYS[Math.min(reconnectAttempt.current, RECONNECT_DELAYS.length - 1)];
        reconnectAttempt.current++;
        setTimeout(connect, delay);
      }
    };

    wsRef.current = ws;
  }, [sessionCode, token, onSync]);

  // AppState listener: reconnect when coming back from background
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === "active") {
        // App came to foreground — reconnect if disconnected
        const { wsStatus } = useSessionStore.getState();
        if (wsStatus === "disconnected" && sessionCode && token) {
          reconnectAttempt.current = 0;
          connect();
        }
      }
      appStateRef.current = nextState;
    });

    return () => subscription.remove();
  }, [connect, sessionCode, token]);

  // Main connection lifecycle
  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.close(1000);
        wsRef.current = null;
      }
      if (pingRef.current) clearInterval(pingRef.current);
    };
  }, [connect]);

  return wsRef;
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest hooks/__tests__/useSessionWebSocket.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
git add hooks/
git commit -m "feat: add WebSocket hook with AppState reconnection"
```

---

### Task 8: GPS Tracking Hook (Foreground + Background)

**Files:**
- Create: `hideandseek-mobile/hooks/useGpsTracking.ts`
- Create: `hideandseek-mobile/lib/background-location-task.ts`

**Reference:** `hideandseek/src/hooks/useGpsTracking.ts`

- [ ] **Step 1: Define background location task**

```typescript
// lib/background-location-task.ts
import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import { postGpsPosition } from "./session-api";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const BACKGROUND_LOCATION_TASK = "background-location-task";

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error("Background location error:", error);
    return;
  }

  const { locations } = data as { locations: Location.LocationObject[] };
  if (!locations || locations.length === 0) return;

  const location = locations[locations.length - 1]; // Most recent

  // Read session info from AsyncStorage (can't use Zustand in background task)
  try {
    const stored = await AsyncStorage.getItem("hideandseek-session");
    if (!stored) return;
    const { state } = JSON.parse(stored);
    const { sessionCode, sessionParticipant } = state;
    if (!sessionCode || !sessionParticipant?.token) return;
    if (sessionParticipant.role !== "seeker") return;

    await postGpsPosition(
      sessionCode,
      sessionParticipant.token,
      location.coords.latitude,
      location.coords.longitude
    );
  } catch (err) {
    console.error("Background GPS send failed:", err);
  }
});
```

- [ ] **Step 2: Implement foreground + background GPS hook**

```typescript
// hooks/useGpsTracking.ts
import { useEffect, useRef } from "react";
import * as Location from "expo-location";
import { useSessionStore } from "../lib/session-store";
import { BACKGROUND_LOCATION_TASK } from "../lib/background-location-task";

const SEND_INTERVAL_MS = 15_000;

export function useGpsTracking(wsRef?: React.RefObject<WebSocket | null>) {
  const role = useSessionStore((s) => s.getRole());
  const wsStatus = useSessionStore((s) => s.wsStatus);
  const sessionCode = useSessionStore((s) => s.sessionCode);
  const lastSendRef = useRef(0);
  const watchRef = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    if (role !== "seeker" || !sessionCode) return;

    let cancelled = false;

    async function startTracking() {
      // Request foreground permission
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      if (fgStatus !== "granted") {
        console.warn("Foreground location permission denied");
        return;
      }

      // Request background permission
      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
      if (bgStatus === "granted") {
        // Start background tracking
        const isRegistered = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
        if (!isRegistered) {
          await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
            accuracy: Location.Accuracy.High,
            timeInterval: SEND_INTERVAL_MS,
            distanceInterval: 5, // meters
            showsBackgroundLocationIndicator: true,
            foregroundService: {
              notificationTitle: "Hide & Seek",
              notificationBody: "GPS tracking is active",
              notificationColor: "#1F2F3F",
            },
          });
        }
      }

      if (cancelled) return;

      // Start foreground tracking (for immediate UI updates)
      watchRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 5_000,
          distanceInterval: 3,
        },
        (location) => {
          const store = useSessionStore.getState();
          store.setOwnGpsPosition({
            lat: location.coords.latitude,
            lng: location.coords.longitude,
          });

          // Send via WS if connected (foreground path)
          const now = Date.now();
          if (now - lastSendRef.current >= SEND_INTERVAL_MS) {
            if (wsRef?.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                type: "position_update",
                lat: location.coords.latitude,
                lng: location.coords.longitude,
              }));
            }
            lastSendRef.current = now;
          }
        }
      );
    }

    startTracking();

    return () => {
      cancelled = true;
      watchRef.current?.remove();
      // Stop background tracking
      Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).then((registered) => {
        if (registered) {
          Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
        }
      });
      useSessionStore.getState().setOwnGpsPosition(null);
    };
  }, [role, sessionCode]);

  return null;
}
```

- [ ] **Step 3: Import background task at app entry point**

In `hideandseek-mobile/app/_layout.tsx`, add at the top:

```typescript
import "../lib/background-location-task"; // Must be imported at app root
```

This ensures the task is defined before `expo-task-manager` tries to run it.

- [ ] **Step 4: Test on physical device** (background location doesn't work on simulators)

```bash
npx expo run:ios --device
# or
npx expo run:android --device
```

Verify:
- Foreground: GPS position updates in the store
- Background: After switching to another app, GPS positions still arrive at backend (check backend logs)

- [ ] **Step 5: Commit**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
git add hooks/ lib/ app/
git commit -m "feat: add foreground + background GPS tracking with expo-location"
```

---

### Task 9: Push Notification Setup

**Files:**
- Create: `hideandseek-mobile/hooks/usePushNotifications.ts`

- [ ] **Step 1: Implement push notification hook**

```typescript
// hooks/usePushNotifications.ts
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { registerPushToken } from "../lib/session-api";
import { useSessionStore } from "../lib/session-store";

// Handle foreground notifications — show as banner
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function usePushNotifications() {
  const sessionCode = useSessionStore((s) => s.sessionCode);
  const participant = useSessionStore((s) => s.sessionParticipant);
  const registeredRef = useRef(false);

  useEffect(() => {
    if (!sessionCode || !participant || registeredRef.current) return;

    async function register() {
      if (!Device.isDevice) {
        console.log("Push notifications require a physical device");
        return;
      }

      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== "granted") {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== "granted") {
        console.log("Push notification permission denied");
        return;
      }

      // Android needs a notification channel
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "default",
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
        });
      }

      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
      const pushTokenData = await Notifications.getExpoPushTokenAsync({ projectId });
      const pushToken = pushTokenData.data;

      // Register with backend
      await registerPushToken(sessionCode, participant.id, participant.token, pushToken);
      registeredRef.current = true;
    }

    register();
  }, [sessionCode, participant]);

  // Reset registration flag when leaving session
  useEffect(() => {
    if (!sessionCode) {
      registeredRef.current = false;
    }
  }, [sessionCode]);
}
```

- [ ] **Step 2: Use hook in root layout**

In `app/_layout.tsx`:

```typescript
import { usePushNotifications } from "../hooks/usePushNotifications";

export default function RootLayout() {
  usePushNotifications();
  // ... rest of layout
}
```

- [ ] **Step 3: Test on physical device**

Use Expo's push notification tool to send a test notification:
https://expo.dev/notifications

Verify:
- Foreground: notification shows as banner
- Background: notification shows in system tray

- [ ] **Step 4: Commit**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
git add hooks/ app/
git commit -m "feat: add push notification registration and foreground handling"
```

---

## Phase 4: UI Screens

### Task 10: MapLibre Map Screen

**Files:**
- Create: `hideandseek-mobile/app/(tabs)/map.tsx`
- Create: `hideandseek-mobile/components/GameMap.tsx`

- [ ] **Step 1: Create MapLibre base component**

```typescript
// components/GameMap.tsx
import React from "react";
import MapLibreGL from "@maplibre/maplibre-react-native";
import { StyleSheet, View } from "react-native";
import { useSessionStore } from "../lib/session-store";

// Must be called before rendering any MapLibre component
MapLibreGL.setAccessToken(null); // No token needed for free tile sources

const MAPTILER_KEY = process.env.EXPO_PUBLIC_MAPTILER_KEY ?? "YOUR_MAPTILER_KEY";
const STYLE_URL = `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`;

interface GameMapProps {
  children?: React.ReactNode;
}

export function GameMap({ children }: GameMapProps) {
  const seekerPositions = useSessionStore((s) => s.seekerPositions);
  const ownGpsPosition = useSessionStore((s) => s.ownGpsPosition);
  const role = useSessionStore((s) => s.getRole());

  const initialCenter = ownGpsPosition
    ? [ownGpsPosition.lng, ownGpsPosition.lat]
    : [10.0, 51.0]; // Default: center of Germany

  return (
    <View style={styles.container}>
      <MapLibreGL.MapView style={styles.map} styleURL={STYLE_URL}>
        <MapLibreGL.Camera
          defaultSettings={{
            centerCoordinate: initialCenter as [number, number],
            zoomLevel: 13,
          }}
        />

        {/* Own position (seeker) */}
        {ownGpsPosition && role === "seeker" && (
          <MapLibreGL.PointAnnotation
            id="own-position"
            coordinate={[ownGpsPosition.lng, ownGpsPosition.lat]}
          >
            <View style={styles.ownMarker} />
          </MapLibreGL.PointAnnotation>
        )}

        {/* Seeker positions (visible to hider) */}
        {role === "hider" &&
          seekerPositions.map((pos) => (
            <MapLibreGL.PointAnnotation
              key={pos.id}
              id={`seeker-${pos.id}`}
              coordinate={[pos.lng, pos.lat]}
            >
              <View style={styles.seekerMarker} />
            </MapLibreGL.PointAnnotation>
          ))}

        {children}
      </MapLibreGL.MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  ownMarker: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#3B82F6",
    borderWidth: 3,
    borderColor: "white",
  },
  seekerMarker: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#EF4444",
    borderWidth: 2,
    borderColor: "white",
  },
});
```

- [ ] **Step 2: Wire into map tab screen**

```typescript
// app/(tabs)/map.tsx
import React from "react";
import { GameMap } from "../../components/GameMap";
import { useSessionWebSocket } from "../../hooks/useSessionWebSocket";
import { useGpsTracking } from "../../hooks/useGpsTracking";

export default function MapScreen() {
  const wsRef = useSessionWebSocket();
  useGpsTracking(wsRef);

  return <GameMap />;
}
```

- [ ] **Step 3: Run on device/simulator and verify OSM tiles load**

```bash
npx expo run:ios
```

Expected: Map renders with OSM tiles from MapTiler.

- [ ] **Step 4: Commit**

```bash
git add components/ app/
git commit -m "feat: add MapLibre map screen with seeker/own position markers"
```

---

### Task 11: Session Create & Join Screens

**Files:**
- Create: `hideandseek-mobile/app/session/create.tsx`
- Create: `hideandseek-mobile/app/session/join.tsx`
- Create: `hideandseek-mobile/app/session/_layout.tsx`

- [ ] **Step 1: Create session layout**

```typescript
// app/session/_layout.tsx
import { Stack } from "expo-router";

export default function SessionLayout() {
  return (
    <Stack screenOptions={{ headerShown: true, headerTitle: "Session" }}>
      <Stack.Screen name="create" options={{ title: "Neue Session" }} />
      <Stack.Screen name="join" options={{ title: "Session beitreten" }} />
    </Stack>
  );
}
```

- [ ] **Step 2: Create session screen (simplified — name + create)**

```typescript
// app/session/create.tsx
import React, { useState } from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { router } from "expo-router";
import { createSession } from "../../lib/session-api";
import { useSessionStore } from "../../lib/session-store";

export default function CreateSessionScreen() {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const result = await createSession({ displayName: name.trim() });
      const store = useSessionStore.getState();
      store.setSessionCode(result.session.code);
      store.setSessionParticipant(result.participant);
      store.setCurrentSession(result.session);
      router.replace("/(tabs)/map");
    } catch (err: any) {
      Alert.alert("Fehler", err.message ?? "Session konnte nicht erstellt werden.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="flex-1 p-6 justify-center bg-white">
      <Text className="text-2xl font-bold mb-6 text-center">Neue Session erstellen</Text>
      <TextInput
        className="border border-gray-300 rounded-lg p-4 mb-4 text-lg"
        placeholder="Dein Name"
        value={name}
        onChangeText={setName}
        autoFocus
      />
      <Pressable
        className="bg-primary rounded-lg p-4 items-center"
        onPress={handleCreate}
        disabled={loading || !name.trim()}
      >
        <Text className="text-white text-lg font-semibold">
          {loading ? "Erstelle..." : "Session erstellen"}
        </Text>
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 3: Join session screen (code input + name + join)**

```typescript
// app/session/join.tsx
import React, { useState } from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { router } from "expo-router";
import { joinSession } from "../../lib/session-api";
import { useSessionStore } from "../../lib/session-store";

export default function JoinSessionScreen() {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleJoin = async () => {
    if (!code.trim() || !name.trim()) return;
    setLoading(true);
    try {
      const result = await joinSession(code.trim().toUpperCase(), {
        displayName: name.trim(),
      });
      const store = useSessionStore.getState();
      store.setSessionCode(result.session.code);
      store.setSessionParticipant(result.participant);
      store.setCurrentSession(result.session);
      router.replace("/(tabs)/map");
    } catch (err: any) {
      Alert.alert("Fehler", err.message ?? "Beitreten fehlgeschlagen.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="flex-1 p-6 justify-center bg-white">
      <Text className="text-2xl font-bold mb-6 text-center">Session beitreten</Text>
      <TextInput
        className="border border-gray-300 rounded-lg p-4 mb-4 text-lg"
        placeholder="Session-Code (z.B. ABC123)"
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
        autoCapitalize="characters"
        maxLength={6}
        autoFocus
      />
      <TextInput
        className="border border-gray-300 rounded-lg p-4 mb-4 text-lg"
        placeholder="Dein Name"
        value={name}
        onChangeText={setName}
      />
      <Pressable
        className="bg-primary rounded-lg p-4 items-center"
        onPress={handleJoin}
        disabled={loading || !code.trim() || !name.trim()}
      >
        <Text className="text-white text-lg font-semibold">
          {loading ? "Trete bei..." : "Beitreten"}
        </Text>
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 4: Run and test create/join flow against running backend**

Start the backend:
```bash
cd /Users/jensvielhaben-nl001/hideandseek/backend && npx tsx src/index.ts
```

Run the app, create a session, note the code, join from another device/simulator.

- [ ] **Step 5: Commit**

```bash
cd /Users/jensvielhaben-nl001/hideandseek-mobile
git add app/session/
git commit -m "feat: add session create and join screens"
```

---

### Task 12: Question Panel (Bottom Sheet)

**Files:**
- Create: `hideandseek-mobile/components/QuestionPanel.tsx`
- Create: `hideandseek-mobile/components/QuestionCard.tsx`

- [ ] **Step 1: Create question card component**

A card displaying a single question with status, type, and answer. Uses the same data structure as the web app's `SessionQuestionPanel.tsx`.

```typescript
// components/QuestionCard.tsx
import React from "react";
import { View, Text } from "react-native";
import type { SessionQuestion } from "../shared/types";

const STATUS_COLORS = {
  pending: "bg-yellow-100",
  answered: "bg-green-100",
  expired: "bg-gray-100",
};

interface QuestionCardProps {
  question: SessionQuestion;
}

export function QuestionCard({ question }: QuestionCardProps) {
  return (
    <View className={`p-4 rounded-lg mb-2 ${STATUS_COLORS[question.status]}`}>
      <View className="flex-row justify-between items-center mb-1">
        <Text className="font-semibold capitalize">{question.type}</Text>
        <Text className="text-sm text-gray-500">{question.status}</Text>
      </View>
      {question.createdByDisplayName && (
        <Text className="text-sm text-gray-600">von {question.createdByDisplayName}</Text>
      )}
    </View>
  );
}
```

- [ ] **Step 2: Create question panel with bottom sheet**

```typescript
// components/QuestionPanel.tsx
import React, { useMemo, useRef } from "react";
import { View, Text, FlatList } from "react-native";
import BottomSheet from "@gorhom/bottom-sheet";
import { useSessionStore } from "../lib/session-store";
import { QuestionCard } from "./QuestionCard";

export function QuestionPanel() {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ["12%", "50%", "90%"], []);
  const questions = useSessionStore((s) => s.sessionQuestions);

  return (
    <BottomSheet ref={bottomSheetRef} index={0} snapPoints={snapPoints}>
      <View className="px-4 pt-2">
        <Text className="text-lg font-bold mb-2">
          Fragen ({questions.length})
        </Text>
        <FlatList
          data={questions}
          keyExtractor={(q) => q.id}
          renderItem={({ item }) => <QuestionCard question={item} />}
          ListEmptyComponent={
            <Text className="text-gray-400 text-center py-8">Noch keine Fragen</Text>
          }
        />
      </View>
    </BottomSheet>
  );
}
```

- [ ] **Step 3: Integrate into map screen**

Update `app/(tabs)/map.tsx`:

```typescript
import { QuestionPanel } from "../../components/QuestionPanel";

export default function MapScreen() {
  const wsRef = useSessionWebSocket();
  useGpsTracking(wsRef);

  return (
    <View style={{ flex: 1 }}>
      <GameMap />
      <QuestionPanel />
    </View>
  );
}
```

**Note:** `GestureHandlerRootView` must wrap the entire app in `app/_layout.tsx`, not per-screen:

```typescript
// In app/_layout.tsx
import { GestureHandlerRootView } from "react-native-gesture-handler";

export default function RootLayout() {
  usePushNotifications();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* ... Stack/Tabs ... */}
    </GestureHandlerRootView>
  );
}
```

- [ ] **Step 4: Run and verify bottom sheet renders over map**

- [ ] **Step 5: Commit**

```bash
git add components/ app/
git commit -m "feat: add question panel with bottom sheet over map"
```

---

### Task 13: Home Screen & Navigation

**Files:**
- Modify: `hideandseek-mobile/app/(tabs)/_layout.tsx`
- Create: `hideandseek-mobile/app/index.tsx`

- [ ] **Step 1: Create home/landing screen**

```typescript
// app/index.tsx
import React from "react";
import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";
import { useSessionStore } from "../lib/session-store";

export default function HomeScreen() {
  const isInSession = useSessionStore((s) => s.isInSession());

  // Auto-navigate to map if already in session
  React.useEffect(() => {
    if (isInSession) {
      router.replace("/(tabs)/map");
    }
  }, [isInSession]);

  return (
    <View className="flex-1 justify-center items-center bg-primary p-6">
      <Text className="text-4xl font-bold text-white mb-2">Hide & Seek</Text>
      <Text className="text-lg text-gray-300 mb-12">JetLag Edition</Text>

      <Pressable
        className="bg-white rounded-lg p-4 w-full mb-4 items-center"
        onPress={() => router.push("/session/create")}
      >
        <Text className="text-primary text-lg font-semibold">Neue Session</Text>
      </Pressable>

      <Pressable
        className="border-2 border-white rounded-lg p-4 w-full items-center"
        onPress={() => router.push("/session/join")}
      >
        <Text className="text-white text-lg font-semibold">Session beitreten</Text>
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 2: Configure tab layout**

```typescript
// app/(tabs)/_layout.tsx
import { Tabs } from "expo-router";
import { MapPin, Settings } from "lucide-react-native";

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen
        name="map"
        options={{
          title: "Karte",
          tabBarIcon: ({ color, size }) => <MapPin color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Einstellungen",
          tabBarIcon: ({ color, size }) => <Settings color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
```

- [ ] **Step 3: Run and verify navigation flow: Home → Create/Join → Map**

- [ ] **Step 4: Commit**

```bash
git add app/
git commit -m "feat: add home screen with session navigation"
```

---

### Task 14: Settings Screen & Leave Session

**Files:**
- Create: `hideandseek-mobile/app/(tabs)/settings.tsx`

- [ ] **Step 1: Create settings screen**

```typescript
// app/(tabs)/settings.tsx
import React from "react";
import { View, Text, Pressable, Alert } from "react-native";
import { router } from "expo-router";
import { useSessionStore } from "../../lib/session-store";

export default function SettingsScreen() {
  const sessionCode = useSessionStore((s) => s.sessionCode);
  const participant = useSessionStore((s) => s.sessionParticipant);
  const role = useSessionStore((s) => s.getRole());
  const seekerCount = useSessionStore((s) => s.seekerCount);
  const hiderConnected = useSessionStore((s) => s.hiderConnected);

  const handleLeave = () => {
    Alert.alert("Session verlassen", "Willst du die Session wirklich verlassen?", [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Verlassen",
        style: "destructive",
        onPress: () => {
          useSessionStore.getState().leaveSession();
          router.replace("/");
        },
      },
    ]);
  };

  return (
    <View className="flex-1 bg-white p-6">
      <Text className="text-2xl font-bold mb-6">Session Info</Text>

      {sessionCode ? (
        <>
          <View className="bg-gray-50 rounded-lg p-4 mb-4">
            <Text className="text-sm text-gray-500">Session-Code</Text>
            <Text className="text-3xl font-mono font-bold">{sessionCode}</Text>
          </View>

          <View className="flex-row mb-4">
            <View className="flex-1 bg-gray-50 rounded-lg p-4 mr-2">
              <Text className="text-sm text-gray-500">Deine Rolle</Text>
              <Text className="text-lg font-semibold capitalize">{role}</Text>
            </View>
            <View className="flex-1 bg-gray-50 rounded-lg p-4 ml-2">
              <Text className="text-sm text-gray-500">Name</Text>
              <Text className="text-lg font-semibold">{participant?.displayName}</Text>
            </View>
          </View>

          <View className="flex-row mb-8">
            <View className="flex-1 bg-gray-50 rounded-lg p-4 mr-2">
              <Text className="text-sm text-gray-500">Seeker</Text>
              <Text className="text-lg font-semibold">{seekerCount}</Text>
            </View>
            <View className="flex-1 bg-gray-50 rounded-lg p-4 ml-2">
              <Text className="text-sm text-gray-500">Hider</Text>
              <Text className="text-lg font-semibold">
                {hiderConnected ? "Online" : "Offline"}
              </Text>
            </View>
          </View>

          <Pressable className="bg-red-500 rounded-lg p-4 items-center" onPress={handleLeave}>
            <Text className="text-white text-lg font-semibold">Session verlassen</Text>
          </Pressable>
        </>
      ) : (
        <Text className="text-gray-400 text-center">Keine aktive Session</Text>
      )}
    </View>
  );
}
```

- [ ] **Step 2: Run and verify session info displays, leave works**

- [ ] **Step 3: Commit**

```bash
git add app/
git commit -m "feat: add settings screen with session info and leave"
```

---

### Task 15: Role Selection & Game Area Configuration

**Files:**
- Modify: `hideandseek-mobile/app/session/create.tsx` (add role, area, size steps)
- Modify: `hideandseek-mobile/app/session/join.tsx` (add role selection)
- Create: `hideandseek-mobile/components/AreaPicker.tsx` (map-based area selection)

**Reference:** Web app's `CreateSessionOverlay.tsx` has a 5-step wizard: entry → gebiet → groesse → code → rolle.

- [ ] **Step 1: Add role selection to join screen**

Add a role picker (hider/seeker toggle) before the join button in `app/session/join.tsx`:

```typescript
const [role, setRole] = useState<"seeker" | "hider">("seeker");

// In JSX, add before the join button:
<View className="flex-row mb-4">
  <Pressable
    className={`flex-1 p-4 rounded-l-lg items-center ${role === "seeker" ? "bg-primary" : "bg-gray-200"}`}
    onPress={() => setRole("seeker")}
  >
    <Text className={role === "seeker" ? "text-white font-semibold" : "text-gray-600"}>Seeker</Text>
  </Pressable>
  <Pressable
    className={`flex-1 p-4 rounded-r-lg items-center ${role === "hider" ? "bg-primary" : "bg-gray-200"}`}
    onPress={() => setRole("hider")}
  >
    <Text className={role === "hider" ? "text-white font-semibold" : "text-gray-600"}>Hider</Text>
  </Pressable>
</View>

// Pass role to joinSession:
const result = await joinSession(code.trim().toUpperCase(), { displayName: name.trim(), role });
```

- [ ] **Step 2: Extend create screen into a multi-step wizard**

Convert the single-step create screen into a stepped flow:
1. Name input
2. Game size selection (S/M/L)
3. Map area selection (AreaPicker component using MapLibre to draw/select area)
4. Confirmation with session code

This is the most complex UI component. The `AreaPicker` should show a MapLibre map where the hider can center on a location and confirm the play area. The area is sent as `mapLocation` in the `createSession` call.

- [ ] **Step 3: Create AreaPicker component**

```typescript
// components/AreaPicker.tsx
import React, { useState } from "react";
import { View, Text, Pressable } from "react-native";
import MapLibreGL from "@maplibre/maplibre-react-native";

interface AreaPickerProps {
  onConfirm: (location: { lat: number; lng: number; name: string }) => void;
}

export function AreaPicker({ onConfirm }: AreaPickerProps) {
  const [center, setCenter] = useState<[number, number]>([10.0, 51.0]);

  return (
    <View className="flex-1">
      <MapLibreGL.MapView
        style={{ flex: 1 }}
        styleURL={`https://api.maptiler.com/maps/streets-v2/style.json?key=${process.env.EXPO_PUBLIC_MAPTILER_KEY}`}
        onRegionDidChange={(e) => {
          const { geometry } = e;
          if (geometry?.coordinates) {
            setCenter(geometry.coordinates as [number, number]);
          }
        }}
      >
        <MapLibreGL.Camera defaultSettings={{ centerCoordinate: center, zoomLevel: 13 }} />
      </MapLibreGL.MapView>
      {/* Crosshair overlay */}
      <View className="absolute inset-0 items-center justify-center pointer-events-none">
        <View className="w-8 h-8 border-2 border-red-500 rounded-full" />
      </View>
      <Pressable
        className="absolute bottom-8 left-6 right-6 bg-primary rounded-lg p-4 items-center"
        onPress={() => onConfirm({ lat: center[1], lng: center[0], name: "Spielgebiet" })}
      >
        <Text className="text-white text-lg font-semibold">Gebiet bestätigen</Text>
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 4: Test the full create flow: name → size → area → confirm**

- [ ] **Step 5: Commit**

```bash
git add app/session/ components/
git commit -m "feat: add role selection, game size, and area picker to session creation"
```

---

### Task 16: Question Answering UI & Photo Questions

**Files:**
- Create: `hideandseek-mobile/components/QuestionAnswerSheet.tsx`
- Create: `hideandseek-mobile/components/PhotoCapture.tsx`
- Modify: `hideandseek-mobile/components/QuestionCard.tsx` (add answer action)

- [ ] **Step 1: Create answer sheet for hider**

When a hider taps a pending question, show an answer interface. For most question types, the hider's answer is computed from GPS (existing logic from `hiderifyQuestion` in shared). For photo questions, the hider needs to take/select a photo.

```typescript
// components/QuestionAnswerSheet.tsx
import React, { useState } from "react";
import { View, Text, Pressable, Alert } from "react-native";
import * as Location from "expo-location";
import { answerQuestion } from "../lib/session-api";
import { useSessionStore } from "../lib/session-store";
import type { SessionQuestion } from "../shared/types";

interface QuestionAnswerSheetProps {
  question: SessionQuestion;
  onAnswered: () => void;
}

export function QuestionAnswerSheet({ question, onAnswered }: QuestionAnswerSheetProps) {
  const [loading, setLoading] = useState(false);
  const token = useSessionStore((s) => s.getToken());

  const handleAnswer = async () => {
    if (!token) return;
    setLoading(true);
    try {
      // Get current position for GPS-based answer computation
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const hiderPos = { lat: location.coords.latitude, lng: location.coords.longitude };

      // Compute answer based on question type + hider position
      // This mirrors the web app's hiderifyQuestion logic
      const answerData = computeAnswer(question, hiderPos);

      await answerQuestion(question.id, token, { answerData });
      onAnswered();
    } catch (err: any) {
      Alert.alert("Fehler", err.message ?? "Antwort fehlgeschlagen.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="p-4">
      <Text className="text-lg font-bold mb-2 capitalize">{question.type}</Text>
      <Text className="text-gray-600 mb-4">
        {question.status === "pending" ? "Warte auf deine Antwort..." : question.status}
      </Text>
      {question.status === "pending" && (
        <Pressable
          className="bg-primary rounded-lg p-4 items-center"
          onPress={handleAnswer}
          disabled={loading}
        >
          <Text className="text-white font-semibold">
            {loading ? "Berechne..." : "Antworten"}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// computeAnswer must be ported from the web app's hiderify logic.
// The source files to port are:
//   - hideandseek/src/maps/index.ts → hiderifyQuestion() dispatcher
//   - hideandseek/src/maps/questions/radius.ts → hiderifyRadius()
//   - hideandseek/src/maps/questions/thermometer.ts → hiderifyThermometer()
//   - hideandseek/src/maps/questions/tentacles.ts → hiderifyTentacles()
//   - hideandseek/src/maps/questions/matching.ts → hiderifyMatching()
//   - hideandseek/src/maps/questions/measuring.ts → hiderifyMeasuring()
//   - hideandseek/src/maps/geo-utils.ts → helper functions
//   - hideandseek/src/maps/schema.ts → Question type definitions
//
// These functions use @turf/turf for GPS distance calculations and
// may call the Overpass API for some question types (thermometer, tentacles).
// Photo questions have no geo computation — the answer is the uploaded image.
//
// Strategy: Copy the entire src/maps/ directory into the mobile repo as
// lib/maps/, adapting imports. The logic is pure TypeScript with no DOM
// dependencies, so it runs in React Native without changes.
// The hiderify functions take a question.data object and the hider's
// GPS position (from question.data.drag) and compute the answer.
async function computeAnswer(question: SessionQuestion, hiderPos: { lat: number; lng: number }) {
  // Set the hider's position as the drag point, then hiderify
  const questionWithPos = {
    id: question.type,
    data: { ...question.data as any, drag: { lat: hiderPos.lat, lng: hiderPos.lng } },
  };
  const { hiderifyQuestion } = await import("../lib/maps");
  const result = await hiderifyQuestion(questionWithPos);
  return result.data;
}
```

- [ ] **Step 2: Add expo-image-picker for photo questions**

```typescript
// components/PhotoCapture.tsx
import React from "react";
import { View, Pressable, Text, Image } from "react-native";
import * as ImagePicker from "expo-image-picker";

interface PhotoCaptureProps {
  onPhotoCaptured: (uri: string) => void;
  photoUri?: string;
}

export function PhotoCapture({ onPhotoCaptured, photoUri }: PhotoCaptureProps) {
  const takePhoto = async () => {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      onPhotoCaptured(result.assets[0].uri);
    }
  };

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      onPhotoCaptured(result.assets[0].uri);
    }
  };

  return (
    <View>
      {photoUri && <Image source={{ uri: photoUri }} className="w-full h-48 rounded-lg mb-4" />}
      <View className="flex-row gap-2">
        <Pressable className="flex-1 bg-primary rounded-lg p-3 items-center" onPress={takePhoto}>
          <Text className="text-white font-semibold">Foto aufnehmen</Text>
        </Pressable>
        <Pressable className="flex-1 bg-gray-200 rounded-lg p-3 items-center" onPress={pickPhoto}>
          <Text className="text-gray-700 font-semibold">Aus Galerie</Text>
        </Pressable>
      </View>
    </View>
  );
}
```

- [ ] **Step 3: Copy maps/hiderify logic from web app and add dependencies**

```bash
# Copy the maps directory (pure TS, no DOM dependencies)
cp -r /Users/jensvielhaben-nl001/hideandseek/src/maps /Users/jensvielhaben-nl001/hideandseek-mobile/lib/maps

# Install turf for GPS computations
npm install @turf/turf

# Fix imports in copied files: remove .js extensions, update paths
# The maps/ code uses relative imports that should work as-is in RN
```

Verify the copied code compiles:
```bash
npx tsc --noEmit
```

Fix any import issues (e.g., `.js` extensions, path adjustments).

- [ ] **Step 4: Wire answer action into QuestionCard**

Make pending questions tappable for hiders. On tap, open `QuestionAnswerSheet` in a modal or bottom sheet.

- [ ] **Step 5: Test the answer flow: hider taps pending question → computes answer → sends**

- [ ] **Step 6: Commit**

```bash
git add components/ package.json
git commit -m "feat: add question answering UI with photo support"
```

---

## Phase 5: Build & Deploy

### Task 17: EAS Build Configuration

**Files:**
- Create: `hideandseek-mobile/eas.json`

- [ ] **Step 1: Install EAS CLI**

```bash
npm install -g eas-cli
eas login
```

- [ ] **Step 2: Create EAS config**

```json
{
  "cli": { "version": ">= 3.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal"
    },
    "production": {}
  },
  "submit": {
    "production": {
      "ios": {
        "appleId": "YOUR_APPLE_ID",
        "ascAppId": "YOUR_ASC_APP_ID"
      }
    }
  }
}
```

- [ ] **Step 3: Run a development build**

```bash
eas build --profile development --platform ios
# or
eas build --profile development --platform android
```

- [ ] **Step 4: Run production build**

```bash
eas build --profile production --platform all
```

- [ ] **Step 5: Submit to stores**

```bash
eas submit --platform ios
eas submit --platform android
```

- [ ] **Step 6: Commit**

```bash
git add eas.json
git commit -m "feat: add EAS build configuration for iOS and Android"
```

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 | 1-4 | Project scaffold, shared types, store, API client |
| 2 | 5-6 | Backend GPS + push endpoints (in original repo) |
| 3 | 7-9 | WebSocket hook, GPS tracking, push notifications |
| 4 | 10-16 | Map, session screens, question panel, settings, role selection, answering UI |
| 5 | 17 | EAS build & store submission |

**Dependencies:**
- Task 1 must be done first (project scaffold)
- Tasks 2-4 depend on Task 1; Task 4 depends on Task 2 (shared types)
- Tasks 5-6 (backend) are independent and can be done in parallel with Tasks 2-4
- Tasks 7-9 require Task 3 (store) and Task 4 (API client)
- Tasks 10-14 require Tasks 7-9
- Task 15 requires Task 10 (map) and Task 11 (session screens)
- Task 16 requires Task 12 (question panel)
- Task 17 requires all prior tasks
