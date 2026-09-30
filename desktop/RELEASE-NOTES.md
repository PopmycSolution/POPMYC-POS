# POPMYC POS Release Notes

## How to publish a new release

### Step 1 — Set your GitHub token (once)
```powershell
$env:GH_TOKEN = "ghp_yourPersonalAccessTokenHere"
```
Create token at: https://github.com/settings/tokens
Required permission: **Contents** (read & write) on `PopmycSolution/POPMYC-POS`

---

### Step 2 — Build the new version
```powershell
cd c:\xampp\htdocs\POS\desktop
npm run build:unpacked
node scripts/build-installer.js
```

---

### Step 3 — Publish to BETA first (test on your own PC)
```powershell
npm run publish:beta
```
This creates a GitHub pre-release tagged `v1.0.0-beta.1`.
Only PCs with `POPMYC_UPDATE_CHANNEL=beta` will see it.
**Real customers are completely unaffected.**

---

### Step 4 — Test the update on your developer PC
Set the beta channel temporarily:
```powershell
$env:POPMYC_UPDATE_CHANNEL = "beta"
```
Open POPMYC POS → Settings → About & Updates → Check for Updates.
It should detect the beta release and offer to download.

---

### Step 5 — Publish to STABLE (customers auto-update)
Once you're happy with the beta:
```powershell
npm run publish:stable
```
This creates a GitHub release tagged `v1.0.0`.
All installed POPMYC POS apps will detect this within 4 hours and
show the customer a "Update available — restart to install" prompt.

---

## Version history

### v1.0.0 (current)
- Initial release
- Full bidirectional cloud sync (local ↔ Render)
- Single/multi-branch setup wizard
- License expiry alerts (role-gated renew button)
- PostgreSQL auto-detection for any port
- Fixed EPERM on backend.log
- Fixed NSSM AppEnvironmentExtra space-splitting bug
- Removed all developer seed data from fresh installs
- Auto-update support (this release)
