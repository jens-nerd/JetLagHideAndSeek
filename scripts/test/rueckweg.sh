#!/usr/bin/env bash
# Nachweise fuer die Korrekturrunden A und A2 (Befunde K2, K3, W2, W3, W4 der
# Abschlusspruefung sowie die drei Luecken, die beim Pruefen von Runde A
# aufgefallen sind). Laeuft ohne Server: alle Faelle werden mit
# Wegwerf-Verzeichnissen, einer Wegwerf-SQLite-Datei und Attrappen fuer
# systemctl/chown nachgestellt.
#
# WICHTIG ZUR METHODE: Dieses Skript schreibt die zu pruefende Logik NICHT
# nach. Es schneidet die betroffenen Bloecke mit awk/grep aus
# scripts/deploy.sh heraus und fuehrt genau diesen Text aus. Aendert sich
# deploy.sh, aendert sich damit auch das, was hier laeuft - eine Attrappe der
# Logik wuerde dagegen auch dann noch gruen bleiben, wenn deploy.sh kaputt ist.
#
# WAS HIER NICHT GEPRUEFT WERDEN KANN (keine Behauptung dazu weiter unten):
#   - dass die Falle auf dem VPS bei einem echten Abriss der SSH-Sitzung
#     anspringt. Hier wird nur gemessen, dass eine Falle auf ERR allein ein
#     TERM/HUP nicht faengt und eine auf ERR INT TERM HUP es faengt, und per
#     grep geprueft, dass deploy.sh die zweite Form verwendet.
#   - dass systemctl, der Dienst, curl und die oeffentliche Gesundheitspruefung
#     sich so verhalten wie angenommen. systemctl und chown sind hier
#     Attrappen.
#   - dass rsync als root ueber /opt/hideandseek/backend/dist dieselben Rechte
#     und Eigentuemer wiederherstellt wie auf dem Server.
#   - der Lauf von deploy.sh als Ganzes. Dafuer gibt es keinen Ersatz ohne
#     Server; der Controller erprobt das dort.

set -uo pipefail

FEHLER=0
HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$HIER/../deploy.sh"

TMPDIR=$(mktemp -d) || { echo "FEHLER: mktemp -d fehlgeschlagen." >&2; exit 1; }
aufraeumen() { rm -rf "$TMPDIR"; }
trap aufraeumen EXIT

[ -f "$DEPLOY" ] || { echo "FEHLER: $DEPLOY nicht gefunden." >&2; exit 1; }

ok()    { echo "  OK: $*"; }
nok()   { echo "  FEHLER: $*" >&2; FEHLER=$((FEHLER + 1)); }
info()  { echo "  INFO: $*"; }

# Schneidet einen Block aus deploy.sh heraus.
block_pruefung_sicherung() {
    awk '/^sqlite3 "\$DB_SICHERUNG" "pragma integrity_check/,/Sicherung passt nicht zur Datenbank/' "$DEPLOY"
}
block_rueckweg_db() {
    awk '/^rueckweg_db\(\) \{$/,/^\}$/' "$DEPLOY"
}
block_backend_zurueck() {
    awk '/^backend_dist_zurueck\(\) \{$/,/^\}$/' "$DEPLOY"
}
zeile_bau_falle() {
    grep -m1 'Backend-Bau abgebrochen' "$DEPLOY"
}

# ══ W3: die Sicherungspruefung prueft den Inhalt ════════════════════════════
# Befund: `pragma integrity_check` beantwortet nur "ist das eine gueltige
# SQLite-Datei". Der Pruefer hat gemessen, dass eine 0-Byte-Datei und ein
# abgeschnittener Torso beide `ok` liefern. Da rueckweg_db diese Sicherung
# ungeprueft ueber die Produktionsdatenbank kopiert, muss die Pruefung mehr
# koennen.

teste_w3() {
    echo "── W3: Pruefung der Datenbanksicherung ──"

    local quelle="$TMPDIR/quelle.db"
    sqlite3 "$quelle" \
        "create table teams(id integer primary key, name text);
         create table spiele(id integer primary key, team integer);
         create table fragen(id integer primary key, text text);
         insert into teams(name) values('rot'),('blau');" || {
        nok "Wegwerf-Datenbank liess sich nicht anlegen."; return; }

    local leer="$TMPDIR/leer.sqlite" torso="$TMPDIR/torso.sqlite" gut="$TMPDIR/gut.sqlite"
    : > "$leer"
    head -c 512 "$quelle" > "$torso"
    sqlite3 "file:$quelle?mode=ro" ".backup '$gut'" || {
        nok ".backup der Wegwerf-Datenbank schlug fehl."; return; }

    echo "  Groessen: quelle=$(wc -c < "$quelle" | tr -d ' ') B, gut=$(wc -c < "$gut" | tr -d ' ') B, torso=$(wc -c < "$torso" | tr -d ' ') B, leer=$(wc -c < "$leer" | tr -d ' ') B"

    # Erst das, was der Pruefer behauptet hat, hier nachmessen: was sagt
    # integrity_check allein zu den beiden untauglichen Dateien?
    local datei antwort code
    for datei in "$leer" "$torso"; do
        antwort=$(sqlite3 "$datei" "pragma integrity_check;" 2>&1); code=$?
        info "integrity_check auf $(basename "$datei"): '$(printf '%s' "$antwort" | tr '\n' ' ')' (Exitcode $code)"
    done
    info "Der Pruefer hat fuer seinen 512-B-Torso einer 176-KB-Datenbank 'ok' gemessen."
    info "      Auf dieser Maschine faellt der Torso schon durch integrity_check - er"
    info "      haengt vom Seitenlayout ab. Die leere Datei liefert hier wie dort 'ok'"
    info "      und wird nur von der neuen Pruefung gefangen."

    # Und jetzt der Block aus deploy.sh, unveraendert, gegen alle drei Faelle.
    laeuft_pruefung_durch() {
        (
            set -euo pipefail
            DB="$quelle"
            DB_SICHERUNG="$1"
            log() { printf '%s\n' "$*"; }
            fehler() { printf 'FEHLER: %s\n' "$*" >&2; exit 1; }
            eval "$(block_pruefung_sicherung)"
        ) >"$TMPDIR/w3.out" 2>&1
    }

    if laeuft_pruefung_durch "$gut"; then
        ok "getreue Sicherung wird angenommen."
    else
        nok "getreue Sicherung wurde abgelehnt. Ausgabe:"; sed 's/^/    /' "$TMPDIR/w3.out" >&2
    fi

    if laeuft_pruefung_durch "$leer"; then
        nok "leere Sicherung wurde ANGENOMMEN - das ist der Befund W3."
    else
        ok "leere Sicherung wird abgelehnt: $(tail -1 "$TMPDIR/w3.out")"
    fi

    if laeuft_pruefung_durch "$torso"; then
        nok "abgeschnittene Sicherung wurde ANGENOMMEN - das ist der Befund W3."
    else
        ok "abgeschnittene Sicherung wird abgelehnt: $(tail -1 "$TMPDIR/w3.out")"
    fi
}

# ══ W4: kein Loeschen des WAL nach gescheitertem Zurueckkopieren ════════════
# Befund: nach einem gescheiterten `cp -a` lief rueckweg_db unveraendert
# weiter - rm -f der WAL-Dateien, systemctl start, und die Schlussmeldung
# "Datenbank zurueckgespielt, Dienst laeuft".

# Baut eine Umgebung mit Datenbank, -wal und -shm und laesst rueckweg_db aus
# deploy.sh darin laufen. $1 = Pfad der Sicherung (existiert nicht -> cp
# scheitert). Ausgabe landet in $TMPDIR/w4.out, die Aufrufe der
# systemctl-Attrappe in $TMPDIR/w4.systemctl.
fahre_rueckweg_db() {
    local sicherung="$1" arbeitsverzeichnis="$TMPDIR/w4"
    rm -rf "$arbeitsverzeichnis"
    mkdir -p "$arbeitsverzeichnis/backend/dist" "$arbeitsverzeichnis/backups"
    echo "DATENBANK" > "$arbeitsverzeichnis/db.sqlite"
    echo "WAL-INHALT-NUR-HIER" > "$arbeitsverzeichnis/db.sqlite-wal"
    echo "SHM" > "$arbeitsverzeichnis/db.sqlite-shm"
    # Backend-Stand wie nach einem gelungenen Bau: die Sicherung traegt ALT,
    # backend/dist traegt NEU - mit gleicher Groesse und gleichem Zeitstempel,
    # damit auch hier nichts an rsyncs Schnellvergleich haengenbleibt.
    echo "ALT" > "$arbeitsverzeichnis/backend/dist/index.js"
    cp -a "$arbeitsverzeichnis/backend/dist" "$arbeitsverzeichnis/backups/backend-20260918-120000"
    echo "NEU" > "$arbeitsverzeichnis/backend/dist/index.js"
    touch -r "$arbeitsverzeichnis/backups/backend-20260918-120000/index.js" \
             "$arbeitsverzeichnis/backend/dist/index.js"
    : > "$TMPDIR/w4.systemctl"
    (
        set -uo pipefail
        PROJEKT="$arbeitsverzeichnis"
        DB="$arbeitsverzeichnis/db.sqlite"
        DB_SICHERUNG="$sicherung"
        BACKEND_SICHERUNG="$arbeitsverzeichnis/backups/backend-20260918-120000"
        BACKEND_ZURUECKSTELLEN=1
        DIENST=hideandseek-backend
        log() { printf '%s\n' "$*"; }
        # Attrappen. systemctl schreibt mit, was von ihm verlangt wurde, und
        # meldet sich zusaetzlich im Protokoll - nur so ist die Reihenfolge
        # gegen das Zurueckspielen von backend/dist pruefbar. is-active meldet
        # "laeuft" nur, wenn vorher start kam.
        systemctl() {
            case "$1" in
                is-active) grep -q '^start$' "$TMPDIR/w4.systemctl" ;;
                *) echo "SYSTEMCTL $1"; echo "$1" >> "$TMPDIR/w4.systemctl" ;;
            esac
        }
        chown() { :; }
        eval "$(block_backend_zurueck)"
        eval "$(block_rueckweg_db)"
        rueckweg_db
        printf '%s\n' "$RUECKWEG_DB_ERGEBNIS" > "$TMPDIR/w4.ergebnis"
        printf '%s\n' "$BACKEND_ZURUECKSTELLEN" > "$TMPDIR/w4.merker"
    ) >"$TMPDIR/w4.out" 2>&1
}

teste_w4() {
    echo "── W4: rueckweg_db nach gescheitertem cp ──"

    # Fall 1: die Sicherung gibt es nicht, cp -a scheitert.
    fahre_rueckweg_db "$TMPDIR/gibt-es-nicht.sqlite"
    echo "  Protokoll (cp scheitert):"
    sed 's/^/    | /' "$TMPDIR/w4.out"

    if [ -f "$TMPDIR/w4/db.sqlite-wal" ] && [ -f "$TMPDIR/w4/db.sqlite-shm" ]; then
        ok "WAL und SHM liegen nach dem gescheiterten cp noch da."
    else
        nok "WAL oder SHM wurden trotz gescheitertem cp geloescht - Datenverlust."
    fi

    if [ "$(cat "$TMPDIR/w4/db.sqlite")" = "DATENBANK" ]; then
        ok "die Datenbankdatei ist unveraendert."
    else
        nok "die Datenbankdatei wurde angefasst."
    fi

    if grep -q '^start$' "$TMPDIR/w4.systemctl"; then
        nok "der Dienst wurde trotz gescheitertem cp gestartet."
    else
        ok "der Dienst wurde NICHT gestartet (Aufrufe: $(tr '\n' ' ' < "$TMPDIR/w4.systemctl"))."
    fi

    if grep -q 'Datenbank zurueckgespielt' "$TMPDIR/w4.out"; then
        nok "die Schlussmeldung behauptet 'Datenbank zurueckgespielt', obwohl das cp scheiterte."
    else
        ok "keine Meldung behauptet, die Datenbank sei zurueckgespielt."
    fi

    if grep -q 'GESCHEITERT' "$TMPDIR/w4.out" && grep -q 'bleibt GESTOPPT' "$TMPDIR/w4.out"; then
        ok "die Meldung benennt den Zustand: gescheitert, Dienst gestoppt."
    else
        nok "die Meldung benennt den tatsaechlichen Zustand nicht."
    fi

    if [ "$(cat "$TMPDIR/w4.ergebnis" 2>/dev/null)" = "gescheitert" ]; then
        ok "rueckweg_db meldet dem Aufrufer 'gescheitert' - die Schlussmeldung dort kann nichts anderes behaupten."
    else
        nok "rueckweg_db meldet dem Aufrufer '$(cat "$TMPDIR/w4.ergebnis" 2>/dev/null)', erwartet 'gescheitert'."
    fi

    # Fall 2: die Sicherung ist da, cp gelingt - der Normalfall muss weiterhin
    # zuende laufen, sonst hat die Korrektur den Rueckweg lahmgelegt.
    echo "SICHERUNG" > "$TMPDIR/sicherung.sqlite"
    fahre_rueckweg_db "$TMPDIR/sicherung.sqlite"
    echo "  Protokoll (cp gelingt):"
    sed 's/^/    | /' "$TMPDIR/w4.out"

    if [ ! -f "$TMPDIR/w4/db.sqlite-wal" ] && [ ! -f "$TMPDIR/w4/db.sqlite-shm" ]; then
        ok "nach gelungenem cp sind WAL und SHM entfernt."
    else
        nok "nach gelungenem cp liegen WAL/SHM noch da."
    fi
    if grep -q 'Datenbank zurueckgespielt, Dienst laeuft' "$TMPDIR/w4.out"; then
        ok "nach gelungenem cp meldet das Skript den Erfolg."
    else
        nok "nach gelungenem cp fehlt die Erfolgsmeldung."
    fi
    if [ "$(cat "$TMPDIR/w4.ergebnis" 2>/dev/null)" = "zurueckgespielt" ]; then
        ok "rueckweg_db meldet dem Aufrufer 'zurueckgespielt'."
    else
        nok "rueckweg_db meldet dem Aufrufer '$(cat "$TMPDIR/w4.ergebnis" 2>/dev/null)', erwartet 'zurueckgespielt'."
    fi

    # Runde A2, Punkt 2: die zurueckgedrehte Datenbank darf nicht neben neuem
    # Backend-Code stehenbleiben - und das Zurueckspielen muss VOR dem Start
    # passieren, sonst laeuft der Dienst kurz auf neuem Code gegen altes Schema.
    local stand_backend zeile_backend zeile_start
    stand_backend=$(cat "$TMPDIR/w4/backend/dist/index.js" 2>/dev/null)
    if [ "$stand_backend" = "ALT" ]; then
        ok "rueckweg_db hat backend/dist auf den vorigen Stand zurueckgedreht."
    else
        nok "backend/dist steht nach rueckweg_db auf '$stand_backend', erwartet 'ALT'."
    fi
    zeile_backend=$(grep -n 'Backend-Bau aus' "$TMPDIR/w4.out" | head -1 | cut -d: -f1)
    zeile_start=$(grep -n '^SYSTEMCTL start$' "$TMPDIR/w4.out" | head -1 | cut -d: -f1)
    if [ -n "$zeile_backend" ] && [ -n "$zeile_start" ] && [ "$zeile_backend" -lt "$zeile_start" ]; then
        ok "Reihenfolge stimmt: backend/dist (Zeile $zeile_backend) vor systemctl start (Zeile $zeile_start)."
    else
        nok "Reihenfolge falsch oder nicht feststellbar: backend/dist in Zeile '${zeile_backend:-?}', start in Zeile '${zeile_start:-?}'."
    fi
    if [ "$(cat "$TMPDIR/w4.merker" 2>/dev/null)" = "0" ]; then
        ok "rueckweg_db loescht die Merkvariable - fehler() stellt danach nicht ein zweites Mal zurueck."
    else
        nok "die Merkvariable steht nach rueckweg_db auf '$(cat "$TMPDIR/w4.merker" 2>/dev/null)', erwartet '0'."
    fi
}

# ══ A2-1: fehler() stellt backend/dist zurueck ══════════════════════════════
# `exit` loest keine ERR-Falle aus (weiter unten gemessen). Alle Pruefungen in
# Schritt 6 enden aber auf `|| fehler`. Ohne Merkvariable liesse ein
# durchgefallener Bau neuen Backend-Code stehen.

# $1 = Wert der Merkvariablen beim Aufruf von fehler.
fahre_fehler_mit_merker() {
    local merker="$1" wurzel="$TMPDIR/fehlerfall" skript="$TMPDIR/fehlerfall.sh"
    rm -rf "$wurzel"; mkdir -p "$wurzel/backend/dist" "$wurzel/backups"
    echo "ALT" > "$wurzel/backend/dist/index.js"
    cp -a "$wurzel/backend/dist" "$wurzel/backups/backend-20260918-120000"
    echo "NEU" > "$wurzel/backend/dist/index.js"
    touch -r "$wurzel/backups/backend-20260918-120000/index.js" "$wurzel/backend/dist/index.js"
    {
        echo '#!/usr/bin/env bash'
        echo 'set -euo pipefail'
        echo "PROJEKT='$wurzel'"
        echo "BACKEND_SICHERUNG='$wurzel/backups/backend-20260918-120000'"
        echo "BACKEND_ZURUECKSTELLEN=$merker"
        echo 'log() { printf "%s\n" "$*"; }'
        block_backend_zurueck
        awk '/^fehler\(\) \{$/,/^\}$/' "$DEPLOY"
        # Genau die Form aus Schritt 6 von deploy.sh.
        echo '[ -f "$PROJEKT/gibt-es-nicht" ] || fehler "sw.js fehlt im Bau."'
        echo 'echo "NIE ERREICHT"'
    } > "$skript"
    bash "$skript" >"$TMPDIR/fehlerfall.out" 2>&1
    echo "  Exitcode: $?"
}

teste_a2_fehler() {
    echo "── A2-1: fehler() stellt backend/dist zurueck ──"

    echo "  Merkvariable auf 1 (Fenster offen, Schritt 6):"
    fahre_fehler_mit_merker 1
    sed 's/^/    | /' "$TMPDIR/fehlerfall.out"
    if [ "$(cat "$TMPDIR/fehlerfall/backend/dist/index.js")" = "ALT" ]; then
        ok "nach dem fehler()-Abbruch steht backend/dist wieder auf dem vorigen Stand."
    else
        nok "backend/dist steht auf '$(cat "$TMPDIR/fehlerfall/backend/dist/index.js")', erwartet 'ALT'."
    fi
    if grep -q 'FEHLER: sw.js fehlt im Bau.' "$TMPDIR/fehlerfall.out"; then
        ok "die Fehlermeldung erscheint weiterhin."
    else
        nok "die Fehlermeldung fehlt."
    fi

    echo "  Merkvariable auf 0 (Fenster zu, z. B. Sperre belegt):"
    fahre_fehler_mit_merker 0
    sed 's/^/    | /' "$TMPDIR/fehlerfall.out"
    if [ "$(cat "$TMPDIR/fehlerfall/backend/dist/index.js")" = "NEU" ]; then
        ok "ausserhalb des Fensters fasst fehler() backend/dist nicht an."
    else
        nok "fehler() hat backend/dist angefasst, obwohl die Merkvariable 0 war."
    fi

    # Die Merkvariable ist nur dann eine Zusage, wenn sie im ganzen Fenster
    # steht. Hier die Gegenprobe am echten Skript: zwischen dem Setzen auf 1
    # und dem Loeschen auf 0 darf kein Abbruch ohne Netz liegen. Geprueft wird
    # die Reihenfolge der drei Marken im Text.
    local z_set z_frei z_falle
    z_set=$(grep -n '^BACKEND_ZURUECKSTELLEN=1$' "$DEPLOY" | head -1 | cut -d: -f1)
    z_frei=$(grep -n '^BACKEND_ZURUECKSTELLEN=0$' "$DEPLOY" | tail -1 | cut -d: -f1)
    z_falle=$(grep -n "^trap 'trap - ERR INT TERM HUP; log \"Unerwarteter" "$DEPLOY" | head -1 | cut -d: -f1)
    if [ -n "$z_set" ] && [ -n "$z_frei" ] && [ -n "$z_falle" ] \
       && [ "$z_set" -lt "$z_frei" ] && [ "$z_frei" -lt "$z_falle" ]; then
        ok "die Merkvariable steht von Zeile $z_set bis $z_frei, und erst danach (Zeile $z_falle) uebernimmt rueckweg_code."
    else
        nok "die Marken stehen in der falschen Reihenfolge: gesetzt $z_set, geloescht $z_frei, Falle $z_falle."
    fi
}

# ══ A2-3: der Webroot-Rueckweg darf nicht nach Zeitstempeln raten ═══════════
# Gemessen vor der Behebung: `rsync -a --delete` ueberspringt index.html und
# sw.js, wenn sie gleich gross sind und denselben Zeitstempel tragen. Genau das
# ist der Fall, den der Rueckweg treffen muss.

# Baut Webroot und Sicherung so, dass Groesse und Zeitstempel gleich sind.
baue_webroot_fall() {
    local wurzel="$1"
    rm -rf "$wurzel"; mkdir -p "$wurzel/dist"
    printf '<!doctype html><title>ALT</title>\n' > "$wurzel/dist/index.html"
    printf 'self.__WB=["ALT"];\n' > "$wurzel/dist/sw.js"
    cp -a "$wurzel/dist" "$wurzel/sicherung"
    printf '<!doctype html><title>NEU</title>\n' > "$wurzel/dist/index.html"
    printf 'self.__WB=["NEU"];\n' > "$wurzel/dist/sw.js"
    touch -r "$wurzel/sicherung/index.html" "$wurzel/dist/index.html"
    touch -r "$wurzel/sicherung/sw.js" "$wurzel/dist/sw.js"
}

teste_a2_webroot() {
    echo "── A2-3: Webroot-Rueckweg bei gleicher Groesse und Zeit ──"

    # Erst die Gegenprobe: so, wie die Zeile vor Runde A2 aussah.
    local w="$TMPDIR/webroot-kontrolle"
    baue_webroot_fall "$w"
    rsync -a --delete "$w/sicherung/" "$w/dist/"
    local kontrolle
    kontrolle=$(grep -o 'ALT\|NEU' "$w/dist/index.html" | head -1)
    if [ "$kontrolle" = "NEU" ]; then
        info "Gegenprobe (rsync -a --delete, ohne --ignore-times): index.html bleibt auf NEU."
        info "      Das ist der Befund - der Rueckweg haette genau die Datei nicht zurueckgeholt,"
        info "      auf die es ankommt."
    else
        info "Gegenprobe: rsync hat hier auch ohne --ignore-times zurueckgespielt ($kontrolle)."
        info "      Auf diesem Dateisystem reproduziert sich der Befund also nicht; die"
        info "      Pruefung unten gilt weiterhin."
    fi

    # Und jetzt die Zeile, wie sie heute in rueckweg_code steht.
    w="$TMPDIR/webroot-echt"
    baue_webroot_fall "$w"
    (
        set -uo pipefail
        PROJEKT="$w"
        DIST_SICHERUNG="$w/sicherung"
        log() { printf '%s\n' "$*"; }
        eval "$(awk '/^rueckweg_code\(\) \{$/,/^\}$/' "$DEPLOY" | grep -A1 -m1 'rsync -a --delete')"
    ) > "$TMPDIR/webroot.out" 2>&1
    local nachher_html nachher_sw
    nachher_html=$(grep -o 'ALT\|NEU' "$w/dist/index.html" | head -1)
    nachher_sw=$(grep -o 'ALT\|NEU' "$w/dist/sw.js" | head -1)
    if [ "$nachher_html" = "ALT" ] && [ "$nachher_sw" = "ALT" ]; then
        ok "die Zeile aus rueckweg_code holt index.html und sw.js zurueck."
    else
        nok "nach dem Rueckweg: index.html=$nachher_html, sw.js=$nachher_sw, erwartet beide ALT."
        sed 's/^/    | /' "$TMPDIR/webroot.out"
    fi
}

# ══ K2/K3: backend/dist wird gesichert und zurueckgespielt ══════════════════
# Befund K3: tsc schreibt direkt in backend/dist, also in die Dateien, die der
# Dienst ausfuehrt. Ein abgebrochener Bau hinterliess bisher neuen Backend-Code
# neben einer nicht migrierten Datenbank. Befund K2: der Rueckweg holte ihn
# nicht zurueck.

# Stellt den Bau nach: altes dist sichern, Falle scharfstellen, "Bau" schreibt
# neuen Stand und bricht dann ab ($1 = 'fehler' oder 'signal').
fahre_bau_mit_abbruch() {
    local art="$1" wurzel="$TMPDIR/bau" skript="$TMPDIR/bau.sh"
    rm -rf "$wurzel"; mkdir -p "$wurzel/backend/dist" "$wurzel/backups"
    echo "ALT" > "$wurzel/backend/dist/index.js"
    echo "ALT" > "$wurzel/backend/dist/nur-alt.js"
    # Eigene Datei statt Subshell: `kill -TERM $$` trifft in einer Subshell den
    # Elternprozess (bash 3.2 kennt kein BASHPID) - also dieses Testskript.
    {
        echo '#!/usr/bin/env bash'
        echo 'set -euo pipefail'
        echo "PROJEKT='$wurzel'"
        echo "BACKEND_SICHERUNG='$wurzel/backups/backend-20260918-120000'"
        echo 'log() { printf "%s\n" "$*"; }'
        block_backend_zurueck
        echo 'cp -a "$PROJEKT/backend/dist" "$BACKEND_SICHERUNG"'
        zeile_bau_falle
        # Der "Bau": schreibt neuen Stand und bricht dann ab. tsc raeumt das
        # Verzeichnis nicht auf, darum bleibt nur-alt.js liegen - genau die
        # Mischung aus alt und neu, die der Befund beschreibt.
        echo 'echo NEU > "$PROJEKT/backend/dist/index.js"'
        echo 'echo NEU > "$PROJEKT/backend/dist/nur-neu.js"'
        # Zeitstempel bewusst gleichziehen: sonst haengt dieser Nachweis daran,
        # ob Sicherung und Bau zufaellig in dieselbe Sekunde fallen. Genau so
        # ist der Fall in Runde A beim ersten Lauf aufgefallen.
        echo 'touch -r "$BACKEND_SICHERUNG/index.js" "$PROJEKT/backend/dist/index.js"'
        if [ "$art" = "signal" ]; then
            echo 'kill -TERM $$'
            echo 'sleep 5'
        else
            echo 'false'
        fi
        echo 'echo "NIE ERREICHT"'
    } > "$skript"
    bash "$skript" >"$TMPDIR/bau.out" 2>&1
    echo "  Exitcode des Laufs: $?"
}

teste_k2_k3() {
    echo "── K2/K3: backend/dist sichern und zurueckspielen ──"

    local art
    for art in fehler signal; do
        echo "  Abbruchart: $art"
        fahre_bau_mit_abbruch "$art"
        sed 's/^/    | /' "$TMPDIR/bau.out"
        local inhalt
        inhalt=$(cat "$TMPDIR/bau/backend/dist/index.js" 2>/dev/null)
        if [ "$inhalt" = "ALT" ]; then
            ok "$art: index.js steht wieder auf dem vorigen Stand."
        else
            nok "$art: index.js steht auf '$inhalt', erwartet 'ALT'."
        fi
        if [ -f "$TMPDIR/bau/backend/dist/nur-neu.js" ]; then
            nok "$art: nur-neu.js aus dem abgebrochenen Bau liegt noch in backend/dist."
        else
            ok "$art: die Datei aus dem abgebrochenen Bau ist weg."
        fi
        if [ -f "$TMPDIR/bau/backend/dist/nur-alt.js" ]; then
            ok "$art: die Datei des vorigen Baus ist wieder da."
        else
            nok "$art: die Datei des vorigen Baus fehlt."
        fi
    done

    # Der Rueckweg nach der Gesundheitspruefung: rueckweg_code muss
    # backend_dist_zurueck VOR dem Neustart aufrufen. Ein Neustart davor wuerde
    # den kaputten Backend-Bau wieder starten - das war K2.
    local vor_restart
    vor_restart=$(awk '/^rueckweg_code\(\) \{$/,/^\}$/' "$DEPLOY" \
        | grep -n 'backend_dist_zurueck\|systemctl restart' | head -2 | cut -d: -f2- | tr '\n' ' ')
    case "$vor_restart" in
        *backend_dist_zurueck*systemctl\ restart*)
            ok "rueckweg_code ruft backend_dist_zurueck vor dem Neustart auf." ;;
        *)
            nok "in rueckweg_code steht backend_dist_zurueck nicht vor dem Neustart: '$vor_restart'" ;;
    esac

    # Ausduennung: das Muster fuer backend- muss so eng sein wie die anderen.
    if grep -q '"backend-\$ZIFFER8-\$ZIFFER6"' "$DEPLOY"; then
        ok "die Ausduenn-Schleife behandelt backend-<STEMPEL> mit dem engen Ziffernmuster."
    else
        nok "die Ausduenn-Schleife behandelt backend-<STEMPEL> nicht oder zu weit."
    fi

    # Und der Gegenbeweis dazu: eine von Hand angelegte Sicherung darf das
    # Muster nicht treffen. Hier mit denselben Musterdefinitionen wie im Skript.
    (
        ZIFFER8='[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
        ZIFFER6='[0-9][0-9][0-9][0-9][0-9][0-9]'
        mkdir -p "$TMPDIR/backups"
        touch "$TMPDIR/backups/backend-20260918-120000" "$TMPDIR/backups/backend-alt" \
              "$TMPDIR/backups/backend-vor-rebuild"
        shopt -s nullglob
        treffer=("$TMPDIR/backups"/backend-$ZIFFER8-$ZIFFER6)
        printf '%s\n' "${treffer[@]}"
    ) > "$TMPDIR/muster.out"
    if [ "$(wc -l < "$TMPDIR/muster.out" | tr -d ' ')" = "1" ] \
       && grep -q 'backend-20260918-120000' "$TMPDIR/muster.out"; then
        ok "das Muster trifft nur backend-20260918-120000, nicht backend-alt oder backend-vor-rebuild."
    else
        nok "das Muster trifft die falschen Verzeichnisse: $(tr '\n' ' ' < "$TMPDIR/muster.out")"
    fi
}

# ══ W2: Fallen fuer Signale ═════════════════════════════════════════════════
# Befund: eine ERR-Falle reagiert nur auf Rueckgabewerte. Bricht die
# SSH-Sitzung waehrend des rsync --delete ab, kommt ein Signal.

teste_w2() {
    echo "── W2: ERR faengt keine Signale ──"

    # Gemessen, nicht behauptet: dasselbe Wegwerf-Skript einmal mit einer
    # Falle auf ERR allein, einmal auf ERR INT TERM HUP. Beide bekommen ein
    # TERM.
    local fallen
    for fallen in "ERR" "ERR INT TERM HUP"; do
        local skript="$TMPDIR/signal.sh"
        {
            echo '#!/usr/bin/env bash'
            echo 'set -euo pipefail'
            echo "trap 'echo GEFANGEN; exit 1' $fallen"
            echo 'kill -TERM $$'
            echo 'sleep 5'
        } > "$skript"
        local ausgabe
        ausgabe=$(bash "$skript" 2>&1)
        echo "  Falle auf '$fallen', Prozess bekommt TERM -> Ausgabe: '${ausgabe:-<nichts>}'"
        if [ "$fallen" = "ERR" ] && [ -n "$ausgabe" ]; then
            nok "unerwartet: die ERR-Falle hat auf dieser bash ein TERM gefangen."
        fi
        if [ "$fallen" != "ERR" ] && [ "$ausgabe" != "GEFANGEN" ]; then
            nok "unerwartet: die Falle auf ERR INT TERM HUP hat das TERM nicht gefangen."
        fi
    done

    # Und die Gegenprobe am echten Skript: beide Fallen und ihre Abschaltung
    # muessen dieselbe Signalliste tragen.
    local scharf entschaerft
    scharf=$(grep -c "' ERR INT TERM HUP\$" "$DEPLOY")
    entschaerft=$(grep -c '^trap - ERR INT TERM HUP' "$DEPLOY")
    if [ "$scharf" = "2" ]; then
        ok "deploy.sh stellt beide Fallen auf ERR INT TERM HUP scharf."
    else
        nok "deploy.sh hat $scharf Fallen auf ERR INT TERM HUP, erwartet 2."
    fi
    if [ "$entschaerft" = "2" ]; then
        ok "beide Fallen werden mit derselben Signalliste wieder entschaerft."
    else
        nok "es gibt $entschaerft Abschaltzeilen 'trap - ERR INT TERM HUP', erwartet 2."
    fi
    if grep -q "trap 'trap - ERR INT TERM HUP;" "$DEPLOY"; then
        ok "die Fallen raeumen sich selbst ab - keine Rekursion, kein zweiter Durchlauf."
    else
        nok "die Fallen raeumen sich nicht selbst ab."
    fi

    # Ehrlich dazugesagt, was diese Messung NICHT zeigt:
    info "nicht gezeigt: dass ein Abriss der SSH-Sitzung auf dem VPS genau HUP/TERM"
    info "      an diesen Prozess schickt und dass rueckweg_code dort durchlaeuft."
    info "      Das kann nur der Controller auf dem Server erproben."
}

# ══ Ablauf ══════════════════════════════════════════════════════════════════

echo "bash: $(bash --version | head -1)"
echo "sqlite3: $(sqlite3 --version)"
echo
teste_w3; echo
teste_w4; echo
teste_k2_k3; echo
teste_w2; echo
teste_a2_fehler; echo
teste_a2_webroot; echo

if [ "$FEHLER" -eq 0 ]; then
    echo "Ergebnis: bestanden."
    exit 0
else
    echo "Ergebnis: FEHLGESCHLAGEN - $FEHLER Pruefung(en) nicht erfuellt." >&2
    exit 1
fi
