/**
 * Integration tests for the Uploads REST API.
 *
 * Covers /api/upload (photo upload endpoint).
 *
 * Die Route stand bis zur Sicherheitslesung vom 20.09.2026 ohne jede
 * Anmeldung offen: jeder aus dem Internet konnte Dateien auf die Platte legen,
 * die nginx anschließend unter der Domäne ausliefert. Die Tests unten halten
 * fest, dass ein Teilnehmer-Token nötig ist und dass ein gültiges weiterhin
 * durchgeht.
 *
 * Run (in-process):
 *   pnpm --filter @hideandseek/backend test
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestApp, createTestDb, seedSession } from "../helpers.js";

/** Ein winziges, gültiges PNG (1x1 Pixel, transparent). */
const PNG_1X1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
);

function bildAnfrage(token?: string): RequestInit {
    const form = new FormData();
    form.append("image", new File([PNG_1X1], "foto.png", { type: "image/png" }));
    return {
        method: "POST",
        body: form,
        ...(token ? { headers: { "x-participant-token": token } } : {}),
    };
}

describe("Uploads", () => {
    let app: Hono;

    beforeEach(() => {
        app = createTestApp(createTestDb());
    });

    it("weist einen Upload ohne Token mit 401 ab", async () => {
        const res = await app.request("/api/upload", bildAnfrage());
        expect(res.status).toBe(401);
    });

    it("weist einen Upload mit unbekanntem Token mit 403 ab", async () => {
        const res = await app.request("/api/upload", bildAnfrage("frei-erfunden"));
        expect(res.status).toBe(403);
    });

    it("nimmt einen Upload mit gültigem Teilnehmer-Token an", async () => {
        const { hider } = await seedSession(app);

        const res = await app.request("/api/upload", bildAnfrage(hider.token));
        expect(res.status).toBe(200);

        const { url } = (await res.json()) as { url: string };
        expect(url).toMatch(/^\/uploads\/[0-9a-f-]{36}\.png$/);

        // Die Datei muss wirklich geschrieben worden sein, sonst wäre die
        // Foto-Antwort nach dem Deploy still kaputt.
        const abgelegt = await readFile(
            join(process.env.UPLOADS_DIR!, url.replace("/uploads/", "")),
        );
        expect(abgelegt.equals(PNG_1X1)).toBe(true);
    });

    it("nimmt auch das Token eines Suchenden an", async () => {
        // Geprüft wird die Zugehörigkeit zu einer Sitzung, nicht die Rolle.
        // Absichtlich so: die Anmeldepflicht soll das Loch schließen, nicht
        // nebenbei festlegen, wer Fotos hochladen darf.
        const { seeker } = await seedSession(app);
        const res = await app.request("/api/upload", bildAnfrage(seeker.token));
        expect(res.status).toBe(200);
    });
});
