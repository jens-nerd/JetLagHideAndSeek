# Deploy auf den VPS

## Der Regelweg

Ein Push auf `master` reicht. GitHub Actions fährt zuerst die Prüfung (`.github/workflows/ci.yml`, Job `test`) und startet den Job `deploy` nur, wenn diese Prüfung grün ist.

Der Deploy-Job baut nichts selbst und berührt den Server nicht direkt. Er verbindet sich per SSH mit einem Schlüssel, dem in `~deploy/.ssh/authorized_keys` ein erzwungenes Kommando zugewiesen ist: Dieser Schlüssel kann ausschließlich `/opt/hideandseek/scripts/deploy.sh` starten, sonst nichts.

Welcher Stand ausgerollt wird, gibt der Job mit: Der `ssh`-Aufruf hängt den Commit an, der die Prüfung gerade bestanden hat. Das erzwungene Kommando verwirft ihn als Kommando und reicht ihn in `SSH_ORIGINAL_COMMAND` durch. `deploy.sh` nimmt ihn nur an, wenn er aus genau 40 Zeichen `0-9a-f` besteht, und rollt ihn nur aus, wenn er nach dem `git fetch` als Vorfahr von `origin/master` dasteht. Das ist der Zaun: Wer den Deploy-Schlüssel hat, bekommt damit keinen selbst gebauten Stand auf den Server, sondern höchstens einen, der ohnehin schon auf `master` liegt.

Ohne diese Angabe zieht das Skript wie bisher die Spitze von `origin/master`. Im Protokoll steht deshalb entweder `Stand aus Actions: <sha>` oder `Kein Stand mitgegeben (Handbetrieb)`. Steht die zweite Zeile in einem Actions-Lauf, ist die Variable unterwegs verloren gegangen.

Bei einem Pull Request läuft nur der Job `test`. Der Job `deploy` startet gar nicht erst.

## Der Handbetrieb

Für den Notfall, wenn Actions nicht erreichbar ist oder sofortiges Eingreifen nötig ist:

```bash
sudo /opt/hideandseek/scripts/deploy.sh
```

Das ruft dasselbe Skript auf wie der Deploy-Job. Ein Unterschied bleibt: Ohne mitgegebenen Commit rollt der Handbetrieb die Spitze von `origin/master` aus, nicht einen bestimmten geprüften Stand.

## Wo was liegt

| | Pfad |
|---|---|
| Repository-Klon | `/opt/hideandseek` |
| Webroot (nginx) | `/opt/hideandseek/dist` |
| Backend-Bau | `/opt/hideandseek/backend/dist`, der Dienst führt `index.js` von dort aus |
| Backend-Dienst | `hideandseek-backend.service` (systemd), Port 3001 |
| Datenbank | `/opt/hideandseek/backend/hideandseek.db`, gehört `hideandseek:hideandseek` |
| Sicherungen | `/opt/hideandseek/backups` |
| Uploads | `/opt/hideandseek/uploads` (nginx liefert von dort aus) |
| nginx-Site | `/etc/nginx/sites-available/hideandseek.vielhaben.com` |
| Umgebung für den Frontend-Build | `/opt/hideandseek/.env`, gitignored, bleibt bei `git reset` liegen |
| Geheimnisse fürs Backend | `/etc/hideandseek-backend.env`, `600 root:root`, außerhalb des Projekts |

Zugang über `ssh deploy@<vps>`, der Benutzer hat passwortloses `sudo`.

## Eingriffe von Hand: kein `rsync -a` vom Mac

Gebaut wird auf dem Server. Wer die Strecke benutzt, kann den Fehler unten gar nicht mehr machen. Für alles, was man von Hand am Server tut, gilt er weiter: **niemals `rsync -a` vom Mac auf den Server.**

`rsync -a` überträgt Eigentümer und Gruppe numerisch. Auf dem Server gibt es die uid 502 und die Gruppe `staff` nicht, die Dateien gehören danach niemandem, den das System kennt. Bei statischen Dateien im Webroot fällt das nicht auf, weil nginx nur liest. Die SQLite-Datenbank des Backends dagegen wird damit für den Dienstbenutzer unbeschreibbar, und jede Session-Erstellung endet in einem 500er.

Im April 2026 ist genau das passiert. Aufgefallen ist es am 18.09., knapp fünf Monate später: Der Multiplayer war seit dem 23.04. tot, im Journal stand `SqliteError: attempt to write a readonly database`, und niemand hat hingesehen.

Wer trotzdem vom Mac übertragen muss: `--no-owner --no-group` mitgeben, oder direkt danach den Eigentümer geradeziehen. Der Befehl dafür steht im Abschnitt *Nach dem Deploy prüfen*.

## Die Schalter

Alle vier stehen in `scripts/deploy.sh` und werden über Umgebungsvariablen gesetzt, zum Beispiel:

```bash
sudo DEPLOY_STOP_AFTER=bau /opt/hideandseek/scripts/deploy.sh
```

- **`MIN_FREE_MB`** (Vorgabe `2048`): Mindestfreier Platz auf `/` in Megabyte. Ist weniger frei, bricht das Skript ab, bevor es irgendetwas anfasst.
- **`DEPLOY_STOP_AFTER=bau`**: Hält an, sobald Frontend und Backend gebaut und geprüft sind. Webroot und Datenbank sind dann unverändert, die Seite läuft weiter wie bisher. Unverändert ist aber nicht alles: `node_modules` und `backend/dist` stehen nach diesem Lauf auf dem neuen Stand und werden beim nächsten Neustart des Dienstes wirksam – auch bei einem Neustart, der nichts mit einem Deploy zu tun hat. Der Schalter ist also gut zum Bauen-Prüfen, aber er lässt den Server nicht so zurück, wie er ihn vorgefunden hat.
- **`HEALTH_URL`** (Vorgabe `https://hideandseek.vielhaben.com/`): Die Adresse, die die Gesundheitsprüfung nach dem Neustart abfragt. Erwartet wird HTTP 200.
- **`DEPLOY_SKIP_RESET`** (auf `1` gesetzt): Umgeht `git fetch` und `git reset --hard` in Schritt 3. Nur für die Erprobung gedacht, etwa um einen absichtlich manipulierten Arbeitsbaum zu testen, ohne dass der Reset ihn sofort geradezieht.

Das Skript ruft sich selbst per `sudo` erneut auf, wenn es nicht schon als root läuft. Dabei reicht es die vier Schalter und `SSH_ORIGINAL_COMMAND` ausdrücklich über `--preserve-env` durch. Ohne dieses Flag würde `sudo` die Umgebung leeren, und alle gesetzten Schalter wären beim eigentlichen Lauf spurlos verschwunden.

## Eine Änderung an deploy.sh wirkt erst beim nächsten Deploy

Der Lauf, der eine neue Fassung von `deploy.sh` aus Git holt, führt selbst noch die alte Fassung aus. `git reset --hard` in Schritt 3 ersetzt die Datei auf der Platte, während bash sie gerade ausführt.

Das Skript ist dagegen abgesichert: Der komplette Rumpf steckt in einer geschweiften Klammer und endet unmittelbar davor mit `exit 0`. Beides zusammen ist nötig. Die Klammer sorgt dafür, dass bash den Rumpf vollständig einliest, bevor er läuft. Das `exit 0` verhindert, dass bash nach dem Ende der Klammer in die inzwischen ersetzte Datei zurückspringt und am verschobenen Byte-Offset weiterliest. Ohne dieses `exit 0` würde sich genau der Deploy, der `deploy.sh` selbst ändert, endlos wiederholen, inklusive `rsync --delete` und Dienstneustart bei jeder Wiederholung.

Gemessen wurde das auf bash 5.2.21, der Version auf dem Ziel-VPS (Ubuntu 24.04). Der Nachweis mit den drei durchgespielten Fassungen steht in `scripts/test/selbstaenderung.sh`.

## Sicherungen

Alle drei Sicherungsarten landen in `/opt/hideandseek/backups`, mit demselben UTC-Zeitstempel je Lauf. Der Zeitstempel wird gleich nach der Sperre vergeben, damit die drei Sicherungen eines Laufs zusammengehören:

- `backend-<JJJJMMTT-HHMMSS>`, `backend/dist` vor dem Backend-Bau (Schritt 5)
- `db-<JJJJMMTT-HHMMSS>.sqlite`, Datenbank vor der Migration (Schritt 7)
- `dist-<JJJJMMTT-HHMMSS>`, Webroot vor dem Tausch (Schritt 9)

Nach einem erfolgreichen Deploy dünnt das Skript aus: Von jeder der drei Arten bleiben die neuesten fünf, ältere werden gelöscht. Von Hand angelegte Sicherungen mit anderen Namen, etwa `dist-vor-rebuild`, treffen die Lösch-Muster nicht und bleiben unangetastet.

Von Hand zurücksetzen, am Beispiel eines Zeitstempels:

```bash
# Webroot
sudo rsync -a --delete --ignore-times /opt/hideandseek/backups/dist-<STEMPEL>/ /opt/hideandseek/dist/
sudo chmod -R 755 /opt/hideandseek/dist
sudo systemctl restart hideandseek-backend

# Backend-Bau
sudo systemctl stop hideandseek-backend
sudo rsync -a --delete --ignore-times /opt/hideandseek/backups/backend-<STEMPEL>/ /opt/hideandseek/backend/dist/
sudo systemctl start hideandseek-backend

# Datenbank
sudo systemctl stop hideandseek-backend
sudo cp -a /opt/hideandseek/backups/db-<STEMPEL>.sqlite /opt/hideandseek/backend/hideandseek.db
sudo chown hideandseek:hideandseek /opt/hideandseek/backend/hideandseek.db
sudo rm -f /opt/hideandseek/backend/hideandseek.db-wal /opt/hideandseek/backend/hideandseek.db-shm
sudo systemctl start hideandseek-backend
```

Das sind dieselben Befehle, die das Skript im Rückweg selbst verwendet, nur mit einem frei gewählten Zeitstempel statt dem letzten. `--ignore-times` steht bewusst dabei: ohne diese Option vergleicht rsync nur Größe und Zeitstempel und überspringt eine gleich große Datei, die in derselben Sekunde geschrieben wurde – bei `index.html` und `sw.js` ist das kein Gedankenspiel.

## Der Rückweg

Scheitert eine Migration (Schritt 8), spielt das Skript die eben angelegte Datenbanksicherung und den vorigen `backend/dist` zurück und bricht ab. Beides geschieht, während der Dienst gestoppt ist; gestartet wird er nur, wenn das Zurückkopieren der Datenbank geklappt hat. Der Webroot wurde zu diesem Zeitpunkt noch nicht getauscht, der Dienst noch nicht neu gestartet. Die Seite läuft also unverändert mit dem alten Stand weiter. Das ist der harmloseste der drei Fehlschläge.

Scheitert der Dienst-Neustart oder alles, was direkt danach kommt, bevor die Gesundheitsprüfung läuft, fängt eine Falle das ab und spielt den vorigen Webroot und den vorigen `backend/dist` automatisch zurück. Die Falle hängt an `ERR` und zusätzlich an `INT`, `TERM` und `HUP`: Reißt die SSH-Sitzung mitten im `rsync --delete` ab, kommt kein Rückgabewert, sondern ein Signal.

Scheitert stattdessen die Gesundheitsprüfung selbst (Dienst nicht aktiv, `/health` antwortet nicht, oder die öffentliche URL liefert keine 200), rollt das Skript ebenfalls den Code zurück – Webroot und `backend/dist`, letzteres vor dem Neustart – und beendet sich mit Fehler.

Der Vorbehalt dabei: Nur der Code geht zurück. Die Datenbank bleibt auf dem neuen Schema, weil die Migration bereits vor dem Webroot-Tausch läuft. Ein automatisches Zurückspielen der Datenbank an dieser Stelle würde alles verwerfen, was seit der Sicherung vor der Migration geschrieben wurde, deshalb macht das Skript das nicht von selbst. Es protokolliert die Lage mit "ACHTUNG" und nennt dabei den Pfad der Datenbanksicherung von vor der Migration.

Nach einem solchen Fehlschlag steht der alte Code neben dem neuen Schema. Ob das ein Problem ist, hängt davon ab, ob der alte Code mit dem neuen Schema zurechtkommt. Passt das nicht zusammen, bleiben zwei Wege: die Datenbank von Hand auf die in der ACHTUNG-Zeile genannte Sicherung zurücksetzen (Befehle siehe Abschnitt Sicherungen) oder den fehlerhaften Codestand fixen und erneut deployen.

## Geheimnisse

`HERE_API_KEY` liegt in `/etc/hideandseek-backend.env`, Rechte `600`, Eigentümer root, außerhalb von `/opt/hideandseek`. Kein Deploy fasst diese Datei an: `git reset --hard` und `rsync --delete` wirken beide nur innerhalb von `/opt/hideandseek`. Die systemd-Unit bindet sie über `EnvironmentFile=` ein.

## Was diese Strecke nicht fängt

`astro build` prüft keine Typen. Wie `vitest` läuft es über esbuild, das nur transpiliert. Ein Typfehler im Frontend fällt also weder in der CI-Prüfung noch beim Bauschritt im Deploy-Skript auf.
