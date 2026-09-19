/**
 * Kartenmechanik: Ziehen, Behalten, Flüche spielen und beenden.
 *
 * Alle Endpunkte prüfen zuerst sessions.cards_enabled und antworten mit
 * 409 cards_disabled, wenn die Mechanik für diese Sitzung aus ist.
 */
import type { HandKarte } from "@hideandseek/shared";
import { getCardCost } from "@hideandseek/shared";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";

import { schema } from "../db/schema.js";
import type { Db } from "../db/types.js";
import {
    buildDeck,
    drawTop,
    getAngeboten,
    getDeckRest,
    getHand,
} from "../lib/deck.js";
import { wsManager } from "../ws/manager.js";

/** Token gegen participants auflösen — wie in routes/questions.ts. */
async function resolveParticipant(
    db: Db,
    sessionId: string,
    token: string | undefined,
) {
    if (!token) return null;
    return db.query.participants.findFirst({
        where: (p, { and: and_, eq: eq_ }) =>
            and_(eq_(p.token, token), eq_(p.sessionId, sessionId)),
    });
}

/** Hand und Deckrest an den Versteckenden schicken. */
export async function sendeHand(
    db: Db,
    sessionCode: string,
    sessionId: string,
): Promise<{ hand: HandKarte[]; deckRest: number }> {
    const hand = await getHand(db, sessionId);
    const deckRest = await getDeckRest(db, sessionId);
    wsManager.sendToRole(sessionCode, "hider", {
        type: "hand_updated",
        hand,
        deckRest,
    });
    return { hand, deckRest };
}

export function createCardsRouter(db: Db): Hono {
    const router = new Hono();

    // ── POST /questions/:id/draw ──────────────────────────────────────────────

    router.post("/questions/:id/draw", async (c) => {
        const questionId = c.req.param("id");
        const token = c.req.header("x-participant-token");

        const questionRow = await db.query.questions.findFirst({
            where: eq(schema.questions.id, questionId),
        });
        if (!questionRow) return c.json({ error: "Question not found" }, 404);

        const sessionRow = await db.query.sessions.findFirst({
            where: eq(schema.sessions.id, questionRow.sessionId),
        });
        if (!sessionRow) return c.json({ error: "Session not found" }, 404);
        if (!sessionRow.cardsEnabled) {
            return c.json({ error: "cards_disabled" }, 409);
        }

        const participant = await resolveParticipant(db, sessionRow.id, token);
        if (!participant) return c.json({ error: "Invalid token" }, 403);
        if (participant.role !== "hider") {
            return c.json({ error: "Only the hider can draw" }, 403);
        }
        if (questionRow.status !== "answered") {
            return c.json({ error: "not_answered" }, 409);
        }
        if (
            questionRow.answeredByParticipantId &&
            questionRow.answeredByParticipantId !== participant.id
        ) {
            return c.json({ error: "Not your answer" }, 403);
        }

        const kosten = getCardCost(questionRow.type);
        if (!kosten) return c.json({ error: "unknown_question_type" }, 400);

        // Schon behalten? Dann gibt es zu dieser Frage nichts mehr.
        const schonBehalten = await db.query.deckCards.findFirst({
            where: and(
                eq(schema.deckCards.sessionId, sessionRow.id),
                eq(schema.deckCards.drawForQuestionId, questionId),
                inArray(schema.deckCards.state, ["hand", "ablage", "gespielt"]),
            ),
        });
        if (schonBehalten) return c.json({ error: "already_kept" }, 409);

        await buildDeck(db, sessionRow.id);

        // Offener Zug? Dieselben Karten zurückgeben, nicht neu ziehen.
        let angeboten = await getAngeboten(db, sessionRow.id, questionId);
        if (angeboten.length === 0) {
            angeboten = await drawTop(db, sessionRow.id, questionId, kosten.draw);
        }

        return c.json({
            angeboten,
            behalten: kosten.keep,
            deckRest: await getDeckRest(db, sessionRow.id),
        });
    });

    // ── POST /questions/:id/keep ──────────────────────────────────────────────

    router.post("/questions/:id/keep", async (c) => {
        const questionId = c.req.param("id");
        const token = c.req.header("x-participant-token");
        const body: { behalten?: string[]; abwerfen?: string[] } =
            await c.req.json();

        const questionRow = await db.query.questions.findFirst({
            where: eq(schema.questions.id, questionId),
        });
        if (!questionRow) return c.json({ error: "Question not found" }, 404);

        const sessionRow = await db.query.sessions.findFirst({
            where: eq(schema.sessions.id, questionRow.sessionId),
        });
        if (!sessionRow) return c.json({ error: "Session not found" }, 404);
        if (!sessionRow.cardsEnabled) {
            return c.json({ error: "cards_disabled" }, 409);
        }

        const participant = await resolveParticipant(db, sessionRow.id, token);
        if (!participant) return c.json({ error: "Invalid token" }, 403);
        if (participant.role !== "hider") {
            return c.json({ error: "Only the hider can keep" }, 403);
        }

        if (!Array.isArray(body.behalten)) {
            return c.json({ error: "behalten is required" }, 400);
        }

        const kosten = getCardCost(questionRow.type);
        if (!kosten) return c.json({ error: "unknown_question_type" }, 400);

        const angeboten = await getAngeboten(db, sessionRow.id, questionId);
        if (angeboten.length === 0) {
            return c.json({ error: "no_open_draw" }, 409);
        }

        // Bei knappem Deck können weniger als draw angeboten worden sein.
        const sollBehalten = Math.min(kosten.keep, angeboten.length);
        if (body.behalten.length !== sollBehalten) {
            return c.json(
                { error: "wrong_keep_count", erwartet: sollBehalten },
                400,
            );
        }

        const angebotenIds = new Set(angeboten.map((k) => k.id));
        if (!body.behalten.every((id) => angebotenIds.has(id))) {
            return c.json({ error: "not_offered" }, 400);
        }

        // Doppelte Kennungen wuerden die Handlimit-Rechnung verfaelschen:
        // sie zaehlen als mehrere Karten, treffen in der Datenbank aber nur
        // eine Zeile. Deshalb ausdruecklich ablehnen statt still entdoppeln.
        if (new Set(body.behalten).size !== body.behalten.length) {
            return c.json({ error: "duplicate_cards" }, 400);
        }

        const hand = await getHand(db, sessionRow.id);
        const handIds = new Set(hand.map((k) => k.id));
        const abwerfen = body.abwerfen ?? [];
        if (!abwerfen.every((id) => handIds.has(id))) {
            return c.json({ error: "not_in_hand" }, 400);
        }

        if (new Set(abwerfen).size !== abwerfen.length) {
            return c.json({ error: "duplicate_cards" }, 400);
        }

        const nachher =
            hand.length - new Set(abwerfen).size + new Set(body.behalten).size;
        if (nachher > 6) {
            return c.json(
                { error: "hand_limit", ueberzaehlig: nachher - 6 },
                409,
            );
        }

        const behaltenSet = new Set(body.behalten);
        const abgelegt = angeboten
            .filter((k) => !behaltenSet.has(k.id))
            .map((k) => k.id);

        await db
            .update(schema.deckCards)
            .set({ state: "hand", drawForQuestionId: questionId })
            .where(inArray(schema.deckCards.id, body.behalten));

        if (abgelegt.length > 0) {
            await db
                .update(schema.deckCards)
                .set({ state: "ablage", drawForQuestionId: questionId })
                .where(inArray(schema.deckCards.id, abgelegt));
        }
        if (abwerfen.length > 0) {
            await db
                .update(schema.deckCards)
                .set({ state: "ablage" })
                .where(inArray(schema.deckCards.id, abwerfen));
        }

        const { hand: neueHand, deckRest } = await sendeHand(
            db,
            sessionRow.code,
            sessionRow.id,
        );
        return c.json({ hand: neueHand, deckRest });
    });

    return router;
}
