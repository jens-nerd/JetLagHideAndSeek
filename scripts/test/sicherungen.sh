#!/usr/bin/env bash
# Nachweise fuer das Anlegen und Ausduennen der Sicherungen in backups/.
#
# Befund vom 22.09.2026: Die Ausduennung (Schritt 12) hat zweimal die gerade
# angelegte Backend-Sicherung geloescht und fuenf vom 18.09. behalten. Sie
# sortierte mit `ls -t` nach Aenderungszeit. `cp -a` uebernimmt aber die Zeit
# der Quelle, und backend/dist traegt seit dem 28.03.2026 dieselbe
# Verzeichniszeit - alle backend-*-Sicherungen waren gleich "alt", und bei
# Gleichstand sortiert ls nach Namen, die neueste also ans Ende und damit
# in den Loeschbereich. Dazu blieben -wal/-shm neben geloeschten
# Datenbanksicherungen liegen.
#
# Methode wie in den anderen Nachweisen: Die Bloecke werden mit awk aus
# scripts/deploy.sh herausgeschnitten und genau so ausgefuehrt.
#
# Braucht sqlite3 und GNU- oder BSD-touch (-d bzw. -t).

set -uo pipefail

FEHLER=0
HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$HIER/../deploy.sh"

TMPDIR=$(mktemp -d) || { echo "FEHLER: mktemp -d fehlgeschlagen." >&2; exit 1; }
trap 'rm -rf "$TMPDIR"' EXIT

ok()  { echo "  OK: $*"; }
nok() { echo "  FEHLER: $*" >&2; FEHLER=$((FEHLER + 1)); }

block_ausduennen() {
    awk '/# ── 12\. Alte Sicherungen ausduennen/,/log "Sicherungen ausgeduennt/' "$DEPLOY"
}
block_db_sichern() {
    awk '/^# ── 7\. Datenbank sichern/,/^# ── 8\. /' "$DEPLOY"
}

# Setzt die Aenderungszeit auf einen festen Zeitpunkt (JJJJMMTThhmm).
alt_machen() {
    touch -h -t "$2" "$1" 2>/dev/null || touch -t "$2" "$1"
}

lauf_ausduennen() {
    (
        set -euo pipefail
        SICHERUNGEN="$1"
        STEMPEL="$2"
        log() { printf '[test] %s\n' "$*"; }
        fehler() { printf '[test] FEHLER: %s\n' "$*" >&2; exit 1; }
        eval "$(block_ausduennen)"
    )
}

echo "== Vorbedingungen =="
[ -n "$(block_ausduennen)" ] && ok "Block 12 in deploy.sh gefunden" || nok "Block 12 fehlt"
[ -n "$(block_db_sichern)" ] && ok "Block 7 in deploy.sh gefunden" || nok "Block 7 fehlt"
command -v sqlite3 >/dev/null || { echo "FEHLER: sqlite3 fehlt." >&2; exit 1; }

echo "== 1. Serverfall: gleiche alte mtime, die frische Sicherung heisst am neuesten =="
S="$TMPDIR/s1"; mkdir -p "$S"
for st in 20260918-181850 20260918-182211 20260918-183731 20260918-191435 20260918-191813 20260922-170738; do
    mkdir "$S/backend-$st"; echo x > "$S/backend-$st/index.js"
    alt_machen "$S/backend-$st" 202603281843
done
lauf_ausduennen "$S" 20260922-170738 >"$TMPDIR/l1.log" 2>&1 || { nok "Block 12 bricht ab:"; sed 's/^/    /' "$TMPDIR/l1.log" >&2; }
[ -d "$S/backend-20260922-170738" ] && ok "die gerade angelegte Sicherung bleibt" \
    || nok "die gerade angelegte Sicherung wurde geloescht"
[ ! -d "$S/backend-20260918-181850" ] && ok "die aelteste (nach Namen) ist weg" \
    || nok "die aelteste (nach Namen) liegt noch da"
N=$(ls -1d "$S"/backend-* | wc -l | tr -d ' ')
[ "$N" = "5" ] && ok "fuenf bleiben" || nok "$N bleiben statt fuenf"

echo "== 2. Verdrehte mtimes: entscheidend ist der Name =="
S="$TMPDIR/s2"; mkdir -p "$S"
# dist-Sicherungen tragen die Zeit des Webroots, und der wird bei einem
# gescheiterten Deploy nicht getauscht - die Zeiten laufen dann nicht mit.
i=0
for st in 20260920-111343 20260920-114057 20260920-134627 20260922-141938 20260922-144613 20260922-154700 20260922-170738; do
    mkdir "$S/dist-$st"
    i=$((i + 1))
    # absichtlich umgekehrt: je neuer der Name, desto aelter die mtime
    alt_machen "$S/dist-$st" "20260$((9 - i))010000"
done
lauf_ausduennen "$S" 20260922-170738 >"$TMPDIR/l2.log" 2>&1 || { nok "Block 12 bricht ab:"; sed 's/^/    /' "$TMPDIR/l2.log" >&2; }
ERWARTET="dist-20260920-134627 dist-20260922-141938 dist-20260922-144613 dist-20260922-154700 dist-20260922-170738"
IST=$(cd "$S" && ls -1d dist-* | tr '\n' ' ' | sed 's/ $//')
[ "$IST" = "$ERWARTET" ] && ok "die fuenf neuesten Namen bleiben" || nok "es bleiben: $IST"

echo "== 3. Datenbanksicherungen: -wal/-shm gehen mit, verwaiste auch =="
S="$TMPDIR/s3"; mkdir -p "$S"
for st in 20260920-091844 20260921-101314 20260922-141938 20260922-144613 20260922-154700 20260922-170738; do
    echo db > "$S/db-$st.sqlite"
done
: > "$S/db-20260920-091844.sqlite-wal"; : > "$S/db-20260920-091844.sqlite-shm"   # Begleiter der aeltesten
: > "$S/db-20260919-000000.sqlite-wal"; : > "$S/db-20260919-000000.sqlite-shm"   # Waise
: > "$S/db-20260922-141938.sqlite-shm"                                            # Begleiter einer Behaltenen
echo hand > "$S/vor-testlauf-20260920-062217.sqlite"
lauf_ausduennen "$S" 20260922-170738 >"$TMPDIR/l3.log" 2>&1 || { nok "Block 12 bricht ab:"; sed 's/^/    /' "$TMPDIR/l3.log" >&2; }
[ ! -e "$S/db-20260920-091844.sqlite" ] && ok "aelteste Datenbanksicherung weg" || nok "aelteste Datenbanksicherung liegt noch"
[ ! -e "$S/db-20260920-091844.sqlite-wal" ] && [ ! -e "$S/db-20260920-091844.sqlite-shm" ] \
    && ok "ihre -wal/-shm gehen mit" || nok "ihre -wal/-shm bleiben liegen"
[ -e "$S/db-20260921-101314.sqlite" ] && ok "fuenf neueste bleiben" || nok "db-20260921-101314 faelschlich geloescht"
[ ! -e "$S/db-20260919-000000.sqlite-wal" ] && [ ! -e "$S/db-20260919-000000.sqlite-shm" ] \
    && ok "verwaiste -wal/-shm ohne Datenbank sind weg" || nok "verwaiste -wal/-shm liegen noch"
[ -e "$S/db-20260922-141938.sqlite-shm" ] && ok "Begleiter einer behaltenen Sicherung bleibt" \
    || nok "Begleiter einer behaltenen Sicherung wurde geloescht"
[ -e "$S/vor-testlauf-20260920-062217.sqlite" ] && ok "von Hand angelegte Sicherung bleibt unangetastet" \
    || nok "von Hand angelegte Sicherung wurde geloescht"

echo "== 4. Datenbanksicherung: konsistent und ohne WAL-Modus =="
S="$TMPDIR/s4"; mkdir -p "$S"
DBQ="$S/live.db"
sqlite3 "$DBQ" "pragma journal_mode=WAL; create table t(x); insert into t values (1),(2),(3);" >/dev/null
sqlite3 "$DBQ" "insert into t values (4);" >/dev/null
if (
    set -euo pipefail
    DB="$DBQ"; DB_SICHERUNG="$S/db-20260922-170738.sqlite"
    log() { printf '[test] %s\n' "$*"; }
    fehler() { printf '[test] FEHLER: %s\n' "$*" >&2; exit 1; }
    eval "$(block_db_sichern)"
) >"$TMPDIR/l4.log" 2>&1; then
    ok "Block 7 endet mit 0"
else
    nok "Block 7 bricht ab:"; sed 's/^/    /' "$TMPDIR/l4.log" >&2
fi
B="$S/db-20260922-170738.sqlite"
[ "$(sqlite3 "$B" 'select count(*) from t')" = "4" ] && ok "Sicherung enthaelt alle Zeilen" \
    || nok "Sicherung unvollstaendig"
MODUS=$(sqlite3 "$B" 'pragma journal_mode;')
[ "$MODUS" = "delete" ] && ok "Sicherung steht im Journal-Modus delete" || nok "Sicherung steht im Journal-Modus $MODUS"
sqlite3 -readonly "$B" 'select count(*) from t' >/dev/null
[ ! -e "$B-wal" ] && [ ! -e "$B-shm" ] && ok "Lesen der Sicherung hinterlaesst kein -wal/-shm" \
    || nok "Lesen der Sicherung hinterlaesst -wal/-shm"
PERM=$(stat -c %a "$B" 2>/dev/null || stat -f %Lp "$B")
[ "$PERM" = "600" ] && ok "Sicherung hat Modus 600" || nok "Sicherung hat Modus $PERM"

echo
if [ "$FEHLER" -eq 0 ]; then echo "Alle Nachweise gruen."; else echo "$FEHLER Nachweis(e) rot." >&2; fi
exit "$FEHLER"
