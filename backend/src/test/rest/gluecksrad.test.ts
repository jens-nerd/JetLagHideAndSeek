/**
 * Prüft den Fluch Glücksrad: auslosen beim Ausspielen, sperren beim Anlegen
 * einer Frage, neu losen nach jeder gestellten Frage.
 */
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";

import {
    FRAGEKATEGORIEN,
    GLUECKSRAD_ID,
    kategorienFuerSpielgroesse,
} from "@hideandseek/shared";

import { schema } from "../../db/schema.js";
import { createTestApp, createTestDb, req } from "../helpers.js";

type TestDb = ReturnType<typeof createTestDb>;

async function aufbau(app: Hono, gameSize: "S" | "M" | "L" = "M") {
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

/** Das Glücksrad auf die Hand legen und ausspielen. */
async function radSpielen(app: Hono, db: TestDb, a: any): Promise<string> {
    const deckCardId = nanoid();
    await db.insert(schema.deckCards).values({
        id: deckCardId,
        sessionId: a.sessionId,
        cardId: GLUECKSRAD_ID,
        position: 0,
        state: "hand",
    });
    const { body } = await req<any>(
        app, "POST", `/api/sessions/${a.code}/curses`,
        { body: { deckCardId }, token: a.hiderToken, expectStatus: 201 },
    );
    return body.curse.id as string;
}

/** Die gerade gesperrte Kategorie aus der Datenbank. */
async function gesperrte(db: TestDb, curseId: string): Promise<string | null> {
    const row = await db.query.curses.findFirst({
        where: eq(schema.curses.id, curseId),
    });
    return row!.gesperrteKategorie ?? null;
}

/** Irgendeine Kategorie, die gerade nicht gesperrt ist. */
function erlaubte(gesperrt: string | null): string {
    return FRAGEKATEGORIEN.find((k) => k !== gesperrt)!;
}

describe("Fluch Glücksrad", () => {
    it("lost beim Ausspielen sofort eine Kategorie aus", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, "M");

        const curseId = await radSpielen(app, db, a);

        const kategorie = await gesperrte(db, curseId);
        expect(kategorie).not.toBeNull();
        expect(kategorienFuerSpielgroesse("M")).toContain(kategorie);
    });

    it("sperrt bei Spielgröße S nie die Tentakelfragen", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, "S");
        const curseId = await radSpielen(app, db, a);

        // Oft genug losen, damit ein fehlender Ausschluss auffallen muss:
        // bei sechs statt fünf Kategorien käme tentacles hier mit einer
        // Wahrscheinlichkeit von über 99,99 Prozent mindestens einmal vor.
        const gesehen = new Set<string>();
        for (let i = 0; i < 60; i++) {
            const jetzt = await gesperrte(db, curseId);
            expect(jetzt).not.toBe("tentacles");
            gesehen.add(jetzt!);
            await req<any>(app, "POST", `/api/sessions/${a.code}/questions`, {
                body: { type: erlaubte(jetzt), data: {} },
                token: a.seekerToken,
                expectStatus: 201,
            });
        }
        expect(await gesperrte(db, curseId)).not.toBe("tentacles");
        expect([...gesehen].sort()).toEqual(kategorienFuerSpielgroesse("S").sort());
    });

    it("weist eine Frage in der gesperrten Kategorie mit 409 ab", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, "M");
        const curseId = await radSpielen(app, db, a);
        const gesperrtVorher = await gesperrte(db, curseId);

        const { status, body } = await req<any>(
            app, "POST", `/api/sessions/${a.code}/questions`,
            { body: { type: gesperrtVorher, data: {} }, token: a.seekerToken },
        );

        expect(status).toBe(409);
        expect(body.error).toBe("kategorie_gesperrt");

        // Die Frage darf nicht angelegt worden sein.
        const fragen = await db.query.questions.findMany({
            where: eq(schema.questions.sessionId, a.sessionId),
        });
        expect(fragen).toHaveLength(0);

        // Ein abgewiesener Versuch ist keine gestellte Frage: nicht neu losen.
        expect(await gesperrte(db, curseId)).toBe(gesperrtVorher);
    });

    it("lässt eine Frage in einer erlaubten Kategorie durch und lost danach neu", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, "M");
        const curseId = await radSpielen(app, db, a);
        const vorher = await gesperrte(db, curseId);

        await req<any>(app, "POST", `/api/sessions/${a.code}/questions`, {
            body: { type: erlaubte(vorher), data: {} },
            token: a.seekerToken,
            expectStatus: 201,
        });

        const nachher = await gesperrte(db, curseId);
        expect(nachher).not.toBeNull();
        expect(kategorienFuerSpielgroesse("M")).toContain(nachher);
    });

    it("würfelt nach jeder Frage neu und darf dieselbe Kategorie wieder ziehen", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, "M");
        const curseId = await radSpielen(app, db, a);

        // Ohne Neuwurf bliebe es bei der einen Kategorie vom Ausspielen.
        const gesehen = new Set<string>();
        for (let i = 0; i < 30; i++) {
            const jetzt = await gesperrte(db, curseId);
            gesehen.add(jetzt!);
            await req<any>(app, "POST", `/api/sessions/${a.code}/questions`, {
                body: { type: erlaubte(jetzt), data: {} },
                token: a.seekerToken,
                expectStatus: 201,
            });
        }
        gesehen.add((await gesperrte(db, curseId))!);
        expect(gesehen.size).toBeGreaterThan(1);
    });

    it("nimmt bei mehreren Glücksrädern das älteste", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, "M");
        const altId = await radSpielen(app, db, a);
        const neuId = await radSpielen(app, db, a);
        expect(neuId).not.toBe(altId);

        // Beide Raeder ausdruecklich auseinanderziehen: verschiedene Spielzeiten
        // und verschiedene Kategorien, damit der Test wirklich unterscheidet.
        await db
            .update(schema.curses)
            .set({ playedAt: "2026-01-01T10:00:00.000Z", gesperrteKategorie: "radius" })
            .where(eq(schema.curses.id, altId));
        await db
            .update(schema.curses)
            .set({ playedAt: "2026-01-01T11:00:00.000Z", gesperrteKategorie: "photo" })
            .where(eq(schema.curses.id, neuId));

        // Das aeltere sperrt — zuerst pruefen, denn ein 409 lost nicht neu.
        const { status: abgewiesen } = await req<any>(
            app, "POST", `/api/sessions/${a.code}/questions`,
            { body: { type: "radius", data: {} }, token: a.seekerToken },
        );
        expect(abgewiesen).toBe(409);

        // Was nur das juengere sperrt, geht durch.
        await req<any>(app, "POST", `/api/sessions/${a.code}/questions`, {
            body: { type: "photo", data: {} },
            token: a.seekerToken,
            expectStatus: 201,
        });
    });

    it("sperrt ohne Glücksrad nichts", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, "M");

        for (const typ of FRAGEKATEGORIEN) {
            await req<any>(app, "POST", `/api/sessions/${a.code}/questions`, {
                body: { type: typ, data: {} },
                token: a.seekerToken,
                expectStatus: 201,
            });
        }

        const fragen = await db.query.questions.findMany({
            where: eq(schema.questions.sessionId, a.sessionId),
        });
        expect(fragen).toHaveLength(FRAGEKATEGORIEN.length);
    });

    it("sperrt nach dem Beenden des Glücksrads wieder nichts", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, "M");
        const curseId = await radSpielen(app, db, a);
        const gesperrtVorher = await gesperrte(db, curseId);

        await req<any>(app, "POST", `/api/curses/${curseId}/end`, {
            token: a.hiderToken,
            expectStatus: 200,
        });

        await req<any>(app, "POST", `/api/sessions/${a.code}/questions`, {
            body: { type: gesperrtVorher, data: {} },
            token: a.seekerToken,
            expectStatus: 201,
        });
    });
});
