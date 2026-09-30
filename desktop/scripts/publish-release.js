/**
 * publish-release.js
 * ==================
 * Publishes a POPMYC POS release to GitHub Releases using the GitHub REST API.
 * No gh CLI, no external dependencies — uses Node.js built-in https/crypto.
 *
 * Usage:
 *   node scripts/publish-release.js --channel beta    (dev test only)
 *   node scripts/publish-release.js --channel stable  (customers auto-update)
 *
 * Requirements:
 *   $env:GH_TOKEN = "ghp_yourTokenHere"
 */

'use strict';

const https  = require('https');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

// ── Parse args ────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const channel = (() => {
  const idx = args.indexOf('--channel');
  return (idx !== -1 && args[idx + 1]) ? args[idx + 1] : 'beta';
})();

if (!['stable', 'beta'].includes(channel)) {
  console.error(`\n❌  Unknown channel: ${channel}. Use --channel stable or --channel beta\n`);
  process.exit(1);
}

// ── Config ────────────────────────────────────────────────────────────────────
const ROOT      = path.join(__dirname, '..');
const PKG       = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION   = PKG.version;
const GH_OWNER  = 'PopmycSolution';
const GH_REPO   = 'POPMYC-POS';
const GH_TOKEN  = process.env.GH_TOKEN || '';

const INSTALLER_DIR = path.join(ROOT, 'installer');
const INSTALLER_EXE = path.join(INSTALLER_DIR, `POPMYC-POS-Setup-${VERSION}.exe`);
const DIST_DIR      = path.join(ROOT, 'dist-installer');

// ── Validate ──────────────────────────────────────────────────────────────────
if (!GH_TOKEN) {
  console.error(`
❌  GH_TOKEN is not set.

Run this first in PowerShell:
  $env:GH_TOKEN = "ghp_yourPersonalAccessToken"

Create token at: https://github.com/settings/tokens
Required: repo scope (full)
`);
  process.exit(1);
}

if (!fs.existsSync(INSTALLER_EXE)) {
  console.error(`\n❌  Installer not found: ${INSTALLER_EXE}\n    Build first: node scripts/build-installer.js\n`);
  process.exit(1);
}

const installerSize = (fs.statSync(INSTALLER_EXE).size / (1024 * 1024)).toFixed(1);
const isStable      = channel === 'stable';

// ── GitHub API ────────────────────────────────────────────────────────────────
function githubRequest(method, apiPath, body_) {
  return new Promise((resolve, reject) => {
    const data = body_ ? JSON.stringify(body_) : null;
    const opts = {
      hostname: 'api.github.com',
      path:     apiPath,
      method,
      headers: {
        'Authorization':        `Bearer ${GH_TOKEN}`,
        'Accept':               'application/vnd.github+json',
        'User-Agent':           'POPMYC-POS-Publisher/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
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
    if (data) req.write(data);
    req.end();
  });
}

function uploadFile(uploadUrl, filePath) {
  const base = uploadUrl.replace(/\{.*\}/, '');
  const name = path.basename(filePath);
  const url  = new URL(base);
  url.searchParams.set('name', name);
  const fileSize = fs.statSync(filePath).size;

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'POST',
      headers: {
        'Authorization':        `Bearer ${GH_TOKEN}`,
        'Accept':               'application/vnd.github+json',
        'User-Agent':           'POPMYC-POS-Publisher/1.0',
        'Content-Type':         'application/octet-stream',
        'Content-Length':       fileSize,
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
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => {
      uploaded += chunk.length;
      const pct = ((uploaded / fileSize) * 100).toFixed(1);
      process.stdout.write(`\r  Uploading ${name}: ${pct}%  (${(uploaded/1024/1024).toFixed(1)} / ${(fileSize/1024/1024).toFixed(1)} MB)`);
    });
    stream.on('end', () => process.stdout.write('\n'));
    stream.pipe(req);
  });
}

function generateYml(version, installerPath, forChannel) {
  const buf    = fs.readFileSync(installerPath);
  const sha512 = crypto.createHash('sha512').update(buf).digest('base64');
  const size   = buf.length;
  const name   = path.basename(installerPath);
  return [
    `version: ${version}`,
    `files:`,
    `  - url: ${name}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${name}`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    ``,
  ].join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const apiBase = `/repos/${GH_OWNER}/${GH_REPO}`;

  // Find next beta number
  let betaNum = 1;
  if (!isStable) {
    try {
      const res = await githubRequest('GET', `${apiBase}/releases?per_page=30`);
      if (res.status === 200 && Array.isArray(res.body)) {
        const nums = res.body
          .map(r => r.tag_name)
          .filter(t => t.startsWith(`v${VERSION}-beta.`))
          .map(t => parseInt(t.split('.').pop()))
          .filter(n => !isNaN(n));
        if (nums.length > 0) betaNum = Math.max(...nums) + 1;
      }
    } catch { /* use 1 */ }
  }

  const tagName = isStable ? `v${VERSION}` : `v${VERSION}-beta.${betaNum}`;
  const relName = isStable ? `POPMYC POS v${VERSION}` : `POPMYC POS v${VERSION} Beta ${betaNum}`;
  const prerel  = !isStable;
  const notes   = isStable
    ? `## POPMYC POS v${VERSION}\n\nStable release. All customers auto-update within 4 hours.`
    : `## POPMYC POS v${VERSION} Beta ${betaNum}\n\n⚠️ BETA — internal testing only. Do NOT share with customers.`;

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

  // 1. Check if release already exists
  console.log(`🔍  Checking if ${tagName} already exists…`);
  const check = await githubRequest('GET', `${apiBase}/releases/tags/${tagName}`);
  if (check.status === 200) {
    console.error(`\n❌  Release ${tagName} already exists.`);
    console.error(`    Delete it at: https://github.com/${GH_OWNER}/${GH_REPO}/releases\n`);
    process.exit(1);
  }

  // 2. Create the release
  console.log(`📝  Creating GitHub release ${tagName}…`);
  const create = await githubRequest('POST', `${apiBase}/releases`, {
    tag_name: tagName, target_commitish: 'main',
    name: relName, body: notes,
    draft: false, prerelease: prerel,
  });

  if (create.status !== 201) {
    console.error(`\n❌  Failed to create release (HTTP ${create.status}):`);
    console.error(JSON.stringify(create.body, null, 2));
    process.exit(1);
  }

  const uploadUrl  = create.body.upload_url;
  const releaseUrl = create.body.html_url;
  console.log(`✅  Release created: ${releaseUrl}`);

  // 3. Upload installer
  console.log(`\n📤  Uploading installer…`);
  const up1 = await uploadFile(uploadUrl, INSTALLER_EXE);
  if (up1.status !== 201) {
    console.error(`\n❌  Installer upload failed (HTTP ${up1.status})`);
    process.exit(1);
  }
  console.log(`✅  Installer uploaded`);

  // 4. Generate and upload latest.yml / latest-beta.yml
  // This is the file electron-updater downloads to detect new versions.
  const ymlName    = isStable ? 'latest.yml' : 'latest-beta.yml';
  const ymlContent = generateYml(VERSION, INSTALLER_EXE, channel);
  const ymlPath    = path.join(DIST_DIR, ymlName);
  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.writeFileSync(ymlPath, ymlContent, 'utf8');

  console.log(`📝  Uploading ${ymlName}…`);
  const up2 = await uploadFile(uploadUrl, ymlPath);
  if (up2.status !== 201) {
    console.warn(`⚠️   ${ymlName} upload failed — auto-update detection may not work.`);
  } else {
    console.log(`✅  ${ymlName} uploaded`);
  }

  // 5. Done
  console.log(isStable ? `
╔══════════════════════════════════════════════════════╗
║  ✅  STABLE release published!                       ║
╚══════════════════════════════════════════════════════╝

  Customers will auto-update within 4 hours.
  Release: ${releaseUrl}
` : `
╔══════════════════════════════════════════════════════╗
║  ✅  BETA release published!                         ║
╚══════════════════════════════════════════════════════╝

  ℹ️  Real customers are NOT affected.

  To test auto-update on your PC:
    1. $env:POPMYC_UPDATE_CHANNEL = "beta"
    2. Open POPMYC POS → Settings → About & Updates → Check for Updates

  Verify via PowerShell:
    Invoke-RestMethod "https://github.com/${GH_OWNER}/${GH_REPO}/releases/download/${tagName}/latest-beta.yml"

  When satisfied → npm run publish:stable

  Release: ${releaseUrl}
`);
}

main().catch(err => {
  console.error('\n❌  Error:', err.message);
  process.exit(1);
});
