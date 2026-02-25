import { z } from "zod";

// ── Session ──────────────────────────────────────────────────────────────────

export const sessionStatusSchema = z.enum(["waiting", "active", "finished"]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const roleSchema = z.enum(["hider", "seeker"]);
export type Role = z.infer<typeof roleSchema>;

export interface Session {
    id: string;
    code: string;
    status: SessionStatus;
    mapLocation: MapLocation | null;
    createdAt: string;
    expiresAt: string;
}

export interface MapLocation {
    lat: number;
    lng: number;
    name: string;
    /** Full OSM Feature object (for map boundary computation) */
    osmFeature?: unknown;
}

// ── Participant ───────────────────────────────────────────────────────────────

export interface Participant {
    id: string;
    sessionId: string;
    role: Role;
    displayName: string;
    joinedAt: string;
}

/** Returned only to the joining participant – never broadcast */
export interface ParticipantWithToken extends Participant {
    token: string;
}

// ── Question ──────────────────────────────────────────────────────────────────

export const questionStatusSchema = z.enum(["pending", "answered"]);
export type QuestionStatus = z.infer<typeof questionStatusSchema>;

/**
 * QuestionData mirrors the existing frontend Question type from schema.ts.
 * We keep it as `unknown` here so shared/ has no dependency on the full
 * frontend schema logic; each side validates with its own Zod schemas.
 */
export interface SessionQuestion {
    id: string;
    sessionId: string;
    createdByParticipantId: string;
    /** Question type: "radius" | "thermometer" | "tentacles" | "matching" | "measuring" */
    type: string;
    /** Raw question data – matches the frontend Question schema */
    data: unknown;
    status: QuestionStatus;
    /** Present once the hider has answered */
    answerData?: unknown;
    createdAt: string;
    answeredAt?: string;
}

// ── HTTP request / response bodies ───────────────────────────────────────────

export interface CreateSessionRequest {
    displayName: string;
    mapLocation?: MapLocation;
}

export interface CreateSessionResponse {
    session: Session;
    participant: ParticipantWithToken;
}

export interface JoinSessionRequest {
    displayName: string;
}

export interface JoinSessionResponse {
    session: Session;
    participant: ParticipantWithToken;
}

export interface GetSessionResponse {
    session: Session;
    questions: SessionQuestion[];
    /** Number of seekers currently connected */
    seekerCount: number;
    /** Whether the hider is connected */
    hiderConnected: boolean;
}

export interface AddQuestionRequest {
    /** Question type */
    type: string;
    /** Raw question data from frontend schema */
    data: unknown;
}

export interface AddQuestionResponse {
    question: SessionQuestion;
}

export interface AnswerQuestionRequest {
    /** Modified question data after GPS-based computation */
    answerData: unknown;
}

export interface AnswerQuestionResponse {
    question: SessionQuestion;
}

export interface UpdateMapLocationRequest {
    mapLocation: MapLocation;
}
