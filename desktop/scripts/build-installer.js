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
const installerExe = path.join(outputDir, 'POPMYC-POS-Setup-1.0.0.exe');

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
