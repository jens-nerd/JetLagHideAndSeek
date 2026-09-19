/**
 * Prüft Deckaufbau, Ziehen und das Zurückmischen der Ablage.
 * Arbeitet direkt auf der Bibliothek, ohne HTTP.
 */
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";

import { createTestDb } from "./helpers.js";
import { schema } from "../db/schema.js";
import {
    buildDeck,
    drawTop,
    getAngeboten,
    getDeckRest,
    getHand,
    getOffenerZug,
} from "../lib/deck.js";

type TestDb = ReturnType<typeof createTestDb>;

/** Legt eine Sitzung direkt in der DB an, ohne den Umweg über die REST-API. */
async function seedSession(db: TestDb): Promise<string> {
    const sessionId = nanoid();
    await db.insert(schema.sessions).values({
        id: sessionId,
        code: "TESTAA",
        status: "active",
        cardsEnabled: true,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    return sessionId;
}

describe("buildDeck", () => {
    it("legt 77 Karten im Zustand deck an", async () => {
        const db = createTestDb();
        const sessionId = await seedSession(db);

        await buildDeck(db, sessionId);

        const rows = await db.query.deckCards.findMany({
            where: eq(schema.deckCards.sessionId, sessionId),
        });
        expect(rows).toHaveLength(77);
        expect(rows.every((r) => r.state === "deck")).toBe(true);
    });

    it("vergibt lückenlose Positionen von 0 bis 76", async () => {
        const db = createTestDb();
        const sessionId = await seedSession(db);

        await buildDeck(db, sessionId);

        const rows = await db.query.deckCards.findMany({
            where: eq(schema.deckCards.sessionId, sessionId),
        });
        const positionen = rows.map((r) => r.position).sort((a, b) => a - b);
        expect(positionen).toEqual(Array.from({ length: 77 }, (_, i) => i));
    });

    it("mischt — zwei Decks haben nicht dieselbe Reihenfolge", async () => {
        const db = createTestDb();
        const a = await seedSession(db);
        const sessionIdB = nanoid();
        await db.insert(schema.sessions).values({
            id: sessionIdB,
            code: "TESTBB",
            status: "active",
            cardsEnabled: true,
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        });

        await buildDeck(db, a);
        await buildDeck(db, sessionIdB);

        const reihe = async (sid: string) =>
            (
                await db.query.deckCards.findMany({
                    where: eq(schema.deckCards.sessionId, sid),
                    orderBy: (d, { asc }) => [asc(d.position)],
                })
            ).map((r) => r.cardId);

        // Bei 77 Karten ist eine zufällige Übereinstimmung praktisch ausgeschlossen.
        expect(await reihe(a)).not.toEqual(await reihe(sessionIdB));
    });

    it("baut nicht doppelt auf", async () => {
        const db = createTestDb();
        const sessionId = await seedSession(db);

        await buildDeck(db, sessionId);
        await buildDeck(db, sessionId);

        const rows = await db.query.deckCards.findMany({
            where: eq(schema.deckCards.sessionId, sessionId),
        });
        expect(rows).toHaveLength(77);
    });
});

describe("drawTop", () => {
    it("bietet n Karten an und nimmt sie aus dem Deck", async () => {
        const db = createTestDb();
        const sessionId = await seedSession(db);
        await buildDeck(db, sessionId);

        const angeboten = await drawTop(db, sessionId, "frage-1", 3);

        expect(angeboten).toHaveLength(3);
        expect(await getDeckRest(db, sessionId)).toBe(74);
    });

    it("nimmt die Karten mit der kleinsten Position zuerst", async () => {
        const db = createTestDb();
        const sessionId = await seedSession(db);
        await buildDeck(db, sessionId);

        const vorher = await db.query.deckCards.findMany({
            where: eq(schema.deckCards.sessionId, sessionId),
            orderBy: (d, { asc }) => [asc(d.position)],
        });
        const erwartet = vorher.slice(0, 2).map((r) => r.id);

        const angeboten = await drawTop(db, sessionId, "frage-1", 2);

        expect(angeboten.map((k) => k.id)).toEqual(erwartet);
    });

    it("mischt die Ablage zurück, wenn das Deck nicht reicht", async () => {
        const db = createTestDb();
        const sessionId = await seedSession(db);
        await buildDeck(db, sessionId);

        // 76 Karten auf die Ablage, eine bleibt im Deck
        const alle = await db.query.deckCards.findMany({
            where: eq(schema.deckCards.sessionId, sessionId),
            orderBy: (d, { asc }) => [asc(d.position)],
        });
        for (const r of alle.slice(0, 76)) {
            await db
                .update(schema.deckCards)
                .set({ state: "ablage" })
                .where(eq(schema.deckCards.id, r.id));
        }
        expect(await getDeckRest(db, sessionId)).toBe(1);

        const angeboten = await drawTop(db, sessionId, "frage-1", 3);

        expect(angeboten).toHaveLength(3);
        const ablage = await db.query.deckCards.findMany({
            where: eq(schema.deckCards.state, "ablage"),
        });
        expect(ablage).toHaveLength(0);
    });

    it("lässt ausgespielte Flüche beim Zurückmischen draußen", async () => {
        const db = createTestDb();
        const sessionId = await seedSession(db);
        await buildDeck(db, sessionId);

        const alle = await db.query.deckCards.findMany({
            where: eq(schema.deckCards.sessionId, sessionId),
            orderBy: (d, { asc }) => [asc(d.position)],
        });
        // 70 auf die Ablage, 6 ausgespielt, eine bleibt im Deck
        for (const r of alle.slice(0, 70)) {
            await db.update(schema.deckCards).set({ state: "ablage" })
                .where(eq(schema.deckCards.id, r.id));
        }
        for (const r of alle.slice(70, 76)) {
            await db.update(schema.deckCards).set({ state: "gespielt" })
                .where(eq(schema.deckCards.id, r.id));
        }

        await drawTop(db, sessionId, "frage-1", 2);

        // Das Zurückmischen muss gelaufen sein: die Ablage ist leer,
        // die sechs ausgespielten Karten sind nicht mit hineingeraten.
        const ablage = await db.query.deckCards.findMany({
            where: eq(schema.deckCards.state, "ablage"),
        });
        expect(ablage).toHaveLength(0);

        const gespielt = await db.query.deckCards.findMany({
            where: eq(schema.deckCards.state, "gespielt"),
        });
        expect(gespielt).toHaveLength(6);
    });

    it("gibt weniger als n zurück, wenn wirklich nichts mehr da ist", async () => {
        const db = createTestDb();
        const sessionId = await seedSession(db);
        await buildDeck(db, sessionId);

        const alle = await db.query.deckCards.findMany({
            where: eq(schema.deckCards.sessionId, sessionId),
        });
        for (const r of alle.slice(0, 75)) {
            await db.update(schema.deckCards).set({ state: "gespielt" })
                .where(eq(schema.deckCards.id, r.id));
        }

        const angeboten = await drawTop(db, sessionId, "frage-1", 4);

        expect(angeboten).toHaveLength(2);
    });
});

describe("getHand", () => {
    it("liefert nur Karten im Zustand hand", async () => {
        const db = createTestDb();
        const sessionId = await seedSession(db);
        await buildDeck(db, sessionId);

        const angeboten = await drawTop(db, sessionId, "frage-1", 3);
        await db
            .update(schema.deckCards)
            .set({ state: "hand", drawForQuestionId: null })
            .where(eq(schema.deckCards.id, angeboten[0].id));

        const hand = await getHand(db, sessionId);

        expect(hand).toHaveLength(1);
        expect(hand[0].id).toBe(angeboten[0].id);
        expect(hand[0].karte.name.length).toBeGreaterThan(0);
    });
});

describe("getAngeboten und getOffenerZug", () => {
    it("getAngeboten liefert nur die Karten der eigenen Frage, nicht die einer zweiten offenen Frage", async () => {
        const db = createTestDb();
        const sessionId = await seedSession(db);
        await buildDeck(db, sessionId);

        const zugEins = await drawTop(db, sessionId, "frage-1", 2);
        const zugZwei = await drawTop(db, sessionId, "frage-2", 3);

        const angebotenEins = await getAngeboten(db, sessionId, "frage-1");
        const angebotenZwei = await getAngeboten(db, sessionId, "frage-2");

        expect(angebotenEins.map((k) => k.id).sort()).toEqual(
            zugEins.map((k) => k.id).sort(),
        );
        expect(angebotenZwei.map((k) => k.id).sort()).toEqual(
            zugZwei.map((k) => k.id).sort(),
        );
        expect(
            angebotenEins.some((k) => angebotenZwei.some((z) => z.id === k.id)),
        ).toBe(false);
    });

    it("getOffenerZug liefert null, wenn keine Karte auf angeboten steht", async () => {
        const db = createTestDb();
        const sessionId = await seedSession(db);
        await buildDeck(db, sessionId);

        expect(await getOffenerZug(db, sessionId)).toBeNull();
    });

    it("getOffenerZug liefert die Fragenkennung und die angebotenen Karten, nachdem gezogen wurde", async () => {
        const db = createTestDb();
        const sessionId = await seedSession(db);
        await buildDeck(db, sessionId);

        const gezogen = await drawTop(db, sessionId, "frage-1", 2);

        const zug = await getOffenerZug(db, sessionId);

        expect(zug).not.toBeNull();
        expect(zug!.questionId).toBe("frage-1");
        expect(zug!.angeboten.map((k) => k.id).sort()).toEqual(
            gezogen.map((k) => k.id).sort(),
        );
    });
});
