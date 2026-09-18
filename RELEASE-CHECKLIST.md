# POPMYC POS — Release Checklist

**Version:** 1.0.0  
**Date:** 2026-09-16  
**Build:** Stages 5.1 → 5.5 complete

---

## Build Status

| Item | Status | Notes |
|------|--------|-------|
| Version | **1.0.0** | `desktop/package.json` + `popmyc-setup.iss` |
| Installer output | `desktop/dist-installer/POPMYC-POS-Setup-1.0.0.exe` | Run `.\scripts\build-desktop.ps1 -Package` |
| Django check | **PASS** — 0 issues | |
| makemigrations --check | **PASS** — no changes | |
| migrate --check | **PASS** — no unapplied | |
| Backend tests | **86/86 PASS** | 0 failures, 0 RuntimeWarnings |
| tsc --noEmit | **PASS** — 0 errors | |
| npm run build | **PASS** — 1525 modules | |

---

## Code Signing

| Item | Status | Action Required |
|------|--------|----------------|
| Signing configuration | **Ready** | `desktop/package.json` has `signingHashAlgorithms` set |
| Certificate | **NOT PROVIDED** | Purchase EV certificate from DigiCert/Sectigo/GlobalSign |
| CI/CD secret | **NOT CONFIGURED** | Set `CSC_LINK` + `CSC_KEY_PASSWORD` in build environment |
| Documentation | **Done** | See `desktop/CODE-SIGNING.md` |

> **Prerequisite before public distribution:** A code-signed installer is required to avoid Windows SmartScreen warnings on customer machines.

---

## Update Server

| Item | Status | Action Required |
|------|--------|----------------|
| Feed URL configured | **Ready** (in `package.json`) | Point to your server |
| Update server deployed | **NOT DEPLOYED** | Host `latest.yml` + installer at `https://releases.popmycsolutions.com/popmyc-pos/` |
| Offline behavior | **PASS** | Update failures are non-blocking; POS continues working |
| Documentation | **Done** | See `desktop/RELEASE-STRUCTURE.md` |

> **Prerequisite for auto-updates:** Deploy the release server and set `POPMYC_UPDATE_URL`.

---

## PostgreSQL

| Item | Status | Notes |
|------|--------|-------|
| PostgreSQL requirement | **Required (external)** | Customer must install PostgreSQL 14+ |
| Detection | **Implemented** | `pg_setup.py` checks registry + services + path |
| Missing PG guidance | **Implemented** | Installer warns + offers download link |
| DB creation (assistant) | **Implemented** | `DbSetupScreen` creates database using PG admin password |
| Password security | **PASS** | Passed via stdin, never on command line, never logged |
| Auto-installer | **NOT IMPLEMENTED** | Stage 5.5+ future work |

---

## Backup & Restore

| Item | Status | Notes |
|------|--------|-------|
| Create backup | **PASS** | `pg_dump` with PGPASSWORD env var |
| List backups | **PASS** | Sorted newest first |
| Validate backup | **PASS** | GZIP magic + SQL content check |
| Restore (with safety backup) | **PASS** | Creates safety backup first, falls back on failure |
| Export backup (download) | **PASS** | `FileResponse` with safe filename validation |
| Import backup (upload) | **PASS** | Validates GZIP before saving |
| Delete backup | **PASS** | Refuses to delete last backup |
| Retention | **PASS** | Keeps 10, always retains minimum 3 |
| Pre-migration backup | **PASS** | `desktop_launcher.py` backs up before pending migrations |
| Password in logs | **PASS** — never logged | `re.sub` removes password from pg_dump stderr |
| Restore tests | **11/11 PASS** | |

---

## Offline Operation

| Item | Status | Notes |
|------|--------|-------|
| POS works without internet | **PASS** | All operations use local PostgreSQL |
| SyncManager offline | **PASS** | Returns `not_configured` immediately when no cloud URL |
| SyncManager network failure | **PASS** | Records reset SYNCING→FAILED, never stuck |
| Offline transactions preserved | **PASS** | SyncRecord STATUS_PENDING until next sync cycle |
| License check offline | **PASS** | Middleware checks local DB status, not cloud |

---

## Cloud Sync

| Item | Status | Notes |
|------|--------|-------|
| Upload pending records | **PASS** | SyncManager.upload_pending() |
| Download cloud changes | **PASS** | SyncManager.download_changes() |
| Duplicate prevention | **PASS** | Primary: sync UUID; Secondary: offline_uuid/idempotency_key |
| SYNCING recovery | **PASS** | Generic exceptions reset SYNCING→FAILED |
| Sync endpoints bypass license | **PASS** | `/api/sync/` in BYPASS_PREFIXES |
| Cloud sync tests | **6/6 PASS** | |

---

## License

| Item | Status | Notes |
|------|--------|-------|
| Active license | **PASS** | Normal POS operation |
| Expired license | **PASS** | Middleware blocks + red banner in UI |
| Near-expiry (≤14 days) | **PASS** | Amber banner, links to Settings → Subscription |
| Revoked license | **PASS** | Middleware blocks |
| Lifetime license | **PASS** | Never blocked, no expiry banner |
| Renewal | **PASS** | `POST /api/v1/licensing/renew/` |
| Offline/server unavailable | **PASS** | Uses local DB status; non-blocking |
| License tests | **PASS** | Multiple audit tests |

---

## Setup Wizard (Stage 5.2C)

| Item | Status | Notes |
|------|--------|-------|
| First-run detection | **PASS** | `GET /api/v1/setup/status/` |
| 5-step wizard | **PASS** | Business→Branch→Admin→License |
| One-shot protection | **PASS** | 409 Conflict on second call |
| Server-side validation | **PASS** | All criteria checked server-side |
| Setup tests | **16/16 PASS** | |

---

## Security Audit

| Check | Status |
|-------|--------|
| No hardcoded secrets in source | **PASS** |
| DEBUG=False in production settings | **PASS** |
| PG password via stdin only (not CLI) | **PASS** |
| PG password not in logs | **PASS** — regex-stripped |
| DevTools gated behind IS_DEV | **PASS** |
| Code signing config ready (no cert committed) | **PASS** |
| Backup filenames validated (path traversal blocked) | **PASS** |
| Restore requires `confirmed=true` | **PASS** |
| Backup admin-only (403 for cashiers) | **PASS** |
| Setup endpoint blocks after first run (409) | **PASS** |
| No tracebacks exposed to customers | **PASS** |
| PGPASSWORD env var only, never on argv | **PASS** |

---

## Installation Tests (Simulated)

| Test | Status | Notes |
|------|--------|-------|
| Bundled Python 3.12.10 starts | **PASS** | `desktop/runtime/python/python.exe` |
| Django 5.2.17 loads (34 apps) | **PASS** | |
| Waitress serves on port 8778 | **PASS** | |
| Health endpoint HTTP 200 | **PASS** | `{"status":"ok","database":"ok"}` |
| React SPA via WhiteNoise | **PASS** | |
| Setup status pre-auth | **PASS** | |
| All backup endpoints 401 (correct for no-auth) | **PASS** | |
| pg_setup check (correct creds) | **PASS** | `success=true, db_accessible=true` |
| pg_setup check (wrong creds) | **PASS** | `CONNECTION_ERROR` JSON |
| Upgrade test | **Simulated** | `%APPDATA%\POPMYC POS\` never touched by updater |
| Uninstall test | **Verified by ISS** | `[Files]` only writes to `{app}`, never `{userappdata}` |
| Clean PC test | **Requires physical machine** | Cannot fully test in dev environment |

---

## Customer Data Protection

| Scenario | Status |
|----------|--------|
| Application update | **PROTECTED** — only app files replaced |
| Uninstall (Inno Setup) | **PROTECTED** — `%APPDATA%\POPMYC POS\` untouched |
| `electron-updater` install | **PROTECTED** — only app binary replaced |
| `.env` on repeat launch | **PROTECTED** — `existsSync()` check before write |
| DB on `pg_setup --action create` | **PROTECTED** — checks existence before CREATE |
| Backup retention | **PROTECTED** — always keeps ≥ 3 |
| Failed backup | **PROTECTED** — `.tmp` deleted, final never written |
| Restore safety backup | **PROTECTED** — safety backup created before any restore |

---

## Known Issues

1. **Code signing certificate not yet purchased** — installer will show SmartScreen warning on first install. Customers can click "More info → Run anyway". Resolve before public launch.

2. **Update server not deployed** — auto-updates silently skip when no server is configured. This is safe (POS continues working). Deploy before first public version increment.

3. **PostgreSQL auto-installer not implemented** — customers must install PostgreSQL manually. The installer provides a download link and the application guides them through DB setup. A PostgreSQL silent-install option is planned for Stage 5.5+.

4. **Backup restore auto-reconnect** — after a successful restore, the application page-reloads (2.5s delay). A full backend restart is not triggered automatically. Customer may need to restart the application if Django's connection pool is stale.

5. **Icon is programmatically generated** — replace `desktop/resources/icon.ico` with official POPMYC brand artwork before final distribution.

---

## Remaining Prerequisites for Public Release

1. [ ] Purchase and configure EV code-signing certificate
2. [ ] Deploy update server at `https://releases.popmycsolutions.com/popmyc-pos/`
3. [ ] Replace `desktop/resources/icon.ico` with official brand icon
4. [ ] Test on a physical clean Windows 10/11 machine
5. [ ] Create `popmyc_pos` PostgreSQL database on test machine and run full wizard

---

## Stage Completion Status

| Stage | Status |
|-------|--------|
| 5.1 — Desktop Foundation | **COMPLETE** |
| 5.2B — Bundled Python | **COMPLETE** |
| 5.2C — Setup Wizard + License Activation | **COMPLETE** |
| 5.3 — PostgreSQL Assistant + Auto-updates + License Renewal | **COMPLETE** |
| 5.4 — Production Hardening | **COMPLETE** |
| 5.5 — Backup/Restore Complete | **COMPLETE** |
| **Production-ready** | **CONDITIONAL** — see prerequisites above |
