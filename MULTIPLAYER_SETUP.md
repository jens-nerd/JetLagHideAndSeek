# Multiplayer Setup Guide

## Übersicht

Dieses Repo enthält ein Monorepo mit drei Paketen:

| Paket | Pfad | Zweck |
|---|---|---|
| Frontend | `/` (root) | Astro/React Web-App |
| Backend | `/backend` | Hono HTTP + WebSocket Server |
| Shared | `/shared` | Gemeinsame TypeScript-Typen |

---

## Lokale Entwicklung

### Voraussetzungen
- Node.js 26 (siehe `.nvmrc`)
- pnpm >= 9

### Setup

```bash
# 1. Dependencies installieren
pnpm install

# 2. better-sqlite3 native Bindings bauen (beim ersten Mal)
pnpm approve-builds
# → wähle better-sqlite3 + esbuild aus

# 3. Datenbank initialisieren
pnpm backend:migrate

# 4. Umgebungsvariablen einrichten
cp .env.example .env
# PUBLIC_BACKEND_URL=http://localhost:3001
# PUBLIC_BACKEND_WS_URL=ws://localhost:3001

# 5. Backend starten (Terminal 1)
pnpm backend:dev

# 6. Frontend starten (Terminal 2)
pnpm dev
```

Backend läuft auf: `http://localhost:3001`
Frontend läuft auf: `http://localhost:4321`

---

## Deployment auf VPS

Für wiederkehrende Deploys auf den bestehenden Server siehe `docs/deploy-vps.md`. Dieser Abschnitt beschreibt die Erstinstallation.

### Voraussetzungen
- Ubuntu/Debian VPS
- Node.js 26 (`nvm install 26`)
- pnpm (`npm install -g pnpm`)
- PM2 (`npm install -g pm2`)
- nginx (für Reverse Proxy + SSL)

### 1. Code deployen

```bash
git clone https://github.com/yourusername/JetLagHideAndSeek /opt/hideandseek
cd /opt/hideandseek
pnpm install
pnpm approve-builds  # better-sqlite3 + esbuild auswählen
```

### 2. Datenbank und Uploads

Beides gehört außerhalb des Repository-Klons, sonst liegt es in dem Verzeichnis, in dem ein Deploy `git reset --hard` und `rsync --delete` fährt.

```bash
sudo mkdir -p /var/lib/hideandseek/uploads
sudo chown -R hideandseek:hideandseek /var/lib/hideandseek
sudo chmod 755 /var/lib/hideandseek /var/lib/hideandseek/uploads
DB_PATH=/var/lib/hideandseek/hideandseek.db pnpm backend:migrate
sudo chown hideandseek:hideandseek /var/lib/hideandseek/hideandseek.db
sudo chmod 640 /var/lib/hideandseek/hideandseek.db
```

`755` auf den Verzeichnissen, weil nginx als `www-data` die Bilder liest. Die Unit legt `/var/lib/hideandseek` über `StateDirectory=hideandseek` beim Start ohnehin selbst an; die Zeilen oben braucht nur, wer vor dem ersten Start migrieren will.

### 3. Backend bauen und starten

> **Nicht für hideandseek.vielhaben.com.** Auf diesem Server läuft das Backend als
> systemd-Unit `hideandseek-backend`. Eine zusätzliche PM2-Instanz findet Port 3001
> belegt und läuft in eine Neustartschleife. Einzelheiten in `docs/deploy-vps.md`.

```bash
cd /opt/hideandseek
pnpm backend:build

# Mit PM2 (empfohlen):
cd backend
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup

# Alternativ: systemd
# Zuerst die Secret-Datei anlegen, sonst startet das Backend ohne HERE_API_KEY:
sudo install -m 600 -o root -g root /dev/null /etc/hideandseek-backend.env
sudo sh -c 'echo "HERE_API_KEY=<schluessel>" >> /etc/hideandseek-backend.env'

sudo cp backend/hideandseek-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hideandseek-backend
```

Die Unit im Repo ist die, die auf hideandseek.vielhaben.com läuft: Nutzer
`hideandseek`, Arbeitsverzeichnis `/opt/hideandseek/backend`, Datenbank unter
`/var/lib/hideandseek/hideandseek.db`, Uploads unter
`/var/lib/hideandseek/uploads`, `FRONTEND_ORIGIN` auf
`https://hideandseek.vielhaben.com`. Wer anders deployt, ändert `User`,
`Group`, `WorkingDirectory`, `DB_PATH`, `UPLOADS_DIR` und `StateDirectory`
zusammen - die Härtung `ProtectSystem=strict` erlaubt Schreibzugriff nur auf
das Verzeichnis, das `StateDirectory` anlegt.

`UPLOADS_DIR` ist keine Kür. Fehlt die Variable, schreibt
`backend/src/routes/upload.ts` nach `join(process.cwd(), "uploads")`, also ins
Arbeitsverzeichnis der Unit - und nginx liefert `/uploads/` aus dem Verzeichnis,
das in der Site steht. Passt das nicht zusammen, landen Fotoantworten auf der
Platte und erreichen niemanden. Genau das ist im April 2026 fünf Monate lang
unbemerkt passiert.

`EnvironmentFile=/etc/hideandseek-backend.env` ist kein Beiwerk. Fehlt die
Datei oder fehlt darin `HERE_API_KEY`, läuft das Backend trotzdem an und
schweigt: die POI-Suche fällt in `backend/src/routes/poi.ts` auf Overpass
zurück (`if (!HERE_API_KEY) return null`), ohne Log-Eintrag und ohne
Fehlermeldung. Auffällig wird das erst an schlechteren Treffern. Den Wert des
Schlüssels nie im Repo ablegen, sondern nur in dieser Datei (root:root,
Modus 600).

### 4. Frontend bauen

```bash
cd /opt/hideandseek
PUBLIC_BACKEND_URL=https://api.yourdomain.com \
PUBLIC_BACKEND_WS_URL=wss://api.yourdomain.com \
pnpm build
# Output: dist/
```

### 5. nginx konfigurieren

```nginx
# /etc/nginx/sites-available/hideandseek

# Frontend
server {
    listen 443 ssl;
    server_name yourdomain.com;

    root /opt/hideandseek/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}

# Backend API + WebSocket
server {
    listen 443 ssl;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;  # Für WebSocket keep-alive
    }
}
```

---

## Umgebungsvariablen

### Frontend (`.env`)
| Variable | Standard | Beschreibung |
|---|---|---|
| `PUBLIC_BACKEND_URL` | `http://localhost:3001` | REST API URL |
| `PUBLIC_BACKEND_WS_URL` | `ws://localhost:3001` | WebSocket URL |

### Backend (`ecosystem.config.cjs` oder systemd)
| Variable | Standard | Beschreibung |
|---|---|---|
| `PORT` | `3001` | Backend-Port |
| `DB_PATH` | `./hideandseek.db` | Pfad zur SQLite-Datenbankdatei |
| `UPLOADS_DIR` | `<cwd>/uploads` | Verzeichnis für hochgeladene Bilder; nginx muss von dort ausliefern |
| `FRONTEND_ORIGIN` | `http://localhost:4321` | CORS erlaubte Frontend-URL |

---

## Spielablauf

### Session starten (Hider)
1. App öffnen → linke Sidebar → "Session erstellen"
2. Namen eingeben → "Session starten"
3. Den **6-stelligen Code** an Seeker weitergeben (z.B. per Chat)
4. Hider-Modus wird automatisch aktiviert

### Session beitreten (Seeker)
1. App öffnen → linke Sidebar → "Session beitreten"
2. Code und Namen eingeben → "Beitreten"
3. Seeker-Ansicht erscheint

### Spielen
- **Seeker** stellt eine Frage: Fragekarte auf Karte einrichten → in Session-Panel auf Fragetyp klicken → Frage geht an Hider
- **Hider** sieht Frage in der App → klickt "GPS-Antwort" → Browser fragt GPS → Antwort wird berechnet und gesendet
- Karte aktualisiert sich **live** bei beiden Parteien
- Session-Code oben in der Sidebar anzeigen zum Kopieren und Teilen

---

## API-Referenz

```
POST   /api/sessions                    Session erstellen (Hider)
GET    /api/sessions/:code              Session-Info abrufen
POST   /api/sessions/:code/join         Session beitreten (Seeker)
PATCH  /api/sessions/:code/map          Kartenlocation aktualisieren
GET    /api/sessions/:code/questions    Alle Fragen abrufen
POST   /api/sessions/:code/questions    Neue Frage stellen (Seeker)
POST   /api/questions/:id/answer        Frage beantworten (Hider)
GET    /health                          Health Check

WS     /ws/:code?token=<token>          WebSocket-Verbindung
```

Auth-Header: `x-participant-token: <token>` (aus Session-Erstellung/Beitritt)
