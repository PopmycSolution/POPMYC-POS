/**
 * publish-release.js
 * ==================
 * Publishes a POPMYC POS release to GitHub Releases using the GitHub REST API.
 * No gh CLI, no external dependencies — uses Node.js built-in https module.
 *
 * Usage:
 *   node scripts/publish-release.js --channel beta    (test on dev PC only)
 *   node scripts/publish-release.js --channel stable  (customers auto-update)
 *
 * Requirements:
 *   Set GH_TOKEN environment variable before running:
 *     $env:GH_TOKEN = "ghp_yourTokenHere"
 */

'use strict';

const https  = require('https');
const fs     = require('fs');
const path   = require('path');

// ── Parse arguments ────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const channel = (() => {
  const idx = args.indexOf('--channel');
  return (idx !== -1 && args[idx + 1]) ? args[idx + 1] : 'beta';
})();

if (!['stable', 'beta'].includes(channel)) {
  console.error(`\n❌  Unknown channel: ${channel}. Use --channel stable or --channel beta\n`);
  process.exit(1);
}

// ── Config ─────────────────────────────────────────────────────────────────────
const ROOT      = path.join(__dirname, '..');
const PKG       = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION   = PKG.version;
const GH_OWNER  = 'PopmycSolution';
const GH_REPO   = 'POPMYC-POS';
const GH_TOKEN  = process.env.GH_TOKEN || '';

const INSTALLER_DIR = path.join(ROOT, 'installer');
const INSTALLER_EXE = path.join(INSTALLER_DIR, `POPMYC-POS-Setup-${VERSION}.exe`);

// ── Validate ───────────────────────────────────────────────────────────────────
if (!GH_TOKEN) {
  console.error(`
❌  GH_TOKEN is not set.

Run this first:
  $env:GH_TOKEN = "ghp_yourPersonalAccessToken"

Create token at: https://github.com/settings/tokens
Required: repo scope (full)
`);
  process.exit(1);
}

if (!fs.existsSync(INSTALLER_EXE)) {
  console.error(`\n❌  Installer not found: ${INSTALLER_EXE}\n    Build it first: node scripts/build-installer.js\n`);
  process.exit(1);
}

// ── Determine release details ──────────────────────────────────────────────────
const isStable  = channel === 'stable';
const tagName   = isStable ? `v${VERSION}` : `v${VERSION}-beta.1`;
const relName   = isStable ? `POPMYC POS v${VERSION}` : `POPMYC POS v${VERSION} Beta 1`;
const prerel    = !isStable;
const body      = isStable
  ? `## POPMYC POS v${VERSION}\n\nStable release. All customers will auto-update within 4 hours.`
  : `## POPMYC POS v${VERSION} Beta\n\n⚠️ BETA — For internal testing only. Do NOT share with customers.`;

const installerSize = (fs.statSync(INSTALLER_EXE).size / (1024 * 1024)).toFixed(1);

console.log(`
╔══════════════════════════════════════════════════════╗
║   POPMYC POS — GitHub Release Publisher              ║
╚══════════════════════════════════════════════════════╝

  Version  : ${VERSION}
  Channel  : ${channel.toUpperCase()}
  Tag      : ${tagName}
  Pre-rel  : ${prerel}
  Installer: ${path.basename(INSTALLER_EXE)} (${installerSize} MB)
  Repo     : https://github.com/${GH_OWNER}/${GH_REPO}
`);

// ── GitHub API helpers ─────────────────────────────────────────────────────────

function githubRequest(method, path_, body_, extraHeaders) {
  return new Promise((resolve, reject) => {
    const data   = body_ ? (typeof body_ === 'string' ? body_ : JSON.stringify(body_)) : null;
    const isJson = extraHeaders && extraHeaders['Content-Type'] === 'application/octet-stream' ? false : true;

    const opts = {
      hostname: 'api.github.com',
      path:     path_,
      method:   method,
      headers: {
        'Authorization': `Bearer ${GH_TOKEN}`,
        'Accept':        'application/vnd.github+json',
        'User-Agent':    'POPMYC-POS-Publisher/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(data && isJson  ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(data && !isJson ? extraHeaders : {}),
        ...((!data && !isJson) ? extraHeaders || {} : {}),
      },
    };

    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw), headers: res.headers }); }
        catch { resolve({ status: res.statusCode, body: raw, headers: res.headers }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function uploadAsset(uploadUrl, filePath, token) {
  // uploadUrl is like: https://uploads.github.com/repos/.../releases/123/assets{?name,label}
  const base = uploadUrl.replace(/\{.*\}/, '');
  const name = path.basename(filePath);
  const url  = new URL(base);
  url.searchParams.set('name', name);

  return new Promise((resolve, reject) => {
    const fileSize = fs.statSync(filePath).size;
    const fileStream = fs.createReadStream(filePath);

    const opts = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'POST',
      headers: {
        'Authorization':  `Bearer ${token}`,
        'Accept':         'application/vnd.github+json',
        'User-Agent':     'POPMYC-POS-Publisher/1.0',
        'Content-Type':   'application/octet-stream',
        'Content-Length': fileSize,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    };

    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);

    let uploaded = 0;
    fileStream.on('data', chunk => {
      uploaded += chunk.length;
      const pct = ((uploaded / fileSize) * 100).toFixed(1);
      process.stdout.write(`\r  Uploading: ${pct}%  (${(uploaded/1024/1024).toFixed(1)} / ${(fileSize/1024/1024).toFixed(1)} MB)`);
    });
    fileStream.on('end', () => process.stdout.write('\n'));
    fileStream.pipe(req);
  });
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const apiBase = `/repos/${GH_OWNER}/${GH_REPO}`;

  // 1. Check if release already exists
  console.log(`🔍  Checking if release ${tagName} already exists…`);
  const check = await githubRequest('GET', `${apiBase}/releases/tags/${tagName}`);
  if (check.status === 200) {
    console.error(`\n❌  Release ${tagName} already exists on GitHub.`);
    console.error(`    Delete it first: https://github.com/${GH_OWNER}/${GH_REPO}/releases`);
    console.error(`    Or bump the version in desktop/package.json\n`);
    process.exit(1);
  }

  // 2. Create the release
  console.log(`📝  Creating GitHub release ${tagName}…`);
  const create = await githubRequest('POST', `${apiBase}/releases`, {
    tag_name:         tagName,
    target_commitish: 'main',
    name:             relName,
    body,
    draft:            false,
    prerelease:       prerel,
    generate_release_notes: false,
  });

  if (create.status !== 201) {
    console.error(`\n❌  Failed to create release (HTTP ${create.status}):`);
    console.error(JSON.stringify(create.body, null, 2));
    process.exit(1);
  }

  const releaseId  = create.body.id;
  const uploadUrl  = create.body.upload_url;
  const releaseUrl = create.body.html_url;
  console.log(`✅  Release created: ${releaseUrl}`);

  // 3. Upload the installer
  console.log(`\n📤  Uploading installer (${installerSize} MB)…`);
  const upload = await uploadAsset(uploadUrl, INSTALLER_EXE, GH_TOKEN);

  if (upload.status !== 201) {
    console.error(`\n❌  Upload failed (HTTP ${upload.status}):`);
    console.error(JSON.stringify(upload.body, null, 2));
    // Don't exit — release was created, can upload manually
    console.error(`\n    Upload manually at: ${releaseUrl}`);
    process.exit(1);
  }

  const assetUrl = upload.body.browser_download_url;
  console.log(`✅  Installer uploaded: ${assetUrl}`);

  // 4. Done
  console.log(`
╔══════════════════════════════════════════════════════╗`);
  if (isStable) {
    console.log(`║  ✅  STABLE release published successfully!           ║
╚══════════════════════════════════════════════════════╝

  Customers will auto-update within 4 hours.
  Release URL: ${releaseUrl}
`);
  } else {
    console.log(`║  ✅  BETA release published successfully!             ║
╚══════════════════════════════════════════════════════╝

  ℹ️  Real customers are NOT affected (beta channel only).

  To test the auto-update on your own PC:
    1. Set: $env:POPMYC_UPDATE_CHANNEL = "beta"
    2. Open POPMYC POS → Settings → About & Updates → Check for Updates

  When happy, publish to stable:
    npm run publish:stable

  Release URL: ${releaseUrl}
`);
  }
}

main().catch(err => {
  console.error('\n❌  Unexpected error:', err.message);
  process.exit(1);
});
