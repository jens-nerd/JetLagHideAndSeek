import { describe, expect, it } from "vitest";

import { seedSession, withTestApp } from "../helpers.js";

describe("WS test harness", () => {
    it("boots an HTTP+WS server and seeds a two-role session", async () => {
        await withTestApp(async ({ app, makeWsClient }) => {
            const { code, hider, seeker } = await seedSession(app);
            const ws = await makeWsClient(code, hider.token);
            expect(ws).toBeTruthy();
            ws.close();
            expect(seeker.token).toBeTruthy();
        });
    });
});
