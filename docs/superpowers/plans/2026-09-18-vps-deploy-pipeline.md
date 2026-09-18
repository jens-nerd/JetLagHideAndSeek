# VPS-Deploy-Pipeline für hideandseek — Umsetzungsplan

> **Für agentische Bearbeiter:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development` (empfohlen) oder `superpowers:executing-plans`, um diesen Plan Aufgabe für Aufgabe umzusetzen. Die Schritte nutzen Checkbox-Syntax (`- [ ]`) zur Nachverfolgung.

**Ziel:** Ein Push auf `master` rollt hideandseek ohne weiteres Zutun auf den VPS aus, mit Sicherung, Gesundheitsprüfung und automatischem Rückweg.

**Architektur:** GitHub Actions prüft (Tests, Build) und startet bei Erfolg per SSH ein versioniertes Skript `scripts/deploy.sh` auf dem Server. Das Skript zieht den Git-Stand, baut dort, tauscht das Webroot und startet den Dienst neu. Der SSH-Schlüssel darf ausschließlich dieses eine Skript starten, keine Shell.

**Tech-Stack:** Bash, GitHub Actions, systemd, nginx, pnpm 10, Node 20, Astro, Hono, better-sqlite3 + Drizzle, SQLite.

**Spec:** `docs/superpowers/specs/2026-09-18-vps-deploy-prozess-design.md`

## Globale Randbedingungen

- **Hauptbranch dieses Repos ist `master`**, nicht `main`. (Das Schwesterprojekt turflock nutzt `main` — Konfiguration nicht blind übertragen.)
- **Node 20**, `engines` erlaubt `<25`. **pnpm 10.**
- **Nach jedem `pnpm install` muss `pnpm rebuild better-sqlite3` laufen.** Die Build-Script-Allowlist von pnpm kompiliert die native Bindung sonst nicht, und das Backend startet nicht.
- **Das Astro-Ausgabeverzeichnis muss innerhalb von `/opt/hideandseek/` liegen.** Liegt `--outDir` außerhalb des Projekts, legt das PWA-Plugin `sw.js` nach `.astro/` und die Precache-Liste fällt von 28 Einträgen auf 1 — ohne Fehlermeldung.
- **Niemals `git clean -fd` auf dem Server.** Untracked liegen dort `uploads/`, `backups/` und die `.env` mit Produktionswerten.
- **Geheimnisse liegen in `/etc/hideandseek-backend.env`** (`600 root:root`, eingebunden per `EnvironmentFile=`). Das Deploy-Skript fasst sie nicht an.
- **Server:** `91.98.85.53`, Benutzer `deploy` (passwortloses sudo), Projekt `/opt/hideandseek`, Webroot `/opt/hideandseek/dist`, Dienst `hideandseek-backend.service`, Backend-Port `3001`, öffentlich `https://hideandseek.vielhaben.com`.
- **Serverseitige Schreibbefehle sind dem umsetzenden Agenten gesperrt** (`[Remote Shell Writes]`, `[Production Deploy]`). Jede Aufgabe, die auf dem Server schreibt, endet mit einer kopierfertigen Befehlsfolge für Jens. Nichts umgehen, nichts behaupten, was nicht selbst ausgeführt wurde.
- Commit-Nachrichten auf Deutsch, Abschlusszeile `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Toten GitHub-Pages-Workflow entfernen

`.github/workflows/deploy.yml` deployt nach GitHub Pages — ein Überbleibsel des Ursprungsprojekts `taibeled/JetLagHideAndSeek`. Er scheitert bei jedem Push und verrauscht die Lauf-Übersicht, in der wir gleich den echten Deploy sehen wollen.

**Dateien:**
- Löschen: `.github/workflows/deploy.yml`

**Interfaces:**
- Konsumiert: nichts
- Produziert: eine Actions-Übersicht, in der nur noch `Tests` läuft

- [ ] **Schritt 1: Belegen, dass er scheitert und nichts Nützliches tut**

```bash
cd ~/hideandseek
gh run list --workflow=deploy.yml --limit 5
```

Erwartet: mehrere `failure`-Zeilen. Zusätzlich prüfen, dass GitHub Pages für das Repo nicht als Auslieferungsweg genutzt wird:

```bash
gh api repos/jens-nerd/JetLagHideAndSeek/pages 2>&1 | head -3
```

Erwartet: `Not Found` — oder, falls doch eine Pages-Seite existiert, **hier anhalten und Jens fragen**, statt sie abzuschalten.

- [ ] **Schritt 2: Löschen**

```bash
git rm .github/workflows/deploy.yml
```

- [ ] **Schritt 3: Committen und pushen**

```bash
git commit -m "chore(ci): GitHub-Pages-Workflow entfernen

Er stammt aus dem Ursprungsprojekt, deployt auf einen Weg, den wir nicht
nutzen, und scheitert seit Monaten bei jedem Push. Die Auslieferung läuft
über den VPS.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push origin master
```

- [ ] **Schritt 4: Nachweisen**

```bash
sleep 20 && gh run list --limit 3
```

Erwartet: nur noch `Tests` für den neuesten Commit, kein `Deploy to GitHub Pages`.

---

### Task 2: `deploy.sh` — die folgenlose Phase

Alles bis einschließlich Bauprüfung. Nach dieser Aufgabe existiert ein Skript, das man gefahrlos laufen lassen kann: Es fasst den laufenden Betrieb nicht an.

**Dateien:**
- Anlegen: `scripts/deploy.sh`

**Interfaces:**
- Konsumiert: nichts
- Produziert: `scripts/deploy.sh` mit den Umgebungsschaltern `MIN_FREE_MB` (Vorgabe 2048), `DEPLOY_STOP_AFTER` (Vorgabe leer; Wert `bau` beendet nach der Bauprüfung) und `DEPLOY_SKIP_RESET` (Vorgabe leer; Wert `1` überspringt fetch/reset, nur für die Erprobung in Task 4). Ausserdem die Variablen `PROJEKT`, `BRANCH`, `STAGING`, `SICHERUNGEN`, `DIENST`, `COMMIT` und die Funktionen `log()` und `fehler()`. Spätere Aufgaben erweitern dieselbe Datei und behalten diese Schalter bei.

- [ ] **Schritt 1: Skript anlegen**

```bash
#!/usr/bin/env bash
# Deploy von hideandseek auf den VPS.
# Wird von GitHub Actions über ein erzwungenes SSH-Kommando gestartet
# und laesst sich jederzeit von Hand ausfuehren:
#   sudo /opt/hideandseek/scripts/deploy.sh
set -euo pipefail

PROJEKT=/opt/hideandseek
BRANCH=master
STAGING="$PROJEKT/build-deploy"
SICHERUNGEN="$PROJEKT/backups"
DIENST=hideandseek-backend
MIN_FREE_MB="${MIN_FREE_MB:-2048}"
DEPLOY_STOP_AFTER="${DEPLOY_STOP_AFTER:-}"

# Ohne root geht hier nichts: git in /opt, rsync ins Webroot, systemctl.
# --preserve-env ist noetig, weil sudo die Umgebung sonst ausraeumt und alle
# Erprobungsschalter still verschwinden wuerden.
[ "$(id -u)" -eq 0 ] || exec sudo -n \
    --preserve-env=MIN_FREE_MB,DEPLOY_STOP_AFTER,DEPLOY_SKIP_RESET,HEALTH_URL \
    "$0" "$@"

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
fehler() { printf '[%s] FEHLER: %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; exit 1; }

# ── 1. Sperre ──────────────────────────────────────────────────────────
exec 9>/var/lock/hideandseek-deploy.lock
flock -n 9 || fehler "Ein Deploy laeuft bereits. Abbruch."
log "Sperre gesetzt."

# ── 2. Platz pruefen ───────────────────────────────────────────────────
FREI_MB=$(df --output=avail -m / | tail -1 | tr -d ' ')
log "Frei auf /: ${FREI_MB} MB (Mindestwert ${MIN_FREE_MB} MB)"
[ "$FREI_MB" -ge "$MIN_FREE_MB" ] \
    || fehler "Zu wenig Platz: ${FREI_MB} MB frei, ${MIN_FREE_MB} MB verlangt."

# ── 3. Stand ziehen ────────────────────────────────────────────────────
# Bewusst KEIN git clean -fd: untracked liegen uploads/, backups/ und .env.
# DEPLOY_SKIP_RESET dient ausschliesslich der Erprobung (Task 4): damit laesst
# sich ein absichtlich manipulierter Arbeitsbaum testen, ohne dass der Reset
# ihn sofort wieder geradezieht.
if [ "${DEPLOY_SKIP_RESET:-}" = "1" ]; then
    log "DEPLOY_SKIP_RESET=1 - Stand wird nicht gezogen (nur fuer Erprobung)."
else
    log "Hole origin/$BRANCH ..."
    git -C "$PROJEKT" fetch origin "$BRANCH"
    git -C "$PROJEKT" reset --hard "origin/$BRANCH"
fi
COMMIT=$(git -C "$PROJEKT" rev-parse --short HEAD)
log "Stand: $COMMIT $(git -C "$PROJEKT" log -1 --pretty=%s)"

# ── 4. Abhaengigkeiten ─────────────────────────────────────────────────
log "pnpm install ..."
( cd "$PROJEKT" && pnpm install --frozen-lockfile )
# pnpm kompiliert die native Bindung wegen der Build-Script-Allowlist nicht
# mit. Ohne diesen Rebuild startet das Backend nicht.
( cd "$PROJEKT" && pnpm rebuild better-sqlite3 )

# ── 5. Bauen ───────────────────────────────────────────────────────────
# Das Ausgabeverzeichnis MUSS innerhalb des Projekts liegen, sonst legt das
# PWA-Plugin sw.js an die falsche Stelle und die Precache-Liste bricht ein.
rm -rf "$STAGING"
log "Frontend bauen -> $STAGING"
( cd "$PROJEKT" && pnpm exec astro build --outDir "$STAGING" )
log "Backend bauen ..."
( cd "$PROJEKT" && pnpm backend:build )

# ── 6. Bau pruefen ─────────────────────────────────────────────────────
[ -f "$STAGING/index.html" ] || fehler "index.html fehlt im Bau."
[ -f "$STAGING/sw.js" ]      || fehler "sw.js fehlt im Bau."
[ -f "$PROJEKT/backend/dist/index.js" ] || fehler "Backend-Bau fehlt."
PRECACHE=$(grep -o 'revision:' "$STAGING/sw.js" | wc -l)
[ "$PRECACHE" -ge 20 ] \
    || fehler "sw.js hat nur $PRECACHE Precache-Eintraege - Bau ist kaputt."
log "Bau geprueft: $PRECACHE Precache-Eintraege."

if [ "$DEPLOY_STOP_AFTER" = "bau" ]; then
    log "DEPLOY_STOP_AFTER=bau gesetzt - hier ist Schluss. Live unveraendert."
    exit 0
fi

log "Bis hier folgenlos. Ausrollen folgt."
```

- [ ] **Schritt 2: Ausführbar machen und committen**

```bash
cd ~/hideandseek
chmod +x scripts/deploy.sh
git add scripts/deploy.sh
git commit -m "feat(deploy): Deploy-Skript, folgenlose Phase

Sperre, Platzpruefung, Stand ziehen, bauen, Bau pruefen. Faellt der Bau
durch, bleibt der laufende Betrieb unberuehrt.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push origin master
```

- [ ] **Schritt 3: Jens lässt es auf dem Server laufen — Normalfall**

```bash
ssh deploy@91.98.85.53 'sudo git -C /opt/hideandseek fetch origin master && sudo git -C /opt/hideandseek reset --hard origin/master && sudo DEPLOY_STOP_AFTER=bau /opt/hideandseek/scripts/deploy.sh'
```

Erwartet: läuft bis „DEPLOY_STOP_AFTER=bau gesetzt", Exitcode 0, mindestens 20 Precache-Einträge.

- [ ] **Schritt 4: Nachweisen, dass Live unberührt ist**

```bash
ssh deploy@91.98.85.53 'curl -s -o /dev/null -w "HTTP %{http_code}\n" https://hideandseek.vielhaben.com/; sudo ls -ld /opt/hideandseek/dist /opt/hideandseek/build-deploy'
```

Erwartet: HTTP 200, und `dist` trägt einen älteren Zeitstempel als `build-deploy`.

- [ ] **Schritt 5: Platzprüfung auslösen**

```bash
ssh deploy@91.98.85.53 'sudo MIN_FREE_MB=999999 /opt/hideandseek/scripts/deploy.sh; echo "Exitcode: $?"'
```

Erwartet: `FEHLER: Zu wenig Platz`, Exitcode 1, und nichts wurde gebaut.

- [ ] **Schritt 6: Sperre auslösen**

```bash
ssh deploy@91.98.85.53 'sudo DEPLOY_STOP_AFTER=bau /opt/hideandseek/scripts/deploy.sh > /tmp/a.log 2>&1 & sleep 2; sudo DEPLOY_STOP_AFTER=bau /opt/hideandseek/scripts/deploy.sh; echo "Exitcode zweiter Lauf: $?"; wait'
```

Erwartet: Der zweite Lauf meldet „Ein Deploy laeuft bereits" und endet mit 1.

---

### Task 3: `deploy.sh` — die Ausrollphase

Ab hier wird Laufendes angefasst. Sicherungen zuerst, dann Migration, dann Tausch, dann Neustart, dann Gesundheitsprüfung.

**Dateien:**
- Ändern: `scripts/deploy.sh` (ersetzt die Zeile `log "Bis hier folgenlos. Ausrollen folgt."`)

**Interfaces:**
- Konsumiert: aus Task 2 die Variablen `PROJEKT`, `STAGING`, `SICHERUNGEN`, `DIENST`, `COMMIT` sowie `log()` und `fehler()`
- Produziert: die Variablen `STEMPEL` (Format `%Y%m%d-%H%M%S`), `DB` (Pfad der Produktionsdatenbank), `DB_SICHERUNG` (Pfad der DB-Kopie), `DIST_SICHERUNG` (Pfad der Webroot-Kopie), den Umgebungsschalter `HEALTH_URL` (Vorgabe `https://hideandseek.vielhaben.com/`) und die Funktion `gesundheit()`, die 0 oder 1 zurückgibt. Task 4 baut auf all dem auf.

- [ ] **Schritt 1: Ausrollphase anfügen**

```bash
# ═══ ab hier wird Laufendes angefasst ══════════════════════════════════
STEMPEL=$(date -u +%Y%m%d-%H%M%S)
DB="$PROJEKT/backend/hideandseek.db"
DB_SICHERUNG="$SICHERUNGEN/db-$STEMPEL.sqlite"
DIST_SICHERUNG="$SICHERUNGEN/dist-$STEMPEL"
mkdir -p "$SICHERUNGEN"

gesundheit() {
    systemctl is-active --quiet "$DIENST" || { log "Dienst nicht aktiv."; return 1; }
    curl -fsS -m 10 http://127.0.0.1:3001/health >/dev/null \
        || { log "/health antwortet nicht."; return 1; }
    local code
    code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' \
           "${HEALTH_URL:-https://hideandseek.vielhaben.com/}")
    [ "$code" = "200" ] || { log "Oeffentliche URL liefert $code."; return 1; }
    return 0
}

# ── 7. Datenbank sichern ───────────────────────────────────────────────
# .backup statt cp: atomar, nimmt den WAL-Stand mit.
log "Datenbank sichern -> $DB_SICHERUNG"
sqlite3 "file:$DB?mode=ro" ".backup '$DB_SICHERUNG'"
sqlite3 "$DB_SICHERUNG" "pragma integrity_check;" | grep -qx ok \
    || fehler "Sicherung der Datenbank ist nicht lesbar. Abbruch vor der Migration."

# ── 8. Migrationen ─────────────────────────────────────────────────────
log "Migrationen fahren ..."
( cd "$PROJEKT" && pnpm backend:migrate )

# ── 9. Webroot sichern, dann tauschen ──────────────────────────────────
log "Webroot sichern -> $DIST_SICHERUNG"
cp -a "$PROJEKT/dist" "$DIST_SICHERUNG"
log "Webroot tauschen ..."
rsync -a --delete "$STAGING/" "$PROJEKT/dist/"
chmod -R 755 "$PROJEKT/dist"

# ── 10. Dienst neu starten ─────────────────────────────────────────────
log "Dienst neu starten ..."
systemctl restart "$DIENST"
sleep 3

# ── 11. Gesundheitspruefung ────────────────────────────────────────────
if gesundheit; then
    log "Gesundheitspruefung bestanden. Deploy $COMMIT ist live."
else
    fehler "Gesundheitspruefung gescheitert."
fi
```

- [ ] **Schritt 2: Committen und pushen**

```bash
cd ~/hideandseek
git add scripts/deploy.sh
git commit -m "feat(deploy): Ausrollphase mit Sicherung, Migration und Gesundheitspruefung

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push origin master
```

- [ ] **Schritt 3: Jens fährt einen echten Deploy**

```bash
ssh deploy@91.98.85.53 'sudo git -C /opt/hideandseek fetch origin master && sudo git -C /opt/hideandseek reset --hard origin/master && sudo /opt/hideandseek/scripts/deploy.sh'
```

Erwartet: Läuft durch bis „Deploy <sha> ist live.", Exitcode 0.

- [ ] **Schritt 4: Nachweisen**

```bash
ssh deploy@91.98.85.53 'systemctl is-active hideandseek-backend; curl -s http://127.0.0.1:3001/health; sudo ls -1 /opt/hideandseek/backups | tail -4'
curl -s -o /dev/null -w "oeffentlich: HTTP %{http_code}\n" https://hideandseek.vielhaben.com/
```

Erwartet: `active`, `{"ok":true}`, eine `db-*.sqlite` und ein `dist-*` mit heutigem Zeitstempel, HTTP 200.

---

### Task 4: `deploy.sh` — Fehlerbehandlung und Rückweg

Bis hier bricht das Skript bei einem Fehler zwar ab, lässt aber einen halb getauschten Zustand zurück. Das ändert diese Aufgabe.

**Dateien:**
- Ändern: `scripts/deploy.sh`

**Interfaces:**
- Konsumiert: `DB`, `DB_SICHERUNG`, `DIST_SICHERUNG`, `HEALTH_URL`, `gesundheit()`, `log()`, `fehler()` aus Task 3
- Produziert: die Funktionen `rueckweg_code()` und `rueckweg_db()`; keine spätere Aufgabe baut darauf auf

- [ ] **Schritt 1: Rückweg-Funktionen direkt nach der Definition von `gesundheit()` einfügen**

```bash
rueckweg_code() {
    log "RUECKWEG: vorigen Webroot zurueckspielen ..."
    rsync -a --delete "$DIST_SICHERUNG/" "$PROJEKT/dist/"
    chmod -R 755 "$PROJEKT/dist"
    systemctl restart "$DIENST"
    sleep 3
    if gesundheit; then
        log "RUECKWEG erfolgreich. Voriger Stand ist wieder live."
    else
        log "RUECKWEG gescheitert - die Seite ist NICHT gesund. Handbetrieb noetig."
    fi
}

rueckweg_db() {
    log "RUECKWEG: Datenbank aus $DB_SICHERUNG zurueckspielen ..."
    systemctl stop "$DIENST"
    cp -a "$DB_SICHERUNG" "$DB"
    chown hideandseek:hideandseek "$DB"
    rm -f "$DB-wal" "$DB-shm"
    systemctl start "$DIENST"
    log "Datenbank zurueckgespielt."
}
```

- [ ] **Schritt 2: Migrationsschritt absichern** — Schritt 8 aus Task 3 ersetzen durch:

```bash
# ── 8. Migrationen ─────────────────────────────────────────────────────
# Scheitert die Migration, ist das Schema ohnehin kaputt: Datenbank zurueck,
# Code gar nicht erst tauschen.
log "Migrationen fahren ..."
if ! ( cd "$PROJEKT" && pnpm backend:migrate ); then
    rueckweg_db
    fehler "Migration gescheitert. Datenbank zurueckgespielt, Code NICHT getauscht."
fi
```

- [ ] **Schritt 3: Gesundheitsprüfung absichern** — Schritt 11 aus Task 3 ersetzen durch:

```bash
# ── 11. Gesundheitspruefung ────────────────────────────────────────────
# Nur der Code wird zurueckgerollt. Die Datenbank steht auf dem neuen
# Schema und bleibt dort: ein automatisches Zurueckspielen wuerde alles
# verwerfen, was seit Schritt 7 geschrieben wurde.
if gesundheit; then
    log "Gesundheitspruefung bestanden. Deploy $COMMIT ist live."
else
    log "Gesundheitspruefung gescheitert."
    rueckweg_code
    log "ACHTUNG: Die Datenbank steht auf dem NEUEN Schema ($DB_SICHERUNG ist die Sicherung davor)."
    exit 1
fi
```

- [ ] **Schritt 4: Committen und pushen**

```bash
cd ~/hideandseek
git add scripts/deploy.sh
git commit -m "feat(deploy): Rueckweg fuer Code und Datenbank

Scheitert die Migration, wird die Datenbank zurueckgespielt und der Code
gar nicht getauscht. Scheitert die Gesundheitspruefung danach, rollt nur
der Code zurueck - die Datenbank bleibt auf dem neuen Schema, weil ein
automatisches Zurueckspielen laufende Sessions verwerfen wuerde.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push origin master
```

- [ ] **Schritt 5: Jens löst den Rückweg absichtlich aus**

```bash
ssh deploy@91.98.85.53 'sudo git -C /opt/hideandseek fetch origin master && sudo git -C /opt/hideandseek reset --hard origin/master && sudo HEALTH_URL=https://hideandseek.vielhaben.com/gibt-es-nicht /opt/hideandseek/scripts/deploy.sh; echo "Exitcode: $?"'
```

Erwartet: „Oeffentliche URL liefert 404", dann „RUECKWEG: vorigen Webroot zurueckspielen", dann „RUECKWEG erfolgreich", Exitcode 1.

- [ ] **Schritt 6: Nachweisen, dass die Seite danach gesund ist**

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://hideandseek.vielhaben.com/
ssh deploy@91.98.85.53 'systemctl is-active hideandseek-backend'
```

Erwartet: HTTP 200 und `active`.

- [ ] **Schritt 7: Scheiternde Migration nachstellen**

Der zweite Fehlerfall aus der Spec. Migrationen laufen über `tsx src/db/migrate.ts`; scheitert der Prozess, muss die Datenbank zurückgespielt und der Code **nicht** getauscht werden. Nachgestellt, indem `migrate.ts` vorübergehend abbricht — auf dem Server, nicht im Repo:

```bash
ssh deploy@91.98.85.53 'sudo sh -c "cp /opt/hideandseek/backend/src/db/migrate.ts /tmp/migrate.ts.orig && printf \"\nprocess.exit(1);\n\" >> /opt/hideandseek/backend/src/db/migrate.ts"'
ssh deploy@91.98.85.53 'sudo md5sum /opt/hideandseek/backend/hideandseek.db; sudo ls -1dt /opt/hideandseek/backups/dist-* | head -1'
ssh deploy@91.98.85.53 'sudo DEPLOY_SKIP_RESET=1 /opt/hideandseek/scripts/deploy.sh; echo "Exitcode: $?"'
```

Erwartet: „Migration gescheitert. Datenbank zurueckgespielt, Code NICHT getauscht.", Exitcode 1.

- [ ] **Schritt 8: Nachweisen, dass der Code unberührt blieb**

```bash
ssh deploy@91.98.85.53 'sudo md5sum /opt/hideandseek/backend/hideandseek.db; sudo ls -1dt /opt/hideandseek/backups/dist-* | head -1; systemctl is-active hideandseek-backend'
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://hideandseek.vielhaben.com/
```

Erwartet: dieselbe Prüfsumme der Datenbank wie in Schritt 7 vor dem Lauf, **keine neue** `dist-*`-Sicherung (der Tausch fand nicht statt), Dienst `active`, HTTP 200.

- [ ] **Schritt 9: Änderung an `migrate.ts` zurücknehmen**

```bash
ssh deploy@91.98.85.53 'sudo cp /tmp/migrate.ts.orig /opt/hideandseek/backend/src/db/migrate.ts && sudo git -C /opt/hideandseek status --short'
```

Erwartet: keine Ausgabe von `git status` für getrackte Dateien.

- [ ] **Schritt 10: Danach einen sauberen Deploy fahren**, damit der Server wieder auf dem aktuellen Stand steht:

```bash
ssh deploy@91.98.85.53 'sudo /opt/hideandseek/scripts/deploy.sh'
```

Erwartet: läuft durch bis „ist live.", Exitcode 0.

---

### Task 5: Sicherungen ausdünnen

Ohne das wird `backups/` der nächste Plattenfresser. Am 18.09. war die Platte zu 98 % voll, unter anderem durch nie aufgeräumte Artefakte.

**Dateien:**
- Ändern: `scripts/deploy.sh`

**Interfaces:**
- Konsumiert: `SICHERUNGEN`, `log()` aus Task 3
- Produziert: nichts, worauf spätere Aufgaben aufbauen

- [ ] **Schritt 1: In den Erfolgszweig der Gesundheitsprüfung einfügen**

Der Block gehört **innerhalb** des `if gesundheit; then`-Zweigs, unmittelbar nach der Zeile `log "Gesundheitspruefung bestanden. Deploy $COMMIT ist live."`. Nicht ans Dateiende und nicht in den `else`-Zweig: Nach einem Rückweg sollen die alten Sicherungen gerade **nicht** ausgedünnt werden, weil man sie dann braucht.

```bash
# ── 12. Alte Sicherungen ausduennen ────────────────────────────────────
BEHALTEN=5
for muster in 'db-*.sqlite' 'dist-*'; do
    # shellcheck disable=SC2012
    ls -1dt "$SICHERUNGEN"/$muster 2>/dev/null | tail -n "+$((BEHALTEN+1))" \
        | while read -r alt; do
            log "Entferne alte Sicherung: $(basename "$alt")"
            rm -rf "$alt"
          done
done
log "Sicherungen ausgeduennt, die neuesten $BEHALTEN bleiben."
```

- [ ] **Schritt 2: Committen und pushen**

```bash
cd ~/hideandseek
git add scripts/deploy.sh
git commit -m "feat(deploy): alte Sicherungen ausduennen, die letzten fuenf bleiben

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push origin master
```

- [ ] **Schritt 3: Jens weist das Ausdünnen nach**

Sechs Deploys hintereinander wären langsam. Stattdessen Attrappen anlegen und einen Lauf fahren:

```bash
ssh deploy@91.98.85.53 'sudo sh -c "cd /opt/hideandseek/backups && for i in 1 2 3 4 5 6 7; do touch -d \"-\$i day\" db-2026010\$i-000000.sqlite; mkdir -p dist-2026010\$i-000000; touch -d \"-\$i day\" dist-2026010\$i-000000; done; ls -1 | wc -l"'
ssh deploy@91.98.85.53 'sudo git -C /opt/hideandseek fetch origin master && sudo git -C /opt/hideandseek reset --hard origin/master && sudo /opt/hideandseek/scripts/deploy.sh | tail -8'
ssh deploy@91.98.85.53 'sudo ls -1dt /opt/hideandseek/backups/db-*.sqlite | wc -l; sudo ls -1dt /opt/hideandseek/backups/dist-* | wc -l'
```

Erwartet: je `5`, und im Protokoll „Entferne alte Sicherung" für die überzähligen.

---

### Task 6: Deploy-Schlüssel und erzwungenes Kommando

**Dateien:**
- Keine im Repo. Server: `~deploy/.ssh/authorized_keys`. GitHub: Repository-Secret `VPS_DEPLOY_KEY`.

**Interfaces:**
- Konsumiert: `scripts/deploy.sh` muss unter `/opt/hideandseek/scripts/deploy.sh` liegen und ausführbar sein
- Produziert: das Secret `VPS_DEPLOY_KEY` im Repo `jens-nerd/JetLagHideAndSeek`, nutzbar als `ssh deploy@91.98.85.53` ohne Argument

- [ ] **Schritt 1: Schlüsselpaar erzeugen (auf dem Mac, nicht auf dem Server)**

```bash
ssh-keygen -t ed25519 -N '' -C 'github-actions-hideandseek' -f /tmp/hideandseek-deploy
```

- [ ] **Schritt 2: Öffentlichen Teil eintragen — Jens führt aus**

```bash
PUB=$(cat /tmp/hideandseek-deploy.pub)
ssh deploy@91.98.85.53 "printf 'command=\"/opt/hideandseek/scripts/deploy.sh\",no-pty,no-agent-forwarding,no-port-forwarding,no-X11-forwarding %s\n' '$PUB' >> ~/.ssh/authorized_keys; tail -1 ~/.ssh/authorized_keys | cut -c1-80"
```

- [ ] **Schritt 3: Privaten Teil als Secret hinterlegen**

```bash
gh secret set VPS_DEPLOY_KEY --repo jens-nerd/JetLagHideAndSeek < /tmp/hideandseek-deploy
gh secret list --repo jens-nerd/JetLagHideAndSeek
```

- [ ] **Schritt 4: Nachweisen, dass der Schlüssel NUR das Skript startet**

```bash
ssh -i /tmp/hideandseek-deploy -o IdentitiesOnly=yes deploy@91.98.85.53 'whoami'
```

Erwartet: **nicht** `deploy`, sondern der Deploy-Lauf — das mitgegebene Kommando wird ignoriert. Genau das ist der Zweck.

- [ ] **Schritt 5: Privaten Schlüssel vom Mac entfernen**

```bash
shred -u /tmp/hideandseek-deploy 2>/dev/null || rm -P /tmp/hideandseek-deploy
rm -f /tmp/hideandseek-deploy.pub
```

- [ ] **Schritt 6: Host-Key für Actions festhalten**

```bash
ssh-keyscan -t ed25519 91.98.85.53 2>/dev/null | tee /tmp/vps-hostkey
gh secret set VPS_HOST_KEY --repo jens-nerd/JetLagHideAndSeek < /tmp/vps-hostkey
rm -f /tmp/vps-hostkey
```

---

### Task 7: Deploy-Job in GitHub Actions

Der vorhandene `test.yml` bleibt die Prüfung. Der Deploy-Job hängt sich per `needs` daran und läuft nur bei einem Push auf `master`.

**Dateien:**
- Umbenennen: `.github/workflows/test.yml` → `.github/workflows/ci.yml` (per `git mv`, damit die Historie erhalten bleibt)
- Ändern: `.github/workflows/ci.yml`

**Interfaces:**
- Konsumiert: die Secrets `VPS_DEPLOY_KEY` und `VPS_HOST_KEY` aus Task 6
- Produziert: nichts, worauf spätere Aufgaben aufbauen

- [ ] **Schritt 1: Datei umbenennen, Workflow-Namen anpassen, Deploy-Job anfügen**

```bash
cd ~/hideandseek
git mv .github/workflows/test.yml .github/workflows/ci.yml
```

Eine Datei namens `test.yml`, die einen Deploy-Job enthält, ist irreführend — daher die Umbenennung.

Die erste Zeile `name: Tests` wird zu `name: CI`. Am Dateiende anfügen (Einrückung wie im vorhandenen Job, vier Leerzeichen):

```yaml
    deploy:
        needs: test
        if: github.event_name == 'push' && github.ref == 'refs/heads/master'
        runs-on: ubuntu-latest
        concurrency:
            group: deploy-vps
            cancel-in-progress: false
        steps:
            - name: SSH-Schlüssel und Host-Key einrichten
              run: |
                  mkdir -p ~/.ssh && chmod 700 ~/.ssh
                  printf '%s\n' "${{ secrets.VPS_DEPLOY_KEY }}" > ~/.ssh/id_ed25519
                  chmod 600 ~/.ssh/id_ed25519
                  printf '%s\n' "${{ secrets.VPS_HOST_KEY }}" > ~/.ssh/known_hosts

            - name: Deploy auslösen
              run: ssh -i ~/.ssh/id_ed25519 -o IdentitiesOnly=yes deploy@91.98.85.53
```

Das mitgegebene Kommando fehlt bewusst: Das erzwungene Kommando in `authorized_keys` startet das Skript.

- [ ] **Schritt 2: YAML prüfen**

```bash
cd ~/hideandseek
python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/ci.yml')); print('Jobs:', list(d['jobs'])); print('deploy.needs:', d['jobs']['deploy']['needs'])"
```

Erwartet: `Jobs: ['test', 'deploy']`, `deploy.needs: test`.

- [ ] **Schritt 3: Committen und pushen** — dieser Push ist zugleich der erste automatische Deploy, also unter Aufsicht

```bash
git add .github/workflows/ci.yml
git commit -m "feat(ci): Deploy auf den VPS nach gruenen Tests

Der Job haengt per needs am vorhandenen Test-Job und laeuft nur bei einem
Push auf master. Der SSH-Schluessel darf durch das erzwungene Kommando in
authorized_keys ausschliesslich scripts/deploy.sh starten.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push origin master
```

- [ ] **Schritt 4: Lauf beobachten**

```bash
gh run watch --exit-status
gh run view --log --job=deploy | tail -30
```

Erwartet: beide Jobs grün, im Deploy-Protokoll „Deploy <sha> ist live."

- [ ] **Schritt 5: Ergebnis unabhängig nachprüfen**

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://hideandseek.vielhaben.com/
ssh deploy@91.98.85.53 'sudo git -C /opt/hideandseek rev-parse --short HEAD; systemctl is-active hideandseek-backend'
```

Erwartet: HTTP 200, der Kurz-SHA entspricht dem gerade gepushten Commit, Dienst `active`.

---

### Task 8: Nachweis über einen kaputten Build und Dokumentation

**Dateien:**
- Ändern: `docs/deploy-vps.md`

**Interfaces:**
- Konsumiert: alles Vorherige
- Produziert: nichts

- [ ] **Schritt 1: Auf einem Zweig einen Fehler einbauen und per Pull Request prüfen**

Die Tests müssen den Fehler fangen, bevor der Deploy startet. Auf einem Zweig, nicht auf `master`:

```bash
cd ~/hideandseek
git checkout -b probe/kaputter-build
printf '\nexport const KAPUTT: number = "keine Zahl";\n' >> backend/src/routes/poi.ts
git commit -am "probe: absichtlicher Typfehler"
git push origin probe/kaputter-build
gh pr create --fill --base master
gh pr checks --watch
```

Erwartet: `Tests` scheitert. Der Deploy-Job läuft wegen `if:` bei einem Pull Request gar nicht erst an.

- [ ] **Schritt 2: Probe wieder entfernen**

```bash
gh pr close --delete-branch
git checkout master
```

- [ ] **Schritt 3: Nachweisen, dass die Produktion unberührt blieb**

```bash
ssh deploy@91.98.85.53 'sudo git -C /opt/hideandseek rev-parse --short HEAD'
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://hideandseek.vielhaben.com/
```

Erwartet: unveränderter SHA aus Task 7, HTTP 200.

- [ ] **Schritt 4: `docs/deploy-vps.md` umschreiben**

Die Anleitung beschreibt bisher den Handbetrieb. Voranstellen: Der Regelweg ist ein Push auf `master`. Die Handschritte bleiben als Notfallweg erhalten, ergänzt um:

- `sudo /opt/hideandseek/scripts/deploy.sh` ist der Handbetrieb und tut dasselbe wie Actions
- die Schalter `MIN_FREE_MB`, `DEPLOY_STOP_AFTER=bau` und `HEALTH_URL` samt Zweck
- dass eine Änderung an `deploy.sh` erst beim übernächsten Deploy wirkt
- wo die Sicherungen liegen, dass fünf behalten werden, und wie man von Hand zurückrollt
- dass die Datenbank bei einer gescheiterten Gesundheitsprüfung auf dem neuen Schema bleibt

- [ ] **Schritt 5: Committen und pushen**

```bash
git add docs/deploy-vps.md
git commit -m "docs(deploy): Regelweg ist der Push auf master

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push origin master
```

- [ ] **Schritt 6: Letzter Nachweis** — dieser Push löst selbst einen Deploy aus

```bash
gh run watch --exit-status
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://hideandseek.vielhaben.com/
```

---

## Was dieser Plan nicht abdeckt

Der turflock-Teil (Schritte 4 und 5 der Spec) wird getrennt geplant, sobald dieser Plan durch ist. Ebenfalls nicht dabei: `UPLOADS_DIR` setzen, die Upload-Verzeichnisse zusammenführen, die Datenbank nach `/var/lib/` verlegen, das Retry-Verhalten gegen die Drosselung von Overpass.
