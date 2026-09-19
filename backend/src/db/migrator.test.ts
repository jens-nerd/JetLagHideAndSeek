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

    it("ergaenzt uses_left auf einer Datenbank mit Stand 7", () => {
        const sqlite = new Database(":memory:");
        runMigrations(sqlite);
        // Auf Stand 7 zuruecksetzen und die Spalte wieder entfernen, damit die
        // Migration wirklich etwas zu tun hat.
        sqlite.exec("ALTER TABLE curses DROP COLUMN uses_left");
        sqlite.pragma("user_version = 7");

        // Ein Fluch aus der Zeit davor.
        sqlite.exec(`
            INSERT INTO sessions (id, code, expires_at)
                VALUES ('s1', 'AAA111', '2099-01-01T00:00:00.000Z');
            INSERT INTO participants (id, session_id, role, token, display_name)
                VALUES ('p1', 's1', 'hider', 't1', 'Hider Hans');
            INSERT INTO curses (id, session_id, card_id, played_by_participant_id, played_at)
                VALUES ('c1', 's1', 'fluch-nachschlag', 'p1', '2026-01-01T00:00:00.000Z');
        `);

        runMigrations(sqlite);

        const cols = sqlite
            .prepare("PRAGMA table_info(curses)")
            .all()
            .map((r: any) => r.name);
        expect(cols).toContain("uses_left");
        expect(sqlite.pragma("user_version", { simple: true })).toBeGreaterThanOrEqual(8);

        const row = sqlite.prepare("SELECT uses_left FROM curses WHERE id = 'c1'").get() as any;
        expect(row.uses_left).toBeNull();

        expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
    });

    it("ergaenzt locked_category auf einer Datenbank mit Stand 8", () => {
        const sqlite = new Database(":memory:");
        runMigrations(sqlite);
        // Auf Stand 8 zuruecksetzen und die Spalte wieder entfernen, damit die
        // Migration wirklich etwas zu tun hat.
        sqlite.exec("ALTER TABLE curses DROP COLUMN locked_category");
        sqlite.pragma("user_version = 8");

        // Ein Fluch aus der Zeit davor.
        sqlite.exec(`
            INSERT INTO sessions (id, code, expires_at)
                VALUES ('s1', 'AAA111', '2099-01-01T00:00:00.000Z');
            INSERT INTO participants (id, session_id, role, token, display_name)
                VALUES ('p1', 's1', 'hider', 't1', 'Hider Hans');
            INSERT INTO curses (id, session_id, card_id, played_by_participant_id, played_at)
                VALUES ('c1', 's1', 'fluch-tabu', 'p1', '2026-01-01T00:00:00.000Z');
        `);

        runMigrations(sqlite);

        const cols = sqlite
            .prepare("PRAGMA table_info(curses)")
            .all()
            .map((r: any) => r.name);
        expect(cols).toContain("locked_category");
        expect(sqlite.pragma("user_version", { simple: true })).toBeGreaterThanOrEqual(9);

        const row = sqlite
            .prepare("SELECT locked_category FROM curses WHERE id = 'c1'")
            .get() as any;
        expect(row.locked_category).toBeNull();

        expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok");

        // Zweiter Lauf: aendert nichts und wirft nicht.
        runMigrations(sqlite);
        expect(sqlite.pragma("user_version", { simple: true })).toBe(CURRENT_SCHEMA_VERSION);
        expect(
            sqlite.prepare("PRAGMA table_info(curses)").all().filter(
                (r: any) => r.name === "locked_category",
            ),
        ).toHaveLength(1);
    });
});
