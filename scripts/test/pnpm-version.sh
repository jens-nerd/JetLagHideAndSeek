#!/usr/bin/env bash
# Nachweise dafuer, dass ueberall dieselbe pnpm-Version laeuft.
#
# Hintergrund (22.09.2026): Das Repo legte keine Version fest. Auf dem VPS und
# auf dem Mac lag zufaellig 10.33.0, die CI installierte "version: 10", also
# irgendeine 10.x. Gemessen im Container: mit pnpm 12 erzeugte
# `pnpm install --force` keine eigenen Kopien - der Zaun in deploy.sh Block 4b
# haette den Deploy abgebrochen, statt ihn durchzulassen. Ein Sprung der
# pnpm-Version soll nicht mehr davon abhaengen, wann jemand npm -g aufruft.
#
# Der dritte Nachweis braucht Netz: Er legt ein Wegwerf-Projekt an und laesst
# pnpm sich selbst auf die festgelegte Version bringen.

set -uo pipefail

FEHLER=0
HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WURZEL="$HIER/../.."
PKG="$WURZEL/package.json"
CI="$WURZEL/.github/workflows/ci.yml"
DEPLOY="$HIER/../deploy.sh"

ok()  { echo "  OK: $*"; }
nok() { echo "  FEHLER: $*" >&2; FEHLER=$((FEHLER + 1)); }

echo "== 1. package.json legt eine genaue Version fest =="
VERSION=$(sed -n 's/.*"packageManager": *"\(pnpm@[^"]*\)".*/\1/p' "$PKG")
if [ -z "$VERSION" ]; then
    nok "packageManager fehlt in package.json"
elif printf '%s' "$VERSION" | grep -Eqx 'pnpm@[0-9]+\.[0-9]+\.[0-9]+'; then
    ok "packageManager ist $VERSION"
else
    nok "packageManager ist $VERSION, erwartet wird eine genaue Version (pnpm@X.Y.Z)"
fi

echo "== 2. Die CI nimmt diese Version, statt eine eigene zu setzen =="
# pnpm/action-setup liest packageManager aus package.json, sobald der Eingang
# "version" fehlt. Steht dort etwas anderes, laufen CI und Server auseinander.
BLOCK=$(awk '/pnpm\/action-setup/,/^$/' "$CI")
if [ -z "$BLOCK" ]; then
    nok "pnpm/action-setup nicht in ci.yml gefunden"
elif printf '%s' "$BLOCK" | grep -Eq '^ *version:'; then
    nok "ci.yml setzt bei action-setup eine eigene version: $(printf '%s' "$BLOCK" | grep -E '^ *version:' | tr -d ' ')"
else
    ok "action-setup ohne eigene version, liest also package.json"
fi

echo "== 3. pnpm bringt sich im Projekt selbst auf diese Version =="
if ! command -v pnpm >/dev/null; then
    nok "pnpm nicht im PATH"
else
    TMPDIR=$(mktemp -d) || exit 1
    trap 'rm -rf "$TMPDIR"' EXIT
    printf '{"name":"t","version":"1.0.0","private":true,"packageManager":"%s"}\n' "$VERSION" > "$TMPDIR/package.json"
    IM_PATH=$(pnpm -v 2>/dev/null)
    IM_PROJEKT=$(cd "$TMPDIR" && pnpm -v 2>/dev/null)
    ERWARTET=${VERSION#pnpm@}
    [ "$IM_PROJEKT" = "$ERWARTET" ] \
        && ok "im Projekt laeuft $IM_PROJEKT (im PATH liegt $IM_PATH)" \
        || nok "im Projekt laeuft $IM_PROJEKT statt $ERWARTET (im PATH liegt $IM_PATH)"
fi

echo "== 3b. Die Festlegung schlaegt die Version im PATH =="
# Gegenprobe: Ein Projekt, das eine ANDERE Version festlegt, muss auch diese
# bekommen. Sonst belegt Nachweis 3 nur, dass im PATH zufaellig das Richtige
# liegt.
if [ -n "${TMPDIR:-}" ] && [ -d "${TMPDIR:-}" ]; then
    ANDERE=10.20.0
    mkdir -p "$TMPDIR/andere"
    printf '{"name":"t","version":"1.0.0","private":true,"packageManager":"pnpm@%s"}\n' "$ANDERE" > "$TMPDIR/andere/package.json"
    GEMESSEN=$(cd "$TMPDIR/andere" && pnpm -v 2>/dev/null)
    [ "$GEMESSEN" = "$ANDERE" ] \
        && ok "dort laeuft $GEMESSEN, obwohl im PATH $IM_PATH liegt" \
        || nok "dort laeuft $GEMESSEN statt $ANDERE - pnpm zieht die Festlegung nicht"
fi

echo "== 4. deploy.sh ruft pnpm immer im Projektverzeichnis auf =="
# Nur dort greift die Festlegung: pnpm liest package.json des
# Arbeitsverzeichnisses. Ein Aufruf ausserhalb liefe mit der Version aus dem
# PATH - auf dem VPS eine global installierte, die niemand mitzieht.
# Kommentare und Zeichenketten fallen vorher weg, sonst zaehlen Protokoll-
# und Fehlermeldungen mit, in denen das Wort pnpm nur vorkommt.
DANEBEN=$(sed 's/#.*//; s/"[^"]*"//g' "$DEPLOY" | grep -n '\bpnpm ' | grep -v 'cd .*&& ' || true)
[ -z "$DANEBEN" ] && ok "jeder pnpm-Aufruf steht hinter cd \$PROJEKT" \
    || { nok "pnpm-Aufruf ausserhalb des Projektverzeichnisses:"; printf '    %s\n' "$DANEBEN" >&2; }

echo
if [ "$FEHLER" -eq 0 ]; then echo "Alle Nachweise gruen."; else echo "$FEHLER Nachweis(e) rot." >&2; fi
exit "$FEHLER"
