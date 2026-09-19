/**
 * Integrationstests für das Ausspielen und Beenden von Flüchen.
 *
 * Statt über den Ziehweg zu gehen, setzen diese Tests die gewünschte Karte
 * direkt auf die Hand. Das Ziehen hat eigene Tests; hier geht es allein um
 * Ablaufzeit, Rollen und Beenden.
 */
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";

import { KARTEN } from "@hideandseek/shared";
import { createTestApp, createTestDb, req } from "../helpers.js";
import { schema } from "../../db/schema.js";

type TestDb = ReturnType<typeof createTestDb>;

/** Ein Fluch mit Dauer und einer ohne — aus dem echten Kartensatz. */
const MIT_DAUER = KARTEN.find((k) => k.art === "fluch" && k.dauerMin !== null)!;
const OHNE_DAUER = KARTEN.find((k) => k.art === "fluch" && k.dauerMin === null)!;
const ZEITBONUS = KARTEN.find((k) => k.art === "zeitbonus")!;

async function aufbau(
    app: Hono,
    db: TestDb,
    gameSize: "S" | "M" | "L" = "M",
    cardsEnabled = true,
) {
    const { body: created } = await req<any>(app, "POST", "/api/sessions", {
        body: { displayName: "Hider Hans", gameSize, cardsEnabled },
        expectStatus: 201,
    });
    const code = created.session.code as string;
    const { body: joined } = await req<any>(
        app, "POST", `/api/sessions/${code}/join`,
        { body: { role: "seeker", displayName: "Sucher Sven" }, expectStatus: 201 },
    );

    /** Legt eine Karte unmittelbar auf die Hand und gibt die Exemplarkennung zurück. */
    async function aufDieHand(cardId: string): Promise<string> {
        const id = nanoid();
        await db.insert(schema.deckCards).values({
            id,
            sessionId: created.session.id,
            cardId,
            position: 0,
            state: "hand",
        });
        return id;
    }

    return {
        code,
        sessionId: created.session.id as string,
        hiderToken: created.participant.token as string,
        seekerToken: joined.participant.token as string,
        aufDieHand,
    };
}

describe("POST /api/sessions/:code/curses", () => {
    it("berechnet die Ablaufzeit aus der Spielgröße", async () => {
        for (const groesse of ["S", "M", "L"] as const) {
            const db = createTestDb();
            const app = createTestApp(db);
            const a = await aufbau(app, db, groesse);
            const deckCardId = await a.aufDieHand(MIT_DAUER.id);

            const { body } = await req<any>(
                app, "POST", `/api/sessions/${a.code}/curses`,
                { body: { deckCardId }, token: a.hiderToken, expectStatus: 201 },
            );

            const erwarteteMinuten = MIT_DAUER.dauerMin![groesse];
            const gespielt = new Date(body.curse.playedAt).getTime();
            const ablauf = new Date(body.curse.expiresAt).getTime();
            expect(Math.round((ablauf - gespielt) / 60_000)).toBe(erwarteteMinuten);
        }
    });

    it("lässt einen Aufgabenfluch ohne Ablaufzeit", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        const deckCardId = await a.aufDieHand(OHNE_DAUER.id);

        const { body } = await req<any>(
            app, "POST", `/api/sessions/${a.code}/curses`,
            { body: { deckCardId }, token: a.hiderToken, expectStatus: 201 },
        );

        expect(body.curse.expiresAt).toBeNull();
    });

    it("nimmt die Karte von der Hand", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        const deckCardId = await a.aufDieHand(MIT_DAUER.id);

        await req<any>(
            app, "POST", `/api/sessions/${a.code}/curses`,
            { body: { deckCardId }, token: a.hiderToken, expectStatus: 201 },
        );

        const row = await db.query.deckCards.findFirst({
            where: eq(schema.deckCards.id, deckCardId),
        });
        expect(row!.state).toBe("gespielt");
    });

    it("faellt bei einer unbekannten Spielgroesse auf M zurueck, statt abzustuerzen", async () => {
        const db = createTestDb();
        const app = createTestApp(db);

        // Die Gruendungsroute prueft gameSize nicht — hier kommt bewusst ein
        // Wert an, der nicht "S" | "M" | "L" ist.
        const { body: created } = await req<any>(app, "POST", "/api/sessions", {
            body: { displayName: "Hider Hans", gameSize: "XL", cardsEnabled: true },
            expectStatus: 201,
        });
        const code = created.session.code as string;

        const deckCardId = nanoid();
        await db.insert(schema.deckCards).values({
            id: deckCardId,
            sessionId: created.session.id,
            cardId: MIT_DAUER.id,
            position: 0,
            state: "hand",
        });

        const { body } = await req<any>(
            app, "POST", `/api/sessions/${code}/curses`,
            { body: { deckCardId }, token: created.participant.token, expectStatus: 201 },
        );

        const erwarteteMinuten = MIT_DAUER.dauerMin!.M;
        const gespielt = new Date(body.curse.playedAt).getTime();
        const ablauf = new Date(body.curse.expiresAt).getTime();
        expect(Math.round((ablauf - gespielt) / 60_000)).toBe(erwarteteMinuten);
    });

    it("lehnt einen Zeitbonus ab", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        const deckCardId = await a.aufDieHand(ZEITBONUS.id);

        const { status, body } = await req<any>(
            app, "POST", `/api/sessions/${a.code}/curses`,
            { body: { deckCardId }, token: a.hiderToken },
        );

        expect(status).toBe(400);
        expect(body.error).toBe("not_a_curse");
    });

    it("lehnt einen Suchenden ab", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        const deckCardId = await a.aufDieHand(MIT_DAUER.id);

        const { status } = await req<any>(
            app, "POST", `/api/sessions/${a.code}/curses`,
            { body: { deckCardId }, token: a.seekerToken },
        );

        expect(status).toBe(403);
    });

    it("lehnt eine Karte ab, die nicht auf der Hand liegt", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);

        const { status, body } = await req<any>(
            app, "POST", `/api/sessions/${a.code}/curses`,
            { body: { deckCardId: "gibt-es-nicht" }, token: a.hiderToken },
        );

        expect(status).toBe(400);
        expect(body.error).toBe("not_in_hand");
    });

    it("antwortet 409 cards_disabled, wenn die Mechanik aus ist", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db, "M", false);
        const deckCardId = await a.aufDieHand(MIT_DAUER.id);

        const { status, body } = await req<any>(
            app, "POST", `/api/sessions/${a.code}/curses`,
            { body: { deckCardId }, token: a.hiderToken },
        );

        expect(status).toBe(409);
        expect(body.error).toBe("cards_disabled");
    });
});

describe("POST /api/curses/:id/end", () => {
    async function spielen(app: Hono, db: TestDb) {
        const a = await aufbau(app, db);
        const deckCardId = await a.aufDieHand(OHNE_DAUER.id);
        const { body } = await req<any>(
            app, "POST", `/api/sessions/${a.code}/curses`,
            { body: { deckCardId }, token: a.hiderToken, expectStatus: 201 },
        );
        return { a, curseId: body.curse.id as string };
    }

    it("trägt suchende ein, wenn ein Suchender beendet", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const { a, curseId } = await spielen(app, db);

        const { body } = await req<any>(
            app, "POST", `/api/curses/${curseId}/end`,
            { token: a.seekerToken, expectStatus: 200 },
        );

        expect(body.curse.endedBy).toBe("suchende");
        expect(body.curse.endedAt).not.toBeNull();
    });

    it("trägt versteckender ein, wenn der Versteckende aufhebt", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const { a, curseId } = await spielen(app, db);

        const { body } = await req<any>(
            app, "POST", `/api/curses/${curseId}/end`,
            { token: a.hiderToken, expectStatus: 200 },
        );

        expect(body.curse.endedBy).toBe("versteckender");
    });

    it("lehnt ein zweites Beenden ab", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const { a, curseId } = await spielen(app, db);
        await req<any>(app, "POST", `/api/curses/${curseId}/end`, {
            token: a.seekerToken, expectStatus: 200,
        });

        const { status, body } = await req<any>(
            app, "POST", `/api/curses/${curseId}/end`,
            { token: a.seekerToken },
        );

        expect(status).toBe(409);
        expect(body.error).toBe("already_ended");
    });
});

describe("Ablauf ohne Timer", () => {
    it("zählt einen abgelaufenen Fluch nicht mehr zu den aktiven", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db);
        const deckCardId = await a.aufDieHand(MIT_DAUER.id);
        const { body } = await req<any>(
            app, "POST", `/api/sessions/${a.code}/curses`,
            { body: { deckCardId }, token: a.hiderToken, expectStatus: 201 },
        );

        // Ablaufzeit in die Vergangenheit setzen, ohne ended_at zu schreiben —
        // so, wie es nach einem Dienstneustart aussieht.
        await db
            .update(schema.curses)
            .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
            .where(eq(schema.curses.id, body.curse.id));

        const { getAktiveFlueche } = await import("../../lib/curses.js");
        const aktive = await getAktiveFlueche(db, a.sessionId);

        expect(aktive).toHaveLength(0);
    });
});
