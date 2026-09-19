/**
 * Integrationstests für den Nachschlag — die einzige Fluchkarte, die auf die
 * Ziehmechanik selbst wirkt: drei beantwortete Fragen lang eine Karte mehr
 * aufdecken, gleich viele behalten.
 *
 * Der Aufbau baut das Deck ausdrücklich vor der Handkarte auf. buildDeck tut
 * nichts, wenn die Sitzung schon irgendeine Kartenzeile hat — käme der Fluch
 * zuerst auf die Hand, bliebe das Deck leer.
 */
import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { Hono } from "hono";
import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";

import { schema } from "../../db/schema.js";
import { buildDeck, ermittlePendingDraw } from "../../lib/deck.js";
import { getAktiveFlueche } from "../../lib/curses.js";
import { createTestApp, createTestDb, req, withTestApp } from "../helpers.js";

const NACHSCHLAG = "fluch-nachschlag";

type TestDb = ReturnType<typeof createTestDb>;

interface Aufbau {
    code: string;
    sessionId: string;
    hiderToken: string;
    seekerToken: string;
    /** Frage stellen und beantworten, Kennung zurückgeben. */
    frage: (typ?: string) => Promise<string>;
    /** Nachschlag auf die Hand legen und ausspielen. */
    spieleNachschlag: () => Promise<string>;
}

async function aufbau(app: Hono, db: TestDb): Promise<Aufbau> {
    const { body: created } = await req<any>(app, "POST", "/api/sessions", {
        body: { displayName: "Hider Hans", gameSize: "M", cardsEnabled: true },
        expectStatus: 201,
    });
    const code = created.session.code as string;
    const sessionId = created.session.id as string;
    const hiderToken = created.participant.token as string;

    const { body: joined } = await req<any>(
        app, "POST", `/api/sessions/${code}/join`,
        { body: { role: "seeker", displayName: "Sucher Sven" }, expectStatus: 201 },
    );
    const seekerToken = joined.participant.token as string;

    await buildDeck(db, sessionId);

    async function frage(typ = "matching"): Promise<string> {
        const { body: f } = await req<any>(
            app, "POST", `/api/sessions/${code}/questions`,
            { body: { type: typ, data: {} }, token: seekerToken, expectStatus: 201 },
        );
        const id = f.question.id as string;
        await req<any>(app, "POST", `/api/questions/${id}/answer`, {
            body: { answerData: { ja: true } }, token: hiderToken, expectStatus: 200,
        });
        return id;
    }

    async function spieleNachschlag(): Promise<string> {
        const deckCardId = nanoid();
        await db.insert(schema.deckCards).values({
            id: deckCardId,
            sessionId,
            cardId: NACHSCHLAG,
            position: 10_000,
            state: "hand",
        });
        const { body } = await req<any>(
            app, "POST", `/api/sessions/${code}/curses`,
            { body: { deckCardId }, token: hiderToken, expectStatus: 201 },
        );
        return body.curse.id as string;
    }

    return { code, sessionId, hiderToken, seekerToken, frage, spieleNachschlag };
}

/** Ziehen und die Antwort zurückgeben. */
async function ziehen(app: Hono, questionId: string, token: string) {
    const { body } = await req<any>(app, "POST", `/api/questions/${questionId}/draw`, {
        token, expectStatus: 200,
    });
    return body;
}

/** Die erste angebotene Karte behalten, damit die Frage abgeschlossen ist. */
async function behalte(
    app: Hono,
    questionId: string,
    token: string,
    angeboten: Array<{ id: string }>,
    anzahl = 1,
) {
    await req<any>(app, "POST", `/api/questions/${questionId}/keep`, {
        body: { behalten: angeboten.slice(0, anzahl).map((k) => k.id) },
        token,
        expectStatus: 200,
    });
}

describe("Nachschlag beim Ziehen", () => {
    it("deckt bei Matching 4 statt 3 auf und lässt behalten bei 1", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        await a.spieleNachschlag();

        const q = await a.frage("matching");
        const antwort = await ziehen(app, q, a.hiderToken);

        expect(antwort.angeboten).toHaveLength(4);
        expect(antwort.behalten).toBe(1);
        expect(antwort.nachschlagAktiv).toBe(true);
        expect(antwort.nachschlagRest).toBe(2);
    });

    it("deckt bei Tentacle 5 statt 4 auf und lässt behalten bei 2", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        await a.spieleNachschlag();

        const q = await a.frage("tentacles");
        const antwort = await ziehen(app, q, a.hiderToken);

        expect(antwort.angeboten).toHaveLength(5);
        expect(antwort.behalten).toBe(2);
        expect(antwort.nachschlagAktiv).toBe(true);
    });

    it("wirkt bei drei beantworteten Fragen, bei der vierten nicht mehr", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        await a.spieleNachschlag();

        const reste: Array<number | null> = [];
        for (let i = 0; i < 3; i++) {
            const q = await a.frage();
            const antwort = await ziehen(app, q, a.hiderToken);
            expect(antwort.angeboten).toHaveLength(4);
            expect(antwort.behalten).toBe(1);
            reste.push(antwort.nachschlagRest);
            await behalte(app, q, a.hiderToken, antwort.angeboten);
        }
        // Beim dritten Mal ist der Fluch mit dem Zug zu Ende: es laeuft
        // keiner mehr, also gibt es auch keine Restzahl.
        expect(reste).toEqual([2, 1, null]);

        const q4 = await a.frage();
        const vierte = await ziehen(app, q4, a.hiderToken);

        expect(vierte.angeboten).toHaveLength(3);
        expect(vierte.behalten).toBe(1);
        expect(vierte.nachschlagAktiv).toBe(false);
        expect(vierte.nachschlagRest).toBeNull();
    });

    it("verbraucht beim erneuten Abruf desselben offenen Zugs keine zweite Anwendung", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        await a.spieleNachschlag();

        const q1 = await a.frage();
        const erst = await ziehen(app, q1, a.hiderToken);
        const zweit = await ziehen(app, q1, a.hiderToken);

        // Derselbe offene Zug: gleiche Karten, gleiche Restzahl.
        expect(zweit.angeboten.map((k: any) => k.id))
            .toEqual(erst.angeboten.map((k: any) => k.id));
        expect(zweit.angeboten).toHaveLength(4);
        expect(zweit.nachschlagRest).toBe(2);
        expect(zweit.nachschlagAktiv).toBe(true);

        await behalte(app, q1, a.hiderToken, erst.angeboten);

        // Zwei Anwendungen sind noch übrig, die vierte Frage geht leer aus.
        for (const erwartet of [4, 4, 3]) {
            const q = await a.frage();
            const antwort = await ziehen(app, q, a.hiderToken);
            expect(antwort.angeboten).toHaveLength(erwartet);
            await behalte(app, q, a.hiderToken, antwort.angeboten);
        }
    });

    it("verbraucht nichts, wenn das Deck die Extrakarte nicht liefert", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        await a.spieleNachschlag();

        // Deck auf genau drei Karten eindampfen, Ablage leer: drawTop(4)
        // liefert dann nur drei — nicht mehr als die normalen Ziehkosten.
        const imDeck = await db.query.deckCards.findMany({
            where: and(
                eq(schema.deckCards.sessionId, a.sessionId),
                eq(schema.deckCards.state, "deck"),
            ),
            limit: 3,
        });
        const behalteIds = imDeck.map((r) => r.id);
        const geparkt = (await db.query.deckCards.findMany({
            where: and(
                eq(schema.deckCards.sessionId, a.sessionId),
                eq(schema.deckCards.state, "deck"),
                notInArray(schema.deckCards.id, behalteIds),
            ),
        })).map((r) => r.id);
        await db
            .update(schema.deckCards)
            .set({ state: "gespielt" })
            .where(inArray(schema.deckCards.id, geparkt));

        const q1 = await a.frage();
        const knapp = await ziehen(app, q1, a.hiderToken);

        expect(knapp.angeboten).toHaveLength(3);
        expect(knapp.nachschlagAktiv).toBe(false);
        // Nichts angewendet, also nichts verbraucht.
        expect(knapp.nachschlagRest).toBe(3);

        await behalte(app, q1, a.hiderToken, knapp.angeboten);

        // Deck wieder auffüllen: alle drei Anwendungen sind noch da.
        await db
            .update(schema.deckCards)
            .set({ state: "deck", drawForQuestionId: null })
            .where(inArray(schema.deckCards.id, geparkt));

        for (const erwartet of [4, 4, 4, 3]) {
            const q = await a.frage();
            const antwort = await ziehen(app, q, a.hiderToken);
            expect(antwort.angeboten).toHaveLength(erwartet);
            await behalte(app, q, a.hiderToken, antwort.angeboten);
        }
    });

    it("beendet den Fluch nach der dritten Anwendung als abgelaufen", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        const curseId = await a.spieleNachschlag();

        for (let i = 0; i < 3; i++) {
            const q = await a.frage();
            const antwort = await ziehen(app, q, a.hiderToken);
            await behalte(app, q, a.hiderToken, antwort.angeboten);
        }

        const row = await db.query.curses.findFirst({
            where: eq(schema.curses.id, curseId),
        });
        expect(row!.endedAt).not.toBeNull();
        expect(row!.endedBy).toBe("ablauf");
        expect(await getAktiveFlueche(db, a.sessionId)).toHaveLength(0);
    });

    it("lässt ohne Nachschlag alles beim Alten", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);

        const q = await a.frage("matching");
        const antwort = await ziehen(app, q, a.hiderToken);

        expect(antwort.angeboten).toHaveLength(3);
        expect(antwort.behalten).toBe(1);
        expect(antwort.nachschlagAktiv).toBe(false);
        expect(antwort.nachschlagRest).toBeNull();
    });
});

describe("Behaltezahl nach einem Neuladen", () => {
    it("stimmt mit Nachschlag zwischen Antwort und pendingDraw überein", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        await a.spieleNachschlag();

        for (const typ of ["matching", "tentacles"]) {
            const q = await a.frage(typ);
            const antwort = await ziehen(app, q, a.hiderToken);
            const pending = await ermittlePendingDraw(db, a.sessionId);

            expect(pending!.questionId).toBe(q);
            expect(pending!.behalten).toBe(antwort.behalten);
            expect(pending!.angeboten).toHaveLength(antwort.angeboten.length);

            await behalte(app, q, a.hiderToken, antwort.angeboten, antwort.behalten);
        }
    });

    it("stimmt auch überein, wenn das Deck weniger als die Behaltezahl hergibt", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);

        // Eine einzige Karte im Deck, Tentacle will vier ansehen und zwei
        // behalten. Angeboten wird eine — beide Wege müssen 1 sagen.
        const imDeck = await db.query.deckCards.findMany({
            where: and(
                eq(schema.deckCards.sessionId, a.sessionId),
                eq(schema.deckCards.state, "deck"),
            ),
            limit: 1,
        });
        await db
            .update(schema.deckCards)
            .set({ state: "gespielt" })
            .where(and(
                eq(schema.deckCards.sessionId, a.sessionId),
                eq(schema.deckCards.state, "deck"),
                notInArray(schema.deckCards.id, imDeck.map((r) => r.id)),
            ));

        const q = await a.frage("tentacles");
        const antwort = await ziehen(app, q, a.hiderToken);
        const pending = await ermittlePendingDraw(db, a.sessionId);

        expect(antwort.angeboten).toHaveLength(1);
        expect(pending!.behalten).toBe(antwort.behalten);
        expect(antwort.behalten).toBe(1);
    });
});

describe("Ende des Nachschlags über den Draht", () => {
    it("meldet curse_ended nur den Versteckenden", async () => {
        await withTestApp(async ({ app, db, makeWsClient }) => {
            const a = await aufbau(app, db);
            await a.spieleNachschlag();

            const hider = await makeWsClient(a.code, a.hiderToken);
            const seeker = await makeWsClient(a.code, a.seekerToken);
            await hider.waitFor((m) => m.type === "sync");
            await seeker.waitFor((m) => m.type === "sync");

            for (let i = 0; i < 3; i++) {
                const q = await a.frage();
                const antwort = await ziehen(app, q, a.hiderToken);
                await behalte(app, q, a.hiderToken, antwort.angeboten);
            }

            const ende = await hider.waitFor((m) => m.type === "curse_ended");
            expect(ende.endedBy).toBe("ablauf");
            await expect(
                seeker.waitFor((m) => m.type === "curse_ended", { timeoutMs: 500 }),
            ).rejects.toThrow(/timed out/);
        });
    });
});
