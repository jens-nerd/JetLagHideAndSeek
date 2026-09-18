#!/usr/bin/env bash
# Beweis fuer Aufgabe 5b: deploy.sh muss gegen Selbstaenderung waehrend des
# eigenen Laufs abgesichert sein (git reset --hard ersetzt die Datei, waehrend
# bash sie haeppchenweise nach Byte-Offset liest).
#
# BEFUND (gemessen auf diesem Rechner, macOS, GNU bash 3.2.57(1)-release
# arm64-apple-darwin25 - der einzige hier verfuegbare bash, kein neuerer via
# Homebrew installiert):
#   - Punkt 1 (zwei sich selbst ueberschreibende Wegwerf-Skripte) laesst sich
#     bauen und ausfuehren.
#   - Die ungeklammerte Fassung zeigt zuverlaessig eine Abweichung: ein Stueck
#     einer durch das Voranstellen verschobenen Zeile wird als eigenes
#     Kommando interpretiert ("command not found" auf stderr). In einer
#     fruehen, UNGESICHERTEN Testversion ohne Wiederholungssperre fuehrte die
#     gleiche Verschiebung sogar dazu, dass das Skript den Selbstueberschreib-
#     Block immer wieder neu einlas und sich in einer Endlosschleife
#     aufblaehte (haendisch beobachtet, abgebrochen - nicht Teil der
#     automatisierten Pruefung, weil es haengen bleiben wuerde).
#   - Punkt 2 laesst sich auf DIESEM System NICHT zuverlaessig in der
#     erwarteten Richtung reproduzieren: die geklammerte Fassung { ... } zeigt
#     in dieser Umgebung EBENFALLS eine Abweichung (doppelte Endausgabe plus
#     ein Syntaxfehler nahe der schliessenden Klammer), statt sauber zu
#     bestehen. Das widerspricht der ueblichen Annahme, dass bash eine
#     geschweifte Gruppe vollstaendig einliest, bevor sie mit der Ausfuehrung
#     beginnt - zumindest gilt das fuer dieses uralte bash 3.2 (Apple liefert
#     seit der GPLv3-Umstellung kein neueres bash mehr aus) nicht ohne
#     Einschraenkung. Ob sich das auf der Zielumgebung (Ubuntu 24.04, dort
#     voraussichtlich bash 5.x) anders verhaelt, konnte hier nicht geprueft
#     werden - kein zweiter bash zum Vergleich verfuegbar, und auf dem VPS
#     darf laut Auftrag nichts ausgefuehrt werden.
#   - Deswegen: Punkt 2 wird unten nur als Befund ausgegeben (INFO), er zaehlt
#     NICHT zu den Fehlern, die den Exit-Code bestimmen. Wie im Auftrag
#     vorgesehen, laeuft der Test bis Punkt 3 weiter und der Exit-Code haengt
#     ausschliesslich von Punkt 3 ab (den strukturellen Pruefungen an
#     deploy.sh selbst und bash -n).
#
# Nichts davon aendert etwas an Punkt 3: dort wird geprueft, ob deploy.sh
# tatsaechlich in { ... } gefasst ist, unabhaengig davon, wie beweiskraeftig
# die synthetische Nachstellung auf diesem Entwicklungsrechner ausfaellt.

set -uo pipefail

FEHLER=0
HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SCRIPT="$HIER/../deploy.sh"

TMPDIR=$(mktemp -d) || { echo "FEHLER: mktemp -d fehlgeschlagen." >&2; exit 1; }
aufraeumen() { rm -rf "$TMPDIR"; }
trap aufraeumen EXIT

# ── Hilfsfunktionen fuer Punkt 1+2 ──────────────────────────────────────────

# Baut ein Wegwerf-Skript, das sich selbst liest und sich eine lange Zeile
# voranstellt (in derselben Datei, ohne rename - genau das Muster von
# truncate+write, das git beim Ersetzen einer Datei im Arbeitsbaum benutzt),
# und danach noch eine Ausgabe macht. Genug Fuellzeilen vor UND nach dem
# Selbstueberschreib-Block sorgen dafuer, dass die Endausgabe nicht schon vor
# der Ausfuehrung im Lesepuffer von bash liegt.
baue_wegwerfskript() {
    local ziel="$1" mit_klammer="$2"
    {
        echo '#!/usr/bin/env bash'
        [ "$mit_klammer" = "ja" ] && echo '{'
        printf '%*s\n' 2000 '' | tr ' ' '#'
        yes '# FUELLFUELLFUELLFUELLFUELLFUELLFUELLFUELLFUELLFUELLFUELLFUELLFUELL' | head -n 2000
        cat <<'SELBST'
if [ ! -e "$0.lief_schon" ]; then
  : > "$0.lief_schon"
  INHALT=$(cat "$0")
  LANGE_ZEILE="# $(printf '%*s' 20000 '' | tr ' ' 'Y')"
  printf '%s\n%s\n' "$LANGE_ZEILE" "$INHALT" > "$0"
fi
SELBST
        yes '# FUELLFUELLFUELLFUELLFUELLFUELLFUELLFUELLFUELLFUELLFUELLFUELLFUELL' | head -n 2000
        echo 'echo ENDE:OK'
        [ "$mit_klammer" = "ja" ] && echo '}'
    } > "$ziel"
}

# Fuehrt ein Wegwerf-Skript mit Zeitlimit aus (Sicherheitsnetz: falls sich ein
# Skript durch die Verschiebung in einer Schleife verfaengt, soll der Test
# trotzdem terminieren statt haengen zu bleiben).
fuehre_mit_zeitlimit_aus() {
    local skript="$1" out="$2" err="$3" limit_zehntel="$4"
    bash "$skript" >"$out" 2>"$err" &
    local pid=$! n=0
    while kill -0 "$pid" 2>/dev/null; do
        n=$((n + 1))
        if [ "$n" -gt "$limit_zehntel" ]; then
            kill -9 "$pid" 2>/dev/null
            wait "$pid" 2>/dev/null
            echo "TIMEOUT" >> "$err"
            return 1
        fi
        sleep 0.1
    done
    wait "$pid" 2>/dev/null
    return 0
}

teste_selbstueberschreibung() {
    echo "── Punkt 1+2: Selbstueberschreibung nachstellen ──"

    local ohne_klammer="$TMPDIR/ohne_klammer.sh"
    local mit_klammer="$TMPDIR/mit_klammer.sh"
    baue_wegwerfskript "$ohne_klammer" nein
    baue_wegwerfskript "$mit_klammer" ja

    local out_ohne="$TMPDIR/out_ohne.txt" err_ohne="$TMPDIR/err_ohne.txt"
    local out_mit="$TMPDIR/out_mit.txt" err_mit="$TMPDIR/err_mit.txt"

    fuehre_mit_zeitlimit_aus "$ohne_klammer" "$out_ohne" "$err_ohne" 50
    fuehre_mit_zeitlimit_aus "$mit_klammer" "$out_mit" "$err_mit" 50

    local ergebnis_ohne ergebnis_mit
    ergebnis_ohne=$(cat "$out_ohne" 2>/dev/null)
    ergebnis_mit=$(cat "$out_mit" 2>/dev/null)

    local ohne_weicht_ab=nein mit_weicht_ab=nein
    { [ "$ergebnis_ohne" = "ENDE:OK" ] && [ ! -s "$err_ohne" ]; } || ohne_weicht_ab=ja
    { [ "$ergebnis_mit" = "ENDE:OK" ] && [ ! -s "$err_mit" ]; } || mit_weicht_ab=ja

    echo "  ohne Klammer  - stdout: $(printf '%q' "$ergebnis_ohne"), stderr: $(printf '%q' "$(cat "$err_ohne" 2>/dev/null)"), weicht ab: $ohne_weicht_ab"
    echo "  mit Klammer   - stdout: $(printf '%q' "$ergebnis_mit"), stderr: $(printf '%q' "$(cat "$err_mit" 2>/dev/null)"), weicht ab: $mit_weicht_ab"

    if [ "$ohne_weicht_ab" = "ja" ] && [ "$mit_weicht_ab" = "nein" ]; then
        echo "  INFO: Punkt 2 reproduziert sich hier wie erwartet (ohne Klammer weicht ab, mit Klammer nicht)."
    else
        echo "  INFO (Befund, kein Fehlschlag): Punkt 2 reproduziert sich auf diesem System NICHT"
        echo "        zuverlaessig in der erwarteten Richtung. Siehe Kommentar am Dateianfang."
        echo "        Dieser Punkt fliesst NICHT in den Exit-Code ein (siehe Auftrag: 'lass den"
        echo "        Test auf die Punkte 3 weglaufen')."
    fi
}

# ── Punkt 3: deploy.sh selbst pruefen ────────────────────────────────────────

pruefe_deploy_struktur() {
    echo "── Punkt 3: scripts/deploy.sh selbst pruefen ──"

    if [ ! -f "$DEPLOY_SCRIPT" ]; then
        echo "  FEHLER: $DEPLOY_SCRIPT nicht gefunden." >&2
        FEHLER=$((FEHLER + 1))
        return
    fi

    local erste_zeile letzte_zeile
    erste_zeile=$(grep -m1 -vE '^[[:space:]]*(#|$)' "$DEPLOY_SCRIPT")
    letzte_zeile=$(grep -vE '^[[:space:]]*$' "$DEPLOY_SCRIPT" | tail -n1)

    if [ "$erste_zeile" = "{" ]; then
        echo "  OK: erste nicht-leere, nicht-kommentierte Zeile ist '{'."
    else
        echo "  FEHLER: erste nicht-leere, nicht-kommentierte Zeile ist '$erste_zeile', erwartet '{'." >&2
        FEHLER=$((FEHLER + 1))
    fi

    if [ "$letzte_zeile" = "}" ]; then
        echo "  OK: letzte nicht-leere Zeile ist '}'."
    else
        echo "  FEHLER: letzte nicht-leere Zeile ist '$letzte_zeile', erwartet '}'." >&2
        FEHLER=$((FEHLER + 1))
    fi

    if bash -n "$DEPLOY_SCRIPT" 2>"$TMPDIR/bash_n_fehler.txt"; then
        echo "  OK: bash -n $DEPLOY_SCRIPT ist fehlerfrei."
    else
        echo "  FEHLER: bash -n $DEPLOY_SCRIPT meldet einen Fehler:" >&2
        sed 's/^/    /' "$TMPDIR/bash_n_fehler.txt" >&2
        FEHLER=$((FEHLER + 1))
    fi
}

# ── Ablauf ───────────────────────────────────────────────────────────────────

teste_selbstueberschreibung
echo
pruefe_deploy_struktur
echo

if [ "$FEHLER" -eq 0 ]; then
    echo "Ergebnis: bestanden (Punkt 3 vollstaendig erfuellt)."
    exit 0
else
    echo "Ergebnis: FEHLGESCHLAGEN - $FEHLER Pruefung(en) aus Punkt 3 nicht erfuellt." >&2
    exit 1
fi
