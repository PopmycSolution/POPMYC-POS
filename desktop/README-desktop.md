# POPMYC POS — Desktop Application

## Architecture

```
CUSTOMER WINDOWS PC
  │
  ├── POPMYC POS.exe  (Electron shell)
  │     └── BrowserWindow → http://localhost:8000/
  │
  └── Child process: backend/desktop_launcher.py
        │  (Python + .venv-prod)
        ├── loads  %APPDATA%/POPMYC POS/.env
        ├── runs   manage.py migrate
        ├── runs   manage.py collectstatic  (first run only)
        └── starts waitress WSGI server on port 8000
              │
              ├── /                  → React SPA (WhiteNoise from staticfiles/)
              ├── /api/v1/...        → Django REST API
              ├── /api/sync/...      → Sync engine
              └── /admin/            → Django admin
```

## Offline / Online operation

| Feature | Offline | Online (cloud configured) |
|---------|---------|--------------------------|
| Login (local users) | ✅ | ✅ |
| POS / Sales | ✅ | ✅ |
| Inventory | ✅ | ✅ |
| Purchases | ✅ | ✅ |
| Customers | ✅ | ✅ |
| Reports | ✅ (local data) | ✅ |
| Cloud sync | ⏳ queued in SyncRecord | ✅ on next cycle |
| Duplicate sale prevention | ✅ (offline_uuid) | ✅ (server dedup) |

## Data directory

Customer data is **never** stored in the installation directory.

| Path | Contents |
|------|----------|
| `%APPDATA%\POPMYC POS\.env` | DB password, secret key, cloud sync URL |
| `%APPDATA%\POPMYC POS\logs\` | Application logs (10 MB rotating) |
| `%APPDATA%\POPMYC POS\media\` | Uploaded files (avatars, logos) |
| `%APPDATA%\POPMYC POS\backups\` | Database backup files |

Application updates/reinstalls **do not touch** `%APPDATA%\POPMYC POS\`.

## Developer build (no installer)

```powershell
# From project root
.\scripts\build-desktop.ps1

# Start in dev mode (opens DevTools, verbose logging)
cd desktop
npx electron . --dev
```

## Production installer build

```powershell
# Install electron-builder first (one-time)
cd desktop
npm install

# Build everything + create installer
cd ..
.\scripts\build-desktop.ps1 -Package
# Output: desktop/dist-installer/POPMYC-POS-Setup-1.0.0.exe
```

## Testing the backend alone (browser mode)

```powershell
cd backend
python desktop_launcher.py --port 8000
# Open http://localhost:8000/ in Chrome/Edge
```

## Configuration

Edit `%APPDATA%\POPMYC POS\.env`:

```ini
DB_NAME=popmyc_pos
DB_USER=postgres
DB_PASSWORD=your_password
DB_HOST=localhost
DB_PORT=5432
DJANGO_SECRET_KEY=auto-generated-on-first-run

# Cloud synchronization (optional)
SYNC_CLOUD_URL=https://cloud.popmycsolutions.com/api/sync
SYNC_CLOUD_TOKEN=your_cloud_token

# Set to False if Redis is running for background tasks
POPMYC_CELERY_EAGER=True
```

## PostgreSQL requirement

PostgreSQL is **not bundled** with the desktop application.

Rationale:
- PostgreSQL is a 300 MB+ installation
- It needs OS-level configuration (services, user accounts)
- The official installer handles this correctly
- Customers running multiple business apps benefit from a shared PostgreSQL instance

**The Inno Setup installer** detects whether PostgreSQL is installed and offers
to open the download page if not.

Download: https://www.postgresql.org/download/windows/

After installing PostgreSQL, create the database:
```sql
CREATE DATABASE popmyc_pos;
```
Then update the password in `%APPDATA%\POPMYC POS\.env`.

## Stage 5.2 items (not yet implemented)

- [ ] First-run wizard: database setup assistant
- [ ] First-run wizard: create first business and super-admin user
- [ ] License activation screen
- [ ] Auto-update mechanism (electron-updater)
- [ ] Windows Service mode for always-on kiosk deployments
- [ ] Bundled Python runtime (portable Python zip — removes system Python dependency)
- [ ] PostgreSQL setup automation (optional bundled pg_ctl)
- [ ] Inno Setup prerequisite download (PostgreSQL silent install)
- [ ] Owner PWA integration

## Port configuration

Default: `8000`. To run on a different port, set `POPMYC_PORT` before starting:

```powershell
$env:POPMYC_PORT = "8080"
cd desktop; npx electron . --dev
```
