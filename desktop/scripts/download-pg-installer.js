/**
 * scripts/download-pg-installer.js
 * =================================
 * Build-time helper that downloads the official EDB PostgreSQL 16 Windows
 * installer if it is not already present in desktop/pg-installer/.
 *
 * Usage:
 *   node scripts/download-pg-installer.js
 *   npm run download:pg
 *
 * The downloaded file is placed at:
 *   desktop/pg-installer/postgresql-16-4-windows-x64.exe
 *
 * Source: Official EDB (EnterpriseDB) direct download.
 *   https://www.enterprisedb.com/downloads/postgres-postgresql-downloads
 *
 * This file is ~356 MB. Add desktop/pg-installer/*.exe to .gitignore.
 * It must NOT be committed to source control.
 *
 * After downloading, run:
 *   npm run build:installer
 * to build the full POPMYC POS installer with PostgreSQL bundled.
 */

'use strict';

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

// ── Configuration ─────────────────────────────────────────────────────────────

const PG_VERSION            = '16';
const PG_BUILD              = '4';   // EDB build number for PostgreSQL 16.4
// EDB installer filename format: postgresql-<major>.<minor>-<build>-windows-x64.exe
// Note: minor version and build are separated by a DOT then DASH, not two dashes.
// Confirmed from EDB documentation: postgresql-16.4-1-windows-x64.exe
const PG_INSTALLER_FILENAME = `postgresql-${PG_VERSION}.${PG_BUILD}-1-windows-x64.exe`;
const PG_DOWNLOAD_URL       =
  `https://get.enterprisedb.com/postgresql/${PG_INSTALLER_FILENAME}`;

const DEST_DIR  = path.join(__dirname, '..', 'pg-installer');
const DEST_FILE = path.join(DEST_DIR, PG_INSTALLER_FILENAME);

// A downloaded .exe must be at least 200 MB to be considered valid.
const MIN_SIZE  = 200 * 1024 * 1024;

// EXE files begin with the DOS MZ header signature "MZ" (0x4D 0x5A).
const MZ_MAGIC  = Buffer.from([0x4D, 0x5A]);

// ── Request headers ───────────────────────────────────────────────────────────
// EDB's CDN (Cloudflare) returns 403 for requests that look like automated
// scrapers (no User-Agent, no Accept).  Send a realistic browser-like header
// set so the CDN treats this as a legitimate download.
const REQUEST_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
                     'AppleWebKit/537.36 (KHTML, like Gecko) ' +
                     'Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'application/octet-stream,application/x-msdownload,' +
                     'application/x-msdos-program,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'identity',   // keep raw bytes — no gzip
  'Connection':      'keep-alive',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fail(msg) {
  console.error(`\n❌  DOWNLOAD FAILED: ${msg}\n`);
  process.exit(1);
}
function ok(msg)   { console.log(`  ✅  ${msg}`); }
function info(msg) { console.log(`  ℹ️   ${msg}`); }

// Validate the first 2 bytes of a file to confirm it is a Windows executable.
function validateExe(filePath) {
  try {
    const fd  = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(2);
    fs.readSync(fd, buf, 0, 2, 0);
    fs.closeSync(fd);
    return buf[0] === MZ_MAGIC[0] && buf[1] === MZ_MAGIC[1];
  } catch {
    return false;
  }
}

// ── Already present and valid? ────────────────────────────────────────────────

fs.mkdirSync(DEST_DIR, { recursive: true });

if (fs.existsSync(DEST_FILE)) {
  const size = fs.statSync(DEST_FILE).size;
  if (size >= MIN_SIZE && validateExe(DEST_FILE)) {
    ok(`Already present: ${PG_INSTALLER_FILENAME}  (${Math.round(size / 1048576)} MB)`);
    process.exit(0);
  }
  info(`Existing file invalid or too small (${size} bytes) — re-downloading.`);
  fs.unlinkSync(DEST_FILE);
}

// ── Download ──────────────────────────────────────────────────────────────────

const tmpFile = DEST_FILE + '.tmp';

console.log('\n📥  Downloading official EDB PostgreSQL installer…');
console.log(`    Version : PostgreSQL ${PG_VERSION} (build ${PG_BUILD})`);
console.log(`    URL     : ${PG_DOWNLOAD_URL}`);
console.log(`    Dest    : ${DEST_FILE}`);
console.log(`    Size    : ~356 MB — this may take several minutes.\n`);

/**
 * Download downloadUrl to destPath, following redirects.
 * Uses https.request (not the convenience .get) so that request headers
 * are sent on every hop, including after CDN redirects.
 */
function download(downloadUrl, destPath, redirectsLeft = 10) {
  if (redirectsLeft <= 0) { fail('Too many redirects.'); return; }

  // Use the built-in URL class (Node 10+) — url.parse() is deprecated.
  let parsed;
  try {
    parsed = new URL(downloadUrl);
  } catch (e) {
    fail(`Invalid URL: ${downloadUrl}`);
    return;
  }

  const client  = parsed.protocol === 'https:' ? https : http;
  const options = {
    hostname: parsed.hostname,
    port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path:     parsed.pathname + parsed.search,
    method:   'GET',
    headers:  REQUEST_HEADERS,
    timeout:  10 * 60 * 1000,   // 10 minutes
  };

  const req = client.request(options, (res) => {

    // ── Redirects ──────────────────────────────────────────────────────────
    if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
      const location = res.headers['location'];
      if (!location) { fail('Redirect with no Location header.'); return; }
      // Resolve relative redirects against the current URL base.
      const next = location.startsWith('http')
        ? location
        : new URL(location, downloadUrl).href;
      info(`Redirect (${res.statusCode}) → ${next.slice(0, 100)}`);
      res.resume();   // drain the response body before following redirect
      download(next, destPath, redirectsLeft - 1);
      return;
    }

    // ── Non-200 errors ─────────────────────────────────────────────────────
    if (res.statusCode !== 200) {
      // Drain body to get any error message, then fail.
      let body = '';
      res.on('data', (chunk) => { body += chunk.toString('utf8', 0, 512); });
      res.on('end', () => {
        fail(
          `HTTP ${res.statusCode} from ${downloadUrl.slice(0, 100)}\n` +
          (body ? `    Server response: ${body.slice(0, 200)}` : '')
        );
      });
      return;
    }

    // ── Stream to disk ─────────────────────────────────────────────────────
    const total   = parseInt(res.headers['content-length'] || '0', 10);
    let received  = 0;
    let lastPct   = -1;

    const outStream = fs.createWriteStream(destPath);

    res.on('data', (chunk) => {
      received += chunk.length;
      outStream.write(chunk);
      if (total > 0) {
        const pct = Math.floor((received / total) * 100);
        if (pct !== lastPct && pct % 5 === 0) {
          process.stdout.write(
            `  ${String(pct).padStart(3)}%  ` +
            `(${Math.round(received / 1048576)} / ${Math.round(total / 1048576)} MB)\r`
          );
          lastPct = pct;
        }
      }
    });

    res.on('end', () => {
      outStream.end(() => {
        process.stdout.write('\n');

        const finalSize = fs.statSync(destPath).size;

        // ── Size validation ────────────────────────────────────────────────
        if (finalSize < MIN_SIZE) {
          try { fs.unlinkSync(destPath); } catch { /* ignore */ }
          fail(
            `Downloaded file is too small (${finalSize} bytes — expected ≥${Math.round(MIN_SIZE / 1048576)} MB).\n` +
            '    The download may have been truncated or the URL may have changed.\n' +
            '    Try downloading manually from:\n' +
            '    https://www.enterprisedb.com/downloads/postgres-postgresql-downloads'
          );
          return;
        }

        // ── Executable signature validation ────────────────────────────────
        if (!validateExe(destPath)) {
          // Read first few bytes to help diagnose what was downloaded
          try {
            const sample = fs.readFileSync(destPath, { encoding: 'utf8',
                                                        flag: 'r',
                                                        end: 200 });
            if (sample.includes('<html') || sample.includes('<!DOCTYPE') ||
                sample.includes('<?xml')) {
              try { fs.unlinkSync(destPath); } catch { /* ignore */ }
              fail(
                `Downloaded file appears to be an HTML/XML error page, not an executable.\n` +
                '    The EDB download server may have returned an error document.\n' +
                `    First 200 chars: ${sample.slice(0, 200)}`
              );
              return;
            }
          } catch { /* ignore — just report the generic message below */ }
          try { fs.unlinkSync(destPath); } catch { /* ignore */ }
          fail(
            `Downloaded file does not start with the Windows executable (MZ) signature.\n` +
            '    The file may be corrupted or the URL may have changed.'
          );
          return;
        }

        // ── Success ────────────────────────────────────────────────────────
        fs.renameSync(destPath, DEST_FILE);
        ok(`Downloaded: ${PG_INSTALLER_FILENAME}  (${Math.round(finalSize / 1048576)} MB)`);
        ok(`MZ signature validated — confirmed Windows executable.`);
        console.log('\n🎉  PostgreSQL installer ready for bundling.\n');
        console.log('    Next step:  npm run build:installer\n');
      });
    });

    res.on('error', (err) => {
      outStream.destroy();
      try { fs.unlinkSync(destPath); } catch { /* ignore */ }
      fail(`Stream error: ${err.message}`);
    });
  });

  req.on('timeout', () => {
    req.destroy();
    try { fs.unlinkSync(destPath); } catch { /* ignore */ }
    fail('Download timed out after 10 minutes.');
  });

  req.on('error', (err) => {
    try { fs.unlinkSync(destPath); } catch { /* ignore */ }
    fail(`Request error: ${err.message}`);
  });

  req.end();
}

download(PG_DOWNLOAD_URL, tmpFile);
