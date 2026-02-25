import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    status: text("status", { enum: ["waiting", "active", "finished"] })
        .notNull()
        .default("waiting"),
    mapLocation: text("map_location"), // JSON
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
    status: text("status", { enum: ["pending", "answered"] })
        .notNull()
        .default("pending"),
    answerData: text("answer_data"), // JSON, set when answered
    createdAt: text("created_at")
        .notNull()
        .default(sql`(datetime('now'))`),
    answeredAt: text("answered_at"),
});

// Grouped schema object for convenience imports
export const schema = { sessions, participants, questions };

// Type helpers for Drizzle inference
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type DbParticipant = typeof participants.$inferSelect;
export type NewParticipant = typeof participants.$inferInsert;
export type DbQuestion = typeof questions.$inferSelect;
export type NewQuestion = typeof questions.$inferInsert;
