/**
 * Prüft, dass die Kartenmechanik pro Sitzung an- und abgeschaltet werden kann
 * und dass sie ohne ausdrückliche Angabe aus ist.
 */
import type { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { createTestApp, createTestDb, req } from "../helpers.js";

function makeApp(): Hono {
    return createTestApp(createTestDb());
}

describe("cardsEnabled bei der Sitzungsgründung", () => {
    it("ist aus, wenn nichts angegeben wird", async () => {
        const app = makeApp();
        const { body } = await req<any>(app, "POST", "/api/sessions", {
            body: { displayName: "Hider Hans" },
            expectStatus: 201,
        });
        expect(body.session.cardsEnabled).toBe(false);
    });

    it("ist an, wenn cardsEnabled true übergeben wird", async () => {
        const app = makeApp();
        const { body } = await req<any>(app, "POST", "/api/sessions", {
            body: { displayName: "Hider Hans", cardsEnabled: true },
            expectStatus: 201,
        });
        expect(body.session.cardsEnabled).toBe(true);
    });

    it("liefert den Wert auch bei GET wieder aus", async () => {
        const app = makeApp();
        const { body: created } = await req<any>(app, "POST", "/api/sessions", {
            body: { displayName: "Hider Hans", cardsEnabled: true },
            expectStatus: 201,
        });
        const { body } = await req<any>(
            app,
            "GET",
            `/api/sessions/${created.session.code}`,
            { expectStatus: 200 },
        );
        expect(body.session.cardsEnabled).toBe(true);
    });
});
