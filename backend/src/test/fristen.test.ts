/**
 * Fristen aus der Gebietsausdehnung.
 *
 * Erster Block prueft die Ableitung aus der rohen Spalte `sessions.map_location`
 * (lib/fristen.ts). Die beiden folgenden Bloecke pruefen, dass die beiden
 * Stellen, die eine Frage anlegen — die REST-Route und der WS-Handler — die
 * Rechnung wirklich benutzen.
 *
 * Die Integrationstests sprechen bewusst direkt mit `ctx.url` statt mit dem
 * `req()`-Helfer: `req()` schickt bei gesetztem BACKEND_URL an einen laufenden
 * Server, und diese Zusicherungen sollen in jedem Modus im Prozess bleiben.
 * `withTestApp` bindet dafuer einen freien Port (port 0 auf 127.0.0.1).
 */
import { describe, expect, it } from "vitest";

import {
    ausdehnungKmAusMapLocation,
    fristMsFuerFrage,
} from "../lib/fristen.js";
import { seedSession, withTestApp } from "./helpers.js";

const MINUTE = 60 * 1000;

// Hamburger Stadtteil, rund 1,5 km laengste Kante. Dieselben Zahlen wie in
// shared/src/__tests__/groessen.test.ts.
const STADTTEIL_EXTENT = [53.57, 10.02, 53.5592, 10.0427];
// Rund 30 km laengste Kante, also jenseits des oberen Ankers von 12 km.
const GROSS_EXTENT = [53.7, 9.8, 53.45, 10.25];

/** Baut den JSON-Text, wie ihn buildMapLocationFromContext() ablegt. */
function mapLocationJson(extent: number[] | undefined): string {
    return JSON.stringify({
        lat: 53.56,
        lng: 10.03,
        name: "Testgebiet",
        osmFeature: {
            type: "Feature",
            properties: extent ? { name: "Testgebiet", extent } : { name: "Testgebiet" },
            geometry: { type: "Point", coordinates: [10.03, 53.56] },
        },
    });
}

// ── Ableitung aus der Spalte ──────────────────────────────────────────────────

describe("ausdehnungKmAusMapLocation", () => {
    it("liest das Extent unter osmFeature.properties", () => {
        const km = ausdehnungKmAusMapLocation(mapLocationJson(STADTTEIL_EXTENT));
        expect(km).toBeCloseTo(1.5, 1);
    });

    it("gibt null ohne Spaltenwert", () => {
        expect(ausdehnungKmAusMapLocation(null)).toBeNull();
        expect(ausdehnungKmAusMapLocation(undefined)).toBeNull();
        expect(ausdehnungKmAusMapLocation("")).toBeNull();
    });

    it("gibt null bei unlesbarem JSON", () => {
        expect(ausdehnungKmAusMapLocation("{kaputt")).toBeNull();
        expect(ausdehnungKmAusMapLocation("nicht mal JSON")).toBeNull();
    });

    it("gibt null, wenn osmFeature fehlt", () => {
        // Diese Form kommt vor: aeltere Sitzungen und Testfixtures legen nur
        // lat/lng/name ab.
        const ohneFeature = JSON.stringify({ lat: 53.55, lng: 10.01, name: "Hamburg" });
        expect(ausdehnungKmAusMapLocation(ohneFeature)).toBeNull();
    });

    it("gibt null, wenn das Extent im Feature fehlt", () => {
        expect(ausdehnungKmAusMapLocation(mapLocationJson(undefined))).toBeNull();
    });
});

describe("fristMsFuerFrage", () => {
    it("kleines Gebiet: 3 Minuten, Foto 5 Minuten", () => {
        const mapLocation = mapLocationJson(STADTTEIL_EXTENT);
        expect(fristMsFuerFrage(mapLocation, "radius")).toBe(3 * MINUTE);
        expect(fristMsFuerFrage(mapLocation, "photo")).toBe(5 * MINUTE);
    });

    it("grosses Gebiet: 5 Minuten, Foto 15 Minuten", () => {
        const mapLocation = mapLocationJson(GROSS_EXTENT);
        expect(fristMsFuerFrage(mapLocation, "radius")).toBe(5 * MINUTE);
        expect(fristMsFuerFrage(mapLocation, "photo")).toBe(15 * MINUTE);
    });

    it("fehlendes mapLocation: die Festwerte 5 und 15 Minuten", () => {
        expect(fristMsFuerFrage(null, "radius")).toBe(5 * MINUTE);
        expect(fristMsFuerFrage(null, "photo")).toBe(15 * MINUTE);
    });

    it("unlesbarer JSON: die Festwerte 5 und 15 Minuten", () => {
        expect(fristMsFuerFrage("{kaputt", "radius")).toBe(5 * MINUTE);
        expect(fristMsFuerFrage("{kaputt", "photo")).toBe(15 * MINUTE);
    });

    it("alle Fragetypen ausser photo bekommen die kurze Frist", () => {
        const mapLocation = mapLocationJson(STADTTEIL_EXTENT);
        for (const typ of ["radius", "thermometer", "tentacles", "matching", "measuring"]) {
            expect(fristMsFuerFrage(mapLocation, typ)).toBe(3 * MINUTE);
        }
    });
});

// ── Die beiden Stellen, die eine Frage anlegen ───────────────────────────────

/** Verbleibende Frist in Minuten, aus dem ISO-Zeitpunkt der Antwort. */
function fristMinuten(deadline: string): number {
    return (new Date(deadline).getTime() - Date.now()) / MINUTE;
}

async function setzeGebiet(url: string, code: string, token: string, extent: number[]) {
    const res = await fetch(`${url}/api/sessions/${code}/map`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:4321",
            "x-participant-token": token,
        },
        body: JSON.stringify({ mapLocation: JSON.parse(mapLocationJson(extent)) }),
    });
    expect(res.status).toBe(200);
}

describe("REST: POST /sessions/:code/questions setzt die Frist aus dem Gebiet", () => {
    it("kleines Gebiet gibt 3 Minuten, Foto 5 Minuten", async () => {
        await withTestApp(async ({ url, app }) => {
            const { code, hider, seeker } = await seedSession(app);
            await setzeGebiet(url, code, hider.token, STADTTEIL_EXTENT);

            for (const [typ, erwartet] of [
                ["radius", 3],
                ["photo", 5],
            ] as const) {
                const res = await fetch(`${url}/api/sessions/${code}/questions`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Origin: "http://localhost:4321",
                        "x-participant-token": seeker.token,
                    },
                    body: JSON.stringify({ type: typ, data: { lat: 53.56, lng: 10.03 } }),
                });
                expect(res.status).toBe(201);
                const body = (await res.json()) as { question: { deadline: string } };
                expect(fristMinuten(body.question.deadline)).toBeCloseTo(erwartet, 1);
            }
        });
    });

    it("ohne Gebiet bleiben es 5 und 15 Minuten", async () => {
        await withTestApp(async ({ url, app }) => {
            // seedSession legt keine mapLocation an, die Spalte bleibt null.
            const { code, seeker } = await seedSession(app);

            for (const [typ, erwartet] of [
                ["radius", 5],
                ["photo", 15],
            ] as const) {
                const res = await fetch(`${url}/api/sessions/${code}/questions`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Origin: "http://localhost:4321",
                        "x-participant-token": seeker.token,
                    },
                    body: JSON.stringify({ type: typ, data: { lat: 53.56, lng: 10.03 } }),
                });
                expect(res.status).toBe(201);
                const body = (await res.json()) as { question: { deadline: string } };
                expect(fristMinuten(body.question.deadline)).toBeCloseTo(erwartet, 1);
            }
        });
    });
});

describe("WS: add_question setzt die Frist aus dem Gebiet", () => {
    it("kleines Gebiet gibt der Fotofrage 5 statt 15 Minuten", async () => {
        await withTestApp(async ({ url, app, makeWsClient }) => {
            const { code, hider, seeker } = await seedSession(app);
            await setzeGebiet(url, code, hider.token, STADTTEIL_EXTENT);

            const seekerWs = await makeWsClient(code, seeker.token);
            await seekerWs.waitFor((m) => m.type === "sync");

            seekerWs.send({
                type: "add_question",
                questionType: "photo",
                data: { lat: 53.56, lng: 10.03 },
            });
            const added = await seekerWs.waitFor((m) => m.type === "question_added");

            expect(fristMinuten(added.question.deadline)).toBeCloseTo(5, 1);
        });
    });

    it("ohne Gebiet bleibt die Fotofrage bei 15 Minuten", async () => {
        await withTestApp(async ({ app, makeWsClient }) => {
            const { code, seeker } = await seedSession(app);

            const seekerWs = await makeWsClient(code, seeker.token);
            await seekerWs.waitFor((m) => m.type === "sync");

            seekerWs.send({
                type: "add_question",
                questionType: "photo",
                data: { lat: 53.56, lng: 10.03 },
            });
            const added = await seekerWs.waitFor((m) => m.type === "question_added");

            expect(fristMinuten(added.question.deadline)).toBeCloseTo(15, 1);
        });
    });
});
