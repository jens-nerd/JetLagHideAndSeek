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
import type { Hono } from "hono";

import { createApp } from "../app.js";
import { runMigrations } from "../db/migrator.js";
import * as schema from "../db/schema.js";

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
