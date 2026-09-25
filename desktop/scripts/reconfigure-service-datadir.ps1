# reconfigure-service-datadir.ps1
# ================================
# Run this script as ADMINISTRATOR (right-click → Run as administrator)
# to update the POPMYCBackend Windows service so it uses the shared
# machine-wide ProgramData directory instead of a per-user AppData path.
#
# Must be run once after upgrading to the new installer OR to fix an
# existing installation that was configured with POPMYC_DATA_DIR pointing
# to a specific user's AppData.
#
# Safe to run multiple times (idempotent).

$ErrorActionPreference = 'Stop'
$dataDir = "C:\ProgramData\POPMYC POS"
$nssm    = "C:\Program Files (x86)\POPMYC POS\resources\nssm\nssm.exe"

Write-Host "POPMYC POS — Reconfigure service data directory"
Write-Host "================================================"
Write-Host "New data dir: $dataDir"
Write-Host ""

# Create shared data directory structure
foreach ($sub in @("logs", "media", "backups")) {
    $p = Join-Path $dataDir $sub
    if (-not (Test-Path $p)) {
        New-Item -ItemType Directory -Path $p -Force | Out-Null
        Write-Host "Created: $p"
    }
}

# Migrate .env from old per-user location if ProgramData .env is absent
$oldLocations = @(
    "$env:APPDATA\POPMYC POS\.env"
)
$newEnvPath = Join-Path $dataDir ".env"
if (-not (Test-Path $newEnvPath)) {
    foreach ($old in $oldLocations) {
        if (Test-Path $old) {
            $envContent = Get-Content $old -ErrorAction SilentlyContinue
            # Safety check: warn if the .env being migrated has a non-default port
            # which could indicate it points to a developer's PostgreSQL instance.
            $portLine = $envContent | Where-Object { $_ -match "^DB_PORT=" }
            $port = if ($portLine) { ($portLine -split "=")[1] } else { "5432" }
            if ($port -ne "5432") {
                Write-Warning "The .env at '$old' uses DB_PORT=$port (not the default 5432)."
                Write-Warning "This may point to a developer's PostgreSQL instance."
                Write-Warning "Verify this is correct before proceeding."
                Write-Warning "If this is a developer machine, do NOT run this script on a customer PC."
                $confirm = Read-Host "Copy this .env to $newEnvPath? (y/N)"
                if ($confirm -notmatch "^[Yy]") {
                    Write-Host "Skipped .env migration. Create a fresh .env via the POPMYC Database Setup screen."
                    break
                }
            }
            Copy-Item $old $newEnvPath
            Write-Host "Copied .env from $old -> $newEnvPath"
            break
        }
    }
    if (-not (Test-Path $newEnvPath)) {
        Write-Warning "No .env found to migrate. Operator must complete DB Setup to create it."
    }
}

# Stop the service before reconfiguring
Write-Host "Stopping POPMYCBackend..."
sc.exe stop POPMYCBackend 2>&1 | Out-Null
Start-Sleep -Seconds 4

# Update NSSM service configuration
if (Test-Path $nssm) {
    & $nssm set POPMYCBackend AppEnvironmentExtra `
        "DJANGO_SETTINGS_MODULE=config.settings_desktop" `
        "POPMYC_DATA_DIR=$dataDir" `
        "PYTHONUNBUFFERED=1"
    & $nssm set POPMYCBackend AppStdout "$dataDir\logs\service_stdout.log"
    & $nssm set POPMYCBackend AppStderr "$dataDir\logs\service_stderr.log"
    Write-Host "NSSM service updated via nssm.exe"
} else {
    # Fallback: update registry directly
    $regPath = "HKLM:\SYSTEM\CurrentControlSet\Services\POPMYCBackend\Parameters"
    $envVal  = "DJANGO_SETTINGS_MODULE=config.settings_desktop`nPOPMYC_DATA_DIR=$dataDir`nPYTHONUNBUFFERED=1"
    Set-ItemProperty -Path $regPath -Name "AppEnvironmentExtra" -Value $envVal
    Set-ItemProperty -Path $regPath -Name "AppStdout"           -Value "$dataDir\logs\service_stdout.log"
    Set-ItemProperty -Path $regPath -Name "AppStderr"           -Value "$dataDir\logs\service_stderr.log"
    Write-Host "Service registry updated directly"
}

# Restart the service
Write-Host "Starting POPMYCBackend..."
sc.exe start POPMYCBackend 2>&1 | Out-Null
Start-Sleep -Seconds 6
$state = (sc.exe query POPMYCBackend | Select-String "STATE").ToString().Trim()
Write-Host "Service state: $state"

Write-Host ""
Write-Host "Done. POPMYCBackend now uses: $dataDir"

