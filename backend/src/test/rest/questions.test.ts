/**
 * Integration tests for the Questions REST API.
 *
 * Covers POST /api/sessions/:code/questions, GET /api/sessions/:code/questions,
 * and POST /api/questions/:id/answer.
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

async function joinSession(app: Hono | null, code: string, displayName = "Seeker Susi") {
    const { body } = await req<any>(app, "POST", `/api/sessions/${code}/join`, {
        body: { displayName },
        expectStatus: 201,
    });
    return { seekerToken: body.participant.token as string, participant: body.participant };
}

async function addQuestion(
    app: Hono | null,
    code: string,
    token: string,
    type = "radius",
    data: unknown = { lat: 53.5, lng: 10.0 },
) {
    const { body } = await req<any>(app, "POST", `/api/sessions/${code}/questions`, {
        body: { type, data },
        token,
        expectStatus: 201,
    });
    return { questionId: body.question.id as string, question: body.question };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Questions", () => {
    let app: Hono | null;
    beforeEach(() => { app = makeApp(); });

    // ── POST /api/sessions/:code/questions ──────────────────────────────────

    it("seeker can add a question", async () => {
        const { code } = await createSession(app);
        const { seekerToken } = await joinSession(app, code);

        const { status, body } = await req<any>(app, "POST", `/api/sessions/${code}/questions`, {
            body: { type: "radius", data: { lat: 53.5, lng: 10.0, radius: 50, unit: "kilometers" } },
            token: seekerToken,
        });

        expect(status).toBe(201);
        expect(body.question.type).toBe("radius");
        expect(body.question.status).toBe("pending");
        expect(body.question.data.lat).toBe(53.5);
    });

    it("hider cannot add a question", async () => {
        const { code, hiderToken } = await createSession(app);

        const { status } = await req<any>(app, "POST", `/api/sessions/${code}/questions`, {
            body: { type: "radius", data: { lat: 53.5, lng: 10.0 } },
            token: hiderToken,
        });

        expect(status).toBe(403);
    });

    it("rejects question without data field", async () => {
        const { code } = await createSession(app);
        const { seekerToken } = await joinSession(app, code);

        const { status } = await req<any>(app, "POST", `/api/sessions/${code}/questions`, {
            body: { type: "radius" }, // missing data
            token: seekerToken,
        });
        expect(status).toBe(400);
    });

    it("rejects question with invalid token", async () => {
        const { code } = await createSession(app);
        const { status } = await req<any>(app, "POST", `/api/sessions/${code}/questions`, {
            body: { type: "radius", data: {} },
            token: "bogustoken",
        });
        expect(status).toBe(403);
    });

    // ── GET /api/sessions/:code/questions ───────────────────────────────────

    it("returns questions for a session (at least those just added)", async () => {
        const { code } = await createSession(app);
        const { seekerToken } = await joinSession(app, code);
        await addQuestion(app, code, seekerToken, "radius");
        await addQuestion(app, code, seekerToken, "thermometer", {
            latA: 53.5, lngA: 10.0, latB: 53.6, lngB: 10.1,
        });

        const { status, body } = await req<any>(app, "GET", `/api/sessions/${code}/questions`, {
            token: seekerToken,
        });

        expect(status).toBe(200);
        expect(body.questions.length).toBeGreaterThanOrEqual(2);
        const types = body.questions.map((q: any) => q.type);
        expect(types).toContain("radius");
        expect(types).toContain("thermometer");
    });

    it("requires valid token to list questions", async () => {
        const { code } = await createSession(app);
        const { status } = await req<any>(app, "GET", `/api/sessions/${code}/questions`, {
            token: "badtoken",
        });
        expect(status).toBe(403);
    });

    // ── POST /api/questions/:id/answer ──────────────────────────────────────

    it("hider can answer a pending question", async () => {
        const { code, hiderToken } = await createSession(app);
        const { seekerToken } = await joinSession(app, code);
        const { questionId } = await addQuestion(app, code, seekerToken);

        const answerData = { lat: 53.5, lng: 10.0, radius: 50, unit: "kilometers", within: true };
        const { status, body } = await req<any>(app, "POST", `/api/questions/${questionId}/answer`, {
            body: { answerData },
            token: hiderToken,
        });

        expect(status).toBe(200);
        expect(body.question.status).toBe("answered");
        expect(body.question.answerData.within).toBe(true);
    });

    it("seeker cannot answer a question", async () => {
        const { code } = await createSession(app);
        const { seekerToken } = await joinSession(app, code);
        const { questionId } = await addQuestion(app, code, seekerToken);

        const { status } = await req<any>(app, "POST", `/api/questions/${questionId}/answer`, {
            body: { answerData: { within: true } },
            token: seekerToken,
        });

        expect(status).toBe(403);
    });

    it("cannot answer an already-answered question", async () => {
        const { code, hiderToken } = await createSession(app);
        const { seekerToken } = await joinSession(app, code);
        const { questionId } = await addQuestion(app, code, seekerToken);

        // First answer
        await req<any>(app, "POST", `/api/questions/${questionId}/answer`, {
            body: { answerData: { within: true } },
            token: hiderToken,
            expectStatus: 200,
        });

        // Second attempt → 409 Conflict
        const { status } = await req<any>(app, "POST", `/api/questions/${questionId}/answer`, {
            body: { answerData: { within: false } },
            token: hiderToken,
        });

        expect(status).toBe(409);
    });

    it("returns 404 for non-existent question id", async () => {
        const { hiderToken } = await createSession(app);
        const { status } = await req<any>(app, "POST", "/api/questions/nonexistentid/answer", {
            body: { answerData: {} },
            token: hiderToken,
        });
        expect(status).toBe(404);
    });

    it("requires answerData to be present", async () => {
        const { code, hiderToken } = await createSession(app);
        const { seekerToken } = await joinSession(app, code);
        const { questionId } = await addQuestion(app, code, seekerToken);

        const { status } = await req<any>(app, "POST", `/api/questions/${questionId}/answer`, {
            body: {}, // missing answerData
            token: hiderToken,
        });

        expect(status).toBe(400);
    });

    // ── Full round-trip ─────────────────────────────────────────────────────

    it("full round-trip: question added and answered is visible via GET", async () => {
        const { code, hiderToken } = await createSession(app);
        const { seekerToken } = await joinSession(app, code);

        // 1. Seeker asks
        const { questionId } = await addQuestion(app, code, seekerToken, "radius", {
            lat: 53.5,
            lng: 10.0,
            radius: 20,
            unit: "kilometers",
            within: true,
            drag: true,
            color: "blue",
        });

        // 2. Hider answers with full merged data (simulating the real client)
        const answerData = {
            lat: 53.5,
            lng: 10.0,
            radius: 20,
            unit: "kilometers",
            within: true,
            drag: true,
            color: "blue",
        };
        await req<any>(app, "POST", `/api/questions/${questionId}/answer`, {
            body: { answerData },
            token: hiderToken,
            expectStatus: 200,
        });

        // 3. GET questions shows the answered state with full answerData preserved
        const { body } = await req<any>(app, "GET", `/api/sessions/${code}/questions`, {
            token: seekerToken,
        });

        const q = body.questions.find((x: any) => x.id === questionId);
        expect(q).toBeDefined();
        expect(q.status).toBe("answered");
        expect(q.answerData.within).toBe(true);
        expect(q.answerData.lat).toBe(53.5);
        expect(typeof q.answeredAt).toBe("string");
    });
});
