# Deploy auf den VPS

Kurzfassung für wiederkehrende Deploys. Die Erstinstallation steht in `MULTIPLAYER_SETUP.md`.

## Die eine Regel

**Gebaut wird auf dem Server, nicht auf dem Mac.**

Der Grund ist unangenehm konkret. Ein `rsync -a` vom Mac überträgt Eigentümer und Gruppe numerisch mit. Auf dem Server gibt es die uid 502 und die Gruppe `staff` nicht, die Dateien gehören danach niemandem, den das System kennt. Für statische Dateien im Webroot fällt das nicht auf, weil nginx nur liest. Die SQLite-Datenbank des Backends dagegen wird damit für den Dienstbenutzer unbeschreibbar, und jede Session-Erstellung endet in einem 500er.

Genau das ist am 18.09.2026 passiert. Der Multiplayer war seit dem 23.04. kaputt, ohne dass es jemandem auffiel, weil im Log nur `SqliteError: attempt to write a readonly database` stand und niemand hinsah.

Wer trotzdem vom Mac übertragen muss: `--no-owner --no-group` mitgeben, oder direkt danach den Eigentümer geradeziehen.

## Wo was liegt

| | Pfad |
|---|---|
| Repository-Klon | `/opt/hideandseek` |
| Webroot (nginx) | `/opt/hideandseek/dist` |
| Backend-Dienst | `hideandseek-backend.service` (systemd), Port 3001 |
| Datenbank | `/opt/hideandseek/backend/hideandseek.db`, gehört `hideandseek:hideandseek` |
| Uploads | `/opt/hideandseek/uploads` (nginx liefert von dort aus) |
| nginx-Site | `/etc/nginx/sites-available/hideandseek.vielhaben.com` |
| Umgebung für den Frontend-Build | `/opt/hideandseek/.env`, gitignored, bleibt bei `git reset` liegen |
| Geheimnisse fürs Backend | `/etc/hideandseek-backend.env`, `600 root:root`, außerhalb des Projekts |

Zugang über `ssh deploy@<vps>`, der Benutzer hat passwortloses `sudo`.

## Frontend ausrollen

```bash
# 1. Auf den Stand von GitHub ziehen
sudo git -C /opt/hideandseek fetch origin
sudo git -C /opt/hideandseek status --short      # vorher draufschauen
sudo git -C /opt/hideandseek reset --hard origin/master

# 2. Bauen, in ein Verzeichnis INNERHALB des Projekts
sudo sh -c "cd /opt/hideandseek && pnpm exec astro build --outDir /opt/hideandseek/build-$(date +%Y%m%d)"

# 3. Webroot sichern, dann tauschen
sudo cp -a /opt/hideandseek/dist /opt/hideandseek/backups/dist-$(date +%Y%m%d)
sudo rsync -a --delete /opt/hideandseek/build-$(date +%Y%m%d)/ /opt/hideandseek/dist/
sudo chmod -R 755 /opt/hideandseek/dist
sudo chown www-data:www-data /opt/hideandseek/dist
```

Rollback ist der umgekehrte rsync aus dem Backup.

Zwei Dinge, über die man sonst stolpert:

`git reset --hard` verwirft geänderte getrackte Dateien. Untracked-Dateien und alles Gitignorierte bleiben liegen, also auch `.env`, die Uploads und die Backups. `git clean -fd` gehört hier **nicht** dazu, das würde genau die mitnehmen.

Das Build-Ausgabeverzeichnis muss unterhalb von `/opt/hideandseek/` liegen. Zeigt `--outDir` woandershin, legt das PWA-Plugin `sw.js` nicht dort ab, sondern in `.astro/`, und die Precache-Liste schrumpft von 28 Einträgen auf einen. Der Build meldet dabei keinen Fehler.

## Backend ausrollen

```bash
sudo sh -c "cd /opt/hideandseek && pnpm backend:build"
sudo systemctl restart hideandseek-backend
sudo systemctl status hideandseek-backend --no-pager
journalctl -u hideandseek-backend -n 30 --no-pager
```

**Nicht zusätzlich per pm2 starten.** Das Backend läuft als systemd-Unit. Eine zweite Instanz unter pm2 findet Port 3001 belegt, stirbt, wird neu gestartet, stirbt wieder. Bis Juli 2026 lief genau diese Schleife und hat eine Logdatei von 2,9 GB produziert, gut fünfzehn Millionen Zeilen `EADDRINUSE`. Die Anleitung in `MULTIPLAYER_SETUP.md` nennt pm2 noch als Option; für diesen Server gilt sie nicht.

## Geheimnisse und Umgebungsvariablen

Schlüssel gehören in `/etc/hideandseek-backend.env`, Modus `600`, Eigentümer `root:root`. Die Unit zieht sie über `EnvironmentFile=` nach:

```
EnvironmentFile=/etc/hideandseek-backend.env
```

Der Pfad liegt bewusst außerhalb von `/opt/hideandseek`. Damit fasst kein Deploy die Datei an, kein `git reset --hard`, kein `git clean`, kein `rsync --delete`. Sie überlebt schlicht alles, was mit dem Projektverzeichnis passiert.

Nicht ins Projektverzeichnis legen, auch nicht als `.env`. Und nicht als `Environment=`-Zeile in die Unit schreiben: Unit-Dateien sind für jeden lesbar, `systemctl cat` gibt den Wert ungefragt aus.

Einen Schlüssel rotieren heißt dann:

```bash
sudo nano /etc/hideandseek-backend.env
sudo systemctl restart hideandseek-backend
```

Eine Stelle, ein Neustart. Kein Deploy nötig, kein Build.

### Die Falle: Umzug von pm2 auf systemd

Beim Wechsel eines Dienstes von pm2 auf systemd wandern Umgebungsvariablen **nicht** mit. pm2 hält sie in seiner eigenen Konfiguration (`/root/.pm2/module_conf.json`, `ecosystem.config.cjs`), systemd liest davon nichts.

Genau das ist mit `HERE_API_KEY` passiert. Der Schlüssel lag nach dem Umzug nur noch als Überbleibsel in der pm2-Konfiguration, einem Pfad, den der systemd-Dienst gar nicht liest. Die HERE Browse API war damit monatelang abgeschaltet, ohne dass es jemand merkte.

Warum es niemand merkte, ist der zweite Teil der Falle. `backend/src/routes/poi.ts` liest den Schlüssel so:

```ts
const HERE_API_KEY = process.env.HERE_API_KEY ?? "";
...
if (!HERE_API_KEY) return null;
```

Bei leerem Wert fällt die Route lautlos auf Overpass zurück. Keine Warnung im Log, kein Fehler, nur langsamere und schlechtere Ergebnisse. Ein fehlender Schlüssel sieht hier genauso aus wie ein funktionierender.

Wer also einen Dienst umzieht: vorher die gesetzten Variablen der alten Umgebung auflisten und danach im laufenden Prozess nachsehen, ob sie angekommen sind.

```bash
PID=$(systemctl show -p MainPID --value hideandseek-backend)
sudo cat /proc/$PID/environ | tr '\0' '\n' | cut -d= -f1 | sort
```

Der `cut` schneidet die Werte ab, ausgegeben werden nur die Namen.

## Nach dem Deploy prüfen

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://hideandseek.vielhaben.com/
curl -s https://hideandseek.vielhaben.com | grep -c taibeled        # 0 erwartet
curl -s https://hideandseek.vielhaben.com | grep -c googleapis      # 0 erwartet
curl -s https://hideandseek.vielhaben.com/sw.js | grep -o 'url:"/",revision:"[^"]*"'
```

Die Service-Worker-Revision muss sich nach einem Deploy geändert haben. Tut sie das nicht, sehen Besucher mit installierter PWA weiter die alte Seite.

Backend-Schreibpfad, der bei Rechteproblemen als Erstes bricht:

```bash
curl -s -X POST http://127.0.0.1:3001/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"displayName":"deploy-check"}' -w "\nHTTP %{http_code}\n"
```

Erwartet wird 2xx mit einem Session-Code. Kommt `Internal Server Error` mit 500, steht im Journal fast sicher wieder `attempt to write a readonly database`, und dann gehört die Datenbank dem Falschen:

```bash
sudo chown hideandseek:hideandseek /opt/hideandseek/backend
sudo chown hideandseek:hideandseek /opt/hideandseek/backend/hideandseek.db \
                                   /opt/hideandseek/backend/hideandseek.db-wal \
                                   /opt/hideandseek/backend/hideandseek.db-shm
sudo systemctl restart hideandseek-backend
```

Das Verzeichnis muss mit, nicht nur die Datei. SQLite legt im WAL-Modus `-wal` und `-shm` daneben an und braucht dafür Schreibrecht auf dem Verzeichnis.

Testeintrag danach wieder entfernen:

```bash
sudo -u hideandseek sqlite3 /opt/hideandseek/backend/hideandseek.db \
  "delete from participants where display_name='deploy-check';
   delete from sessions where id not in (select session_id from participants);"
```
