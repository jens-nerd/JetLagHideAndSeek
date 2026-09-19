/**
 * Prüft das Umlegen der Kartenmechanik mitten in der Sitzung.
 */
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";

import { KARTEN } from "@hideandseek/shared";
import { createTestApp, createTestDb, req } from "../helpers.js";
import { schema } from "../../db/schema.js";

type TestDb = ReturnType<typeof createTestDb>;

const FLUCHKARTE = KARTEN.find((k) => k.art === "fluch" && k.dauerMin === null)!;
const ZEITFLUCH = KARTEN.find((k) => k.art === "fluch" && k.dauerMin !== null)!;

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
    return {
        code,
        sessionId: created.session.id as string,
        hiderToken: created.participant.token as string,
        seekerToken: joined.participant.token as string,
    };
}

/** Legt einen Fluch auf die Hand und spielt ihn aus. */
async function fluchSpielen(app: Hono, db: TestDb, a: any): Promise<string> {
    const deckCardId = nanoid();
    await db.insert(schema.deckCards).values({
        id: deckCardId,
        sessionId: a.sessionId,
        cardId: FLUCHKARTE.id,
        position: 0,
        state: "hand",
    });
    const { body } = await req<any>(
        app, "POST", `/api/sessions/${a.code}/curses`,
        { body: { deckCardId }, token: a.hiderToken, expectStatus: 201 },
    );
    return body.curse.id as string;
}

describe("PATCH /api/sessions/:code/cards", () => {
    it("schaltet ein", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db, false);

        const { body } = await req<any>(
            app, "PATCH", `/api/sessions/${a.code}/cards`,
            { body: { cardsEnabled: true }, token: a.hiderToken, expectStatus: 200 },
        );

        expect(body.cardsEnabled).toBe(true);
        const row = await db.query.sessions.findFirst({
            where: eq(schema.sessions.id, a.sessionId),
        });
        expect(row!.cardsEnabled).toBe(true);
    });

    it("schaltet aus", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db, true);

        const { body } = await req<any>(
            app, "PATCH", `/api/sessions/${a.code}/cards`,
            { body: { cardsEnabled: false }, token: a.hiderToken, expectStatus: 200 },
        );

        expect(body.cardsEnabled).toBe(false);
    });

    it("beendet laufende Flüche beim Ausschalten", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db, true);
        const curseId = await fluchSpielen(app, db, a);

        await req<any>(
            app, "PATCH", `/api/sessions/${a.code}/cards`,
            { body: { cardsEnabled: false }, token: a.hiderToken, expectStatus: 200 },
        );

        const row = await db.query.curses.findFirst({
            where: eq(schema.curses.id, curseId),
        });
        expect(row!.endedAt).not.toBeNull();
        expect(row!.endedBy).toBe("versteckender");
    });

    it("lässt Hand und Deck unangetastet", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db, true);
        const deckCardId = nanoid();
        await db.insert(schema.deckCards).values({
            id: deckCardId,
            sessionId: a.sessionId,
            cardId: FLUCHKARTE.id,
            position: 0,
            state: "hand",
        });

        await req<any>(
            app, "PATCH", `/api/sessions/${a.code}/cards`,
            { body: { cardsEnabled: false }, token: a.hiderToken, expectStatus: 200 },
        );

        const row = await db.query.deckCards.findFirst({
            where: eq(schema.deckCards.id, deckCardId),
        });
        expect(row!.state).toBe("hand");
    });

    it("weist einen Suchenden ab", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db, true);

        const { status } = await req<any>(
            app, "PATCH", `/api/sessions/${a.code}/cards`,
            { body: { cardsEnabled: false }, token: a.seekerToken },
        );

        expect(status).toBe(403);
    });

    it("verlangt einen booleschen Wert", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db, true);

        const { status } = await req<any>(
            app, "PATCH", `/api/sessions/${a.code}/cards`,
            { body: { cardsEnabled: "ja" }, token: a.hiderToken },
        );

        expect(status).toBe(400);
    });

    it("beendet auch einen Fluch mit Dauer und verwirft seinen Ablauf-Stups", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db, true);

        // Fluch mit Ablaufzeit auf die Hand und ausspielen
        const deckCardId = nanoid();
        await db.insert(schema.deckCards).values({
            id: deckCardId,
            sessionId: a.sessionId,
            cardId: ZEITFLUCH.id,
            position: 0,
            state: "hand",
        });
        const { body: gespielt } = await req<any>(
            app, "POST", `/api/sessions/${a.code}/curses`,
            { body: { deckCardId }, token: a.hiderToken, expectStatus: 201 },
        );
        expect(gespielt.curse.expiresAt).not.toBeNull();

        await req<any>(
            app, "PATCH", `/api/sessions/${a.code}/cards`,
            { body: { cardsEnabled: false }, token: a.hiderToken, expectStatus: 200 },
        );

        const row = await db.query.curses.findFirst({
            where: eq(schema.curses.id, gespielt.curse.id),
        });
        expect(row!.endedAt).not.toBeNull();
        expect(row!.endedBy).toBe("versteckender");

        // Der Stups darf nicht mehr feuern: getAktiveFlueche liefert nichts,
        // und ein zweites Beenden waere 409 — der Fluch ist endgueltig zu.
        const { getAktiveFlueche } = await import("../../lib/curses.js");
        expect(await getAktiveFlueche(db, a.sessionId)).toHaveLength(0);
        const { status } = await req<any>(
            app, "POST", `/api/curses/${gespielt.curse.id}/end`,
            { token: a.hiderToken },
        );
        expect(status).toBe(409);
    });

    it("weist bei ausgeschalteter Mechanik nicht mit cards_disabled ab", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db, false);

        const { status } = await req<any>(
            app, "PATCH", `/api/sessions/${a.code}/cards`,
            { body: { cardsEnabled: true }, token: a.hiderToken },
        );

        expect(status).toBe(200);
    });
});
