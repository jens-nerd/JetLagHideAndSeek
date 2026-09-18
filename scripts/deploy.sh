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
