# Kartenhand und Flüche — Umsetzungsplan

> **Für agentische Arbeiter:** ERFORDERLICHE UNTER-SKILL: `superpowers:subagent-driven-development` (empfohlen) oder `superpowers:executing-plans`, um diesen Plan Aufgabe für Aufgabe abzuarbeiten. Schritte benutzen Kästchen (`- [ ]`) zur Verfolgung.

**Ziel:** Der Versteckende zieht nach beantworteten Fragen Karten, hält eine Hand von höchstens sechs Karten und spielt Flüche gegen die Suchenden aus; die Mechanik ist pro Sitzung im Onboarding abschaltbar.

**Architektur:** Das Deck liegt serverseitig in SQLite, eine Zeile je Kartenexemplar. Ziehen läuft zweistufig als „N ansehen, M behalten", damit ein Verbindungsabbruch keine Karten verschluckt. Ein Fluch gilt als aktiv, solange kein Ende eingetragen ist und der Ablaufzeitpunkt in der Zukunft liegt — gerechnet bei jedem Lesen, nicht von einem Timer abhängig. Die Clients rechnen ihre Countdowns selbst aus ISO-Zeitstempeln.

**Technik:** Astro 5 + React + nanostores (Frontend), Hono + better-sqlite3 + Drizzle (Backend), `ws` für WebSockets, vitest, pnpm-10-Workspace mit Node 20.

**Spec:** `docs/superpowers/specs/2026-09-19-kartenhand-und-flueche-design.md`

## Globale Vorgaben

Diese Punkte gelten für **jede** Aufgabe:

- **Keine Zod-Prüfung von Request-Körpern.** Das Backend prüft von Hand mit `if (!body.x) return c.json({ error: "..." }, 400)`. Muster: `backend/src/routes/questions.ts`. Nicht brechen.
- **Autorisierung** immer über den Header `x-participant-token`, aufgelöst gegen `participants.token` **und** `participants.sessionId`. Muster: `resolveParticipant()` am Ende von `backend/src/routes/questions.ts`.
- **Migrationen** kommen als neuer Eintrag ans Ende des `MIGRATIONS`-Arrays in `backend/src/db/migrator.ts`, in aufsteigender Reihenfolge, idempotent über `columnNames()` bzw. `CREATE TABLE IF NOT EXISTS`. `CURRENT_SCHEMA_VERSION` wird mitgezogen.
- **Deckumfang: genau 77 Karten** — 28 Flüche (je ein Exemplar) und 49 Zeitboni. Powerups und Stationsfallen gehören **nicht** ins Deck.
- **Handlimit: 6 Karten.**
- **Fehlerkennungen** sind wörtlich einzuhalten: `cards_disabled` (409), `hand_limit` (409), `already_kept` (409), `already_ended` (409), `duplicate_cards` (400).
- **Oberflächentexte** laufen über `tr("schlüssel")`. Jeder neue Schlüssel kommt in `src/i18n/de.ts` **und** `src/i18n/en.ts`. Fehlt er in einer der beiden Dateien, ist die Aufgabe nicht fertig.
- **Kartentexte bleiben deutsch**, auch bei englischer Oberfläche. Sie werden nicht durch `tr()` geschleust.
- **Stil neuer Sitzungs-Bauteile:** Inline-Stile wie in `src/components/session/SessionQuestionPanel.tsx` und `src/components/AnswerOverlay.tsx`, mit den CSS-Variablen `--color-primary`, `--color-panel`, `--radius-default`, `--radius-pill`. Keine neuen Tailwind-Utility-Klassen-Kaskaden in diesen Dateien.
- **Vor jedem Commit laufen:** `pnpm backend:build` und `pnpm run check`. Beides muss mit 0 enden.
- **Backend-Tests laufen über den Workspace-Filter**, nicht über die Wurzel:
  `pnpm --filter @hideandseek/backend test <pfad relativ zu backend/>`. Die
  Wurzel-`vitest.config.ts` schließt `backend/**` ausdrücklich aus — ein
  `pnpm vitest run backend/…` findet **keine** Testdatei und endet still mit 1.
  Frontend-Tests laufen dagegen über die Wurzel: `pnpm vitest run src/…`.
- **Commit-Nachrichten auf Deutsch**, ohne Umlaute im Betreff (das Repo schreibt `Flueche`, `pruefen`), und enden mit:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FyNQKwGJJYxVZrmyEh4GfF
  ```
- **Nicht bauen:** Powerups, Stationsfallen, die Regel „nur ein Sperrfluch gleichzeitig", Zielpersonenauswahl, Zeitkonto, Push-Benachrichtigungen, Übersetzung der Kartentexte.

## Dateiübersicht

| Datei | Zuständigkeit |
|---|---|
| `shared/src/karten.ts` | Kartentypen, die 77 Karten als Daten, Ziehkosten je Fragentyp, Übertragungstypen |
| `shared/src/__tests__/karten.test.ts` | Prüft Deckumfang und Vollständigkeit der Kartenfelder |
| `shared/src/types.ts` | ergänzt um `cardsEnabled` in `Session` und `CreateSessionRequest` |
| `shared/src/events.ts` | ergänzt um `curse_played`, `curse_ended`, `hand_updated` und die neuen `sync`-Felder |
| `backend/src/db/migrator.ts` | Migration 7 |
| `backend/src/db/schema.ts` | Drizzle-Tabellen `deckCards`, `curses`, Spalte `cardsEnabled` |
| `backend/src/lib/deck.ts` | Deckaufbau, Mischen, Ziehen, Ablage zurückmischen, Handabfrage |
| `backend/src/lib/curses.ts` | Ablaufzeit berechnen, aktive Flüche lesen, Ablauf-Stups planen |
| `backend/src/routes/cards.ts` | die vier Endpunkte |
| `backend/src/routes/sessions.ts` | `cardsEnabled` bei der Gründung |
| `backend/src/ws/handler.ts` | `sync` um die Kartenfelder erweitern |
| `src/lib/deck-context.ts` | nanostores-Atome für Hand, Deckrest, offener Zug, laufende Flüche |
| `src/lib/cards-api.ts` | typisierte Aufrufe der vier Endpunkte |
| `src/components/session/cards/KartenReiter.tsx` | Reiterinhalt Hand (Versteckender) bzw. Flüche (Suchende) |
| `src/components/session/cards/ZiehSchirm.tsx` | Vollbild „N ansehen, M behalten" |
| `src/components/session/cards/KartenAnsicht.tsx` | eine Karte im Volltext, mit Ausspielen bzw. Abwerfen |
| `src/components/session/cards/FluchListe.tsx` | laufende Flüche mit Countdown oder „erledigt" |
| `src/components/session/cards/FluchOverlay.tsx` | Vollbild-Einschlag bei den Suchenden |
| `src/components/settings/GeneralSettings.tsx` | Schalter, um die Mechanik mitten im Spiel umzulegen |

---

## Task 1: Kartendaten

**Dateien:**
- Erstellen: `shared/src/karten.ts`
- Erstellen: `shared/src/__tests__/karten.test.ts`
- Ändern: `shared/src/index.ts` (Re-Export)
- Quelle (nur lesen): `/Users/jensvielhaben-nl001/Desktop/Persönliche Assistenz/Jens Inbox/2026-09-19_hideandseek-Kartensatz/kartensatz.md`

**Schnittstellen:**
- Liefert: `Karte`, `Kartenart`, `Fluchgruppe`, `HandKarte`, `Fluch`, `PendingDraw`, `KARTEN`, `CARD_COSTS`, `getCardCost(type)`, `findeKarte(id)`

**Wichtig zur Quelle:** In `kartensatz.md` steht jede Karte als `### Name` mit Absätzen darunter. Die Absätze, die mit `Kosten:`, `Nachweis:`, `Ausweichregel:` oder `Dauer:` beginnen, sind die jeweiligen Felder; alle übrigen Absätze zusammen sind `text`. Eine Karte mit dem Satz „Einmaliger Effekt, keine Dauer." bekommt `dauerMin: null`. Die Fluchgruppen stehen als `##`-Überschriften über den Karten (`## Aufgabenflüche` → `"aufgabe"`, `## Gegenstandsflüche` → `"gegenstand"`, `## Bewegungsflüche` → `"bewegung"`, `## Absprachenflüche` → `"absprache"`, `## Informationsflüche` → `"information"`, `## Fragensperren` → `"fragensperre"`, `## Eigenvorteil` → `"eigenvorteil"`). Die Zeitboni stehen unter `## Zeitboni` mit ihren Minutenwerten und Stückzahlen.

- [ ] **Schritt 1: Typen und leeres Deck anlegen**

Erstelle `shared/src/karten.ts`:

```ts
export type Kartenart = "zeitbonus" | "fluch";

export type Fluchgruppe =
    | "aufgabe"
    | "gegenstand"
    | "bewegung"
    | "absprache"
    | "information"
    | "fragensperre"
    | "eigenvorteil";

export interface Karte {
    /** Stabile Kennung, z. B. "fluch-brueckenzoll" oder "zeitbonus-10" */
    id: string;
    art: Kartenart;
    name: string;
    /** Haupttext, Absätze mit \n\n getrennt */
    text: string;
    kosten?: string;
    nachweis?: string;
    ausweichregel?: string;
    /** nur bei art === "fluch" */
    gruppe?: Fluchgruppe;
    /**
     * Laufzeit in Minuten je Spielgröße. `null` heißt Aufgabenfluch: läuft,
     * bis die Suchenden "erledigt" melden. Nur bei art === "fluch" gesetzt;
     * `undefined` ist ein Fehler und wird vom Test abgefangen.
     */
    dauerMin?: { S: number; M: number; L: number } | null;
    /** nur bei art === "zeitbonus": Minutenwert je Spielgröße */
    bonusMin?: { S: number; M: number; L: number };
    /**
     * Wörtliche Dauer-Angabe, wo sie sich nicht in Minuten ausdrücken lässt
     * ("bis Rundenende", "drei beantwortete Fragen").
     */
    dauerText?: string;
    /** Exemplare im Deck */
    anzahl: number;
}

/** Eine Karte, wie sie auf der Hand liegt. `id` ist die Exemplarkennung. */
export interface HandKarte {
    id: string;
    karte: Karte;
}

/** Ein gespielter Fluch, wie ihn beide Rollen sehen. */
export interface Fluch {
    id: string;
    karte: Karte;
    playedAt: string;
    /** ISO8601, oder null bei einem Aufgabenfluch */
    expiresAt: string | null;
    endedAt: string | null;
    endedBy: "ablauf" | "suchende" | "versteckender" | null;
}

/** Ein offener Ziehvorgang. */
export interface PendingDraw {
    questionId: string;
    angeboten: HandKarte[];
    behalten: number;
}

/**
 * Ziehkosten je Fragenkategorie: `draw` ansehen, `keep` behalten.
 * Umgezogen aus src/lib/card-costs.ts, weil das Backend sie auch braucht.
 */
export const CARD_COSTS: Record<string, { draw: number; keep: number }> = {
    radius:      { draw: 2, keep: 1 },
    matching:    { draw: 3, keep: 1 },
    measuring:   { draw: 3, keep: 1 },
    thermometer: { draw: 2, keep: 1 },
    photo:       { draw: 1, keep: 1 },
    tentacles:   { draw: 4, keep: 2 },
};

export function getCardCost(type: string): { draw: number; keep: number } | null {
    return CARD_COSTS[type] ?? null;
}

export const KARTEN: Karte[] = [];

const KARTEN_INDEX = new Map(KARTEN.map((k) => [k.id, k]));

export function findeKarte(id: string): Karte | undefined {
    return KARTEN_INDEX.get(id);
}
```

Ergänze in `shared/src/index.ts` die Zeile `export * from "./karten.js";`.

- [ ] **Schritt 2: Den Test schreiben, der das leere Deck ablehnt**

Erstelle `shared/src/__tests__/karten.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { KARTEN, findeKarte } from "../karten.js";

describe("Kartensatz", () => {
    it("enthält genau 77 Kartenexemplare", () => {
        const summe = KARTEN.reduce((n, k) => n + k.anzahl, 0);
        expect(summe).toBe(77);
    });

    it("enthält 28 Flüche, jeden genau einmal", () => {
        const flueche = KARTEN.filter((k) => k.art === "fluch");
        expect(flueche).toHaveLength(28);
        for (const f of flueche) {
            expect(f.anzahl, `${f.id} liegt mehrfach im Deck`).toBe(1);
        }
    });

    it("enthält 49 Zeitboni", () => {
        const summe = KARTEN.filter((k) => k.art === "zeitbonus")
            .reduce((n, k) => n + k.anzahl, 0);
        expect(summe).toBe(49);
    });

    it("vergibt jede Kennung nur einmal", () => {
        const ids = KARTEN.map((k) => k.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("gibt jedem Fluch eine Gruppe und eine ausdrückliche Dauer", () => {
        for (const f of KARTEN.filter((k) => k.art === "fluch")) {
            expect(f.gruppe, `${f.id} ohne Gruppe`).toBeDefined();
            // null ist erlaubt (Aufgabenfluch), undefined nicht
            expect(f.dauerMin, `${f.id} ohne Dauer-Angabe`).not.toBeUndefined();
            if (f.dauerMin !== null) {
                expect(f.dauerMin!.S).toBeGreaterThan(0);
                expect(f.dauerMin!.M).toBeGreaterThan(0);
                expect(f.dauerMin!.L).toBeGreaterThan(0);
            }
        }
    });

    it("gibt jedem Zeitbonus einen Minutenwert", () => {
        for (const z of KARTEN.filter((k) => k.art === "zeitbonus")) {
            expect(z.bonusMin, `${z.id} ohne Minutenwert`).toBeGreaterThan(0);
        }
    });

    it("gibt jeder Karte einen nichtleeren Text", () => {
        for (const k of KARTEN) {
            expect(k.text.trim().length, `${k.id} ohne Text`).toBeGreaterThan(0);
        }
    });

    it("findet Karten über findeKarte", () => {
        const erste = KARTEN[0];
        expect(findeKarte(erste.id)).toEqual(erste);
        expect(findeKarte("gibt-es-nicht")).toBeUndefined();
    });
});
```

- [ ] **Schritt 3: Test laufen lassen, er muss scheitern**

```bash
cd ~/hideandseek && pnpm vitest run shared/src/__tests__/karten.test.ts
```

Erwartet: FAIL, „expected 0 to be 77".

- [ ] **Schritt 4: Die 77 Karten eintragen**

Lies `kartensatz.md` vollständig und übertrage jede Karte nach dem oben beschriebenen Absatzmuster in das `KARTEN`-Array. Kennungen entstehen aus dem Namen in Kleinschreibung mit Bindestrichen und ohne Umlaute, mit dem Präfix `fluch-` bzw. `zeitbonus-`: „Brückenzoll" → `fluch-brueckenzoll`, „Pi mal Daumen" → `fluch-pi-mal-daumen`. Zeitboni heißen nach ihrem Minutenwert: `zeitbonus-5`, `zeitbonus-10` und so weiter.

Beispiel für einen Fluch mit Dauer:

```ts
{
    id: "fluch-rechtsdrall",
    art: "fluch",
    gruppe: "bewegung",
    name: "Rechtsdrall",
    text: "An jeder Kreuzung dürfen die Suchenden nur rechts abbiegen oder geradeaus weitergehen. Links ist gesperrt.\n\nAls rechts zählt jede Straße, die in irgendeinem Winkel nach rechts abgeht. Geht in einer Sackgasse 300 Meter lang weder geradeaus noch rechts, dürfen sie umdrehen.\n\nEine Kreuzung ist jede Stelle, an der sie von ihrer Straße auf eine andere Straße mit Namen abbiegen könnten. Eine Hofeinfahrt, ein Parkplatzausgang und ein Trampelpfad sind keine.\n\nDer Fluch greift nur an Straßenkreuzungen. In Gebäuden, auf Bahnsteigen und in Grünanlagen ohne festes Wegenetz gilt er nicht.",
    kosten: "1 Karte.",
    dauerMin: { S: 20, M: 40, L: 60 },
    anzahl: 1,
},
```

Beispiel für einen Aufgabenfluch:

```ts
{
    id: "fluch-brueckenzoll",
    art: "fluch",
    gruppe: "aufgabe",
    name: "Brückenzoll",
    text: "Die Suchenden fragen erst weiter, wenn sie unter einer Brücke stehen. Von dort muss die nächste Frage kommen, und sie schicken dir ein Foto nach oben als Beleg.",
    kosten: "Die Suchenden müssen mindestens 1,5 / 8 / 50 Kilometer von dir entfernt sein.",
    ausweichregel: "Unterführungen, Bahnbrücken, Fußgängerbrücken und Tunneleinfahrten zählen. Ein Vordach oder ein Bahnsteigdach nicht. Im Zweifel entscheidet die Karten-App: Über ihnen muss ein Weg verlaufen, der dort eingezeichnet ist.",
    dauerMin: null,
    anzahl: 1,
},
```

Beispiel für einen Zeitbonus:

```ts
{
    id: "zeitbonus-10",
    art: "zeitbonus",
    name: "Anschluss weg",
    text: "Zählt nur, wenn die Karte am Rundenende noch auf deiner Hand liegt. Abgeworfen ist sie weg.",
    bonusMin: 10,
    anzahl: 13,
},
```

`Türsteher` trägt „Dauer: 0,5 / 1 / 3 Stunden" — das sind `{ S: 30, M: 60, L: 180 }` in Minuten. Alle Dauern werden in Minuten abgelegt, auch wenn die Karte von Stunden spricht.

- [ ] **Schritt 5: Test laufen lassen, er muss bestehen**

```bash
cd ~/hideandseek && pnpm vitest run shared/src/__tests__/karten.test.ts
```

Erwartet: PASS, acht Fälle.

- [ ] **Schritt 6: `src/lib/card-costs.ts` auf Re-Export umstellen**

Damit es die Tabelle nur einmal gibt. Ersetze den Inhalt von `src/lib/card-costs.ts` vollständig durch:

```ts
/**
 * Ziehkosten je Fragenkategorie.
 *
 * Die Tabelle steht in shared/src/karten.ts, weil das Backend sie beim Ziehen
 * ebenfalls braucht. Diese Datei bleibt als Re-Export bestehen, damit die
 * vorhandenen Aufrufstellen unverändert weiterlaufen.
 */
export { CARD_COSTS, getCardCost } from "@hideandseek/shared";
```

- [ ] **Schritt 7: Typen und Probebau prüfen**

```bash
cd ~/hideandseek && pnpm shared:build && pnpm backend:build && pnpm run check
```

Erwartet: alle drei enden mit 0.

- [ ] **Schritt 8: Committen**

```bash
cd ~/hideandseek
git add shared/src/karten.ts shared/src/__tests__/karten.test.ts shared/src/index.ts src/lib/card-costs.ts
git commit -m "feat(karten): deutschen Kartensatz als Daten hinterlegen

77 Karten, 28 Flueche und 49 Zeitboni, uebernommen aus kartensatz.md.
Ziehkosten ziehen nach shared/, weil das Backend sie beim Ziehen braucht;
src/lib/card-costs.ts bleibt als Re-Export.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FyNQKwGJJYxVZrmyEh4GfF"
```

---

## Task 2: Migration 7, Drizzle-Schema und der Schalter bei der Gründung

**Dateien:**
- Ändern: `backend/src/db/migrator.ts` (Zeile 3 und Ende des `MIGRATIONS`-Arrays)
- Ändern: `backend/src/db/schema.ts`
- Ändern: `shared/src/types.ts` (`Session`, `CreateSessionRequest`)
- Ändern: `backend/src/routes/sessions.ts` (`toSession`, `router.post("/")`)
- Test: `backend/src/test/rest/cards-schalter.test.ts`

**Schnittstellen:**
- Verbraucht: nichts aus Task 1
- Liefert: Tabellen `deck_cards` und `curses`, Spalte `sessions.cards_enabled`, Drizzle-Exporte `deckCards`, `curses`, Feld `cardsEnabled` in `Session` und `CreateSessionRequest`

- [ ] **Schritt 1: Den scheiternden Test schreiben**

Erstelle `backend/src/test/rest/cards-schalter.test.ts`:

```ts
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
```

- [ ] **Schritt 2: Test laufen lassen, er muss scheitern**

```bash
cd ~/hideandseek && pnpm --filter @hideandseek/backend test src/test/rest/cards-schalter.test.ts
```

Erwartet: FAIL, „expected undefined to be false".

- [ ] **Schritt 3: Migration 7 eintragen**

In `backend/src/db/migrator.ts` Zeile 3 ändern:

```ts
export const CURRENT_SCHEMA_VERSION = 7;
```

Und vor dem Kommentar `/* add future migrations here, in ascending version order */` einfügen:

```ts
    {
        // v7: Kartenmechanik — Schalter an sessions, Deck- und Fluchtabellen
        version: 7,
        up: (db) => {
            const cols = columnNames(db, "sessions");
            if (!cols.includes("cards_enabled")) {
                db.exec(
                    "ALTER TABLE sessions ADD COLUMN cards_enabled INTEGER NOT NULL DEFAULT 0",
                );
            }
            db.exec(`
                CREATE TABLE IF NOT EXISTS deck_cards (
                    id                   TEXT PRIMARY KEY,
                    session_id           TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    card_id              TEXT NOT NULL,
                    position             INTEGER NOT NULL,
                    state                TEXT NOT NULL
                                             CHECK(state IN ('deck','angeboten','hand','ablage','gespielt')),
                    draw_for_question_id TEXT,
                    updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE INDEX IF NOT EXISTS idx_deck_cards_session_state
                    ON deck_cards(session_id, state);

                CREATE TABLE IF NOT EXISTS curses (
                    id                       TEXT PRIMARY KEY,
                    session_id               TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    card_id                  TEXT NOT NULL,
                    played_by_participant_id TEXT NOT NULL REFERENCES participants(id),
                    played_at                TEXT NOT NULL DEFAULT (datetime('now')),
                    expires_at               TEXT,
                    ended_at                 TEXT,
                    ended_by                 TEXT
                                                 CHECK(ended_by IS NULL OR ended_by IN ('ablauf','suchende','versteckender'))
                );

                CREATE INDEX IF NOT EXISTS idx_curses_session ON curses(session_id);
            `);
        },
    },
```

- [ ] **Schritt 4: Drizzle-Schema ergänzen**

In `backend/src/db/schema.ts` die Spalte an `sessions` anhängen, direkt nach `gameSize`:

```ts
    /** Kartenmechanik für diese Sitzung eingeschaltet (0/1) */
    cardsEnabled: integer("cards_enabled", { mode: "boolean" })
        .notNull()
        .default(false),
```

Und nach der `questions`-Tabelle zwei neue Tabellen:

```ts
/**
 * Ein Kartenexemplar im Deck einer Sitzung. Eine Zeile je Exemplar, nicht je
 * Sorte: ein Zeitbonus mit anzahl 13 erzeugt 13 Zeilen mit derselben card_id.
 * `position` ist die Mischreihenfolge; gezogen wird die kleinste Position
 * unter den Zeilen mit state = 'deck'.
 */
export const deckCards = sqliteTable("deck_cards", {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
        .notNull()
        .references(() => sessions.id, { onDelete: "cascade" }),
    /** Kennung in KARTEN (shared/src/karten.ts) */
    cardId: text("card_id").notNull(),
    position: integer("position").notNull(),
    state: text("state", {
        enum: ["deck", "angeboten", "hand", "ablage", "gespielt"],
    }).notNull(),
    /** Gesetzt, solange state = 'angeboten' */
    drawForQuestionId: text("draw_for_question_id"),
    updatedAt: text("updated_at")
        .notNull()
        .default(sql`(datetime('now'))`),
});

/** Ein ausgespielter Fluch. */
export const curses = sqliteTable("curses", {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
        .notNull()
        .references(() => sessions.id, { onDelete: "cascade" }),
    cardId: text("card_id").notNull(),
    playedByParticipantId: text("played_by_participant_id")
        .notNull()
        .references(() => participants.id),
    playedAt: text("played_at")
        .notNull()
        .default(sql`(datetime('now'))`),
    /** ISO8601, null bei einem Aufgabenfluch */
    expiresAt: text("expires_at"),
    endedAt: text("ended_at"),
    endedBy: text("ended_by", {
        enum: ["ablauf", "suchende", "versteckender"],
    }),
});
```

Das `schema`-Sammelobjekt und die Typhelfer am Dateiende erweitern:

```ts
export const schema = { sessions, participants, questions, wsEvents, deckCards, curses };

export type DbDeckCard = typeof deckCards.$inferSelect;
export type NewDeckCard = typeof deckCards.$inferInsert;
export type DbCurse = typeof curses.$inferSelect;
export type NewCurse = typeof curses.$inferInsert;
```

- [ ] **Schritt 5: Gemeinsame Typen ergänzen**

In `shared/src/types.ts`, im `Session`-Interface nach `gameSize`:

```ts
    /** Kartenmechanik für diese Sitzung eingeschaltet */
    cardsEnabled: boolean;
```

Und im `CreateSessionRequest`-Interface:

```ts
    /** Kartenmechanik einschalten. Ohne Angabe: aus. */
    cardsEnabled?: boolean;
```

- [ ] **Schritt 6: Gründungsroute und `toSession` anpassen**

In `backend/src/routes/sessions.ts` in `toSession(row)` das Feld mit ausliefern:

```ts
        cardsEnabled: row.cardsEnabled,
```

Und in `router.post("/")` beim Einfügen der Sitzung, direkt nach `gameSize`:

```ts
            cardsEnabled: body.cardsEnabled === true,
```

Der Vergleich auf `=== true` ist Absicht: Ein fehlendes Feld, `null` oder ein String darf die Mechanik nicht einschalten.

- [ ] **Schritt 7: Tests laufen lassen**

```bash
cd ~/hideandseek && pnpm --filter @hideandseek/backend test src/test/rest/cards-schalter.test.ts && pnpm --filter @hideandseek/backend test src/db/migrator.test.ts
```

Erwartet: beide PASS. Der vorhandene Migrator-Test prüft den Aufstieg über alle Versionen und muss weiter bestehen.

- [ ] **Schritt 8: Typen und Probebau prüfen, committen**

```bash
cd ~/hideandseek && pnpm shared:build && pnpm backend:build && pnpm run check
git add backend/src/db/migrator.ts backend/src/db/schema.ts shared/src/types.ts backend/src/routes/sessions.ts backend/src/test/rest/cards-schalter.test.ts
git commit -m "feat(karten): Migration 7 und Schalter bei der Sitzungsgruendung

Spalte cards_enabled an sessions, Tabellen deck_cards und curses.
Vorgabe 0, damit laufende Sitzungen nicht ploetzlich Karten bekommen.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FyNQKwGJJYxVZrmyEh4GfF"
```

---

## Task 3: Deck-Bibliothek

**Dateien:**
- Erstellen: `backend/src/lib/deck.ts`
- Test: `backend/src/test/deck.test.ts`

**Schnittstellen:**
- Verbraucht: `KARTEN`, `Karte`, `HandKarte` aus `@hideandseek/shared` (Task 1); Drizzle-Tabelle `deckCards` (Task 2)
- Liefert:
  - `buildDeck(db, sessionId): Promise<void>` — legt 77 Zeilen gemischt an, tut nichts, wenn schon Zeilen da sind
  - `drawTop(db, sessionId, questionId, n): Promise<HandKarte[]>` — setzt bis zu n Karten auf `angeboten`
  - `getHand(db, sessionId): Promise<HandKarte[]>`
  - `getDeckRest(db, sessionId): Promise<number>`
  - `toHandKarte(row): HandKarte`
  - `getAngeboten(db, sessionId, questionId): Promise<HandKarte[]>`
  - `getOffenerZug(db, sessionId): Promise<{ questionId, angeboten } | null>`

- [ ] **Schritt 1: Den scheiternden Test schreiben**

Erstelle `backend/src/test/deck.test.ts`:

```ts
/**
 * Prüft Deckaufbau, Ziehen und das Zurückmischen der Ablage.
 * Arbeitet direkt auf der Bibliothek, ohne HTTP.
 */
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";

import { createTestDb } from "./helpers.js";
import { schema } from "../db/schema.js";
import { buildDeck, drawTop, getDeckRest, getHand } from "../lib/deck.js";

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

        // n = 2 bei einer Karte im Deck: erst damit greift `deckRest < n`
        // und das Zurückmischen läuft überhaupt an. Mit n = 1 wäre der Test
        // trivial wahr, auch ohne den Filter für ausgespielte Karten.
        await drawTop(db, sessionId, "frage-1", 2);

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
```

- [ ] **Schritt 2: Test laufen lassen, er muss scheitern**

```bash
cd ~/hideandseek && pnpm --filter @hideandseek/backend test src/test/deck.test.ts
```

Erwartet: FAIL, „Cannot find module '../lib/deck.js'".

- [ ] **Schritt 3: Die Bibliothek schreiben**

Erstelle `backend/src/lib/deck.ts`:

```ts
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
```

- [ ] **Schritt 4: Test laufen lassen, er muss bestehen**

```bash
cd ~/hideandseek && pnpm --filter @hideandseek/backend test src/test/deck.test.ts
```

Erwartet: PASS, elf Fälle.

- [ ] **Schritt 5: Typen prüfen und committen**

```bash
cd ~/hideandseek && pnpm backend:build
git add backend/src/lib/deck.ts backend/src/test/deck.test.ts
git commit -m "feat(karten): Deck aufbauen, mischen und ziehen

Fisher-Yates mit crypto.randomInt, eine Zeile je Kartenexemplar.
Reicht das Deck nicht, wandert die Ablage zurueck; ausgespielte Flueche
bleiben draussen.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FyNQKwGJJYxVZrmyEh4GfF"
```

---

## Task 4: Endpunkte Ziehen und Behalten

**Dateien:**
- Erstellen: `backend/src/routes/cards.ts`
- Ändern: `backend/src/app.ts` (Router montieren)
- Ändern: `shared/src/events.ts` (`hand_updated`)
- Test: `backend/src/test/rest/cards-ziehen.test.ts`

**Schnittstellen:**
- Verbraucht: `buildDeck`, `drawTop`, `getHand`, `getDeckRest`, `getAngeboten` (Task 3); `getCardCost` (Task 1)
- Liefert: `POST /api/questions/:id/draw`, `POST /api/questions/:id/keep`, Ereignis `hand_updated`, Hilfsfunktion `ladeKartenKontext(db, ...)` für Task 5

- [ ] **Schritt 1: Ereignis ergänzen**

In `shared/src/events.ts` am Anfang die Typen einführen:

```ts
import type { Fluch, HandKarte } from "./karten.js";
```

und in die `ServerToClientEvent`-Union aufnehmen:

```ts
    | {
          /** Nur an den Versteckenden: seine Hand hat sich geändert. */
          type: "hand_updated";
          hand: HandKarte[];
          deckRest: number;
      }
```

- [ ] **Schritt 2: Den scheiternden Test schreiben**

Erstelle `backend/src/test/rest/cards-ziehen.test.ts`:

```ts
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
});
```

- [ ] **Schritt 3: Test laufen lassen, er muss scheitern**

```bash
cd ~/hideandseek && pnpm --filter @hideandseek/backend test src/test/rest/cards-ziehen.test.ts
```

Erwartet: FAIL, 404 auf `/draw`.

- [ ] **Schritt 4: Den Router schreiben**

Erstelle `backend/src/routes/cards.ts`:

```ts
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

        const hand = await getHand(db, sessionRow.id);
        const handIds = new Set(hand.map((k) => k.id));
        const abwerfen = body.abwerfen ?? [];
        if (!abwerfen.every((id) => handIds.has(id))) {
            return c.json({ error: "not_in_hand" }, 400);
        }

        const nachher = hand.length - abwerfen.length + body.behalten.length;
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
```

**Hinweis zum `drawForQuestionId` nach dem Behalten:** Die Kennung bleibt an den behaltenen und abgelegten Karten stehen. Genau daran erkennt der `draw`-Endpunkt beim nächsten Aufruf, dass zu dieser Frage schon behalten wurde (`already_kept`). Sie wird nur beim Zurückmischen der Ablage gelöscht.

- [ ] **Schritt 5: Router montieren**

In `backend/src/app.ts` den Import ergänzen:

```ts
import { createCardsRouter } from "./routes/cards.js";
```

und unter den übrigen `app.route`-Aufrufen:

```ts
    app.route("/api", createCardsRouter(db));
```

- [ ] **Schritt 6: Test laufen lassen, er muss bestehen**

```bash
cd ~/hideandseek && pnpm --filter @hideandseek/backend test src/test/rest/cards-ziehen.test.ts
```

Erwartet: PASS, 14 Fälle.

- [ ] **Schritt 7: Typen prüfen und committen**

```bash
cd ~/hideandseek && pnpm shared:build && pnpm backend:build
git add backend/src/routes/cards.ts backend/src/app.ts shared/src/events.ts backend/src/test/rest/cards-ziehen.test.ts
git commit -m "feat(karten): Ziehen und Behalten als Endpunkte

Zweistufig als N ansehen, M behalten. Ein zweiter draw-Aufruf liefert
dieselben Karten, damit ein Verbindungsabbruch nichts verschluckt.
Handlimit sechs wird vor dem Schreiben geprueft.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FyNQKwGJJYxVZrmyEh4GfF"
```

---

## Task 5: Flüche spielen und beenden

**Dateien:**
- Erstellen: `backend/src/lib/curses.ts`
- Ändern: `backend/src/routes/cards.ts` (zwei Endpunkte dazu)
- Ändern: `shared/src/events.ts` (`curse_played`, `curse_ended`)
- Test: `backend/src/test/rest/cards-flueche.test.ts`

**Schnittstellen:**
- Verbraucht: `getHand`, `sendeHand` (Task 4); `findeKarte` (Task 1)
- Liefert:
  - `berechneAblauf(karte, gameSize): string | null`
  - `toFluch(row): Fluch`
  - `getAktiveFlueche(db, sessionId): Promise<Fluch[]>`
  - `planeAblauf(db, sessionCode, curseId, expiresAt): void`
  - `POST /api/sessions/:code/curses`, `POST /api/curses/:id/end`

- [ ] **Schritt 1: Ereignisse ergänzen**

In `shared/src/events.ts` in die `ServerToClientEvent`-Union aufnehmen:

```ts
    | {
          /** An alle: der Versteckende hat einen Fluch ausgespielt. */
          type: "curse_played";
          curse: Fluch;
      }
    | {
          /** An alle: ein Fluch ist beendet — abgelaufen, erledigt oder aufgehoben. */
          type: "curse_ended";
          curseId: string;
          endedBy: "ablauf" | "suchende" | "versteckender";
          endedAt: string;
      }
```

- [ ] **Schritt 2: Den scheiternden Test schreiben**

Erstelle `backend/src/test/rest/cards-flueche.test.ts`:

```ts
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
```

- [ ] **Schritt 3: Test laufen lassen, er muss scheitern**

```bash
cd ~/hideandseek && pnpm --filter @hideandseek/backend test src/test/rest/cards-flueche.test.ts
```

Erwartet: FAIL, 404 auf `/curses`.

- [ ] **Schritt 4: Die Fluch-Bibliothek schreiben**

Erstelle `backend/src/lib/curses.ts`:

```ts
/**
 * Flüche: Ablaufzeit berechnen, aktive Flüche lesen, Ablauf-Stups planen.
 *
 * Wichtig: Der Zustand eines Fluchs wird gerechnet, nicht gespeichert. Aktiv
 * heißt `ended_at IS NULL AND (expires_at IS NULL OR expires_at > jetzt)`.
 * Der Timer unten ist nur ein Stups an offene Clients; fällt er aus (etwa nach
 * einem Dienstneustart), stimmt die Anzeige trotzdem, weil jeder Client seinen
 * Countdown selbst aus expiresAt rechnet.
 */
import type { Fluch, Karte } from "@hideandseek/shared";
import { findeKarte } from "@hideandseek/shared";
import { eq } from "drizzle-orm";

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
    // Weissliste statt ??: sessions.game_size ist freier Text ohne CHECK, und
    // die Gruendungsroute prueft den Wert nicht. Ein unbekannter Wert ergaebe
    // undefined, daraus NaN, daraus ein RangeError beim toISOString.
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
            wsManager.broadcast(sessionCode, {
                type: "curse_ended",
                curseId,
                endedBy: "ablauf",
                endedAt,
            });
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
```

- [ ] **Schritt 5: Die zwei Endpunkte an den Router hängen**

In `backend/src/routes/cards.ts` die Importe ergänzen:

```ts
import { nanoid } from "nanoid";
import {
    berechneAblauf,
    planeAblauf,
    toFluch,
    verwirfAblauf,
} from "../lib/curses.js";
import { findeKarte } from "@hideandseek/shared";
```

und vor `return router;` einfügen:

```ts
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
        });
        await db
            .update(schema.deckCards)
            .set({ state: "gespielt" })
            .where(eq(schema.deckCards.id, deckRow.id));

        const curseRow = (await db.query.curses.findFirst({
            where: eq(schema.curses.id, curseId),
        }))!;
        const curse = toFluch(curseRow);

        wsManager.broadcast(sessionRow.code, { type: "curse_played", curse });
        await sendeHand(db, sessionRow.code, sessionRow.id);

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

        wsManager.broadcast(sessionRow.code, {
            type: "curse_ended",
            curseId,
            endedBy,
            endedAt,
        });

        const aktualisiert = (await db.query.curses.findFirst({
            where: eq(schema.curses.id, curseId),
        }))!;
        return c.json({ curse: toFluch(aktualisiert) });
    });
```

- [ ] **Schritt 6: Test laufen lassen, er muss bestehen**

```bash
cd ~/hideandseek && pnpm --filter @hideandseek/backend test src/test/rest/cards-flueche.test.ts
```

Erwartet: PASS, elf Fälle.

- [ ] **Schritt 7: Typen prüfen und committen**

```bash
cd ~/hideandseek && pnpm shared:build && pnpm backend:build
git add backend/src/lib/curses.ts backend/src/routes/cards.ts shared/src/events.ts backend/src/test/rest/cards-flueche.test.ts
git commit -m "feat(karten): Flueche ausspielen und beenden

Ablaufzeit aus der Spielgroesse. Aktiv heisst gerechnet, nicht
gespeichert: ein Dienstneustart aendert nichts, der Timer ist nur ein
Stups an offene Clients.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FyNQKwGJJYxVZrmyEh4GfF"
```

---

## Task 6: `sync` erweitern und den Rollenfilter absichern

**Dateien:**
- Ändern: `shared/src/events.ts` (`sync`-Zweig)
- Ändern: `backend/src/ws/handler.ts` (`handleWsOpen`, um Zeile 157)
- Test: `backend/src/test/ws/cards-sync.test.ts`

**Schnittstellen:**
- Verbraucht: `getHand`, `getDeckRest`, `getOffenerZug` (Task 3); `getAktiveFlueche` (Task 5)
- Liefert: `sync` mit `cardsEnabled`, `activeCurses`, `hand`, `deckRest`, `pendingDraw`

- [ ] **Schritt 1: Den scheiternden Test schreiben**

Erstelle `backend/src/test/ws/cards-sync.test.ts`:

```ts
/**
 * Prüft, dass das sync-Ereignis die Kartenfelder mitbringt und dass die Hand
 * des Versteckenden niemals bei einem Suchenden ankommt.
 */
import { describe, expect, it } from "vitest";

import { req, withTestApp } from "../helpers.js";

async function sitzungMitKarten(app: any, cardsEnabled = true) {
    const { body: created } = await req<any>(app, "POST", "/api/sessions", {
        body: { displayName: "Hider Hans", gameSize: "M", cardsEnabled },
        expectStatus: 201,
    });
    const code = created.session.code as string;
    const { body: joined } = await req<any>(
        app, "POST", `/api/sessions/${code}/join`,
        { body: { role: "seeker", displayName: "Sucher Sven" }, expectStatus: 201 },
    );
    return {
        code,
        hiderToken: created.participant.token as string,
        seekerToken: joined.participant.token as string,
    };
}

/** Frage stellen, beantworten, ziehen, behalten. */
async function zieheEineKarte(app: any, s: any) {
    const { body: frage } = await req<any>(
        app, "POST", `/api/sessions/${s.code}/questions`,
        { body: { type: "matching", data: {} }, token: s.seekerToken, expectStatus: 201 },
    );
    const qid = frage.question.id;
    await req<any>(app, "POST", `/api/questions/${qid}/answer`, {
        body: { answerData: { ja: true } }, token: s.hiderToken, expectStatus: 200,
    });
    const { body: gezogen } = await req<any>(
        app, "POST", `/api/questions/${qid}/draw`,
        { token: s.hiderToken, expectStatus: 200 },
    );
    await req<any>(app, "POST", `/api/questions/${qid}/keep`, {
        body: { behalten: [gezogen.angeboten[0].id] },
        token: s.hiderToken,
        expectStatus: 200,
    });
    return qid;
}

describe("sync mit Kartenmechanik", () => {
    it("meldet cardsEnabled an beide Rollen", async () => {
        await withTestApp(async ({ app, makeWsClient }) => {
            const s = await sitzungMitKarten(app);
            const hider = await makeWsClient(s.code, s.hiderToken);
            const seeker = await makeWsClient(s.code, s.seekerToken);

            const hSync = await hider.waitFor((m) => m.type === "sync");
            const sSync = await seeker.waitFor((m) => m.type === "sync");

            expect(hSync.cardsEnabled).toBe(true);
            expect(sSync.cardsEnabled).toBe(true);
        });
    });

    it("schickt die Hand nur an den Versteckenden", async () => {
        await withTestApp(async ({ app, makeWsClient }) => {
            const s = await sitzungMitKarten(app);
            await zieheEineKarte(app, s);

            const hider = await makeWsClient(s.code, s.hiderToken);
            const seeker = await makeWsClient(s.code, s.seekerToken);

            const hSync = await hider.waitFor((m) => m.type === "sync");
            const sSync = await seeker.waitFor((m) => m.type === "sync");

            expect(hSync.hand).toHaveLength(1);
            expect(sSync.hand).toBeUndefined();
            expect(sSync.deckRest).toBeUndefined();
        });
    });

    it("schickt hand_updated nicht an Suchende", async () => {
        await withTestApp(async ({ app, makeWsClient }) => {
            const s = await sitzungMitKarten(app);
            const hider = await makeWsClient(s.code, s.hiderToken);
            const seeker = await makeWsClient(s.code, s.seekerToken);
            await hider.waitFor((m) => m.type === "sync");
            await seeker.waitFor((m) => m.type === "sync");

            await zieheEineKarte(app, s);

            // Der Versteckende bekommt es; der Suchende darf es nicht bekommen.
            await hider.waitFor((m) => m.type === "hand_updated");
            await expect(
                seeker.waitFor((m) => m.type === "hand_updated", { timeoutMs: 500 }),
            ).rejects.toThrow(/timed out/);
        });
    });

    it("bringt einen offenen Ziehvorgang im sync mit", async () => {
        await withTestApp(async ({ app, makeWsClient }) => {
            const s = await sitzungMitKarten(app);
            const { body: frage } = await req<any>(
                app, "POST", `/api/sessions/${s.code}/questions`,
                { body: { type: "tentacles", data: {} }, token: s.seekerToken, expectStatus: 201 },
            );
            await req<any>(app, "POST", `/api/questions/${frage.question.id}/answer`, {
                body: { answerData: { ort: "Hbf" } }, token: s.hiderToken, expectStatus: 200,
            });
            await req<any>(app, "POST", `/api/questions/${frage.question.id}/draw`, {
                token: s.hiderToken, expectStatus: 200,
            });

            const hider = await makeWsClient(s.code, s.hiderToken);
            const hSync = await hider.waitFor((m) => m.type === "sync");

            expect(hSync.pendingDraw.questionId).toBe(frage.question.id);
            expect(hSync.pendingDraw.angeboten).toHaveLength(4);
            expect(hSync.pendingDraw.behalten).toBe(2);
        });
    });

    it("verteilt curse_played an beide Rollen", async () => {
        await withTestApp(async ({ app, makeWsClient, db }) => {
            const s = await sitzungMitKarten(app);
            const hider = await makeWsClient(s.code, s.hiderToken);
            const seeker = await makeWsClient(s.code, s.seekerToken);
            await hider.waitFor((m) => m.type === "sync");
            await seeker.waitFor((m) => m.type === "sync");

            // Einen Fluch auf die Hand legen und ausspielen
            const { KARTEN } = await import("@hideandseek/shared");
            const { schema } = await import("../../db/schema.js");
            const { nanoid } = await import("nanoid");
            const fluch = KARTEN.find((k: any) => k.art === "fluch")!;
            const sessionRow = await db.query.sessions.findFirst({
                where: (t: any, { eq }: any) => eq(t.code, s.code),
            });
            const deckCardId = nanoid();
            await db.insert(schema.deckCards).values({
                id: deckCardId,
                sessionId: sessionRow!.id,
                cardId: fluch.id,
                position: 0,
                state: "hand",
            });

            await req<any>(app, "POST", `/api/sessions/${s.code}/curses`, {
                body: { deckCardId }, token: s.hiderToken, expectStatus: 201,
            });

            const beimSuchenden = await seeker.waitFor((m) => m.type === "curse_played");
            expect(beimSuchenden.curse.karte.name).toBe(fluch.name);
            await hider.waitFor((m) => m.type === "curse_played");
        });
    });

    it("lässt die Kartenfelder weg, wenn die Mechanik aus ist", async () => {
        await withTestApp(async ({ app, makeWsClient }) => {
            const s = await sitzungMitKarten(app, false);
            const hider = await makeWsClient(s.code, s.hiderToken);

            const hSync = await hider.waitFor((m) => m.type === "sync");

            expect(hSync.cardsEnabled).toBe(false);
            expect(hSync.hand).toBeUndefined();
            expect(hSync.activeCurses).toBeUndefined();
        });
    });
});
```

- [ ] **Schritt 2: Test laufen lassen, er muss scheitern**

```bash
cd ~/hideandseek && pnpm --filter @hideandseek/backend test src/test/ws/cards-sync.test.ts
```

Erwartet: FAIL, „expected undefined to be true".

- [ ] **Schritt 3: `sync` im gemeinsamen Typ erweitern**

In `shared/src/events.ts` im `sync`-Zweig nach `hidingZone` ergänzen:

```ts
          /** Kartenmechanik für diese Sitzung eingeschaltet */
          cardsEnabled: boolean;
          /** Laufende Flüche — nur gesetzt, wenn cardsEnabled */
          activeCurses?: Fluch[];
          /** Hand des Versteckenden — nur an den Versteckenden */
          hand?: HandKarte[];
          /** Verbleibende Karten im Deck — nur an den Versteckenden */
          deckRest?: number;
          /** Offener Ziehvorgang — nur an den Versteckenden */
          pendingDraw?: PendingDraw | null;
```

Und den Import oben um `PendingDraw` erweitern:

```ts
import type { Fluch, HandKarte, PendingDraw } from "./karten.js";
```

- [ ] **Schritt 4: `handleWsOpen` erweitern**

In `backend/src/ws/handler.ts` die Importe ergänzen:

```ts
import { getCardCost } from "@hideandseek/shared";
import { getDeckRest, getHand, getOffenerZug } from "../lib/deck.js";
import { getAktiveFlueche } from "../lib/curses.js";
```

Vor dem `ws.send(JSON.stringify({ type: "sync", ... }))` (um Zeile 157) die Kartenfelder zusammenstellen:

```ts
    // ── Kartenmechanik ────────────────────────────────────────────────────────
    const kartenFelder: Record<string, unknown> = {
        cardsEnabled: sessionRow.cardsEnabled,
    };
    if (sessionRow.cardsEnabled) {
        kartenFelder.activeCurses = await getAktiveFlueche(db, sessionRow.id);
        if (client.role === "hider") {
            kartenFelder.hand = await getHand(db, sessionRow.id);
            kartenFelder.deckRest = await getDeckRest(db, sessionRow.id);

            const offen = await getOffenerZug(db, sessionRow.id);
            let pendingDraw = null;
            if (offen) {
                const frage = await db.query.questions.findFirst({
                    where: eq(schema.questions.id, offen.questionId),
                });
                const kosten = frage ? getCardCost(frage.type) : null;
                // Ohne Frage oder ohne bekannte Ziehkosten laesst sich nicht
                // sagen, wie viele Karten zu behalten sind. Dann lieber keinen
                // Ziehschirm anbieten als eine geratene Zahl: der Server wuerde
                // die Auswahl sonst spaeter mit wrong_keep_count ablehnen.
                if (kosten) {
                    pendingDraw = {
                        questionId: offen.questionId,
                        angeboten: offen.angeboten,
                        behalten: Math.min(kosten.keep, offen.angeboten.length),
                    };
                }
            }
            kartenFelder.pendingDraw = pendingDraw;
        }
    }
```

Und die Felder in das `sync`-Objekt hineinstreuen, direkt nach `hidingZone`:

```ts
            hidingZone,
            ...kartenFelder,
        }),
    );
```

**Achtung:** Die Variable heißt im vorhandenen Code möglicherweise nicht `client`, sondern wird erst am Ende der Funktion gebaut. Lies `handleWsOpen` ganz und benutze die dort vorhandene Rollenvariable (die Funktion kennt die Rolle bereits, weil sie `participantRow.role` auflöst). Erfinde keine neue Variable.

- [ ] **Schritt 5: Test laufen lassen, er muss bestehen**

```bash
cd ~/hideandseek && pnpm --filter @hideandseek/backend test src/test/ws/cards-sync.test.ts
```

Erwartet: PASS, sechs Fälle.

- [ ] **Schritt 6: Alle Backend-Tests laufen lassen, Typen prüfen, committen**

```bash
cd ~/hideandseek && pnpm shared:build && pnpm backend:build && pnpm --filter @hideandseek/backend test
git add shared/src/events.ts backend/src/ws/handler.ts backend/src/test/ws/cards-sync.test.ts
git commit -m "feat(karten): Kartenzustand im sync-Ereignis mitschicken

Hand, Deckrest und offener Zug gehen nur an den Versteckenden, laufende
Flueche an beide. Ein Test weist nach, dass hand_updated keinen Suchenden
erreicht.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FyNQKwGJJYxVZrmyEh4GfF"
```

---

## Task 7: Frontend-Store und API-Client

**Dateien:**
- Erstellen: `src/lib/deck-context.ts`
- Erstellen: `src/lib/cards-api.ts`
- Ändern: `src/hooks/useSessionWebSocket.ts` (`switch`-Block ab Zeile 79)
- Ändern: `src/lib/session-context.ts` (`leaveSession()`)
- Test: `src/lib/__tests__/deck-context.test.ts`

**Schnittstellen:**
- Verbraucht: Ereignisse `hand_updated`, `curse_played`, `curse_ended` und die neuen `sync`-Felder (Task 6)
- Liefert:
  - Atome `cardsEnabled`, `hand`, `deckRest`, `pendingDraw`, `activeCurses`
  - `applyCardsSync(event)`, `applyHandUpdated(event)`, `applyCursePlayed(event)`, `applyCurseEnded(event)`, `resetDeckState()`
  - API: `ziehen(questionId, token)`, `behalten(questionId, token, body)`, `fluchSpielen(code, token, deckCardId)`, `fluchBeenden(curseId, token)`

- [ ] **Schritt 1: Den scheiternden Test schreiben**

Erstelle `src/lib/__tests__/deck-context.test.ts`:

```ts
/**
 * Prüft die Zustandsübergänge des Kartenstores. Reine Datenlogik, kein React.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
    activeCurses,
    applyCardsSync,
    applyCurseEnded,
    applyCursePlayed,
    applyHandUpdated,
    cardsEnabled,
    deckRest,
    hand,
    pendingDraw,
    resetDeckState,
} from "../deck-context";

const KARTE = {
    id: "fluch-test",
    art: "fluch" as const,
    name: "Testfluch",
    text: "Tu etwas.",
    gruppe: "aufgabe" as const,
    dauerMin: null,
    anzahl: 1,
};

const FLUCH = {
    id: "c1",
    karte: KARTE,
    playedAt: "2026-09-19T10:00:00.000Z",
    expiresAt: null,
    endedAt: null,
    endedBy: null,
};

describe("deck-context", () => {
    beforeEach(() => resetDeckState());

    it("startet leer und ausgeschaltet", () => {
        expect(cardsEnabled.get()).toBe(false);
        expect(hand.get()).toEqual([]);
        expect(deckRest.get()).toBe(0);
        expect(pendingDraw.get()).toBeNull();
        expect(activeCurses.get()).toEqual([]);
    });

    it("übernimmt die Kartenfelder aus dem sync-Ereignis", () => {
        applyCardsSync({
            cardsEnabled: true,
            hand: [{ id: "d1", karte: KARTE }],
            deckRest: 70,
            pendingDraw: null,
            activeCurses: [FLUCH],
        });

        expect(cardsEnabled.get()).toBe(true);
        expect(hand.get()).toHaveLength(1);
        expect(deckRest.get()).toBe(70);
        expect(activeCurses.get()).toHaveLength(1);
    });

    it("leert die Kartenfelder, wenn sync sie weglässt", () => {
        applyCardsSync({
            cardsEnabled: true,
            hand: [{ id: "d1", karte: KARTE }],
            deckRest: 70,
            activeCurses: [FLUCH],
        });
        // Zweites sync, etwa nach einem Rollenwechsel: keine Handfelder mehr
        applyCardsSync({ cardsEnabled: true, activeCurses: [] });

        expect(hand.get()).toEqual([]);
        expect(deckRest.get()).toBe(0);
        expect(activeCurses.get()).toEqual([]);
    });

    it("ersetzt die Hand bei hand_updated", () => {
        applyHandUpdated({ hand: [{ id: "d2", karte: KARTE }], deckRest: 69 });

        expect(hand.get().map((k) => k.id)).toEqual(["d2"]);
        expect(deckRest.get()).toBe(69);
    });

    it("hängt einen gespielten Fluch an", () => {
        applyCursePlayed({ curse: FLUCH });

        expect(activeCurses.get()).toHaveLength(1);
    });

    it("spielt denselben Fluch nicht doppelt ein", () => {
        applyCursePlayed({ curse: FLUCH });
        applyCursePlayed({ curse: FLUCH });

        expect(activeCurses.get()).toHaveLength(1);
    });

    it("entfernt einen beendeten Fluch", () => {
        applyCursePlayed({ curse: FLUCH });
        applyCurseEnded({
            curseId: "c1",
            endedBy: "suchende",
            endedAt: "2026-09-19T10:05:00.000Z",
        });

        expect(activeCurses.get()).toEqual([]);
    });

    it("ignoriert das Ende eines unbekannten Fluchs", () => {
        applyCursePlayed({ curse: FLUCH });
        applyCurseEnded({
            curseId: "gibt-es-nicht",
            endedBy: "ablauf",
            endedAt: "2026-09-19T10:05:00.000Z",
        });

        expect(activeCurses.get()).toHaveLength(1);
    });
});
```

- [ ] **Schritt 2: Test laufen lassen, er muss scheitern**

```bash
cd ~/hideandseek && pnpm vitest run src/lib/__tests__/deck-context.test.ts
```

Erwartet: FAIL, „Cannot find module '../deck-context'".

- [ ] **Schritt 3: Den Store schreiben**

Erstelle `src/lib/deck-context.ts`:

```ts
/**
 * Kartenmechanik im Frontend.
 *
 * Nichts davon liegt im localStorage: Der Server ist die Wahrheit, und das
 * sync-Ereignis beim Verbinden stellt den Zustand wieder her. Ein Neuladen
 * mitten im Spiel verliert also nichts.
 */
import type { Fluch, HandKarte, PendingDraw } from "@hideandseek/shared";
import { atom } from "nanostores";

/** Kartenmechanik in dieser Sitzung eingeschaltet. */
export const cardsEnabled = atom<boolean>(false);

/** Hand des Versteckenden. Bei Suchenden immer leer. */
export const hand = atom<HandKarte[]>([]);

/** Verbleibende Karten im Deck. */
export const deckRest = atom<number>(0);

/** Offener Ziehvorgang, falls der Versteckende gezogen, aber nicht behalten hat. */
export const pendingDraw = atom<PendingDraw | null>(null);

/** Laufende Flüche. Beide Rollen sehen dieselbe Liste. */
export const activeCurses = atom<Fluch[]>([]);

interface CardsSyncEvent {
    cardsEnabled: boolean;
    hand?: HandKarte[];
    deckRest?: number;
    pendingDraw?: PendingDraw | null;
    activeCurses?: Fluch[];
}

/**
 * Kartenfelder aus dem sync-Ereignis übernehmen.
 * Fehlende Felder werden geleert, nicht beibehalten — sonst bliebe die Hand
 * stehen, wenn der Server sie nicht mehr schickt.
 */
export function applyCardsSync(event: CardsSyncEvent): void {
    cardsEnabled.set(event.cardsEnabled);
    hand.set(event.hand ?? []);
    deckRest.set(event.deckRest ?? 0);
    pendingDraw.set(event.pendingDraw ?? null);
    activeCurses.set(event.activeCurses ?? []);
}

export function applyHandUpdated(event: {
    hand: HandKarte[];
    deckRest: number;
}): void {
    hand.set(event.hand);
    deckRest.set(event.deckRest);
    pendingDraw.set(null);
}

export function applyCursePlayed(event: { curse: Fluch }): void {
    const bisher = activeCurses.get();
    if (bisher.some((f) => f.id === event.curse.id)) return;
    activeCurses.set([...bisher, event.curse]);
}

export function applyCurseEnded(event: {
    curseId: string;
    endedBy: string;
    endedAt: string;
}): void {
    activeCurses.set(activeCurses.get().filter((f) => f.id !== event.curseId));
}

/** Alles zurücksetzen — beim Verlassen der Sitzung. */
export function resetDeckState(): void {
    cardsEnabled.set(false);
    hand.set([]);
    deckRest.set(0);
    pendingDraw.set(null);
    activeCurses.set([]);
}

/**
 * Summe der Bonusminuten auf der Hand, für die Spielgröße dieser Sitzung.
 * Reine Anzeige, wird nirgends verrechnet.
 */
export function bonusMinutenAufDerHand(
    karten: HandKarte[],
    gameSize: "S" | "M" | "L" | null,
): number {
    const g = gameSize ?? "M";
    return karten.reduce((n, k) => n + (k.karte.bonusMin?.[g] ?? 0), 0);
}
```

- [ ] **Schritt 4: Test laufen lassen, er muss bestehen**

```bash
cd ~/hideandseek && pnpm vitest run src/lib/__tests__/deck-context.test.ts
```

Erwartet: PASS, acht Fälle.

- [ ] **Schritt 5: Den API-Client schreiben**

Erstelle `src/lib/cards-api.ts`. Die Datei benutzt denselben `apiFetch`-Helfer wie `src/lib/session-api.ts`; exportiere ihn dort, falls er noch nicht exportiert ist (`export async function apiFetch` statt `async function apiFetch`).

```ts
/**
 * Aufrufe der Kartenendpunkte.
 * Fehler kommen als ApiError mit der Kennung aus dem Antwortkörper zurück,
 * damit die Oberfläche `cards_disabled` und `hand_limit` unterscheiden kann.
 */
import type { Fluch, HandKarte } from "@hideandseek/shared";

import { apiFetch } from "./session-api";

export interface ZiehAntwort {
    angeboten: HandKarte[];
    behalten: number;
    deckRest: number;
}

export interface HandAntwort {
    hand: HandKarte[];
    deckRest: number;
}

export function ziehen(
    questionId: string,
    token: string,
): Promise<ZiehAntwort> {
    return apiFetch(`/api/questions/${questionId}/draw`, {
        method: "POST",
        token,
    });
}

export function behalten(
    questionId: string,
    token: string,
    body: { behalten: string[]; abwerfen?: string[] },
): Promise<HandAntwort> {
    return apiFetch(`/api/questions/${questionId}/keep`, {
        method: "POST",
        token,
        body: JSON.stringify(body),
    });
}

export function fluchSpielen(
    code: string,
    token: string,
    deckCardId: string,
): Promise<{ curse: Fluch }> {
    return apiFetch(`/api/sessions/${code}/curses`, {
        method: "POST",
        token,
        body: JSON.stringify({ deckCardId }),
    });
}

export function fluchBeenden(
    curseId: string,
    token: string,
): Promise<{ curse: Fluch }> {
    return apiFetch(`/api/curses/${curseId}/end`, {
        method: "POST",
        token,
    });
}
```

`apiFetch` nimmt den Token als **Option**, nicht als Header: seine Signatur ist
`apiFetch<T>(path, options: RequestInit & { token?: string })`, und es setzt
`x-participant-token` selbst. Das ist die Form, die `addQuestion` und
`answerQuestion` schon benutzen. `apiFetch` ist bisher nicht exportiert —
ändere `async function apiFetch` in `export async function apiFetch`.

Fehler kommen aus `apiFetch` bereits als getippte `ApiError` mit `code` aus dem
Antwortkörper; `handleSubmitError` in `src/lib/handle-submit-error.ts` zeigt sie
als Toast. Baue keine eigene Fehlerbehandlung daneben.

- [ ] **Schritt 6: WebSocket verdrahten**

In `src/hooks/useSessionWebSocket.ts` die Importe ergänzen:

```ts
import {
    applyCardsSync,
    applyCurseEnded,
    applyCursePlayed,
    applyHandUpdated,
} from "@/lib/deck-context";
```

Im `case "sync":`-Zweig, direkt vor `break;`, ergänzen:

```ts
                        applyCardsSync({
                            cardsEnabled: event.cardsEnabled,
                            hand: event.hand,
                            deckRest: event.deckRest,
                            pendingDraw: event.pendingDraw,
                            activeCurses: event.activeCurses,
                        });
```

Und drei neue Zweige im `switch`, hinter den vorhandenen:

```ts
                    case "hand_updated":
                        applyHandUpdated({
                            hand: event.hand,
                            deckRest: event.deckRest,
                        });
                        break;

                    case "curse_played":
                        applyCursePlayed({ curse: event.curse });
                        if (getRole() === "seeker") {
                            playSound("notification");
                            navigator.vibrate?.([200, 100, 200]);
                        }
                        break;

                    case "curse_ended":
                        applyCurseEnded({
                            curseId: event.curseId,
                            endedBy: event.endedBy,
                            endedAt: event.endedAt,
                        });
                        break;
```

`playSound` kommt aus `@/lib/sound` und muss oben importiert werden, falls noch nicht geschehen.

- [ ] **Schritt 7: Aufräumen beim Verlassen**

In `src/lib/session-context.ts` in `leaveSession()` nach `gameSize.set(null);` ergänzen:

```ts
    resetDeckState();
```

mit dem Import `import { resetDeckState } from "./deck-context";` am Dateianfang.

- [ ] **Schritt 8: Typen prüfen und committen**

```bash
cd ~/hideandseek && pnpm run check && pnpm vitest run src/lib/__tests__/deck-context.test.ts
git add src/lib/deck-context.ts src/lib/cards-api.ts src/lib/session-api.ts src/hooks/useSessionWebSocket.ts src/lib/session-context.ts src/lib/__tests__/deck-context.test.ts
git commit -m "feat(karten): Frontend-Store und API-Client

Hand, Deckrest, offener Zug und laufende Flueche als nanostores-Atome,
gespeist aus sync und den drei neuen Ereignissen. Nichts im localStorage:
der Server ist die Wahrheit.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FyNQKwGJJYxVZrmyEh4GfF"
```

---

## Task 8: Der Schalter im Onboarding

**Dateien:**
- Ändern: `src/components/session/CreateSessionOverlay.tsx` (`renderGroesse()` ab Zeile 340, `handleCreateSession()` ab Zeile 125)
- Ändern: `src/i18n/de.ts`, `src/i18n/en.ts`

**Schnittstellen:**
- Verbraucht: `CreateSessionRequest.cardsEnabled` (Task 2)
- Liefert: nichts, was spätere Aufgaben brauchen

**Kein eigener Test.** `en.ts` ist als `typeof de` typisiert — ein Schlüssel, der nur in einer der beiden Dateien steht, lässt `pnpm run check` scheitern. Die Vollständigkeit der Übersetzungen ist damit schon abgesichert; ein zusätzlicher Test wäre doppelt.

- [ ] **Schritt 1: Übersetzungsschlüssel anlegen**

In `src/i18n/de.ts`, bei den übrigen `overlay.`-Schlüsseln:

```ts
    "overlay.cardsLabel": "Kartenmechanik",
    "overlay.cardsHint": "Der Versteckende zieht Karten für beantwortete Fragen und kann Flüche gegen euch spielen.",
```

In `src/i18n/en.ts` an derselben Stelle:

```ts
    "overlay.cardsLabel": "Card mechanic",
    "overlay.cardsHint": "The hider draws cards for answered questions and can play curses against you.",
```

- [ ] **Schritt 2: Zustand im Bauteil anlegen**

In `src/components/session/CreateSessionOverlay.tsx` neben `const [gameSize, setGameSize] = useState<GameSize | null>(null);` (Zeile 103):

```ts
    const [cardsEnabled, setCardsEnabled] = useState(true);
```

- [ ] **Schritt 3: Den Wert mitschicken**

In `handleCreateSession()` den Aufruf erweitern:

```ts
            const result = await createSession({
                displayName: displayName.trim(),
                mapLocation: mapLocation ?? undefined,
                gameSize: gameSize ?? undefined,
                cardsEnabled,
            });
```

- [ ] **Schritt 4: Den Schalter einbauen**

In `renderGroesse()`, zwischen der `sizes.map(...)`-Schleife und dem „Weiter"-Knopf:

```tsx
                    <label
                        style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 12,
                            marginTop: 8,
                            padding: "14px 16px",
                            background: "var(--color-panel)",
                            border: "2px solid rgba(245,245,240,0.08)",
                            borderRadius: "var(--radius-default)",
                            cursor: "pointer",
                        }}
                    >
                        <input
                            type="checkbox"
                            checked={cardsEnabled}
                            onChange={(e) => setCardsEnabled(e.target.checked)}
                            style={{
                                width: 20,
                                height: 20,
                                marginTop: 2,
                                accentColor: "var(--color-primary)",
                                flexShrink: 0,
                            }}
                        />
                        <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <span style={{ color: "#fff", fontWeight: 600, fontSize: "15px" }}>
                                {tr("overlay.cardsLabel")}
                            </span>
                            <span style={{ color: "rgba(245,245,240,0.6)", fontSize: "13px", lineHeight: 1.4 }}>
                                {tr("overlay.cardsHint")}
                            </span>
                        </span>
                    </label>
```

Ein `<input type="checkbox">` statt `src/components/ui/switch.tsx`, weil der restliche Schirm mit Inline-Stilen und rohen Elementen arbeitet und der Radix-Schalter hier ein Fremdkörper wäre.

- [ ] **Schritt 5: Von Hand erproben**

```bash
cd ~/hideandseek && pnpm dev
```

Eine Sitzung gründen, auf der Stufe „Spielgröße" den Haken setzen bzw. entfernen, weiter, und danach im Netzwerkreiter des Browsers den Körper von `POST /api/sessions` prüfen: `cardsEnabled` muss den gewählten Wert tragen. Danach `pnpm dev` beenden.

- [ ] **Schritt 6: Typen prüfen und committen**

```bash
cd ~/hideandseek && pnpm run check
git add src/components/session/CreateSessionOverlay.tsx src/i18n/de.ts src/i18n/en.ts
git commit -m "feat(karten): Schalter fuer die Kartenmechanik im Onboarding

Sitzt auf der Stufe Spielgroesse unter den drei Kacheln, vorbelegt mit an.
Keine sechste Stufe, die Punktanzeige bleibt unveraendert.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FyNQKwGJJYxVZrmyEh4GfF"
```

---

## Task 9: Fluchliste mit Countdown

**Dateien:**
- Erstellen: `src/components/session/cards/FluchListe.tsx`
- Ändern: `src/i18n/de.ts`, `src/i18n/en.ts`
- Test: `src/components/__tests__/fluch-liste.test.tsx`

**Schnittstellen:**
- Verbraucht: `activeCurses` (Task 7), `fluchBeenden` (Task 7)
- Liefert: `<FluchListe />` — zeigt alle laufenden Flüche; bei den Suchenden mit „erledigt", beim Versteckenden mit „aufheben"; Zeitflüche zusätzlich mit Countdown

- [ ] **Schritt 1: Übersetzungsschlüssel anlegen**

In `src/i18n/de.ts`:

```ts
    "cards.noCurses": "Gerade läuft kein Fluch.",
    "cards.done": "Erledigt",
    "cards.lift": "Aufheben",
    "cards.expired": "Abgelaufen",
    "cards.noDuration": "Läuft, bis ihr erledigt meldet",
    "cards.cost": "Kosten",
    "cards.proof": "Nachweis",
    "cards.fallback": "Ausweichregel",
```

In `src/i18n/en.ts`:

```ts
    "cards.noCurses": "No curse is running right now.",
    "cards.done": "Done",
    "cards.lift": "Lift",
    "cards.expired": "Expired",
    "cards.noDuration": "Runs until you report it done",
    "cards.cost": "Cost",
    "cards.proof": "Proof",
    "cards.fallback": "Fallback rule",
```

- [ ] **Schritt 2: Den scheiternden Test schreiben**

Erstelle `src/components/__tests__/fluch-liste.test.tsx`. Muster wörtlich aus `src/components/__tests__/draggable-markers.test.tsx`: `vi.hoisted()`-Attrappen, `vi.mock` vor dem dynamischen Import, `renderToStaticMarkup`, Prüfung per Zählung im Markup.

```tsx
/**
 * Prüft, dass die Fluchliste je nach Rolle und Kartenart die richtigen
 * Bedienelemente zeigt: Countdown bei Zeitflüchen, "erledigt" bei den
 * Suchenden, "aufheben" beim Versteckenden.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stores = vi.hoisted(() => {
    function box<T>(initial: T) {
        return {
            value: initial,
            get() {
                return this.value;
            },
            set(v: T) {
                this.value = v;
            },
        };
    }
    return {
        activeCurses: box<any[]>([]),
        sessionParticipant: box<any>({ role: "seeker", token: "t" }),
        sessionCode: box<string | null>("ABCDEF"),
    };
});

vi.mock("@nanostores/react", () => ({
    useStore: (store: any) => store.get(),
}));

vi.mock("@/lib/deck-context", () => ({
    activeCurses: stores.activeCurses,
}));

vi.mock("@/lib/session-context", () => ({
    sessionParticipant: stores.sessionParticipant,
    sessionCode: stores.sessionCode,
}));

vi.mock("@/lib/cards-api", () => ({
    fluchBeenden: vi.fn(),
}));

vi.mock("@/i18n", () => ({
    useT: () => (key: string) => key,
    locale: { get: () => "de" },
}));

const KARTE_MIT_DAUER = {
    id: "fluch-rechtsdrall",
    art: "fluch",
    name: "Rechtsdrall",
    text: "Nur rechts abbiegen.",
    gruppe: "bewegung",
    dauerMin: { S: 20, M: 40, L: 60 },
    anzahl: 1,
};

const KARTE_OHNE_DAUER = {
    id: "fluch-brueckenzoll",
    art: "fluch",
    name: "Brückenzoll",
    text: "Unter eine Brücke.",
    gruppe: "aufgabe",
    dauerMin: null,
    anzahl: 1,
};

function fluch(karte: any, expiresAt: string | null) {
    return {
        id: `c-${karte.id}`,
        karte,
        playedAt: new Date().toISOString(),
        expiresAt,
        endedAt: null,
        endedBy: null,
    };
}

async function render() {
    const { FluchListe } = await import("../session/cards/FluchListe");
    return renderToStaticMarkup(<FluchListe />);
}

describe("FluchListe", () => {
    beforeEach(() => {
        stores.activeCurses.set([]);
        stores.sessionParticipant.set({ role: "seeker", token: "t" });
        vi.resetModules();
    });

    it("zeigt einen Hinweis, wenn kein Fluch läuft", async () => {
        const markup = await render();
        expect(markup).toContain("cards.noCurses");
    });

    it("zeigt den Namen jedes laufenden Fluchs", async () => {
        stores.activeCurses.set([
            fluch(KARTE_MIT_DAUER, new Date(Date.now() + 600_000).toISOString()),
            fluch(KARTE_OHNE_DAUER, null),
        ]);

        const markup = await render();

        expect(markup).toContain("Rechtsdrall");
        expect(markup).toContain("Brückenzoll");
    });

    it("zeigt bei einem Zeitfluch einen Countdown", async () => {
        stores.activeCurses.set([
            fluch(KARTE_MIT_DAUER, new Date(Date.now() + 600_000).toISOString()),
        ]);

        const markup = await render();

        expect(markup).toContain('data-countdown="c-fluch-rechtsdrall"');
    });

    it("zeigt bei einem Aufgabenfluch keinen Countdown", async () => {
        stores.activeCurses.set([fluch(KARTE_OHNE_DAUER, null)]);

        const markup = await render();

        expect(markup).not.toContain("data-countdown");
        expect(markup).toContain("cards.noDuration");
    });

    it("zeigt eine wörtliche Dauer statt der allgemeinen Beschriftung", async () => {
        // Drei Karten tragen dauerText, etwa "bis Rundenende".
        const mitText = { ...KARTE_OHNE_DAUER, dauerText: "bis Rundenende" };
        stores.activeCurses.set([fluch(mitText, null)]);

        const markup = await render();

        expect(markup).toContain("bis Rundenende");
        expect(markup).not.toContain("cards.noDuration");
    });

    it("gibt den Suchenden den Knopf erledigt", async () => {
        stores.activeCurses.set([fluch(KARTE_OHNE_DAUER, null)]);

        const markup = await render();

        expect(markup).toContain("cards.done");
        expect(markup).not.toContain("cards.lift");
    });

    it("gibt dem Versteckenden den Knopf aufheben", async () => {
        stores.sessionParticipant.set({ role: "hider", token: "t" });
        stores.activeCurses.set([fluch(KARTE_OHNE_DAUER, null)]);

        const markup = await render();

        expect(markup).toContain("cards.lift");
        expect(markup).not.toContain("cards.done");
    });

    it("zeichnet je Fluch genau eine Zeile", async () => {
        stores.activeCurses.set([
            fluch(KARTE_MIT_DAUER, new Date(Date.now() + 600_000).toISOString()),
            fluch(KARTE_OHNE_DAUER, null),
        ]);

        const markup = await render();

        expect(markup.match(/data-curse=/g)?.length).toBe(2);
    });
});
```

- [ ] **Schritt 3: Test laufen lassen, er muss scheitern**

```bash
cd ~/hideandseek && pnpm vitest run src/components/__tests__/fluch-liste.test.tsx
```

Erwartet: FAIL, Modul nicht gefunden.

- [ ] **Schritt 4: Das Bauteil schreiben**

Erstelle `src/components/session/cards/FluchListe.tsx`:

```tsx
/**
 * Die laufenden Flüche einer Sitzung.
 *
 * Zeitflüche zeigen einen Countdown, der clientseitig aus expiresAt gerechnet
 * wird — so wie QuestionCountdown in SessionQuestionPanel.tsx. Aufgabenflüche
 * laufen, bis ein Suchender "erledigt" meldet.
 */
import type { Fluch } from "@hideandseek/shared";
import { useStore } from "@nanostores/react";
import { useEffect, useState } from "react";
import { toast } from "react-toastify";

import { useT } from "@/i18n";
import { fluchBeenden } from "@/lib/cards-api";
import { activeCurses } from "@/lib/deck-context";
import { sessionParticipant } from "@/lib/session-context";

/** MM:SS aus einem ISO-Zeitstempel, jede Sekunde neu. */
function Countdown({ curseId, expiresAt }: { curseId: string; expiresAt: string }) {
    const tr = useT();

    function rest(): number {
        return new Date(expiresAt).getTime() - Date.now();
    }

    const [remainingMs, setRemainingMs] = useState<number>(rest);

    useEffect(() => {
        setRemainingMs(rest());
        const interval = setInterval(() => {
            const ms = rest();
            setRemainingMs(ms);
            if (ms <= 0) clearInterval(interval);
        }, 1000);
        return () => clearInterval(interval);
    // expiresAt ist ein stabiler ISO-String
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [expiresAt]);

    if (remainingMs <= 0) {
        return (
            <span data-countdown={curseId} style={{ color: "#D56062", fontWeight: 700, fontSize: 13 }}>
                ⏰ {tr("cards.expired")}
            </span>
        );
    }

    const totalSec = Math.ceil(remainingMs / 1000);
    const minuten = Math.floor(totalSec / 60);
    const sekunden = totalSec % 60;
    const text = `${String(minuten).padStart(2, "0")}:${String(sekunden).padStart(2, "0")}`;

    const rot = remainingMs < 60_000;
    const orange = !rot && remainingMs < 5 * 60_000;
    const farbe = rot ? "#D56062" : orange ? "#F37748" : "rgba(255,255,255,0.85)";

    return (
        <span
            data-countdown={curseId}
            className="tabular-nums"
            style={{ color: farbe, fontWeight: 700, fontSize: 13 }}
        >
            ⏱ {text}
        </span>
    );
}

export function FluchListe() {
    const tr = useT();
    const $participant = useStore(sessionParticipant);
    const $curses = useStore(activeCurses);
    const [laufend, setLaufend] = useState<string | null>(null);

    const istHider = $participant?.role === "hider";

    async function beenden(curse: Fluch) {
        if (!$participant?.token || laufend) return;
        setLaufend(curse.id);
        try {
            await fluchBeenden(curse.id, $participant.token);
            // Die Liste aktualisiert sich über das curse_ended-Ereignis.
        } catch (e) {
            toast.error((e as Error).message);
        } finally {
            setLaufend(null);
        }
    }

    if ($curses.length === 0) {
        return (
            <p style={{ color: "rgba(245,245,240,0.6)", fontSize: 14, padding: "12px 4px", margin: 0 }}>
                {tr("cards.noCurses")}
            </p>
        );
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {$curses.map((curse) => (
                <div
                    key={curse.id}
                    data-curse={curse.id}
                    style={{
                        background: "var(--color-panel)",
                        border: "2px solid rgba(245,245,240,0.08)",
                        borderRadius: "var(--radius-default)",
                        padding: "12px 14px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                    }}
                >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                        <span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>
                            {curse.karte.name}
                        </span>
                        {curse.expiresAt ? (
                            <Countdown curseId={curse.id} expiresAt={curse.expiresAt} />
                        ) : (
                            <span style={{ color: "rgba(245,245,240,0.5)", fontSize: 12 }}>
                                {curse.karte.dauerText ?? tr("cards.noDuration")}
                            </span>
                        )}
                    </div>

                    <p style={{ color: "rgba(245,245,240,0.8)", fontSize: 13, lineHeight: 1.5, margin: 0, whiteSpace: "pre-line" }}>
                        {curse.karte.text}
                    </p>

                    {curse.karte.nachweis ? (
                        <p style={{ color: "rgba(245,245,240,0.55)", fontSize: 12, margin: 0 }}>
                            <strong>{tr("cards.proof")}:</strong> {curse.karte.nachweis}
                        </p>
                    ) : null}

                    {curse.karte.ausweichregel ? (
                        <p style={{ color: "rgba(245,245,240,0.55)", fontSize: 12, margin: 0 }}>
                            <strong>{tr("cards.fallback")}:</strong> {curse.karte.ausweichregel}
                        </p>
                    ) : null}

                    <button
                        onClick={() => void beenden(curse)}
                        disabled={laufend === curse.id}
                        style={{
                            alignSelf: "flex-start",
                            marginTop: 2,
                            background: istHider ? "transparent" : "var(--color-primary)",
                            border: istHider ? "2px solid rgba(245,245,240,0.2)" : "none",
                            borderRadius: "var(--radius-pill)",
                            padding: "8px 20px",
                            color: "#fff",
                            fontWeight: 700,
                            fontSize: 13,
                            cursor: laufend === curse.id ? "default" : "pointer",
                            opacity: laufend === curse.id ? 0.5 : 1,
                        }}
                    >
                        {istHider ? tr("cards.lift") : tr("cards.done")}
                    </button>
                </div>
            ))}
        </div>
    );
}
```

- [ ] **Schritt 5: Test laufen lassen, er muss bestehen**

```bash
cd ~/hideandseek && pnpm vitest run src/components/__tests__/fluch-liste.test.tsx
```

Erwartet: PASS, acht Fälle.

- [ ] **Schritt 6: Typen prüfen und committen**

```bash
cd ~/hideandseek && pnpm run check
git add src/components/session/cards/FluchListe.tsx src/components/__tests__/fluch-liste.test.tsx src/i18n/de.ts src/i18n/en.ts
git commit -m "feat(karten): Liste der laufenden Flueche

Countdown bei Zeitfluechen, erledigt-Knopf bei den Suchenden,
aufheben beim Versteckenden. Countdown wird clientseitig aus expiresAt
gerechnet, wie bei den Fragen.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FyNQKwGJJYxVZrmyEh4GfF"
```

---

## Task 10: Handansicht und Ausspielen

**Dateien:**
- Erstellen: `src/components/session/cards/KartenAnsicht.tsx`
- Erstellen: `src/components/session/cards/KartenReiter.tsx`
- Ändern: `src/i18n/de.ts`, `src/i18n/en.ts`
- Test: `src/components/__tests__/karten-reiter.test.tsx`

**Schnittstellen:**
- Verbraucht: `hand`, `deckRest`, `activeCurses`, `bonusMinutenAufDerHand` (Task 7); `fluchSpielen` (Task 7); `<FluchListe />` (Task 9)
- Liefert: `<KartenReiter />` — beim Versteckenden Hand plus laufende Flüche, bei den Suchenden nur die Flüche

- [ ] **Schritt 1: Übersetzungsschlüssel anlegen**

In `src/i18n/de.ts`:

```ts
    "cards.handEmpty": "Deine Hand ist leer. Beantworte eine Frage, dann darfst du ziehen.",
    "cards.handTitle": "Hand",
    "cards.deckLeft": "{n} Karten im Deck",
    "cards.bonusSum": "{n} Bonusminuten auf der Hand",
    "cards.play": "Ausspielen",
    "cards.discard": "Abwerfen",
    "cards.back": "Zurück",
    "cards.confirmPlay": "{name} jetzt ausspielen?",
    "cards.confirmDiscard": "{name} abwerfen? Abgeworfene Zeitboni verfallen.",
    "cards.activeCurses": "Laufende Flüche",
```

In `src/i18n/en.ts`:

```ts
    "cards.handEmpty": "Your hand is empty. Answer a question, then you may draw.",
    "cards.handTitle": "Hand",
    "cards.deckLeft": "{n} cards left in the deck",
    "cards.bonusSum": "{n} bonus minutes in hand",
    "cards.play": "Play",
    "cards.discard": "Discard",
    "cards.back": "Back",
    "cards.confirmPlay": "Play {name} now?",
    "cards.confirmDiscard": "Discard {name}? Discarded time bonuses are lost.",
    "cards.activeCurses": "Active curses",
```

Die Platzhalterform `{n}` bzw. `{name}` wird von der vorhandenen Funktion in `src/i18n/index.ts` ersetzt (siehe dort den Kommentar „Like `t()` but replaces `{placeholder}` tokens"). Benutze sie, statt Strings zusammenzukleben.

- [ ] **Schritt 2: Den scheiternden Test schreiben**

Erstelle `src/components/__tests__/karten-reiter.test.tsx`:

```tsx
/**
 * Prüft, was der Kartenreiter je nach Rolle zeigt: der Versteckende seine
 * Hand, die Suchenden nur die laufenden Flüche.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stores = vi.hoisted(() => {
    function box<T>(initial: T) {
        return {
            value: initial,
            get() {
                return this.value;
            },
            set(v: T) {
                this.value = v;
            },
        };
    }
    return {
        hand: box<any[]>([]),
        deckRest: box(70),
        activeCurses: box<any[]>([]),
        sessionParticipant: box<any>({ role: "hider", token: "t" }),
        sessionCode: box<string | null>("ABCDEF"),
        gameSize: box<"S" | "M" | "L" | null>("M"),
    };
});

vi.mock("@nanostores/react", () => ({ useStore: (s: any) => s.get() }));

vi.mock("@/lib/deck-context", () => ({
    hand: stores.hand,
    deckRest: stores.deckRest,
    activeCurses: stores.activeCurses,
    bonusMinutenAufDerHand: (karten: any[], g: string) =>
        karten.reduce((n: number, k: any) => n + (k.karte.bonusMin?.[g ?? "M"] ?? 0), 0),
}));

vi.mock("@/lib/session-context", () => ({
    sessionParticipant: stores.sessionParticipant,
    sessionCode: stores.sessionCode,
    gameSize: stores.gameSize,
}));

vi.mock("@/lib/cards-api", () => ({
    fluchSpielen: vi.fn(),
    fluchBeenden: vi.fn(),
}));

vi.mock("@/i18n", () => ({
    useT: () => (key: string) => key,
    useTFmt: () => (key: string) => key,
    locale: { get: () => "de" },
}));

const FLUCHKARTE = {
    id: "fluch-brueckenzoll",
    art: "fluch",
    name: "Brückenzoll",
    text: "Unter eine Brücke.",
    gruppe: "aufgabe",
    dauerMin: null,
    anzahl: 1,
};

const BONUSKARTE = {
    id: "zeitbonus-10",
    art: "zeitbonus",
    name: "Anschluss weg",
    text: "Zählt am Rundenende.",
    bonusMin: { S: 4, M: 6, L: 10 },
    anzahl: 13,
};

async function render() {
    const { KartenReiter } = await import("../session/cards/KartenReiter");
    return renderToStaticMarkup(<KartenReiter />);
}

describe("KartenReiter", () => {
    beforeEach(() => {
        stores.hand.set([]);
        stores.activeCurses.set([]);
        stores.sessionParticipant.set({ role: "hider", token: "t" });
        vi.resetModules();
    });

    it("sagt dem Versteckenden, wenn seine Hand leer ist", async () => {
        const markup = await render();
        expect(markup).toContain("cards.handEmpty");
    });

    it("zeichnet je Handkarte eine Zeile", async () => {
        stores.hand.set([
            { id: "d1", karte: FLUCHKARTE },
            { id: "d2", karte: BONUSKARTE },
            { id: "d3", karte: BONUSKARTE },
        ]);

        const markup = await render();

        expect(markup.match(/data-handcard=/g)?.length).toBe(3);
    });

    it("zeigt die Namen der Handkarten", async () => {
        stores.hand.set([{ id: "d1", karte: FLUCHKARTE }]);

        const markup = await render();

        expect(markup).toContain("Brückenzoll");
    });

    it("zeigt einem Suchenden keine Hand, auch wenn der Store eine hätte", async () => {
        stores.sessionParticipant.set({ role: "seeker", token: "t" });
        stores.hand.set([{ id: "d1", karte: FLUCHKARTE }]);

        const markup = await render();

        expect(markup).not.toContain("data-handcard=");
        expect(markup).not.toContain("Brückenzoll");
    });

    it("zeigt beiden Rollen die laufenden Flüche", async () => {
        stores.activeCurses.set([
            {
                id: "c1",
                karte: FLUCHKARTE,
                playedAt: new Date().toISOString(),
                expiresAt: null,
                endedAt: null,
                endedBy: null,
            },
        ]);

        const alsHider = await render();
        expect(alsHider).toContain("data-curse=");

        vi.resetModules();
        stores.sessionParticipant.set({ role: "seeker", token: "t" });
        const alsSeeker = await render();
        expect(alsSeeker).toContain("data-curse=");
    });
});
```

- [ ] **Schritt 3: Test laufen lassen, er muss scheitern**

```bash
cd ~/hideandseek && pnpm vitest run src/components/__tests__/karten-reiter.test.tsx
```

Erwartet: FAIL, Modul nicht gefunden.

- [ ] **Schritt 4: Die Kartenansicht schreiben**

Erstelle `src/components/session/cards/KartenAnsicht.tsx`:

```tsx
/**
 * Eine Karte im Volltext, mit dem passenden Knopf: Flüche werden ausgespielt,
 * Zeitboni abgeworfen. Beides mit Rückfrage, weil abgeworfene Zeitboni
 * verfallen und ein ausgespielter Fluch nicht zurückkommt.
 */
import type { HandKarte } from "@hideandseek/shared";
import { useState } from "react";
import { toast } from "react-toastify";

import { useT, useTFmt } from "@/i18n";

export function KartenAnsicht({
    karte,
    onZurueck,
    onAusspielen,
    onAbwerfen,
}: {
    karte: HandKarte;
    onZurueck: () => void;
    onAusspielen: (k: HandKarte) => Promise<void>;
    onAbwerfen: (k: HandKarte) => Promise<void>;
}) {
    const tr = useT();
    const trf = useTFmt();
    const [laufend, setLaufend] = useState(false);
    const istFluch = karte.karte.art === "fluch";

    async function handeln() {
        const frage = istFluch
            ? trf("cards.confirmPlay", { name: karte.karte.name })
            : trf("cards.confirmDiscard", { name: karte.karte.name });
        if (!window.confirm(frage)) return;

        setLaufend(true);
        try {
            if (istFluch) await onAusspielen(karte);
            else await onAbwerfen(karte);
            onZurueck();
        } catch (e) {
            toast.error((e as Error).message);
        } finally {
            setLaufend(false);
        }
    }

    return (
        <div data-kartenansicht={karte.id} style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 2px" }}>
            <button
                onClick={onZurueck}
                style={{
                    alignSelf: "flex-start",
                    background: "transparent",
                    border: "none",
                    color: "rgba(245,245,240,0.6)",
                    fontSize: 14,
                    cursor: "pointer",
                    padding: 0,
                }}
            >
                ← {tr("cards.back")}
            </button>

            <h3 style={{ color: "#fff", fontSize: 20, fontWeight: 800, margin: 0, fontFamily: "Poppins, sans-serif" }}>
                {karte.karte.name}
            </h3>

            <p style={{ color: "rgba(245,245,240,0.85)", fontSize: 14, lineHeight: 1.6, margin: 0, whiteSpace: "pre-line" }}>
                {karte.karte.text}
            </p>

            {karte.karte.kosten ? (
                <p style={{ color: "rgba(245,245,240,0.6)", fontSize: 13, margin: 0 }}>
                    <strong>{tr("cards.cost")}:</strong> {karte.karte.kosten}
                </p>
            ) : null}

            {karte.karte.nachweis ? (
                <p style={{ color: "rgba(245,245,240,0.6)", fontSize: 13, margin: 0 }}>
                    <strong>{tr("cards.proof")}:</strong> {karte.karte.nachweis}
                </p>
            ) : null}

            {karte.karte.ausweichregel ? (
                <p style={{ color: "rgba(245,245,240,0.6)", fontSize: 13, margin: 0 }}>
                    <strong>{tr("cards.fallback")}:</strong> {karte.karte.ausweichregel}
                </p>
            ) : null}

            <button
                onClick={() => void handeln()}
                disabled={laufend}
                style={{
                    marginTop: 4,
                    background: istFluch ? "var(--color-primary)" : "transparent",
                    border: istFluch ? "none" : "2px solid rgba(245,245,240,0.2)",
                    borderRadius: "var(--radius-pill)",
                    padding: "12px 28px",
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: 14,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    cursor: laufend ? "default" : "pointer",
                    opacity: laufend ? 0.5 : 1,
                }}
            >
                {istFluch ? tr("cards.play") : tr("cards.discard")}
            </button>
        </div>
    );
}
```

**Zu `window.confirm`:** Die Anweisungen zur Browsersteuerung warnen vor modalen Dialogen, weil sie eine Automatisierungssitzung blockieren. Für das laufende Spiel ist das unbedenklich; der vorhandene Code benutzt an anderer Stelle bereits `alert-dialog.tsx`. Wenn Du den Radix-Dialog bevorzugst, ersetze `window.confirm` durch `AlertDialog` aus `@/components/ui/alert-dialog` — die Tests oben prüfen das Bestätigen nicht, sie bleiben in beiden Fällen grün.

- [ ] **Schritt 5: Den Reiter schreiben**

Erstelle `src/components/session/cards/KartenReiter.tsx`:

```tsx
/**
 * Inhalt des Kartenreiters im Bottom Sheet.
 *
 * Der Versteckende sieht seine Hand und darunter die laufenden Flüche, die
 * Suchenden nur die Flüche. Die Hand wird niemals für einen Suchenden
 * gezeichnet, auch wenn der Store wider Erwarten Karten enthielte.
 */
import type { HandKarte } from "@hideandseek/shared";
import { useStore } from "@nanostores/react";
import { useEffect, useState } from "react";

import { useT, useTFmt } from "@/i18n";
import { fluchSpielen } from "@/lib/cards-api";
import { bonusMinutenAufDerHand, deckRest, hand } from "@/lib/deck-context";
import { gameSize, sessionCode, sessionParticipant } from "@/lib/session-context";

import { FluchListe } from "./FluchListe";
import { KartenAnsicht } from "./KartenAnsicht";

export function KartenReiter() {
    const tr = useT();
    const trf = useTFmt();
    const $participant = useStore(sessionParticipant);
    const $code = useStore(sessionCode);
    const $hand = useStore(hand);
    const $deckRest = useStore(deckRest);
    const $gameSize = useStore(gameSize);
    const [offen, setOffen] = useState<HandKarte | null>(null);

    const istHider = $participant?.role === "hider";

    async function ausspielen(karte: HandKarte) {
        if (!$code || !$participant?.token) return;
        await fluchSpielen($code, $participant.token, karte.id);
        // Hand und Fluchliste kommen über hand_updated und curse_played zurück.
    }

    async function abwerfen(_karte: HandKarte) {
        // Abwerfen außerhalb eines Ziehvorgangs gibt es in dieser Ausbaustufe
        // nicht: Karten werden nur beim Behalten abgeworfen, wenn die Hand
        // sonst über sechs käme. Der Knopf bleibt deshalb ohne Wirkung.
        throw new Error(tr("cards.discardNotAvailable"));
    }

    // Faellt die gewaehlte Karte aus der Hand — etwa weil ein hand_updated
    // eintrifft, waehrend ihre Ansicht offen ist —, schliesst sich die Ansicht.
    // Sonst stuende dort eine Karte, die es nicht mehr gibt, und ein Druck auf
    // Ausspielen braechte nur ein not_in_hand vom Server.
    useEffect(() => {
        if (offen && !$hand.some((k) => k.id === offen.id)) {
            setOffen(null);
        }
    }, [offen, $hand]);

    if (offen) {
        return (
            <KartenAnsicht
                karte={offen}
                onZurueck={() => setOffen(null)}
                onAusspielen={ausspielen}
                onAbwerfen={abwerfen}
            />
        );
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "4px 2px" }}>
            {istHider ? (
                <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <h3 style={{ color: "#fff", fontSize: 16, fontWeight: 800, margin: 0 }}>
                            {tr("cards.handTitle")}
                        </h3>
                        <span style={{ color: "rgba(245,245,240,0.5)", fontSize: 12 }}>
                            {trf("cards.deckLeft", { n: String($deckRest) })}
                        </span>
                    </div>

                    {$hand.length === 0 ? (
                        <p style={{ color: "rgba(245,245,240,0.6)", fontSize: 14, margin: 0 }}>
                            {tr("cards.handEmpty")}
                        </p>
                    ) : (
                        <>
                            <span style={{ color: "rgba(245,245,240,0.5)", fontSize: 12 }}>
                                {trf("cards.bonusSum", {
                                    n: String(bonusMinutenAufDerHand($hand, $gameSize)),
                                })}
                            </span>
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                {$hand.map((karte) => (
                                    <button
                                        key={karte.id}
                                        data-handcard={karte.id}
                                        onClick={() => setOffen(karte)}
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            gap: 10,
                                            background: "var(--color-panel)",
                                            border: `2px solid ${karte.karte.art === "fluch" ? "var(--color-primary)" : "rgba(245,245,240,0.08)"}`,
                                            borderRadius: "var(--radius-default)",
                                            padding: "12px 14px",
                                            cursor: "pointer",
                                            textAlign: "left",
                                        }}
                                    >
                                        <span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>
                                            {karte.karte.name}
                                        </span>
                                        <span style={{ color: "rgba(245,245,240,0.5)", fontSize: 12 }}>
                                            {karte.karte.art === "fluch"
                                                ? "🃏"
                                                : `+${karte.karte.bonusMin?.[$gameSize ?? "M"]} min`}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </section>
            ) : null}

            <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <h3 style={{ color: "#fff", fontSize: 16, fontWeight: 800, margin: 0 }}>
                    {tr("cards.activeCurses")}
                </h3>
                <FluchListe />
            </section>
        </div>
    );
}
```

Ergänze den fehlenden Schlüssel in beiden i18n-Dateien:

```ts
    // de.ts
    "cards.discardNotAvailable": "Abwerfen geht nur beim Ziehen, wenn die Hand über sechs käme.",
    // en.ts
    "cards.discardNotAvailable": "Discarding only happens while drawing, when the hand would exceed six.",
```

- [ ] **Schritt 6: Test laufen lassen, er muss bestehen**

```bash
cd ~/hideandseek && pnpm vitest run src/components/__tests__/karten-reiter.test.tsx
```

Erwartet: PASS, fünf Fälle.

- [ ] **Schritt 7: Typen prüfen und committen**

```bash
cd ~/hideandseek && pnpm run check
git add src/components/session/cards/ src/components/__tests__/karten-reiter.test.tsx src/i18n/de.ts src/i18n/en.ts
git commit -m "feat(karten): Handansicht und Ausspielen

Der Versteckende sieht Hand plus laufende Flueche, die Suchenden nur die
Flueche. Eine Handkarte antippen oeffnet den Volltext mit Kosten und
Nachweis, Ausspielen fragt zurueck.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FyNQKwGJJYxVZrmyEh4GfF"
```

---

## Task 11: Der Reiter im Bottom Sheet

**Dateien:**
- Erstellen: `src/components/session/cards/karten-reiter-tab.ts`
- Ändern: `src/components/BottomSheetPanel.tsx` (`tabs`-Memo Zeile 128–131, Panel-Block Zeile 152–167)
- Ändern: `src/i18n/de.ts`, `src/i18n/en.ts`
- Test: `src/components/__tests__/bottom-sheet-karten-reiter.test.tsx`

**Schnittstellen:**
- Verbraucht: `<KartenReiter />` (Task 10), `cardsEnabled`, `hand`, `activeCurses` (Task 7)
- Liefert: dritter Reiter, sichtbar nur bei eingeschalteter Kartenmechanik

- [ ] **Schritt 1: Übersetzungsschlüssel anlegen**

`src/i18n/de.ts`:

```ts
    "cards.tabHand": "Hand",
    "cards.tabCurses": "Flüche",
```

`src/i18n/en.ts`:

```ts
    "cards.tabHand": "Hand",
    "cards.tabCurses": "Curses",
```

- [ ] **Schritt 2: Den scheiternden Test schreiben**

Erstelle `src/components/__tests__/bottom-sheet-karten-reiter.test.tsx`. Statt das ganze `BottomSheetPanel` mit Karte und WebSocket zu rendern, prüft der Test die Reiterberechnung als ausgelagerte reine Funktion:

```tsx
/**
 * Prüft, wann der Kartenreiter erscheint und wie er heißt.
 *
 * Die Berechnung liegt als reine Funktion in einer eigenen Datei, damit der
 * Test sie ohne Leaflet, WebSocket und Astro laden kann.
 */
import { describe, expect, it } from "vitest";

import { kartenReiter } from "../session/cards/karten-reiter-tab";

const tr = (key: string) => key;

describe("kartenReiter", () => {
    it("liefert nichts, wenn die Kartenmechanik aus ist", () => {
        expect(
            kartenReiter({ cardsEnabled: false, istHider: true, handAnzahl: 3, fluchAnzahl: 0, tr }),
        ).toBeNull();
    });

    it("liefert nichts ohne Rolle", () => {
        expect(
            kartenReiter({ cardsEnabled: true, istHider: null, handAnzahl: 0, fluchAnzahl: 0, tr }),
        ).toBeNull();
    });

    it("heißt beim Versteckenden Hand und zählt die Karten", () => {
        const reiter = kartenReiter({
            cardsEnabled: true, istHider: true, handAnzahl: 4, fluchAnzahl: 1, tr,
        });
        expect(reiter!.id).toBe("karten");
        expect(reiter!.label).toBe("cards.tabHand 4");
    });

    it("heißt bei den Suchenden Flüche und zählt die laufenden", () => {
        const reiter = kartenReiter({
            cardsEnabled: true, istHider: false, handAnzahl: 0, fluchAnzahl: 2, tr,
        });
        expect(reiter!.id).toBe("karten");
        expect(reiter!.label).toBe("cards.tabCurses 2");
    });

    it("lässt die Zahl weg, wenn nichts zu zählen ist", () => {
        const alsHider = kartenReiter({
            cardsEnabled: true, istHider: true, handAnzahl: 0, fluchAnzahl: 0, tr,
        });
        expect(alsHider!.label).toBe("cards.tabHand");

        const alsSeeker = kartenReiter({
            cardsEnabled: true, istHider: false, handAnzahl: 0, fluchAnzahl: 0, tr,
        });
        expect(alsSeeker!.label).toBe("cards.tabCurses");
    });
});
```

- [ ] **Schritt 3: Test laufen lassen, er muss scheitern**

```bash
cd ~/hideandseek && pnpm vitest run src/components/__tests__/bottom-sheet-karten-reiter.test.tsx
```

Erwartet: FAIL, „kartenReiter is not a function".

- [ ] **Schritt 4: Die reine Funktion schreiben**

Sie bekommt eine **eigene Datei**. Läge sie in `BottomSheetPanel.tsx`, zöge der
Test beim Import Leaflet, den WebSocket-Hook und die halbe Sitzungsoberfläche
mit herein und scheiterte ohne jsdom.

Erstelle `src/components/session/cards/karten-reiter-tab.ts`:

```ts
/**
 * Sichtbarkeit und Beschriftung des Kartenreiters im Bottom Sheet.
 *
 * Eigene Datei ohne React-Import, damit die Regeln im Test ohne Leaflet und
 * WebSocket geladen werden können.
 */
import type { BottomSheetTab } from "@/components/ui/BottomSheet";

/** Gibt null zurück, wenn kein Reiter erscheinen soll. */
export function kartenReiter({
    cardsEnabled,
    istHider,
    handAnzahl,
    fluchAnzahl,
    tr,
}: {
    cardsEnabled: boolean;
    istHider: boolean | null;
    handAnzahl: number;
    fluchAnzahl: number;
    tr: (key: any) => string;
}): BottomSheetTab | null {
    if (!cardsEnabled || istHider === null) return null;
    const name = istHider ? tr("cards.tabHand") : tr("cards.tabCurses");
    const zahl = istHider ? handAnzahl : fluchAnzahl;
    return { id: "karten", label: zahl > 0 ? `${name} ${zahl}` : name };
}
```

- [ ] **Schritt 5: Den Reiter einhängen**

Importe in `src/components/BottomSheetPanel.tsx` ergänzen:

```ts
import { activeCurses, cardsEnabled, hand } from "@/lib/deck-context";
import { KartenReiter } from "@/components/session/cards/KartenReiter";
import { kartenReiter } from "@/components/session/cards/karten-reiter-tab";
```

**Prüfe, ob `BottomSheetTab` aus `@/components/ui/BottomSheet` exportiert wird.**
`BottomSheetPanel.tsx` benutzt den Typ bereits; ist er dort nur lokal deklariert,
exportiere ihn aus `BottomSheet.tsx`, bevor Du ihn in der neuen Datei
importierst.

In der Komponente die Stores lesen:

```ts
    const $cardsEnabled = useStore(cardsEnabled);
    const $hand = useStore(hand);
    const $activeCurses = useStore(activeCurses);
```

Das `tabs`-Memo (Zeile 128–131) ersetzen durch:

```ts
    const tabs: BottomSheetTab[] = useMemo(() => {
        const basis: BottomSheetTab[] = [
            fragenTab,
            { id: "zonen", label: "Versteckzonen", icon: ZONE_ICON },
        ];
        const karten = kartenReiter({
            cardsEnabled: $cardsEnabled,
            istHider: $participant ? isHider : null,
            handAnzahl: $hand.length,
            fluchAnzahl: $activeCurses.length,
            tr,
        });
        return karten ? [...basis, karten] : basis;
    }, [fragenTab, $cardsEnabled, $participant, isHider, $hand.length, $activeCurses.length, tr]);
```

`tr` ist der Übersetzer aus `useT()`; steht er in dieser Datei noch nicht zur Verfügung, ergänze `const tr = useT();` und den Import `import { useT } from "@/i18n";`.

Im Panel-Block, hinter dem Zonen-`div` und vor dem Settings-`div`:

```tsx
                <div style={{ display: activeTab === "karten" ? "block" : "none" }}>
                    <div className="px-3 py-2">
                        {$participant && $cardsEnabled ? <KartenReiter /> : null}
                    </div>
                </div>
```

**Achtung bei `handleTabChange`:** Die Funktion öffnet beim Reiter `fragen` für Suchende den Fragen-Picker. Der Reiter `karten` darf dort nichts auslösen; die vorhandene `if`-Bedingung prüft bereits auf `tabId === "fragen"`, also ist nichts zu ändern.

- [ ] **Schritt 6: Test laufen lassen, er muss bestehen**

```bash
cd ~/hideandseek && pnpm vitest run src/components/__tests__/bottom-sheet-karten-reiter.test.tsx
```

Erwartet: PASS, fünf Fälle.

- [ ] **Schritt 7: Typen prüfen und committen**

```bash
cd ~/hideandseek && pnpm run check
git add src/components/session/cards/karten-reiter-tab.ts src/components/BottomSheetPanel.tsx src/components/ui/BottomSheet.tsx src/components/__tests__/bottom-sheet-karten-reiter.test.tsx src/i18n/de.ts src/i18n/en.ts
git commit -m "feat(karten): dritter Reiter im Bottom Sheet

Heisst beim Versteckenden Hand, bei den Suchenden Flueche, und erscheint
nur bei eingeschalteter Kartenmechanik. Die Sichtbarkeitsregel liegt als
reine Funktion daneben, damit sie ohne Leaflet pruefbar ist.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FyNQKwGJJYxVZrmyEh4GfF"
```

---

## Task 12: Der Ziehschirm

**Dateien:**
- Erstellen: `src/components/session/cards/ZiehSchirm.tsx`
- Ändern: `src/components/session/SessionQuestionPanel.tsx` (Kartenzieh-Overlay Zeile 1194–1240)
- Ändern: `src/components/BottomSheetPanel.tsx` (Schirm rendern)
- Ändern: `src/i18n/de.ts`, `src/i18n/en.ts`
- Test: `src/components/__tests__/zieh-schirm.test.tsx`

**Schnittstellen:**
- Verbraucht: `pendingDraw`, `hand` (Task 7); `ziehen`, `behalten` (Task 7)
- Liefert: `<ZiehSchirm />`, gesteuert über `pendingDraw`

- [ ] **Schritt 1: Übersetzungsschlüssel anlegen**

`src/i18n/de.ts`:

```ts
    "cards.drawTitle": "Karten ziehen",
    "cards.drawHint": "Sieh dir {draw} an, behalte {keep}.",
    "cards.drawOpen": "Karten ansehen",
    "cards.keepButton": "Behalten",
    "cards.keepCount": "{gewaehlt} von {noetig} gewählt",
    "cards.discardPrompt": "Deine Hand wäre zu voll. Wirf {n} ab.",
```

`src/i18n/en.ts`:

```ts
    "cards.drawTitle": "Draw cards",
    "cards.drawHint": "Look at {draw}, keep {keep}.",
    "cards.drawOpen": "Look at the cards",
    "cards.keepButton": "Keep",
    "cards.keepCount": "{gewaehlt} of {noetig} selected",
    "cards.discardPrompt": "Your hand would be too full. Discard {n}.",
```

- [ ] **Schritt 2: Den scheiternden Test schreiben**

Erstelle `src/components/__tests__/zieh-schirm.test.tsx`:

```tsx
/**
 * Prüft den Ziehschirm: Sichtbarkeit, Anzahl der angebotenen Karten und die
 * Abwurfaufforderung, wenn die Hand über sechs käme.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stores = vi.hoisted(() => {
    function box<T>(initial: T) {
        return {
            value: initial,
            get() {
                return this.value;
            },
            set(v: T) {
                this.value = v;
            },
        };
    }
    return {
        pendingDraw: box<any>(null),
        hand: box<any[]>([]),
        sessionParticipant: box<any>({ role: "hider", token: "t" }),
    };
});

vi.mock("@nanostores/react", () => ({ useStore: (s: any) => s.get() }));

vi.mock("@/lib/deck-context", () => ({
    pendingDraw: stores.pendingDraw,
    hand: stores.hand,
}));

vi.mock("@/lib/session-context", () => ({
    sessionParticipant: stores.sessionParticipant,
}));

vi.mock("@/lib/cards-api", () => ({ behalten: vi.fn() }));

vi.mock("@/i18n", () => ({
    useT: () => (key: string) => key,
    useTFmt: () => (key: string) => key,
}));

const KARTE = (id: string, name: string) => ({
    id,
    karte: {
        id: `fluch-${id}`,
        art: "fluch",
        name,
        text: "Text.",
        gruppe: "aufgabe",
        dauerMin: null,
        anzahl: 1,
    },
});

async function render() {
    const { ZiehSchirm } = await import("../session/cards/ZiehSchirm");
    return renderToStaticMarkup(<ZiehSchirm />);
}

describe("ZiehSchirm", () => {
    beforeEach(() => {
        stores.pendingDraw.set(null);
        stores.hand.set([]);
        stores.sessionParticipant.set({ role: "hider", token: "t" });
        vi.resetModules();
    });

    it("zeichnet nichts ohne offenen Ziehvorgang", async () => {
        expect(await render()).toBe("");
    });

    it("zeichnet nichts für einen Suchenden", async () => {
        stores.sessionParticipant.set({ role: "seeker", token: "t" });
        stores.pendingDraw.set({
            questionId: "q1",
            angeboten: [KARTE("d1", "Eins")],
            behalten: 1,
        });

        expect(await render()).toBe("");
    });

    it("zeigt jede angebotene Karte", async () => {
        stores.pendingDraw.set({
            questionId: "q1",
            angeboten: [KARTE("d1", "Eins"), KARTE("d2", "Zwei"), KARTE("d3", "Drei")],
            behalten: 1,
        });

        const markup = await render();

        expect(markup.match(/data-angeboten=/g)?.length).toBe(3);
        expect(markup).toContain("Eins");
        expect(markup).toContain("Drei");
    });

    it("verlangt keinen Abwurf, solange die Hand Platz hat", async () => {
        stores.hand.set([KARTE("h1", "Alt")]);
        stores.pendingDraw.set({
            questionId: "q1",
            angeboten: [KARTE("d1", "Eins"), KARTE("d2", "Zwei")],
            behalten: 1,
        });

        const markup = await render();

        expect(markup).not.toContain("cards.discardPrompt");
    });

    it("verlangt einen Abwurf, wenn die Hand über sechs käme", async () => {
        stores.hand.set(
            Array.from({ length: 6 }, (_, i) => KARTE(`h${i}`, `Alt ${i}`)),
        );
        stores.pendingDraw.set({
            questionId: "q1",
            angeboten: [KARTE("d1", "Eins"), KARTE("d2", "Zwei")],
            behalten: 1,
        });

        const markup = await render();

        expect(markup).toContain("cards.discardPrompt");
        expect(markup.match(/data-handcard=/g)?.length).toBe(6);
    });
});
```

- [ ] **Schritt 3: Test laufen lassen, er muss scheitern**

```bash
cd ~/hideandseek && pnpm vitest run src/components/__tests__/zieh-schirm.test.tsx
```

Erwartet: FAIL, Modul nicht gefunden.

- [ ] **Schritt 4: Den Schirm schreiben**

Erstelle `src/components/session/cards/ZiehSchirm.tsx`:

```tsx
/**
 * Vollbildschirm für "N ansehen, M behalten".
 *
 * Sichtbar, solange der Store einen offenen Ziehvorgang kennt. Der Vorgang
 * kommt aus dem sync-Ereignis zurück, ein Neuladen mitten im Ziehen verliert
 * also nichts.
 */
import type { HandKarte } from "@hideandseek/shared";
import { useStore } from "@nanostores/react";
import { useRef, useState } from "react";
import { toast } from "react-toastify";

import { useT, useTFmt } from "@/i18n";
import { behalten as behaltenApi } from "@/lib/cards-api";
import { applyHandUpdated, hand, pendingDraw } from "@/lib/deck-context";
import { sessionParticipant } from "@/lib/session-context";

const HANDLIMIT = 6;

export function ZiehSchirm() {
    const tr = useT();
    const trf = useTFmt();
    const $participant = useStore(sessionParticipant);
    const $pendingDraw = useStore(pendingDraw);
    const $hand = useStore(hand);

    const [gewaehlt, setGewaehlt] = useState<string[]>([]);
    const [abwurf, setAbwurf] = useState<string[]>([]);
    const [laufend, setLaufend] = useState(false);
    const laufendRef = useRef(false);

    if (!$pendingDraw || $participant?.role !== "hider") return null;

    const noetig = Math.min($pendingDraw.behalten, $pendingDraw.angeboten.length);
    const zuViel = $hand.length + noetig - HANDLIMIT;
    const noetigerAbwurf = Math.max(0, zuViel);
    const bereit =
        gewaehlt.length === noetig && abwurf.length === noetigerAbwurf && !laufend;

    function umschalten(liste: string[], id: string, max: number): string[] {
        if (liste.includes(id)) return liste.filter((x) => x !== id);
        if (liste.length >= max) return liste;
        return [...liste, id];
    }

    async function absenden() {
        // Die Ref sperrt synchron: `bereit` wird erst beim naechsten Rendern
        // neu berechnet, zwei Tipper im selben Tick kaemen sonst beide durch.
        if (!bereit || laufendRef.current || !$participant?.token) return;
        laufendRef.current = true;
        setLaufend(true);
        try {
            const antwort = await behaltenApi(
                $pendingDraw!.questionId,
                $participant.token,
                {
                    behalten: gewaehlt,
                    abwerfen: abwurf.length > 0 ? abwurf : undefined,
                },
            );
            // Die Antwort direkt anwenden, statt auf hand_updated zu warten:
            // applyHandUpdated setzt pendingDraw auf null und schliesst damit
            // den Schirm. Reisst die WebSocket-Verbindung ab, waehrend der
            // Aufruf durchgeht, saesse der Versteckende sonst in einem Vollbild
            // ohne Schliessknopf fest. Das spaetere Ereignis setzt dieselben
            // Werte noch einmal und schadet nicht.
            applyHandUpdated({ hand: antwort.hand, deckRest: antwort.deckRest });
            setGewaehlt([]);
            setAbwurf([]);
        } catch (e) {
            toast.error((e as Error).message);
        } finally {
            laufendRef.current = false;
            setLaufend(false);
        }
    }

    function kartenKnopf(
        karte: HandKarte,
        aktiv: boolean,
        onClick: () => void,
        marker: "angeboten" | "handcard",
    ) {
        return (
            <button
                key={karte.id}
                {...(marker === "angeboten"
                    ? { "data-angeboten": karte.id }
                    : { "data-handcard": karte.id })}
                onClick={onClick}
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 6,
                    background: aktiv ? "var(--color-primary)" : "var(--color-panel)",
                    border: `2px solid ${aktiv ? "var(--color-primary)" : "rgba(245,245,240,0.08)"}`,
                    borderRadius: "var(--radius-default)",
                    padding: "12px 14px",
                    cursor: "pointer",
                    textAlign: "left",
                    width: "100%",
                }}
            >
                <span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>
                    {karte.karte.name}
                </span>
                <span style={{ color: "rgba(255,255,255,0.75)", fontSize: 12, lineHeight: 1.45, whiteSpace: "pre-line" }}>
                    {karte.karte.text}
                </span>
            </button>
        );
    }

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 1300,
                background: "var(--hs-dark, #14161A)",
                overflowY: "auto",
                padding: "24px 16px 32px",
                display: "flex",
                flexDirection: "column",
                gap: 14,
            }}
        >
            <h2 style={{ color: "#fff", fontSize: 22, fontWeight: 800, margin: 0, fontFamily: "Poppins, sans-serif" }}>
                {tr("cards.drawTitle")}
            </h2>
            <p style={{ color: "rgba(245,245,240,0.6)", fontSize: 14, margin: 0 }}>
                {trf("cards.drawHint", {
                    draw: $pendingDraw.angeboten.length,
                    keep: noetig,
                })}
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {$pendingDraw.angeboten.map((karte) =>
                    kartenKnopf(
                        karte,
                        gewaehlt.includes(karte.id),
                        () => setGewaehlt((l) => umschalten(l, karte.id, noetig)),
                        "angeboten",
                    ),
                )}
            </div>

            {noetigerAbwurf > 0 ? (
                <>
                    <p style={{ color: "#F37748", fontSize: 14, fontWeight: 600, margin: "8px 0 0" }}>
                        {trf("cards.discardPrompt", { n: noetigerAbwurf })}
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {$hand.map((karte) =>
                            kartenKnopf(
                                karte,
                                abwurf.includes(karte.id),
                                () => setAbwurf((l) => umschalten(l, karte.id, noetigerAbwurf)),
                                "handcard",
                            ),
                        )}
                    </div>
                </>
            ) : null}

            <span style={{ color: "rgba(245,245,240,0.5)", fontSize: 13 }}>
                {trf("cards.keepCount", { gewaehlt: gewaehlt.length, noetig })}
            </span>

            <button
                onClick={() => void absenden()}
                disabled={!bereit}
                style={{
                    marginTop: 4,
                    background: "var(--color-primary)",
                    border: "none",
                    borderRadius: "var(--radius-pill)",
                    padding: "14px 32px",
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: 15,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    cursor: bereit ? "pointer" : "default",
                    opacity: bereit ? 1 : 0.4,
                }}
            >
                {tr("cards.keepButton")}
            </button>
        </div>
    );
}
```

- [ ] **Schritt 5: Den Schirm rendern**

In `src/components/BottomSheetPanel.tsx` neben `<QuestionPickerSheet />` und `<AnswerOverlay />`:

```tsx
            <ZiehSchirm />
```

mit dem Import `import { ZiehSchirm } from "@/components/session/cards/ZiehSchirm";`.

- [ ] **Schritt 6: Das vorhandene Overlay zum Knopf machen**

In `src/components/session/SessionQuestionPanel.tsx` im Block `if (cardDrawOverlay)` (Zeile 1194–1240) den Knopf „Weiter" ersetzen. Er ruft jetzt den Ziehendpunkt auf und legt das Ergebnis in `pendingDraw` — dadurch öffnet sich der Ziehschirm.

Importe ergänzen:

```ts
import { ziehen } from "@/lib/cards-api";
import { cardsEnabled, deckRest, pendingDraw } from "@/lib/deck-context";
```

Den Knopf ersetzen durch:

```tsx
                <button
                    onClick={async () => {
                        const teilnehmer = sessionParticipant.get();
                        if (!cardsEnabled.get() || !teilnehmer?.token) {
                            setCardDrawOverlay(null);
                            return;
                        }
                        try {
                            const antwort = await ziehen(
                                cardDrawOverlay.questionId,
                                teilnehmer.token,
                            );
                            pendingDraw.set({
                                questionId: cardDrawOverlay.questionId,
                                angeboten: antwort.angeboten,
                                behalten: antwort.behalten,
                            });
                            deckRest.set(antwort.deckRest);
                        } catch (e) {
                            toast.error((e as Error).message);
                        } finally {
                            setCardDrawOverlay(null);
                        }
                    }}
                    style={{
                        marginTop: 8,
                        background: "var(--color-primary)",
                        borderRadius: "var(--radius-pill)",
                        border: "none",
                        cursor: "pointer",
                        padding: "12px 32px",
                        color: "#fff",
                        fontWeight: 700,
                        fontSize: "15px",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                    }}
                >
                    {tr("cards.drawOpen")}
                </button>
```

**Voraussetzung:** `cardDrawOverlay` muss die Fragenkennung tragen. Der vorhandene Zustand hält nur `{ draw, keep }`; erweitere ihn beim Setzen (dort, wo er nach einer beantworteten Frage gefüllt wird, um Zeile 1139) um `questionId: question.id` und den Typ entsprechend. Ist die Kartenmechanik aus, bleibt das Overlay reine Anzeige wie bisher — dann greift der frühe `return` oben.

- [ ] **Schritt 7: Test laufen lassen, er muss bestehen**

```bash
cd ~/hideandseek && pnpm vitest run src/components/__tests__/zieh-schirm.test.tsx
```

Erwartet: PASS, fünf Fälle.

- [ ] **Schritt 8: Typen prüfen und committen**

```bash
cd ~/hideandseek && pnpm run check
git add src/components/session/cards/ZiehSchirm.tsx src/components/BottomSheetPanel.tsx src/components/session/SessionQuestionPanel.tsx src/components/__tests__/zieh-schirm.test.tsx src/i18n/de.ts src/i18n/en.ts
git commit -m "feat(karten): Ziehschirm mit N ansehen, M behalten

Das vorhandene Overlay nach einer beantworteten Frage wird zum Knopf und
oeffnet den Schirm. Waere die Hand danach ueber sechs, verlangt derselbe
Schirm die noetigen Abwuerfe, bevor er sendet.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FyNQKwGJJYxVZrmyEh4GfF"
```

---

## Task 13: Der Fluch schlägt bei den Suchenden ein

**Dateien:**
- Erstellen: `src/components/session/cards/FluchOverlay.tsx`
- Ändern: `src/lib/deck-context.ts` (Trigger-Atom)
- Ändern: `src/hooks/useSessionWebSocket.ts` (Trigger setzen)
- Ändern: `src/components/BottomSheetPanel.tsx` (Overlay rendern)
- Ändern: `src/i18n/de.ts`, `src/i18n/en.ts`
- Test: `src/components/__tests__/fluch-overlay.test.tsx`

**Schnittstellen:**
- Verbraucht: `activeCurses` (Task 7)
- Liefert: `eingeschlagenerFluch`-Atom und `<FluchOverlay />`

- [ ] **Schritt 1: Übersetzungsschlüssel anlegen**

`src/i18n/de.ts`:

```ts
    "cards.curseHit": "Fluch!",
    "cards.curseUnderstood": "Verstanden",
```

`src/i18n/en.ts`:

```ts
    "cards.curseHit": "Curse!",
    "cards.curseUnderstood": "Got it",
```

- [ ] **Schritt 2: Den scheiternden Test schreiben**

Erstelle `src/components/__tests__/fluch-overlay.test.tsx`:

```tsx
/**
 * Prüft das Vollbild-Overlay, das bei den Suchenden aufschlägt, wenn ein
 * Fluch gespielt wird.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stores = vi.hoisted(() => {
    function box<T>(initial: T) {
        return {
            value: initial,
            get() {
                return this.value;
            },
            set(v: T) {
                this.value = v;
            },
        };
    }
    return {
        eingeschlagenerFluch: box<any>(null),
        sessionParticipant: box<any>({ role: "seeker", token: "t" }),
    };
});

vi.mock("@nanostores/react", () => ({ useStore: (s: any) => s.get() }));

vi.mock("@/lib/deck-context", () => ({
    eingeschlagenerFluch: stores.eingeschlagenerFluch,
}));

vi.mock("@/lib/session-context", () => ({
    sessionParticipant: stores.sessionParticipant,
}));

vi.mock("@/i18n", () => ({ useT: () => (key: string) => key }));

const FLUCH = {
    id: "c1",
    karte: {
        id: "fluch-brueckenzoll",
        art: "fluch",
        name: "Brückenzoll",
        text: "Stellt euch unter eine Brücke.",
        kosten: "Mindestabstand.",
        gruppe: "aufgabe",
        dauerMin: null,
        anzahl: 1,
    },
    playedAt: new Date().toISOString(),
    expiresAt: null,
    endedAt: null,
    endedBy: null,
};

async function render() {
    const { FluchOverlay } = await import("../session/cards/FluchOverlay");
    return renderToStaticMarkup(<FluchOverlay />);
}

describe("FluchOverlay", () => {
    beforeEach(() => {
        stores.eingeschlagenerFluch.set(null);
        stores.sessionParticipant.set({ role: "seeker", token: "t" });
        vi.resetModules();
    });

    it("zeichnet nichts, solange kein Fluch eingeschlagen ist", async () => {
        expect(await render()).toBe("");
    });

    it("zeigt Name und Text des Fluchs", async () => {
        stores.eingeschlagenerFluch.set(FLUCH);

        const markup = await render();

        expect(markup).toContain("cards.curseHit");
        expect(markup).toContain("Brückenzoll");
        expect(markup).toContain("Stellt euch unter eine Brücke.");
    });

    it("zeigt die Kosten der Karte nicht", async () => {
        // Die Kosten betreffen den Versteckenden; die Suchenden gehen sie nichts an.
        stores.eingeschlagenerFluch.set(FLUCH);

        const markup = await render();

        expect(markup).not.toContain("Mindestabstand.");
    });

    it("zeichnet beim Versteckenden nichts", async () => {
        stores.sessionParticipant.set({ role: "hider", token: "t" });
        stores.eingeschlagenerFluch.set(FLUCH);

        expect(await render()).toBe("");
    });
});
```

- [ ] **Schritt 3: Test laufen lassen, er muss scheitern**

```bash
cd ~/hideandseek && pnpm vitest run src/components/__tests__/fluch-overlay.test.tsx
```

Erwartet: FAIL, Modul nicht gefunden.

- [ ] **Schritt 4: Das Trigger-Atom ergänzen**

In `src/lib/deck-context.ts`:

```ts
/**
 * Der zuletzt eingeschlagene Fluch, solange das Overlay ihn zeigt.
 * Wird vom Overlay selbst wieder auf null gesetzt.
 */
export const eingeschlagenerFluch = atom<Fluch | null>(null);
```

und in `resetDeckState()`:

```ts
    eingeschlagenerFluch.set(null);
```

- [ ] **Schritt 5: Den Trigger beim Ereignis setzen**

In `src/hooks/useSessionWebSocket.ts` im Zweig `case "curse_played":` den Block für Suchende erweitern:

```ts
                        if (getRole() === "seeker") {
                            eingeschlagenerFluch.set(event.curse);
                            playSound("notification");
                            navigator.vibrate?.([200, 100, 200]);
                        }
```

mit `eingeschlagenerFluch` im Import aus `@/lib/deck-context`.

- [ ] **Schritt 6: Das Overlay schreiben**

Erstelle `src/components/session/cards/FluchOverlay.tsx`:

```tsx
/**
 * Vollbild-Einschlag bei den Suchenden, wenn ein Fluch gespielt wird.
 * Baugleich zu AnswerOverlay.tsx: liegt über allem, verschwindet auf Tippen.
 *
 * Die Kosten der Karte bleiben draußen — sie betreffen den Versteckenden.
 */
import { useStore } from "@nanostores/react";

import { useT } from "@/i18n";
import { eingeschlagenerFluch } from "@/lib/deck-context";
import { sessionParticipant } from "@/lib/session-context";

export function FluchOverlay() {
    const tr = useT();
    const $participant = useStore(sessionParticipant);
    const $fluch = useStore(eingeschlagenerFluch);

    if (!$fluch || $participant?.role !== "seeker") return null;

    return (
        <div
            onClick={() => eingeschlagenerFluch.set(null)}
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 1400,
                background: "rgba(20,22,26,0.97)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 18,
                padding: "32px 24px",
                textAlign: "center",
                cursor: "pointer",
            }}
        >
            <span style={{ fontSize: 44 }}>🃏</span>

            <span style={{ color: "#D56062", fontSize: 16, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                {tr("cards.curseHit")}
            </span>

            <h2 style={{ color: "#fff", fontSize: 28, fontWeight: 800, margin: 0, fontFamily: "Poppins, sans-serif" }}>
                {$fluch.karte.name}
            </h2>

            <p style={{ color: "rgba(245,245,240,0.85)", fontSize: 15, lineHeight: 1.6, margin: 0, maxWidth: 420, whiteSpace: "pre-line" }}>
                {$fluch.karte.text}
            </p>

            <span
                style={{
                    marginTop: 12,
                    background: "var(--color-primary)",
                    borderRadius: "var(--radius-pill)",
                    padding: "12px 32px",
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: 15,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                }}
            >
                {tr("cards.curseUnderstood")}
            </span>
        </div>
    );
}
```

- [ ] **Schritt 7: Das Overlay rendern**

In `src/components/BottomSheetPanel.tsx` neben `<AnswerOverlay />`:

```tsx
            <FluchOverlay />
```

mit dem Import `import { FluchOverlay } from "@/components/session/cards/FluchOverlay";`.

- [ ] **Schritt 8: Test laufen lassen, er muss bestehen**

```bash
cd ~/hideandseek && pnpm vitest run src/components/__tests__/fluch-overlay.test.tsx
```

Erwartet: PASS, vier Fälle.

- [ ] **Schritt 9: Typen prüfen und committen**

```bash
cd ~/hideandseek && pnpm run check
git add src/components/session/cards/FluchOverlay.tsx src/lib/deck-context.ts src/hooks/useSessionWebSocket.ts src/components/BottomSheetPanel.tsx src/components/__tests__/fluch-overlay.test.tsx src/i18n/de.ts src/i18n/en.ts
git commit -m "feat(karten): Fluch schlaegt bei den Suchenden als Vollbild ein

Baugleich zu AnswerOverlay, mit Ton und Vibration. Die Kosten der Karte
bleiben draussen, sie betreffen den Versteckenden.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FyNQKwGJJYxVZrmyEh4GfF"
```

---

## Task 14: Schalter in den Einstellungen

**Dateien:**
- Ändern: `backend/src/routes/cards.ts` (ein Endpunkt dazu)
- Ändern: `shared/src/events.ts` (`cards_toggled`)
- Ändern: `src/lib/cards-api.ts` (`kartenmechanikSchalten`)
- Ändern: `src/hooks/useSessionWebSocket.ts` (Ereignis verarbeiten)
- Ändern: `src/components/settings/GeneralSettings.tsx`
- Ändern: `src/i18n/de.ts`, `src/i18n/en.ts`
- Test: `backend/src/test/rest/cards-schalten.test.ts`

**Schnittstellen:**
- Verbraucht: `getAktiveFlueche`, `verwirfAblauf` (Task 5); `cardsEnabled` (Task 7)
- Liefert: `PATCH /api/sessions/:code/cards`, Ereignis `cards_toggled`

**Die Regel beim Ausschalten:** Alle laufenden Flüche enden sofort mit
`ended_by = 'versteckender'`. „Aus" muss heißen, dass sich die App wie vor
diesem Vorhaben verhält; ein weiterlaufender Fluch widerspräche dem. Hand,
Ablage und Deck bleiben unangetastet — wer wieder einschaltet, findet seine
Karten vor.

**Wer darf schalten:** nur der Versteckende. Ein Suchender darf einen Fluch
nicht per Schalter loswerden.

**Dieser Endpunkt weist nicht mit `cards_disabled` ab.** Er ist der Weg zurück.

- [ ] **Schritt 1: Den scheiternden Test schreiben**

Erstelle `backend/src/test/rest/cards-schalten.test.ts`:

```ts
/**
 * Prüft das Umlegen der Kartenmechanik mitten in der Sitzung.
 */
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";

import { KARTEN } from "@hideandseek/shared";
import { createTestApp, createTestDb, req } from "../helpers.js";
import { schema } from "../../db/schema.js";

type TestDb = ReturnType<typeof createTestDb>;

const FLUCHKARTE = KARTEN.find((k) => k.art === "fluch" && k.dauerMin === null)!;

async function aufbau(app: Hono, db: TestDb, cardsEnabled = true) {
    const { body: created } = await req<any>(app, "POST", "/api/sessions", {
        body: { displayName: "Hider Hans", gameSize: "M", cardsEnabled },
        expectStatus: 201,
    });
    const code = created.session.code as string;
    const { body: joined } = await req<any>(
        app, "POST", `/api/sessions/${code}/join`,
        { body: { role: "seeker", displayName: "Sucher Sven" }, expectStatus: 201 },
    );
    return {
        code,
        sessionId: created.session.id as string,
        hiderToken: created.participant.token as string,
        seekerToken: joined.participant.token as string,
    };
}

/** Legt einen Fluch auf die Hand und spielt ihn aus. */
async function fluchSpielen(app: Hono, db: TestDb, a: any): Promise<string> {
    const deckCardId = nanoid();
    await db.insert(schema.deckCards).values({
        id: deckCardId,
        sessionId: a.sessionId,
        cardId: FLUCHKARTE.id,
        position: 0,
        state: "hand",
    });
    const { body } = await req<any>(
        app, "POST", `/api/sessions/${a.code}/curses`,
        { body: { deckCardId }, token: a.hiderToken, expectStatus: 201 },
    );
    return body.curse.id as string;
}

describe("PATCH /api/sessions/:code/cards", () => {
    it("schaltet ein", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db, false);

        const { body } = await req<any>(
            app, "PATCH", `/api/sessions/${a.code}/cards`,
            { body: { cardsEnabled: true }, token: a.hiderToken, expectStatus: 200 },
        );

        expect(body.cardsEnabled).toBe(true);
        const row = await db.query.sessions.findFirst({
            where: eq(schema.sessions.id, a.sessionId),
        });
        expect(row!.cardsEnabled).toBe(true);
    });

    it("schaltet aus", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db, true);

        const { body } = await req<any>(
            app, "PATCH", `/api/sessions/${a.code}/cards`,
            { body: { cardsEnabled: false }, token: a.hiderToken, expectStatus: 200 },
        );

        expect(body.cardsEnabled).toBe(false);
    });

    it("beendet laufende Flüche beim Ausschalten", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db, true);
        const curseId = await fluchSpielen(app, db, a);

        await req<any>(
            app, "PATCH", `/api/sessions/${a.code}/cards`,
            { body: { cardsEnabled: false }, token: a.hiderToken, expectStatus: 200 },
        );

        const row = await db.query.curses.findFirst({
            where: eq(schema.curses.id, curseId),
        });
        expect(row!.endedAt).not.toBeNull();
        expect(row!.endedBy).toBe("versteckender");
    });

    it("lässt Hand und Deck unangetastet", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db, true);
        const deckCardId = nanoid();
        await db.insert(schema.deckCards).values({
            id: deckCardId,
            sessionId: a.sessionId,
            cardId: FLUCHKARTE.id,
            position: 0,
            state: "hand",
        });

        await req<any>(
            app, "PATCH", `/api/sessions/${a.code}/cards`,
            { body: { cardsEnabled: false }, token: a.hiderToken, expectStatus: 200 },
        );

        const row = await db.query.deckCards.findFirst({
            where: eq(schema.deckCards.id, deckCardId),
        });
        expect(row!.state).toBe("hand");
    });

    it("weist einen Suchenden ab", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db, true);

        const { status } = await req<any>(
            app, "PATCH", `/api/sessions/${a.code}/cards`,
            { body: { cardsEnabled: false }, token: a.seekerToken },
        );

        expect(status).toBe(403);
    });

    it("verlangt einen booleschen Wert", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db, true);

        const { status } = await req<any>(
            app, "PATCH", `/api/sessions/${a.code}/cards`,
            { body: { cardsEnabled: "ja" }, token: a.hiderToken },
        );

        expect(status).toBe(400);
    });

    it("weist bei ausgeschalteter Mechanik nicht mit cards_disabled ab", async () => {
        const db = createTestDb();
        const app = createTestApp(db);
        const a = await aufbau(app, db, false);

        const { status } = await req<any>(
            app, "PATCH", `/api/sessions/${a.code}/cards`,
            { body: { cardsEnabled: true }, token: a.hiderToken },
        );

        expect(status).toBe(200);
    });
});
```

- [ ] **Schritt 2: Test laufen lassen, er muss scheitern**

```bash
cd ~/hideandseek && pnpm --filter @hideandseek/backend test src/test/rest/cards-schalten.test.ts
```

Erwartet: FAIL, 404 auf `PATCH`.

- [ ] **Schritt 3: Das Ereignis ergänzen**

In `shared/src/events.ts` in die `ServerToClientEvent`-Union:

```ts
    | {
          /** An alle: die Kartenmechanik wurde ein- oder ausgeschaltet. */
          type: "cards_toggled";
          cardsEnabled: boolean;
      }
```

- [ ] **Schritt 4: Den Endpunkt schreiben**

In `backend/src/routes/cards.ts` vor `return router;`:

```ts
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
                wsManager.broadcast(sessionRow.code, {
                    type: "curse_ended",
                    curseId: fluch.id,
                    endedBy: "versteckender",
                    endedAt,
                });
            }
        }

        wsManager.broadcast(sessionRow.code, {
            type: "cards_toggled",
            cardsEnabled,
        });

        return c.json({ cardsEnabled });
    });
```

- [ ] **Schritt 5: Test laufen lassen, er muss bestehen**

```bash
cd ~/hideandseek && pnpm --filter @hideandseek/backend test src/test/rest/cards-schalten.test.ts
```

Erwartet: PASS, sieben Fälle.

- [ ] **Schritt 6: Den API-Aufruf ergänzen**

In `src/lib/cards-api.ts`:

```ts
export function kartenmechanikSchalten(
    code: string,
    token: string,
    cardsEnabled: boolean,
): Promise<{ cardsEnabled: boolean }> {
    return apiFetch(`/api/sessions/${code}/cards`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ cardsEnabled }),
    });
}
```

- [ ] **Schritt 7: Das Ereignis im Client verarbeiten**

In `src/hooks/useSessionWebSocket.ts` einen Zweig ergänzen:

```ts
                    case "cards_toggled":
                        cardsEnabled.set(event.cardsEnabled);
                        if (!event.cardsEnabled) {
                            resetDeckState();
                            cardsEnabled.set(false);
                        }
                        break;
```

`resetDeckState()` leert Hand, Deckrest, offenen Zug und Fluchliste im Client. Die Karten selbst bleiben auf dem Server liegen; beim Wiedereinschalten holt das nächste `sync` sie zurück. Der zweite `set` steht dort, weil `resetDeckState()` `cardsEnabled` mit zurücksetzt — die Reihenfolge ist Absicht und darf nicht zusammengefasst werden.

Importe ergänzen: `cardsEnabled`, `resetDeckState` aus `@/lib/deck-context`.

- [ ] **Schritt 8: Übersetzungsschlüssel anlegen**

`src/i18n/de.ts`:

```ts
    "settings.cards": "Kartenmechanik",
    "settings.cardsDesc": "Karten ziehen und Flüche spielen. Ausschalten beendet alle laufenden Flüche.",
    "settings.cardsConfirmOff": "Kartenmechanik ausschalten? Alle laufenden Flüche enden dabei.",
```

`src/i18n/en.ts`:

```ts
    "settings.cards": "Card mechanic",
    "settings.cardsDesc": "Draw cards and play curses. Turning it off ends all running curses.",
    "settings.cardsConfirmOff": "Turn off the card mechanic? All running curses will end.",
```

- [ ] **Schritt 9: Den Schalter einbauen**

In `src/components/settings/GeneralSettings.tsx` die Importe ergänzen:

```ts
import { useState } from "react";
import { toast } from "react-toastify";

import { kartenmechanikSchalten } from "@/lib/cards-api";
import { activeCurses, cardsEnabled } from "@/lib/deck-context";
import { sessionCode, sessionParticipant } from "@/lib/session-context";
```

In der Komponente:

```ts
    const $participant = useStore(sessionParticipant);
    const $sessionCode = useStore(sessionCode);
    const $cardsEnabled = useStore(cardsEnabled);
    const $activeCurses = useStore(activeCurses);
    const [kartenLaufend, setKartenLaufend] = useState(false);

    const darfKartenSchalten =
        $participant?.role === "hider" && $sessionCode !== null;

    async function kartenSchalten(wert: boolean) {
        if (!$sessionCode || !$participant?.token || kartenLaufend) return;
        if (!wert && $activeCurses.length > 0) {
            if (!window.confirm(tr("settings.cardsConfirmOff"))) return;
        }
        setKartenLaufend(true);
        try {
            await kartenmechanikSchalten($sessionCode, $participant.token, wert);
            // cardsEnabled kommt über das cards_toggled-Ereignis zurück.
        } catch (e) {
            toast.error((e as Error).message);
        } finally {
            setKartenLaufend(false);
        }
    }
```

Und als weitere Zeile, hinter der Benachrichtigungs-Zeile:

```tsx
            {/* ── Kartenmechanik (nur der Versteckende, nur in einer Sitzung) ── */}
            {darfKartenSchalten ? (
                <SettingsRow
                    title={tr("settings.cards")}
                    description={tr("settings.cardsDesc")}
                >
                    <Switch
                        checked={$cardsEnabled}
                        disabled={kartenLaufend}
                        onCheckedChange={(v) => void kartenSchalten(v)}
                    />
                </SettingsRow>
            ) : null}
```

Anders als seine Nachbarn schaltet dieser Schalter kein lokales Atom, sondern
schickt einen `PATCH` und wartet auf die Antwort des Servers. Deshalb ist er
währenddessen gesperrt, und deshalb setzt `onCheckedChange` `cardsEnabled`
nicht selbst — das erledigt das `cards_toggled`-Ereignis.

- [ ] **Schritt 10: Typen prüfen und committen**

```bash
cd ~/hideandseek && pnpm shared:build && pnpm backend:build && pnpm run check
git add backend/src/routes/cards.ts shared/src/events.ts src/lib/cards-api.ts src/hooks/useSessionWebSocket.ts src/components/settings/GeneralSettings.tsx src/i18n/de.ts src/i18n/en.ts backend/src/test/rest/cards-schalten.test.ts
git commit -m "feat(karten): Kartenmechanik in den Einstellungen umlegen

Nur der Versteckende darf schalten. Ausschalten beendet alle laufenden
Flueche, damit aus wirklich heisst, dass sich die App wie vorher verhaelt;
Hand und Deck bleiben liegen.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FyNQKwGJJYxVZrmyEh4GfF"
```

---

## Task 15: Durchspielen zu zweit

**Dateien:** keine Änderung geplant. Was auffällt, wird hier behoben und einzeln committet.

Diese Aufgabe ist die einzige, die nicht automatisch prüfbar ist. Sie fängt, was zwölf grüne Testdateien nicht fangen: dass die Teile zusammen ein spielbares Ganzes ergeben.

- [ ] **Schritt 1: Alles laufen lassen**

```bash
cd ~/hideandseek && pnpm shared:build && pnpm backend:build && pnpm run check && pnpm --filter @hideandseek/backend test && pnpm vitest run
```

Erwartet: alles grün. Scheitert etwas, hier beheben, nicht später.

- [ ] **Schritt 2: Örtlich starten**

```bash
cd ~/hideandseek && pnpm dev
```

Backend und Frontend laufen. Zwei Browserfenster öffnen, eines davon im privaten Modus, damit sich die beiden localStorage-Stände nicht ins Gehege kommen.

- [ ] **Schritt 3: Die Kette einmal durchspielen**

1. Sitzung gründen, Spielgröße **M**, Haken bei „Kartenmechanik" gesetzt. Als Versteckender beitreten.
2. Im zweiten Fenster mit dem Code als Suchender beitreten.
3. Der Reiter „Hand" muss beim Versteckenden erscheinen, „Flüche" beim Suchenden.
4. Als Suchender eine Matching-Frage stellen, als Versteckender beantworten.
5. Das Overlay „Du darfst Karten ziehen!" antippen — der Ziehschirm zeigt **drei** Karten, eine ist zu behalten.
6. Eine wählen, „Behalten". Die Karte liegt im Reiter „Hand".
7. **Neu laden, während der Ziehschirm offen ist** (Schritt 5 wiederholen und vor dem Behalten F5 drücken): Der Schirm muss nach dem Verbinden wieder mit denselben drei Karten dastehen.
8. Sechs Karten auf die Hand bringen, dann eine siebte ziehen: Der Schirm muss einen Abwurf verlangen.
9. Einen Fluch auf die Hand bekommen (nötigenfalls mehrfach ziehen) und ausspielen. Beim Suchenden muss das Vollbild aufschlagen, mit Vibration auf dem Handy.
10. Einen Zeitfluch spielen und den Countdown beim Suchenden ablaufen sehen — notfalls die Ablaufzeit in der Datenbank kürzen.
11. Bei einem Aufgabenfluch als Suchender „erledigt" tippen: Der Fluch verschwindet bei beiden.
12. Als Versteckender einen Fluch „aufheben": dasselbe.
13. **In den Einstellungen umlegen.** Als Versteckender die Kartenmechanik
    ausschalten, während ein Fluch läuft: Die Rückfrage muss kommen, der Fluch
    bei beiden verschwinden, der Reiter bei beiden weggehen. Wieder einschalten:
    Die Hand von vorhin ist zurück. Ein Suchender darf den Schalter gar nicht
    erst sehen.
14. **Zweite Sitzung ohne Haken gründen.** Kein Kartenreiter bei beiden Rollen, und das Overlay nach einer beantworteten Frage bleibt die reine Anzeige mit „Weiter" wie vor diesem Vorhaben.

- [ ] **Schritt 4: Auf dem Handy nachsehen**

Die Entwicklungsadresse im gleichen WLAN auf dem Telefon öffnen (die CORS-Regeln in `backend/src/app.ts` lassen `192.168.*` durch). Prüfen: Passen Ziehschirm und Kartenansicht auf einen Handybildschirm, ohne dass etwas waagerecht scrollt? Ist der Text der Karten lesbar, ohne zu zoomen?

- [ ] **Schritt 5: Was aufgefallen ist, beheben und committen**

Je Fund ein eigener Commit mit der Vorlage aus den globalen Vorgaben. Ist nichts aufgefallen, hier nichts committen.

- [ ] **Schritt 6: Auf `master` bringen**

Erst wenn Schritt 1 bis 5 durch sind:

```bash
cd ~/hideandseek && git push origin HEAD
```

Der Deploy läuft danach von allein über GitHub Actions (siehe `.github/workflows/ci.yml`): Job `test` prüft alle drei Typebenen und beide Testsuiten, Job `deploy` rollt bei einem Push auf `master` aus. Nach dem Durchlauf `https://hideandseek.vielhaben.com` aufrufen und eine Sitzung mit Karten gründen, um den Ausrollstand zu bestätigen.
