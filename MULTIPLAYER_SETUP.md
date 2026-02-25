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
- Node.js >= 20 (empfohlen, für native Binaries von better-sqlite3)
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

### Voraussetzungen
- Ubuntu/Debian VPS
- Node.js 20+ (`nvm install 20`)
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

### 2. Datenbank und Logs

```bash
mkdir -p /var/data/hideandseek /var/log/hideandseek
pnpm backend:migrate
# DB_PATH env var auf /var/data/hideandseek/hideandseek.db setzen
```

### 3. Backend bauen und starten

```bash
cd /opt/hideandseek
pnpm backend:build

# Mit PM2 (empfohlen):
cd backend
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup

# Alternativ: systemd
sudo cp backend/hideandseek-backend.service /etc/systemd/system/
# Passe den Pfad in der .service-Datei an
sudo systemctl enable --now hideandseek-backend
```

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
