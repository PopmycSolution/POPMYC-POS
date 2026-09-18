#!/usr/bin/env pwsh
<#
.SYNOPSIS
    POPMYC POS Desktop Build Script
    Builds the React frontend, copies it into Django's static root,
    prepares the bundled Python runtime, and optionally packages the
    Electron application into a Windows installer.

.DESCRIPTION
    Run from the project root:
        .\scripts\build-desktop.ps1

    Flags:
        -Package         Also run electron-builder to produce the .exe installer
        -Clean           Delete dist/, staticfiles/, runtime/ and node_modules first
        -NoPython        Skip collectstatic (useful when DB is unavailable on CI)
        -SkipRuntime     Skip the Python runtime preparation step
                         (use when the runtime in desktop/runtime/ is already current)

    Full production build (what POPMyC staff run before distributing):
        .\scripts\build-desktop.ps1 -Package

    Quick dev test build (no installer, skips collectstatic):
        .\scripts\build-desktop.ps1 -NoPython

.NOTES
    Requirements for a full production build:
        - Node.js 18+ with npm
        - Internet access (downloads Python embeddable zip on first build)
        - Python 3.12 + .venv-prod  (only for the collectstatic step)
        - Inno Setup 6 (optional — only if you want the ISS installer separately)

    Customer Requirements (after installing the produced .exe):
        - Windows 10/11 x64
        - PostgreSQL 14+ installed on the machine
        - NO Python, Node.js, npm, PowerShell, or developer tools required

    Output:
        desktop/dist-installer/POPMYC-POS-Setup-1.0.0.exe
#>

param(
    [switch]$Package,
    [switch]$Clean,
    [switch]$NoPython,
    [switch]$SkipRuntime,
    [switch]$SkipNssm       # Skip NSSM download (use when already present)
)

$ErrorActionPreference = "Stop"
$Root       = Split-Path -Parent $PSScriptRoot
$Frontend   = Join-Path $Root "frontend"
$Backend    = Join-Path $Root "backend"
$Desktop    = Join-Path $Root "desktop"
$StaticRoot = Join-Path $Backend "staticfiles"
$RuntimeDir = Join-Path $Desktop "runtime\python"
$NssmDir    = Join-Path $Desktop "resources\nssm"
$NssmExe    = Join-Path $NssmDir "nssm.exe"
$Python     = Join-Path $Backend ".venv-prod\Scripts\python.exe"

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host " POPMYC POS Desktop Build" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# ── [1/7] Clean ───────────────────────────────────────────────────────────────
if ($Clean) {
    Write-Host "[1/8] Cleaning previous build artefacts …" -ForegroundColor Yellow
    $cleanPaths = @(
        (Join-Path $Frontend "dist"),
        $StaticRoot,
        (Join-Path $Desktop "node_modules"),
        (Join-Path $Desktop "dist-installer"),
        (Join-Path $Desktop "runtime"),
        $NssmDir
    )
    foreach ($p in $cleanPaths) {
        if (Test-Path $p) {
            Write-Host "      Removing $p"
            Remove-Item -Recurse -Force $p
        }
    }
    Write-Host "      Clean complete." -ForegroundColor Green
} else {
    Write-Host "[1/8] Skipping clean (-Clean to remove previous artefacts)" -ForegroundColor DarkGray
}

# ── [2/8] Bundled Python runtime (was [2/7]) ──────────────────────────────────
Write-Host ""
if (-not $SkipRuntime) {
    Write-Host "[2/8] Preparing bundled Python runtime …" -ForegroundColor Yellow
    if (Test-Path "$RuntimeDir\python.exe") {
        $ver = & "$RuntimeDir\python.exe" --version 2>&1
        Write-Host "      Runtime already present: $ver" -ForegroundColor Green
        Write-Host "      Use -Clean or -Force in prepare-runtime.ps1 to rebuild." -ForegroundColor DarkGray
    } else {
        Write-Host "      Building runtime (this downloads Python + packages, ~5 min first time) …"
        & (Join-Path $PSScriptRoot "prepare-runtime.ps1")
        if ($LASTEXITCODE -ne 0) { throw "prepare-runtime.ps1 failed" }
    }
} else {
    Write-Host "[2/8] Skipping Python runtime preparation (-SkipRuntime)" -ForegroundColor DarkGray
    if (-not (Test-Path "$RuntimeDir\python.exe")) {
        Write-Host "      WARNING: No bundled Python runtime found at $RuntimeDir" -ForegroundColor Yellow
        Write-Host "      The packaged app will NOT work without it." -ForegroundColor Yellow
    }
}

# ── [3/8] NSSM — Windows service wrapper ──────────────────────────────────────
Write-Host ""
if (-not $SkipNssm) {
    Write-Host "[3/8] Preparing NSSM (Windows service wrapper) …" -ForegroundColor Yellow

    New-Item -ItemType Directory -Force -Path $NssmDir | Out-Null

    if (Test-Path $NssmExe) {
        $nssmVer = & $NssmExe "version" 2>&1 | Select-String "NSSM" | Select-Object -First 1
        Write-Host "      NSSM already present: $nssmVer" -ForegroundColor Green
    } else {
        Write-Host "      Downloading NSSM …"
        # NSSM 2.24-101 (latest stable) — public domain, ~300 KB
        # https://nssm.cc/release/nssm-2.24-101-g897c7ad.zip
        $NssmZipUrl  = "https://nssm.cc/release/nssm-2.24-101-g897c7ad.zip"
        $NssmZipPath = Join-Path $env:TEMP "nssm.zip"
        $NssmExtract = Join-Path $env:TEMP "nssm-extract"

        try {
            Invoke-WebRequest -Uri $NssmZipUrl -OutFile $NssmZipPath -UseBasicParsing -TimeoutSec 60
            if (Test-Path $NssmExtract) { Remove-Item -Recurse -Force $NssmExtract }
            Expand-Archive -Path $NssmZipPath -DestinationPath $NssmExtract -Force
            # The zip contains win64/nssm.exe and win32/nssm.exe — use win64
            $FoundExe = Get-ChildItem -Path $NssmExtract -Filter "nssm.exe" -Recurse |
                        Where-Object { $_.FullName -match "win64" } |
                        Select-Object -First 1
            if (-not $FoundExe) {
                # Fallback: any nssm.exe
                $FoundExe = Get-ChildItem -Path $NssmExtract -Filter "nssm.exe" -Recurse |
                            Select-Object -First 1
            }
            if ($FoundExe) {
                Copy-Item $FoundExe.FullName -Destination $NssmExe -Force
                Write-Host "      NSSM downloaded: $NssmExe" -ForegroundColor Green
            } else {
                throw "nssm.exe not found in downloaded archive"
            }
        } catch {
            Write-Host "      WARNING: Could not download NSSM: $_" -ForegroundColor Yellow
            Write-Host "      You can place nssm.exe manually at: $NssmExe" -ForegroundColor Yellow
            Write-Host "      Download from: https://nssm.cc/download" -ForegroundColor Yellow
            if ($Package) {
                Write-Host "      ERROR: NSSM is required for the installer. Aborting." -ForegroundColor Red
                throw "NSSM download failed and -Package was requested."
            }
        } finally {
            Remove-Item -Path $NssmZipPath -ErrorAction SilentlyContinue
            Remove-Item -Recurse -Force $NssmExtract -ErrorAction SilentlyContinue
        }
    }
} else {
    Write-Host "[3/8] Skipping NSSM download (-SkipNssm)" -ForegroundColor DarkGray
    if (-not (Test-Path $NssmExe)) {
        Write-Host "      WARNING: NSSM not found at $NssmExe" -ForegroundColor Yellow
        Write-Host "      The service will not be installed by the installer." -ForegroundColor Yellow
    }
}

# ── [4/8] Frontend build (was [3/7]) ─────────────────────────────────────────
Write-Host ""
Write-Host "[4/8] Building React frontend …" -ForegroundColor Yellow
Push-Location $Frontend
try {
    if (-not (Test-Path (Join-Path $Frontend "node_modules"))) {
        Write-Host "      Installing npm dependencies …"
        npm install --silent
    }
    $env:VITE_APP_NAME = "POPMYC POS"
    $env:NODE_ENV      = "production"
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed (exit $LASTEXITCODE)" }
    Write-Host "      Frontend build complete." -ForegroundColor Green
} finally {
    Pop-Location
}

# ── [4/7] Copy frontend dist → Django staticfiles ─────────────────────────────
Write-Host ""
Write-Host "[5/8] Copying frontend dist → backend/staticfiles …" -ForegroundColor Yellow
$FrontendDist = Join-Path $Frontend "dist"
if (-not (Test-Path $FrontendDist)) {
    throw "Frontend dist/ not found. Did the build succeed?"
}
New-Item -ItemType Directory -Force -Path $StaticRoot | Out-Null
Copy-Item -Path (Join-Path $FrontendDist "*") -Destination $StaticRoot -Recurse -Force
$count = (Get-ChildItem $StaticRoot -Recurse -File -ErrorAction SilentlyContinue).Count
Write-Host "      Copied $count files to staticfiles/" -ForegroundColor Green

# ── [5/7] Django collectstatic ────────────────────────────────────────────────
if (-not $NoPython) {
    Write-Host ""
    Write-Host "[6/8] Running Django collectstatic …" -ForegroundColor Yellow

    # Prefer the bundled runtime for collectstatic if .venv-prod is unavailable
    $CollectPython = $Python
    if (-not (Test-Path $CollectPython)) {
        if (Test-Path "$RuntimeDir\python.exe") {
            $CollectPython = "$RuntimeDir\python.exe"
            Write-Host "      .venv-prod not found — using bundled runtime"
        } else {
            Write-Host "      WARNING: No Python found for collectstatic — skipping" -ForegroundColor Yellow
            $NoPython = $true
        }
    }

    if (-not $NoPython) {
        $env:DJANGO_SETTINGS_MODULE = "config.settings_desktop"
        $env:POPMYC_DATA_DIR        = Join-Path $env:APPDATA "POPMYC POS"
        Push-Location $Backend
        try {
            & $CollectPython manage.py collectstatic --noinput 2>&1
            if ($LASTEXITCODE -ne 0) {
                Write-Host "      WARNING: collectstatic returned exit $LASTEXITCODE" -ForegroundColor Yellow
            } else {
                Write-Host "      collectstatic complete." -ForegroundColor Green
            }
            $spaIndex = Join-Path $StaticRoot "index.html"
            if (Test-Path $spaIndex) {
                Write-Host "      React SPA confirmed at staticfiles/index.html" -ForegroundColor Green
            } else {
                Write-Host "      WARNING: index.html not found in staticfiles/" -ForegroundColor Yellow
            }
        } finally {
            Pop-Location
        }
    }
} else {
    Write-Host "[6/8] Skipping Django collectstatic (-NoPython)" -ForegroundColor DarkGray
}

# ── [6/7] Electron dependencies ───────────────────────────────────────────────
Write-Host ""
Write-Host "[7/8] Installing Electron dependencies …" -ForegroundColor Yellow
Push-Location $Desktop
try {
    if (-not (Test-Path (Join-Path $Desktop "node_modules"))) {
        npm install --silent
        if ($LASTEXITCODE -ne 0) { throw "npm install in desktop/ failed" }
    } else {
        Write-Host "      node_modules already present." -ForegroundColor DarkGray
    }
    Write-Host "      Electron dependencies OK." -ForegroundColor Green
} finally {
    Pop-Location
}

# ── [7/7] Package (optional) ──────────────────────────────────────────────────
Write-Host ""
if ($Package) {
    Write-Host "[8/8] Packaging Electron application …" -ForegroundColor Yellow
    Write-Host "      This includes: Electron + React SPA + Django backend + Python runtime"
    Write-Host "      Estimated time: 3–8 minutes depending on machine speed"
    Write-Host ""

    # Verify runtime is present before packaging
    if (-not (Test-Path "$RuntimeDir\python.exe")) {
        throw "Bundled Python runtime not found at $RuntimeDir. Run prepare-runtime.ps1 first."
    }

    # Verify NSSM is present before packaging (required for service installation)
    if (-not (Test-Path $NssmExe)) {
        Write-Host "      NSSM not found — downloading now …" -ForegroundColor Yellow
        try {
            $NssmZipUrl  = "https://nssm.cc/release/nssm-2.24-101-g897c7ad.zip"
            $NssmZipPath = Join-Path $env:TEMP "nssm.zip"
            $NssmExtract = Join-Path $env:TEMP "nssm-extract"
            Invoke-WebRequest -Uri $NssmZipUrl -OutFile $NssmZipPath -UseBasicParsing -TimeoutSec 60
            Expand-Archive -Path $NssmZipPath -DestinationPath $NssmExtract -Force
            $FoundExe = Get-ChildItem -Path $NssmExtract -Filter "nssm.exe" -Recurse |
                        Where-Object { $_.FullName -match "win64" } | Select-Object -First 1
            if (-not $FoundExe) {
                $FoundExe = Get-ChildItem -Path $NssmExtract -Filter "nssm.exe" -Recurse | Select-Object -First 1
            }
            if ($FoundExe) {
                New-Item -ItemType Directory -Force -Path $NssmDir | Out-Null
                Copy-Item $FoundExe.FullName -Destination $NssmExe -Force
                Write-Host "      NSSM downloaded OK" -ForegroundColor Green
            } else { throw "nssm.exe not found in archive" }
        } catch {
            throw "NSSM is required for the installer but could not be downloaded: $_"
        } finally {
            Remove-Item -Path (Join-Path $env:TEMP "nssm.zip") -ErrorAction SilentlyContinue
            Remove-Item -Recurse -Force (Join-Path $env:TEMP "nssm-extract") -ErrorAction SilentlyContinue
        }
    }

    Push-Location $Desktop
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "electron-builder failed (exit $LASTEXITCODE)" }
        $InstallerDir = Join-Path $Desktop "dist-installer"
        $installer    = Get-ChildItem $InstallerDir -Filter "*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($installer) {
            Write-Host ""
            Write-Host "  ✅ Installer ready: $($installer.FullName)" -ForegroundColor Green
            Write-Host "     Size: $([math]::Round($installer.Length / 1MB, 1)) MB"
        } else {
            Write-Host "  ⚠  No .exe found in dist-installer/ — check electron-builder output" -ForegroundColor Yellow
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Host "[8/8] Skipping Electron packaging (use -Package to build the installer)" -ForegroundColor DarkGray
}

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host " Build complete." -ForegroundColor Green
Write-Host ""
Write-Host " Dev mode (uses .venv-prod, no installer):" -ForegroundColor White
Write-Host "   cd desktop" -ForegroundColor Gray
Write-Host "   npx electron . --dev" -ForegroundColor Gray
Write-Host ""
Write-Host " Backend-only test (browser mode):" -ForegroundColor White
Write-Host "   cd backend" -ForegroundColor Gray
Write-Host "   python desktop_launcher.py --port 8000" -ForegroundColor Gray
Write-Host "   # Open http://localhost:8000/" -ForegroundColor Gray
Write-Host ""
Write-Host " Service launcher test (no Electron):" -ForegroundColor White
Write-Host "   cd backend" -ForegroundColor Gray
Write-Host "   python service_launcher.py --port 8000" -ForegroundColor Gray
Write-Host ""
if ($Package) {
    Write-Host " Installer: desktop\dist-installer\POPMYC-POS-Setup-1.0.0.exe" -ForegroundColor Green
}
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
