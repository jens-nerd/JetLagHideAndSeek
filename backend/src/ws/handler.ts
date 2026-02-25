import type { ClientToServerEvent } from "@hideandseek/shared";
import { eq } from "drizzle-orm";
import type { WSContext } from "hono/ws";
import { nanoid } from "nanoid";

import { db, schema } from "../db/index.js";
import { toSessionQuestion } from "../routes/sessions.js";
import { type ConnectedClient, wsManager } from "./manager.js";

/**
 * Called when a new WebSocket connection is established.
 *
 * Expected URL: /ws/:code?token=<participantToken>
 */
export async function handleWsOpen(
    ws: WSContext,
    sessionCode: string,
    token: string | null,
): Promise<ConnectedClient | null> {
    const code = sessionCode.toUpperCase();

    const sessionRow = await db.query.sessions.findFirst({
        where: eq(schema.sessions.code, code),
    });

    if (!sessionRow || sessionRow.status === "finished") {
        ws.close(4404, "Session not found or finished");
        return null;
    }

    if (!token) {
        ws.close(4401, "Missing token");
        return null;
    }

    const participant = await db.query.participants.findFirst({
        where: (p, { and, eq: eq_ }) =>
            and(eq_(p.token, token), eq_(p.sessionId, sessionRow.id)),
    });

    if (!participant) {
        ws.close(4403, "Invalid token");
        return null;
    }

    const client: ConnectedClient = {
        ws,
        sessionCode: code,
        participantId: participant.id,
        role: participant.role as "hider" | "seeker",
    };

    wsManager.register(client);

    // Notify others that someone joined
    wsManager.broadcast(
        code,
        {
            type: "participant_joined",
            participantId: participant.id,
            role: participant.role as "hider" | "seeker",
            displayName: participant.displayName,
        },
        client, // exclude the joining client itself
    );

    // Send current state to the newly connected client
    const questionRows = await db.query.questions.findMany({
        where: eq(schema.questions.sessionId, sessionRow.id),
        orderBy: (q, { asc }) => [asc(q.createdAt)],
    });

    ws.send(
        JSON.stringify({
            type: "sync",
            questions: questionRows.map(toSessionQuestion),
            mapLocation: sessionRow.mapLocation
                ? JSON.parse(sessionRow.mapLocation)
                : null,
            status: sessionRow.status,
            seekerCount: wsManager.seekerCount(code),
            hiderConnected: wsManager.hiderConnected(code),
        }),
    );

    return client;
}

/**
 * Called for each incoming WebSocket message from a client.
 */
export async function handleWsMessage(
    client: ConnectedClient,
    rawData: string | ArrayBuffer,
): Promise<void> {
    let event: ClientToServerEvent;
    try {
        event = JSON.parse(
            typeof rawData === "string" ? rawData : new TextDecoder().decode(rawData),
        ) as ClientToServerEvent;
    } catch {
        return; // Ignore malformed messages
    }

    const code = client.sessionCode;

    switch (event.type) {
        case "ping":
            client.ws.send(JSON.stringify({ type: "pong" }));
            break;

        case "add_question": {
            if (client.role !== "seeker") return;

            const sessionRow = await db.query.sessions.findFirst({
                where: eq(schema.sessions.code, code),
            });
            if (!sessionRow || sessionRow.status === "finished") return;

            const questionId = nanoid();
            await db.insert(schema.questions).values({
                id: questionId,
                sessionId: sessionRow.id,
                createdByParticipantId: client.participantId,
                type: event.questionType,
                data: JSON.stringify(event.data),
                status: "pending",
            });

            const questionRow = (await db.query.questions.findFirst({
                where: eq(schema.questions.id, questionId),
            }))!;

            wsManager.broadcast(code, {
                type: "question_added",
                question: toSessionQuestion(questionRow),
            });
            break;
        }

        case "answer_question": {
            if (client.role !== "hider") return;

            const questionRow = await db.query.questions.findFirst({
                where: eq(schema.questions.id, event.questionId),
            });
            if (!questionRow || questionRow.status === "answered") return;
            if (questionRow.sessionId !== (await getSessionId(code))) return;

            const answeredAt = new Date().toISOString();
            await db
                .update(schema.questions)
                .set({
                    status: "answered",
                    answerData: JSON.stringify(event.answerData),
                    answeredAt,
                })
                .where(eq(schema.questions.id, event.questionId));

            const updatedRow = (await db.query.questions.findFirst({
                where: eq(schema.questions.id, event.questionId),
            }))!;

            wsManager.broadcast(code, {
                type: "question_answered",
                question: toSessionQuestion(updatedRow),
            });
            break;
        }

        case "update_map_location": {
            const sessionRow = await db.query.sessions.findFirst({
                where: eq(schema.sessions.code, code),
            });
            if (!sessionRow) return;

            await db
                .update(schema.sessions)
                .set({ mapLocation: JSON.stringify(event.mapLocation) })
                .where(eq(schema.sessions.id, sessionRow.id));

            wsManager.broadcast(
                code,
                {
                    type: "map_location_updated",
                    mapLocation: event.mapLocation,
                },
                client,
            );
            break;
        }

        case "set_status": {
            if (client.role !== "seeker") return;

            const sessionRow = await db.query.sessions.findFirst({
                where: eq(schema.sessions.code, code),
            });
            if (!sessionRow) return;
            if (sessionRow.status === "finished") return;

            await db
                .update(schema.sessions)
                .set({ status: event.status })
                .where(eq(schema.sessions.id, sessionRow.id));

            wsManager.broadcast(code, {
                type: "session_status_changed",
                status: event.status,
            });
            break;
        }
    }
}

/** Called when a WebSocket connection closes */
export function handleWsClose(client: ConnectedClient): void {
    wsManager.unregister(client);
    wsManager.broadcast(client.sessionCode, {
        type: "participant_left",
        participantId: client.participantId,
    });
}

async function getSessionId(code: string): Promise<string | null> {
    const row = await db.query.sessions.findFirst({
        where: eq(schema.sessions.code, code),
    });
    return row?.id ?? null;
}
