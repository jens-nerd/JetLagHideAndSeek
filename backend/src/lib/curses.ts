/**
 * Flüche: Ablaufzeit berechnen, aktive Flüche lesen, Ablauf-Stups planen.
 *
 * Wichtig: Der Zustand eines Fluchs wird gerechnet, nicht gespeichert. Aktiv
 * heißt `ended_at IS NULL AND (expires_at IS NULL OR expires_at > jetzt)`.
 * Der Timer unten ist nur ein Stups an offene Clients; fällt er aus (etwa nach
 * einem Dienstneustart), stimmt die Anzeige trotzdem, weil jeder Client seinen
 * Countdown selbst aus expiresAt rechnet.
 */
import type { Fluch, Fragekategorie, Karte } from "@hideandseek/shared";
import {
    GLUECKSRAD_ID,
    NACHSCHLAG_ID,
    findeKarte,
    kategorienFuerSpielgroesse,
} from "@hideandseek/shared";
import { and, eq, gt, isNull } from "drizzle-orm";
import { randomInt } from "node:crypto";

import { schema } from "../db/schema.js";
import type { DbCurse } from "../db/schema.js";
import type { Db } from "../db/types.js";
import { wsManager } from "../ws/manager.js";

/**
 * Ablaufzeitpunkt aus der Kartendauer und der Spielgröße.
 * Ohne gesetzte Spielgröße gilt "M". Aufgabenflüche liefern null.
 */
export function berechneAblauf(
    karte: Karte,
    gameSize: "S" | "M" | "L" | null,
): string | null {
    if (!karte.dauerMin) return null;
    // Die Spalte sessions.game_size ist freier Text ohne CHECK, und beim
    // Anlegen einer Sitzung wird der Wert nicht geprueft. Ein unbekannter
    // Wert darf hier nicht zu NaN und einem 500er fuehren.
    const g = gameSize === "S" || gameSize === "L" ? gameSize : "M";
    const minuten = karte.dauerMin[g];
    return new Date(Date.now() + minuten * 60_000).toISOString();
}

/** Eine DB-Zeile in die Übertragungsform bringen. */
export function toFluch(row: DbCurse): Fluch {
    const karte = findeKarte(row.cardId);
    if (!karte) {
        throw new Error(`Unbekannte Kartenkennung in curses: ${row.cardId}`);
    }
    return {
        id: row.id,
        karte,
        playedAt: row.playedAt,
        expiresAt: row.expiresAt ?? null,
        endedAt: row.endedAt ?? null,
        endedBy: row.endedBy ?? null,
    };
}

/** Ein Fluch ist aktiv, solange er nicht beendet und nicht abgelaufen ist. */
export function istAktiv(row: DbCurse, jetzt = Date.now()): boolean {
    if (row.endedAt) return false;
    if (!row.expiresAt) return true;
    return new Date(row.expiresAt).getTime() > jetzt;
}

export async function getAktiveFlueche(
    db: Db,
    sessionId: string,
): Promise<Fluch[]> {
    const rows = await db.query.curses.findMany({
        where: eq(schema.curses.sessionId, sessionId),
        orderBy: (c, { asc }) => [asc(c.playedAt)],
    });
    const jetzt = Date.now();
    return rows.filter((r) => istAktiv(r, jetzt)).map(toFluch);
}

/**
 * Der laufende Nachschlag mit Restanwendungen, oder null.
 *
 * Ausdrücklich der älteste und ausdrücklich genau einer: im Deck liegt nur ein
 * Exemplar, zwei gleichzeitige kann es im echten Spiel also nicht geben. Wäre
 * hier trotzdem einer zu viel, soll er warten statt eine zweite Anwendung
 * derselben Frage zu kosten.
 */
export async function findeNachschlag(
    db: Db,
    sessionId: string,
): Promise<DbCurse | null> {
    const row = await db.query.curses.findFirst({
        where: and(
            eq(schema.curses.sessionId, sessionId),
            eq(schema.curses.cardId, NACHSCHLAG_ID),
            isNull(schema.curses.endedAt),
            gt(schema.curses.usesLeft, 0),
        ),
        orderBy: (c, { asc }) => [asc(c.playedAt)],
    });
    return row ?? null;
}

/**
 * Eine Anwendung abziehen. Bei null ist der Nachschlag ausgelaufen: ended_by
 * bekommt "ablauf", und curse_ended geht heraus — beim Nachschlag wegen
 * `geheim` nur an die Versteckenden. Gibt die Restanwendungen zurück.
 */
export async function verbraucheAnwendung(
    db: Db,
    sessionCode: string,
    row: DbCurse,
): Promise<number> {
    const rest = Math.max(0, (row.usesLeft ?? 0) - 1);
    await db
        .update(schema.curses)
        .set({ usesLeft: rest })
        .where(eq(schema.curses.id, row.id));
    if (rest > 0) return rest;

    const endedAt = new Date().toISOString();
    await db
        .update(schema.curses)
        .set({ endedAt, endedBy: "ablauf" })
        .where(eq(schema.curses.id, row.id));
    verwirfAblauf(row.id);

    const ereignis = {
        type: "curse_ended" as const,
        curseId: row.id,
        endedBy: "ablauf" as const,
        endedAt,
    };
    if (findeKarte(row.cardId)?.geheim) {
        wsManager.sendToRole(sessionCode, "hider", ereignis);
    } else {
        wsManager.broadcast(sessionCode, ereignis);
    }
    return rest;
}

/**
 * Das laufende Glücksrad einer Sitzung, oder null.
 *
 * Ausdrücklich das älteste: im Deck liegt nur ein Exemplar, zwei gleichzeitige
 * kann es im echten Spiel also nicht geben. Läge doch eines zu viel, soll die
 * Sperre an einem Rad hängen bleiben, statt bei jeder Frage zwischen zweien
 * hin und her zu springen.
 */
export async function findeGluecksrad(
    db: Db,
    sessionId: string,
): Promise<DbCurse | null> {
    const row = await db.query.curses.findFirst({
        where: and(
            eq(schema.curses.sessionId, sessionId),
            eq(schema.curses.cardId, GLUECKSRAD_ID),
            isNull(schema.curses.endedAt),
        ),
        orderBy: (c, { asc }) => [asc(c.playedAt)],
    });
    return row ?? null;
}

/**
 * Eine Kategorie auslosen, am Fluch festhalten und an alle verteilen — das
 * Glücksrad trägt kein `geheim`, beide Rollen sehen die Sperre.
 *
 * Gelost wird unabhängig, ohne Wiederholungssperre: dieselbe Kategorie darf
 * mehrmals hintereinander kommen, so steht es auf der Karte.
 */
export async function dreheGluecksrad(
    db: Db,
    sessionCode: string,
    row: DbCurse,
    gameSize: "S" | "M" | "L" | null,
): Promise<Fragekategorie> {
    const kategorien = kategorienFuerSpielgroesse(gameSize);
    const kategorie = kategorien[randomInt(kategorien.length)];
    await db
        .update(schema.curses)
        .set({ gesperrteKategorie: kategorie })
        .where(eq(schema.curses.id, row.id));
    wsManager.broadcast(sessionCode, {
        type: "locked_category",
        curseId: row.id,
        kategorie,
    });
    return kategorie;
}

/**
 * Beendet alle laufenden Flüche einer Sitzung: ended_at nachtragen, geplante
 * Ablauf-Stupse verwerfen, curse_ended verteilen. Geheime Flüche gehen dabei
 * weiterhin nur an die Versteckenden.
 */
export async function beendeAlleFlueche(
    db: Db,
    sessionCode: string,
    sessionId: string,
    endedBy: "ablauf" | "suchende" | "versteckender",
): Promise<void> {
    const laufende = await getAktiveFlueche(db, sessionId);
    const endedAt = new Date().toISOString();
    for (const fluch of laufende) {
        await db
            .update(schema.curses)
            .set({ endedAt, endedBy })
            .where(eq(schema.curses.id, fluch.id));
        verwirfAblauf(fluch.id);
        const ende = {
            type: "curse_ended" as const,
            curseId: fluch.id,
            endedBy,
            endedAt,
        };
        if (fluch.karte.geheim) {
            wsManager.sendToRole(sessionCode, "hider", ende);
        } else {
            wsManager.broadcast(sessionCode, ende);
        }
    }
}

/** In-Memory-Register der geplanten Stupse, damit nichts doppelt läuft. */
const stupse = new Map<string, NodeJS.Timeout>();

/**
 * Plant einen Stups zum Ablaufzeitpunkt: trägt ended_at nach und verteilt
 * curse_ended. Rein optional — die Richtigkeit hängt nicht daran.
 */
export function planeAblauf(
    db: Db,
    sessionCode: string,
    curseId: string,
    expiresAt: string,
): void {
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) return;
    // setTimeout kippt oberhalb von ~24,8 Tagen; so lange läuft kein Fluch.
    const timer = setTimeout(() => {
        stupse.delete(curseId);
        void (async () => {
            const row = await db.query.curses.findFirst({
                where: eq(schema.curses.id, curseId),
            });
            if (!row || row.endedAt) return;
            const endedAt = new Date().toISOString();
            await db
                .update(schema.curses)
                .set({ endedAt, endedBy: "ablauf" })
                .where(eq(schema.curses.id, curseId));
            const ereignis = {
                type: "curse_ended" as const,
                curseId,
                endedBy: "ablauf" as const,
                endedAt,
            };
            if (findeKarte(row.cardId)?.geheim) {
                wsManager.sendToRole(sessionCode, "hider", ereignis);
            } else {
                wsManager.broadcast(sessionCode, ereignis);
            }
        })();
    }, ms);
    // Der Stups darf den Prozess nicht am Beenden hindern (wichtig für Tests).
    timer.unref?.();
    stupse.set(curseId, timer);
}

/** Einen geplanten Stups verwerfen, wenn der Fluch vorher endet. */
export function verwirfAblauf(curseId: string): void {
    const timer = stupse.get(curseId);
    if (timer) {
        clearTimeout(timer);
        stupse.delete(curseId);
    }
}
