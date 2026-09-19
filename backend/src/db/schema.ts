import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    status: text("status", { enum: ["waiting", "active", "finished"] })
        .notNull()
        .default("waiting"),
    mapLocation: text("map_location"), // JSON
    hidingZone: text("hiding_zone"), // JSON: HidingZone | null
    gameSize: text("game_size"), // "S" | "M" | "L" | null
    /** Kartenmechanik für diese Sitzung eingeschaltet (0/1) */
    cardsEnabled: integer("cards_enabled", { mode: "boolean" })
        .notNull()
        .default(false),
    createdAt: text("created_at")
        .notNull()
        .default(sql`(datetime('now'))`),
    expiresAt: text("expires_at").notNull(),
});

export const participants = sqliteTable("participants", {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
        .notNull()
        .references(() => sessions.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["hider", "seeker"] }).notNull(),
    token: text("token").notNull().unique(),
    displayName: text("display_name").notNull(),
    joinedAt: text("joined_at")
        .notNull()
        .default(sql`(datetime('now'))`),
    /** Expo Push Token for push notifications (set from mobile app) */
    pushToken: text("push_token"),
});

export const questions = sqliteTable("questions", {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
        .notNull()
        .references(() => sessions.id, { onDelete: "cascade" }),
    createdByParticipantId: text("created_by_participant_id")
        .notNull()
        .references(() => participants.id),
    type: text("type").notNull(),
    data: text("data").notNull(), // JSON
    status: text("status", { enum: ["pending", "answered", "expired"] })
        .notNull()
        .default("pending"),
    answerData: text("answer_data"), // JSON, set when answered
    answeredByParticipantId: text("answered_by_participant_id"),
    createdAt: text("created_at")
        .notNull()
        .default(sql`(datetime('now'))`),
    answeredAt: text("answered_at"),
    /** ISO8601 timestamp after which the question expires (set at creation, 5 min window). */
    deadline: text("deadline"),
});

/**
 * Append-only log of every meaningful WebSocket event in a session.
 * Acts as an audit trail and enables future event-sourcing / replay.
 * The primary source of truth for game state remains the normalised
 * sessions / questions tables; this log is supplementary.
 */
export const wsEvents = sqliteTable("ws_events", {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
        .notNull()
        .references(() => sessions.id, { onDelete: "cascade" }),
    /** Which participant triggered the event (null for system events). */
    participantId: text("participant_id"),
    /** Matches ServerToClientEvent["type"] */
    eventType: text("event_type").notNull(),
    /** Full JSON payload of the ServerToClientEvent */
    payload: text("payload").notNull(),
    createdAt: text("created_at")
        .notNull()
        .default(sql`(datetime('now'))`),
});

/**
 * Ein Kartenexemplar im Deck einer Sitzung. Eine Zeile je Exemplar, nicht je
 * Sorte: ein Zeitbonus mit anzahl 13 erzeugt 13 Zeilen mit derselben card_id.
 * `position` ist die Mischreihenfolge; gezogen wird die kleinste Position
 * unter den Zeilen mit state = 'deck'.
 */
export const deckCards = sqliteTable("deck_cards", {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
        .notNull()
        .references(() => sessions.id, { onDelete: "cascade" }),
    /** Kennung in KARTEN (shared/src/karten.ts) */
    cardId: text("card_id").notNull(),
    position: integer("position").notNull(),
    state: text("state", {
        enum: ["deck", "angeboten", "hand", "ablage", "gespielt"],
    }).notNull(),
    /** Gesetzt, solange state = 'angeboten' */
    drawForQuestionId: text("draw_for_question_id"),
    updatedAt: text("updated_at")
        .notNull()
        .default(sql`(datetime('now'))`),
});

/** Ein ausgespielter Fluch. */
export const curses = sqliteTable("curses", {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
        .notNull()
        .references(() => sessions.id, { onDelete: "cascade" }),
    cardId: text("card_id").notNull(),
    playedByParticipantId: text("played_by_participant_id")
        .notNull()
        .references(() => participants.id),
    playedAt: text("played_at")
        .notNull()
        .default(sql`(datetime('now'))`),
    /** ISO8601, null bei einem Aufgabenfluch */
    expiresAt: text("expires_at"),
    endedAt: text("ended_at"),
    endedBy: text("ended_by", {
        enum: ["ablauf", "suchende", "versteckender"],
    }),
});

// Grouped schema object for convenience imports
export const schema = { sessions, participants, questions, wsEvents, deckCards, curses };

// Type helpers for Drizzle inference
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type DbParticipant = typeof participants.$inferSelect;
export type NewParticipant = typeof participants.$inferInsert;
export type DbQuestion = typeof questions.$inferSelect;
export type NewQuestion = typeof questions.$inferInsert;
export type WsEvent = typeof wsEvents.$inferSelect;
export type NewWsEvent = typeof wsEvents.$inferInsert;
export type DbDeckCard = typeof deckCards.$inferSelect;
export type NewDeckCard = typeof deckCards.$inferInsert;
export type DbCurse = typeof curses.$inferSelect;
export type NewCurse = typeof curses.$inferInsert;
