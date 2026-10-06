/**
 * Integrationstests für POST /api/curses/:id/nachweise.
 *
 * Der wichtigste Test hier ist "verliert keinen von zwei gleichzeitigen
 * Nachweisen". Anhängen ist Lesen-Ändern-Schreiben, und ohne die Transaktion in
 * der Route gewinnt der zweite Schreibvorgang und der erste Nachweis ist weg.
 * Ein Test mit nur einem Aufruf belegt die Transaktion nicht.
 */
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";

import { KARTEN } from "@hideandseek/shared";
import { createTestApp, createTestDb, req, withTestApp } from "../helpers.js";
import { schema } from "../../db/schema.js";

type TestDb = ReturnType<typeof createTestDb>;

/** Abstecher: verlangt drei Fotos, also genau der Fall mit mehreren Nachweisen. */
const MIT_UPLOAD = KARTEN.find((k) => k.id === "fluch-abstecher")!;
/** Werbepause: Fluch ohne eigene Nachweisforderung. */
const OHNE_UPLOAD = KARTEN.find((k) => k.id === "fluch-werbepause")!;
/** Die beiden Flüche, die zwingend Video verlangen. */
const NUR_VIDEO = KARTEN.filter((k) => k.nachweisUpload === "video");
/** Warteschlange: Foto oder Video, beides ist recht. */
const BEIDES = KARTEN.find((k) => k.nachweisUpload === "beides")!;

async function aufbau(app: Hono, db: TestDb, cardsEnabled = true) {
    const { body: created } = await req<any>(app, "POST", "/api/sessions", {
        body: { displayName: "Hider Hans", gameSize: "M", cardsEnabled },
        expectStatus: 201,
    });
    const code = created.session.code as string;
    const { body: joined } = await req<any>(
        app, "POST", `/api/sessions/${code}/join`,
        { body: { role: "seeker", displayName: "Sucher Sven" }, expectStatus: 201 },
    );

    /** Karte auf die Hand legen, ausspielen, Fluchkennung zurückgeben. */
    async function spieleAus(cardId: string): Promise<string> {
        const deckCardId = nanoid();
        await db.insert(schema.deckCards).values({
            id: deckCardId,
            sessionId: created.session.id,
            cardId,
            position: 0,
            state: "hand",
        });
        const { body } = await req<any>(
            app, "POST", `/api/sessions/${code}/curses`,
            { body: { deckCardId }, token: created.participant.token, expectStatus: 201 },
        );
        return body.curse.id as string;
    }

    return {
        code,
        sessionId: created.session.id as string,
        hiderToken: created.participant.token as string,
        seekerToken: joined.participant.token as string,
        hiderId: created.participant.id as string,
        seekerId: joined.participant.id as string,
        spieleAus,
    };
}

describe("POST /api/curses/:id/nachweise", () => {
    it("ein frisch gespielter Fluch hat eine leere Nachweisliste", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        const curseId = await a.spieleAus(MIT_UPLOAD.id);

        const row = await db.query.curses.findFirst({
            where: eq(schema.curses.id, curseId),
        });
        // In der Spalte steht NULL, nach außen ist es [].
        expect(row!.nachweise).toBeNull();
    });

    it("hängt einen Nachweis an und füllt von und am selbst", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        const curseId = await a.spieleAus(MIT_UPLOAD.id);

        const vorher = Date.now();
        const { body } = await req<any>(
            app, "POST", `/api/curses/${curseId}/nachweise`,
            {
                body: { nachweise: [{ url: "/uploads/a.jpg", art: "bild" }] },
                token: a.hiderToken,
                expectStatus: 200,
            },
        );

        expect(body.nachweise).toHaveLength(1);
        expect(body.nachweise[0].url).toBe("/uploads/a.jpg");
        expect(body.nachweise[0].art).toBe("bild");
        expect(body.nachweise[0].von).toBe(a.hiderId);
        expect(new Date(body.nachweise[0].am).getTime()).toBeGreaterThanOrEqual(vorher);
    });

    it("nimmt mehrere Nachweise in einem Aufruf und behält die Reihenfolge", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        const curseId = await a.spieleAus(MIT_UPLOAD.id);

        const { body } = await req<any>(
            app, "POST", `/api/curses/${curseId}/nachweise`,
            {
                body: {
                    nachweise: [
                        { url: "/uploads/1.jpg" },
                        { url: "/uploads/2.jpg" },
                        { url: "/uploads/3.jpg" },
                    ],
                },
                token: a.hiderToken,
                expectStatus: 200,
            },
        );

        expect(body.nachweise.map((n: any) => n.url)).toEqual([
            "/uploads/1.jpg",
            "/uploads/2.jpg",
            "/uploads/3.jpg",
        ]);
        // art fehlte im Rumpf und wird zu "bild".
        expect(body.nachweise.every((n: any) => n.art === "bild")).toBe(true);
    });

    it("hängt an eine bestehende Liste an, statt sie zu ersetzen", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        const curseId = await a.spieleAus(MIT_UPLOAD.id);

        await req<any>(app, "POST", `/api/curses/${curseId}/nachweise`, {
            body: { nachweise: [{ url: "/uploads/erst.jpg" }] },
            token: a.hiderToken,
            expectStatus: 200,
        });
        const { body } = await req<any>(
            app, "POST", `/api/curses/${curseId}/nachweise`,
            {
                body: { nachweise: [{ url: "/uploads/dann.jpg" }] },
                token: a.hiderToken,
                expectStatus: 200,
            },
        );

        expect(body.nachweise.map((n: any) => n.url)).toEqual([
            "/uploads/erst.jpg",
            "/uploads/dann.jpg",
        ]);
    });

    // ── Der Test, um den es geht ──────────────────────────────────────────────

    it("verliert keinen von zwei gleichzeitigen Nachweisen", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        const curseId = await a.spieleAus(MIT_UPLOAD.id);

        // Beide Anfragen werden gestartet, bevor eine von ihnen fertig ist.
        // Jede liest die Liste, hängt an und schreibt zurück. Ohne die
        // Transaktion in der Route lesen beide die leere Liste und die zweite
        // überschreibt die erste — danach steht genau ein Nachweis da.
        const [eins, zwei] = await Promise.all([
            req<any>(app, "POST", `/api/curses/${curseId}/nachweise`, {
                body: { nachweise: [{ url: "/uploads/links.jpg" }] },
                token: a.hiderToken,
            }),
            req<any>(app, "POST", `/api/curses/${curseId}/nachweise`, {
                body: { nachweise: [{ url: "/uploads/rechts.jpg" }] },
                token: a.seekerToken,
            }),
        ]);

        expect(eins.status).toBe(200);
        expect(zwei.status).toBe(200);

        const row = await db.query.curses.findFirst({
            where: eq(schema.curses.id, curseId),
        });
        const gespeichert = JSON.parse(row!.nachweise!) as Array<{ url: string }>;
        const urls = gespeichert.map((n) => n.url).sort();
        expect(urls).toEqual(["/uploads/links.jpg", "/uploads/rechts.jpg"]);
    });

    it("verliert keinen von fünf gleichzeitigen Nachweisen", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        const curseId = await a.spieleAus(MIT_UPLOAD.id);

        await Promise.all(
            [1, 2, 3, 4, 5].map((n) =>
                req<any>(app, "POST", `/api/curses/${curseId}/nachweise`, {
                    body: { nachweise: [{ url: `/uploads/${n}.jpg` }] },
                    token: a.hiderToken,
                    expectStatus: 200,
                }),
            ),
        );

        const row = await db.query.curses.findFirst({
            where: eq(schema.curses.id, curseId),
        });
        const gespeichert = JSON.parse(row!.nachweise!) as Array<{ url: string }>;
        expect(gespeichert.map((n) => n.url).sort()).toEqual([
            "/uploads/1.jpg",
            "/uploads/2.jpg",
            "/uploads/3.jpg",
            "/uploads/4.jpg",
            "/uploads/5.jpg",
        ]);
    });

    // ── Berechtigung ──────────────────────────────────────────────────────────

    it("lässt auch einen Suchenden anhängen", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        const curseId = await a.spieleAus(MIT_UPLOAD.id);

        const { body } = await req<any>(
            app, "POST", `/api/curses/${curseId}/nachweise`,
            {
                body: { nachweise: [{ url: "/uploads/sucher.jpg" }] },
                token: a.seekerToken,
                expectStatus: 200,
            },
        );

        expect(body.nachweise[0].von).toBe(a.seekerId);
    });

    it("lehnt einen unbekannten Token ab", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        const curseId = await a.spieleAus(MIT_UPLOAD.id);

        const { status } = await req<any>(
            app, "POST", `/api/curses/${curseId}/nachweise`,
            { body: { nachweise: [{ url: "/uploads/x.jpg" }] }, token: "fremd" },
        );

        expect(status).toBe(403);
    });

    // ── Abweisungen ───────────────────────────────────────────────────────────

    it("lehnt einen Fluch ab, dessen Karte keinen Nachweis verlangt", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        const curseId = await a.spieleAus(OHNE_UPLOAD.id);

        const { status, body } = await req<any>(
            app, "POST", `/api/curses/${curseId}/nachweise`,
            { body: { nachweise: [{ url: "/uploads/x.jpg" }] }, token: a.hiderToken },
        );

        expect(status).toBe(400);
        expect(body.error).toBe("no_proof_for_card");
    });

    it("lehnt eine URL ab, die nicht aus dem Upload kommt", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        const curseId = await a.spieleAus(MIT_UPLOAD.id);

        for (const url of ["https://fremd.example/x.jpg", "javascript:alert(1)", ""]) {
            const { status, body } = await req<any>(
                app, "POST", `/api/curses/${curseId}/nachweise`,
                { body: { nachweise: [{ url }] }, token: a.hiderToken },
            );
            expect(status).toBe(400);
            expect(body.error).toBe("bad_url");
        }
    });

    it("lehnt ein Bild ab, wenn die Karte zwingend Video verlangt", async () => {
        // Jens' Entscheidung: bei Kegelbahn ist der Nachweis "der Wurf,
        // ungeschnitten", bei Vogelkino "ein Vogel, am Stück gefilmt". Ein Foto
        // beweist davon nichts. Bis Eintrag 8 nehmen diese beiden gar nichts an.
        expect(NUR_VIDEO.map((k) => k.id).sort()).toEqual([
            "fluch-kegelbahn",
            "fluch-vogelkino",
        ]);

        for (const karte of NUR_VIDEO) {
            const db = createTestDb();
            const app = createTestApp(db);
            const a = await aufbau(app, db);
            const curseId = await a.spieleAus(karte.id);

            const { status, body } = await req<any>(
                app, "POST", `/api/curses/${curseId}/nachweise`,
                {
                    body: { nachweise: [{ url: "/uploads/x.jpg", art: "bild" }] },
                    token: a.hiderToken,
                },
            );

            expect(status).toBe(400);
            expect(body.error).toBe("video_required");
        }
    });

    it("nimmt bei nachweisUpload beides weiterhin ein Bild", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        const curseId = await a.spieleAus(BEIDES.id);

        const { body } = await req<any>(
            app, "POST", `/api/curses/${curseId}/nachweise`,
            {
                body: { nachweise: [{ url: "/uploads/schlange.jpg", art: "bild" }] },
                token: a.hiderToken,
                expectStatus: 200,
            },
        );

        expect(body.nachweise).toHaveLength(1);
        expect(body.nachweise[0].url).toBe("/uploads/schlange.jpg");
    });

    it("lehnt Video ab, solange der Upload keine Videos annimmt", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        const curseId = await a.spieleAus(MIT_UPLOAD.id);

        const { status, body } = await req<any>(
            app, "POST", `/api/curses/${curseId}/nachweise`,
            {
                body: { nachweise: [{ url: "/uploads/x.mp4", art: "video" }] },
                token: a.hiderToken,
            },
        );

        expect(status).toBe(400);
        expect(body.error).toBe("video_not_supported");
    });

    it("lehnt eine leere Liste und einen fehlenden Rumpf ab", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        const curseId = await a.spieleAus(MIT_UPLOAD.id);

        const leer = await req<any>(
            app, "POST", `/api/curses/${curseId}/nachweise`,
            { body: { nachweise: [] }, token: a.hiderToken },
        );
        expect(leer.status).toBe(400);
        expect(leer.body.error).toBe("nachweise_required");

        // Ohne Rumpf: 400, kein 500er.
        const ohne = await req<any>(
            app, "POST", `/api/curses/${curseId}/nachweise`,
            { token: a.hiderToken },
        );
        expect(ohne.status).toBe(400);
        expect(ohne.body.error).toBe("nachweise_required");
    });

    it("lehnt einen beendeten Fluch ab", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        const curseId = await a.spieleAus(MIT_UPLOAD.id);

        await req<any>(app, "POST", `/api/curses/${curseId}/end`, {
            token: a.hiderToken,
            expectStatus: 200,
        });

        const { status, body } = await req<any>(
            app, "POST", `/api/curses/${curseId}/nachweise`,
            { body: { nachweise: [{ url: "/uploads/x.jpg" }] }, token: a.hiderToken },
        );

        expect(status).toBe(409);
        expect(body.error).toBe("already_ended");
    });

    it("lehnt ab, wenn die Kartenmechanik aus ist", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        const curseId = await a.spieleAus(MIT_UPLOAD.id);

        // Das Ausschalten beendet laufende Flüche; der Fluch wird dafür
        // zurückgesetzt, damit hier wirklich cards_disabled geprüft wird und
        // nicht already_ended.
        await req<any>(app, "PATCH", `/api/sessions/${a.code}/cards`, {
            body: { cardsEnabled: false },
            token: a.hiderToken,
            expectStatus: 200,
        });
        await db
            .update(schema.curses)
            .set({ endedAt: null, endedBy: null })
            .where(eq(schema.curses.id, curseId));

        const { status, body } = await req<any>(
            app, "POST", `/api/curses/${curseId}/nachweise`,
            { body: { nachweise: [{ url: "/uploads/x.jpg" }] }, token: a.hiderToken },
        );

        expect(status).toBe(409);
        expect(body.error).toBe("cards_disabled");
    });

    it("antwortet 404 bei einer unbekannten Fluchkennung", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);

        const { status } = await req<any>(
            app, "POST", "/api/curses/gibtsnicht/nachweise",
            { body: { nachweise: [{ url: "/uploads/x.jpg" }] }, token: a.hiderToken },
        );

        expect(status).toBe(404);
    });

    // ── Weg nach draußen ──────────────────────────────────────────────────────

    it("gibt die Nachweise über toFluch wieder heraus", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        const curseId = await a.spieleAus(MIT_UPLOAD.id);

        await req<any>(app, "POST", `/api/curses/${curseId}/nachweise`, {
            body: { nachweise: [{ url: "/uploads/sichtbar.jpg" }] },
            token: a.hiderToken,
            expectStatus: 200,
        });

        // /end liefert den Fluch in der Übertragungsform zurück.
        const { body } = await req<any>(
            app, "POST", `/api/curses/${curseId}/end`,
            { token: a.hiderToken, expectStatus: 200 },
        );

        expect(body.curse.nachweise).toHaveLength(1);
        expect(body.curse.nachweise[0].url).toBe("/uploads/sichtbar.jpg");
    });

    it("schickt curse_nachweise an beide Seiten", async () => {
        await withTestApp(async ({ app, db, makeWsClient }) => {
            const a = await aufbau(app, db);
            const curseId = await a.spieleAus(MIT_UPLOAD.id);

            const hider = await makeWsClient(a.code, a.hiderToken);
            const seeker = await makeWsClient(a.code, a.seekerToken);
            await hider.waitFor((m) => m.type === "sync");
            await seeker.waitFor((m) => m.type === "sync");

            await req<any>(app, "POST", `/api/curses/${curseId}/nachweise`, {
                body: { nachweise: [{ url: "/uploads/per-ws.jpg" }] },
                token: a.seekerToken,
                expectStatus: 200,
            });

            const beimVersteckenden = await hider.waitFor(
                (m) => m.type === "curse_nachweise",
            );
            const beimSuchenden = await seeker.waitFor(
                (m) => m.type === "curse_nachweise",
            );

            expect(beimVersteckenden.curseId).toBe(curseId);
            expect(beimVersteckenden.nachweise).toHaveLength(1);
            expect(beimVersteckenden.nachweise[0].url).toBe("/uploads/per-ws.jpg");
            expect(beimSuchenden.nachweise[0].url).toBe("/uploads/per-ws.jpg");
        });
    });
});
