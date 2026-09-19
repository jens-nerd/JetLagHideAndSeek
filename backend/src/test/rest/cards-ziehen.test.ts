/**
 * Integrationstests für Ziehen und Behalten.
 *
 * Aufbau je Test: Sitzung mit eingeschalteter Kartenmechanik, ein Suchender
 * stellt eine Frage, der Versteckende beantwortet sie, dann wird gezogen.
 */
import type { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { createTestApp, createTestDb, req } from "../helpers.js";

function makeApp(): Hono {
    return createTestApp(createTestDb());
}

interface Aufbau {
    code: string;
    hiderToken: string;
    seekerToken: string;
    questionId: string;
}

/** Sitzung mit Karten, eine beantwortete Frage des gewünschten Typs. */
async function aufbau(
    app: Hono,
    typ = "matching",
    cardsEnabled = true,
): Promise<Aufbau> {
    const { body: created } = await req<any>(app, "POST", "/api/sessions", {
        body: { displayName: "Hider Hans", cardsEnabled },
        expectStatus: 201,
    });
    const code = created.session.code as string;
    const hiderToken = created.participant.token as string;

    const { body: joined } = await req<any>(
        app,
        "POST",
        `/api/sessions/${code}/join`,
        { body: { role: "seeker", displayName: "Sucher Sven" }, expectStatus: 201 },
    );
    const seekerToken = joined.participant.token as string;

    const { body: frage } = await req<any>(
        app,
        "POST",
        `/api/sessions/${code}/questions`,
        {
            body: { type: typ, data: { foo: "bar" } },
            token: seekerToken,
            expectStatus: 201,
        },
    );
    const questionId = frage.question.id as string;

    await req<any>(app, "POST", `/api/questions/${questionId}/answer`, {
        body: { answerData: { ja: true } },
        token: hiderToken,
        expectStatus: 200,
    });

    return { code, hiderToken, seekerToken, questionId };
}

describe("POST /api/questions/:id/draw", () => {
    it.each([
        ["matching", 3, 1],
        ["measuring", 3, 1],
        ["thermometer", 2, 1],
        ["radius", 2, 1],
        ["tentacles", 4, 2],
    ])("bietet für %s %i Karten an, %i zu behalten", async (typ, draw, keep) => {
        const app = makeApp();
        const a = await aufbau(app, typ as string);

        const { body } = await req<any>(
            app,
            "POST",
            `/api/questions/${a.questionId}/draw`,
            { token: a.hiderToken, expectStatus: 200 },
        );

        expect(body.angeboten).toHaveLength(draw);
        expect(body.behalten).toBe(keep);
    });

    it("liefert beim zweiten Aufruf dieselben Karten", async () => {
        const app = makeApp();
        const a = await aufbau(app);

        const { body: erst } = await req<any>(
            app, "POST", `/api/questions/${a.questionId}/draw`,
            { token: a.hiderToken, expectStatus: 200 },
        );
        const { body: zweit } = await req<any>(
            app, "POST", `/api/questions/${a.questionId}/draw`,
            { token: a.hiderToken, expectStatus: 200 },
        );

        expect(zweit.angeboten.map((k: any) => k.id))
            .toEqual(erst.angeboten.map((k: any) => k.id));
        expect(zweit.deckRest).toBe(erst.deckRest);
    });

    it("weist einen Suchenden ab", async () => {
        const app = makeApp();
        const a = await aufbau(app);

        const { status } = await req<any>(
            app, "POST", `/api/questions/${a.questionId}/draw`,
            { token: a.seekerToken },
        );

        expect(status).toBe(403);
    });

    it("weist eine unbeantwortete Frage ab", async () => {
        const app = makeApp();
        const a = await aufbau(app);
        const { body: frage } = await req<any>(
            app, "POST", `/api/sessions/${a.code}/questions`,
            { body: { type: "matching", data: {} }, token: a.seekerToken, expectStatus: 201 },
        );

        const { status, body } = await req<any>(
            app, "POST", `/api/questions/${frage.question.id}/draw`,
            { token: a.hiderToken },
        );

        expect(status).toBe(409);
        expect(body.error).toBe("not_answered");
    });

    it("antwortet 409 cards_disabled, wenn die Mechanik aus ist", async () => {
        const app = makeApp();
        const a = await aufbau(app, "matching", false);

        const { status, body } = await req<any>(
            app, "POST", `/api/questions/${a.questionId}/draw`,
            { token: a.hiderToken },
        );

        expect(status).toBe(409);
        expect(body.error).toBe("cards_disabled");
    });
});

describe("POST /api/questions/:id/keep", () => {
    async function ziehen(app: Hono, a: Aufbau) {
        const { body } = await req<any>(
            app, "POST", `/api/questions/${a.questionId}/draw`,
            { token: a.hiderToken, expectStatus: 200 },
        );
        return body.angeboten as Array<{ id: string }>;
    }

    it("legt die behaltene Karte auf die Hand und den Rest ab", async () => {
        const app = makeApp();
        const a = await aufbau(app);
        const angeboten = await ziehen(app, a);

        const { body } = await req<any>(
            app, "POST", `/api/questions/${a.questionId}/keep`,
            {
                body: { behalten: [angeboten[0].id] },
                token: a.hiderToken,
                expectStatus: 200,
            },
        );

        expect(body.hand).toHaveLength(1);
        expect(body.hand[0].id).toBe(angeboten[0].id);
    });

    it("lehnt eine falsche Anzahl ab", async () => {
        const app = makeApp();
        const a = await aufbau(app);
        const angeboten = await ziehen(app, a);

        const { status, body } = await req<any>(
            app, "POST", `/api/questions/${a.questionId}/keep`,
            {
                body: { behalten: [angeboten[0].id, angeboten[1].id] },
                token: a.hiderToken,
            },
        );

        expect(status).toBe(400);
        expect(body.error).toBe("wrong_keep_count");
    });

    it("lehnt eine Karte ab, die nicht angeboten war", async () => {
        const app = makeApp();
        const a = await aufbau(app);
        await ziehen(app, a);

        const { status } = await req<any>(
            app, "POST", `/api/questions/${a.questionId}/keep`,
            { body: { behalten: ["gibt-es-nicht"] }, token: a.hiderToken },
        );

        expect(status).toBe(400);
    });

    it("lehnt ein zweites Behalten zur selben Frage ab", async () => {
        const app = makeApp();
        const a = await aufbau(app);
        const angeboten = await ziehen(app, a);
        await req<any>(
            app, "POST", `/api/questions/${a.questionId}/keep`,
            { body: { behalten: [angeboten[0].id] }, token: a.hiderToken, expectStatus: 200 },
        );

        const { status, body } = await req<any>(
            app, "POST", `/api/questions/${a.questionId}/draw`,
            { token: a.hiderToken },
        );

        expect(status).toBe(409);
        expect(body.error).toBe("already_kept");
    });

    it("wehrt die siebte Handkarte ab und lässt die Hand unverändert", async () => {
        const app = makeApp();
        const a = await aufbau(app);

        // Sechs Karten auf die Hand bringen: sechs Fragen, je eine behalten
        let letzte = a.questionId;
        for (let i = 0; i < 6; i++) {
            if (i > 0) {
                const { body: f } = await req<any>(
                    app, "POST", `/api/sessions/${a.code}/questions`,
                    { body: { type: "matching", data: {} }, token: a.seekerToken, expectStatus: 201 },
                );
                letzte = f.question.id;
                await req<any>(app, "POST", `/api/questions/${letzte}/answer`, {
                    body: { answerData: { ja: true } }, token: a.hiderToken, expectStatus: 200,
                });
            }
            const { body: d } = await req<any>(
                app, "POST", `/api/questions/${letzte}/draw`,
                { token: a.hiderToken, expectStatus: 200 },
            );
            await req<any>(app, "POST", `/api/questions/${letzte}/keep`, {
                body: { behalten: [d.angeboten[0].id] },
                token: a.hiderToken,
                expectStatus: 200,
            });
        }

        // Siebte Frage, siebte Karte ohne Abwurf
        const { body: f7 } = await req<any>(
            app, "POST", `/api/sessions/${a.code}/questions`,
            { body: { type: "matching", data: {} }, token: a.seekerToken, expectStatus: 201 },
        );
        await req<any>(app, "POST", `/api/questions/${f7.question.id}/answer`, {
            body: { answerData: { ja: true } }, token: a.hiderToken, expectStatus: 200,
        });
        const { body: d7 } = await req<any>(
            app, "POST", `/api/questions/${f7.question.id}/draw`,
            { token: a.hiderToken, expectStatus: 200 },
        );

        const { status, body } = await req<any>(
            app, "POST", `/api/questions/${f7.question.id}/keep`,
            { body: { behalten: [d7.angeboten[0].id] }, token: a.hiderToken },
        );

        expect(status).toBe(409);
        expect(body.error).toBe("hand_limit");
        expect(body.ueberzaehlig).toBe(1);
    });

    it("nimmt die siebte Karte an, wenn eine abgeworfen wird", async () => {
        const app = makeApp();
        const a = await aufbau(app);

        let letzte = a.questionId;
        const handIds: string[] = [];
        for (let i = 0; i < 6; i++) {
            if (i > 0) {
                const { body: f } = await req<any>(
                    app, "POST", `/api/sessions/${a.code}/questions`,
                    { body: { type: "matching", data: {} }, token: a.seekerToken, expectStatus: 201 },
                );
                letzte = f.question.id;
                await req<any>(app, "POST", `/api/questions/${letzte}/answer`, {
                    body: { answerData: { ja: true } }, token: a.hiderToken, expectStatus: 200,
                });
            }
            const { body: d } = await req<any>(
                app, "POST", `/api/questions/${letzte}/draw`,
                { token: a.hiderToken, expectStatus: 200 },
            );
            handIds.push(d.angeboten[0].id);
            await req<any>(app, "POST", `/api/questions/${letzte}/keep`, {
                body: { behalten: [d.angeboten[0].id] }, token: a.hiderToken, expectStatus: 200,
            });
        }

        const { body: f7 } = await req<any>(
            app, "POST", `/api/sessions/${a.code}/questions`,
            { body: { type: "matching", data: {} }, token: a.seekerToken, expectStatus: 201 },
        );
        await req<any>(app, "POST", `/api/questions/${f7.question.id}/answer`, {
            body: { answerData: { ja: true } }, token: a.hiderToken, expectStatus: 200,
        });
        const { body: d7 } = await req<any>(
            app, "POST", `/api/questions/${f7.question.id}/draw`,
            { token: a.hiderToken, expectStatus: 200 },
        );

        const { body } = await req<any>(
            app, "POST", `/api/questions/${f7.question.id}/keep`,
            {
                body: { behalten: [d7.angeboten[0].id], abwerfen: [handIds[0]] },
                token: a.hiderToken,
                expectStatus: 200,
            },
        );

        expect(body.hand).toHaveLength(6);
        expect(body.hand.map((k: any) => k.id)).not.toContain(handIds[0]);
    });

    it("lehnt doppelte Kennungen beim Abwerfen ab und lässt die Hand unverändert", async () => {
        const app = makeApp();
        const a = await aufbau(app);

        // Sechs Karten auf die Hand bringen: sechs Fragen, je eine behalten
        let letzte = a.questionId;
        const handIds: string[] = [];
        for (let i = 0; i < 6; i++) {
            if (i > 0) {
                const { body: f } = await req<any>(
                    app, "POST", `/api/sessions/${a.code}/questions`,
                    { body: { type: "matching", data: {} }, token: a.seekerToken, expectStatus: 201 },
                );
                letzte = f.question.id;
                await req<any>(app, "POST", `/api/questions/${letzte}/answer`, {
                    body: { answerData: { ja: true } }, token: a.hiderToken, expectStatus: 200,
                });
            }
            const { body: d } = await req<any>(
                app, "POST", `/api/questions/${letzte}/draw`,
                { token: a.hiderToken, expectStatus: 200 },
            );
            handIds.push(d.angeboten[0].id);
            await req<any>(app, "POST", `/api/questions/${letzte}/keep`, {
                body: { behalten: [d.angeboten[0].id] },
                token: a.hiderToken,
                expectStatus: 200,
            });
        }

        // Tentakel-Frage: 4 ziehen, 2 behalten
        const { body: fT } = await req<any>(
            app, "POST", `/api/sessions/${a.code}/questions`,
            { body: { type: "tentacles", data: {} }, token: a.seekerToken, expectStatus: 201 },
        );
        await req<any>(app, "POST", `/api/questions/${fT.question.id}/answer`, {
            body: { answerData: { ja: true } }, token: a.hiderToken, expectStatus: 200,
        });
        const { body: dT } = await req<any>(
            app, "POST", `/api/questions/${fT.question.id}/draw`,
            { token: a.hiderToken, expectStatus: 200 },
        );

        // Fünfmal dieselbe Handkarte abwerfen: die Rechnung mit Array-Längen
        // würde 6 - 5 + 2 = 3 ergeben, tatsächlich abgeworfen wird nur eine.
        const { status, body } = await req<any>(
            app, "POST", `/api/questions/${fT.question.id}/keep`,
            {
                body: {
                    behalten: [dT.angeboten[0].id, dT.angeboten[1].id],
                    abwerfen: [handIds[0], handIds[0], handIds[0], handIds[0], handIds[0]],
                },
                token: a.hiderToken,
            },
        );

        expect(status).toBe(400);
        expect(body.error).toBe("duplicate_cards");

        // Nachweis, dass die Hand unverändert ist: derselbe Zug lässt sich mit
        // zwei verschiedenen abzuwerfenden Karten jetzt sauber abschließen —
        // wäre handIds[0] beim abgelehnten Versuch schon abgelegt worden,
        // schlüge das mit not_in_hand fehl.
        const { body: erfolg } = await req<any>(
            app, "POST", `/api/questions/${fT.question.id}/keep`,
            {
                body: {
                    behalten: [dT.angeboten[0].id, dT.angeboten[1].id],
                    abwerfen: [handIds[0], handIds[1]],
                },
                token: a.hiderToken,
                expectStatus: 200,
            },
        );
        expect(erfolg.hand).toHaveLength(6);
    });

    it("lehnt doppelte Kennungen beim Behalten ab", async () => {
        const app = makeApp();
        const a = await aufbau(app, "tentacles");

        const { body: d } = await req<any>(
            app, "POST", `/api/questions/${a.questionId}/draw`,
            { token: a.hiderToken, expectStatus: 200 },
        );

        const { status, body } = await req<any>(
            app, "POST", `/api/questions/${a.questionId}/keep`,
            {
                body: { behalten: [d.angeboten[0].id, d.angeboten[0].id] },
                token: a.hiderToken,
            },
        );

        expect(status).toBe(400);
        expect(body.error).toBe("duplicate_cards");
    });
});
