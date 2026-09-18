/**
 * Unit test for the Overpass fallback inside /api/poi/nearest.
 *
 * Same invariant as the /api/overpass proxy: outbound requests to upstream
 * Overpass mirrors must carry a non-default User-Agent. overpass-api.de's
 * Apache answers Node's default `User-Agent: node` with 406 Not Acceptable,
 * so every endpoint in the list runs into its 60s timeout and the route
 * finally returns 502 — after two minutes of waiting.
 *
 * The proxy route got this right in f881f06; poi.ts did not, which stayed
 * invisible as long as HERE served the same categories.
 *
 * The test mocks `globalThis.fetch` so we don't actually hit Overpass.
 */
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPoiRouter } from "../routes/poi.js";

function makePoiApp(): Hono {
    const app = new Hono();
    app.route("/api", createPoiRouter());
    return app;
}

/** A category HERE does not cover, so the route always takes the Overpass path. */
const OVERPASS_ONLY_CATEGORY = "mcdonalds";

describe("poi nearest — Overpass fallback", () => {
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

        const app = makePoiApp();
        const res = await app.request("/api/poi/nearest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                lat: 53.5511,
                lng: 9.9937,
                category: OVERPASS_ONLY_CATEGORY,
                radiusM: 1234,
            }),
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ source: "overpass" });
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

    it("sends the User-Agent on the retry as well", async () => {
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            // 429 is retryable — the helper waits and repeats against the same endpoint.
            .mockResolvedValueOnce(new Response("Too Many Requests", { status: 429 }))
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({ elements: [], version: 0.6 }),
                    { status: 200, headers: { "Content-Type": "application/json" } },
                ),
            );

        const app = makePoiApp();
        const res = await app.request("/api/poi/nearest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                lat: 53.5511,
                lng: 9.9937,
                category: OVERPASS_ONLY_CATEGORY,
                // Different radius than above, otherwise the module-level cache answers.
                radiusM: 2345,
            }),
        });

        expect(res.status).toBe(200);
        expect(fetchSpy).toHaveBeenCalledTimes(2);

        const [, retryInit] = fetchSpy.mock.calls[1];
        const retryHeaders = retryInit?.headers as Record<string, string>;
        const retryUa = retryHeaders["User-Agent"] ?? retryHeaders["user-agent"];
        expect(retryUa).toMatch(/JetLag/i);
    });
});
