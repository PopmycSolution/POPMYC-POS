/**
 * publish-release.js
 * ==================
 * Publishes a new POPMYC POS release to GitHub Releases.
 *
 * Usage:
 *   node scripts/publish-release.js --channel stable   (customers get this)
 *   node scripts/publish-release.js --channel beta     (dev testing only)
 *
 * Requirements:
 *   - Set GH_TOKEN environment variable to a GitHub Personal Access Token
 *     with "Contents" write permission on the PopmycSolution/POPMYC-POS repo.
 *   - The installer must already be built:
 *       npm run build:unpacked  (then node scripts/build-installer.js)
 *
 * What it does:
 *   1. Reads the current version from package.json
 *   2. Creates a GitHub Release tagged v{version} (or v{version}-beta.N)
 *   3. Uploads the .exe installer as a release asset
 *   4. Uploads latest.yml (or latest-beta.yml) so electron-updater can
 *      detect the new version on customer PCs
 *
 * Channel separation:
 *   stable channel → tagged as v1.0.0    → customers auto-update
 *   beta   channel → tagged as v1.0.0-beta.1 → only beta testers update
 *
 * IMPORTANT:
 *   - Never publish to 'stable' until you have tested on 'beta' first.
 *   - beta releases are marked as GitHub "pre-release" — customers on the
 *     stable channel will never see them.
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

// ── Parse arguments ────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const channel = (() => {
  const idx = args.indexOf('--channel');
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return 'beta';   // default to beta for safety
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

// ── Validate prerequisites ─────────────────────────────────────────────────────
if (!GH_TOKEN) {
  console.error(`
❌  GH_TOKEN environment variable is not set.

To set it:
  $env:GH_TOKEN = "ghp_yourPersonalAccessToken"

Create a token at: https://github.com/settings/tokens
Required permissions: Contents (read/write) on PopmycSolution/POPMYC-POS
`);
  process.exit(1);
}

if (!fs.existsSync(INSTALLER_EXE)) {
  console.error(`\n❌  Installer not found: ${INSTALLER_EXE}\n    Build it first: node scripts/build-installer.js\n`);
  process.exit(1);
}

// ── Determine tag name ─────────────────────────────────────────────────────────
let tagName, releaseName, prerelease;
if (channel === 'stable') {
  tagName     = `v${VERSION}`;
  releaseName = `POPMYC POS v${VERSION}`;
  prerelease  = false;
} else {
  // beta: find next beta number for this version
  let betaNum = 1;
  try {
    const tags = execSync(
      `gh release list --repo ${GH_OWNER}/${GH_REPO} --limit 20`,
      { encoding: 'utf8', env: { ...process.env, GH_TOKEN } }
    );
    const betaMatches = tags.match(new RegExp(`v${VERSION}-beta\\.(\\d+)`, 'g')) || [];
    if (betaMatches.length > 0) {
      const nums = betaMatches.map(t => parseInt(t.split('.').pop()));
      betaNum = Math.max(...nums) + 1;
    }
  } catch { /* gh CLI not installed or no releases yet — use 1 */ }
  tagName     = `v${VERSION}-beta.${betaNum}`;
  releaseName = `POPMYC POS v${VERSION} Beta ${betaNum}`;
  prerelease  = true;
}

console.log(`
╔══════════════════════════════════════════════════════╗
║   POPMYC POS — GitHub Release Publisher              ║
╚══════════════════════════════════════════════════════╝

  Version  : ${VERSION}
  Channel  : ${channel.toUpperCase()}
  Tag      : ${tagName}
  Pre-rel  : ${prerelease}
  Installer: ${path.basename(INSTALLER_EXE)} (${(fs.statSync(INSTALLER_EXE).size / (1024*1024)).toFixed(1)} MB)
  Repo     : https://github.com/${GH_OWNER}/${GH_REPO}
`);

// ── Use electron-builder publish ───────────────────────────────────────────────
// electron-builder handles creating the GitHub release, uploading the exe,
// and generating latest.yml / latest-beta.yml automatically.
// We set GH_TOKEN in the environment and let it do the work.

const publishChannel = channel === 'stable' ? 'latest' : 'beta';

console.log(`📤  Publishing via electron-builder to GitHub (channel: ${publishChannel})…\n`);

const result = spawnSync(
  'npx',
  [
    'electron-builder',
    '--win', '--x64',
    '--publish', 'always',
    `-c.publish.channel=${publishChannel}`,
    `-c.publish.prerelease=${prerelease}`,
    // Don't rebuild — just publish what's already in dist-installer/
    '--prepackaged', path.join(ROOT, 'dist-installer', 'win-unpacked'),
  ],
  {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      GH_TOKEN,
      // Tell electron-builder not to sign (we don't have a cert)
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    },
  }
);

if (result.status !== 0) {
  // Fallback: use gh CLI directly if electron-builder publish fails
  console.warn('\n⚠️  electron-builder publish failed. Trying gh CLI fallback…\n');

  try {
    const notes = channel === 'stable'
      ? `POPMYC POS ${tagName} — stable release.\n\nInstall or update from: POPMYC-POS-Setup-${VERSION}.exe`
      : `POPMYC POS ${tagName} — BETA testing only.\n\nDo NOT distribute to customers. For internal testing only.`;

    execSync(
      `gh release create ${tagName} "${INSTALLER_EXE}" ` +
      `--title "${releaseName}" ` +
      `--notes "${notes}" ` +
      `${prerelease ? '--prerelease' : ''} ` +
      `--repo ${GH_OWNER}/${GH_REPO}`,
      {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env, GH_TOKEN },
      }
    );
    console.log(`\n✅  Release created: https://github.com/${GH_OWNER}/${GH_REPO}/releases/tag/${tagName}\n`);
  } catch (ghErr) {
    console.error(`\n❌  Both publish methods failed.\n`);
    console.error(`    Manual option: Go to https://github.com/${GH_OWNER}/${GH_REPO}/releases/new`);
    console.error(`    Tag: ${tagName}`);
    console.error(`    Upload: ${INSTALLER_EXE}\n`);
    process.exit(1);
  }
} else {
  console.log(`\n✅  Published successfully!`);
  console.log(`    Release: https://github.com/${GH_OWNER}/${GH_REPO}/releases/tag/${tagName}`);
  if (channel === 'beta') {
    console.log(`\n    ℹ️  This is a BETA release — customers on stable channel are unaffected.`);
    console.log(`    Test it by setting POPMYC_UPDATE_CHANNEL=beta in your environment.`);
    console.log(`    When satisfied, run: node scripts/publish-release.js --channel stable\n`);
  } else {
    console.log(`\n    ✅  STABLE release — customers will auto-update within 4 hours.\n`);
  }
}
