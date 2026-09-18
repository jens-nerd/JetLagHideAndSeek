# Deploy-Prozess über GitHub für hideandseek und turflock

Stand 18.09.2026. Abgestimmt zwischen Jens und dem Orchestrator, Umsetzung durch Flo.

## Warum

Beide Projekte werden bisher von Hand deployt, ohne festgeschriebenen Ablauf. Was das kostet, hat der 18.09. gezeigt:

- Ein `rsync -a` vom Mac schrieb die lokale uid 502 auf den Server. Der Dienstbenutzer von hideandseek konnte seine SQLite-Datei nicht mehr beschreiben. Multiplayer-Sessions liefen von Ende April bis September in einen Serverfehler, ohne dass es jemandem auffiel.
- Beim Umzug des Backends von pm2 auf systemd blieb `HERE_API_KEY` in der pm2-Konfiguration zurück. Die POI-Suche fiel still auf Overpass zurück. Auch das monatelang unbemerkt.
- Ein Dienst war gleichzeitig in systemd und in pm2 registriert. pm2 fand den Port belegt und startete rund 15 Millionen Mal neu. Ergebnis: eine Logdatei mit 2,9 GB.
- Auf dem Server lag ein Git-Stand vom April, auf GitHub ein anderer. Beide gingen inhaltlich auseinander.

Das verbindende Muster ist nicht Nachlässigkeit, sondern dass es keinen Ort gibt, an dem steht, wie ein Deploy auszusehen hat. Jeder Deploy war eine Erinnerungsleistung.

## Entscheidungen

| Frage | Entscheidung |
|---|---|
| Auslöser | Push auf den Hauptbranch geht live, wenn die Prüfungen grün sind |
| Build-Ort | Auf dem Server, aus dem Git-Stand |
| Mechanismus | Deploy-Skript im Repo, von GitHub Actions per SSH gestartet |
| Migrationen | Automatisch, mit Sicherung der Datenbank davor |
| turflock | Wird beim Umbau mit aufgeräumt: Git-Klon, eigener Dienstbenutzer, systemd |

**Die Hauptbranches heißen unterschiedlich:** `JetLagHideAndSeek` nutzt `master`, `turflock` nutzt `main`. Jeder Workflow und jedes Skript bezieht sich auf den Branch seines eigenen Repos; ein blindes Übertragen der Konfiguration von einem aufs andere geht schief.

## Architektur

```
Push auf den Hauptbranch
  │
  ├─ Job "pruefen"  (GitHub Actions)
  │    pnpm install --frozen-lockfile
  │    lint, typecheck, Tests, Probebau
  │    scheitert etwas → Ende, der Server merkt nichts
  │
  └─ Job "deployen" (nur wenn "pruefen" grün)
       ssh deploy@91.98.85.53
         → erzwungenes Kommando startet /opt/<projekt>/scripts/deploy.sh
```

Der Probebau in Actions baut, was der Server gleich noch einmal baut. Das ist Absicht: Ein kaputter Stand soll die Produktionsmaschine nicht erreichen. Ein gescheiterter Build in Actions hinterlässt nichts, ein gescheiterter Build auf dem Server einen halben Zustand.

**In `JetLagHideAndSeek` gibt es diesen Job bereits:** `.github/workflows/test.yml` fährt Backend- und Frontend-Tests bei jedem Push auf `master` und bei jedem Pull Request, und er ist grün. Er wird nicht neu gebaut, sondern der Deploy-Job hängt sich an ihn.

Ebenfalls vorhanden und **zu entfernen**: `.github/workflows/deploy.yml` deployt nach GitHub Pages, ein Überbleibsel des Ursprungsprojekts. Er scheitert bei jedem Push und hat mit dem VPS nichts zu tun.

Bei hideandseek umfasst "Tests" die vorhandene vitest-Suite. turflock hat keine eigenen Tests; dort greifen vorerst nur Lint, Typecheck und Probebau. Das ist ein bewusster Unterschied, keine Lücke, die vor dem Deploy-Umbau geschlossen werden muss.

## Zugang und Absicherung

Pro Projekt ein eigenes ed25519-Schlüsselpaar, ausschließlich für Deploys:

- Privater Teil als GitHub-Secret im jeweiligen Repo.
- Öffentlicher Teil in `~deploy/.ssh/authorized_keys` mit erzwungenem Kommando:

```
command="/opt/hideandseek/scripts/deploy.sh",no-pty,no-agent-forwarding,
no-port-forwarding,no-X11-forwarding ssh-ed25519 AAAA…
```

Wer den Schlüssel besitzt, bekommt keine Shell, sondern nur dieses eine Skript. Getrennte Schlüssel bedeuten, dass der turflock-Schlüssel hideandseek nicht anfassen kann.

In Actions wird der Host-Key über `known_hosts` festgenagelt, damit die Verbindung nicht blind vertraut.

Für den privaten turflock-Klon braucht der Server zusätzlich einen **lesenden** Deploy-Key bei GitHub. Der ist von dem Schlüssel getrennt, mit dem Actions hereinkommt, und darf nur lesen.

### Was damit bewusst in Kauf genommen wird

Das Deploy-Skript kommt aus dem Repo und läuft nach dem Pull. Schreibzugriff auf den Hauptbranch bedeutet damit Codeausführung auf dem VPS. Das gilt für jedes Deploy-aus-dem-Repo, ist aber ein Unterschied zum heutigen Zustand. Zwei Folgerungen: der Hauptbranch bleibt geschützt, und der Deploy-Schlüssel gehört zu den Dingen, die man rotiert, wenn ein Gerät abhandenkommt.

Zweite Eigenheit, die sonst Verwirrung stiftet: Eine Änderung an `deploy.sh` wirkt erst beim nächsten Deploy. Beim aktuellen läuft noch die Fassung, die vor dem Pull auf der Platte lag.

## Das Deploy-Skript

Ein Skript pro Projekt, im jeweiligen Repo unter `scripts/deploy.sh`. `set -euo pipefail`, Ablauf protokolliert.

```
 1  Sperre setzen (flock)          zwei gleichzeitige Deploys wären Chaos
 2  Platz prüfen                   unter 2 GB frei → Abbruch, bevor etwas anfängt
 3  git fetch && git reset --hard origin/<hauptbranch>
 4  pnpm install --frozen-lockfile
 5  Bauen → Staging-Verzeichnis innerhalb des Projekts
 6  Bau prüfen (erwartete Dateien vorhanden?)
────────────── ab hier wird Laufendes angefasst ──────────────
 7  Datenbank sichern (sqlite3 .backup, atomar, mit Zeitstempel)
 8  Migrationen fahren
 9  Webroot sichern, dann intern tauschen (rsync)
10  Dienst neu starten
11  Gesundheitsprüfung
12  Alte Sicherungen ausdünnen (die letzten fünf behalten)
```

Die Linie vor Schritt 7 ist die wichtigste Eigenschaft des Skripts. Alles davor ist folgenlos für den laufenden Betrieb.

### Fallen, die im Skript berücksichtigt sein müssen

Alle vier sind am 18.09. aufgelaufen und stehen hier, damit sie nicht neu entdeckt werden:

- **`pnpm rebuild better-sqlite3` nach jedem Install.** Die Build-Script-Allowlist von pnpm kompiliert die native Bindung bei `pnpm install` nicht mit. Ohne den expliziten Rebuild startet das Backend nicht. Der vorhandene `test.yml` macht es bereits so und nennt den Grund im Kommentar.
- **Kein `git clean -fd`.** Untracked liegen dort Uploads, Backups und die `.env` mit Produktionswerten. Ein `git reset --hard` allein lässt sie in Ruhe.
- **Das Build-Verzeichnis muss innerhalb des Projektverzeichnisses liegen.** Liegt `--outDir` außerhalb, legt das PWA-Plugin `sw.js` nach `.astro/` und die Precache-Liste fällt von 28 Einträgen auf 1. Ohne Fehlermeldung.
- **Der rsync ins Webroot läuft serverintern**, nie vom Mac. Sonst entsteht die uid-502-Falle neu.
- **Geheimnisse liegen außerhalb des Projektverzeichnisses** und werden vom Skript nicht angefasst.

### Fehlerbehandlung und Rückweg

Scheitert ein Schritt vor 7, bricht das Skript ab und meldet. Der laufende Betrieb ist unberührt.

Ab Schritt 7 gilt:

- **Migration gescheitert** → Datenbank aus der Sicherung zurückspielen, Code nicht tauschen, melden. Das Schema ist in diesem Fall ohnehin kaputt, die Sicherung ist der bessere Zustand.
- **Neustart oder Gesundheitsprüfung gescheitert, Migration war erfolgreich** → nur der Code wird zurückgerollt. Die Datenbank bleibt auf dem neuen Schema, und das Skript sagt das ausdrücklich. Ein automatisches Zurückspielen würde alles verwerfen, was seit Schritt 7 geschrieben wurde; bei einer laufenden Multiplayer-Session ist das nicht egal. Was dann passiert, entscheidet Jens.

Der Code-Rückweg ist ein rsync aus der vorigen `dist/` plus Neustart.

### Gesundheitsprüfung

Drei Bedingungen, alle müssen erfüllt sein: `systemctl is-active` meldet `active`, `/health` auf dem lokalen Port antwortet, und die öffentliche URL liefert HTTP 200.

Konkret je Projekt:

| | hideandseek | turflock |
|---|---|---|
| Öffentlich | hideandseek.vielhaben.com | turflock.vielhaben.com |
| Backend-Port | 3001 | 3002 |
| Webroot | `/opt/hideandseek/dist` | `/opt/turflock/dist` |
| Dienst | `hideandseek-backend.service` | neu anzulegen |

Ob turflocks Backend einen `/health`-Endpunkt hat, ist noch zu prüfen. Fehlt er, tritt für turflock zunächst die öffentliche URL an seine Stelle, und der Endpunkt wird nachgereicht.

## Geheimnisse und Umgebungsvariablen

Vorbild ist der am 18.09. eingerichtete Zustand bei hideandseek:

- Datei `/etc/<projekt>-backend.env`, `600 root:root`, eingebunden über `EnvironmentFile=` in der systemd-Unit.
- Bewusst außerhalb des Projektverzeichnisses: kein Deploy, kein `git reset --hard`, kein `git clean`, kein `rsync --delete` fasst sie an.
- Nicht als `Environment=` in die Unit, weil `systemctl cat` den Wert dann für jeden ausgibt.
- Rotieren heißt: eine Datei ändern plus `systemctl restart`.

**Vor dem ersten automatischen Deploy** ist für beide Projekte zu prüfen, welche `process.env`-Zugriffe der Code macht und ob jeder davon gesetzt ist. Bei hideandseek ist das geschehen; `UPLOADS_DIR` ist dort die eine bekannte Lücke und wird separat behandelt. Bei turflock steht diese Prüfung noch aus.

## turflock-Umbau

Der Umbau geschieht **nicht in `/opt/turflock` selbst**, sondern frisch daneben: neu klonen, Daten herüberholen, umschalten, den alten Stand als Rückweg liegenlassen. Ein `git init` im gewachsenen Verzeichnis führt zu Überraschungen.

Was sich ändert:

- `/opt/turflock` wird ein Git-Klon von `jens-nerd/turflock`.
- Eigener Dienstbenutzer `turflock` statt root.
- systemd-Unit statt pm2, nach dem Muster von `hideandseek-backend.service` inklusive der Härtungsoptionen.
- **turflock wird aus pm2 abgemeldet.** Doppelte Führung durch systemd und pm2 gleichzeitig hat bei hideandseek die Absturzschleife erzeugt.
- Geheimnisse nach `/etc/turflock-backend.env`.
- Eigentümerschaft der Dateien korrigieren; heute tragen sie 502:staff.

Der heikelste Teil ist der Wechsel von root auf einen unprivilegierten Benutzer. Datenbank und alle beschreibbaren Verzeichnisse müssen gefunden, in ihrer Eigentümerschaft korrigiert und in `ReadWritePaths` eingetragen werden. Wird eines übersehen, fällt es lautlos aus, bis jemand die betroffene Funktion benutzt.

Nach dem Umbau führt pm2 nur noch `pm2-logrotate`. Ob pm2 dann ganz verschwindet, ist eine spätere Entscheidung und nicht Teil dieser Arbeit.

## Einführungsreihenfolge

1. **hideandseek zuerst.** Dort stimmen die Grundlagen: Git-Klon auf dem Server, systemd, eigener Dienstbenutzer, Geheimnisse am richtigen Ort.
2. **Skript von Hand erproben**, mehrfach, bevor Actions einen Schlüssel bekommt.
3. **Actions anhängen**, erster automatischer Deploy unter Aufsicht.
4. **turflock umbauen**, dann ein manueller, beaufsichtigter Deploy.
5. **turflock-Pipeline anhängen.**

Die Schritte 1 bis 3 und die Schritte 4 bis 5 werden getrennt geplant und umgesetzt. Der turflock-Teil hängt an Erkenntnissen aus dem hideandseek-Teil und lässt sich vorher nicht sinnvoll durchplanen.

Schritt 4 verdient besondere Vorsicht: Auf dem Server liegt turflock vom 17. März, lokal steht `main` ein halbes Jahr weiter. Der erste Deploy liefert all das auf einmal aus. Das gehört von Hand gemacht, mit Sicherung und mit Blick darauf, und ausdrücklich **nicht** als erster Lauf einer frisch gebauten Automatik.

## Erprobung

Der glückliche Fall beweist wenig. Nachzuweisen sind:

- Ein absichtlich kaputter Build erreicht die Produktion nicht.
- Eine scheiternde Gesundheitsprüfung löst den Code-Rückweg aus, und die Seite ist danach wieder auf dem vorigen Stand.
- Eine scheiternde Migration spielt die Datenbank zurück und tauscht den Code nicht.
- Zwei gleichzeitig angestoßene Deploys behindern sich nicht.

Ein Deploy-Mechanismus, dessen Fehlerfall nie ausgelöst wurde, ist ungetestet. Der Fehlerfall ist der einzige Moment, in dem er zählt.

## Ausdrücklich nicht dabei

Docker, eine Staging-Umgebung, Zero-Downtime-Deploys. Ein Neustart von wenigen Sekunden ist für beide Projekte in Ordnung. Auch nicht dabei: Tests für turflock zu schreiben, die Upload-Verzeichnisse zusammenzuführen, die Datenbank nach `/var/lib/` zu verlegen. Das sind eigene Aufgaben.

## Voraussetzungen, die Jens beisteuern muss

- Die nicht committete Änderung an `src/components/ClaimButton.tsx` im turflock-Klon: committen oder verwerfen. Sobald der Hauptbranch die Wahrheit ist, muss klar sein, was dazugehört.
- Entscheidung, ob der jeweilige Hauptbranch in beiden Repos als geschützter Branch eingerichtet wird.
- Ein Blick auf die turflock-Änderungen seit März, bevor Schritt 4 läuft.

## Erfolgskriterien

1. Ein Push auf `master` in `JetLagHideAndSeek` führt ohne weiteres Zutun zu einem aktualisierten hideandseek.vielhaben.com, und die Gesundheitsprüfung belegt es.
2. Dasselbe für turflock.
3. Ein absichtlich herbeigeführter Fehler in jeder der vier Erprobungssituationen führt zum beschriebenen Verhalten, belegt durch die Ausgabe.
4. turflock läuft unter einem eigenen Dienstbenutzer, nicht mehr als root, und ist in pm2 nicht mehr registriert.
5. `scripts/deploy.sh` lässt sich von Hand ausführen und tut dabei dasselbe wie über Actions.
