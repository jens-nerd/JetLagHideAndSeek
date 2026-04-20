import { describe, expect, it } from "vitest";

import { seedSession, withTestApp, req } from "../helpers.js";
import { sessions } from "../../db/schema.js";

describe("hiding zone WS", () => {
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

    it("seeker calling set_hiding_zone is silently ignored", async () => {
        await withTestApp(async ({ app, makeWsClient, db }) => {
            const { code, hider, seeker } = await seedSession(app);

            const seekerWs = await makeWsClient(code, seeker.token);
            await seekerWs.waitFor((m) => m.type === "sync");

            seekerWs.send({
                type: "set_hiding_zone",
                stationName: "Forbidden",
                lat: 0,
                lng: 0,
                radius: 100,
                radiusUnit: "meters",
            });

            // Give the server a tick to (not) process
            await new Promise((r) => setTimeout(r, 100));

            const row = db
                .select()
                .from(sessions)
                .all()
                .find((s) => s.code === code);
            expect(row?.hidingZone).toBeNull();

            // And a subsequent hider connect still gets nothing
            const hiderWs = await makeWsClient(code, hider.token);
            const sync = await hiderWs.waitFor((m) => m.type === "sync");
            expect(sync.hidingZone).toBeNull();
        });
    });

    it("seeker joining after reveal receives zone via sync", async () => {
        await withTestApp(async ({ app, makeWsClient }) => {
            const { code, hider } = await seedSession(app);

            const hiderWs = await makeWsClient(code, hider.token);
            hiderWs.send({
                type: "set_hiding_zone",
                stationName: "Hauptbahnhof",
                lat: 52.525,
                lng: 13.369,
                radius: 500,
                radiusUnit: "meters",
            });
            await hiderWs.waitFor((m) => m.type === "hiding_zone_updated");

            hiderWs.send({ type: "reveal_hiding_zone" });
            await hiderWs.waitFor(
                (m) =>
                    m.type === "hiding_zone_updated" &&
                    (m as any).hidingZone?.revealed === true,
            );

            // Add a *new* seeker AFTER reveal
            const secondSeeker = await req<{ session: { code: string }; participant: { id: string; token: string } }>(
                app,
                "POST",
                `/api/sessions/${code}/join`,
                {
                    body: { role: "seeker", displayName: "Carol" },
                    expectStatus: 201,
                },
            );

            const seekerWs = await makeWsClient(code, secondSeeker.body.participant.token);
            const sync = await seekerWs.waitFor((m) => m.type === "sync");
            expect(sync.hidingZone).toBeTruthy();
            expect(sync.hidingZone.stationName).toBe("Hauptbahnhof");
            expect(sync.hidingZone.revealed).toBe(true);
        });
    });
});
