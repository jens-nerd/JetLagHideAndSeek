import { serve } from "@hono/node-server";
import { and, eq, isNotNull } from "drizzle-orm";

import { createApp } from "./app.js";
import { db, schema } from "./db/index.js";
import { scheduleExpiry } from "./ws/handler.js";
import { attachWsServer } from "./ws/attach.js";

const app = createApp(db);

// ── Recover pending questions whose deadline has passed (after restart) ───────

async function recoverExpiryTimers(): Promise<void> {
    const pendingQuestions = await db.query.questions.findMany({
        where: and(
            eq(schema.questions.status, "pending"),
            isNotNull(schema.questions.deadline),
        ),
    });

    let expiredCount = 0;
    let rescheduledCount = 0;

    for (const q of pendingQuestions) {
        const deadlineMs = new Date(q.deadline!).getTime();

        if (deadlineMs <= Date.now()) {
            // Deadline already passed — mark as expired immediately
            await db
                .update(schema.questions)
                .set({ status: "expired" })
                .where(eq(schema.questions.id, q.id));
            expiredCount++;
        } else {
            // Deadline still in the future — re-schedule the timer
            const session = await db.query.sessions.findFirst({
                where: eq(schema.sessions.id, q.sessionId),
            });
            if (session) {
                scheduleExpiry(q.id, session.code, session.id, deadlineMs, db);
                rescheduledCount++;
            }
        }
    }

    if (expiredCount > 0 || rescheduledCount > 0) {
        console.log(
            `Expiry recovery: ${expiredCount} question(s) marked expired, ${rescheduledCount} timer(s) rescheduled`,
        );
    }
}

// ── Start server ──────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3001);

// Start Hono's HTTP server and get the underlying Node.js server back
const server = serve(
    { fetch: app.fetch, port: PORT, hostname: "0.0.0.0" },
    (info) => {
        console.log(
            `Backend (HTTP + WebSocket) running on http://localhost:${info.port}`,
        );
        // Recover any pending questions whose deadline passed while the server was down
        recoverExpiryTimers().catch((err) =>
            console.error("Expiry recovery failed:", err),
        );
    },
);

// ── WebSocket ─────────────────────────────────────────────────────────────────

attachWsServer(server);
