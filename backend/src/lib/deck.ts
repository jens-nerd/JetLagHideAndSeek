/**
 * Deckverwaltung: Aufbau, Mischen, Ziehen.
 *
 * Eine Zeile in deck_cards ist ein Kartenexemplar. `position` ist die
 * Mischreihenfolge; gezogen wird immer die kleinste Position unter den Zeilen
 * mit state = 'deck'.
 */
import type { HandKarte } from "@hideandseek/shared";
import { KARTEN, findeKarte } from "@hideandseek/shared";
import { and, eq, inArray } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { nanoid } from "nanoid";

import { schema } from "../db/schema.js";
import type { DbDeckCard } from "../db/schema.js";
import type { Db } from "../db/types.js";

/** Fisher-Yates mit crypto.randomInt. Kein Seed — Zufall ist hier der Zweck. */
function mischen<T>(werte: T[]): T[] {
    const a = [...werte];
    for (let i = a.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/** Eine DB-Zeile in die Übertragungsform bringen. */
export function toHandKarte(row: DbDeckCard): HandKarte {
    const karte = findeKarte(row.cardId);
    if (!karte) {
        throw new Error(`Unbekannte Kartenkennung in deck_cards: ${row.cardId}`);
    }
    return { id: row.id, karte };
}

/**
 * Legt das Deck einer Sitzung an: je Kartensorte so viele Zeilen wie `anzahl`,
 * gemischt und mit lückenlosen Positionen ab 0. Tut nichts, wenn die Sitzung
 * schon Karten hat.
 */
export async function buildDeck(db: Db, sessionId: string): Promise<void> {
    const vorhanden = await db.query.deckCards.findFirst({
        where: eq(schema.deckCards.sessionId, sessionId),
    });
    if (vorhanden) return;

    const kartenkennungen: string[] = [];
    for (const karte of KARTEN) {
        for (let i = 0; i < karte.anzahl; i++) kartenkennungen.push(karte.id);
    }

    const zeilen = mischen(kartenkennungen).map((cardId, position) => ({
        id: nanoid(),
        sessionId,
        cardId,
        position,
        state: "deck" as const,
    }));

    await db.insert(schema.deckCards).values(zeilen);
}

/** Wie viele Karten liegen noch im Deck. */
export async function getDeckRest(db: Db, sessionId: string): Promise<number> {
    const rows = await db.query.deckCards.findMany({
        where: and(
            eq(schema.deckCards.sessionId, sessionId),
            eq(schema.deckCards.state, "deck"),
        ),
    });
    return rows.length;
}

/**
 * Mischt die Ablage zurück ins Deck und nummeriert alles neu durch.
 * Ausgespielte Flüche (state = 'gespielt') bleiben draußen.
 */
async function ablageZurueckmischen(db: Db, sessionId: string): Promise<void> {
    const imDeck = await db.query.deckCards.findMany({
        where: and(
            eq(schema.deckCards.sessionId, sessionId),
            eq(schema.deckCards.state, "deck"),
        ),
    });
    const inAblage = await db.query.deckCards.findMany({
        where: and(
            eq(schema.deckCards.sessionId, sessionId),
            eq(schema.deckCards.state, "ablage"),
        ),
    });
    if (inAblage.length === 0) return;

    const neu = mischen([...imDeck, ...inAblage]);
    for (let i = 0; i < neu.length; i++) {
        await db
            .update(schema.deckCards)
            .set({ state: "deck", position: i, drawForQuestionId: null })
            .where(eq(schema.deckCards.id, neu[i].id));
    }
}

/**
 * Nimmt bis zu `n` Karten vom Deck und setzt sie auf 'angeboten', verknüpft mit
 * der Frage, zu der gezogen wird. Reicht das Deck nicht, wird zuerst die Ablage
 * zurückgemischt; reicht es dann immer noch nicht, kommen eben weniger Karten
 * zurück — das ist kein Fehler.
 */
export async function drawTop(
    db: Db,
    sessionId: string,
    questionId: string,
    n: number,
): Promise<HandKarte[]> {
    if (await getDeckRest(db, sessionId) < n) {
        await ablageZurueckmischen(db, sessionId);
    }

    const oben = await db.query.deckCards.findMany({
        where: and(
            eq(schema.deckCards.sessionId, sessionId),
            eq(schema.deckCards.state, "deck"),
        ),
        orderBy: (d, { asc }) => [asc(d.position)],
        limit: n,
    });
    if (oben.length === 0) return [];

    await db
        .update(schema.deckCards)
        .set({ state: "angeboten", drawForQuestionId: questionId })
        .where(inArray(schema.deckCards.id, oben.map((r) => r.id)));

    return oben.map(toHandKarte);
}

/** Die Hand des Versteckenden. */
export async function getHand(db: Db, sessionId: string): Promise<HandKarte[]> {
    const rows = await db.query.deckCards.findMany({
        where: and(
            eq(schema.deckCards.sessionId, sessionId),
            eq(schema.deckCards.state, "hand"),
        ),
        orderBy: (d, { asc }) => [asc(d.position)],
    });
    return rows.map(toHandKarte);
}

/** Die zu einer Frage angebotenen Karten, falls ein Zug offen ist. */
export async function getAngeboten(
    db: Db,
    sessionId: string,
    questionId: string,
): Promise<HandKarte[]> {
    const rows = await db.query.deckCards.findMany({
        where: and(
            eq(schema.deckCards.sessionId, sessionId),
            eq(schema.deckCards.state, "angeboten"),
            eq(schema.deckCards.drawForQuestionId, questionId),
        ),
        orderBy: (d, { asc }) => [asc(d.position)],
    });
    return rows.map(toHandKarte);
}

/** Alle offenen Ziehvorgänge einer Sitzung (für das sync-Ereignis). */
export async function getOffenerZug(
    db: Db,
    sessionId: string,
): Promise<{ questionId: string; angeboten: HandKarte[] } | null> {
    const rows = await db.query.deckCards.findMany({
        where: and(
            eq(schema.deckCards.sessionId, sessionId),
            eq(schema.deckCards.state, "angeboten"),
        ),
        orderBy: (d, { asc }) => [asc(d.position)],
    });
    if (rows.length === 0) return null;
    const questionId = rows[0].drawForQuestionId!;
    return {
        questionId,
        angeboten: rows
            .filter((r) => r.drawForQuestionId === questionId)
            .map(toHandKarte),
    };
}
