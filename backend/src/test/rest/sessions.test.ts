/**
 * Integration tests for the Sessions REST API.
 *
 * Covers /health, POST /api/sessions, GET /api/sessions/:code,
 * POST /api/sessions/:code/join, and PATCH /api/sessions/:code/map.
 *
 * MODE 1 – in-process (default, for CI without a running server):
 *   Each test group gets a fresh in-memory SQLite database via createTestDb(),
 *   so tests are fully isolated.  Requires better-sqlite3 native bindings to be
 *   compiled for the current Node version:
 *     npm rebuild better-sqlite3
 *
 * MODE 2 – live-server (set BACKEND_URL=http://localhost:3001 before running):
 *   All requests go to the running backend.  Tests share the real DB, so a few
 *   assertions are relaxed (e.g. question counts may be > expected).
 *
 * Run (in-process):
 *   pnpm --filter @hideandseek/backend test
 *
 * Run (live-server):
 *   BACKEND_URL=http://localhost:3001 pnpm --filter @hideandseek/backend test
 */
import type { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestApp, createTestDb, req } from "../helpers.js";

// ── Detect mode ───────────────────────────────────────────────────────────────

const LIVE = !!process.env.BACKEND_URL;

// ── App factory ───────────────────────────────────────────────────────────────

/**
 * Returns a fresh Hono app (in-process mode) or null (live-server mode).
 * In live-server mode, helpers.req() ignores the app parameter and calls
 * the real server via fetch instead.
 */
function makeApp(): Hono | null {
    if (LIVE) return null;
    return createTestApp(createTestDb());
}

// ── Shared helpers ────────────────────────────────────────────────────────────

async function createSession(app: Hono | null, displayName = "Hider Hans") {
    const { body } = await req<any>(app, "POST", "/api/sessions", {
        body: { displayName },
        expectStatus: 201,
    });
    return {
        code: body.session.code as string,
        hiderToken: body.participant.token as string,
        sessionId: body.session.id as string,
        session: body.session,
        hider: body.participant,
    };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Health check", () => {
    let app: Hono | null;
    beforeEach(() => { app = makeApp(); });

    it("GET /health returns { ok: true }", async () => {
        const { status, body } = await req<{ ok: boolean }>(app, "GET", "/health");
        expect(status).toBe(200);
        expect(body.ok).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Sessions", () => {
    let app: Hono | null;
    beforeEach(() => { app = makeApp(); });

    // ── POST /api/sessions ──────────────────────────────────────────────────

    it("creates a session and returns hider participant with token", async () => {
        const { body, status } = await req<any>(app, "POST", "/api/sessions", {
            body: { displayName: "Hider Hans" },
        });

        expect(status).toBe(201);
        expect(body.session.code).toMatch(/^[A-Z2-9]{6}$/);
        expect(body.session.status).toBe("waiting");
        expect(body.participant.role).toBe("hider");
        expect(typeof body.participant.token).toBe("string");
        expect(body.participant.token.length).toBeGreaterThan(10);
    });

    it("rejects session creation without displayName", async () => {
        const { status, body } = await req<any>(app, "POST", "/api/sessions", {
            body: {},
        });
        expect(status).toBe(400);
        expect(body.error).toMatch(/displayName/);
    });

    it("rejects session creation with whitespace-only displayName", async () => {
        const { status } = await req<any>(app, "POST", "/api/sessions", {
            body: { displayName: "   " },
        });
        expect(status).toBe(400);
    });

    // ── GET /api/sessions/:code ─────────────────────────────────────────────

    it("fetches a session by code (case-insensitive)", async () => {
        const { code } = await createSession(app);
        const { status, body } = await req<any>(app, "GET", `/api/sessions/${code.toLowerCase()}`);

        expect(status).toBe(200);
        expect(body.session.code).toBe(code);
        expect(Array.isArray(body.questions)).toBe(true);
        expect(typeof body.seekerCount).toBe("number");
        expect(typeof body.hiderConnected).toBe("boolean");
    });

    it("returns 404 for non-existent session code", async () => {
        const { status } = await req<any>(app, "GET", "/api/sessions/ZZZZZZ");
        expect(status).toBe(404);
    });

    // ── POST /api/sessions/:code/join ───────────────────────────────────────

    it("seeker can join a session", async () => {
        const { code } = await createSession(app);
        const { status, body } = await req<any>(app, "POST", `/api/sessions/${code}/join`, {
            body: { displayName: "Seeker Susi" },
        });

        expect(status).toBe(201);
        expect(body.participant.role).toBe("seeker");
        expect(typeof body.participant.token).toBe("string");
    });

    it("rejects join without displayName", async () => {
        const { code } = await createSession(app);
        const { status } = await req<any>(app, "POST", `/api/sessions/${code}/join`, {
            body: {},
        });
        expect(status).toBe(400);
    });

    it("returns 404 when joining non-existent session", async () => {
        const { status } = await req<any>(app, "POST", "/api/sessions/ZZZZZZ/join", {
            body: { displayName: "Test" },
        });
        expect(status).toBe(404);
    });

    // ── PATCH /api/sessions/:code/map ───────────────────────────────────────

    it("hider can update the map location", async () => {
        const { code, hiderToken } = await createSession(app);
        const mapLocation = { lat: 53.55, lng: 10.01, name: "Hamburg" };

        const { status, body } = await req<any>(app, "PATCH", `/api/sessions/${code}/map`, {
            body: { mapLocation },
            token: hiderToken,
        });

        expect(status).toBe(200);
        expect(body.ok).toBe(true);

        // Verify the map location is persisted
        const { body: getBody } = await req<any>(app, "GET", `/api/sessions/${code}`);
        expect(getBody.session.mapLocation.lat).toBe(53.55);
        expect(getBody.session.mapLocation.name).toBe("Hamburg");
    });

    it("rejects map update without token", async () => {
        const { code } = await createSession(app);
        const { status } = await req<any>(app, "PATCH", `/api/sessions/${code}/map`, {
            body: { mapLocation: { lat: 0, lng: 0, name: "x" } },
        });
        expect(status).toBe(401);
    });

    it("rejects map update with wrong token", async () => {
        const { code } = await createSession(app);
        const { status } = await req<any>(app, "PATCH", `/api/sessions/${code}/map`, {
            body: { mapLocation: { lat: 0, lng: 0, name: "x" } },
            token: "invalidtoken123",
        });
        expect(status).toBe(403);
    });
});
