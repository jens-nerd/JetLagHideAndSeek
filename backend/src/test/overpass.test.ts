/**
 * Unit test for the /api/overpass proxy.
 *
 * We care about one invariant: outbound requests to upstream Overpass mirrors
 * must carry a non-default User-Agent. overpass-api.de's Apache returns 406
 * Not Acceptable to Node's default `User-Agent: node`, which silently degrades
 * the whole "pick a play area" flow — the frontend can't load boundaries, so
 * no game-area polygon is ever drawn.
 *
 * The test mocks `globalThis.fetch` so we don't actually hit Overpass.
 */
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createOverpassRouter } from "../routes/overpass.js";

function makeOverpassApp(): Hono {
    const app = new Hono();
    app.route("/api", createOverpassRouter());
    return app;
}

describe("overpass proxy", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("sends a non-default User-Agent on outbound Overpass requests", async () => {
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValue(
                new Response(
                    JSON.stringify({ elements: [], version: 0.6 }),
                    { status: 200, headers: { "Content-Type": "application/json" } },
                ),
            );

        const app = makeOverpassApp();
        const res = await app.request("/api/overpass", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: '[out:json];relation["name"="Hamburg"]["boundary"="administrative"];out geom;',
            }),
        });

        expect(res.status).toBe(200);
        expect(fetchSpy).toHaveBeenCalled();

        const [, init] = fetchSpy.mock.calls[0];
        const headers = init?.headers as Record<string, string>;
        expect(headers).toBeDefined();
        const ua = headers["User-Agent"] ?? headers["user-agent"];
        expect(ua).toBeTruthy();
        // Must not be the default Node UA (which Apache rejects with 406).
        expect(ua).not.toBe("node");
        expect(ua.toLowerCase()).not.toBe("node-fetch");
        // Should identify this project so Overpass operators can reach us.
        expect(ua).toMatch(/JetLag/i);
    });

    it("tries the next endpoint if the primary returns a non-retryable error", async () => {
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            // Primary (overpass-api.de) returns 406 — non-retryable, fall through.
            .mockResolvedValueOnce(new Response("Not Acceptable", { status: 406 }))
            // Secondary (kumi.systems) succeeds.
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({ elements: [{ id: 1 }], version: 0.6 }),
                    { status: 200, headers: { "Content-Type": "application/json" } },
                ),
            );

        const app = makeOverpassApp();
        const res = await app.request("/api/overpass", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: "[out:json];out;" }),
        });

        expect(res.status).toBe(200);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        const [firstUrl] = fetchSpy.mock.calls[0];
        const [secondUrl] = fetchSpy.mock.calls[1];
        expect(String(firstUrl)).toContain("overpass-api.de");
        expect(String(secondUrl)).not.toContain("overpass-api.de");
    });
});
