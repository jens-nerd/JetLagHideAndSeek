# Automated Testing Concept — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build out the five-layer test pyramid described in `docs/superpowers/specs/2026-04-19-automated-testing-concept-design.md` following the ten-step rollout order from §6 of that spec — starting with the WebSocket harness that closes the reviewer-flagged hiding-zone gaps, then CI, REST refactor, coverage expansion, and finally Playwright e2e on a VPS nightly runner.

**Architecture:** Three phases that build on each other.
- **Phase 1 (spec steps 1–3) — Foundation.** Reusable migration runner, `withTestApp` + `makeWsClient` harness, three WS tests closing the hiding-zone gap, GitHub Actions PR gate, REST test split. Detailed TDD.
- **Phase 2 (spec steps 4–7) — Expansion.** WS coverage, `msw` for upstream APIs, happy-dom + RTL setup, high-value component tests, L1 gap-fill. Task-level detail.
- **Phase 3 (spec steps 8–10) — End-to-end.** Playwright bootstrap, VPS nightly runner, more e2e flows. Task-level detail.

**Tech Stack:** TypeScript, vitest, Hono, `ws` library, better-sqlite3, Drizzle ORM, `msw`, `@testing-library/react`, happy-dom, Playwright, GitHub Actions, systemd.

**Ground rules for every task**
- Use `pnpm` (workspace monorepo). Backend tests: `pnpm --filter @hideandseek/backend test`. Frontend tests: `pnpm test`. All: `pnpm test:all`.
- Commit after every passing task. Subject style follows existing repo (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
- TDD for new code. For *retrofit* tests against existing code (Phase 1 tasks 5–7) the cycle is: write test → run and confirm it passes → *optional but recommended:* temporarily break the production code, confirm the test now fails, restore.
- Never skip a step. If a step says "run the command", run it.

---

## File Structure

Phase 1 creates / modifies these files:

| Action | Path | Purpose |
|---|---|---|
| Create | `backend/src/db/migrator.ts` | Reusable migration runner (pure function over a `Database` instance) |
| Modify | `backend/src/db/migrate.ts` | Thin wrapper that opens the real DB and delegates to `migrator.ts` |
| Create | `backend/src/ws/attach.ts` | Extract the upgrade handler + `wss.on("connection")` wiring into a reusable function |
| Modify | `backend/src/index.ts` | Use `attachWsServer` instead of inlined wiring |
| Modify | `backend/src/test/helpers.ts` | Drop hand-written `MIGRATE_SQL`; add `withTestApp`, `makeWsClient`, `seedSession`; call `runMigrations(db)` |
| Create | `backend/src/test/ws/hiding-zone.test.ts` | First WS integration tests — closes reviewer gaps |
| Create | `.github/workflows/test.yml` | PR gate running `pnpm test:all` |
| Create | `backend/src/test/rest/sessions.test.ts` | REST split — sessions endpoints |
| Create | `backend/src/test/rest/questions.test.ts` | REST split — questions endpoints |
| Create | `backend/src/test/rest/overpass.test.ts` | REST split — overpass/poi proxy |
| Create | `backend/src/test/rest/uploads.test.ts` | REST split — upload endpoint |
| Delete | `backend/src/test/api.test.ts` | Contents moved into `rest/*` files |

Phases 2 and 3 add:

| Action | Path | Purpose |
|---|---|---|
| Create | `backend/src/test/ws/questions.test.ts` | WS question flow |
| Create | `backend/src/test/ws/positions.test.ts` | GPS + participant lifecycle |
| Create | `backend/src/test/ws/timers.test.ts` | Deadline + push-token |
| Create | `backend/src/test/fixtures/overpass/*.json` | Canned Overpass responses |
| Create | `backend/src/test/fixtures/here/*.json` | Canned HERE responses |
| Create | `backend/src/test/msw.ts` | `msw` handlers + `setupServer()` instance |
| Create | `tests/setup.ts` | vitest setup file for happy-dom + nanostores reset |
| Modify | `vitest.config.ts` | Add `environment: "happy-dom"`, `setupFiles` |
| Create | `tests/components/MyZonePanel.test.tsx` | Component test (first RTL example) |
| Create | `tests/components/BottomSheet.test.tsx` | Component test |
| Create | `tests/components/SessionQuestionPanel.test.tsx` | Component test |
| Create | `tests/components/CreateSessionOverlay.test.tsx` | Component test |
| Create | `tests/card-costs.test.ts` | L1 unit test |
| Create | `tests/photo-challenges.test.ts` | L1 unit test |
| Create | `tests/timer-context.test.ts` | L1 unit test |
| Create | `tests/hiding-zone-loader.test.ts` | L1 unit test |
| Create | `e2e/playwright.config.ts` | Playwright config |
| Create | `e2e/flows/golden-path.spec.ts` | First e2e spec |
| Create | `e2e/intercepts/overpass.ts` | Shared route handler |
| Create | `e2e/flows/photo-question.spec.ts` | Photo question flow |
| Create | `e2e/flows/thermometer-gps.spec.ts` | Thermometer GPS flow |
| Create | `e2e/flows/endgame-variants.spec.ts` | Zone-change-while-revealed, seeker-caught, late-join-after-reveal |
| Create | `ops/nightly/hideandseek-nightly.service` | systemd unit |
| Create | `ops/nightly/hideandseek-nightly.timer` | systemd timer |
| Create | `ops/nightly/run.sh` | Nightly orchestrator |

---

## Phase 1 — Foundation

### Task 1: Reusable migration runner

**Files:**
- Create: `backend/src/db/migrator.ts`
- Modify: `backend/src/db/migrate.ts`

- [ ] **Step 1: Write a failing test for the migrator**

Create `backend/src/db/migrator.test.ts`:

```ts
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { runMigrations, CURRENT_SCHEMA_VERSION } from "./migrator.js";

describe("runMigrations", () => {
    it("creates all tables on an empty database", () => {
        const sqlite = new Database(":memory:");
        runMigrations(sqlite);

        const tables = sqlite
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .all()
            .map((r: any) => r.name);

        expect(tables).toEqual(
            expect.arrayContaining([
                "sessions",
                "participants",
                "questions",
                "ws_events",
            ]),
        );
    });

    it("is idempotent", () => {
        const sqlite = new Database(":memory:");
        runMigrations(sqlite);
        runMigrations(sqlite); // must not throw
        expect(sqlite.pragma("user_version", { simple: true })).toBe(
            CURRENT_SCHEMA_VERSION,
        );
    });

    it("adds the hiding_zone column on a v4 database", () => {
        const sqlite = new Database(":memory:");
        sqlite.exec(`
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL DEFAULT 'waiting',
                map_location TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                expires_at TEXT NOT NULL
            );
            PRAGMA user_version = 4;
        `);
        runMigrations(sqlite);
        const cols = sqlite
            .prepare("PRAGMA table_info(sessions)")
            .all()
            .map((r: any) => r.name);
        expect(cols).toContain("hiding_zone");
    });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
pnpm --filter @hideandseek/backend test migrator.test
```

Expected: FAIL with `Cannot find module './migrator.js'`.

- [ ] **Step 3: Implement `migrator.ts`**

Move the full SQL body from `backend/src/db/migrate.ts` into `backend/src/db/migrator.ts`, exposing a pure function:

```ts
import type Database from "better-sqlite3";

export const CURRENT_SCHEMA_VERSION = 5;

// Copy the contents of the `sqlite.exec(\`…\`)` block that defines the
// initial schema from the CURRENT `backend/src/db/migrate.ts` verbatim
// (the multi-line string starting with `CREATE TABLE IF NOT EXISTS sessions`
// and ending after the last `CREATE INDEX`). That string becomes the value
// of INITIAL_SCHEMA below — nothing else changes.
const INITIAL_SCHEMA = `…paste the CREATE TABLE + CREATE INDEX block here…`;

interface Migration {
    version: number;
    up: (db: Database.Database) => void;
}

const MIGRATIONS: Migration[] = [
    {
        version: 5,
        up: (db) => {
            const cols = db
                .prepare("PRAGMA table_info(sessions)")
                .all()
                .map((r: any) => r.name);
            if (!cols.includes("hiding_zone")) {
                db.exec("ALTER TABLE sessions ADD COLUMN hiding_zone TEXT");
            }
        },
    },
    /* add future migrations here, in ascending version order */
];

export function runMigrations(db: Database.Database): void {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(INITIAL_SCHEMA);

    const current = db.pragma("user_version", { simple: true }) as number;
    for (const m of MIGRATIONS) {
        if (m.version > current) {
            m.up(db);
            db.pragma(`user_version = ${m.version}`);
        }
    }
}
```

- [ ] **Step 4: Run the migrator tests, confirm they pass**

```bash
pnpm --filter @hideandseek/backend test migrator.test
```

Expected: 3 passed.

- [ ] **Step 5: Rewrite `migrate.ts` as a thin wrapper**

```ts
/**
 * CLI migration entry point. Opens the real DB and delegates to runMigrations.
 * Run on first deploy and after every schema change: pnpm db:migrate
 */
import Database from "better-sqlite3";

import { runMigrations } from "./migrator.js";

const DB_PATH = process.env.DB_PATH ?? "./hideandseek.db";
const sqlite = new Database(DB_PATH);

runMigrations(sqlite);

console.log(`Migrated ${DB_PATH} to current schema.`);
```

- [ ] **Step 6: Run the full backend suite to confirm no regressions**

```bash
pnpm --filter @hideandseek/backend test
```

Expected: all existing + new tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/db/migrator.ts backend/src/db/migrator.test.ts backend/src/db/migrate.ts
git commit -m "refactor(backend): extract migration runner into reusable module"
```

---

### Task 2: Replace hand-written MIGRATE_SQL in test helpers

**Files:**
- Modify: `backend/src/test/helpers.ts`

- [ ] **Step 1: Read the current `createTestDb` and `MIGRATE_SQL` in `backend/src/test/helpers.ts`**

You need to understand what it currently exports so nothing else breaks.

- [ ] **Step 2: Replace `MIGRATE_SQL` and `createTestDb` with a migrator-based version**

```ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { runMigrations } from "../db/migrator.js";
import * as schema from "../db/schema.js";

/** Create a fresh in-memory SQLite database with all tables. */
export function createTestDb() {
    const sqlite = new Database(":memory:");
    runMigrations(sqlite);
    return drizzle(sqlite, { schema });
}
```

Delete the `MIGRATE_SQL` constant entirely. Keep `createTestApp`, `req`, and every other export as-is.

- [ ] **Step 3: Run the backend suite**

```bash
pnpm --filter @hideandseek/backend test
```

Expected: all existing tests pass against the real migration runner.

- [ ] **Step 4: Commit**

```bash
git add backend/src/test/helpers.ts
git commit -m "test(backend): use real migration runner in test helpers"
```

---

### Task 3: Extract WS server wiring

**Files:**
- Create: `backend/src/ws/attach.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Create `attach.ts` with the upgrade + connection wiring**

```ts
import { parse } from "node:url";
import type { Server } from "node:http";

import { WebSocket, WebSocketServer } from "ws";

import { handleWsClose, handleWsMessage, handleWsOpen } from "./handler.js";
import type { ConnectedClient } from "./manager.js";

/**
 * Attach a WebSocketServer to an existing HTTP server, handling the
 * `/ws/:code?token=…` upgrade pattern. Returns the wss so callers can close it.
 * Extracted from index.ts so tests can reuse the same wiring.
 */
export function attachWsServer(server: Server): WebSocketServer {
    const wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (request, socket, head) => {
        const parsed = parse(request.url ?? "", true);
        const pathname = parsed.pathname ?? "";
        if (!pathname.startsWith("/ws/")) {
            socket.destroy();
            return;
        }
        const sessionCode = pathname.slice(4);
        const token = (parsed.query.token as string) ?? null;
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit("connection", ws, sessionCode, token);
        });
    });

    wss.on(
        "connection",
        async (ws: WebSocket, sessionCode: string, token: string | null) => {
            const wsCtx = {
                send: (data: string) => {
                    if (ws.readyState === WebSocket.OPEN) ws.send(data);
                },
                close: (code?: number, reason?: string) => ws.close(code, reason),
            };
            const client: ConnectedClient | null = await handleWsOpen(
                wsCtx as any,
                sessionCode,
                token,
            );
            ws.on("message", async (data: Buffer) => {
                if (!client) return;
                await handleWsMessage(client, data.toString());
            });
            ws.on("close", () => {
                if (client) handleWsClose(client);
            });
            ws.on("error", (err) => {
                console.error("WebSocket client error:", err);
            });
        },
    );

    return wss;
}
```

- [ ] **Step 2: Replace the inlined block in `index.ts`**

In `backend/src/index.ts`, delete lines 74 through (end of the `wss.on("connection", …)` block) and replace with:

```ts
import { attachWsServer } from "./ws/attach.js";

// … existing server start …

attachWsServer(server);
```

Remove the `import { parse } from "node:url";`, `import { WebSocket, WebSocketServer } from "ws";`, and the `handleWsClose, handleWsMessage, handleWsOpen` imports — they are no longer needed in `index.ts`.

- [ ] **Step 3: Type-check**

```bash
pnpm --filter @hideandseek/backend exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Boot the backend locally and verify a WS handshake still works**

```bash
pnpm backend:dev
```

In another terminal:

```bash
curl -v --http1.1 \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" \
  -H "Sec-WebSocket-Version: 13" \
  http://localhost:3001/ws/INVALID
```

Expected: `HTTP/1.1 101 Switching Protocols` (or a clean close on invalid code — the key is that the upgrade handler is reached, not that authentication succeeds).

Stop the backend (`Ctrl-C`).

- [ ] **Step 5: Commit**

```bash
git add backend/src/ws/attach.ts backend/src/index.ts
git commit -m "refactor(backend): extract WS server wiring into attachWsServer"
```

---

### Task 4: `withTestApp` + `makeWsClient` harness

**Files:**
- Modify: `backend/src/test/helpers.ts`

- [ ] **Step 1: Add the HTTP server + WS attach to the harness**

Append to `backend/src/test/helpers.ts`:

```ts
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";

import { attachWsServer } from "../ws/attach.js";

export interface TestContext {
    db: ReturnType<typeof createTestDb>;
    app: Hono;
    url: string; // http://127.0.0.1:<port>
    wsUrl: string; // ws://127.0.0.1:<port>
    makeWsClient: (sessionCode: string, token: string) => Promise<TestWsClient>;
    close: () => Promise<void>;
}

export interface TestWsClient {
    send: (event: unknown) => void;
    waitFor: (
        predicate: (msg: any) => boolean,
        opts?: { timeoutMs?: number },
    ) => Promise<any>;
    received: unknown[];
    close: () => void;
}

export async function withTestApp<T>(
    run: (ctx: TestContext) => Promise<T>,
): Promise<T> {
    const db = createTestDb();
    const app = createTestApp(db);

    // Start real HTTP server on ephemeral port so WS can attach
    let serverRef: any;
    await new Promise<void>((resolve) => {
        serverRef = serve(
            { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
            () => resolve(),
        );
    });
    const addr = serverRef.address() as AddressInfo;
    const url = `http://127.0.0.1:${addr.port}`;
    const wsUrl = `ws://127.0.0.1:${addr.port}`;

    const wss = attachWsServer(serverRef);

    const clients: TestWsClient[] = [];
    const makeWsClient = (sessionCode: string, token: string) =>
        makeTestWsClient(`${wsUrl}/ws/${sessionCode}?token=${token}`).then(
            (c) => {
                clients.push(c);
                return c;
            },
        );

    try {
        return await run({
            db,
            app,
            url,
            wsUrl,
            makeWsClient,
            close: async () => {},
        });
    } finally {
        for (const c of clients) c.close();
        wss.close();
        await new Promise<void>((resolve) =>
            serverRef.close(() => resolve()),
        );
    }
}

async function makeTestWsClient(fullUrl: string): Promise<TestWsClient> {
    const ws = new WebSocket(fullUrl);
    const received: unknown[] = [];
    const waiters: Array<{
        predicate: (m: any) => boolean;
        resolve: (m: any) => void;
        reject: (e: Error) => void;
    }> = [];

    ws.on("message", (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        received.push(msg);
        for (let i = waiters.length - 1; i >= 0; i--) {
            if (waiters[i].predicate(msg)) {
                waiters[i].resolve(msg);
                waiters.splice(i, 1);
            }
        }
    });

    await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
    });

    return {
        send: (event) => ws.send(JSON.stringify(event)),
        waitFor: (predicate, opts = {}) =>
            new Promise((resolve, reject) => {
                const existing = received.find(predicate);
                if (existing) {
                    resolve(existing);
                    return;
                }
                const timer = setTimeout(
                    () =>
                        reject(
                            new Error(
                                `waitFor timed out after ${
                                    opts.timeoutMs ?? 2000
                                }ms; received: ${JSON.stringify(received)}`,
                            ),
                        ),
                    opts.timeoutMs ?? 2000,
                );
                waiters.push({
                    predicate,
                    resolve: (m) => {
                        clearTimeout(timer);
                        resolve(m);
                    },
                    reject,
                });
            }),
        received,
        close: () => ws.close(),
    };
}
```

- [ ] **Step 2: Add `seedSession` seed helper**

Also in `helpers.ts`:

```ts
export async function seedSession(
    app: Hono,
): Promise<{
    code: string;
    hider: { token: string; participantId: string };
    seeker: { token: string; participantId: string };
}> {
    const created = await req<{ code: string; hostToken: string; hostParticipantId: string }>(
        app,
        "POST",
        "/api/sessions",
        {
            body: { role: "hider", displayName: "Alice" },
            expectStatus: 201,
        },
    );

    const joined = await req<{ token: string; participantId: string }>(
        app,
        "POST",
        `/api/sessions/${created.body.code}/join`,
        {
            body: { role: "seeker", displayName: "Bob" },
            expectStatus: 200,
        },
    );

    return {
        code: created.body.code,
        hider: {
            token: created.body.hostToken,
            participantId: created.body.hostParticipantId,
        },
        seeker: {
            token: joined.body.token,
            participantId: joined.body.participantId,
        },
    };
}
```

> **Note:** The exact REST payload shape depends on the current `backend/src/routes/sessions.ts`. Before running, open that file and adjust field names (`hostToken`, `participantId`, etc.) to match. The skeleton above assumes `POST /api/sessions` creates a session + host participant and `POST /api/sessions/:code/join` adds a second participant. If the real API differs, fix this helper **before** writing WS tests.

- [ ] **Step 3: Write a smoke test to verify the harness boots**

Create `backend/src/test/ws/harness.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { seedSession, withTestApp } from "../helpers.js";

describe("WS test harness", () => {
    it("boots an HTTP+WS server and seeds a two-role session", async () => {
        await withTestApp(async ({ app, makeWsClient }) => {
            const { code, hider, seeker } = await seedSession(app);
            const ws = await makeWsClient(code, hider.token);
            expect(ws).toBeTruthy();
            ws.close();
            expect(seeker.token).toBeTruthy();
        });
    });
});
```

- [ ] **Step 4: Run the harness smoke test**

```bash
pnpm --filter @hideandseek/backend test ws/harness.test
```

Expected: 1 passed. If it fails, the most likely cause is `seedSession` field-name mismatch — adjust and re-run.

- [ ] **Step 5: Commit**

```bash
git add backend/src/test/helpers.ts backend/src/test/ws/harness.test.ts
git commit -m "test(backend): add WS integration harness with seedSession helper"
```

---

### Task 5: First hiding-zone WS test — pre-reveal sync filter

**Files:**
- Create: `backend/src/test/ws/hiding-zone.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from "vitest";

import { seedSession, withTestApp } from "../helpers.js";

describe("hiding zone WS — pre-reveal filter", () => {
    it("seeker sync returns hidingZone: null while the zone is unrevealed", async () => {
        await withTestApp(async ({ app, makeWsClient }) => {
            const { code, hider, seeker } = await seedSession(app);

            const hiderWs = await makeWsClient(code, hider.token);
            hiderWs.send({
                type: "set_hiding_zone",
                stationName: "Hauptbahnhof",
                lat: 52.525,
                lng: 13.369,
                radius: 500,
                radiusUnit: "meters",
            });
            await hiderWs.waitFor(
                (m) => m.type === "hiding_zone_updated",
            );

            const seekerWs = await makeWsClient(code, seeker.token);
            const sync = await seekerWs.waitFor((m) => m.type === "sync");

            expect(sync.hidingZone).toBeNull();
        });
    });
});
```

- [ ] **Step 2: Run the test, confirm it passes**

```bash
pnpm --filter @hideandseek/backend test ws/hiding-zone.test
```

Expected: 1 passed. If it fails, the sync filter in `backend/src/ws/handler.ts` is regressed — stop and investigate before proceeding.

- [ ] **Step 3: Sanity-break the production code to prove the test has teeth**

Temporarily edit `backend/src/ws/handler.ts`: in the `sync` builder around line 141, remove the `hidingZone: null` branch so seekers always receive the zone. Run the test. Expected: FAIL. Revert the edit. Run again. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/test/ws/hiding-zone.test.ts
git commit -m "test(backend): seeker sync filters unrevealed hiding zone"
```

---

### Task 6: Second hiding-zone test — role-gated `set_hiding_zone`

**Files:**
- Modify: `backend/src/test/ws/hiding-zone.test.ts`

- [ ] **Step 1: Add the test**

Append inside the existing `describe`:

```ts
it("seeker calling set_hiding_zone is silently ignored", async () => {
    await withTestApp(async ({ app, makeWsClient, db }) => {
        const { code, hider, seeker } = await seedSession(app);

        const seekerWs = await makeWsClient(code, seeker.token);
        await seekerWs.waitFor((m) => m.type === "sync");

        seekerWs.send({
            type: "set_hiding_zone",
            stationName: "Forbidden",
            lat: 0,
            lng: 0,
            radius: 100,
            radiusUnit: "meters",
        });

        // Give the server a tick to (not) process
        await new Promise((r) => setTimeout(r, 100));

        const row = db
            .select()
            .from((await import("../../db/schema.js")).sessions)
            .all()
            .find((s) => s.code === code);
        expect(row?.hidingZone).toBeNull();

        // And a subsequent hider connect still gets nothing
        const hiderWs = await makeWsClient(code, hider.token);
        const sync = await hiderWs.waitFor((m) => m.type === "sync");
        expect(sync.hidingZone).toBeNull();
    });
});
```

- [ ] **Step 2: Run the test, confirm it passes**

```bash
pnpm --filter @hideandseek/backend test ws/hiding-zone.test
```

Expected: 2 passed.

- [ ] **Step 3: Sanity-break — confirm the test fails without the role gate**

In `backend/src/ws/handler.ts`, comment out the `if (client.role !== "hider") return;` line at the start of the `set_hiding_zone` handler. Run the test. Expected: FAIL. Restore the line.

- [ ] **Step 4: Commit**

```bash
git add backend/src/test/ws/hiding-zone.test.ts
git commit -m "test(backend): seeker cannot set hiding zone"
```

---

### Task 7: Third hiding-zone test — late joiner sees revealed zone

**Files:**
- Modify: `backend/src/test/ws/hiding-zone.test.ts`

- [ ] **Step 1: Add the test**

Append to the same describe:

```ts
it("seeker joining after reveal receives zone via sync", async () => {
    await withTestApp(async ({ app, makeWsClient }) => {
        const { code, hider } = await seedSession(app);

        const hiderWs = await makeWsClient(code, hider.token);
        hiderWs.send({
            type: "set_hiding_zone",
            stationName: "Hauptbahnhof",
            lat: 52.525,
            lng: 13.369,
            radius: 500,
            radiusUnit: "meters",
        });
        await hiderWs.waitFor((m) => m.type === "hiding_zone_updated");

        hiderWs.send({ type: "reveal_hiding_zone" });
        await hiderWs.waitFor(
            (m) =>
                m.type === "hiding_zone_updated" &&
                (m as any).hidingZone?.revealed === true,
        );

        // Add a *new* seeker AFTER reveal
        const secondSeeker = await (
            await import("../helpers.js")
        ).req<{ token: string }>(app, "POST", `/api/sessions/${code}/join`, {
            body: { role: "seeker", displayName: "Carol" },
            expectStatus: 200,
        });

        const seekerWs = await makeWsClient(code, secondSeeker.body.token);
        const sync = await seekerWs.waitFor((m) => m.type === "sync");
        expect(sync.hidingZone).toBeTruthy();
        expect(sync.hidingZone.stationName).toBe("Hauptbahnhof");
        expect(sync.hidingZone.revealed).toBe(true);
    });
});
```

- [ ] **Step 2: Run the test**

```bash
pnpm --filter @hideandseek/backend test ws/hiding-zone.test
```

Expected: 3 passed.

- [ ] **Step 3: Sanity-break**

In `backend/src/ws/handler.ts`'s `sync` builder, force `hidingZone: null` for seekers regardless of reveal state. Run the test. Expected: FAIL. Revert.

- [ ] **Step 4: Commit**

```bash
git add backend/src/test/ws/hiding-zone.test.ts
git commit -m "test(backend): late-joining seeker sees revealed hiding zone"
```

---

### Task 8: GitHub Actions PR gate

**Files:**
- Create: `.github/workflows/test.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: Tests

on:
    pull_request:
    push:
        branches: [master]
    workflow_dispatch:

jobs:
    test:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4

            - uses: pnpm/action-setup@v4
              with:
                  version: 10

            - uses: actions/setup-node@v4
              with:
                  node-version: 20
                  cache: pnpm

            - run: pnpm install --frozen-lockfile

            - run: pnpm shared:build

            - name: Backend tests
              run: pnpm --filter @hideandseek/backend test

            - name: Frontend tests
              run: pnpm test -- --run
```

> **Note:** The existing `.github/workflows/deploy.yml` is an upstream GitHub-Pages deploy that does not apply to this fork. Leave it in place — deleting it is outside this plan.

- [ ] **Step 2: Trigger it locally via a dry run**

```bash
pnpm install --frozen-lockfile && pnpm shared:build && \
  pnpm --filter @hideandseek/backend test && pnpm test -- --run
```

Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: add tests workflow (PR gate on backend + frontend vitest)"
```

- [ ] **Step 4: Push and verify the workflow runs**

```bash
git push origin master
```

Open the GitHub Actions tab; confirm the `Tests` workflow ran and passed. If it failed for env-only reasons (e.g. native-rebuild of better-sqlite3 on the runner), add `- run: pnpm rebuild better-sqlite3` after the `pnpm install` step, commit the fix, push again.

- [ ] **Step 5: Add a branch-protection required check**

Do this in the GitHub UI: Settings → Branches → `master` → Require status checks → select **Tests / test**. Screenshot or note the configuration. This step is manual; mark it done once the rule is active.

---

### Task 9: Split `api.test.ts` into route-module files

**Files:**
- Create: `backend/src/test/rest/sessions.test.ts`
- Create: `backend/src/test/rest/questions.test.ts`
- Create: `backend/src/test/rest/overpass.test.ts`
- Create: `backend/src/test/rest/uploads.test.ts`
- Delete: `backend/src/test/api.test.ts`

- [ ] **Step 1: Read the existing `backend/src/test/api.test.ts` end to end**

Identify the logical groups — tests that hit `/api/sessions`, `/api/questions`, `/api/overpass` (and `/api/poi`), `/api/upload`.

- [ ] **Step 2: For each group, create the new file and move the relevant tests**

For `sessions.test.ts`, copy the shared `beforeEach`/helper calls, then the block of `describe("POST /api/sessions", …)` etc. Do the same for the other three files.

- [ ] **Step 3: Run the whole backend suite**

```bash
pnpm --filter @hideandseek/backend test
```

Expected: same test count as before the split, all green.

- [ ] **Step 4: Delete the old file**

```bash
git rm backend/src/test/api.test.ts
pnpm --filter @hideandseek/backend test
```

Expected: still all green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/test/rest/
git commit -m "refactor(tests): split api.test.ts into route-module files"
```

---

## Phase 2 — Expansion (spec steps 4–7)

Phase 2 tasks follow the pattern Phase 1 established. For each task below, the format is:
- Files to touch
- Acceptance criteria (what green means)
- Any non-obvious implementation note

Code is shown only for genuinely new infrastructure (msw setup, RTL config, etc.) — repetitive test bodies are left to the executing engineer, who now has Phase 1 examples.

### Task 10: WS tests — questions lifecycle

**Files:** `backend/src/test/ws/questions.test.ts`

- [ ] **Step 1: Cover these scenarios**
  - Hider creates a radar-style question → seeker receives `question_created`
  - Seeker submits answer → hider receives `question_answered`
  - Question past deadline → seeker receives `question_expired`
  - Only the hider can create questions (seeker `create_question` ignored)
  - Only the seeker can answer (hider answer ignored)

- [ ] **Step 2: Follow the Task 5–7 pattern**

For each scenario: write test, run, confirm pass, optional sanity-break, commit.

- [ ] **Step 3: Commit in one batch**

```bash
git add backend/src/test/ws/questions.test.ts
git commit -m "test(backend): WS question lifecycle"
```

---

### Task 11: WS tests — positions + participant lifecycle

**Files:** `backend/src/test/ws/positions.test.ts`

- [ ] **Step 1: Cover**
  - Seeker sends `position_update` → hider receives `seeker_positions`
  - Hider never broadcasts its own position
  - Participant disconnect → remaining clients receive `participant_left`
  - Participant reconnect → receives fresh `sync`

- [ ] **Step 2: Run + commit**

```bash
pnpm --filter @hideandseek/backend test ws/positions.test
git add backend/src/test/ws/positions.test.ts
git commit -m "test(backend): WS position broadcasting + participant lifecycle"
```

---

### Task 12: WS tests — timers + push-token registration

**Files:** `backend/src/test/ws/timers.test.ts`

- [ ] **Step 1: Cover**
  - `register_push_token` stores the token on the participant row
  - Invalid push-token format is rejected without crashing
  - Expiry recovery (simulated via `vi.useFakeTimers()` advancing past deadline) fires `question_expired`

- [ ] **Step 2: Run + commit**

```bash
pnpm --filter @hideandseek/backend test ws/timers.test
git add backend/src/test/ws/timers.test.ts
git commit -m "test(backend): WS timer recovery + push token registration"
```

---

### Task 13: msw for Overpass + fixtures

**Files:**
- Create: `backend/src/test/msw.ts`
- Create: `backend/src/test/fixtures/overpass/*.json`
- Modify: `backend/src/test/helpers.ts` (wire msw up in `withTestApp`)

- [ ] **Step 1: Install msw**

```bash
pnpm --filter @hideandseek/backend add -D msw
```

- [ ] **Step 2: Write `msw.ts`**

```ts
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import fs from "node:fs";
import path from "node:path";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures/overpass");

function loadFixture(name: string) {
    return JSON.parse(
        fs.readFileSync(path.join(FIXTURES_DIR, `${name}.json`), "utf8"),
    );
}

export const mswServer = setupServer(
    http.post("https://overpass-api.de/api/interpreter", async ({ request }) => {
        const body = await request.text();
        // Match by substring against the Overpass query tag. Extend this when
        // new station types are added — current three: [railway=station],
        // [highway=bus_stop], [railway=tram_stop].
        if (body.includes("[railway=station]")) {
            return HttpResponse.json(loadFixture("railway-stations"));
        }
        if (body.includes("[highway=bus_stop]")) {
            return HttpResponse.json(loadFixture("bus-stops"));
        }
        return HttpResponse.json({ elements: [] });
    }),

    http.get("https://*.here.com/*", () => {
        return HttpResponse.json(loadFixture("here-default"));
    }),
);
```

- [ ] **Step 3: Capture real fixtures once**

```bash
pnpm backend:dev
# In another shell, hit the three canonical queries via the app, save responses
# to backend/src/test/fixtures/overpass/railway-stations.json, bus-stops.json, tram-stops.json
```

Commit fixtures alongside `msw.ts`.

- [ ] **Step 4: Wire into `withTestApp`**

Add `mswServer.listen({ onUnhandledRequest: "warn" })` in `beforeAll`, `mswServer.resetHandlers()` in `afterEach`, `mswServer.close()` in `afterAll`. Export these lifecycle hooks from `helpers.ts` or call them in a `backend/src/test/setup.ts` referenced from `vitest.config.ts`.

- [ ] **Step 5: Remove the existing "skip in CI" gates on Overpass tests**

- [ ] **Step 6: Run + commit**

```bash
pnpm --filter @hideandseek/backend test
git add backend/src/test/msw.ts backend/src/test/fixtures backend/src/test/helpers.ts backend/package.json pnpm-lock.yaml
git commit -m "test(backend): msw for Overpass + HERE with committed fixtures"
```

---

### Task 14: happy-dom + RTL setup

**Files:**
- Modify: `package.json` (add `@testing-library/react`, `@testing-library/jest-dom`, `happy-dom`)
- Modify: `vitest.config.ts` (add `environment: "happy-dom"`, `setupFiles: ["./tests/setup.ts"]`)
- Create: `tests/setup.ts`

- [ ] **Step 1: Install**

```bash
pnpm add -D @testing-library/react @testing-library/jest-dom happy-dom
```

- [ ] **Step 2: Create `tests/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

// Reset every atom graph between tests by re-importing if your atoms support it,
// or by clearing localStorage (which persistentAtom reads).
beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    cleanup();
});
```

- [ ] **Step 3: Update `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "happy-dom",
        setupFiles: ["./tests/setup.ts"],
        globals: false,
    },
});
```

- [ ] **Step 4: Sanity-render a component**

Create `tests/components/smoke.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("RTL smoke", () => {
    it("renders a trivial component", () => {
        render(<div>hello</div>);
        expect(screen.getByText("hello")).toBeInTheDocument();
    });
});
```

- [ ] **Step 5: Run + commit**

```bash
pnpm test
git add tests/setup.ts tests/components/smoke.test.tsx vitest.config.ts package.json pnpm-lock.yaml
git commit -m "test(frontend): happy-dom + RTL setup"
```

---

### Task 15: Component test — MyZonePanel

**Files:** `tests/components/MyZonePanel.test.tsx`

- [ ] **Step 1: Test scenarios**
  - "Stationen laden" button is disabled when no type is selected
  - Selecting "Bahnhöfe" then clicking load triggers a fetch — stub `findPlacesInZone` to return a canned list
  - Clicking a station sends a `set_hiding_zone` WS event with the right payload (spy on `wsInstance`)
  - When `activeHidingZone.set(...)` fires, the info card renders the station name and radius
  - When `activeHidingZone` is revealed, the "Endgame aktiv" button is disabled

- [ ] **Step 2: Mock `wsInstance` with a fake WebSocket-like object**

```ts
const sent: string[] = [];
const fakeWs = {
    readyState: 1,
    send: (data: string) => sent.push(data),
};
wsInstance.set(fakeWs as any);
```

- [ ] **Step 3: Run + commit**

```bash
pnpm test tests/components/MyZonePanel.test
git add tests/components/MyZonePanel.test.tsx
git commit -m "test(frontend): MyZonePanel component tests"
```

---

### Task 16: Component test — BottomSheet tab gating

**Files:** `tests/components/BottomSheet.test.tsx`

- [ ] **Step 1: Test scenarios**
  - Hider in session sees both `Meine Zone` and `Alle Zonen` sub-tabs
  - Seeker in session does **not** see the Versteckzonen tab
  - Not in session — no sub-tabs at all

- [ ] **Step 2: Run + commit**

```bash
git add tests/components/BottomSheet.test.tsx
git commit -m "test(frontend): bottom sheet tab gating by role"
```

---

### Task 17: Component test — SessionQuestionPanel

**Files:** `tests/components/SessionQuestionPanel.test.tsx`

- [ ] **Step 1: Test scenarios**
  - Seeker sees pending questions from hider; hider sees their sent questions
  - Answer submit calls `$ws.send` with the right event
  - Expired question shows "abgelaufen" and is not answerable
  - Disabled when `$ws` is closed

- [ ] **Step 2: Run + commit**

```bash
git add tests/components/SessionQuestionPanel.test.tsx
git commit -m "test(frontend): session question panel states"
```

---

### Task 18: Component test — CreateSessionOverlay

**Files:** `tests/components/CreateSessionOverlay.test.tsx`

- [ ] **Step 1: Test scenarios for the 5-step flow (per MEMORY.md: entry → gebiet → groesse → code → rolle / join-code → rolle)**
  - Entry step lets user choose "erstellen" or "beitreten"
  - "erstellen" path walks gebiet → groesse → code → rolle; invalid inputs block progression
  - "beitreten" path walks join-code → rolle; wrong code shows error
  - On completion, fires `POST /api/sessions` (or `/join`) — spy on `sessionApi`

- [ ] **Step 2: Run + commit**

```bash
git add tests/components/CreateSessionOverlay.test.tsx
git commit -m "test(frontend): create session overlay flow"
```

---

### Task 19: L1 gap-fill — card-costs

**Files:** `tests/card-costs.test.ts`

- [ ] **Step 1: Cover every exported function in `src/lib/card-costs.ts`**
  - Use `it.each` for parameterised cases
  - Assert numeric outputs exactly; no floating-point fuzz unless the code itself does math (then tolerate `±0.001`)

- [ ] **Step 2: Commit**

```bash
git add tests/card-costs.test.ts
git commit -m "test: card-costs exhaustive unit coverage"
```

---

### Task 20: L1 gap-fill — photo-challenges, timer math, hiding-zone-loader

**Files:**
- `tests/photo-challenges.test.ts`
- `tests/timer-context.test.ts`
- `tests/hiding-zone-loader.test.ts`

- [ ] **Step 1: One file per module, same approach as Task 19**

- [ ] **Step 2: Commit each separately**

```bash
git add tests/photo-challenges.test.ts
git commit -m "test: photo-challenges unit coverage"
git add tests/timer-context.test.ts
git commit -m "test: timer-context math unit coverage"
git add tests/hiding-zone-loader.test.ts
git commit -m "test: hiding-zone-loader unit coverage"
```

---

## Phase 3 — End-to-end (spec steps 8–10)

### Task 21: Playwright install + config

**Files:**
- Create: `e2e/playwright.config.ts`
- Create: `e2e/intercepts/overpass.ts`
- Modify: `package.json` (add `test:e2e` script)

- [ ] **Step 1: Install**

```bash
pnpm add -D -w @playwright/test
pnpm exec playwright install chromium
```

- [ ] **Step 2: Playwright config**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./flows",
    fullyParallel: true,
    retries: process.env.CI ? 1 : 0,
    use: {
        baseURL: "http://127.0.0.1:4321",
        trace: "retain-on-failure",
    },
    webServer: [
        {
            command:
                "PORT=3012 DB_PATH=:memory: pnpm --filter @hideandseek/backend start",
            url: "http://127.0.0.1:3012",
            reuseExistingServer: !process.env.CI,
        },
        {
            command:
                "PUBLIC_BACKEND_URL=http://127.0.0.1:3012 PUBLIC_BACKEND_WS_URL=ws://127.0.0.1:3012 pnpm preview --port 4321",
            url: "http://127.0.0.1:4321",
            reuseExistingServer: !process.env.CI,
        },
    ],
});
```

> **Note:** If `DB_PATH=:memory:` doesn't work with better-sqlite3's file-based driver as configured, use a throwaway file in `e2e/.tmp/` cleaned before each run instead.

- [ ] **Step 3: Shared Overpass route intercept**

```ts
// e2e/intercepts/overpass.ts
import type { Page } from "@playwright/test";
import fixture from "../../backend/src/test/fixtures/overpass/railway-stations.json";

export async function interceptOverpass(page: Page) {
    await page.route("https://overpass-api.de/api/interpreter", (route) =>
        route.fulfill({ json: fixture }),
    );
}
```

- [ ] **Step 4: Add `test:e2e` script**

```json
"test:e2e": "pnpm build && playwright test --config e2e/playwright.config.ts"
```

- [ ] **Step 5: Commit**

```bash
git add e2e/playwright.config.ts e2e/intercepts/overpass.ts package.json pnpm-lock.yaml
git commit -m "test(e2e): Playwright setup + Overpass route intercept"
```

---

### Task 22: Golden-path e2e spec

**Files:** `e2e/flows/golden-path.spec.ts`

- [ ] **Step 1: Implement the flow in one multi-context test**

```ts
import { expect, test } from "@playwright/test";

import { interceptOverpass } from "../intercepts/overpass.js";

test("golden path: create → join → question → answer → reveal → endgame", async ({
    browser,
}) => {
    const hiderCtx = await browser.newContext();
    const seekerCtx = await browser.newContext();
    const hider = await hiderCtx.newPage();
    const seeker = await seekerCtx.newPage();
    await interceptOverpass(hider);
    await interceptOverpass(seeker);

    // 1. Hider creates a session
    await hider.goto("/");
    await hider.getByRole("button", { name: /session erstellen/i }).click();
    /* walk the 5-step onboarding, enter gebiet/groesse/rolle */
    const code = await hider.getByTestId("session-code").textContent();
    expect(code).toMatch(/^\w{6}$/);

    // 2. Seeker joins
    await seeker.goto("/");
    await seeker.getByRole("button", { name: /beitreten/i }).click();
    await seeker.getByLabel(/code/i).fill(code!);
    await seeker.getByRole("button", { name: /als seeker/i }).click();

    // 3. Hider picks a zone
    await hider.getByRole("tab", { name: /versteckzonen/i }).click();
    await hider.getByRole("button", { name: /stationen laden/i }).click();
    await hider.getByRole("button", { name: /hauptbahnhof/i }).click();

    // 4. Seeker asks a question
    /* … and so on. Wait for the Map to render the revealed circle. */

    // 5. Hider reveals
    await hider.getByRole("button", { name: /endgame freigeben/i }).click();
    await hider.getByRole("button", { name: /endgame freigeben/i }).click(); // confirm
    await expect(seeker.getByText(/hauptbahnhof/i)).toBeVisible();
});
```

> **Note:** Selectors above are illustrative. Add `data-testid` attributes to the real components during this task if current markup isn't queryable by role alone.

- [ ] **Step 2: Run**

```bash
pnpm test:e2e e2e/flows/golden-path.spec.ts
```

Expected: 1 passed.

- [ ] **Step 3: Commit**

```bash
git add e2e/flows/golden-path.spec.ts
git commit -m "test(e2e): golden path — create to endgame"
```

---

### Task 23: VPS nightly runner — systemd units

**Files:**
- Create: `ops/nightly/hideandseek-nightly.service`
- Create: `ops/nightly/hideandseek-nightly.timer`
- Create: `ops/nightly/run.sh`

- [ ] **Step 1: Runner script**

```bash
# ops/nightly/run.sh
#!/usr/bin/env bash
set -euo pipefail

WORKDIR=/opt/hideandseek-tests
LOG=/var/log/hideandseek/nightly-$(date +%Y%m%d).log

cd "$WORKDIR"
git fetch origin master && git reset --hard origin/master
pnpm install --frozen-lockfile
pnpm shared:build

# Unit + integration (mocks). `pnpm test` in the root is watch-mode; use
# `pnpm test -- --run` explicitly to exit when done.
pnpm --filter @hideandseek/backend test >> "$LOG" 2>&1 || UNIT_FAILED=1
pnpm test -- --run >> "$LOG" 2>&1 || UNIT_FAILED=1

# Contract tests (real APIs)
TEST_CONTRACT=1 pnpm --filter @hideandseek/backend test contract >> "$LOG" 2>&1 || CONTRACT_FAILED=1

# Playwright e2e
pnpm test:e2e >> "$LOG" 2>&1 || E2E_FAILED=1

if [[ -n "${UNIT_FAILED:-}" || -n "${CONTRACT_FAILED:-}" || -n "${E2E_FAILED:-}" ]]; then
    gh issue create \
        --title "Nightly tests red — $(date +%Y-%m-%d)" \
        --body "See /var/log/hideandseek/nightly-$(date +%Y%m%d).log on the VPS." \
        --label automated,nightly
    exit 1
fi
```

- [ ] **Step 2: systemd unit**

```ini
# ops/nightly/hideandseek-nightly.service
[Unit]
Description=HideAndSeek nightly test run

[Service]
Type=oneshot
ExecStart=/opt/hideandseek-tests/ops/nightly/run.sh
User=root
StandardOutput=journal
StandardError=journal
```

- [ ] **Step 3: systemd timer**

```ini
# ops/nightly/hideandseek-nightly.timer
[Unit]
Description=HideAndSeek nightly — daily at 03:00

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

- [ ] **Step 4: Install on the VPS (manual operator step)**

```bash
ssh root@91.98.85.53
git clone https://github.com/jens-nerd/JetLagHideAndSeek.git /opt/hideandseek-tests
cd /opt/hideandseek-tests
cp ops/nightly/hideandseek-nightly.{service,timer} /etc/systemd/system/
systemctl enable --now hideandseek-nightly.timer
systemctl list-timers | grep hideandseek
```

- [ ] **Step 5: Dry run**

```bash
ssh root@91.98.85.53 'systemctl start hideandseek-nightly.service && sleep 300 && journalctl -u hideandseek-nightly.service --since "10 min ago"'
```

Expected: clean run, exit 0, log file created.

- [ ] **Step 6: Commit**

```bash
git add ops/nightly/
git commit -m "ops(nightly): systemd timer + runner for nightly e2e + contract suite"
```

---

### Task 24: Additional e2e flows

**Files:**
- Create: `e2e/flows/photo-question.spec.ts`
- Create: `e2e/flows/thermometer-gps.spec.ts`
- Create: `e2e/flows/endgame-variants.spec.ts`

- [ ] **Step 1: `photo-question.spec.ts`**
  - Seeker asks a photo question
  - Hider uploads an image via `<input type="file">` (use `page.setInputFiles`)
  - Seeker sees the image

- [ ] **Step 2: `thermometer-gps.spec.ts`**
  - Seeker starts thermometer tracking — mock `navigator.geolocation` via `page.addInitScript`
  - Confirm bottom sheet expands after tracking stops (regression test for the recent `ThermometerGpsLayer` fix)

- [ ] **Step 3: `endgame-variants.spec.ts`**
  - Hider reveals, then changes stations — seekers see the new circle and the `hiding_zone_revealed` re-broadcast
  - Seeker catches hider mid-game — session transitions to `finished`
  - Seeker joins late after reveal — circle appears on their map

- [ ] **Step 4: Commit each spec separately**

```bash
git add e2e/flows/photo-question.spec.ts
git commit -m "test(e2e): photo question flow"
git add e2e/flows/thermometer-gps.spec.ts
git commit -m "test(e2e): thermometer GPS flow"
git add e2e/flows/endgame-variants.spec.ts
git commit -m "test(e2e): endgame variants — zone change, caught, late join"
```

---

## Closing Tasks

### Task 25: TESTING.md living doc

**Files:** `TESTING.md`

- [ ] **Step 1: Write a short contributor guide**

Cover: which command runs what (`pnpm test`, `pnpm test:backend`, `pnpm test:all`, `pnpm test:e2e`); the file layout from the spec §7; how to add a test in each layer with a one-file example link; flakiness policy; how to regenerate fixtures.

- [ ] **Step 2: Commit**

```bash
git add TESTING.md
git commit -m "docs: TESTING.md — living contributor guide"
```

---

### Task 26: Reference the plan from MEMORY.md

**Files:** `/Users/jensvielhaben-nl001/.claude/projects/-Users-jensvielhaben-nl001-hideandseek/memory/MEMORY.md`

- [ ] **Step 1: Add one-line pointer**

Append under the project section:
`- [Testing concept](../../hideandseek/docs/superpowers/specs/2026-04-19-automated-testing-concept-design.md) — five-layer pyramid, mock-first PR gate, nightly real-API contract run.`

- [ ] **Step 2: No commit (memory is per-user, not repo state)**

---

## Self-Review Checklist (for the plan author, pre-handoff)

- Every spec rollout step (1–10) maps to at least one task above.
- No "TBD" / "TODO" / "fill in later" strings outside explicit **Note** callouts that flag known discovery work.
- Function names stay consistent: `runMigrations`, `withTestApp`, `makeWsClient`, `seedSession`, `attachWsServer`, `mswServer`.
- File paths are absolute where ambiguous (`backend/src/test/ws/hiding-zone.test.ts`, not `hiding-zone.test.ts`).
- Every task has at least one failing-test or run-check step before the commit step (except pure infra/ops tasks 8, 21, 23).
