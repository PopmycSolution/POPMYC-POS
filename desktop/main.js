/**
 * POPMYC POS Desktop — Electron Main Process
 * ===========================================
 *
 * Startup sequence (production — service mode):
 *   1. Show splash
 *   2. Check POPMYCBackend Windows service state
 *   3a. Service running → skip Django spawn → health-poll → open SPA
 *   3b. Service installed but stopped → start it → health-poll → open SPA
 *   3c. Service not installed / port free → fall back to child-process mode
 *       (dev mode always uses child-process mode)
 *       → PostgreSQL check → start Django/waitress → health-poll → open SPA
 *   3d. DB needs setup → DbSetupScreen (local HTML, no Django needed)
 *   4. Background: non-blocking update check
 *
 * Service mode benefits:
 *   - Backend starts with Windows, before Electron opens
 *   - Backend survives Electron restarts
 *   - No console window visible to the customer
 *   - Automatic restart on crash (via NSSM)
 */

'use strict';

const { app, BrowserWindow, dialog, shell, ipcMain, Menu } = require('electron');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');
const { spawn } = require('child_process');
const crypto = require('crypto');
const svcMgr = require('./service-manager');

// ── Constants ─────────────────────────────────────────────────────────────────

const APP_NAME        = 'POPMYC POS';
const APP_VERSION     = app.getVersion();
const BACKEND_PORT    = parseInt(process.env.POPMYC_PORT || '8000', 10);
const BACKEND_HOST    = '127.0.0.1';
const BACKEND_URL     = `http://${BACKEND_HOST}:${BACKEND_PORT}`;
const HEALTH_URL      = `${BACKEND_URL}/api/v1/health/`;
const HEALTH_TIMEOUT  = 120;   // seconds
const HEALTH_INTERVAL = 1000;  // ms
const IS_DEV          = process.argv.includes('--dev') || !app.isPackaged;

// Update feed URL — configure before production distribution.
// Set POPMYC_UPDATE_URL environment variable or edit this constant.
// For GitHub releases: 'https://github.com/popmyc/pos/releases/latest/download'
const UPDATE_FEED_URL = process.env.POPMYC_UPDATE_URL || '';

// ── Path helpers ──────────────────────────────────────────────────────────────

function getBackendDir() {
  return IS_DEV
    ? path.join(__dirname, '..', 'backend')
    : path.join(process.resourcesPath, 'backend');
}

function getPythonPath() {
  if (IS_DEV) {
    const p1 = path.join(getBackendDir(), '.venv-prod', 'Scripts', 'python.exe');
    if (fs.existsSync(p1)) return p1;
    const p2 = path.join(getBackendDir(), '.venv', 'Scripts', 'python.exe');
    if (fs.existsSync(p2)) return p2;
  } else {
    const bundled = path.join(process.resourcesPath, 'runtime', 'python', 'python.exe');
    if (fs.existsSync(bundled)) return bundled;
    console.warn('[Desktop] WARNING: Bundled Python not found:', bundled);
  }
  return 'python';
}

function getPythonHome() {
  const p = getPythonPath();
  return p === 'python' ? null : path.dirname(p);
}

function getDataDir() {
  if (process.env.POPMYC_DATA_DIR) return process.env.POPMYC_DATA_DIR;
  return path.join(app.getPath('appData'), 'POPMYC POS');
}

function ensureDataDir() {
  const d = getDataDir();
  ['logs', 'media', 'backups'].forEach(sub =>
    fs.mkdirSync(path.join(d, sub), { recursive: true })
  );
  return d;
}

function generateSecretKey() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*(-_=+)';
  const bytes = crypto.randomBytes(50);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}

function ensureDesktopEnv(dataDir) {
  const envPath = path.join(dataDir, '.env');
  if (!fs.existsSync(envPath)) {
    const secretKey = generateSecretKey();
    const content = [
      `# POPMYC POS Desktop Configuration`,
      `# Generated automatically on first run — ${new Date().toISOString()}`,
      `# DO NOT DELETE this file. It contains your database password.`,
      `DB_NAME=popmyc_pos`,
      `DB_USER=postgres`,
      `DB_PASSWORD=changeme`,
      `DB_HOST=localhost`,
      `DB_PORT=5432`,
      ``,
      `DJANGO_SECRET_KEY=${secretKey}`,
      `DJANGO_DEBUG=False`,
      `DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1`,
      ``,
      `CORS_ALLOWED_ORIGINS=http://localhost:${BACKEND_PORT},http://127.0.0.1:${BACKEND_PORT}`,
      `SYNC_CLOUD_URL=`,
      `SYNC_CLOUD_TOKEN=`,
      ``,
      `# Cloud licensing service — used ONLY for first-run trial activation.`,
      `# DO NOT CHANGE unless directed by POPMYC support.`,
      `CLOUD_SETUP_URL=https://popmyc-pos.onrender.com`,
      ``,
      `POPMYC_CELERY_EAGER=True`,
    ].join('\n');
    fs.writeFileSync(envPath, content, 'utf8');

    // Also write README
    const readme = path.join(dataDir, 'README.txt');
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(readme, [
        'POPMYC POS — Data Directory',
        '============================',
        '',
        'DO NOT DELETE this folder.',
        'Contents:',
        '  .env     — Database & app settings',
        '  logs/    — Log files',
        '  media/   — Uploaded files',
        '  backups/ — Database backups',
        '',
        'Support: popmycsolution@gmail.com | 0256251295 / 0598610304',
      ].join('\n'), 'utf8');
    }
  }
  return envPath;
}

// ── PostgreSQL helpers ────────────────────────────────────────────────────────

/**
 * Run pg_setup.py with the given action and return parsed JSON result.
 * For the 'create' action, pg_password is sent via stdin — never via argv —
 * so it does not appear in the Windows process list (Task Manager, etc.).
 */
function runPgScript(action, dataDir, pgPassword = '') {
  return new Promise((resolve) => {
    const pythonPath   = getPythonPath();
    const pythonHome   = getPythonHome();
    const backendDir   = getBackendDir();
    const scriptPath   = path.join(backendDir, 'pg_setup.py');

    // Password is passed via stdin, NOT via command-line arguments.
    const args = ['--action', action, '--data-dir', dataDir];

    const env = {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONPATH: backendDir,
      ...(pythonHome ? { PYTHONHOME: pythonHome } : {}),
      ...(!IS_DEV ? { PYTHONPATH: backendDir } : {}),
    };

    const proc = spawn(pythonPath, [scriptPath, ...args], {
      cwd: backendDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],   // stdin = pipe so we can write password
      windowsHide: true,
    });

    // For 'create', write the password to stdin then close it
    if (action === 'create' && pgPassword) {
      proc.stdin.write(pgPassword + '\n');
    }
    proc.stdin.end();

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', (code) => {
      // Write stderr to log (never to UI)
      if (stderr.trim()) {
        const logPath = path.join(dataDir, 'logs', 'pg_setup.log');
        try {
          fs.appendFileSync(logPath, `\n=== ${new Date().toISOString()} ===\n${stderr}\n`);
        } catch { /* noop */ }
      }

      try {
        const result = JSON.parse(stdout.trim());
        resolve(result);
      } catch {
        resolve({
          success: false,
          action,
          message: 'PostgreSQL check failed. Check the log file for details.',
          error_code: 'PARSE_ERROR',
          next_step: 'enter_credentials',
        });
      }
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        action,
        message: `Could not run database check: ${err.message}`,
        error_code: 'SPAWN_ERROR',
        next_step: 'enter_credentials',
      });
    });
  });
}

// ── Process management ────────────────────────────────────────────────────────

let backendProcess    = null;
let mainWindow        = null;
let splashWindow      = null;
let dbSetupWindow     = null;   // shown during PostgreSQL setup
let backendStarted    = false;
let shutdownRequested = false;
let startupInProgress = true;

function isPortInUse() {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_URL, { timeout: 500 }, () => resolve(true));
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function waitForBackend() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + HEALTH_TIMEOUT * 1000;
    let attempts = 0;
    function poll() {
      if (shutdownRequested) { reject(new Error('Shutdown requested')); return; }
      if (Date.now() > deadline) {
        reject(new Error(
          `Backend did not start within ${HEALTH_TIMEOUT}s.\n\n` +
          `Check PostgreSQL is running and the database exists.\n\n` +
          `Log: ${path.join(getDataDir(), 'logs', 'backend.log')}`
        ));
        return;
      }
      const req = http.get(HEALTH_URL, { timeout: 2000 }, (res) => {
        if (res.statusCode === 200) resolve(attempts);
        else setTimeout(poll, HEALTH_INTERVAL);
      });
      req.on('error', () => setTimeout(poll, HEALTH_INTERVAL));
      req.on('timeout', () => { req.destroy(); setTimeout(poll, HEALTH_INTERVAL); });
      attempts++;
    }
    poll();
  });
}

// ── Service-mode tracking ─────────────────────────────────────────────────────

// True when we connected to the Windows service rather than spawning ourselves
let usingWindowsService = false;

async function startBackend(dataDir) {
  const backendDir = getBackendDir();
  const pythonPath = getPythonPath();
  const envPath    = ensureDesktopEnv(dataDir);

  // ── Production: try Windows service first ─────────────────────────────────
  if (!IS_DEV) {
    try {
      const svcState = await svcMgr.queryServiceState();
      console.log(`[Desktop] Windows service state: ${svcState}`);

      if (svcState === 'running') {
        // Service is already running — just wait for the health endpoint.
        console.log('[Desktop] POPMYCBackend service is running — skipping Django spawn.');
        usingWindowsService = true;
        backendStarted = true;
        return;
      }

      if (svcState === 'stopped') {
        // Service is installed but not yet started — start it now.
        console.log('[Desktop] POPMYCBackend service is stopped — starting service …');
        const startResult = await svcMgr.startService();
        if (startResult.ok) {
          usingWindowsService = true;
          backendStarted = true;
          return;
        }
        console.warn('[Desktop] Service start failed:', startResult.message, '— falling back to child-process mode');
      }

      if (svcState === 'starting') {
        // Windows is already starting the service — just wait.
        console.log('[Desktop] POPMYCBackend service is starting — waiting …');
        usingWindowsService = true;
        backendStarted = true;
        return;
      }

      // svcState === 'not-installed' or 'unknown' — fall through to child-process
      if (svcState === 'not-installed') {
        console.log('[Desktop] POPMYCBackend service not installed — using child-process mode.');
      }
    } catch (svcErr) {
      console.warn('[Desktop] Service check failed:', svcErr.message, '— falling back to child-process mode');
    }
  }

  // ── Child-process fallback (dev mode + service-not-installed fallback) ────
  const portBusy = await isPortInUse();
  if (portBusy) {
    console.log('[Desktop] Port already in use — backend assumed running.');
    backendStarted = true;
    return;
  }

  const pythonHome = getPythonHome();
  const env = {
    ...process.env,
    DJANGO_SETTINGS_MODULE: 'config.settings_desktop',
    POPMYC_DATA_DIR: dataDir,
    POPMYC_ENV_FILE: envPath,
    POPMYC_DOTENV_PATH: envPath,
    PYTHONPATH: backendDir,
    PYTHONUNBUFFERED: '1',
    ...(pythonHome ? { PYTHONHOME: pythonHome } : {}),
    ...(!IS_DEV ? { PYTHONPATH: backendDir } : {}),
  };

  // In production fall-back, use service_launcher.py (no collectstatic overhead).
  // In dev, use desktop_launcher.py (runs collectstatic, pg_setup etc.).
  const launcherFile = IS_DEV ? 'desktop_launcher.py' : 'service_launcher.py';
  const launcherPath = path.join(backendDir, launcherFile);
const launchArgs = [launcherPath, '--port', String(BACKEND_PORT)];
  console.log(`[Desktop] Starting backend (child-process): ${pythonPath} ${launcherFile}`);

  backendProcess = spawn(pythonPath, launchArgs, {
    cwd: backendDir, env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false, windowsHide: true,
  });

  const logPath   = path.join(dataDir, 'logs', 'backend.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  logStream.write(`\n\n=== Backend started (child-process) ${new Date().toISOString()} ===\n`);

  backendProcess.stdout.on('data', d => {
    logStream.write(d);
    if (IS_DEV) process.stdout.write(`[Backend] ${d}`);
  });
  backendProcess.stderr.on('data', d => {
    logStream.write(`[STDERR] ${d}`);
    if (IS_DEV) process.stderr.write(`[Backend ERR] ${d}`);
  });

  backendProcess.on('exit', (code, signal) => {
    logStream.write(`=== Backend exited code=${code} signal=${signal} ===\n`);
    logStream.end();
    backendStarted = false;
    if (!shutdownRequested && mainWindow) {
      dialog.showErrorBox(
        `${APP_NAME} — Service Error`,
        `The local service stopped unexpectedly (exit code: ${code}).\n\n` +
        `Please restart POPMYC POS.\n\nIf this keeps happening, check:\n` +
        `  • PostgreSQL is running\n  • Database exists\n  • Log: ${logPath}`
      );
      app.quit();
    }
  });

  backendProcess.on('error', err => {
    logStream.write(`ERROR: ${err.message}\n`);
    console.error('[Desktop]', err.message);
  });

  backendStarted = true;
}

function stopBackend() {
  shutdownRequested = true;
  if (!backendProcess) return;
  try {
    backendProcess.kill('SIGTERM');
    const t = setTimeout(() => {
      try { backendProcess.kill('SIGKILL'); } catch { /* already dead */ }
    }, 5000);
    backendProcess.on('exit', () => clearTimeout(t));
  } catch (err) {
    console.error('[Desktop] stopBackend error:', err.message);
  }
  backendProcess = null;
}

// ── Window creators ───────────────────────────────────────────────────────────

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 480, height: 300, frame: false, transparent: false,
    alwaysOnTop: true, resizable: false, center: true,
    backgroundColor: '#0a5c4a',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.on('closed', () => { splashWindow = null; });
}

function createDbSetupWindow() {
  dbSetupWindow = new BrowserWindow({
    width: 520, height: 620, resizable: false, center: true,
    frame: true, backgroundColor: '#f0faf8',
    title: `${APP_NAME} — Database Setup`,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  // Load the self-contained LOCAL HTML file — does NOT need Django to be running.
  // This is critical: when the DB is missing Django cannot start, so we must
  // never try to load from http://localhost:8000/ at this point.
  dbSetupWindow.loadFile(path.join(__dirname, 'db-setup.html'));
  if (!IS_DEV) Menu.setApplicationMenu(null);
  dbSetupWindow.on('closed', () => { dbSetupWindow = null; });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1366, height: 768, minWidth: 1024, minHeight: 640,
    show: false, backgroundColor: '#f0faf8', title: APP_NAME,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  if (!IS_DEV) Menu.setApplicationMenu(null);

  mainWindow.once('ready-to-show', () => {
    if (splashWindow) splashWindow.close();
    mainWindow.show();
    mainWindow.focus();
    if (IS_DEV) mainWindow.webContents.openDevTools();
    // Non-blocking update check after window shows
    scheduleUpdateCheck();
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(BACKEND_URL)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(BACKEND_URL)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });

  mainWindow.loadURL(BACKEND_URL);
}

// ── Auto-updater ──────────────────────────────────────────────────────────────

let updateInfo = null;    // available update info, or null
let updateState = 'idle'; // 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'no-update'

function scheduleUpdateCheck() {
  // Check 10 seconds after startup so it doesn't slow initial load,
  // then every 4 hours.
  setTimeout(() => checkForUpdates(), 10_000);
  setInterval(() => checkForUpdates(), 4 * 60 * 60 * 1000);
}

async function checkForUpdates() {
  if (!UPDATE_FEED_URL) {
    // No update server configured — silently skip
    updateState = 'no-update';
    broadcastUpdateState();
    return;
  }
  if (IS_DEV) {
    updateState = 'no-update';
    broadcastUpdateState();
    return;
  }

  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.setFeedURL(UPDATE_FEED_URL);

    autoUpdater.removeAllListeners();

    autoUpdater.on('checking-for-update', () => {
      updateState = 'checking';
      broadcastUpdateState();
    });

    autoUpdater.on('update-available', (info) => {
      updateInfo = info;
      updateState = 'available';
      broadcastUpdateState();
    });

    autoUpdater.on('update-not-available', () => {
      updateState = 'no-update';
      broadcastUpdateState();
    });

    autoUpdater.on('download-progress', (progress) => {
      updateState = 'downloading';
      broadcastUpdateState(progress);
    });

    autoUpdater.on('update-downloaded', (info) => {
      updateInfo = info;
      updateState = 'ready';
      broadcastUpdateState();
    });

    autoUpdater.on('error', (err) => {
      // Network errors during update check must NEVER block the POS
      console.log('[Updater] Non-critical update error:', err.message);
      updateState = 'error';
      broadcastUpdateState();
    });

    updateState = 'checking';
    broadcastUpdateState();
    await autoUpdater.checkForUpdates();

  } catch (err) {
    // electron-updater may not be installed in dev; fail silently
    console.log('[Updater] Not available:', err.message);
    updateState = 'no-update';
    broadcastUpdateState();
  }
}

function broadcastUpdateState(extra = null) {
  const payload = {
    state: updateState,
    version: APP_VERSION,
    updateVersion: updateInfo?.version ?? null,
    releaseNotes: updateInfo?.releaseNotes ?? null,
    ...( extra ? { progress: extra } : {}),
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:state', payload);
  }
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('app:getVersion',  () => APP_VERSION);
ipcMain.handle('app:getDataDir',  () => getDataDir());
ipcMain.handle('app:openDataDir', () => shell.openPath(getDataDir()));
ipcMain.handle('app:isOnline',    () => true);

// PostgreSQL check
ipcMain.handle('pg:check', async () => {
  const dataDir = getDataDir();
  return runPgScript('check', dataDir);
});

// PostgreSQL create database (pg_password is the admin password — not stored in logs)
ipcMain.handle('pg:create', async (_, pgPassword) => {
  const dataDir = getDataDir();
  return runPgScript('create', dataDir, pgPassword);
});

// Once DB setup is done, signal main.js to continue the full startup
ipcMain.handle('pg:setupComplete', async () => {
  if (dbSetupWindow) {
    dbSetupWindow.close();
    dbSetupWindow = null;
  }
  await continueStartupAfterDb();
  return { ok: true };
});

// Retry the PG check (after user installs PostgreSQL)
ipcMain.handle('pg:retry', async () => {
  return runPgScript('check', getDataDir());
});

// Updater IPC
ipcMain.handle('updater:getState', () => ({
  state: updateState,
  version: APP_VERSION,
  updateVersion: updateInfo?.version ?? null,
}));

ipcMain.handle('updater:checkNow', async () => {
  await checkForUpdates();
  return { state: updateState, version: APP_VERSION, updateVersion: updateInfo?.version ?? null };
});

ipcMain.handle('updater:download', async () => {
  try {
    const { autoUpdater } = require('electron-updater');
    await autoUpdater.downloadUpdate();
  } catch (err) {
    return { ok: false, error: err.message };
  }
  return { ok: true };
});

ipcMain.handle('updater:install', () => {
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.quitAndInstall(false, true);
  } catch (err) {
    console.error('[Updater] Install failed:', err.message);
  }
});

// Open PostgreSQL download page in browser
ipcMain.handle('pg:openDownloadPage', () => {
  shell.openExternal('https://www.postgresql.org/download/windows/');
});

// ── Service IPC handlers ──────────────────────────────────────────────────────

/** Get full service status: installed, state, healthy */
ipcMain.handle('service:getStatus', async () => {
  try {
    return await svcMgr.getServiceStatus();
  } catch (err) {
    return { installed: false, state: 'unknown', healthy: false, healthData: null, error: err.message };
  }
});

/** Probe health endpoint directly */
ipcMain.handle('service:probeHealth', async () => {
  return svcMgr.probeHealth();
});

/** Start the Windows service (requires admin — Electron runs as admin during install) */
ipcMain.handle('service:start', async () => {
  try {
    return await svcMgr.startService();
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

/** Stop the Windows service */
ipcMain.handle('service:stop', async () => {
  try {
    return await svcMgr.stopService();
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

/** Whether Electron connected to the service rather than spawning Django itself */
ipcMain.handle('service:isUsingWindowsService', () => usingWindowsService);

// ── Core startup ──────────────────────────────────────────────────────────────

async function continueStartupAfterDb() {
  const dataDir = getDataDir();
  try {
    await startBackend(dataDir);
await waitForBackend();
createMainWindow();
startupInProgress = false;
  } catch (err) {
    if (splashWindow) splashWindow.close();
    const isDbErr = err.message && (
      err.message.toLowerCase().includes('postgresql') ||
      err.message.toLowerCase().includes('database') ||
      err.message.includes('psycopg')
    );
    dialog.showErrorBox(
      isDbErr ? `${APP_NAME} — Database Error` : `${APP_NAME} — Startup Error`,
      isDbErr
        ? `Cannot connect to the database.\n\n${err.message}\n\nEnsure PostgreSQL is running and restart.`
        : `The application could not start.\n\n${err.message}`
    );
    stopBackend();
    app.quit();
  }
}

app.whenReady().then(async () => {
  createSplashWindow();

  const dataDir = ensureDataDir();
  ensureDesktopEnv(dataDir);

  // ── Step 1: PostgreSQL check ───────────────────────────────────────────────
  const pgResult = await runPgScript('check', dataDir);
  console.log('[Desktop] PG check:', pgResult.error_code ?? 'OK');

if (pgResult.success) {
    // DB ready — proceed directly
    await continueStartupAfterDb();
    return;
}

// DB not ready — open the local setup screen immediately.
// Do NOT try to start Django here — it will fail/hang if the DB doesn't exist.
if (splashWindow) splashWindow.close();

// Open a small window that loads the LOCAL db-setup.html (no Django needed)
createDbSetupWindow();

// Push the PG check result to the page once it finishes loading
if (dbSetupWindow) {
    dbSetupWindow.webContents.on('did-finish-load', () => {
        dbSetupWindow?.webContents.send('pg:checkResult', pgResult);
    });
}
});
app.on('window-all-closed', () => {
  // Do not shut down the backend while Electron is still starting.
  if (startupInProgress) return;

  stopBackend();
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => { if (!mainWindow) createMainWindow(); });
app.on('before-quit', () => { shutdownRequested = true; stopBackend(); });

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
}
