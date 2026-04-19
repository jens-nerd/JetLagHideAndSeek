/**
 * Test helpers for backend integration tests.
 *
 * Two test modes are supported:
 *
 * 1. IN-PROCESS (default for CI): createTestApp() creates a Hono app backed by
 *    an in-memory SQLite database.  No external server needed.
 *    Requires better-sqlite3 native bindings to be compiled for the current
 *    Node version (run `npm rebuild better-sqlite3` if needed).
 *
 * 2. LIVE-SERVER (when BACKEND_URL is set): req() calls the running backend
 *    over HTTP.  Useful for smoke-testing a real deployment.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import type { Hono } from "hono";
import { WebSocket } from "ws";

import { createApp } from "../app.js";
import { runMigrations } from "../db/migrator.js";
import * as schema from "../db/schema.js";
import { attachWsServer } from "../ws/attach.js";

/** Create a fresh in-memory SQLite database with all tables. */
export function createTestDb() {
    const sqlite = new Database(":memory:");
    runMigrations(sqlite);
    return drizzle(sqlite, { schema });
}

/** Create a Hono app backed by the given test database. */
export function createTestApp(db: ReturnType<typeof createTestDb>): Hono {
    return createApp(db);
}

// ── HTTP request helper ───────────────────────────────────────────────────────

/** Base URL for live-server tests.  Unset = use in-process Hono app. */
const LIVE_URL = process.env.BACKEND_URL ?? null;

/**
 * Send a request either to the in-process Hono app (default) or to a live
 * server (when BACKEND_URL env var is set).
 */
export async function req<T = unknown>(
    app: Hono | null,
    method: string,
    path: string,
    options: {
        body?: unknown;
        token?: string;
        expectStatus?: number;
    } = {},
): Promise<{ status: number; body: T }> {
    const { body, token, expectStatus } = options;
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Origin: "http://localhost:4321",
    };
    if (token) headers["x-participant-token"] = token;

    let res: Response;

    if (LIVE_URL) {
        // Live server mode: use global fetch
        res = await fetch(`${LIVE_URL}${path}`, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
    } else {
        // In-process mode: use Hono's built-in test client
        if (!app) throw new Error("app is required when BACKEND_URL is not set");
        res = await app.request(path, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
    }

    const json = (await res.json()) as T;

    if (expectStatus !== undefined && res.status !== expectStatus) {
        throw new Error(
            `Expected status ${expectStatus}, got ${res.status}. Body: ${JSON.stringify(json)}`,
        );
    }

    return { status: res.status, body: json };
}

// ── WS test harness ───────────────────────────────────────────────────────────

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

    const wss = attachWsServer(serverRef, db);

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

// ── Session seed helper ───────────────────────────────────────────────────────

/**
 * Seed a two-participant session via the real REST API (in-process Hono).
 *
 * POST /api/sessions   → { session, participant: { id, token, ... } }
 * POST /api/sessions/:code/join → { session, participant: { id, token, ... } }
 */
export async function seedSession(
    app: Hono,
): Promise<{
    code: string;
    hider: { token: string; participantId: string };
    seeker: { token: string; participantId: string };
}> {
    const created = await req<{
        session: { code: string };
        participant: { id: string; token: string };
    }>(app, "POST", "/api/sessions", {
        body: { role: "hider", displayName: "Alice" },
        expectStatus: 201,
    });

    const code = created.body.session.code;

    const joined = await req<{
        session: { code: string };
        participant: { id: string; token: string };
    }>(app, "POST", `/api/sessions/${code}/join`, {
        body: { role: "seeker", displayName: "Bob" },
        expectStatus: 201,
    });

    return {
        code,
        hider: {
            token: created.body.participant.token,
            participantId: created.body.participant.id,
        },
        seeker: {
            token: joined.body.participant.token,
            participantId: joined.body.participant.id,
        },
    };
}
