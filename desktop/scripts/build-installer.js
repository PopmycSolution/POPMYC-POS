/**
 * build-installer.js
 * ==================
 * Verifies that win-unpacked and all required bundled assets exist,
 * then compiles popmyc-setup.iss with Inno Setup.
 *
 * Usage:  node scripts/build-installer.js
 *   or:   npm run build:installer   (from desktop/)
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

// ── Paths (all relative to desktop/) ──────────────────────────────────────────
const ROOT    = path.join(__dirname, '..');          // desktop/
const UNPACKED = path.join(ROOT, 'dist-installer', 'win-unpacked');
const ISS      = path.join(ROOT, 'installer', 'popmyc-setup.iss');

// ── Generate app-update.yml in win-unpacked/resources/ ───────────────────────
// electron-updater requires this file in the installed app's resources/ folder
// to know the GitHub repo details and updater cache name.
// Without it, autoUpdater.checkForUpdates() throws "updaterCacheDirName is not
// specified in app-update.yml" — causing "Update check failed" in the UI.
// We generate it here from package.json so Inno Setup can bundle it.
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const pub = PKG.build?.publish || {};
const appUpdateYmlContent = [
  `provider: github`,
  `owner: ${pub.owner || 'PopmycSolution'}`,
  `repo: ${pub.repo || 'POPMYC-POS'}`,
  `updaterCacheDirName: ${PKG.build?.appId?.replace(/\./g, '-') || 'com-popmyc-pos'}-updater`,
  `releaseType: ${pub.releaseType || 'release'}`,
  ``,
].join('\n');

const appUpdateYmlPath = path.join(UNPACKED, 'resources', 'app-update.yml');
console.log('\n📝  Generating app-update.yml...');

// ── Sync version from package.json into the ISS file ─────────────────────────
// This ensures POPMYC-POS-Setup-{version}.exe always matches package.json.
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const issContent  = fs.readFileSync(ISS, 'utf8');
const issUpdated  = issContent.replace(
  /^#define AppVersion\s+"[^"]*"/m,
  `#define AppVersion    "${PKG_VERSION}"`
);
if (issContent !== issUpdated) {
  fs.writeFileSync(ISS, issUpdated, 'utf8');
  console.log(`ℹ️   ISS version patched to ${PKG_VERSION}`);
}

// ── Write app-update.yml to win-unpacked/resources/ ──────────────────────────
// Do this AFTER version patch so the resources/ folder definitely exists.
try {
  fs.mkdirSync(path.join(UNPACKED, 'resources'), { recursive: true });
  fs.writeFileSync(appUpdateYmlPath, appUpdateYmlContent, 'utf8');
  console.log(`  ✅  app-update.yml written to resources/ (enables auto-update)`);
} catch (e) {
  console.warn(`  ⚠️   Could not write app-update.yml: ${e.message}`);
}

// Required files inside win-unpacked
const REQUIRED_IN_UNPACKED = [
  'POPMYC POS.exe',
  path.join('resources', 'backend', 'desktop_launcher.py'),
  path.join('resources', 'backend', 'service_launcher.py'),
  path.join('resources', 'runtime', 'python', 'python.exe'),
];

// NSSM — bundled in desktop/resources/nssm/ and copied by Inno Setup from there
const NSSM_SRC = path.join(ROOT, 'resources', 'nssm', 'nssm.exe');

// Known ISCC locations (winget per-user, system-wide x86, system-wide)
const ISCC_CANDIDATES = [
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
];

// ── Helper ─────────────────────────────────────────────────────────────────────
function fail(msg) {
  console.error('\n❌  BUILD FAILED: ' + msg + '\n');
  process.exit(1);
}

function ok(msg) { console.log('  ✅  ' + msg); }
function info(msg) { console.log('  ℹ️   ' + msg); }

// ── 1. Verify win-unpacked exists ─────────────────────────────────────────────
console.log('\n🔍  Verifying win-unpacked...');
if (!fs.existsSync(UNPACKED)) {
  fail(
    'dist-installer\\win-unpacked\\ not found.\n' +
    '    Run:  npm run build:unpacked   (or npx electron-builder --win --x64 --dir)\n' +
    '    then re-run:  npm run build:installer'
  );
}
ok('win-unpacked exists: ' + UNPACKED);

// ── 2. Verify required files inside win-unpacked ──────────────────────────────
console.log('\n🔍  Verifying bundled files...');
for (const rel of REQUIRED_IN_UNPACKED) {
  const full = path.join(UNPACKED, rel);
  if (!fs.existsSync(full)) {
    fail(`Required file missing in win-unpacked: ${rel}\n    Expected at: ${full}`);
  }
  ok(rel);
}

// ── 3. Verify NSSM ────────────────────────────────────────────────────────────
console.log('\n🔍  Verifying NSSM...');
if (!fs.existsSync(NSSM_SRC)) {
  fail(
    'nssm.exe not found at: ' + NSSM_SRC + '\n' +
    '    Download from https://nssm.cc/ and place nssm.exe (win64) at:\n' +
    '    desktop\\resources\\nssm\\nssm.exe'
  );
}
ok('nssm.exe: ' + NSSM_SRC);

// ── 3c. Verify no developer data artifacts will contaminate the build ──────────
// The backend extraResources excludes .env, media, backups, logs, and desktop_data
// via package.json filters. This step does a final sanity-check to catch any case
// where developer data might have leaked into the source tree in an unexpected place.
console.log('\n🔍  Checking for developer data artifacts...');
const BACKEND_SRC = path.join(ROOT, '..', 'backend');
const devDataChecks = [
  { path: path.join(BACKEND_SRC, '.env'),          label: 'backend/.env (dev credentials)' },
  { path: path.join(BACKEND_SRC, 'desktop_data'),  label: 'backend/desktop_data/ (dev data dir)' },
  { path: path.join(BACKEND_SRC, 'media'),         label: 'backend/media/ (dev uploaded files)' },
  { path: path.join(BACKEND_SRC, 'backups'),       label: 'backend/backups/ (dev DB backups)' },
];
// Check for any .sql, .dump, .sqlite3 in backend tree (not inside .venv)
const { execSync: _execSync } = require('child_process');
const dangerExts = ['.sqlite3', '.db', '.sql', '.dump', '.pgdump', '.backup'];
let dataFilesFound = [];
for (const ext of dangerExts) {
  try {
    const result = _execSync(
      `where /r "${BACKEND_SRC}" *${ext} 2>nul`,
      { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }
    ).split('\n').map(s => s.trim()).filter(s => s &&
      !s.includes('.venv') && !s.includes('node_modules'));
    dataFilesFound.push(...result);
  } catch { /* not found = ok */ }
}
if (dataFilesFound.length > 0) {
  console.warn('\n  ⚠️   WARNING: Potential developer database files found in backend source:');
  dataFilesFound.forEach(f => console.warn('       ' + f));
  console.warn('       These will NOT be packaged (excluded by filter) but should be removed');
  console.warn('       from the source tree before distributing. Add them to .gitignore.\n');
}
// Check .env — excluded but warn so developer is aware
const backendEnv = path.join(BACKEND_SRC, '.env');
if (fs.existsSync(backendEnv)) {
  console.warn('  ⚠️   NOTICE: backend/.env exists with developer credentials.');
  console.warn('       It is excluded from packaging by the extraResources filter.');
  console.warn('       Confirm it is in .gitignore and NOT committed to source control.\n');
}
ok('Developer data artifact check complete.');

// ── 3b. Verify PostgreSQL installer — REQUIRED, hard fail if missing ──────────
// The Inno Setup script bundles postgresql-16.4-1-windows-x64.exe directly.
// Without it the customer installer will NOT automatically install PostgreSQL.
// Run:  npm run download:pg   to download the official EDB installer (~356 MB).
const PG_INSTALLER_FILENAME = 'postgresql-16.4-1-windows-x64.exe';
const PG_INSTALLER_SRC = path.join(ROOT, 'pg-installer', PG_INSTALLER_FILENAME);
console.log('\n🔍  Verifying PostgreSQL installer…');
if (!fs.existsSync(PG_INSTALLER_SRC)) {
  fail(
    `PostgreSQL installer not found at:\n    ${PG_INSTALLER_SRC}\n\n` +
    '    This file is REQUIRED to build an installer that can automatically\n' +
    '    set up PostgreSQL on a customer machine.\n\n' +
    '    Download it with:   npm run download:pg\n' +
    '    Source: https://www.enterprisedb.com/downloads/postgres-postgresql-downloads\n' +
    '    (Official EDB "postgresql-16-4-windows-x64.exe" — ~356 MB)\n\n' +
    '    A build without this file would produce a deficient installer that\n' +
    '    fails to install PostgreSQL. Build aborted.'
  );
}
const pgSize = (fs.statSync(PG_INSTALLER_SRC).size / (1024 * 1024)).toFixed(0);
ok(`${PG_INSTALLER_FILENAME}  (${pgSize} MB)`);

// ── 4. Locate ISCC ────────────────────────────────────────────────────────────
console.log('\n🔍  Locating Inno Setup compiler...');
let ISCC = null;
for (const candidate of ISCC_CANDIDATES) {
  if (fs.existsSync(candidate)) { ISCC = candidate; break; }
}
if (!ISCC) {
  // Try PATH
  const res = spawnSync('where', ['ISCC.exe'], { encoding: 'utf8', shell: true });
  if (res.status === 0 && res.stdout.trim()) {
    ISCC = res.stdout.trim().split('\n')[0].trim();
  }
}
if (!ISCC) {
  fail(
    'Inno Setup 6 (ISCC.exe) not found.\n' +
    '    Install with:  winget install JRSoftware.InnoSetup\n' +
    '    or from:       https://jrsoftware.org/isdl.php'
  );
}
ok('ISCC: ' + ISCC);

// ── 5. Compile the installer ──────────────────────────────────────────────────
console.log('\n🔨  Compiling Inno Setup installer...');
console.log('    ' + ISCC + ' "' + ISS + '"');
console.log();

const result = spawnSync(
  ISCC,
  [ISS],
  { stdio: 'inherit', encoding: 'utf8' }
);

if (result.status !== 0) {
  fail('ISCC compilation failed (exit code ' + result.status + ')');
}

// ── 6. Verify output ──────────────────────────────────────────────────────────
const outputDir  = path.join(ROOT, 'installer');
const installerExe = path.join(outputDir, `POPMYC-POS-Setup-${PKG_VERSION}.exe`);

if (!fs.existsSync(installerExe)) {
  // Also check with spaces (older naming)
  const alt = path.join(outputDir, 'POPMYC POS Setup 1.0.0.exe');
  if (fs.existsSync(alt)) {
    console.log('\n✅  Installer produced: ' + alt);
  } else {
    fail('Installer .exe not found after compilation.\n    Expected: ' + installerExe);
  }
} else {
  const size = (fs.statSync(installerExe).size / (1024 * 1024)).toFixed(1);
  console.log(`\n✅  Installer produced: ${installerExe}  (${size} MB)`);
}

console.log('\n🎉  Build complete.\n');
