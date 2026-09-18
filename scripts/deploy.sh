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

rueckweg_code() {
    log "RUECKWEG: vorigen Webroot zurueckspielen ..."
    # set +e, damit ein Fehlschlag hier die Funktion nicht abbricht: sonst
    # erfuehre der Operator nie, in welchem Zustand die Seite zurueckbleibt.
    set +e
    rsync -a --delete "$DIST_SICHERUNG/" "$PROJEKT/dist/" \
        || log "RUECKWEG: rsync meldete einen Fehler."
    chmod -R 755 "$PROJEKT/dist" \
        || log "RUECKWEG: chmod meldete einen Fehler."
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
    set +e
    systemctl stop "$DIENST" \
        || log "RUECKWEG: Stoppen des Dienstes meldete einen Fehler."
    cp -a "$DB_SICHERUNG" "$DB" \
        || log "RUECKWEG: Zurueckkopieren der Datenbank GESCHEITERT."
    chown hideandseek:hideandseek "$DB" \
        || log "RUECKWEG: chown meldete einen Fehler."
    rm -f "$DB-wal" "$DB-shm"
    systemctl start "$DIENST" \
        || log "RUECKWEG: Start des Dienstes meldete einen Fehler."
    if systemctl is-active --quiet "$DIENST"; then
        log "Datenbank zurueckgespielt, Dienst laeuft."
    else
        log "Datenbank zurueckgespielt, aber der Dienst laeuft NICHT. Handbetrieb noetig."
    fi
    set -e
}

# ── 7. Datenbank sichern ───────────────────────────────────────────────
# .backup statt cp: atomar, nimmt den WAL-Stand mit.
log "Datenbank sichern -> $DB_SICHERUNG"
sqlite3 "file:$DB?mode=ro" ".backup '$DB_SICHERUNG'"
sqlite3 "$DB_SICHERUNG" "pragma integrity_check;" | grep -qx ok \
    || fehler "Sicherung der Datenbank ist nicht lesbar. Abbruch vor der Migration."

# ── 8. Migrationen ─────────────────────────────────────────────────────
# Scheitert die Migration, ist das Schema ohnehin kaputt: Datenbank zurueck,
# Code gar nicht erst tauschen.
log "Migrationen fahren ..."
if ! ( cd "$PROJEKT" && pnpm backend:migrate ); then
    rueckweg_db
    fehler "Migration gescheitert. Datenbank zurueckgespielt, Code NICHT getauscht."
fi

# ── 9. Webroot sichern, dann tauschen ──────────────────────────────────
log "Webroot sichern -> $DIST_SICHERUNG"
cp -a "$PROJEKT/dist" "$DIST_SICHERUNG"

# Ab hier ist ein Rueckweg moeglich, weil die Sicherung steht. Die Falle
# faengt alles, was zwischen hier und der Gesundheitspruefung abbricht:
# ein mittendrin gescheitertes rsync ebenso wie ein fehlgeschlagener
# systemctl restart. Ohne sie bliebe ein halb getauschtes Webroot liegen.
trap 'log "Unerwarteter Abbruch nach dem Sicherungspunkt."; rueckweg_code; exit 1' ERR

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
trap - ERR   # ab hier wird von Hand entschieden, nicht mehr automatisch
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
    for muster in "db-$ZIFFER8-$ZIFFER6.sqlite" "dist-$ZIFFER8-$ZIFFER6"; do
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
