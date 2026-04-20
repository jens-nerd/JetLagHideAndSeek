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
