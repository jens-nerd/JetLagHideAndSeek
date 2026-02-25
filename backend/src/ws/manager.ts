import type { ServerToClientEvent } from "@hideandseek/shared";
import type { WSContext } from "hono/ws";
import { nanoid } from "nanoid";

import { wsEvents } from "../db/schema.js";
import type { Db } from "../db/types.js";

interface ConnectedClient {
    ws: WSContext;
    sessionCode: string;
    /** DB primary key of the session — used for event logging. */
    sessionId: string;
    participantId: string;
    role: "hider" | "seeker";
}

/**
 * In-memory registry of all open WebSocket connections, keyed by session code.
 * On a single-server VPS this is sufficient; for multi-instance deployments
 * this would need to be replaced with a pub/sub layer (e.g. Redis).
 */
class WebSocketManager {
    /** sessionCode → Set of clients */
    private rooms = new Map<string, Set<ConnectedClient>>();

    register(client: ConnectedClient): void {
        if (!this.rooms.has(client.sessionCode)) {
            this.rooms.set(client.sessionCode, new Set());
        }
        this.rooms.get(client.sessionCode)!.add(client);
    }

    unregister(client: ConnectedClient): void {
        const room = this.rooms.get(client.sessionCode);
        if (!room) return;
        room.delete(client);
        if (room.size === 0) {
            this.rooms.delete(client.sessionCode);
        }
    }

    /** Broadcast an event to every client in a session (optionally exclude one) */
    broadcast(
        sessionCode: string,
        event: ServerToClientEvent,
        exclude?: ConnectedClient,
    ): void {
        const room = this.rooms.get(sessionCode);
        if (!room) return;
        const payload = JSON.stringify(event);
        for (const client of room) {
            if (client === exclude) continue;
            try {
                client.ws.send(payload);
            } catch {
                // Client disconnected mid-send; will be cleaned up on close
            }
        }
    }

    /** Send an event to a single participant (by id) */
    sendToParticipant(
        sessionCode: string,
        participantId: string,
        event: ServerToClientEvent,
    ): void {
        const room = this.rooms.get(sessionCode);
        if (!room) return;
        const payload = JSON.stringify(event);
        for (const client of room) {
            if (client.participantId === participantId) {
                try {
                    client.ws.send(payload);
                } catch {
                    // ignore
                }
            }
        }
    }

    /** Send an event to all clients with a given role in a session */
    sendToRole(
        sessionCode: string,
        role: "hider" | "seeker",
        event: ServerToClientEvent,
    ): void {
        const room = this.rooms.get(sessionCode);
        if (!room) return;
        const payload = JSON.stringify(event);
        for (const client of room) {
            if (client.role === role) {
                try {
                    client.ws.send(payload);
                } catch {
                    // ignore
                }
            }
        }
    }

    getRoom(sessionCode: string): Set<ConnectedClient> | undefined {
        return this.rooms.get(sessionCode);
    }

    /**
     * Append a ServerToClientEvent to the ws_events audit log.
     * Fire-and-forget: errors are swallowed so logging never breaks the WS flow.
     * The `sync` event is intentionally skipped — it is derived state, not a
     * discrete action.
     */
    async persistEvent(
        db: Db,
        sessionId: string,
        participantId: string | null,
        event: ServerToClientEvent,
    ): Promise<void> {
        if (event.type === "sync") return;
        try {
            await db.insert(wsEvents).values({
                id: nanoid(),
                sessionId,
                participantId: participantId ?? undefined,
                eventType: event.type,
                payload: JSON.stringify(event),
            });
        } catch (err) {
            console.error("[ws] Failed to persist event:", (err as Error).message);
        }
    }

    seekerCount(sessionCode: string): number {
        const room = this.rooms.get(sessionCode);
        if (!room) return 0;
        return [...room].filter((c) => c.role === "seeker").length;
    }

    hiderConnected(sessionCode: string): boolean {
        const room = this.rooms.get(sessionCode);
        if (!room) return false;
        return [...room].some((c) => c.role === "hider");
    }
}

export const wsManager = new WebSocketManager();
export type { ConnectedClient };
