import type Database from "better-sqlite3";

export const CURRENT_SCHEMA_VERSION = 6;

type ColumnRow = { name: string };

function columnNames(db: Database.Database, table: string): string[] {
    return (db.pragma(`table_info(${table})`) as ColumnRow[]).map((r) => r.name);
}

// Copy of the initial schema from migrate.ts — verbatim.
const INITIAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,
    status      TEXT NOT NULL DEFAULT 'waiting'
                    CHECK(status IN ('waiting','active','finished')),
    map_location TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
    id           TEXT PRIMARY KEY,
    session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role         TEXT NOT NULL CHECK(role IN ('hider','seeker')),
    token        TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    joined_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS questions (
    id                       TEXT PRIMARY KEY,
    session_id               TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    created_by_participant_id TEXT NOT NULL REFERENCES participants(id),
    type                     TEXT NOT NULL,
    data                     TEXT NOT NULL,
    status                   TEXT NOT NULL DEFAULT 'pending'
                                 CHECK(status IN ('pending','answered','expired')),
    answer_data              TEXT,
    created_at               TEXT NOT NULL DEFAULT (datetime('now')),
    answered_at              TEXT,
    deadline                 TEXT
);

CREATE TABLE IF NOT EXISTS ws_events (
    id             TEXT PRIMARY KEY,
    session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    participant_id TEXT,
    event_type     TEXT NOT NULL,
    payload        TEXT NOT NULL,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_participants_session ON participants(session_id);
CREATE INDEX IF NOT EXISTS idx_participants_token   ON participants(token);
CREATE INDEX IF NOT EXISTS idx_questions_session    ON questions(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_code        ON sessions(code);
CREATE INDEX IF NOT EXISTS idx_ws_events_session    ON ws_events(session_id);
CREATE INDEX IF NOT EXISTS idx_ws_events_type       ON ws_events(session_id, event_type);
`;

interface Migration {
    version: number;
    up: (db: Database.Database) => void;
}

const MIGRATIONS: Migration[] = [
    {
        // v2: deadline column + 'expired' status on questions
        version: 2,
        up: (db) => {
            const cols = columnNames(db, "questions");
            if (!cols.includes("deadline")) {
                db.pragma("foreign_keys = OFF");
                db.exec(`
                    BEGIN;

                    CREATE TABLE questions_v2 (
                        id                        TEXT PRIMARY KEY,
                        session_id                TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                        created_by_participant_id TEXT NOT NULL REFERENCES participants(id),
                        type                      TEXT NOT NULL,
                        data                      TEXT NOT NULL,
                        status                    TEXT NOT NULL DEFAULT 'pending'
                                                      CHECK(status IN ('pending','answered','expired')),
                        answer_data               TEXT,
                        created_at                TEXT NOT NULL DEFAULT (datetime('now')),
                        answered_at               TEXT,
                        deadline                  TEXT
                    );

                    INSERT INTO questions_v2
                        (id, session_id, created_by_participant_id, type, data, status,
                         answer_data, created_at, answered_at, deadline)
                    SELECT
                        id, session_id, created_by_participant_id, type, data, status,
                        answer_data, created_at, answered_at, NULL
                    FROM questions;

                    DROP TABLE questions;
                    ALTER TABLE questions_v2 RENAME TO questions;

                    CREATE INDEX IF NOT EXISTS idx_questions_session ON questions(session_id);

                    COMMIT;
                `);
                db.pragma("foreign_keys = ON");
            }
        },
    },
    {
        // v3: answered_by_participant_id column on questions
        version: 3,
        up: (db) => {
            const cols = columnNames(db, "questions");
            if (!cols.includes("answered_by_participant_id")) {
                db.exec("ALTER TABLE questions ADD COLUMN answered_by_participant_id TEXT");
            }
        },
    },
    {
        // v4: push_token column on participants
        version: 4,
        up: (db) => {
            const cols = columnNames(db, "participants");
            if (!cols.includes("push_token")) {
                db.exec("ALTER TABLE participants ADD COLUMN push_token TEXT");
            }
        },
    },
    {
        // v5: hiding_zone column on sessions
        version: 5,
        up: (db) => {
            const cols = columnNames(db, "sessions");
            if (!cols.includes("hiding_zone")) {
                db.exec("ALTER TABLE sessions ADD COLUMN hiding_zone TEXT");
            }
        },
    },
    {
        // v6: game_size column on sessions
        version: 6,
        up: (db) => {
            const cols = columnNames(db, "sessions");
            if (!cols.includes("game_size")) {
                db.exec("ALTER TABLE sessions ADD COLUMN game_size TEXT");
            }
        },
    },
    /* add future migrations here, in ascending version order */
];

export function runMigrations(db: Database.Database): void {
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
