import { parse } from "node:url";
import type { Server } from "node:http";

import type { ServerType } from "@hono/node-server";
import { WebSocket, WebSocketServer } from "ws";

import { handleWsClose, handleWsMessage, handleWsOpen } from "./handler.js";
import type { ConnectedClient } from "./manager.js";

/**
 * Attach a WebSocketServer to an existing HTTP server, handling the
 * `/ws/:code?token=…` upgrade pattern. Returns the wss so callers can close it.
 * Extracted from index.ts so tests can reuse the same wiring.
 *
 * Accepts either a plain `http.Server` (used in tests) or the `ServerType`
 * returned by `@hono/node-server`'s `serve()` (used in production). The HTTP
 * "upgrade" event is only emitted by HTTP/1 servers, so we cast to `Server`
 * for the listener registration.
 */
export function attachWsServer(server: Server | ServerType): WebSocketServer {
    const httpServer = server as Server;
    const wss = new WebSocketServer({ noServer: true });

    httpServer.on("upgrade", (request, socket, head) => {
        const parsed = parse(request.url ?? "", true);
        const pathname = parsed.pathname ?? "";
        if (!pathname.startsWith("/ws/")) {
            socket.destroy();
            return;
        }
        const sessionCode = pathname.slice(4);
        const token = (parsed.query.token as string) ?? null;
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit("connection", ws, sessionCode, token);
        });
    });

    wss.on(
        "connection",
        async (ws: WebSocket, sessionCode: string, token: string | null) => {
            const wsCtx = {
                send: (data: string) => {
                    if (ws.readyState === WebSocket.OPEN) ws.send(data);
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

    return wss;
}
