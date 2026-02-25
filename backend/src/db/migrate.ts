/**
 * Creates all tables if they don't exist yet.
 * Run once on first deploy: pnpm db:migrate
 */
import Database from "better-sqlite3";

const DB_PATH = process.env.DB_PATH ?? "./hideandseek.db";
const sqlite = new Database(DB_PATH);

sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

sqlite.exec(`
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
                                 CHECK(status IN ('pending','answered')),
    answer_data              TEXT,
    created_at               TEXT NOT NULL DEFAULT (datetime('now')),
    answered_at              TEXT
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
`);

console.log("Database migrated successfully:", DB_PATH);
sqlite.close();
