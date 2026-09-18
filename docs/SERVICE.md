# POPMYC POS — Windows Background Service

Stage 6.1 — Always-On Windows Service

---

## Overview

POPMYC POS installs a Windows background service called **POPMYCBackend** that
runs the Django/Waitress backend automatically when Windows starts.

The customer does not need to open PowerShell, run Python, or start any
backend manually.  They simply log in to Windows and open POPMYC POS.

---

## Service Details

| Property       | Value                                        |
|----------------|----------------------------------------------|
| Service name   | `POPMYCBackend`                              |
| Display name   | POPMYC POS Backend Service                   |
| Startup type   | Automatic (starts with Windows)              |
| Executable     | `nssm.exe` wrapping `python.exe`             |
| Python script  | `{install}\resources\backend\service_launcher.py` |
| Bind address   | `127.0.0.1:8000` (localhost only)            |
| Health URL     | `http://127.0.0.1:8000/api/v1/health/`       |
| Log: stdout    | `%APPDATA%\POPMYC POS\logs\service_stdout.log` |
| Log: stderr    | `%APPDATA%\POPMYC POS\logs\service_stderr.log` |
| Log: app       | `%APPDATA%\POPMYC POS\logs\popmyc_desktop.log` |
| NSSM location  | `{install}\resources\nssm\nssm.exe`          |

---

## Architecture

```
Windows starts
  │
  ├─ POPMYCBackend service (AUTO start)
  │    │
  │    └─ service_launcher.py
  │         │  1. Load %APPDATA%\POPMYC POS\.env
  │         │  2. Wait for PostgreSQL (30 × 5 s)
  │         │  3. Apply pending Django migrations
  │         │  4. Start Waitress → http://127.0.0.1:8000/
  │
  └─ Customer opens POPMYC POS (Electron)
       │
       ├─ Detect POPMYCBackend service state
       │    • running   → skip Django spawn, wait for health endpoint
       │    • stopped   → start service, wait for health endpoint
       │    • not-installed → child-process fallback (dev / emergency)
       │
       └─ Load React SPA
```

---

## Startup Sequence (Production)

1. Windows boots.
2. **POPMYCBackend** service starts automatically (before the user logs in).
3. `service_launcher.py` loads `%APPDATA%\POPMYC POS\.env`.
4. PostgreSQL is polled — up to 30 attempts × 5 seconds = 2.5 minutes wait.
5. Pending Django migrations are applied (with automatic pre-migration backup).
6. Waitress starts on `127.0.0.1:8000`.
7. The customer opens POPMYC POS (Electron).
8. Electron detects the service is running and skips spawning a new Django process.
9. Electron polls `/api/v1/health/` until it gets HTTP 200.
10. The React SPA loads and the customer logs in.

---

## Files

### New files (Stage 6.1)

| File                                        | Purpose                                      |
|---------------------------------------------|----------------------------------------------|
| `backend/service_launcher.py`               | Python entry point for the Windows service   |
| `desktop/service-manager.js`                | Node.js NSSM/sc.exe wrapper (used by Electron) |
| `desktop/resources/nssm/nssm.exe`           | NSSM binary (downloaded by build script)     |
| `desktop/resources/nssm/.gitkeep`           | Keeps the directory in git                   |
| `docs/SERVICE.md`                           | This file                                    |

### Modified files

| File                                        | Change                                       |
|---------------------------------------------|----------------------------------------------|
| `desktop/main.js`                           | Service-aware `startBackend()`, service IPC  |
| `desktop/preload.js`                        | Exposes service IPC to renderer              |
| `desktop/installer/popmyc-setup.iss`        | Service install/uninstall, NSSM bundling     |
| `scripts/build-desktop.ps1`                 | NSSM download step added                     |

---

## NSSM

[NSSM (Non-Sucking Service Manager)](https://nssm.cc/) is a public-domain
Windows utility that wraps any executable as a proper Windows service.

It is bundled inside the POPMYC POS installer at:

```
{install}\resources\nssm\nssm.exe
```

The build script (`scripts\build-desktop.ps1 -Package`) downloads NSSM
automatically from `https://nssm.cc/` if it is not already present.

NSSM provides:
- Automatic restart on crash (with configurable delay and throttle)
- Stdout/stderr capture to rotating log files
- Clean shutdown via Ctrl+C before force-kill
- Full Windows service lifecycle (start, stop, pause, resume)

---

## Log Files

All log files are in `%APPDATA%\POPMYC POS\logs\`:

| File                    | Content                              | Rotation          |
|-------------------------|--------------------------------------|-------------------|
| `service_stdout.log`    | Service launcher print() output      | 10 MB (NSSM)      |
| `service_stderr.log`    | Service launcher errors              | 10 MB (NSSM)      |
| `popmyc_desktop.log`    | Django application log               | 10 MB × 5 (Django)|
| `backend.log`           | Child-process fallback mode only     | Not rotated       |
| `pg_setup.log`          | PostgreSQL setup script output       | Not rotated       |

**Nothing sensitive is logged** — passwords, tokens, and activation codes
are never written to any log file.

---

## Installation

The service is installed automatically by the Inno Setup installer.

The install sequence is:

1. Installer runs with Administrator privileges.
2. If upgrading: existing service is stopped before files are replaced.
3. Application files are copied to `{autopf}\POPMYC POS\`.
4. `nssm.exe install POPMYCBackend python.exe service_launcher.py --port 8000`
5. NSSM properties are configured (environment, logs, restart policy).
6. Service is set to `SERVICE_AUTO_START`.
7. Service is started immediately: `sc start POPMYCBackend`.
8. POPMYC POS Electron application is launched.

---

## Manual Service Management

Open **Command Prompt as Administrator**:

```cmd
REM Check service status
sc query POPMYCBackend

REM Start the service
sc start POPMYCBackend

REM Stop the service
sc stop POPMYCBackend

REM Restart the service
sc stop POPMYCBackend && sc start POPMYCBackend

REM Check if backend is responding
curl http://127.0.0.1:8000/api/v1/health/
```

Using NSSM directly (from the install directory):

```cmd
cd "C:\Program Files\POPMYC POS\resources\nssm"

REM View all service configuration
nssm.exe dump POPMYCBackend

REM Edit service in NSSM GUI
nssm.exe edit POPMYCBackend

REM Remove service
nssm.exe remove POPMYCBackend confirm
```

Using PowerShell:

```powershell
# Check service
Get-Service POPMYCBackend

# Start / Stop / Restart
Start-Service POPMYCBackend
Stop-Service POPMYCBackend
Restart-Service POPMYCBackend

# View recent service events
Get-EventLog -LogName System -Source "Service Control Manager" |
  Where-Object { $_.Message -like "*POPMYCBackend*" } |
  Select-Object -First 20
```

---

## Troubleshooting

### POS shows "Cannot connect to backend"

1. Check the service is running:
   ```cmd
   sc query POPMYCBackend
   ```
2. If `STOPPED`, start it:
   ```cmd
   sc start POPMYCBackend
   ```
3. Wait 30–60 seconds (service waits for PostgreSQL).
4. Check logs: `%APPDATA%\POPMYC POS\logs\service_stdout.log`

### Service starts but POS still fails

Check PostgreSQL is running:
```cmd
sc query postgresql-x64-16
```
(Replace `16` with your PostgreSQL version number.)

If stopped:
```cmd
sc start postgresql-x64-16
```

### "PostgreSQL not available after 30 attempts"

In `service_stdout.log`:
```
ERROR: PostgreSQL still unavailable after 30 attempts
```

Causes:
- PostgreSQL service is stopped → start it (see above)
- Wrong DB_HOST/DB_PORT/DB_PASSWORD in `.env` → edit `%APPDATA%\POPMYC POS\.env`
- PostgreSQL is installed but listening on a different port → check `DB_PORT` in `.env`

### Service fails immediately on start (rapid restart loop)

NSSM throttles rapid restarts. Check `service_stderr.log` for the Python error.

Common causes:
- `.env` missing or malformed (POPMYC_DATA_DIR not writable)
- Python runtime not found (check `{install}\resources\runtime\python\python.exe`)
- Django settings import error (check `service_stderr.log`)

### Viewing Event Log entries

```cmd
eventvwr.msc
```
→ Windows Logs → Application → filter by source "nssm" or "POPMYCBackend".

---

## Update Procedure

The build script and installer handle updates automatically:

1. Run `.\scripts\build-desktop.ps1 -Package` to build the new installer.
2. Distribute `POPMYC-POS-Setup-X.Y.Z.exe` to the customer.
3. Customer runs the installer (it will ask for Administrator approval).
4. Installer stops the service before replacing files (`ssInstall` step).
5. New files are copied.
6. Service is reconfigured and restarted (`ssPostInstall` step).
7. Customer data in `%APPDATA%\POPMYC POS\` is **never touched**.

---

## Uninstall Procedure

1. Customer opens Windows Settings → Apps → POPMYC POS → Uninstall.
   Or: Control Panel → Programs → POPMYC POS → Uninstall.
2. Installer stops the service.
3. Installer removes the service registration (`nssm remove` + `sc delete`).
4. Application files in `{autopf}\POPMYC POS\` are deleted.
5. `%APPDATA%\POPMYC POS\` **is NOT deleted** — customer data is preserved.
   - Database remains in PostgreSQL.
   - `.env` is preserved (so reinstall reconnects to existing data).
   - Logs, media, and backups are preserved.

If the customer wants to completely wipe POPMYC POS data, they must manually
delete `%APPDATA%\POPMYC POS\` **and** drop the `popmyc_pos` PostgreSQL database.

---

## Security

- The service binds exclusively to `127.0.0.1:8000` — never accessible from
  the network or other machines.
- NSSM runs the service as **Local System** by default (can be changed to a
  dedicated low-privilege account for hardened deployments).
- No passwords, tokens, or activation codes appear in any log file.
- The `.env` file containing database credentials is stored in
  `%APPDATA%\POPMYC POS\.env` with standard Windows user-profile permissions
  (not world-readable).

---

## Developer Notes

### Running the service launcher manually (without installing the service)

```powershell
# From backend/
cd c:\xampp\htdocs\POS\backend
.\.venv-prod\Scripts\python.exe service_launcher.py --port 8000
```

### Dev mode

In dev mode (`electron . --dev`), `main.js` always uses the child-process
path (`desktop_launcher.py`) — the Windows service is never consulted.
This preserves the existing dev workflow.

### Difference between desktop_launcher.py and service_launcher.py

| Feature              | `desktop_launcher.py`      | `service_launcher.py`      |
|----------------------|----------------------------|----------------------------|
| pg_setup interaction | Yes (interactive UI)       | No                         |
| collectstatic        | Yes (on first run)         | No (must be pre-built)     |
| PostgreSQL retry     | No (exits immediately)     | Yes (30 × 5 s)             |
| Auto-backup          | Yes (before migrations)    | Yes (before migrations)    |
| Designed for         | Electron child process     | Windows service / NSSM     |
| Signal handling      | Basic                      | SIGTERM + SIGBREAK         |

Both scripts share the same Django backend and Waitress configuration.
