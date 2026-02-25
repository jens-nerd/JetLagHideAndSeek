import { parse } from "node:url";

import { serve } from "@hono/node-server";
import { WebSocket, WebSocketServer } from "ws";

import { createApp } from "./app.js";
import { db } from "./db/index.js";
import { handleWsClose, handleWsMessage, handleWsOpen } from "./ws/handler.js";
import type { ConnectedClient } from "./ws/manager.js";

const app = createApp(db);

// ── Start server ──────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3001);

// Start Hono's HTTP server and get the underlying Node.js server back
const server = serve(
    { fetch: app.fetch, port: PORT },
    (info) => {
        console.log(
            `Backend (HTTP + WebSocket) running on http://localhost:${info.port}`,
        );
    },
);

// ── WebSocket ─────────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });

/**
 * Intercept HTTP → WebSocket upgrades on the same server.
 * URL pattern: /ws/:code?token=<participantToken>
 */
server.on("upgrade", (request, socket, head) => {
    const parsed = parse(request.url ?? "", true);
    const pathname = parsed.pathname ?? "";

    if (!pathname.startsWith("/ws/")) {
        socket.destroy();
        return;
    }

    const sessionCode = pathname.slice(4); // strip leading "/ws/"
    const token = (parsed.query.token as string) ?? null;

    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, sessionCode, token);
    });
});

wss.on(
    "connection",
    async (ws: WebSocket, sessionCode: string, token: string | null) => {
        // Wrap native ws so it matches the WSContext interface in manager.ts
        const wsCtx = {
            send: (data: string) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(data);
                }
            },
            close: (code?: number, reason?: string) => ws.close(code, reason),
        };

        const client: ConnectedClient | null = await handleWsOpen(
            wsCtx as any,
            sessionCode,
            token,
        );

        ws.on("message", async (data: Buffer) => {
            if (!client) return;
            await handleWsMessage(client, data.toString());
        });

        ws.on("close", () => {
            if (client) handleWsClose(client);
        });

        ws.on("error", (err) => {
            console.error("WebSocket client error:", err);
        });
    },
);
