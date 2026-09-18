#!/usr/bin/env bash
# Nachweise fuer Befund K1 der Abschlusspruefung: der Server rollt den Commit
# aus, der gruen geworden ist, nicht die jeweilige Spitze von origin/master.
# Laeuft ohne Server: origin und Arbeitskopie sind Wegwerf-Repositories in
# einem temporaeren Verzeichnis.
#
# WICHTIG ZUR METHODE: Dieses Skript schreibt die zu pruefende Logik NICHT
# nach. Es schneidet Schritt 3 mit awk aus scripts/deploy.sh heraus und fuehrt
# genau diesen Text aus. Aendert sich deploy.sh, aendert sich damit auch das,
# was hier laeuft - eine Attrappe der Logik wuerde dagegen auch dann noch
# gruen bleiben, wenn deploy.sh kaputt ist.
#
# WAS HIER NICHT GEPRUEFT WERDEN KANN (keine Behauptung dazu weiter unten):
#   - dass sshd SSH_ORIGINAL_COMMAND wirklich setzt, wenn das erzwungene
#     Kommando in ~deploy/.ssh/authorized_keys greift. Hier wird die Variable
#     von Hand gesetzt.
#   - dass `sudo --preserve-env=...,SSH_ORIGINAL_COMMAND` die Variable auf dem
#     Ziel durchreicht. Ohne SETENV in der sudoers-Regel kann sudo sie
#     verwerfen, und dann faellt die Strecke still auf den alten Weg zurueck.
#     Hier wird nur per grep geprueft, dass die Variable in der
#     --preserve-env-Liste steht. Der Nachweis gehoert auf den Server: im
#     Actions-Protokoll muss die Zeile "Stand aus Actions: <sha>" stehen und
#     NICHT "Kein Stand mitgegeben (Handbetrieb)".
#   - der Lauf von deploy.sh als Ganzes.

set -uo pipefail

FEHLER=0
HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$HIER/../deploy.sh"

TMPDIR=$(mktemp -d) || { echo "FEHLER: mktemp -d fehlgeschlagen." >&2; exit 1; }
aufraeumen() { rm -rf "$TMPDIR"; }
trap aufraeumen EXIT

[ -f "$DEPLOY" ] || { echo "FEHLER: $DEPLOY nicht gefunden." >&2; exit 1; }

ok()   { echo "  OK: $*"; }
nok()  { echo "  FEHLER: $*" >&2; FEHLER=$((FEHLER + 1)); }
info() { echo "  INFO: $*"; }

# Schneidet Schritt 3 aus deploy.sh heraus - von der Zeile, die
# SSH_ORIGINAL_COMMAND einliest, bis zur Protokollzeile "Stand: ...".
block_schritt3() {
    awk '/^ZIEL_COMMIT=/,/^log "Stand: /' "$DEPLOY"
}

# ══ Wegwerf-Repositories ════════════════════════════════════════════════════
ORIGIN="$TMPDIR/origin.git"
PROJEKT="$TMPDIR/projekt"
QUELLE="$TMPDIR/quelle"

git -c init.defaultBranch=master init -q --bare "$ORIGIN" || exit 1
git -c init.defaultBranch=master init -q "$QUELLE" || exit 1
git -C "$QUELLE" config user.email test@example.invalid
git -C "$QUELLE" config user.name Test
for text in eins zwei drei; do
    echo "$text" >> "$QUELLE/datei"
    git -C "$QUELLE" add datei
    git -C "$QUELLE" commit -q -m "$text"
done
git -C "$QUELLE" remote add origin "$ORIGIN"
git -C "$QUELLE" push -q origin master

git clone -q "$ORIGIN" "$PROJEKT" || exit 1
git -C "$PROJEKT" config user.email test@example.invalid
git -C "$PROJEKT" config user.name Test

C3=$(git -C "$PROJEKT" rev-parse HEAD)          # Spitze von origin/master
C2=$(git -C "$PROJEKT" rev-parse HEAD~1)        # aelter, liegt auf master
C1=$(git -C "$PROJEKT" rev-parse HEAD~2)        # Startpunkt jedes Laufs

# Ein gueltiger Commit, den es lokal gibt, der aber NICHT auf origin/master
# liegt - der Fall, gegen den der Zaun gebaut ist.
git -C "$PROJEKT" checkout -q -b nebenzweig
echo nebenbei >> "$PROJEKT/datei"
git -C "$PROJEKT" commit -q -am nebenbei
NEBEN=$(git -C "$PROJEKT" rev-parse HEAD)
git -C "$PROJEKT" checkout -q master

# Ein Commit, den es nirgends gibt. Form richtig, Objekt fehlt.
NIRGENDS=ffffffffffffffffffffffffffffffffffffffff

SKRIPT="$TMPDIR/schritt3.sh"
{
    echo 'set -euo pipefail'
    printf 'PROJEKT=%q\n' "$PROJEKT"
    echo 'BRANCH=master'
    echo 'log() { printf "LOG: %s\n" "$*"; }'
    echo 'fehler() { printf "FEHLER: %s\n" "$*" >&2; exit 1; }'
    block_schritt3
} > "$SKRIPT"

zeilen=$(block_schritt3 | wc -l | tr -d ' ')
[ "$zeilen" -gt 20 ] \
    || { echo "FEHLER: Schritt 3 liess sich nicht aus deploy.sh schneiden ($zeilen Zeilen)." >&2; exit 1; }
info "Schritt 3 aus deploy.sh geschnitten: $zeilen Zeilen."
echo

LAUF_CODE=0
LAUF_AUS=""
# $1 = Wert fuer SSH_ORIGINAL_COMMAND, "__ungesetzt__" laesst die Variable weg.
lauf() {
    git -C "$PROJEKT" reset -q --hard "$C1"
    if [ "$1" = "__ungesetzt__" ]; then
        LAUF_AUS=$(env -u SSH_ORIGINAL_COMMAND bash "$SKRIPT" 2>&1)
    else
        LAUF_AUS=$(env SSH_ORIGINAL_COMMAND="$1" bash "$SKRIPT" 2>&1)
    fi
    LAUF_CODE=$?
}

kopf() { git -C "$PROJEKT" rev-parse HEAD; }

# ══ Angenommen wird nur, was die Form erfuellt und auf master liegt ═════════
teste_annahme() {
    echo "── Angenommene Staende ──"

    lauf "$C3"
    if [ "$LAUF_CODE" -eq 0 ] && [ "$(kopf)" = "$C3" ]; then
        ok "40 Hex, Spitze von origin/master: angenommen, HEAD steht auf $C3."
    else
        nok "40 Hex (Spitze) wurde nicht ausgerollt (Exit $LAUF_CODE, HEAD $(kopf))."
        echo "$LAUF_AUS" | sed 's/^/      /'
    fi
    case "$LAUF_AUS" in
        *"Stand aus Actions:"*) ok "Protokoll nennt den Weg: 'Stand aus Actions'." ;;
        *) nok "Protokoll sagt nicht, dass der Stand mitgegeben wurde." ;;
    esac

    lauf "$C2"
    if [ "$LAUF_CODE" -eq 0 ] && [ "$(kopf)" = "$C2" ]; then
        ok "40 Hex, aelterer Commit auf master: angenommen (HEAD $C2)."
        info "Der Zaun laesst jeden Commit durch, der auf master liegt - auch einen alten."
        info "Das ist Absicht: er begrenzt WAS ausrollbar ist, nicht WANN."
    else
        nok "Aelterer Commit auf master wurde abgelehnt (Exit $LAUF_CODE)."
    fi

    lauf "__ungesetzt__"
    if [ "$LAUF_CODE" -eq 0 ] && [ "$(kopf)" = "$C3" ]; then
        ok "Ohne SSH_ORIGINAL_COMMAND: alter Weg, Spitze von origin/master ($C3)."
    else
        nok "Handbetrieb ohne Variable ging schief (Exit $LAUF_CODE, HEAD $(kopf))."
        echo "$LAUF_AUS" | sed 's/^/      /'
    fi
    case "$LAUF_AUS" in
        *"Kein Stand mitgegeben (Handbetrieb)"*) ok "Protokoll nennt den Weg: Handbetrieb." ;;
        *) nok "Protokoll sagt nicht, dass kein Stand mitgegeben wurde." ;;
    esac

    lauf ""
    if [ "$LAUF_CODE" -eq 0 ] && [ "$(kopf)" = "$C3" ]; then
        ok "Leere Variable wird wie 'nicht gesetzt' behandelt."
    else
        nok "Leere Variable ging schief (Exit $LAUF_CODE, HEAD $(kopf))."
    fi
    echo
}

# ══ Abgelehnt wird alles andere ═════════════════════════════════════════════
abgelehnt() {
    local name="$1" wert="$2"
    lauf "$wert"
    if [ "$LAUF_CODE" -ne 0 ] && [ "$(kopf)" = "$C1" ]; then
        ok "$name: abgelehnt (Exit $LAUF_CODE), HEAD unveraendert."
    else
        nok "$name: NICHT abgelehnt (Exit $LAUF_CODE, HEAD $(kopf))."
    fi
}

teste_ablehnung() {
    echo "── Abgelehnte Staende ──"
    local kurz="${C3:0:39}"
    abgelehnt "39 Zeichen"            "$kurz"
    abgelehnt "41 Zeichen"            "${C3}a"
    abgelehnt "Grossbuchstaben"       "$(printf '%s' "$C3" | tr 'a-f' 'A-F')"
    abgelehnt "Branch-Name 'master'"  "master"
    abgelehnt "leere Zeichenkette mit Leerzeichen" "   "
    abgelehnt "Zeilenumbruch hinter gueltigem Hex" "$(printf '%s\nmaster' "$C3")"
    abgelehnt "gueltiger Commit, nicht auf master" "$NEBEN"
    abgelehnt "40 Hex, Objekt gibt es nicht"       "$NIRGENDS"
    echo
}

# ══ Der Inhalt wird nie ausgefuehrt ═════════════════════════════════════════
teste_kein_eval() {
    echo "── Der Inhalt wird nicht ausgefuehrt ──"
    local beute="$TMPDIR/beute"

    abgelehnt "abc; rm -rf /  (hier: abc; touch ...)" "abc; touch $beute"
    [ -e "$beute" ] && nok "Das angehaengte Kommando wurde AUSGEFUEHRT." \
                    || ok "Das angehaengte Kommando wurde nicht ausgefuehrt."
    case "$LAUF_AUS" in
        *"; touch"*) nok "Die Fehlermeldung gibt den Wert ungefiltert ins Protokoll." ;;
        *) ok "Die Fehlermeldung gibt den Wert nur entschaerft ins Protokoll." ;;
    esac

    abgelehnt "Kommandosubstitution im Wert" "\$(touch $beute)"
    [ -e "$beute" ] && nok "Die Kommandosubstitution wurde AUSGEFUEHRT." \
                    || ok "Die Kommandosubstitution wurde nicht ausgefuehrt."

    abgelehnt "Pfadmuster im Wert" "../*"
    echo
}

# ══ Was nur gelesen, nicht gefahren werden kann ═════════════════════════════
teste_quelltext() {
    echo "── Quelltext-Pruefungen ──"

    if grep -q 'preserve-env=.*SSH_ORIGINAL_COMMAND' "$DEPLOY"; then
        ok "SSH_ORIGINAL_COMMAND steht in der --preserve-env-Liste."
    else
        nok "SSH_ORIGINAL_COMMAND fehlt in --preserve-env - die Variable waere nach dem sudo-Selbstaufruf weg."
    fi
    info "Ob sudo sie auf dem Ziel wirklich durchreicht, zeigt erst der Server."

    # Kommentarzeilen raus, sonst schlaegt der Kommentar an, der das eval
    # gerade ausschliesst.
    if grep -vE '^[[:space:]]*#' "$DEPLOY" \
        | grep -qE '(^|[^[:alnum:]_])eval([^[:alnum:]_]|$)'; then
        nok "deploy.sh enthaelt ein eval."
    else
        ok "Kein eval in deploy.sh (Kommentarzeilen ausgenommen)."
    fi

    if grep -q 'merge-base --is-ancestor "\$ZIEL_COMMIT" "origin/\$BRANCH"' "$DEPLOY"; then
        ok "Der Zaun steht als merge-base --is-ancestor gegen origin/\$BRANCH im Skript."
    else
        nok "Die Vorfahren-Pruefung gegen origin/\$BRANCH steht nicht (mehr) so im Skript."
    fi

    local ci="$HIER/../../.github/workflows/ci.yml"
    if [ -f "$ci" ] && grep -q 'deploy@.*github.sha' "$ci"; then
        ok "ci.yml gibt github.sha an den ssh-Aufruf mit."
    else
        nok "ci.yml gibt dem ssh-Aufruf keinen Commit mit."
    fi
    echo
}

echo "════ Nachweise zu K1: Bindung an den gepruefen Commit ════"
echo "  Wegwerf-origin: $ORIGIN"
echo "  Spitze C3=$C3, davor C2=$C2, Start C1=$C1, Nebenzweig=$NEBEN"
echo
teste_annahme
teste_ablehnung
teste_kein_eval
teste_quelltext

if [ "$FEHLER" -eq 0 ]; then
    echo "Alle Nachweise bestanden."
    exit 0
fi
echo "$FEHLER Nachweis(e) gescheitert." >&2
exit 1
