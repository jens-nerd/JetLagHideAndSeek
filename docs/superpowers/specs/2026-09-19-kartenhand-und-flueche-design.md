# Kartenhand und Flüche — Design

**Stand:** 19.09.2026
**Verfasst nach:** Gespräch mit Jens, Erkundungsberichten von Flo (Backend) und Tobi (Frontend)

## Worum es geht

Der Versteckende zieht Karten als Gegenleistung für beantwortete Fragen, hält eine
Hand und spielt Flüche gegen die Suchenden aus. Die Karten stammen aus dem
deutschen Satz in `Jens Inbox/2026-09-19_hideandseek-Kartensatz/kartensatz.md`.

Das Ganze ist pro Spielsitzung abschaltbar. Ist es aus, verhält sich die App wie
heute.

## Was diese Stufe nicht baut

Ausdrücklich später, nicht hier:

- Powerups (21 Karten) und Stationsfallen (2 Karten). Sie bleiben aus dem Deck.
- Die Regel „von den Sperrflüchen darf immer nur einer laufen".
- Das Aussuchen einer Zielperson (Blinder Passagier trifft in dieser Stufe alle).
- Automatische Gutschrift der Bonusminuten auf eine Spieluhr.
- Benachrichtigung, wenn die App geschlossen oder im Hintergrund ist. Es gibt
  heute keine funktionierende Push-Zustellung (siehe „Bekannte Grenzen").
- Übersetzung der Kartentexte. Sie sind deutsch, auch bei englischer Oberfläche.

## Entscheidungen, die Jens getroffen hat

| Frage | Entscheidung |
|---|---|
| Ende eines Fluchs | Beides: Countdown, wo die Karte eine Dauer trägt; „erledigt" durch die Suchenden, wo nicht |
| Kartenquelle | Der deutsche Satz aus `kartensatz.md` |
| Ziehregel | Nach beantworteter Frage, mit Auswahl („N ansehen, M behalten") |
| Alarm bei den Suchenden | Vorerst nur in der App |
| Deckumfang | Nur Flüche und Zeitboni, 77 Karten |
| Wer beendet | Suchende melden „erledigt", der Versteckende kann aufheben |
| Abschaltbar | Ja, im Onboarding **und** in den Einstellungen (Nachtrag) |

**Nachtrag vom 19.09.2026:** Hier stand zunächst, der Schalter wirke nur bei der
Sitzungsgründung. Jens will ihn zusätzlich in den Einstellungen haben. Die
Kartenmechanik lässt sich deshalb **auch mitten im Spiel** umlegen, allerdings
nur vom Versteckenden — ein Suchender darf einen Fluch nicht per Schalter
loswerden.

Was beim Ausschalten passiert: Alle laufenden Flüche enden sofort mit dem Grund
`versteckender`, damit „aus" wirklich heißt, dass die App sich wie vorher
verhält. Hand, Ablage und Deck bleiben unangetastet in der Datenbank liegen;
wer wieder einschaltet, findet seine Karten vor.

## Folge der Deckentscheidung

Maya hat das Deck auf 100 Karten mit 30 Prozent Ziehquote für Flüche und Fallen
ausbalanciert. Ohne Powerups und Stationsfallen bleiben 77 Karten mit 28 Flüchen,
also 36 Prozent. Das Spiel wird fluchlastiger als geplant. Das ist bekannt und
gewollt; nachjustieren heißt, Zahlen in einer Datei zu ändern.

---

## 1. Kartendaten

Neue Datei `shared/src/karten.ts`. In `shared/`, weil Backend (Deckaufbau,
Dauerberechnung, Prüfung beim Ausspielen) und Frontend (Anzeige) dieselbe
Wahrheit brauchen.

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
    /** Haupttext der Karte, mehrere Absätze, durch \n\n getrennt */
    text: string;
    /** Zeile "Kosten:" der Karte, falls vorhanden */
    kosten?: string;
    /** Zeile "Nachweis:" der Karte, falls vorhanden */
    nachweis?: string;
    /** Zeile "Ausweichregel:" der Karte, falls vorhanden */
    ausweichregel?: string;
    /** Nur bei art === "fluch" */
    gruppe?: Fluchgruppe;
    /**
     * Laufzeit in Minuten je Spielgröße. null bedeutet: Aufgabenfluch, läuft
     * bis die Suchenden "erledigt" melden. Nur bei art === "fluch" gesetzt.
     */
    dauerMin?: { S: number; M: number; L: number } | null;
    /** Nur bei art === "zeitbonus": Minutenwert je Spielgröße */
    bonusMin?: { S: number; M: number; L: number };
    /**
     * Wörtliche Dauer-Angabe, wo sie sich nicht in Minuten ausdrücken lässt
     * ("bis Rundenende", "drei beantwortete Fragen"). Drei Karten tragen sie.
     */
    dauerText?: string;
    /** Wie oft die Karte im Deck liegt */
    anzahl: number;
}

export const KARTEN: Karte[] = [ /* ... */ ];
```

Maya überführt `kartensatz.md` einmalig in diese Datei. Die Karten tragen dort
bereits die Zeilen `Kosten:`, `Nachweis:`, `Ausweichregel:` und `Dauer:` als
eigene Absätze, die Überführung ist also mechanisch. Wo eine Karte
„Einmaliger Effekt, keine Dauer." sagt, wird `dauerMin: null` gesetzt.

**Datenprüfung als Test** (`shared/src/__tests__/karten.test.ts`):

- Summe aller `anzahl` ist 77.
- 28 Karten mit `art: "fluch"`, jede mit `anzahl: 1`.
- Summe der `anzahl` bei `art: "zeitbonus"` ist 49.
- Jede `id` kommt genau einmal vor.
- Jeder Fluch hat `gruppe` gesetzt und `dauerMin` entweder als Zahlentripel oder
  ausdrücklich `null` — `undefined` ist ein Fehler, damit ein vergessenes Feld
  auffällt statt still als Aufgabenfluch durchzugehen.
- Jeder Zeitbonus hat `bonusMin` mit drei Werten größer null.
- Die Deckzeit ergibt 198 / 297 / 495 Minuten — die Zahlen aus dem Anhang
  der Quelle. Das ist die Probe darauf, dass Werte und Stückzahlen
  zusammenpassen.

### 1.1 Übertragungstypen

Ebenfalls in `shared/src/karten.ts`, weil beide Seiten sie brauchen:

```ts
/** Eine Karte, wie sie auf der Hand des Versteckenden liegt */
export interface HandKarte {
    /** deck_cards.id — die Kennung des Exemplars, nicht der Sorte */
    id: string;
    karte: Karte;
}

/** Ein gespielter Fluch, wie ihn beide Rollen sehen */
export interface Fluch {
    id: string;
    karte: Karte;
    playedAt: string;
    /** ISO8601, oder null bei einem Aufgabenfluch */
    expiresAt: string | null;
    endedAt: string | null;
    endedBy: "ablauf" | "suchende" | "versteckender" | null;
}

/** Ein offener Ziehvorgang */
export interface PendingDraw {
    questionId: string;
    angeboten: HandKarte[];
    behalten: number;
}
```

## 2. Datenmodell

Migration 7 in `backend/src/db/migrator.ts` (Muster: neuer Eintrag am Ende des
`MIGRATIONS`-Arrays, `CURRENT_SCHEMA_VERSION` von 6 auf 7).

### 2.1 Spalte an `sessions`

```sql
ALTER TABLE sessions ADD COLUMN cards_enabled INTEGER NOT NULL DEFAULT 0;
```

Vorgabe 0, damit Sitzungen, die zum Zeitpunkt der Migration schon laufen, nicht
plötzlich eine Kartenmechanik bekommen. Neue Sitzungen setzen den Wert bei der
Gründung; der Schalter im Onboarding steht auf „an".

### 2.2 `deck_cards`

```sql
CREATE TABLE deck_cards (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    state TEXT NOT NULL,          -- 'deck' | 'angeboten' | 'hand' | 'ablage' | 'gespielt'
    draw_for_question_id TEXT,    -- gesetzt, solange state = 'angeboten'
    updated_at TEXT NOT NULL
);
CREATE INDEX deck_cards_session_state ON deck_cards(session_id, state);
```

Eine Zeile je Kartenexemplar, nicht je Kartensorte — ein Zeitbonus mit
`anzahl: 22` erzeugt 22 Zeilen mit derselben `card_id`.

`position` ist die Mischreihenfolge. Gezogen wird immer die kleinste `position`
unter den Zeilen mit `state = 'deck'`.

### 2.3 `curses`

```sql
CREATE TABLE curses (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL,
    played_by_participant_id TEXT NOT NULL REFERENCES participants(id),
    played_at TEXT NOT NULL,
    expires_at TEXT,              -- NULL bei Aufgabenflüchen
    ended_at TEXT,
    ended_by TEXT                 -- 'ablauf' | 'suchende' | 'versteckender'
);
CREATE INDEX curses_session ON curses(session_id);
```

## 3. Deckaufbau und Mischen

Das Deck wird **verzögert** angelegt: beim ersten `draw` einer Sitzung, nicht bei
der Gründung. So kostet eine Sitzung ohne Kartenmechanik nichts, und eine
Sitzung, in der nie gezogen wird, auch nicht.

Gemischt wird mit Fisher-Yates über `crypto.randomInt`. Kein Seed, keine
Reproduzierbarkeit — anders als bei `tests/operators.test.ts`, wo ein fester
Seed gebraucht wurde, ist hier echte Zufälligkeit der Zweck.

**Leeres Deck:** Sind beim Ziehen weniger als N Karten mit `state = 'deck'` da,
werden vorher alle Zeilen mit `state = 'ablage'` auf `state = 'deck'` gesetzt und
neu durchnummeriert (gemischt). Ausgespielte Flüche (`state = 'gespielt'`)
bleiben draußen. Reicht es danach immer noch nicht, werden so viele Karten
angeboten, wie da sind — das ist kein Fehler.

## 4. Endpunkte

Alle prüfen zuerst `sessions.cards_enabled`. Ist es 0, antworten sie mit
**409 `{ "error": "cards_disabled" }`**.

Autorisierung wie überall in diesem Backend: Header `x-participant-token` gegen
`participants.token`. Körperprüfung von Hand mit `if (!body.x)`, kein Zod —
das ist das Muster in `backend/src/routes/questions.ts` und wird nicht gebrochen.

### 4.1 `POST /api/questions/:id/draw`

Nur der Versteckende, nur zu einer Frage mit `status = 'answered'`, die er selbst
beantwortet hat.

N kommt aus `src/lib/card-costs.ts` — dieselbe Tabelle muss dem Backend zur
Verfügung stehen. Sie zieht deshalb nach `shared/src/karten.ts` um; das Frontend
importiert sie von dort weiter, `src/lib/card-costs.ts` bleibt als Re-Export
stehen, damit die vorhandenen Aufrufstellen unverändert bleiben.

| Fragentyp | ziehen | behalten |
|---|---|---|
| matching | 3 | 1 |
| measuring | 3 | 1 |
| thermometer | 2 | 1 |
| radius | 2 | 1 |
| tentacles | 4 | 2 |

**Mehrfachaufruf ist unschädlich.** Gibt es zu dieser Frage schon Zeilen mit
`state = 'angeboten'`, liefert der Endpunkt genau diese zurück, ohne neue zu
ziehen. Ein Verbindungsabbruch mitten im Ziehen verschluckt so keine Karten.

Antwort: `{ angeboten: Karte[], behalten: number }`.

Fehler: 403, wenn nicht der Versteckende oder nicht seine Antwort. 409
`already_kept`, wenn zu dieser Frage bereits behalten wurde.

### 4.2 `POST /api/questions/:id/keep`

Körper: `{ behalten: string[], abwerfen?: string[] }` — Listen von
`deck_cards.id`, nicht von `card_id`.

Prüfungen:

- `behalten.length` gleich M aus der Tabelle.
- Jede Kennung in `behalten` gehört zu einer Zeile mit `state = 'angeboten'` und
  `draw_for_question_id = :id`.
- Jede Kennung in `abwerfen` liegt derzeit auf `state = 'hand'`.
- Beide Listen enthalten keine doppelte Kennung. Sonst 400 `duplicate_cards`.
  Der Grund ist nicht Pedanterie: Die Handlimit-Rechnung zählt Listeneinträge,
  das Datenbank-Update trifft aber nur die eindeutigen Zeilen — fünfmal
  dieselbe Karte im Abwurf wären fünf Abwürfe in der Rechnung und einer in
  Wirklichkeit.
- Nach Anwendung liegen höchstens **6** Karten auf `state = 'hand'`. Sonst 409
  `hand_limit` mit `{ ueberzaehlig: n }`, und es wird nichts verändert.

Wirkung: `behalten` → `'hand'`, die übrigen angebotenen → `'ablage'`,
`abwerfen` → `'ablage'`. Alles in einer Transaktion.

Antwort: `{ hand: HandKarte[], deckRest: number }`.

### 4.3 `POST /api/sessions/:code/curses`

Körper: `{ deckCardId: string }`.

Prüfungen: Versteckender; Zeile liegt auf `state = 'hand'`; die zugehörige Karte
hat `art === "fluch"`.

Der Ablaufzeitpunkt kommt aus `dauerMin[session.gameSize]`. Ist `gameSize` nicht
gesetzt, gilt `"M"`. Ist `dauerMin` `null`, bleibt `expires_at` leer.

Wirkung: Zeile auf `state = 'gespielt'`, neue Zeile in `curses`.

Antwort: `{ curse: Fluch }`. Broadcast siehe Abschnitt 5.

### 4.4 `POST /api/curses/:id/end`

Kein Körper. Wer ihn aufruft, bestimmt den Grund: ein Suchender setzt
`ended_by = 'suchende'`, der Versteckende `'versteckender'`. Ein bereits
beendeter Fluch antwortet 409 `already_ended`.

### 4.5 `PATCH /api/sessions/:code/cards`

Körper: `{ cardsEnabled: boolean }`. Nur der Versteckende.

Dieser Endpunkt ist der einzige, der **nicht** mit `cards_disabled` abweist —
er ist ja der Weg zurück. Beim Ausschalten beendet er in derselben Transaktion
alle noch laufenden Flüche mit `ended_by = 'versteckender'`.

Antwort: `{ cardsEnabled: boolean }`. Broadcast `cards_toggled` an alle, und
beim Ausschalten je beendetem Fluch ein `curse_ended`.

## 5. Ereignisse

Neue Einträge in der diskriminierten Union in `shared/src/events.ts`:

```ts
| { type: "curse_played"; curse: Fluch }
| { type: "curse_ended"; curseId: string; endedBy: string; endedAt: string }
| { type: "hand_updated"; hand: HandKarte[]; deckRest: number }
| { type: "cards_toggled"; cardsEnabled: boolean }
```

Versandwege über die vorhandenen Funktionen in `backend/src/ws/manager.ts`:

- `curse_played`, `curse_ended`, `cards_toggled`: `broadcast()` an alle.
- `hand_updated`: **`sendToRole(sessionId, "hider", ...)`**. Die Hand des
  Versteckenden darf einen Suchenden nie erreichen. Dafür gibt es einen Test.

### 5.1 `sync` beim Verbinden

`handleWsOpen()` in `backend/src/ws/handler.ts` schickt heute schon den vollen
Sitzungszustand. Dazu kommt:

- `cardsEnabled: boolean` — immer.
- `activeCurses: Fluch[]` — immer, wenn eingeschaltet.
- `hand: HandKarte[]`, `deckRest: number` — nur beim Versteckenden.
- `pendingDraw: { questionId, angeboten, behalten } | null` — nur beim
  Versteckenden, falls ein Ziehvorgang offen ist.

Ist `cardsEnabled` falsch, fehlen alle Kartenfelder. Der Client zeigt dann
nichts an.

## 6. Ablauf der Zeitflüche

Hier weicht das Design bewusst vom bestehenden Fragen-Ablauf ab. Flo hat
gefunden: Die Ablauf-Timer der Fragen liegen als `setTimeout` im Speicher, werden
beim REST-Pfad gar nicht erst gesetzt und überleben keinen Dienstneustart.

**Der Zustand eines Fluchs wird deshalb gerechnet, nicht gespeichert.** Aktiv
heißt: `ended_at IS NULL AND (expires_at IS NULL OR expires_at > now)`. Jede
Leseoperation wertet das aus. Ein Dienstneustart ändert nichts.

Zusätzlich plant der Server beim Ausspielen eines Zeitfluchs ein `setTimeout`,
das zum Ablaufzeitpunkt `curse_ended` mit `endedBy: 'ablauf'` verteilt und
`ended_at` schreibt. Das ist ein Stups für offene Clients, mehr nicht. Fällt er
aus, rechnet jeder Client den Countdown ohnehin selbst aus dem ISO-Zeitstempel —
genau wie `QuestionCountdown` und `HidingTimerOverlay` es heute tun.

## 7. Frontend

### 7.1 Onboarding-Schalter

`src/components/session/CreateSessionOverlay.tsx` führt durch fünf Schritte:
`entry → gebiet → groesse → code → rolle`. Der Schalter kommt auf den Schritt
**`groesse`**, unter die drei Größenkacheln. Keine sechste Stufe, die
Punktanzeige (`CREATE_STEPS`) bleibt unverändert.

Darstellung: `src/components/ui/switch.tsx` (vorhanden), Beschriftung
„Kartenmechanik" mit einer Zeile darunter, was sie tut. Vorbelegt mit **an**.

Der Wert geht als `cardsEnabled` im Körper von `createSession()` mit —
`CreateSessionRequest` in `shared/src/types.ts` bekommt das Feld.

Neue i18n-Schlüssel in `src/i18n/de.ts` **und** `src/i18n/en.ts`. Die Oberfläche
ist zweisprachig, die Kartentexte nicht.

### 7.2 Store

Neue Datei `src/lib/deck-context.ts` mit einfachen Atomen, keine
`persistentAtom`:

```
cardsEnabled  atom<boolean>
hand          atom<HandKarte[]>
deckRest      atom<number>
pendingDraw   atom<PendingDraw | null>
activeCurses  atom<Fluch[]>
```

Gefüllt aus `sync` und den drei neuen Ereignissen, im `switch` von
`src/hooks/useSessionWebSocket.ts`. Der Server ist die Wahrheit; nach einem
Neuladen ist alles wieder da. `leaveSession()` in `src/lib/session-context.ts`
räumt die neuen Atome mit auf.

### 7.3 Bottom Sheet

`src/components/BottomSheetPanel.tsx` hat heute die Reiter „Fragen" und
„Versteckzonen". Ein dritter kommt dazu, nur wenn `cardsEnabled`:

- Beim Versteckenden **„Hand"** mit der Kartenzahl als Abzeichen.
- Bei den Suchenden **„Flüche"** mit der Zahl der laufenden.

Wie die vorhandenen Reiter bleibt das Panel dauerhaft gemountet und wird nur
per `display` umgeschaltet.

### 7.4 Ziehen

`src/components/session/SessionQuestionPanel.tsx:1194-1240` zeigt heute nach
einer beantworteten Frage das Overlay „Du darfst Karten ziehen! 🃏🃏 › 🃏" —
reine Anzeige. Es wird zum Knopf.

Ein Druck öffnet einen Vollbildschirm nach dem Muster von
`QuestionPickerSheet.tsx`: die N angebotenen Karten untereinander, jede mit Name
und Text, antippen wählt aus. Der Knopf „Behalten" wird scharf, sobald genau M
gewählt sind. Liegt die Hand danach über sechs, zeigt derselbe Schirm die
Handkarten darunter und verlangt die nötigen Abwürfe, bevor er sendet.

Der Schirm ist aus dem Reiter „Hand" wieder erreichbar, solange ein Ziehvorgang
offen ist — `pendingDraw` überlebt ein Neuladen, weil es aus `sync` kommt.

### 7.5 Hand und Ausspielen

Der Reiter „Hand" zeigt die Karten als Liste: Name, Art, bei Zeitboni der
Minutenwert **für die Spielgröße dieser Sitzung**. Darüber die Summe der
Bonusminuten auf der Hand — eine reine Anzeige, es wird nichts verrechnet.

Antippen öffnet die Kartenansicht mit dem vollen Text samt Kosten, Nachweis und
Ausweichregel. Bei einem Fluch steht darunter „Ausspielen" mit Rückfrage
(`alert-dialog.tsx` ist vorhanden). Bei einem Zeitbonus nur „Abwerfen", ebenfalls
mit Rückfrage, weil abgeworfene Zeitboni verfallen.

### 7.6 Bei den Suchenden

Ein eintreffender Fluch erscheint als Vollbild-Overlay nach dem Muster von
`src/components/AnswerOverlay.tsx`, mit Vibration (`navigator.vibrate`) und Ton
(`playSound`) wie heute bei einer neuen Frage. Es zeigt Name und vollen Text.

Danach bleibt der Fluch im Reiter „Flüche" stehen:

- Mit `dauerText`: diese Zeile wörtlich, kein Countdown.
- Mit Dauer: Countdown im Muster von `QuestionCountdown`
  (`SessionQuestionPanel.tsx:1365-1415`), Farbwechsel nach Restzeit.
- Ohne Dauer: die verstrichene Zeit und ein Knopf **„erledigt"**.

Der Versteckende sieht dieselbe Liste in seinem Reiter „Hand", darunter, mit
„Aufheben" statt „erledigt".

### 7.8 Schalter in den Einstellungen

`src/components/settings/GeneralSettings.tsx` reiht Einstellungen als
`SettingsRow` mit einem `Switch` aus `@/components/ui/switch.tsx`. Der
Kartenschalter kommt dort als weitere Zeile dazu, aber **nur** wenn der
Betrachter der Versteckende einer laufenden Sitzung ist. Für Suchende und
außerhalb einer Sitzung erscheint die Zeile gar nicht.

Er unterscheidet sich von seinen Nachbarn: Die übrigen Zeilen schalten ein
lokales `persistentAtom`, dieser schickt einen `PATCH` an den Server und
wartet auf das `cards_toggled`-Ereignis. Bis die Antwort da ist, bleibt er
gesperrt. Schlägt der Aufruf fehl, springt er zurück und zeigt einen Toast.

Beim Ausschalten kommt eine Rückfrage, wenn gerade Flüche laufen: Sie enden
dabei.

### 7.7 Stil

Der Sitzungscode mischt Tailwind-Klassen und Inline-Stile. Die neuen Bauteile
folgen dem **Inline-Stil-Pfad** von `SessionQuestionPanel.tsx`, `BottomSheet.tsx`
und `AnswerOverlay.tsx`, weil sie direkt neben diesen Dateien sitzen, und
benutzen die vorhandenen CSS-Variablen (`--color-primary`, `--color-panel`,
`--radius-pill`).

## 8. Tests

### Backend (`backend/src/test/rest/`, Muster `questions.test.ts` mit `createTestDb()`)

- Ziehzahl je Fragentyp stimmt (fünf Fälle).
- Zweiter `draw`-Aufruf liefert dieselben Karten, zieht keine neuen.
- `keep` mit falscher Anzahl → 400.
- `keep` mit einer Karte, die nicht angeboten war → 400.
- Handlimit: siebte Karte ohne Abwurf → 409 `hand_limit`, Hand unverändert.
- Ein Suchender, der `draw` aufruft → 403.
- `draw` zu einer Frage, die jemand anders beantwortet hat → 403.
- Fluch ausspielen setzt `expires_at` aus `gameSize` (drei Fälle S/M/L).
- Aufgabenfluch hat `expires_at = null`.
- Zeitbonus ausspielen → 400.
- `end` zweimal → beim zweiten Mal 409.
- Leeres Deck: Ablage wird zurückgemischt, gespielte Flüche bleiben draußen.
- Bei `cards_enabled = 0` antworten alle vier Endpunkte 409.

### Backend WebSocket (`backend/src/test/ws/`, Muster `withTestApp()`)

- Nach `curses` empfangen alle Teilnehmer `curse_played`.
- **`hand_updated` erreicht keinen Suchenden.** Der Test verbindet einen Suchenden,
  lässt den Versteckenden ziehen und behalten und prüft, dass beim Suchenden
  binnen der Wartezeit kein `hand_updated` ankommt.
- `sync` enthält beim Suchenden kein `hand`-Feld.
- `sync` enthält beim Versteckenden ein offenes `pendingDraw`.

### Frontend (`src/components/__tests__/`, Muster `draggable-markers.test.tsx`)

`vi.hoisted()`-Attrappen, `vi.mock` auf `@nanostores/react` und die Stores,
`renderToStaticMarkup`, Prüfung per Zählung im Markup, Bauteil erst nach den
Mocks dynamisch importieren.

- Reiter „Hand" erscheint nur beim Versteckenden und nur bei `cardsEnabled`.
- Reiter „Flüche" erscheint nur bei den Suchenden und nur bei `cardsEnabled`.
- Bei `cardsEnabled: false` erscheint keiner von beiden.
- Die Handliste zeigt so viele Einträge wie Karten.
- Ein Fluch mit `expiresAt` rendert einen Countdown, einer ohne den Knopf
  „erledigt".

### Datendatei

`shared/src/__tests__/karten.test.ts`, Prüfungen siehe Abschnitt 1.

## 9. Bekannte Grenzen

**Keine Benachrichtigung bei geschlossener App.** Das Backend hat ein
Expo-Push-Gerüst (`backend/src/lib/push.ts`) und eine Registrierungsroute, aber
im Frontend ruft niemand sie auf. Der Schalter „Benachrichtigungen" in den
Einstellungen ist derzeit ohne Wirkung. Ein Suchender erfährt von einem Fluch
also nur, solange die App im Vordergrund ist. Das ist ein eigenes Vorhaben, das
auch Fragen und Antworten betrifft, und größer als dieses Feature.

**Kartentexte nur deutsch.** Bei englischer Oberfläche bleiben Name und Text der
Karten deutsch. Der Satz ist deutsch geschrieben; übersetzen hieße, ihn neu zu
schreiben.

**Mehrere Sperrflüche gleichzeitig möglich.** Die Papierregel „nur einer darf die
Suchenden am Fragen oder Fahren hindern" prüft die App nicht. Sie zeigt alle
laufenden an; wer sich an die Regel halten will, tut es am Tisch.

**Kein Zeitkonto.** Die Bonusminuten auf der Hand werden angezeigt, aber nicht
auf eine Spieluhr gebucht.
