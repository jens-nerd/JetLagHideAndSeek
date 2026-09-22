#!/usr/bin/env bash
# Nachweise fuer den Vorfall vom 22.09.2026: hideandseek und turflock teilten
# sich ueber den gemeinsamen pnpm-Store unter /root dieselben Dateien (harte
# Links, gleiche Inodes). Ein `chown -R root:root /opt/turflock` stellte damit
# auch rund 12.000 Dateien in hideandseeks node_modules um, und das Backend
# startete beim naechsten Deploy nicht mehr (permission denied auf
# drizzle-orm/package.json).
#
# Geprueft wird der Block "4b" aus scripts/deploy.sh. Wie in den anderen
# Nachweisen schneidet das Skript den Block mit awk aus deploy.sh heraus und
# fuehrt genau diesen Text aus, statt die Logik nachzuschreiben.
#
# Aufbau: ein Wegwerf-Projekt mit einer echten Abhaengigkeit (is-number, aus
# der npm-Registry - der Test braucht also Netz) und einem eigenen Store im
# temporaeren Verzeichnis. Die Erstinstallation laeuft absichtlich mit
# package-import-method=hardlink - so sah der Server bis zum 22.09. aus.
# Danach steht die .npmrc des Repos (copy) im Projekt, und Block 4b muss
# daraus eigene Inodes machen.
#
# WAS HIER NICHT GEPRUEFT WERDEN KANN:
#   - chgrp auf die Gruppe hideandseek und runuser als Dienstbenutzer. Der Test
#     laeuft ohne root; er setzt DIENST_BENUTZER/DIENST_GRUPPE auf den eigenen
#     Benutzer und die eigene Gruppe. Der Lesbarkeitszaun wird mit einer
#     Datei geprueft, der der eigene Benutzer das Leserecht entzogen bekommt.
#   - der Lauf von deploy.sh als Ganzes.

set -uo pipefail

FEHLER=0
HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$HIER/../deploy.sh"
NPMRC="$HIER/../../.npmrc"

TMPDIR=$(mktemp -d) || { echo "FEHLER: mktemp -d fehlgeschlagen." >&2; exit 1; }
aufraeumen() { chmod -R u+rwX "$TMPDIR" 2>/dev/null; rm -rf "$TMPDIR"; }
trap aufraeumen EXIT

ok()  { echo "  OK: $*"; }
nok() { echo "  FEHLER: $*" >&2; FEHLER=$((FEHLER + 1)); }

block_4b() {
    awk '/^# ── 4b\. /,/^# ── 4b Ende/' "$DEPLOY"
}

linkzahl() {
    if stat -c %h "$1" >/dev/null 2>&1; then stat -c %h "$1"; else stat -f %l "$1"; fi
}

# Fuehrt Block 4b in einer Subshell aus, mit fehler()/log() wie in deploy.sh.
lauf_4b() {
    local projekt=$1
    (
        set -euo pipefail
        PROJEKT="$projekt"
        DIENST_BENUTZER="$(id -un)"
        DIENST_GRUPPE="$(id -gn)"
        log() { printf '[test] %s\n' "$*"; }
        fehler() { printf '[test] FEHLER: %s\n' "$*" >&2; exit 1; }
        eval "$(block_4b)"
    )
}

echo "== Vorbedingungen =="
# Block 4b nutzt find -readable (GNU). Auf dem Mac gibt es nur BSD-find; dort
# laeuft der Test im Container:
#   docker run --rm -v "$PWD":/repo:ro -w /repo node:22 bash -c \
#     'corepack enable && useradd -m t && su t -c "bash scripts/test/eigene-inodes.sh"'
# Als root taugt der Test nicht: root liest auch Dateien mit Modus 000, und
# Nachweis 4 waere wertlos.
find --version 2>/dev/null | grep -q GNU || { echo "FEHLER: braucht GNU find (siehe Kommentar)." >&2; exit 1; }
[ "$(id -u)" -ne 0 ] || { echo "FEHLER: nicht als root ausfuehren (siehe Kommentar)." >&2; exit 1; }
[ -n "$(block_4b)" ] && ok "Block 4b in deploy.sh gefunden" \
    || nok "Block 4b fehlt in deploy.sh (Marker '# ── 4b. ' bis '# ── 4b Ende')"
grep -qx 'package-import-method=copy' "$NPMRC" 2>/dev/null \
    && ok ".npmrc im Repo setzt package-import-method=copy" \
    || nok ".npmrc im Repo setzt package-import-method=copy nicht"

# ══ Wegwerf-Projekt, installiert wie bisher auf dem Server (harte Links) ══════
P="$TMPDIR/projekt"
STORE="$TMPDIR/store"
mkdir -p "$P"
echo '{"name":"t","version":"1.0.0","private":true,"dependencies":{"is-number":"7.0.0"}}' > "$P/package.json"
printf 'store-dir=%s\npackage-import-method=hardlink\n' "$STORE" > "$P/.npmrc"
( cd "$P" && pnpm install --silent ) || { echo "FEHLER: Erstinstallation gescheitert (Netz?)." >&2; exit 1; }
DATEI=$(find "$P/node_modules/.pnpm" -path '*is-number/package.json' | head -1)
[ "$(linkzahl "$DATEI")" -gt 1 ] && ok "Ausgangslage: Datei teilt ihren Inode mit dem Store" \
    || nok "Ausgangslage nicht hergestellt: $(linkzahl "$DATEI") Link(s)"

# Jetzt die Repo-Einstellung, nur store-dir bleibt testlokal.
{ printf 'store-dir=%s\n' "$STORE"; cat "$NPMRC"; } > "$P/.npmrc"

echo "== 1. Block 4b macht aus geteilten Inodes eigene =="
( cd "$P" && pnpm install --frozen-lockfile --silent )
if lauf_4b "$P" >"$TMPDIR/lauf1.log" 2>&1; then
    ok "Block 4b endet mit 0"
else
    nok "Block 4b bricht ab:"; sed 's/^/    /' "$TMPDIR/lauf1.log" >&2
fi
DATEI=$(find "$P/node_modules/.pnpm" -path '*is-number/package.json' | head -1)
[ "$(linkzahl "$DATEI")" -eq 1 ] && ok "Datei hat danach einen eigenen Inode" \
    || nok "Datei teilt ihren Inode weiter ($(linkzahl "$DATEI") Links)"
GETEILT=$(find "$P/node_modules" -type f -links +1 | wc -l | tr -d ' ')
[ "$GETEILT" = "0" ] && ok "keine Datei unter node_modules mit mehr als einem Link" \
    || nok "$GETEILT Dateien unter node_modules mit mehr als einem Link"

echo "== 2. Gegenprobe: Rechte am Store aendern node_modules nicht mehr =="
modus() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
MODUS_VORHER=$(modus "$DATEI")
chmod -R go= "$STORE"
MODUS_NACHHER=$(modus "$DATEI")
[ "$MODUS_VORHER" = "$MODUS_NACHHER" ] \
    && ok "chmod go= auf den Store laesst node_modules unberuehrt ($MODUS_NACHHER)" \
    || nok "chmod auf den Store hat node_modules getroffen ($MODUS_VORHER -> $MODUS_NACHHER)"
chmod -R u+rwX,go+rX "$STORE"

echo "== 3. Zweiter Lauf ohne Befund bleibt still und gruen =="
if lauf_4b "$P" >"$TMPDIR/lauf2.log" 2>&1; then
    ok "zweiter Lauf endet mit 0"
    grep -Eq -- '--force|neu aufgebaut' "$TMPDIR/lauf2.log" && nok "zweiter Lauf hat trotzdem neu installiert" \
        || ok "zweiter Lauf installiert nicht erneut"
else
    nok "zweiter Lauf bricht ab:"; sed 's/^/    /' "$TMPDIR/lauf2.log" >&2
fi

echo "== 3b. Harter Link innerhalb von node_modules ist kein Befund =="
# esbuild legt bei der Installation selbst einen harten Link zwischen
# esbuild/bin/esbuild und @esbuild/linux-x64/bin/esbuild an. Das teilt mit
# niemandem ausserhalb etwas und darf weder Neuinstallation noch Abbruch
# ausloesen (so auf dem Server am 22.09.2026, 15:53 UTC).
INNEN="$(dirname "$DATEI")/innen-link"
ln "$DATEI" "$INNEN"
if lauf_4b "$P" >"$TMPDIR/lauf2b.log" 2>&1; then
    ok "Block 4b endet mit 0"
    grep -Eq -- '--force|neu aufgebaut' "$TMPDIR/lauf2b.log" && nok "Block 4b hat wegen eines inneren Links neu installiert" \
        || ok "kein Neuaufbau wegen eines inneren Links"
else
    nok "Block 4b bricht wegen eines inneren Links ab:"; sed 's/^/    /' "$TMPDIR/lauf2b.log" >&2
fi
rm -f "$INNEN"

echo "== 3c. Verwaister Paketordner aus einem alten Lockfile, hart auf den Store verlinkt =="
# Auf dem Server lagen 42 solcher Ordner (z. B. astro@..._yaml@2.7.0) mit
# 3.140 Inodes, die sie mit /opt/turflock teilten. pnpm kennt sie nicht mehr
# und raeumt sie auch mit --force nicht ab.
STOREDATEI=$(find "$STORE" -type f | head -1)
mkdir -p "$P/node_modules/.pnpm/waise@0.0.1/node_modules/waise"
ln "$STOREDATEI" "$P/node_modules/.pnpm/waise@0.0.1/node_modules/waise/index.js"
if lauf_4b "$P" >"$TMPDIR/lauf2c.log" 2>&1; then
    ok "Block 4b endet mit 0"
else
    nok "Block 4b bricht bei einer Waise ab:"; sed 's/^/    /' "$TMPDIR/lauf2c.log" >&2
fi
[ ! -e "$P/node_modules/.pnpm/waise@0.0.1" ] && ok "die Waise ist weg" || nok "die Waise liegt noch da"
[ -e "$P/node_modules/is-number/package.json" ] && ok "die echte Abhaengigkeit ist wieder installiert" \
    || nok "is-number fehlt nach dem Neuaufbau"
DATEI=$(find "$P/node_modules/.pnpm" -path '*is-number/package.json' | head -1)
GETEILT=$(find "$P/node_modules" -type f -links +1 | wc -l | tr -d ' ')
[ "$GETEILT" = "0" ] && ok "danach keine Datei mit mehr als einem Link" \
    || nok "danach $GETEILT Dateien mit mehr als einem Link"

echo "== 4. Lesbarkeitszaun bricht ab, bevor irgendetwas neu startet =="
chmod 000 "$DATEI"
if lauf_4b "$P" >"$TMPDIR/lauf3.log" 2>&1; then
    # chgrp/chmod g+rX im Block stellen Gruppenrechte her; der Besitzer
    # (wir) bleibt ohne u+r - fuer den eigenen Benutzer also unlesbar.
    nok "Block 4b laesst eine unlesbare Datei durch"
else
    grep -q 'nicht lesen' "$TMPDIR/lauf3.log" && ok "Block 4b bricht mit Meldung ab" \
        || { nok "Block 4b bricht ab, aber ohne die erwartete Meldung:"; sed 's/^/    /' "$TMPDIR/lauf3.log" >&2; }
fi
chmod 644 "$DATEI"

echo
if [ "$FEHLER" -eq 0 ]; then echo "Alle Nachweise gruen."; else echo "$FEHLER Nachweis(e) rot." >&2; fi
exit "$FEHLER"
