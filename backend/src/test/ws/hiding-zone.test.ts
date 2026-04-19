import { describe, expect, it } from "vitest";

import { seedSession, withTestApp } from "../helpers.js";

describe("hiding zone WS — pre-reveal filter", () => {
    it("seeker sync returns hidingZone: null while the zone is unrevealed", async () => {
        await withTestApp(async ({ app, makeWsClient }) => {
            const { code, hider, seeker } = await seedSession(app);

            const hiderWs = await makeWsClient(code, hider.token);
            hiderWs.send({
                type: "set_hiding_zone",
                stationName: "Hauptbahnhof",
                lat: 52.525,
                lng: 13.369,
                radius: 500,
                radiusUnit: "meters",
            });
            await hiderWs.waitFor(
                (m) => m.type === "hiding_zone_updated",
            );

            const seekerWs = await makeWsClient(code, seeker.token);
            const sync = await seekerWs.waitFor((m) => m.type === "sync");

            expect(sync.hidingZone).toBeNull();
        });
    });
});
