/**
 * service-manager.js
 * ==================
 * POPMYC POS — Windows Service Manager (NSSM wrapper)
 *
 * Provides install / uninstall / start / stop / status / query operations
 * for the POPMYCBackend Windows service via NSSM.
 *
 * Used by:
 *   - The Electron main process (main.js) at startup
 *   - The Inno Setup installer (via a separate PowerShell helper)
 *
 * Architecture:
 *   NSSM wraps python.exe + service_launcher.py as a proper Windows service.
 *   The service starts automatically with Windows, before Electron opens.
 *   Electron detects the service is running (port check), skips spawning Django,
 *   and simply waits for the health endpoint to respond.
 *
 * NSSM location (production):
 *   {installDir}\resources\nssm\nssm.exe
 *
 * Service name: POPMYCBackend
 */

'use strict';

const { execFile }  = require('child_process');
const path          = require('path');
const fs            = require('fs');
const http          = require('http');
const os            = require('os');

// ── Constants ─────────────────────────────────────────────────────────────────

const SERVICE_NAME    = 'POPMYCBackend';
const SERVICE_DISPLAY = 'POPMYC POS Backend Service';
const SERVICE_DESC    = 'Runs the POPMYC POS Django/Waitress backend on localhost. Required for the POS to function.';
const BACKEND_PORT    = parseInt(process.env.POPMYC_PORT || '8000', 10);
const HEALTH_URL      = `http://127.0.0.1:${BACKEND_PORT}/api/v1/health/`;

// ── NSSM path resolution ──────────────────────────────────────────────────────

/**
 * Find nssm.exe.
 * In production the installer places it at {app}\resources\nssm\nssm.exe.
 * In dev mode we look relative to the desktop/ directory.
 */
function getNssmPath(appDir) {
  const candidates = [
    // Production: {installDir}\resources\nssm\nssm.exe  (set by Inno Setup)
    appDir ? path.join(appDir, 'resources', 'nssm', 'nssm.exe') : null,
    // electron-builder extraResources land in process.resourcesPath
    process.resourcesPath
      ? path.join(process.resourcesPath, 'nssm', 'nssm.exe')
      : null,
    // Dev fallback: desktop/resources/nssm/nssm.exe
    path.join(__dirname, 'resources', 'nssm', 'nssm.exe'),
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;  // Not found — caller must handle
}

// ── Python executable resolution ──────────────────────────────────────────────

/**
 * Resolve the bundled Python executable.
 * In production: {installDir}\resources\runtime\python\python.exe
 * In dev: backend\.venv-prod\Scripts\python.exe
 */
function getPythonPath(appDir) {
  const IS_DEV = !appDir ||
    (typeof require !== 'undefined' && process.argv.includes('--dev'));

  if (!IS_DEV && appDir) {
    const prod = path.join(appDir, 'resources', 'runtime', 'python', 'python.exe');
    if (fs.existsSync(prod)) return prod;
  }

  // Dev: look for venv-prod or venv next to service-manager.js
  const backendDir = path.join(__dirname, '..', 'backend');
  const devCandidates = [
    path.join(backendDir, '.venv-prod', 'Scripts', 'python.exe'),
    path.join(backendDir, '.venv', 'Scripts', 'python.exe'),
  ];
  for (const c of devCandidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'python';
}

// ── Low-level NSSM executor ───────────────────────────────────────────────────

/**
 * Run an NSSM command and return { code, stdout, stderr }.
 * Rejects only on spawn failure; non-zero exit codes are returned in `code`.
 */
function nssmExec(nssmPath, args, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    execFile(
      nssmPath,
      args,
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout, stderr) => {
        if (err && err.code === 'ENOENT') {
          reject(new Error(`NSSM not found at: ${nssmPath}`));
          return;
        }
        resolve({
          code:   err ? (err.code ?? 1) : 0,
          stdout: (stdout || '').trim(),
          stderr: (stderr || '').trim(),
        });
      },
    );
  });
}

// ── Service status via sc.exe (no NSSM needed for query) ─────────────────────

/**
 * Query the Windows service status using sc.exe.
 * Returns one of: 'running' | 'stopped' | 'starting' | 'stopping' |
 *                 'not-installed' | 'unknown'
 */
function queryServiceState() {
  return new Promise((resolve) => {
    execFile(
      'sc.exe',
      ['query', SERVICE_NAME],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => {
        if (err) {
          // Exit code 1060 = service does not exist
          if (err.code === 1060 || (stdout && stdout.includes('does not exist'))) {
            resolve('not-installed');
          } else {
            resolve('unknown');
          }
          return;
        }
        const out = (stdout || '').toUpperCase();
        if (out.includes('RUNNING'))       resolve('running');
        else if (out.includes('STOPPED'))  resolve('stopped');
        else if (out.includes('START_PENDING')) resolve('starting');
        else if (out.includes('STOP_PENDING'))  resolve('stopping');
        else                               resolve('unknown');
      },
    );
  });
}

// ── Service health check (HTTP) ───────────────────────────────────────────────

/**
 * Probe the health endpoint.
 * Returns { ok: true, data } on HTTP 200, or { ok: false, error } on failure.
 */
function probeHealth(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_URL, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve({ ok: true, data: JSON.parse(body) });
          } catch {
            resolve({ ok: true, data: {} });
          }
        } else {
          resolve({ ok: false, error: `HTTP ${res.statusCode}` });
        }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolve the machine-wide POPMYC data directory.
 * Uses %PROGRAMDATA%\POPMYC POS so the Windows service (running as
 * LocalSystem) and the Electron desktop process (running as the logged-in
 * operator) both see the same .env and log files.
 * Falls back to POPMYC_DATA_DIR env var if explicitly set (dev/override).
 */
function getDefaultDataDir() {
  if (process.env.POPMYC_DATA_DIR) return process.env.POPMYC_DATA_DIR;
  if (process.env.PROGRAMDATA) return path.join(process.env.PROGRAMDATA, 'POPMYC POS');
  // Non-Windows / dev fallback — should never reach here in production
  return path.join(os.homedir ? os.homedir() : process.env.USERPROFILE || '.', 'POPMYC POS');
}

/**
 * Install and configure the POPMYCBackend Windows service via NSSM.
 *
 * @param {object} opts
 * @param {string} opts.appDir      - Application install directory (e.g. C:\Program Files\POPMYC POS)
 * @param {string} [opts.dataDir]   - Persistent data directory. Defaults to %PROGRAMDATA%\POPMYC POS.
 * @returns {Promise<{ok: boolean, message: string}>}
 */
async function installService({ appDir, dataDir }) {
  // Default to the machine-wide ProgramData directory so the LocalSystem
  // service can read the .env regardless of which user account is logged in.
  if (!dataDir) dataDir = getDefaultDataDir();
  const nssmPath = getNssmPath(appDir);
  if (!nssmPath) {
    return { ok: false, message: 'nssm.exe not found. Cannot install service.' };
  }

  const pythonPath    = getPythonPath(appDir);
  const backendDir    = appDir
    ? path.join(appDir, 'resources', 'backend')
    : path.join(__dirname, '..', 'backend');
  const launcherPath  = path.join(backendDir, 'service_launcher.py');
  const stdoutLog     = path.join(dataDir, 'logs', 'service_stdout.log');
  const stderrLog     = path.join(dataDir, 'logs', 'service_stderr.log');

  // Ensure log directory exists
  try {
    fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true });
  } catch { /* already exists */ }

  // Remove any pre-existing service installation first (idempotent install)
  const existing = await queryServiceState();
  if (existing !== 'not-installed') {
    await stopService(nssmPath);
    await nssmExec(nssmPath, ['remove', SERVICE_NAME, 'confirm']);
  }

  // ── Install ──────────────────────────────────────────────────────────────
  // Pass only Application to `nssm install` — the script path and port are
  // set via AppParameters separately.  This is critical for paths containing
  // spaces (e.g. "C:\Program Files (x86)\POPMYC POS\..."):
  //
  //   nssm install POPMYCBackend "C:\...\python.exe"
  //     → sets Application only; AppParameters defaults to empty
  //
  //   nssm set POPMYCBackend AppParameters "\"C:\...\service_launcher.py\" --port 8000"
  //     → stores the entire quoted path as one Windows token so Python
  //       receives it as a single argv[0] regardless of spaces in the path.
  //
  // If we pass launcherPath as a positional arg to `nssm install`, NSSM stores
  // it in AppParameters WITHOUT quotes, and Windows later splits it on spaces,
  // causing Python to receive only "C:\Program" as the script path.
  const installResult = await nssmExec(nssmPath, [
    'install', SERVICE_NAME, pythonPath,
  ]);
  if (installResult.code !== 0) {
    return {
      ok: false,
      message: `NSSM install failed (${installResult.code}): ${installResult.stderr || installResult.stdout}`,
    };
  }

  // Set AppParameters with the launcher path properly quoted.
  // The outer string is the registry value; the inner \" sequences ensure
  // the launcher path is passed as one token to Python's argv.
  const appParams = `"${launcherPath}" --port ${String(BACKEND_PORT)}`;
  const appParamsResult = await nssmExec(nssmPath, [
    'set', SERVICE_NAME, 'AppParameters', appParams,
  ]);
  if (appParamsResult.code !== 0) {
    console.warn(`[ServiceManager] nssm set AppParameters returned ${appParamsResult.code}: ${appParamsResult.stderr}`);
  }

  // ── Configure service properties via nssm set ────────────────────────────
  const settings = [
    // Display name and description
    ['set', SERVICE_NAME, 'DisplayName',   SERVICE_DISPLAY],
    ['set', SERVICE_NAME, 'Description',   SERVICE_DESC],
    // Working directory (backend root so relative imports work)
    ['set', SERVICE_NAME, 'AppDirectory',  backendDir],
    // Environment — passed to the Python process
    ['set', SERVICE_NAME, 'AppEnvironmentExtra',
      `DJANGO_SETTINGS_MODULE=config.settings_desktop\nPOPMYC_DATA_DIR=${dataDir}\nPYTHONUNBUFFERED=1`],
    // Stdout / stderr capture
    ['set', SERVICE_NAME, 'AppStdout',     stdoutLog],
    ['set', SERVICE_NAME, 'AppStderr',     stderrLog],
    // Log rotation (10 MB per file, keep 5 rotated copies)
    ['set', SERVICE_NAME, 'AppRotateFiles',    '1'],
    ['set', SERVICE_NAME, 'AppRotateBytes',    String(10 * 1024 * 1024)],
    ['set', SERVICE_NAME, 'AppRotateOnline',   '1'],
    // Restart behaviour — wait 5 s before restarting on crash
    ['set', SERVICE_NAME, 'AppRestartDelay',   '5000'],
    // Throttle — if it crashes faster than 3 s, consider it a fail-loop
    ['set', SERVICE_NAME, 'AppThrottle',       '3000'],
    // Stop method — send Ctrl+C first, then WM_CLOSE, then kill after 10 s
    ['set', SERVICE_NAME, 'AppStopMethodConsole',  '5000'],
    ['set', SERVICE_NAME, 'AppStopMethodWindow',   '5000'],
    ['set', SERVICE_NAME, 'AppStopMethodThreads',  '10000'],
    // Automatic start — starts when Windows boots
    ['set', SERVICE_NAME, 'Start', 'SERVICE_AUTO_START'],
    // Type — run as a standard service (not interactive)
    ['set', SERVICE_NAME, 'Type', 'SERVICE_WIN32_OWN_PROCESS'],
  ];

  for (const args of settings) {
    const r = await nssmExec(nssmPath, args);
    if (r.code !== 0) {
      // Non-fatal: log but continue — most settings are optional
      console.warn(`[ServiceManager] nssm set ${args[2]} returned ${r.code}: ${r.stderr}`);
    }
  }

  return { ok: true, message: `Service '${SERVICE_NAME}' installed successfully.` };
}

/**
 * Start the POPMYCBackend service.
 * @param {string} [nssmPath]
 * @returns {Promise<{ok: boolean, message: string}>}
 */
async function startService(nssmPath) {
  if (!nssmPath) nssmPath = getNssmPath();

  // Try sc.exe first (lighter, no NSSM needed)
  const result = await new Promise((resolve) => {
    execFile('sc.exe', ['start', SERVICE_NAME], { timeout: 15000, windowsHide: true },
      (err, stdout, stderr) => {
        resolve({
          code:   err ? (err.code ?? 1) : 0,
          stdout: (stdout || '').trim(),
          stderr: (stderr || '').trim(),
        });
      },
    );
  });

  if (result.code === 0 || result.stdout.includes('START_PENDING')) {
    return { ok: true, message: 'Service start initiated.' };
  }
  // Already running is fine
  if (result.code === 1056) {
    return { ok: true, message: 'Service already running.' };
  }
  return { ok: false, message: `sc start failed (${result.code}): ${result.stderr || result.stdout}` };
}

/**
 * Stop the POPMYCBackend service gracefully.
 * @param {string} [nssmPath]
 * @returns {Promise<{ok: boolean, message: string}>}
 */
async function stopService(nssmPath) {
  if (!nssmPath) nssmPath = getNssmPath();

  const result = await new Promise((resolve) => {
    execFile('sc.exe', ['stop', SERVICE_NAME], { timeout: 30000, windowsHide: true },
      (err, stdout, stderr) => {
        resolve({
          code:   err ? (err.code ?? 1) : 0,
          stdout: (stdout || '').trim(),
          stderr: (stderr || '').trim(),
        });
      },
    );
  });

  // 1062 = service not started — treat as success
  if (result.code === 0 || result.code === 1062) {
    return { ok: true, message: 'Service stopped.' };
  }
  return { ok: false, message: `sc stop failed (${result.code}): ${result.stderr || result.stdout}` };
}

/**
 * Remove the POPMYCBackend service completely.
 * Call stopService() first.
 * @param {string} nssmPath
 * @returns {Promise<{ok: boolean, message: string}>}
 */
async function removeService(nssmPath) {
  if (!nssmPath) nssmPath = getNssmPath();
  if (!nssmPath) return { ok: false, message: 'nssm.exe not found.' };

  const r = await nssmExec(nssmPath, ['remove', SERVICE_NAME, 'confirm']);
  if (r.code === 0) return { ok: true, message: 'Service removed.' };
  return { ok: false, message: `nssm remove failed (${r.code}): ${r.stderr || r.stdout}` };
}

/**
 * Full status report for the service.
 * @returns {Promise<{
 *   installed: boolean,
 *   state: string,
 *   healthy: boolean,
 *   healthData: object|null,
 * }>}
 */
async function getServiceStatus() {
  const state   = await queryServiceState();
  const health  = state === 'running' ? await probeHealth() : { ok: false, error: 'not running' };
  return {
    installed:  state !== 'not-installed',
    state,
    healthy:    health.ok,
    healthData: health.ok ? health.data : null,
  };
}

/**
 * Uninstall the service cleanly (stop + remove).
 * Safe to call even if the service is not installed.
 * @param {string} nssmPath
 */
async function uninstallService(nssmPath) {
  if (!nssmPath) nssmPath = getNssmPath();
  if (!nssmPath) return { ok: false, message: 'nssm.exe not found.' };

  const state = await queryServiceState();
  if (state === 'not-installed') return { ok: true, message: 'Service not installed — nothing to remove.' };

  if (state === 'running' || state === 'starting') {
    await stopService(nssmPath);
    // Give it a moment to stop
    await new Promise(r => setTimeout(r, 2000));
  }

  return removeService(nssmPath);
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  SERVICE_NAME,
  SERVICE_DISPLAY,
  SERVICE_DESC,
  BACKEND_PORT,
  HEALTH_URL,
  getNssmPath,
  getPythonPath,
  queryServiceState,
  probeHealth,
  installService,
  startService,
  stopService,
  removeService,
  uninstallService,
  getServiceStatus,
};
