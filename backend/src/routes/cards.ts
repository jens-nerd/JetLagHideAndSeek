/**
 * Kartenmechanik: Ziehen, Behalten, Flüche spielen und beenden.
 *
 * Alle Endpunkte prüfen zuerst sessions.cards_enabled und antworten mit
 * 409 cards_disabled, wenn die Mechanik für diese Sitzung aus ist.
 */
import type { HandKarte, ServerToClientEvent, ZiehErgebnis } from "@hideandseek/shared";
import {
    GLUECKSRAD_ID,
    NACHSCHLAG_ANWENDUNGEN,
    NACHSCHLAG_ID,
    findeKarte,
    getCardCost,
} from "@hideandseek/shared";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { nanoid } from "nanoid";

import { schema } from "../db/schema.js";
import type { Db } from "../db/types.js";
import {
    buildDeck,
    drawTop,
    ermittlePendingDraw,
    getAngeboten,
    getDeckRest,
    getHand,
} from "../lib/deck.js";
import {
    berechneAblauf,
    dreheGluecksrad,
    findeNachschlag,
    getAktiveFlueche,
    planeAblauf,
    toFluch,
    verbraucheAnwendung,
    verwirfAblauf,
} from "../lib/curses.js";
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
    const pendingDraw = await ermittlePendingDraw(db, sessionId);
    wsManager.sendToRole(sessionCode, "hider", {
        type: "hand_updated",
        hand,
        deckRest,
        pendingDraw,
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

        // Offener Zug? Dieselben Karten zurückgeben, nicht neu ziehen — und
        // dabei auch keine zweite Nachschlag-Anwendung verbrauchen.
        let angeboten = await getAngeboten(db, sessionRow.id, questionId);
        if (angeboten.length === 0) {
            const nachschlag = await findeNachschlag(db, sessionRow.id);
            angeboten = await drawTop(
                db,
                sessionRow.id,
                questionId,
                nachschlag ? kosten.draw + 1 : kosten.draw,
            );
            // Verbraucht wird nur, wenn die Extrakarte auch wirklich kam. Bei
            // knappem Deck gibt drawTop weniger zurück als angefordert; dann
            // hat der Nachschlag nichts bewirkt und darf nichts kosten.
            if (nachschlag && angeboten.length > kosten.draw) {
                await verbraucheAnwendung(db, sessionRow.code, nachschlag);
            }
        }

        // Nach dem Ziehen gelesen, damit die Restzahl die eben verbrauchte
        // Anwendung schon enthält.
        const restFluch = await findeNachschlag(db, sessionRow.id);
        const ergebnis: ZiehErgebnis = {
            angeboten,
            // Der Nachschlag dreht nur am Aufdecken. Die Behaltezahl ist
            // dieselbe wie in ermittlePendingDraw und im keep-Endpunkt —
            // sonst zeigte der Ziehschirm nach einem Neuladen eine andere.
            behalten: Math.min(kosten.keep, angeboten.length),
            deckRest: await getDeckRest(db, sessionRow.id),
            nachschlagAktiv: angeboten.length > kosten.draw,
            nachschlagRest: restFluch?.usesLeft ?? null,
        };
        return c.json(ergebnis);
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

    // ── POST /sessions/:code/curses ───────────────────────────────────────────

    router.post("/sessions/:code/curses", async (c) => {
        const code = c.req.param("code").toUpperCase();
        const token = c.req.header("x-participant-token");
        const body: { deckCardId?: string } = await c.req.json();

        const sessionRow = await db.query.sessions.findFirst({
            where: eq(schema.sessions.code, code),
        });
        if (!sessionRow) return c.json({ error: "Session not found" }, 404);
        if (!sessionRow.cardsEnabled) {
            return c.json({ error: "cards_disabled" }, 409);
        }

        const participant = await resolveParticipant(db, sessionRow.id, token);
        if (!participant) return c.json({ error: "Invalid token" }, 403);
        if (participant.role !== "hider") {
            return c.json({ error: "Only the hider can play curses" }, 403);
        }
        if (!body.deckCardId) {
            return c.json({ error: "deckCardId is required" }, 400);
        }

        const deckRow = await db.query.deckCards.findFirst({
            where: and(
                eq(schema.deckCards.id, body.deckCardId),
                eq(schema.deckCards.sessionId, sessionRow.id),
            ),
        });
        if (!deckRow || deckRow.state !== "hand") {
            return c.json({ error: "not_in_hand" }, 400);
        }

        const karte = findeKarte(deckRow.cardId);
        if (!karte) return c.json({ error: "unknown_card" }, 400);
        if (karte.art !== "fluch") return c.json({ error: "not_a_curse" }, 400);

        const curseId = nanoid();
        const playedAt = new Date().toISOString();
        const expiresAt = berechneAblauf(karte, sessionRow.gameSize as any);

        await db.insert(schema.curses).values({
            id: curseId,
            sessionId: sessionRow.id,
            cardId: deckRow.cardId,
            playedByParticipantId: participant.id,
            playedAt,
            expiresAt,
            usesLeft:
                karte.id === NACHSCHLAG_ID ? NACHSCHLAG_ANWENDUNGEN : null,
        });
        await db
            .update(schema.deckCards)
            .set({ state: "gespielt" })
            .where(eq(schema.deckCards.id, deckRow.id));

        const curseRow = (await db.query.curses.findFirst({
            where: eq(schema.curses.id, curseId),
        }))!;
        const curse = toFluch(curseRow);

        // Geheime Karten erfahren die Suchenden nicht.
        const ereignis = { type: "curse_played" as const, curse };
        if (karte.geheim) {
            wsManager.sendToRole(sessionRow.code, "hider", ereignis);
        } else {
            wsManager.broadcast(sessionRow.code, ereignis);
        }
        await sendeHand(db, sessionRow.code, sessionRow.id);

        // Das Gluecksrad lost sofort beim Ausspielen: ab diesem Augenblick ist
        // eine Kategorie zu, nicht erst nach der naechsten Frage.
        if (karte.id === GLUECKSRAD_ID) {
            await dreheGluecksrad(
                db,
                sessionRow.code,
                curseRow,
                sessionRow.gameSize as "S" | "M" | "L" | null,
            );
        }

        if (expiresAt) planeAblauf(db, sessionRow.code, curseId, expiresAt);

        return c.json({ curse }, 201);
    });

    // ── POST /curses/:id/end ──────────────────────────────────────────────────

    router.post("/curses/:id/end", async (c) => {
        const curseId = c.req.param("id");
        const token = c.req.header("x-participant-token");

        const curseRow = await db.query.curses.findFirst({
            where: eq(schema.curses.id, curseId),
        });
        if (!curseRow) return c.json({ error: "Curse not found" }, 404);
        if (curseRow.endedAt) return c.json({ error: "already_ended" }, 409);

        const sessionRow = await db.query.sessions.findFirst({
            where: eq(schema.sessions.id, curseRow.sessionId),
        });
        if (!sessionRow) return c.json({ error: "Session not found" }, 404);
        if (!sessionRow.cardsEnabled) {
            return c.json({ error: "cards_disabled" }, 409);
        }

        const participant = await resolveParticipant(db, sessionRow.id, token);
        if (!participant) return c.json({ error: "Invalid token" }, 403);

        const endedBy =
            participant.role === "hider" ? "versteckender" : "suchende";
        const endedAt = new Date().toISOString();

        await db
            .update(schema.curses)
            .set({ endedAt, endedBy })
            .where(eq(schema.curses.id, curseId));
        verwirfAblauf(curseId);

        const endeEreignis: ServerToClientEvent = {
            type: "curse_ended",
            curseId,
            endedBy,
            endedAt,
        };
        if (findeKarte(curseRow.cardId)?.geheim) {
            wsManager.sendToRole(sessionRow.code, "hider", endeEreignis);
        } else {
            wsManager.broadcast(sessionRow.code, endeEreignis);
        }

        const aktualisiert = (await db.query.curses.findFirst({
            where: eq(schema.curses.id, curseId),
        }))!;
        return c.json({ curse: toFluch(aktualisiert) });
    });

    // ── PATCH /sessions/:code/cards ───────────────────────────────────────────
    //
    // Der einzige Kartenendpunkt ohne cards_disabled-Sperre: Er ist der Weg
    // zurück. Beim Ausschalten enden alle laufenden Flüche, damit "aus" wirklich
    // heißt, dass sich die App wie vor der Kartenmechanik verhält.

    router.patch("/sessions/:code/cards", async (c) => {
        const code = c.req.param("code").toUpperCase();
        const token = c.req.header("x-participant-token");
        const body: { cardsEnabled?: unknown } = await c.req.json();

        const sessionRow = await db.query.sessions.findFirst({
            where: eq(schema.sessions.code, code),
        });
        if (!sessionRow) return c.json({ error: "Session not found" }, 404);

        const participant = await resolveParticipant(db, sessionRow.id, token);
        if (!participant) return c.json({ error: "Invalid token" }, 403);
        if (participant.role !== "hider") {
            return c.json({ error: "Only the hider can toggle cards" }, 403);
        }
        if (typeof body.cardsEnabled !== "boolean") {
            return c.json({ error: "cardsEnabled must be a boolean" }, 400);
        }

        const cardsEnabled = body.cardsEnabled;

        await db
            .update(schema.sessions)
            .set({ cardsEnabled })
            .where(eq(schema.sessions.id, sessionRow.id));

        if (!cardsEnabled) {
            const laufende = await getAktiveFlueche(db, sessionRow.id);
            const endedAt = new Date().toISOString();
            for (const fluch of laufende) {
                await db
                    .update(schema.curses)
                    .set({ endedAt, endedBy: "versteckender" })
                    .where(eq(schema.curses.id, fluch.id));
                verwirfAblauf(fluch.id);
                const ende = {
                    type: "curse_ended" as const,
                    curseId: fluch.id,
                    endedBy: "versteckender" as const,
                    endedAt,
                };
                if (fluch.karte.geheim) {
                    wsManager.sendToRole(sessionRow.code, "hider", ende);
                } else {
                    wsManager.broadcast(sessionRow.code, ende);
                }
            }
        }

        wsManager.broadcast(sessionRow.code, {
            type: "cards_toggled",
            cardsEnabled,
        });

        // Beim Einschalten bekommt der Versteckende seinen Kartenzustand
        // zurueck. Ohne das zeigte sein Client weiter eine leere Hand, waehrend
        // der Server die Karten noch haelt — bis er neu laedt.
        if (cardsEnabled) {
            await sendeHand(db, sessionRow.code, sessionRow.id);
        }

        return c.json({ cardsEnabled });
    });

    return router;
}
