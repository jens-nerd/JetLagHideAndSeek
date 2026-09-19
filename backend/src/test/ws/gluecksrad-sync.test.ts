/**
 * Prüft, dass beide Rollen die vom Glücksrad gesperrte Kategorie erfahren —
 * beim Verbinden im sync und laufend über locked_category — und dass das
 * Rundenende alle laufenden Flüche beendet.
 */
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";

import { GLUECKSRAD_ID, KARTEN, kategorienFuerSpielgroesse } from "@hideandseek/shared";

import { schema } from "../../db/schema.js";
import { req, withTestApp } from "../helpers.js";

const GEHEIM = KARTEN.find((k) => k.geheim)!;

async function sitzung(app: any, gameSize: "S" | "M" | "L" = "M") {
    const { body: created } = await req<any>(app, "POST", "/api/sessions", {
        body: { displayName: "Hider Hans", gameSize, cardsEnabled: true },
        expectStatus: 201,
    });
    const code = created.session.code as string;
    const { body: joined } = await req<any>(
        app, "POST", `/api/sessions/${code}/join`,
        { body: { role: "seeker", displayName: "Sucher Sven" }, expectStatus: 201 },
    );
    return {
        code,
        sessionId: created.session.id as string,
        hiderToken: created.participant.token as string,
        seekerToken: joined.participant.token as string,
    };
}

/** Eine Karte auf die Hand legen und ausspielen. */
async function fluchSpielen(app: any, db: any, s: any, cardId: string): Promise<string> {
    const deckCardId = nanoid();
    await db.insert(schema.deckCards).values({
        id: deckCardId,
        sessionId: s.sessionId,
        cardId,
        position: 0,
        state: "hand",
    });
    const { body } = await req<any>(
        app, "POST", `/api/sessions/${s.code}/curses`,
        { body: { deckCardId }, token: s.hiderToken, expectStatus: 201 },
    );
    return body.curse.id as string;
}

describe("Glücksrad über WebSocket", () => {
    it("trägt die gesperrte Kategorie im sync an beide Rollen", async () => {
        await withTestApp(async ({ app, db, makeWsClient }) => {
            const s = await sitzung(app);
            const curseId = await fluchSpielen(app, db, s, GLUECKSRAD_ID);
            const row = await db.query.curses.findFirst({
                where: eq(schema.curses.id, curseId),
            });
            const kategorie = row!.gesperrteKategorie;

            const hider = await makeWsClient(s.code, s.hiderToken);
            const seeker = await makeWsClient(s.code, s.seekerToken);
            const hSync = await hider.waitFor((m) => m.type === "sync");
            const sSync = await seeker.waitFor((m) => m.type === "sync");

            expect(hSync.gesperrteKategorie).toBe(kategorie);
            expect(sSync.gesperrteKategorie).toBe(kategorie);
            expect(kategorienFuerSpielgroesse("M")).toContain(sSync.gesperrteKategorie);
        });
    });

    it("meldet ohne Glücksrad keine gesperrte Kategorie", async () => {
        await withTestApp(async ({ app, makeWsClient }) => {
            const s = await sitzung(app);
            const seeker = await makeWsClient(s.code, s.seekerToken);

            const sSync = await seeker.waitFor((m) => m.type === "sync");
            expect(sSync.gesperrteKategorie).toBeNull();
        });
    });

    it("verteilt locked_category nach einer gestellten Frage an beide Rollen", async () => {
        await withTestApp(async ({ app, db, makeWsClient }) => {
            const s = await sitzung(app);
            const curseId = await fluchSpielen(app, db, s, GLUECKSRAD_ID);

            const hider = await makeWsClient(s.code, s.hiderToken);
            const seeker = await makeWsClient(s.code, s.seekerToken);
            const hSync = await hider.waitFor((m) => m.type === "sync");
            await seeker.waitFor((m) => m.type === "sync");

            const erlaubt = kategorienFuerSpielgroesse("M").find(
                (k) => k !== hSync.gesperrteKategorie,
            )!;
            await req<any>(app, "POST", `/api/sessions/${s.code}/questions`, {
                body: { type: erlaubt, data: {} },
                token: s.seekerToken,
                expectStatus: 201,
            });

            const beimVersteckenden = await hider.waitFor((m) => m.type === "locked_category");
            const beimSuchenden = await seeker.waitFor((m) => m.type === "locked_category");
            expect(beimVersteckenden.curseId).toBe(curseId);
            expect(beimSuchenden.curseId).toBe(curseId);
            expect(kategorienFuerSpielgroesse("M")).toContain(beimSuchenden.kategorie);
        });
    });

    it("beendet am Rundenende alle laufenden Flüche", async () => {
        await withTestApp(async ({ app, db, makeWsClient }) => {
            const s = await sitzung(app);
            const radId = await fluchSpielen(app, db, s, GLUECKSRAD_ID);
            const geheimId = await fluchSpielen(app, db, s, GEHEIM.id);

            const hider = await makeWsClient(s.code, s.hiderToken);
            const seeker = await makeWsClient(s.code, s.seekerToken);
            await hider.waitFor((m) => m.type === "sync");
            await seeker.waitFor((m) => m.type === "sync");

            seeker.send({ type: "set_status", status: "finished" });
            await seeker.waitFor(
                (m) => m.type === "session_status_changed" && m.status === "finished",
            );

            // Beide Flüche sind zu.
            await hider.waitFor((m) => m.type === "curse_ended" && m.curseId === radId);
            await hider.waitFor((m) => m.type === "curse_ended" && m.curseId === geheimId);

            const { getAktiveFlueche } = await import("../../lib/curses.js");
            expect(await getAktiveFlueche(db, s.sessionId)).toHaveLength(0);

            for (const id of [radId, geheimId]) {
                const row = await db.query.curses.findFirst({
                    where: eq(schema.curses.id, id),
                });
                expect(row!.endedAt).not.toBeNull();
                expect(row!.endedBy).toBe("ablauf");
            }

            // Der geheime Fluch bleibt auch beim Beenden vor den Suchenden verborgen.
            await seeker.waitFor((m) => m.type === "curse_ended" && m.curseId === radId);
            const beimSuchenden = seeker.received.filter(
                (m: any) => m.type === "curse_ended",
            );
            expect(beimSuchenden.map((m: any) => m.curseId)).toEqual([radId]);
        });
    });
});
