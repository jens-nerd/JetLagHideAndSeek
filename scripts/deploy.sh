#!/usr/bin/env bash
# Deploy von hideandseek auf den VPS.
# Wird von GitHub Actions über ein erzwungenes SSH-Kommando gestartet
# und laesst sich jederzeit von Hand ausfuehren:
#   sudo /opt/hideandseek/scripts/deploy.sh
# Es laeuft immer die Fassung, die beim Start auf der Platte lag: eine
# Aenderung an dieser Datei wirkt erst beim naechsten Deploy.
# Klammer um den Rumpf: Schutz gegen Selbstaenderung durch git reset --hard in Schritt 3.
{
set -euo pipefail

PROJEKT=/opt/hideandseek
# Datenbank und hochgeladene Bilder liegen ausserhalb des Git-Arbeitsbaums.
# Angelegt wird das Verzeichnis von der Unit (StateDirectory=hideandseek).
DATEN=/var/lib/hideandseek
BRANCH=master
STAGING="$PROJEKT/build-deploy"
SICHERUNGEN="$PROJEKT/backups"
DIENST=hideandseek-backend
MIN_FREE_MB="${MIN_FREE_MB:-2048}"
DEPLOY_STOP_AFTER="${DEPLOY_STOP_AFTER:-}"
# Merkvariable: steht auf 1, solange neuer Backend-Code auf der Platte liegt,
# den bei einem Abbruch niemand sonst zurueckstellt. Nur fehler() liest sie.
BACKEND_ZURUECKSTELLEN=0

# Ohne root geht hier nichts: git in /opt, rsync ins Webroot, systemctl.
# --preserve-env ist noetig, weil sudo die Umgebung sonst ausraeumt und alle
# Erprobungsschalter still verschwinden wuerden.
# SSH_ORIGINAL_COMMAND traegt den auszurollenden Commit (Schritt 3) und muss
# den Selbstaufruf genauso ueberleben wie die Schalter.
[ "$(id -u)" -eq 0 ] || exec sudo -n \
    --preserve-env=MIN_FREE_MB,DEPLOY_STOP_AFTER,DEPLOY_SKIP_RESET,HEALTH_URL,SSH_ORIGINAL_COMMAND,DEPLOY_RUECKWAERTS \
    "$0" "$@"

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
# `exit` loest keine ERR-Falle aus. Jeder Abbruch ueber fehler() in dem
# Fenster, in dem neuer Backend-Code auf der Platte liegt, muss ihn deshalb
# hier selbst zurueckstellen - sonst laeuft der Dienst beim naechsten Neustart
# auf neuem Code gegen eine nicht migrierte Datenbank. backend_dist_zurueck
# ist definiert, bevor die Merkvariable jemals auf 1 steht.
fehler() {
    printf '[%s] FEHLER: %s\n' "$(date -u +%H:%M:%S)" "$*" >&2
    if [ "$BACKEND_ZURUECKSTELLEN" = "1" ]; then
        BACKEND_ZURUECKSTELLEN=0
        backend_dist_zurueck
    fi
    exit 1
}

# ── 1. Sperre ──────────────────────────────────────────────────────────
exec 9>/var/lock/hideandseek-deploy.lock
flock -n 9 || fehler "Ein Deploy laeuft bereits. Abbruch."
log "Sperre gesetzt."

# Ein Zeitstempel fuer den ganzen Lauf: die Sicherungen von Backend-Bau,
# Datenbank und Webroot tragen denselben und gehoeren damit sichtbar zusammen.
# So frueh, weil die Backend-Sicherung schon vor dem Bau angelegt wird.
STEMPEL=$(date -u +%Y%m%d-%H%M%S)
BACKEND_SICHERUNG="$SICHERUNGEN/backend-$STEMPEL"
mkdir -p "$SICHERUNGEN"

# ── 2. Platz pruefen ───────────────────────────────────────────────────
# Auch hier eine Pipeline unter pipefail: ohne || fehler beendet ein
# fehlgeschlagenes df das Skript, ohne dass eine FEHLER-Zeile im Protokoll steht.
FREI_MB=$(df --output=avail -m / | tail -1 | tr -d ' ') \
    || fehler "Freier Platz liess sich nicht ermitteln (df)."
log "Frei auf /: ${FREI_MB} MB (Mindestwert ${MIN_FREE_MB} MB)"
[ "$FREI_MB" -ge "$MIN_FREE_MB" ] \
    || fehler "Zu wenig Platz: ${FREI_MB} MB frei, ${MIN_FREE_MB} MB verlangt."

# ── 3. Stand ziehen ────────────────────────────────────────────────────
# Welcher Stand ausgerollt wird, gibt der Actions-Job mit: das erzwungene
# Kommando in authorized_keys verwirft das per ssh mitgegebene Kommando und
# reicht es in SSH_ORIGINAL_COMMAND durch. Ohne Angabe - Handbetrieb - bleibt
# es bei der Spitze von origin/$BRANCH.
#
# Der Wert kommt von aussen und gilt bis zur Formpruefung als feindlich: kein
# eval, keine Einsetzung ohne Anfuehrungszeichen, und ins Protokoll nur
# entschaerft.
ZIEL_COMMIT="${SSH_ORIGINAL_COMMAND:-}"
if [ -n "$ZIEL_COMMIT" ] && ! [[ "$ZIEL_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
    fehler "Mitgegebener Stand ist kein Commit: '$(printf '%s' "$ZIEL_COMMIT" | tr -c '0-9A-Za-z' '.' | cut -c1-64)' (${#ZIEL_COMMIT} Zeichen). Erlaubt sind genau 40 Zeichen aus 0-9a-f."
fi

# Bewusst KEIN git clean -fd: untracked liegen backups/, build-deploy/ und
# .env. Datenbank und Uploads lagen bis zum 18.09.2026 ebenfalls hier; seither
# stehen sie unter $DATEN und waeren von einem clean nicht mehr betroffen. Der
# Verzicht bleibt trotzdem richtig - in backups/ liegt der Rueckweg.
# DEPLOY_SKIP_RESET dient ausschliesslich der Erprobung (Task 4): damit laesst
# sich ein absichtlich manipulierter Arbeitsbaum testen, ohne dass der Reset
# ihn sofort wieder geradezieht.
if [ "${DEPLOY_SKIP_RESET:-}" = "1" ]; then
    log "DEPLOY_SKIP_RESET=1 - Stand wird nicht gezogen (nur fuer Erprobung)."
    [ -z "$ZIEL_COMMIT" ] \
        || log "Mitgegebener Commit $ZIEL_COMMIT wird deshalb ignoriert."
else
    log "Hole origin/$BRANCH ..."
    git -C "$PROJEKT" fetch origin "$BRANCH"
    if [ -n "$ZIEL_COMMIT" ]; then
        # Das ist der eigentliche Zaun. Die Formpruefung oben haelt nur Unfug
        # fern; erst diese Pruefung begrenzt, WAS ausgerollt werden kann:
        # ausschliesslich ein Commit, der bereits auf origin/$BRANCH liegt.
        # Ein abhandengekommener Deploy-Schluessel kann damit keinen selbst
        # gebauten Stand einschleusen, sondern hoechstens einen Stand noch
        # einmal ausrollen, der ohnehin schon auf $BRANCH steht. Faellt die
        # Pruefung durch, wird gar nichts ausgerollt.
        git -C "$PROJEKT" merge-base --is-ancestor "$ZIEL_COMMIT" "origin/$BRANCH" \
            || fehler "Commit $ZIEL_COMMIT liegt nicht auf origin/$BRANCH. Abbruch, es wird nichts ausgerollt."
        log "Stand aus Actions: $ZIEL_COMMIT liegt auf origin/$BRANCH."
        # Der zweite Zaun, gegen das Zurueckdrehen. Der erste begrenzt, WAS
        # ausrollbar ist; dieser, in WELCHE RICHTUNG. Ein "Re-run jobs" auf
        # einem aelteren Actions-Lauf traegt weiterhin dessen Commit - vor der
        # Bindung an den Commit war das folgenlos, weil ohnehin die Spitze
        # ausgerollt wurde. Jetzt wuerde der Server auf dem alten Stand
        # stehenbleiben, und kein weiterer Deploy holte das zurueck.
        # Derselbe Stand noch einmal ist ein echter Re-Run und geht durch:
        # is-ancestor gilt auch fuer den Commit selbst.
        AKTUELL_COMMIT=$(git -C "$PROJEKT" rev-parse HEAD) \
            || fehler "Ausgerollter Stand liess sich nicht lesen (git rev-parse HEAD in $PROJEKT)."
        if ! git -C "$PROJEKT" merge-base --is-ancestor "$AKTUELL_COMMIT" "$ZIEL_COMMIT"; then
            [ "${DEPLOY_RUECKWAERTS:-}" = "1" ] \
                || fehler "Ausgerollt ist bereits $AKTUELL_COMMIT; $ZIEL_COMMIT liegt nicht dahinter. Es wird nichts zurueckgedreht. Wer genau das will: DEPLOY_RUECKWAERTS=1 setzen."
            log "DEPLOY_RUECKWAERTS=1 - es wird auf $ZIEL_COMMIT zurueckgedreht, obwohl $AKTUELL_COMMIT ausgerollt ist."
        fi
        git -C "$PROJEKT" reset --hard "$ZIEL_COMMIT"
    else
        log "Kein Stand mitgegeben (Handbetrieb) - es wird die Spitze von origin/$BRANCH ausgerollt."
        git -C "$PROJEKT" reset --hard "origin/$BRANCH"
    fi
fi
COMMIT=$(git -C "$PROJEKT" rev-parse --short HEAD) \
    || fehler "HEAD liess sich nicht lesen - ist $PROJEKT noch ein Git-Arbeitsbaum?"
log "Stand: $COMMIT $(git -C "$PROJEKT" log -1 --pretty=%s)"

# ── 4. Abhaengigkeiten ─────────────────────────────────────────────────
log "pnpm install ..."
( cd "$PROJEKT" && pnpm install --frozen-lockfile )
# pnpm kompiliert die native Bindung wegen der Build-Script-Allowlist nicht
# mit. Ohne diesen Rebuild startet das Backend nicht.
( cd "$PROJEKT" && pnpm rebuild better-sqlite3 )

# shared/dist ist gitignored und kommt hier sonst noch vom vorigen Deploy:
# der Frontend-Bau liest shared/dist direkt, aber pnpm backend:build baut es
# erst weiter unten neu. Ohne diesen Schritt haengt der Frontend-Bau einen
# Stand hinterher und bricht, sobald shared neue Exporte bekommt.
log "Geteiltes Paket bauen ..."
( cd "$PROJEKT" && pnpm shared:build )

# ── 5. Bauen ───────────────────────────────────────────────────────────
# Das Ausgabeverzeichnis MUSS innerhalb des Projekts liegen, sonst legt das
# PWA-Plugin sw.js an die falsche Stelle und die Precache-Liste bricht ein.
rm -rf "$STAGING"
log "Frontend bauen -> $STAGING"
( cd "$PROJEKT" && pnpm exec astro build --outDir "$STAGING" )

# tsc schreibt direkt nach backend/dist - also in genau die Dateien, die der
# Dienst beim naechsten Start ausfuehrt - und raeumt das Verzeichnis vorher
# nicht auf. Darum vorher sichern.
backend_dist_zurueck() {
    # Jeder Befehl mit || log: die Funktion laeuft unter set -e genauso
    # vollstaendig durch wie unter set +e im Rueckweg.
    if [ -d "$BACKEND_SICHERUNG" ]; then
        log "Backend-Bau aus $BACKEND_SICHERUNG zurueckspielen ..."
        # --ignore-times, weil rsync sonst nach Groesse und Zeitstempel
        # entscheidet: eine gleich grosse, in derselben Sekunde geschriebene
        # index.js wuerde uebersprungen. Beim Wiederherstellen von Code, der
        # gleich ausgefuehrt wird, ist Raten zu wenig; backend/dist ist klein.
        rsync -a --delete --ignore-times "$BACKEND_SICHERUNG/" "$PROJEKT/backend/dist/" \
            || log "Zurueckspielen von backend/dist meldete einen Fehler."
    else
        log "Keine Backend-Sicherung vorhanden - backend/dist bleibt, wie es ist."
    fi
}

if [ -d "$PROJEKT/backend/dist" ]; then
    log "Backend-Bau sichern -> $BACKEND_SICHERUNG"
    cp -a "$PROJEKT/backend/dist" "$BACKEND_SICHERUNG"
else
    log "Kein voriger Backend-Bau vorhanden - nichts zu sichern."
fi
# Ab hier schreibt gleich der Bau nach backend/dist. Bis der Webroot getauscht
# ist, stellt diesen Code bei einem Abbruch niemand ausser uns zurueck: die
# Falle unten faengt Rueckgabewerte und Signale, fehler() alles Uebrige.
BACKEND_ZURUECKSTELLEN=1

# Ein abgebrochener Bau darf den Server nicht auf neuem Backend-Code stehen
# lassen: der wuerde beim naechsten Dienstneustart gegen eine nicht migrierte
# Datenbank laufen. Dasselbe gilt fuer jeden weiteren Abbruch bis zum
# Sicherungspunkt - Bau-Pruefung, Datenbanksicherung und vor allem die lange
# Migration liegen noch davor. Darum bleibt diese Falle stehen, statt nach dem
# Bau abgeraeumt zu werden; sie tut dasselbe wie fehler(). Abgeloest wird sie
# erst von der Falle hinter dem Sicherungspunkt, und ein trap-Aufruf ersetzt
# den vorigen in einem Zug - dazwischen liegt kein Augenblick ohne Falle und
# keiner mit zweien. Sie raeumt sich als Erstes selbst ab, damit sie beim
# Zurueckspielen oder bei einem zweiten Signal nicht in sich selbst faellt.
trap 'trap - ERR INT TERM HUP; log "Abbruch zwischen Backend-Bau und Sicherungspunkt - Webroot unveraendert, eine begonnene Migration bleibt stehen."; backend_dist_zurueck; exit 1' ERR INT TERM HUP
log "Backend bauen ..."
( cd "$PROJEKT" && pnpm backend:build )

# ── 6. Bau pruefen ─────────────────────────────────────────────────────
[ -f "$STAGING/index.html" ] || fehler "index.html fehlt im Bau."
[ -f "$STAGING/sw.js" ]      || fehler "sw.js fehlt im Bau."
[ -f "$PROJEKT/backend/dist/index.js" ] || fehler "Backend-Bau fehlt."
# `|| true`, weil grep ohne Treffer 1 liefert: mit pipefail scheitert sonst die
# ganze Kommandosubstitution, und set -e beendet das Skript still - ausgerechnet
# an der Zeile, die den kaputten Bau melden soll. Mit || true steht 0 in
# PRECACHE und die Pruefung darunter sagt es.
PRECACHE=$(grep -o 'revision:' "$STAGING/sw.js" | wc -l || true)
[ "$PRECACHE" -ge 20 ] \
    || fehler "sw.js hat nur $PRECACHE Precache-Eintraege - Bau ist kaputt."
log "Bau geprueft: $PRECACHE Precache-Eintraege."

if [ "$DEPLOY_STOP_AFTER" = "bau" ]; then
    log "DEPLOY_STOP_AFTER=bau gesetzt - hier ist Schluss."
    log "Webroot und Datenbank sind unveraendert. node_modules und backend/dist"
    log "stehen auf dem neuen Stand und werden beim naechsten Dienstneustart wirksam."
    exit 0
fi

# ═══ ab hier wird der Webroot und die Datenbank angefasst ══════════════
DB="$DATEN/hideandseek.db"
DB_SICHERUNG="$SICHERUNGEN/db-$STEMPEL.sqlite"
DIST_SICHERUNG="$SICHERUNGEN/dist-$STEMPEL"

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

rueckweg_code() {
    log "RUECKWEG: vorigen Webroot zurueckspielen ..."
    # set +e, damit ein Fehlschlag hier die Funktion nicht abbricht: sonst
    # erfuehre der Operator nie, in welchem Zustand die Seite zurueckbleibt.
    set +e
    # --ignore-times aus demselben Grund wie beim Backend: rsync entscheidet
    # nach Groesse und Zeitstempel. Deploy und Rueckweg liegen Sekunden
    # auseinander, und index.html und sw.js tragen feste Namen und koennen
    # gleich gross sein. Gemessen: dann bleiben genau diese zwei Dateien neu.
    rsync -a --delete --ignore-times "$DIST_SICHERUNG/" "$PROJEKT/dist/" \
        || log "RUECKWEG: rsync meldete einen Fehler."
    chmod -R 755 "$PROJEKT/dist" \
        || log "RUECKWEG: chmod meldete einen Fehler."
    # Vor dem Neustart, sonst startet der Dienst wieder den neuen Backend-Bau -
    # also genau den, der die Gesundheitspruefung eben hat durchfallen lassen.
    backend_dist_zurueck
    systemctl restart "$DIENST" \
        || log "RUECKWEG: Neustart meldete einen Fehler."
    sleep 3
    if gesundheit; then
        log "RUECKWEG erfolgreich. Voriger Stand ist wieder live."
    else
        log "RUECKWEG gescheitert - die Seite ist NICHT gesund. Handbetrieb noetig."
    fi
    set -e
}

rueckweg_db() {
    log "RUECKWEG: Datenbank aus $DB_SICHERUNG zurueckspielen ..."
    # Fail-safe belegt: nur der Erfolgszweig unten setzt das um.
    RUECKWEG_DB_ERGEBNIS=gescheitert
    set +e
    systemctl stop "$DIENST" \
        || log "RUECKWEG: Stoppen des Dienstes meldete einen Fehler."
    # Der Dienst ist gestoppt, also ist hier der Platz fuer backend/dist - vor
    # jedem moeglichen start. Eine zurueckgedrehte Datenbank neben neuem Code
    # waere genau die Paarung, gegen die diese Runde angetreten ist.
    backend_dist_zurueck
    BACKEND_ZURUECKSTELLEN=0
    # Nur wenn das Zurueckkopieren geklappt hat, darf das WAL weg: im
    # WAL-Modus stehen festgeschriebene Transaktionen bis zum Checkpoint nur
    # dort. Nach einem gescheiterten cp waere ein rm -f ein Datenverlust, und
    # ein gestarteter Dienst wuerde auf eine halbe Datenbank weiterschreiben.
    if cp -a "$DB_SICHERUNG" "$DB"; then
        # cp -a bringt Eigentuemer und Modus der Sicherung mit: die gehoert
        # root und ist 644, weil sqlite3 sie als root angelegt hat.
        chown hideandseek:hideandseek "$DB" \
            || log "RUECKWEG: chown meldete einen Fehler."
        chmod 640 "$DB" \
            || log "RUECKWEG: chmod meldete einen Fehler."
        rm -f "$DB-wal" "$DB-shm"
        RUECKWEG_DB_ERGEBNIS=zurueckgespielt
        systemctl start "$DIENST" \
            || log "RUECKWEG: Start des Dienstes meldete einen Fehler."
        if systemctl is-active --quiet "$DIENST"; then
            log "Datenbank zurueckgespielt, Dienst laeuft."
        else
            log "Datenbank zurueckgespielt, aber der Dienst laeuft NICHT. Handbetrieb noetig."
        fi
    else
        log "RUECKWEG: Zurueckkopieren der Datenbank GESCHEITERT."
        log "Datenbank, -wal und -shm bleiben unangetastet, der Dienst bleibt GESTOPPT."
        log "Handbetrieb noetig: $DB pruefen, Sicherung ist $DB_SICHERUNG."
        # Der Backend-Bau ist an dieser Stelle schon zurueckgedreht, die
        # Datenbank nicht - wer jetzt blind startet, faehrt alten Code gegen
        # ein Schema, von dem niemand weiss, wie weit die Migration kam.
        log "Welcher Backend-Bau liegt, sagen die Zeilen oben. Erst wenn Code und"
        log "Schema zusammenpassen: 'systemctl start $DIENST'."
    fi
    set -e
}

# ── 7. Datenbank sichern ───────────────────────────────────────────────
# .backup statt cp: atomar, nimmt den WAL-Stand mit.
log "Datenbank sichern -> $DB_SICHERUNG"
sqlite3 "file:$DB?mode=ro" ".backup '$DB_SICHERUNG'" \
    || fehler "Sicherung der Datenbank liess sich nicht anlegen. Abbruch vor der Migration."
sqlite3 "$DB_SICHERUNG" "pragma integrity_check;" | grep -qx ok \
    || fehler "Sicherung der Datenbank ist nicht lesbar. Abbruch vor der Migration."
# integrity_check beantwortet nur "ist das eine gueltige SQLite-Datei": eine
# 0-Byte-Datei und ein abgeschnittener Torso bestehen sie ebenfalls mit ok.
# rueckweg_db kopiert diese Sicherung ungeprueft ueber die Produktionsdatenbank,
# darum zusaetzlich: nicht leer, und dieselbe Tabellenzahl wie die Quelle.
TABELLEN_SQL="select count(*) from sqlite_master where type='table'"
TABELLEN_QUELLE=$(sqlite3 "file:$DB?mode=ro" "$TABELLEN_SQL" || echo quelle-unlesbar)
TABELLEN_SICHERUNG=$(sqlite3 "$DB_SICHERUNG" "$TABELLEN_SQL" || echo sicherung-unlesbar)
[ -s "$DB_SICHERUNG" ] && [ "$TABELLEN_SICHERUNG" = "$TABELLEN_QUELLE" ] \
    || fehler "Sicherung passt nicht zur Datenbank (Quelle: ${TABELLEN_QUELLE:-leer} Tabellen, Sicherung: ${TABELLEN_SICHERUNG:-leer}). Abbruch vor der Migration."

# ── 8. Migrationen ─────────────────────────────────────────────────────
# Scheitert die Migration, ist das Schema ohnehin kaputt: Datenbank zurueck,
# Code gar nicht erst tauschen.
log "Migrationen fahren ..."
# DB_PATH muss hier stehen. backend/src/db/migrate.ts faellt sonst auf
# ./hideandseek.db zurueck, und pnpm --filter setzt das Arbeitsverzeichnis auf
# backend/ - die Migration liefe also gegen eine zweite, leere Datei im
# Arbeitsbaum, waehrend der Dienst auf $DB weiterarbeitet. Sie wuerde sogar
# gelingen und nichts melden.
if ! ( cd "$PROJEKT" && DB_PATH="$DB" pnpm backend:migrate ); then
    rueckweg_db
    # Die Schlussmeldung muss zu dem passen, was rueckweg_db wirklich getan
    # hat - sonst steht hier dasselbe Problem wie in W4, nur eine Zeile weiter.
    if [ "$RUECKWEG_DB_ERGEBNIS" = "zurueckgespielt" ]; then
        fehler "Migration gescheitert. Datenbank und Backend-Bau zurueckgedreht (siehe RUECKWEG-Zeilen), Webroot NICHT getauscht."
    else
        fehler "Migration gescheitert UND die Datenbank liess sich nicht zurueckspielen. Der Dienst ist GESTOPPT, Handbetrieb noetig (siehe RUECKWEG-Zeilen)."
    fi
fi
# Die Migration laeuft als root - das Skript ruft sich in Schritt 0 selbst per
# sudo auf. Ein dabei neu angelegtes -wal oder -shm gehoert dann root, und der
# Dienst kaeme nicht mehr daran. Den Modus setzt SQLite von der Datenbankdatei
# ab, den muss hier niemand nachziehen.
for datei in "$DB" "$DB-wal" "$DB-shm"; do
    [ -e "$datei" ] || continue
    chown hideandseek:hideandseek "$datei" \
        || log "chown auf $(basename "$datei") meldete einen Fehler."
done

# ── 9. Webroot sichern, dann tauschen ──────────────────────────────────
log "Webroot sichern -> $DIST_SICHERUNG"
cp -a "$PROJEKT/dist" "$DIST_SICHERUNG" \
    || fehler "Webroot-Sicherung liess sich nicht anlegen. Abbruch vor dem Tausch."

# Ab hier uebernimmt rueckweg_code das Zurueckstellen von backend/dist. Die
# Merkvariable wuerde von hier an nur einen zweiten, ueberfluessigen Durchlauf
# ausloesen.
BACKEND_ZURUECKSTELLEN=0

# Ab hier ist ein Rueckweg moeglich, weil die Sicherung steht. Diese Falle
# loest die vom Backend-Bau ab - sie ersetzt sie, ohne Luecke dazwischen. Sie
# faengt alles, was zwischen hier und der Gesundheitspruefung abbricht:
# ein mittendrin gescheitertes rsync ebenso wie ein fehlgeschlagener
# systemctl restart. Ohne sie bliebe ein halb getauschtes Webroot liegen.
# INT TERM HUP gehoeren dazu, weil ERR nur auf Rueckgabewerte reagiert: reisst
# die SSH-Sitzung waehrend des rsync --delete ab, kommt ein Signal, kein
# Rueckgabewert. Die Falle raeumt sich als Erstes selbst ab - sonst loeste ein
# Fehlschlag im Rueckweg die Falle erneut aus.
trap 'trap - ERR INT TERM HUP; log "Unerwarteter Abbruch nach dem Sicherungspunkt."; rueckweg_code; exit 1' ERR INT TERM HUP

log "Webroot tauschen ..."
rsync -a --delete "$STAGING/" "$PROJEKT/dist/"
chmod -R 755 "$PROJEKT/dist"

# ── 10. Dienst neu starten ─────────────────────────────────────────────
log "Dienst neu starten ..."
systemctl restart "$DIENST"
sleep 3

# ── 11. Gesundheitspruefung ────────────────────────────────────────────
# Nur der Code wird zurueckgerollt. Die Datenbank steht auf dem neuen
# Schema und bleibt dort: ein automatisches Zurueckspielen wuerde alles
# verwerfen, was seit Schritt 7 geschrieben wurde.
trap - ERR INT TERM HUP   # ab hier wird von Hand entschieden, nicht mehr automatisch
if gesundheit; then
    log "Gesundheitspruefung bestanden. Deploy $COMMIT ist live."

    # ── 12. Alte Sicherungen ausduennen ────────────────────────────────────
    # Die Muster treffen bewusst NUR den Zeitstempel, den dieses Skript selbst
    # vergibt (JJJJMMTT-HHMMSS). Von Hand angelegte Sicherungen wie
    # dist-vor-rebuild bleiben dadurch unangetastet.
    BEHALTEN=5
    ZIFFER8='[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
    ZIFFER6='[0-9][0-9][0-9][0-9][0-9][0-9]'
    shopt -s nullglob
    for muster in "db-$ZIFFER8-$ZIFFER6.sqlite" "dist-$ZIFFER8-$ZIFFER6" "backend-$ZIFFER8-$ZIFFER6"; do
        eintraege=("$SICHERUNGEN"/$muster)
        [ "${#eintraege[@]}" -gt "$BEHALTEN" ] || continue
        while IFS= read -r alt; do
            log "Entferne alte Sicherung: $(basename "$alt")"
            # Ein fehlgeschlagenes rm darf einen laengst live geschalteten
            # Deploy nicht nachtraeglich als Fehler enden lassen.
            rm -rf "$alt" || log "Konnte $(basename "$alt") nicht entfernen."
        done < <(ls -1dt "${eintraege[@]}" | tail -n "+$((BEHALTEN + 1))")
    done
    shopt -u nullglob
    log "Sicherungen ausgeduennt, die neuesten $BEHALTEN bleiben."
else
    log "Gesundheitspruefung gescheitert."
    rueckweg_code
    log "ACHTUNG: Die Datenbank steht auf dem NEUEN Schema ($DB_SICHERUNG ist die Sicherung davor)."
    exit 1
fi
# bash darf nach dem Ende der Gruppe nicht in die (inzwischen ersetzte) Datei zuruecklaufen.
exit 0
}
