/**
 * Image upload endpoint.
 *
 * Accepts a multipart/form-data POST with an `image` field,
 * saves the file to the uploads directory, and returns the URL.
 */
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";

const UPLOADS_DIR = process.env.UPLOADS_DIR ?? join(process.cwd(), "uploads");
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

// Ensure uploads directory exists
mkdir(UPLOADS_DIR, { recursive: true }).catch(() => {});

export function createUploadRouter(): Hono {
    const router = new Hono();

    router.post("/upload", async (c) => {
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
            return c.json({ error: "File too large (max 5 MB)" }, 413);
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
