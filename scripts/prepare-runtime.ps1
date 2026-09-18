#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Downloads the Python 3.12 embeddable runtime and installs all
    production backend dependencies into it.

    Output: desktop/runtime/python/
      ├── python.exe           ← the interpreter customers run
      ├── python312._pth       ← patched to enable site-packages
      ├── python312.zip        ← stdlib
      ├── Lib/site-packages/   ← all production pip packages
      └── ...

    This directory is included in the Electron package via electron-builder
    extraResources and is copied to  resources/runtime/python/  inside the
    installed application.

.DESCRIPTION
    Run once before a production build, or whenever Python or package
    versions need to be updated.

    Run from the project root:
        .\scripts\prepare-runtime.ps1

    Flags:
        -Force    Re-download and rebuild even if the runtime already exists
        -PythonVersion  Override the Python version (default: 3.12.10)

.NOTES
    Requires:
        - Internet access (downloads Python embeddable zip + pip packages)
        - Node.js is NOT required for this step
        - 7-Zip or Windows built-in Expand-Archive (PowerShell 5+)
#>

param(
    [switch]$Force,
    [string]$PythonVersion = "3.12.10"
)

$ErrorActionPreference = "Stop"
$Root       = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $Root "desktop\runtime\python"
$TempDir    = Join-Path $env:TEMP "popmyc-python-build"
$Backend    = Join-Path $Root "backend"
$ReqFile    = Join-Path $Backend "requirements-prod.txt"

# ── Constants ──────────────────────────────────────────────────────────────────
$PythonZipUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
$PipGetUrl    = "https://bootstrap.pypa.io/get-pip.py"
$PythonZip    = Join-Path $TempDir "python-embed.zip"
$GetPipScript = Join-Path $TempDir "get-pip.py"

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host " POPMYC POS — Build Bundled Python Runtime" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host " Python version : $PythonVersion"
Write-Host " Output         : $RuntimeDir"
Write-Host ""

# ── Skip if already built (unless -Force) ─────────────────────────────────────
if ((Test-Path "$RuntimeDir\python.exe") -and -not $Force) {
    $existingVer = & "$RuntimeDir\python.exe" --version 2>&1
    Write-Host "Bundled Python already exists: $existingVer" -ForegroundColor Green
    Write-Host "Use -Force to rebuild." -ForegroundColor DarkGray
    exit 0
}

# ── Create working directories ────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $TempDir    | Out-Null
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

# ── Download embeddable Python ────────────────────────────────────────────────
Write-Host "[1/5] Downloading Python $PythonVersion embeddable …" -ForegroundColor Yellow
if (-not (Test-Path $PythonZip)) {
    Write-Host "      URL: $PythonZipUrl"
    Invoke-WebRequest -Uri $PythonZipUrl -OutFile $PythonZip -UseBasicParsing
    Write-Host "      Downloaded $(([math]::Round((Get-Item $PythonZip).Length / 1MB, 1))) MB" -ForegroundColor Green
} else {
    Write-Host "      Already downloaded — skipping." -ForegroundColor DarkGray
}

# ── Extract the embeddable zip ─────────────────────────────────────────────────
Write-Host ""
Write-Host "[2/5] Extracting Python runtime …" -ForegroundColor Yellow
# Remove old extraction first
if (Test-Path $RuntimeDir) {
    Remove-Item -Recurse -Force $RuntimeDir
}
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
Expand-Archive -Path $PythonZip -DestinationPath $RuntimeDir -Force
Write-Host "      Extracted to $RuntimeDir" -ForegroundColor Green

# ── Patch python312._pth to enable site-packages ─────────────────────────────
# The embeddable zip has site-packages DISABLED by default (commented out).
# We must uncomment 'import site' so pip-installed packages are found.
Write-Host ""
Write-Host "[3/5] Enabling site-packages …" -ForegroundColor Yellow
$pthFile = Join-Path $RuntimeDir "python312._pth"
if (-not (Test-Path $pthFile)) {
    # Try alternate naming (Python 3.12.x may use different naming)
    $pthFile = Get-ChildItem $RuntimeDir -Filter "*.pth" | Where-Object { $_.Name -match "python3" } | Select-Object -First 1 -ExpandProperty FullName
}
if ($pthFile) {
    $content = Get-Content $pthFile -Raw
    # Uncomment 'import site' line — this is the key to enabling pip packages
    $patched = $content -replace '#import site', 'import site'
    if ($patched -eq $content) {
        # It's already uncommented or has different format
        if ($content -notmatch 'import site') {
            $patched = $content + "`nimport site`n"
        }
    }
    Set-Content -Path $pthFile -Value $patched -Encoding UTF8
    Write-Host "      Patched: $pthFile" -ForegroundColor Green
} else {
    Write-Host "      WARNING: Could not find .pth file — site-packages may not be enabled" -ForegroundColor Yellow
}

# ── Install pip into the embeddable runtime ────────────────────────────────────
Write-Host ""
Write-Host "[4/5] Installing pip …" -ForegroundColor Yellow
$pythonExe = Join-Path $RuntimeDir "python.exe"

if (-not (Test-Path $GetPipScript)) {
    Write-Host "      Downloading get-pip.py …"
    Invoke-WebRequest -Uri $PipGetUrl -OutFile $GetPipScript -UseBasicParsing
}
& $pythonExe $GetPipScript --no-warn-script-location 2>&1 | ForEach-Object { Write-Host "      $_" }
if ($LASTEXITCODE -ne 0) { throw "pip installation failed" }
Write-Host "      pip installed." -ForegroundColor Green

# ── Install production dependencies ───────────────────────────────────────────
Write-Host ""
Write-Host "[5/5] Installing production packages …" -ForegroundColor Yellow
Write-Host "      Source: $ReqFile"

$pipExe = Join-Path $RuntimeDir "Scripts\pip.exe"
if (-not (Test-Path $pipExe)) {
    $pipExe = Join-Path $RuntimeDir "pip.exe"
}

& $pythonExe -m pip install `
    --requirement $ReqFile `
    --no-warn-script-location `
    --no-compile `
    --quiet `
    2>&1 | ForEach-Object { Write-Host "      $_" }

if ($LASTEXITCODE -ne 0) { throw "Package installation failed" }
Write-Host "      All production packages installed." -ForegroundColor Green

# ── Verify the runtime works ──────────────────────────────────────────────────
Write-Host ""
Write-Host "Verifying bundled Python …" -ForegroundColor Cyan
$verResult = & $pythonExe -c "
import django, whitenoise, psycopg2
import importlib.metadata as meta
print(f'Django     : {django.__version__}')
print(f'waitress   : {meta.version(\"waitress\")}')
print(f'whitenoise : {whitenoise.__version__}')
print(f'psycopg2   : {psycopg2.__version__}')
print('ALL OK')
" 2>&1
Write-Host $verResult

if ($LASTEXITCODE -ne 0) {
    throw "Runtime verification failed — see output above"
}

# ── Summary ───────────────────────────────────────────────────────────────────
$runtimeSize = (Get-ChildItem $RuntimeDir -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host " Runtime ready." -ForegroundColor Green
Write-Host " Location : $RuntimeDir"
Write-Host " Size     : $([math]::Round($runtimeSize/1MB, 1)) MB"
Write-Host " Python   : $(& $pythonExe --version 2>&1)"
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host " Next step: run the full desktop build:" -ForegroundColor White
Write-Host "   .\scripts\build-desktop.ps1 -Package" -ForegroundColor Gray
Write-Host ""
