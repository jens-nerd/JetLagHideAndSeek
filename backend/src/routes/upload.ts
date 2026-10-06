/**
 * Image upload endpoint.
 *
 * Accepts a multipart/form-data POST with an `image` field,
 * saves the file to the uploads directory, and returns the URL.
 *
 * Die Route verlangt ein gültiges Teilnehmer-Token. Ohne diese Prüfung konnte
 * jeder aus dem Internet beliebige Dateien auf die Platte legen, die nginx
 * anschließend unter der Domäne ausliefert.
 */
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { schema } from "../db/schema.js";
import type { Db } from "../db/types.js";

const UPLOADS_DIR = process.env.UPLOADS_DIR ?? join(process.cwd(), "uploads");
// 10 MB, weil ein Telefonfoto die alten 5 MB reißt. Der Deckel hängt an der
// nginx-Site: `client_max_body_size` in `location /api/` muss über dem Rumpf
// einer Anfrage liegen, also über Datei plus Multipart-Rahmen. Bei 10m weist
// nginx eine 10-MB-Datei mit eigener HTML-Seite ab, bevor das Backend sie
// sieht; der Wert dort muss 11m sein.
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

// Ensure uploads directory exists
mkdir(UPLOADS_DIR, { recursive: true }).catch(() => {});

export function createUploadRouter(db: Db): Hono {
    const router = new Hono();

    router.post("/upload", async (c) => {
        const token = c.req.header("x-participant-token");
        if (!token) return c.json({ error: "Missing token" }, 401);

        // participants.token ist global eindeutig (siehe db/schema.ts), die
        // Sitzung muss deshalb nicht mitgeschickt werden. Das hält die Adresse
        // der Route unverändert; der Aufrufer ergänzt nur den Kopfeintrag.
        const participant = await db.query.participants.findFirst({
            where: eq(schema.participants.token, token),
        });
        if (!participant) return c.json({ error: "Invalid token" }, 403);

        const contentType = c.req.header("content-type") ?? "";
        if (!contentType.includes("multipart/form-data")) {
            return c.json({ error: "Expected multipart/form-data" }, 400);
        }

        const body = await c.req.parseBody();
        const file = body.image;

        if (!file || !(file instanceof File)) {
            return c.json({ error: "Missing 'image' field" }, 400);
        }

        if (file.size > MAX_SIZE) {
            // Code statt Satz, wie bei allen anderen Fehlern des Projekts: der
            // englische Satz stand vorher unverändert im Toast, weil
            // toTypedError die Serverantwort wörtlich als Meldung nimmt.
            return c.json({ error: "file_too_large" }, 413);
        }

        // Determine extension from MIME type
        const ext = file.type === "image/png" ? ".png"
            : file.type === "image/webp" ? ".webp"
            : file.type === "image/gif" ? ".gif"
            : ".jpg";

        const filename = `${randomUUID()}${ext}`;
        const filepath = join(UPLOADS_DIR, filename);

        const buffer = Buffer.from(await file.arrayBuffer());
        await writeFile(filepath, buffer);

        return c.json({ url: `/uploads/${filename}` });
    });

    return router;
}
