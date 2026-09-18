; POPMYC POS — Inno Setup Installer Script v1.1.0
; =================================================
; Professional Windows installer for POPMYC POS.
; Requires Inno Setup 6.x  →  https://jrsoftware.org/isinfo.php
;
; What this installer does:
;   1. Installs the Electron application (which bundles Python, Django,
;      the React SPA, and all backend dependencies).
;   2. Installs nssm.exe (bundled in resources\nssm\).
;   3. Registers the POPMYCBackend Windows service via NSSM.
;   4. Configures the service for automatic startup.
;   5. Starts the service so the backend is ready before Electron launches.
;   6. Creates Start Menu + optional Desktop shortcut.
;   7. Creates %APPDATA%\POPMYC POS\  (customer data directory).
;   8. Warns if PostgreSQL is not detected.
;   9. Optionally launches the app after install.
;
; On UPGRADE (install over existing installation):
;   - Stops the service before replacing files.
;   - Reconfigures the service after new files are in place.
;   - Restarts the service.
;   - NEVER touches %APPDATA%\POPMYC POS\ customer data.
;
; On UNINSTALL:
;   - Stops the POPMYCBackend service.
;   - Removes the service registration.
;   - Removes application files from {autopf}\POPMYC POS\.
;   - NEVER deletes %APPDATA%\POPMYC POS\ customer data.
;
; Data directory:    %APPDATA%\POPMYC POS\      ← customer data, NEVER deleted
; Install directory: {autopf}\POPMYC POS\       ← app files, replaced on upgrade
; Service name:      POPMYCBackend

#define AppName       "POPMYC POS"
#define AppVersion    "1.0.0"
#define AppPublisher  "POPMyC Solutions"
#define AppExeName    "POPMYC POS.exe"
#define AppURL        "https://popmycsolutions.com"
#define ServiceName   "POPMYCBackend"

[Setup]
AppId={{D7A1B2C3-4E5F-6789-ABCD-EF0123456789}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/support
AppUpdatesURL={#AppURL}/updates
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
AllowNoIcons=yes
OutputDir=.
OutputBaseFilename=POPMYC-POS-Setup-{#AppVersion}
SetupIconFile=..\resources\icon.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Admin rights required — needed to install a Windows service
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\{#AppExeName}
; ── Critical: do NOT touch %APPDATA%\POPMYC POS\ on uninstall ──────────────
; Customer data (database config, logs, media, backups) lives there.
UninstallFilesDir={app}
; Allow running the uninstaller even if the application is open
CloseApplications=yes
CloseApplicationsFilter=*.exe

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &Desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
; ── The entire Electron application (produced by electron-builder --dir) ──────
; Includes: Electron runtime, Node modules, backend Python code,
; bundled Python 3.12 runtime + site-packages, and the built React SPA.
; NO external Python, Node.js, or npm is required on the customer machine.
Source: "..\dist-installer\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

; ── NSSM — Windows service wrapper ───────────────────────────────────────────
; nssm.exe wraps python.exe + service_launcher.py as a Windows service.
; It is bundled here so no internet access is required during installation.
; NSSM is public domain: https://nssm.cc/
; Place nssm.exe in desktop\resources\nssm\ before building the installer.
; The build script (scripts\build-desktop.ps1 -Package) downloads it automatically.
Source: "..\resources\nssm\nssm.exe"; DestDir: "{app}\resources\nssm"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}";           Filename: "{app}\{#AppExeName}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{commondesktop}\{#AppName}";   Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
; ── Launch POPMYC POS after installation ──────────────────────────────────────
; Service is already started by CurStepChanged(ssPostInstall) below,
; so Electron will find the backend ready on launch.
Filename: "{app}\{#AppExeName}"; \
  Description: "Launch {#AppName}"; \
  Flags: nowait postinstall skipifsilent shellexec

[UninstallRun]
; ── Stop and remove the service before uninstalling files ────────────────────
; RunOnceId ensures this runs exactly once even if uninstall is interrupted.
; We stop first, then remove — NSSM handles both gracefully.
Filename: "{app}\resources\nssm\nssm.exe"; \
  Parameters: "stop {#ServiceName}"; \
  Flags: runhidden waituntilterminated; \
  RunOnceId: "StopService"
Filename: "{app}\resources\nssm\nssm.exe"; \
  Parameters: "remove {#ServiceName} confirm"; \
  Flags: runhidden waituntilterminated; \
  RunOnceId: "RemoveService"

[Code]
// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL detection
// ─────────────────────────────────────────────────────────────────────────────
function IsPostgreSQLInstalled(): Boolean;
var
  PgPath: String;
begin
  Result := False;
  if RegQueryStringValue(HKLM64, 'SOFTWARE\PostgreSQL Global Development Group\PostgreSQL', 'Location', PgPath) then begin
    Result := True; Exit;
  end;
  if RegQueryStringValue(HKLM32, 'SOFTWARE\PostgreSQL Global Development Group\PostgreSQL', 'Location', PgPath) then begin
    Result := True; Exit;
  end;
  if DirExists('C:\Program Files\PostgreSQL') then begin
    Result := True; Exit;
  end;
  if DirExists('C:\Program Files (x86)\PostgreSQL') then begin
    Result := True; Exit;
  end;
end;

// ─────────────────────────────────────────────────────────────────────────────
// NSSM helpers
// ─────────────────────────────────────────────────────────────────────────────

function GetNssmPath(): String;
begin
  Result := ExpandConstant('{app}\resources\nssm\nssm.exe');
end;

function GetPythonPath(): String;
begin
  // Bundled Python runtime installed by electron-builder extraResources
  Result := ExpandConstant('{app}\resources\runtime\python\python.exe');
end;

function GetBackendDir(): String;
begin
  Result := ExpandConstant('{app}\resources\backend');
end;

function GetLauncherPath(): String;
begin
  Result := ExpandConstant('{app}\resources\backend\service_launcher.py');
end;

function GetDataDir(): String;
begin
  Result := ExpandConstant('{userappdata}\POPMYC POS');
end;

// Run an NSSM command silently and return the exit code.
// ResultCode is set to the process exit code.
function RunNssm(Params: String): Boolean;
var
  NssmPath, Cmd: String;
  ResultCode: Integer;
begin
  NssmPath := GetNssmPath();
  Result := Exec(NssmPath, Params, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

// ─────────────────────────────────────────────────────────────────────────────
// Stop existing service (safe to call even if not installed)
// ─────────────────────────────────────────────────────────────────────────────
procedure StopExistingService();
var
  ResultCode: Integer;
begin
  // sc.exe stop — faster than NSSM for just stopping
  Exec(ExpandConstant('{sys}\sc.exe'), 'stop {#ServiceName}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  // Give it 3 seconds to stop cleanly
  Sleep(3000);
end;

// ─────────────────────────────────────────────────────────────────────────────
// Install and configure the Windows service
// ─────────────────────────────────────────────────────────────────────────────
procedure InstallWindowsService();
var
  NssmPath, PythonPath, BackendDir, LauncherPath, DataDir: String;
  StdoutLog, StderrLog: String;
  ResultCode: Integer;
begin
  NssmPath    := GetNssmPath();
  PythonPath  := GetPythonPath();
  BackendDir  := GetBackendDir();
  LauncherPath := GetLauncherPath();
  DataDir     := GetDataDir();
  StdoutLog   := DataDir + '\logs\service_stdout.log';
  StderrLog   := DataDir + '\logs\service_stderr.log';

  // Guard: if NSSM was not installed (source file missing), skip gracefully
  if not FileExists(NssmPath) then begin
    Log('NSSM not found at ' + NssmPath + ' — skipping service installation');
    Exit;
  end;

  // Remove any previous service installation (idempotent)
  Exec(NssmPath, 'remove {#ServiceName} confirm', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(1000);

  // ── Install ────────────────────────────────────────────────────────────────
  // nssm install <ServiceName> <Application> <AppParameters>
  if not Exec(NssmPath,
    'install {#ServiceName} "' + PythonPath + '" "' + LauncherPath + '" --port 8000',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
  begin
    Log('NSSM install failed with code ' + IntToStr(ResultCode));
    MsgBox(
      'Warning: Could not install the POPMYC POS background service.' + #13#10 + #13#10 +
      'POPMYC POS will still work, but you will need to keep it open' + #13#10 +
      'for the backend to remain available.' + #13#10 + #13#10 +
      'Error code: ' + IntToStr(ResultCode),
      mbInformation, MB_OK
    );
    Exit;
  end;

  // ── Configure service properties ──────────────────────────────────────────
  Exec(NssmPath, 'set {#ServiceName} DisplayName "POPMYC POS Backend Service"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  Exec(NssmPath, 'set {#ServiceName} Description "Runs the POPMYC POS Django/Waitress backend. Required for POS operation."',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // Working directory — backend root for Python imports
  Exec(NssmPath, 'set {#ServiceName} AppDirectory "' + BackendDir + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // Environment variables
  Exec(NssmPath,
    'set {#ServiceName} AppEnvironmentExtra ' +
    '"DJANGO_SETTINGS_MODULE=config.settings_desktop" ' +
    '"POPMYC_DATA_DIR=' + DataDir + '" ' +
    '"PYTHONUNBUFFERED=1"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // Stdout and stderr captured by NSSM → log files
  Exec(NssmPath, 'set {#ServiceName} AppStdout "' + StdoutLog + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(NssmPath, 'set {#ServiceName} AppStderr "' + StderrLog + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // Log rotation: rotate at 10 MB, keep rotated copies
  Exec(NssmPath, 'set {#ServiceName} AppRotateFiles 1',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(NssmPath, 'set {#ServiceName} AppRotateBytes 10485760',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(NssmPath, 'set {#ServiceName} AppRotateOnline 1',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // Restart on crash: wait 5 s before restart; throttle rapid restarts
  Exec(NssmPath, 'set {#ServiceName} AppRestartDelay 5000',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(NssmPath, 'set {#ServiceName} AppThrottle 5000',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // Stop method: send Ctrl+C first (so Python can clean up), then kill
  Exec(NssmPath, 'set {#ServiceName} AppStopMethodConsole 8000',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(NssmPath, 'set {#ServiceName} AppStopMethodWindow 3000',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(NssmPath, 'set {#ServiceName} AppStopMethodThreads 10000',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // Automatic startup — starts with Windows
  Exec(NssmPath, 'set {#ServiceName} Start SERVICE_AUTO_START',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // ── Start the service now ─────────────────────────────────────────────────
  Exec(ExpandConstant('{sys}\sc.exe'), 'start {#ServiceName}',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  Log('POPMYCBackend service installed and started (sc exit=' + IntToStr(ResultCode) + ')');
end;

// ─────────────────────────────────────────────────────────────────────────────
// Upgrade: stop service before replacing files
// ─────────────────────────────────────────────────────────────────────────────
procedure StopServiceForUpgrade();
var
  ResultCode: Integer;
begin
  // Only stop if service exists — sc query returns non-zero if not installed
  Exec(ExpandConstant('{sys}\sc.exe'), 'query {#ServiceName}',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if ResultCode = 0 then begin
    Log('Stopping existing service for upgrade …');
    Exec(ExpandConstant('{sys}\sc.exe'), 'stop {#ServiceName}',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Sleep(4000);  // Give backend time to finish in-flight requests
  end;
end;

// ─────────────────────────────────────────────────────────────────────────────
// Create customer data directory + README on first install
// ─────────────────────────────────────────────────────────────────────────────
procedure CreateCustomerDataDirectory();
var
  DataDir, ReadmePath: String;
  Lines: TArrayOfString;
begin
  DataDir := GetDataDir();

  ForceDirectories(DataDir);
  ForceDirectories(DataDir + '\logs');
  ForceDirectories(DataDir + '\media');
  ForceDirectories(DataDir + '\backups');

  ReadmePath := DataDir + '\README.txt';
  if not FileExists(ReadmePath) then begin
    SetArrayLength(Lines, 20);
    Lines[0]  := 'POPMYC POS — Customer Data Directory';
    Lines[1]  := '=====================================';
    Lines[2]  := '';
    Lines[3]  := 'This folder contains YOUR business data.';
    Lines[4]  := 'DO NOT DELETE this folder.';
    Lines[5]  := 'It is NOT deleted when you update or uninstall POPMYC POS.';
    Lines[6]  := '';
    Lines[7]  := 'Contents:';
    Lines[8]  := '  .env      — Database connection and application settings';
    Lines[9]  := '  logs/     — Application log files (auto-rotating)';
    Lines[10] := '  media/    — Uploaded files (logos, receipts, avatars)';
    Lines[11] := '  backups/  — Database backup files';
    Lines[12] := '';
    Lines[13] := 'Windows Service:';
    Lines[14] := '  POPMYC POS installs a background Windows service (POPMYCBackend).';
    Lines[15] := '  This service starts automatically with Windows.';
    Lines[16] := '  Do not disable it — the POS needs it to function.';
    Lines[17] := '';
    Lines[18] := 'Database:';
    Lines[19] := '  Edit .env to change database host, name, or password.';
    SaveStringsToFile(ReadmePath, Lines, False);
  end;
end;

// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL missing warning at setup start
// ─────────────────────────────────────────────────────────────────────────────
function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  Result := True;

  if not IsPostgreSQLInstalled() then begin
    case MsgBox(
      'POPMYC POS requires PostgreSQL to store your business data.' + #13#10 + #13#10 +
      'PostgreSQL does not appear to be installed on this computer.' + #13#10 + #13#10 +
      'You can still install POPMYC POS now, then install PostgreSQL separately.' + #13#10 +
      'The POPMYC POS service will wait for PostgreSQL to become available.' + #13#10 + #13#10 +
      'Would you like to open the PostgreSQL download page?',
      mbConfirmation,
      MB_YESNOCANCEL
    ) of
      IDYES: begin
        ShellExec('open', 'https://www.postgresql.org/download/windows/', '', '', SW_SHOWNORMAL, ewNoWait, ResultCode);
      end;
      IDNO: begin
        // Continue without opening browser
      end;
      IDCANCEL: begin
        Result := False;
      end;
    end;
  end;
end;

// ─────────────────────────────────────────────────────────────────────────────
// CurStepChanged — main install/upgrade orchestration
// ─────────────────────────────────────────────────────────────────────────────
procedure CurStepChanged(CurStep: TSetupStep);
begin
  case CurStep of

    // ── ssInstall: before files are copied ───────────────────────────────────
    // Stop the existing service so files are not locked during copy.
    ssInstall:
      StopServiceForUpgrade();

    // ── ssPostInstall: after all files are in place ───────────────────────────
    // Create data directory, then install/reconfigure the service.
    ssPostInstall:
    begin
      CreateCustomerDataDirectory();
      InstallWindowsService();
    end;

  end;
end;

// ─────────────────────────────────────────────────────────────────────────────
// CurUninstallStepChanged — service cleanup on uninstall
// ─────────────────────────────────────────────────────────────────────────────
// Note: [UninstallRun] entries above also handle stop+remove, but this
// Pascal code provides an additional safety net in case the .exe paths
// have changed or the [UninstallRun] entries fail.
// ─────────────────────────────────────────────────────────────────────────────
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  NssmPath: String;
  ResultCode: Integer;
begin
  if CurUninstallStep = usUninstall then begin
    // Stop service
    Exec(ExpandConstant('{sys}\sc.exe'), 'stop {#ServiceName}',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Sleep(3000);

    // Remove service via NSSM if it exists
    NssmPath := ExpandConstant('{app}\resources\nssm\nssm.exe');
    if FileExists(NssmPath) then
      Exec(NssmPath, 'remove {#ServiceName} confirm',
        '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

    // Fallback: remove via sc.exe
    Exec(ExpandConstant('{sys}\sc.exe'), 'delete {#ServiceName}',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

    Log('Service stop+remove completed (uninstall step)');
  end;
end;

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANT: %APPDATA%\POPMYC POS\ is NEVER deleted on uninstall.
// Inno Setup only removes files it explicitly installed via [Files].
// Since we never install anything INTO %APPDATA%\POPMYC POS\ via [Files],
// the uninstaller leaves that folder completely alone.
// Customer database, .env, logs, media, and backups are all preserved.
// ─────────────────────────────────────────────────────────────────────────────
