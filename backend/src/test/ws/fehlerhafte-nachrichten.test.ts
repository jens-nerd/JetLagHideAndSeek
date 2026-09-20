/**
 * Eine fehlerhafte WebSocket-Nachricht darf den Dienst nicht beenden.
 *
 * Vor der Reparatur lief die Nachricht in `handleWsMessage` bis zur Datenbank
 * durch, SQLite wies sie an einer Bedingung ab, und die geworfene Ablehnung
 * blieb ungefangen (`ws/attach.ts`). Node beendet den Prozess in dem Fall.
 * Alle Sitzungen auf dem Server fielen damit gleichzeitig aus, ausgelöst von
 * einem einzigen Paket eines beliebigen Teilnehmers.
 *
 * Die beiden Nachrichten stammen aus der Sicherheitslesung vom 20.09.2026 und
 * wurden dort gegen eine eigene Instanz nachgestellt.
 *
 * Gemessen wird hier ausdrücklich die unbehandelte Ablehnung selbst, nicht nur
 * der Tod des Prozesses: unter vitest liegt bereits ein eigener
 * `unhandledRejection`-Horcher, der Prozess überlebt hier also auch ohne die
 * Reparatur. Auf dem Server tut er das nicht.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { seedSession, withTestApp } from "../helpers.js";

let offeneAblehnungen: unknown[] = [];
const sammle = (grund: unknown) => {
    offeneAblehnungen.push(grund);
};

beforeEach(() => {
    offeneAblehnungen = [];
    process.on("unhandledRejection", sammle);
});

afterEach(() => {
    process.off("unhandledRejection", sammle);
});

/** Den Ereignisstapel leerlaufen lassen, damit späte Ablehnungen ankommen. */
const nachlauf = () => new Promise((r) => setTimeout(r, 50));

describe("Fehlerhafte WebSocket-Nachrichten", () => {
    it("fängt add_question ohne data ab (NOT NULL auf questions.data)", async () => {
        await withTestApp(async ({ app, makeWsClient }) => {
            const { code, seeker } = await seedSession(app);
            const ws = await makeWsClient(code, seeker.token);
            await ws.waitFor((m) => m.type === "sync");

            ws.send({ type: "add_question", questionType: "radius" });

            // Die Verbindung muss weiter bedienen …
            ws.send({ type: "ping" });
            expect(await ws.waitFor((m) => m.type === "pong")).toEqual({
                type: "pong",
            });

            // … und nichts darf als unbehandelte Ablehnung entkommen.
            await nachlauf();
            expect(offeneAblehnungen).toEqual([]);
        });
    });

    it("fängt set_status mit unbekanntem Wert ab (CHECK auf sessions.status)", async () => {
        await withTestApp(async ({ app, makeWsClient }) => {
            const { code, seeker } = await seedSession(app);
            const ws = await makeWsClient(code, seeker.token);
            await ws.waitFor((m) => m.type === "sync");

            ws.send({ type: "set_status", status: "beliebig" });

            ws.send({ type: "ping" });
            expect(await ws.waitFor((m) => m.type === "pong")).toEqual({
                type: "pong",
            });

            await nachlauf();
            expect(offeneAblehnungen).toEqual([]);
        });
    });

    it("bedient nach einer abgewiesenen Nachricht weiter gültige Anfragen", async () => {
        await withTestApp(async ({ app, makeWsClient }) => {
            const { code, seeker } = await seedSession(app);
            const ws = await makeWsClient(code, seeker.token);
            await ws.waitFor((m) => m.type === "sync");

            ws.send({ type: "add_question", questionType: "radius" });

            // Dieselbe Nachrichtenart, diesmal vollständig. Ein Fang, der die
            // Verbindung stumm schaltet, wäre keine Reparatur.
            ws.send({
                type: "add_question",
                questionType: "radius",
                data: { radius: 1, unit: "km" },
            });
            const added = await ws.waitFor((m) => m.type === "question_added");
            expect(added.question.type).toBe("radius");

            await nachlauf();
            expect(offeneAblehnungen).toEqual([]);
        });
    });
});
