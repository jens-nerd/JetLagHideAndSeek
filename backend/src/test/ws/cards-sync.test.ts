/**
 * Prüft, dass das sync-Ereignis die Kartenfelder mitbringt und dass die Hand
 * des Versteckenden niemals bei einem Suchenden ankommt.
 */
import { describe, expect, it } from "vitest";

import { req, withTestApp } from "../helpers.js";

async function sitzungMitKarten(app: any, cardsEnabled = true) {
    const { body: created } = await req<any>(app, "POST", "/api/sessions", {
        body: { displayName: "Hider Hans", gameSize: "M", cardsEnabled },
        expectStatus: 201,
    });
    const code = created.session.code as string;
    const { body: joined } = await req<any>(
        app, "POST", `/api/sessions/${code}/join`,
        { body: { role: "seeker", displayName: "Sucher Sven" }, expectStatus: 201 },
    );
    return {
        code,
        hiderToken: created.participant.token as string,
        seekerToken: joined.participant.token as string,
    };
}

/** Frage stellen, beantworten, ziehen, behalten. */
async function zieheEineKarte(app: any, s: any) {
    const { body: frage } = await req<any>(
        app, "POST", `/api/sessions/${s.code}/questions`,
        { body: { type: "matching", data: {} }, token: s.seekerToken, expectStatus: 201 },
    );
    const qid = frage.question.id;
    await req<any>(app, "POST", `/api/questions/${qid}/answer`, {
        body: { answerData: { ja: true } }, token: s.hiderToken, expectStatus: 200,
    });
    const { body: gezogen } = await req<any>(
        app, "POST", `/api/questions/${qid}/draw`,
        { token: s.hiderToken, expectStatus: 200 },
    );
    await req<any>(app, "POST", `/api/questions/${qid}/keep`, {
        body: { behalten: [gezogen.angeboten[0].id] },
        token: s.hiderToken,
        expectStatus: 200,
    });
    return qid;
}

describe("sync mit Kartenmechanik", () => {
    it("meldet cardsEnabled an beide Rollen", async () => {
        await withTestApp(async ({ app, makeWsClient }) => {
            const s = await sitzungMitKarten(app);
            const hider = await makeWsClient(s.code, s.hiderToken);
            const seeker = await makeWsClient(s.code, s.seekerToken);

            const hSync = await hider.waitFor((m) => m.type === "sync");
            const sSync = await seeker.waitFor((m) => m.type === "sync");

            expect(hSync.cardsEnabled).toBe(true);
            expect(sSync.cardsEnabled).toBe(true);
        });
    });

    it("schickt die Hand nur an den Versteckenden", async () => {
        await withTestApp(async ({ app, makeWsClient }) => {
            const s = await sitzungMitKarten(app);
            await zieheEineKarte(app, s);

            const hider = await makeWsClient(s.code, s.hiderToken);
            const seeker = await makeWsClient(s.code, s.seekerToken);

            const hSync = await hider.waitFor((m) => m.type === "sync");
            const sSync = await seeker.waitFor((m) => m.type === "sync");

            expect(hSync.hand).toHaveLength(1);
            expect(sSync.hand).toBeUndefined();
            expect(sSync.deckRest).toBeUndefined();
        });
    });

    it("schickt hand_updated nicht an Suchende", async () => {
        await withTestApp(async ({ app, makeWsClient }) => {
            const s = await sitzungMitKarten(app);
            const hider = await makeWsClient(s.code, s.hiderToken);
            const seeker = await makeWsClient(s.code, s.seekerToken);
            await hider.waitFor((m) => m.type === "sync");
            await seeker.waitFor((m) => m.type === "sync");

            await zieheEineKarte(app, s);

            // Der Versteckende bekommt es; der Suchende darf es nicht bekommen.
            await hider.waitFor((m) => m.type === "hand_updated");
            await expect(
                seeker.waitFor((m) => m.type === "hand_updated", { timeoutMs: 500 }),
            ).rejects.toThrow(/timed out/);
        });
    });

    it("bringt einen offenen Ziehvorgang im sync mit", async () => {
        await withTestApp(async ({ app, makeWsClient }) => {
            const s = await sitzungMitKarten(app);
            const { body: frage } = await req<any>(
                app, "POST", `/api/sessions/${s.code}/questions`,
                { body: { type: "tentacles", data: {} }, token: s.seekerToken, expectStatus: 201 },
            );
            await req<any>(app, "POST", `/api/questions/${frage.question.id}/answer`, {
                body: { answerData: { ort: "Hbf" } }, token: s.hiderToken, expectStatus: 200,
            });
            await req<any>(app, "POST", `/api/questions/${frage.question.id}/draw`, {
                token: s.hiderToken, expectStatus: 200,
            });

            const hider = await makeWsClient(s.code, s.hiderToken);
            const hSync = await hider.waitFor((m) => m.type === "sync");

            expect(hSync.pendingDraw.questionId).toBe(frage.question.id);
            expect(hSync.pendingDraw.angeboten).toHaveLength(4);
            expect(hSync.pendingDraw.behalten).toBe(2);
        });
    });

    it("verteilt curse_played an beide Rollen", async () => {
        await withTestApp(async ({ app, makeWsClient, db }) => {
            const s = await sitzungMitKarten(app);
            const hider = await makeWsClient(s.code, s.hiderToken);
            const seeker = await makeWsClient(s.code, s.seekerToken);
            await hider.waitFor((m) => m.type === "sync");
            await seeker.waitFor((m) => m.type === "sync");

            // Einen Fluch auf die Hand legen und ausspielen
            const { KARTEN } = await import("@hideandseek/shared");
            const { schema } = await import("../../db/schema.js");
            const { nanoid } = await import("nanoid");
            const fluch = KARTEN.find((k: any) => k.art === "fluch")!;
            const sessionRow = await db.query.sessions.findFirst({
                where: (t: any, { eq }: any) => eq(t.code, s.code),
            });
            const deckCardId = nanoid();
            await db.insert(schema.deckCards).values({
                id: deckCardId,
                sessionId: sessionRow!.id,
                cardId: fluch.id,
                position: 0,
                state: "hand",
            });

            await req<any>(app, "POST", `/api/sessions/${s.code}/curses`, {
                body: { deckCardId }, token: s.hiderToken, expectStatus: 201,
            });

            const beimSuchenden = await seeker.waitFor((m) => m.type === "curse_played");
            expect(beimSuchenden.curse.karte.name).toBe(fluch.name);
            await hider.waitFor((m) => m.type === "curse_played");
        });
    });

    it("lässt die Kartenfelder weg, wenn die Mechanik aus ist", async () => {
        await withTestApp(async ({ app, makeWsClient }) => {
            const s = await sitzungMitKarten(app, false);
            const hider = await makeWsClient(s.code, s.hiderToken);

            const hSync = await hider.waitFor((m) => m.type === "sync");

            expect(hSync.cardsEnabled).toBe(false);
            expect(hSync.hand).toBeUndefined();
            expect(hSync.activeCurses).toBeUndefined();
        });
    });
});
