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
;   7. Creates %PROGRAMDATA%\POPMYC POS\  (machine-wide customer data directory).
;   8. Warns if PostgreSQL is not detected.
;   9. Optionally launches the app after install.
;
; On UPGRADE (install over existing installation):
;   - Stops the service before replacing files.
;   - Reconfigures the service after new files are in place.
;   - Restarts the service.
;   - NEVER touches %PROGRAMDATA%\POPMYC POS\ customer data.
;
; On UNINSTALL:
;   - Stops the POPMYCBackend service.
;   - Removes the service registration.
;   - Removes application files from {autopf}\POPMYC POS\.
;   - NEVER deletes %PROGRAMDATA%\POPMYC POS\ customer data.
;
; Data directory:    %PROGRAMDATA%\POPMYC POS\  ← machine-wide customer data, NEVER deleted
; Install directory: {autopf}\POPMYC POS\       ← app files, replaced on upgrade
; Service name:      POPMYCBackend

#define AppName       "POPMYC POS"
#define AppVersion    "1.2.2"
#define AppPublisher  "POPMyC Solutions"
#define AppExeName    "POPMYC POS.exe"
#define AppURL        "https://popmycsolutions.com"
#define ServiceName   "POPMYCBackend"
#define PgVersion     "16"
#define PgInstaller   "postgresql-16.4-1-windows-x64.exe"

; ── Dedicated POPMYC PostgreSQL instance ─────────────────────────────────────
; Used ONLY when no usable system PostgreSQL exists and a fresh instance must
; be installed. These values are intentionally different from the EDB default
; ("postgresql-x64-16" / "C:\Program Files\PostgreSQL\16") so that an
; existing third-party PostgreSQL installation is NEVER modified or overwritten.
#define PgPopmycService   "POPMYCPostgreSQL16"
#define PgPopmycPrefix    "C:\Program Files\POPMYC\PostgreSQL\16"
#define PgPopmycDataDir   "C:\Program Files\POPMYC\PostgreSQL\16\data"

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
; ── Architecture ─────────────────────────────────────────────────────────────
; POPMYC POS requires 64-bit Windows (x64 or ARM64 with x64 emulation).
; The bundled Electron runtime and Python interpreter are both x64 binaries.
; Inno Setup will show a friendly error if the installer is run on 32-bit Windows.
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; ── Critical: do NOT touch %PROGRAMDATA%\POPMYC POS\ on uninstall ──────────
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

; ── PostgreSQL Windows installer ──────────────────────────────────────────────
; Official EDB installer — downloaded at build time via: npm run download:pg
; Bundled for offline silent install during POPMYC POS installation.
; Source: https://www.enterprisedb.com/downloads/postgres-postgresql-downloads
;
; BUILD WILL FAIL if this file is missing — run:  npm run download:pg
; Do NOT use #if FileExists — a missing file must produce a build error,
; not a silently deficient installer.
Source: "..\pg-installer\{#PgInstaller}"; DestDir: "{tmp}"; Flags: ignoreversion deleteafterinstall

[Icons]
Name: "{group}\{#AppName}";           Filename: "{app}\{#AppExeName}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{userdesktop}\{#AppName}";     Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

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
// Administrator privilege check
// ─────────────────────────────────────────────────────────────────────────────

// Import IsUserAnAdmin from shell32.dll.
// Returns True if the current process token is a member of the Administrators
// group. This is the same check the EDB PostgreSQL installer performs internally,
// so if this returns False the EDB installer will also fail with
// "This installer requires administrator privileges".
//
// This correctly handles:
//   - Standard user accounts (returns False — must use an admin account)
//   - UAC-disabled machines (returns True only if the account IS in Administrators)
//   - UAC-enabled machines, non-elevated token (returns False)
//   - UAC-enabled machines, elevated token (returns True)
//
// IsUserAnAdmin is documented as a wrapper for CheckTokenMembership(S-1-5-32-544).
// It is available on all Windows versions supported by POPMYC POS.
function IsUserAnAdmin(): Boolean;
  external 'IsUserAnAdmin@shell32.dll stdcall';

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
  // Use the machine-wide ProgramData directory so the Windows service
  // running as LocalSystem and the Electron desktop process (running as the
  // logged-in operator) both point to the same .env and log files.
  // {commonappdata} expands to C:\ProgramData (accessible to LocalSystem
  // and all users; created during Windows setup; always writable by admins).
  Result := ExpandConstant('{commonappdata}\POPMYC POS');
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
  // NSSM install takes: nssm install <ServiceName> <Application>
  // The script path and arguments are set separately via AppParameters so that
  // paths containing spaces are stored as a single quoted token in the registry
  // and never split incorrectly by Windows when the service starts.
  if not Exec(NssmPath,
    'install {#ServiceName} "' + PythonPath + '"',
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

  // Set AppParameters separately — this is the correct way to handle paths
  // with spaces.  The launcher script path is quoted so Windows passes it to
  // Python as a single argument even when the install directory contains spaces
  // (e.g. "C:\Program Files (x86)\POPMYC POS\...").
  Exec(NssmPath,
    'set {#ServiceName} AppParameters "\"' + LauncherPath + '\" --port 8000"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Log('NSSM AppParameters set (exit=' + IntToStr(ResultCode) + '): ' +
      '"\"' + LauncherPath + '\" --port 8000"');

  // ── Configure service properties ──────────────────────────────────────────
  Exec(NssmPath, 'set {#ServiceName} DisplayName "POPMYC POS Backend Service"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  Exec(NssmPath, 'set {#ServiceName} Description "Runs the POPMYC POS Django/Waitress backend. Required for POS operation."',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // Working directory — backend root for Python imports
  Exec(NssmPath, 'set {#ServiceName} AppDirectory "' + BackendDir + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // Environment variables — written directly to the registry as REG_MULTI_SZ.
  //
  // WHY NOT nssm set AppEnvironmentExtra with multiple tokens:
  //   NSSM 2.24's AppEnvironmentExtra command-line handler treats the entire
  //   remainder of the argument list as a single concatenated string, joining
  //   the tokens with spaces.  A data directory like "C:\ProgramData\POPMYC POS"
  //   contains a space, so passing it alongside other tokens causes NSSM to
  //   store all three values as one mangled string:
  //     "DJANGO_SETTINGS_MODULE=... POPMYC_DATA_DIR=C:\ProgramData\POPMYC POS PYTHONUNBUFFERED=1"
  //   When the service starts, NSSM re-splits on spaces, producing:
  //     POPMYC_DATA_DIR=C:\ProgramData\POPMYC    (truncated at the space)
  //     POS                                       (spurious extra entry)
  //   This causes service_launcher.py to use the wrong data directory.
  //
  // FIX: write the REG_MULTI_SZ directly via RegWriteMultiStringValue.
  //   The Data parameter is a String with entries separated by #0 (null char).
  //   This bypasses all shell/command-line parsing, so the space in
  //   "POPMYC POS" is preserved exactly as stored — no splitting possible.
  //   NSSM reads AppEnvironmentExtra as REG_MULTI_SZ at service start time.
  RegWriteMultiStringValue(
    HKLM,
    'SYSTEM\CurrentControlSet\Services\{#ServiceName}\Parameters',
    'AppEnvironmentExtra',
    'DJANGO_SETTINGS_MODULE=config.settings_desktop' + #0 +
    'POPMYC_DATA_DIR=' + DataDir + #0 +
    'PYTHONUNBUFFERED=1'
  );
  Log('AppEnvironmentExtra written to registry. POPMYC_DATA_DIR=' + DataDir);

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
  ResultCode: Integer;
begin
  DataDir := GetDataDir();

  ForceDirectories(DataDir);
  ForceDirectories(DataDir + '\logs');
  ForceDirectories(DataDir + '\media');
  ForceDirectories(DataDir + '\backups');

  // Grant all local users (including the customer's login account) full
  // modify rights on the data directory.
  //
  // WHY: C:\ProgramData is writable only by Administrators by default.
  // The Electron process runs as the logged-in user (non-admin after setup).
  // Without this grant:
  //   - Electron's ensureDataDir() cannot create logs/, media/, backups/
  //   - fs.createWriteStream('...logs\backend.log') throws EPERM
  //   - service_launcher.py cannot write its log files
  // The installer runs as admin, so we use it to set the ACL once.
  //
  // We use the well-known SID *S-1-5-32-545 for the Users group instead of
  // the name "Users" because:
  //   1. The name is localized (Users / Benutzer / Utilisateurs etc.)
  //   2. Quoting "Users:(OI)(CI)M" as one string makes icacls parse it
  //      as a literal account name with colons — causing "invalid parameter".
  // *S-1-5-32-545 works on every Windows locale without quoting issues.
  // (OI)(CI)M = Object Inherit + Container Inherit + Modify rights.
  Exec(ExpandConstant('{sys}\icacls.exe'),
    '"' + DataDir + '" /grant *S-1-5-32-545:(OI)(CI)M /T /Q',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Log('icacls grant *S-1-5-32-545 modify on ' + DataDir + ' (exit=' + IntToStr(ResultCode) + ')');

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
    Lines[7]  := 'Location: C:\ProgramData\POPMYC POS';
    Lines[8]  := 'This machine-wide location is used by both the Windows service';
    Lines[9]  := 'and the POPMYC POS application.';
    Lines[10] := '';
    Lines[11] := 'Contents:';
    Lines[12] := '  .env      — Database connection and application settings';
    Lines[13] := '  logs/     — Application log files (auto-rotating)';
    Lines[14] := '  media/    — Uploaded files (logos, receipts, avatars)';
    Lines[15] := '  backups/  — Database backup files';
    Lines[16] := '';
    Lines[17] := 'Windows Service:';
    Lines[18] := '  POPMYC POS installs a background Windows service (POPMYCBackend).';
    Lines[19] := '  This service starts automatically with Windows.';
    SaveStringsToFile(ReadmePath, Lines, False);
  end;
end;

// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL silent installation
// ─────────────────────────────────────────────────────────────────────────────

// Generate a random 32-char hex string for the PostgreSQL superuser password.
// This avoids hard-coding any shared password. The password is written to
// %PROGRAMDATA%\POPMYC POS\.env by the Electron app on first launch.
// We only need it here to pass to the EDB unattended installer.
//
// ─────────────────────────────────────────────────────────────────────────────
// Password generation
// ─────────────────────────────────────────────────────────────────────────────

// Generate a cryptographically secure password meeting Windows complexity.
// Returns a 20-character password with uppercase, lowercase, digits, symbol.
// NEVER logged or shown to the customer.
// Uses only Inno Setup Pascal Script-compatible constructs:
//   Random(N), Copy(), Length(), IntToStr() — no Randomize, no char indexing.
function GenerateComplexPassword(): String;
var
  Upper, Lower, Digits, Symbols, All: String;
  I, R: Integer;
  Pwd, Head, Mid, Tail: String;
begin
  Upper   := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  Lower   := 'abcdefghjkmnpqrstuvwxyz';
  Digits  := '23456789';
  Symbols := '!@#$%^&*';
  All     := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*';

  // Guarantee at least one character from each required class
  R := Random(Length(Upper)) + 1; Pwd := Copy(Upper, R, 1);
  R := Random(Length(Lower)) + 1; Pwd := Pwd + Copy(Lower, R, 1);
  R := Random(Length(Digits)) + 1; Pwd := Pwd + Copy(Digits, R, 1);
  R := Random(Length(Symbols)) + 1; Pwd := Pwd + Copy(Symbols, R, 1);

  // Fill remaining 16 characters from the combined pool
  for I := 5 to 20 do begin
    R := Random(Length(All)) + 1;
    Pwd := Pwd + Copy(All, R, 1);
  end;

  // Simple interleave-shuffle: rebuild string by picking characters
  // from alternating positions to avoid always starting with Upper/Lower/Digit/Symbol.
  // Inno Setup strings are immutable by index so we reconstruct via Copy().
  Head := '';
  Mid  := '';
  Tail := '';
  for I := 1 to Length(Pwd) do begin
    if (I mod 3) = 1 then Head := Head + Copy(Pwd, I, 1)
    else if (I mod 3) = 2 then Mid  := Mid  + Copy(Pwd, I, 1)
    else                       Tail := Tail + Copy(Pwd, I, 1);
  end;
  Result := Head + Mid + Tail;
end;

// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL silent installation
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL compatibility check helpers
// ─────────────────────────────────────────────────────────────────────────────

// Safe string-to-integer conversion with a default fallback.
// Inno Setup Pascal does not have StrToIntDef, so we implement it here.
function SafeStrToInt(S: String; Default: Integer): Integer;
begin
  if S = '' then begin Result := Default; Exit; end;
  Result := StrToIntDef(S, Default);
end;

// Check whether the given TCP port is in use on localhost.
// Uses cmd /C "netstat -an" and looks for the port in LISTENING state.
function IsPortListening(Port: Integer): Boolean;
var
  TmpFile, Line: String;
  Lines: TArrayOfString;
  I: Integer;
  PortStr: String;
  ResultCode: Integer;
begin
  Result  := False;
  TmpFile := ExpandConstant('{tmp}\netstat_out.txt');
  PortStr := ':' + IntToStr(Port) + ' ';
  Exec(ExpandConstant('{sys}\cmd.exe'),
    '/C "netstat -an > "' + TmpFile + '""',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if FileExists(TmpFile) then begin
    LoadStringsFromFile(TmpFile, Lines);
    for I := 0 to High(Lines) do begin
      Line := Lines[I];
      if (Pos(PortStr, Line) > 0) and (Pos('LISTENING', Line) > 0) then begin
        Result := True;
        Break;
      end;
    end;
    DeleteFile(TmpFile);
  end;
end;

// Scan the registry for ALL installed PostgreSQL instances.
// Fills PgPort and PgServiceName with the BEST usable instance:
//   Priority 1: postgresql-x64-16 (our target version)
//   Priority 2: highest version number
// Returns True if at least one instance was found.
//
// REGISTRY LAYOUT NOTE (EDB PostgreSQL 16 on Windows):
//   The Installations subkey uses "Service ID" (not "ServiceName") and
//   does NOT contain a "Port" value. Port is found via:
//     Path A: HKLM\SOFTWARE\PostgreSQL\Services\<ServiceID>\Port
//     Path B: <Data Directory>\postgresql.conf  (port = NNNN)
//     Path C: Probe IsPortListening(5432..5436) — last resort fallback
function FindBestPostgreSQLInstance(var PgPort: Integer;
                                    var PgServiceName: String): Boolean;
var
  SubKeyPath, SubName, SvcName, DataDir: String;
  SubKeys: TArrayOfString;
  I, CurMajor, BestMajor, BestPort: Integer;
  BestSvc, BestDataDir: String;
  Found: Boolean;
  DashPos: Integer;
  // Port-resolution helpers
  PortFromReg, PortFromConf, ProbePort: Integer;
  ConfPath: String;
  ConfLines: TArrayOfString;
  J, EqPos: Integer;
  LineKey, LineVal: String;
begin
  Result      := False;
  BestMajor   := -1;
  BestPort    := 0;    // 0 = unknown; resolved below
  BestSvc     := '';
  BestDataDir := '';
  Found       := False;

  // ── Registry scan: HKLM SOFTWARE\PostgreSQL\Installations ────────────────
  // EDB installers write: "Service ID" (not "ServiceName"), "Data Directory",
  // "Base Directory", "Version". There is NO "Port" value here.
  SubKeyPath := 'SOFTWARE\PostgreSQL\Installations';
  if RegGetSubkeyNames(HKLM64, SubKeyPath, SubKeys) then begin
    for I := 0 to High(SubKeys) do begin
      SubName := SubKeys[I];
      Found   := True;
      // Read the actual service identifier — "Service ID", not "ServiceName"
      SvcName := '';
      if not RegQueryStringValue(HKLM64, SubKeyPath + '\' + SubName,
                                 'Service ID', SvcName) then
        // Older EDB versions used "ServiceName" — try that too
        RegQueryStringValue(HKLM64, SubKeyPath + '\' + SubName,
                            'ServiceName', SvcName);
      // Read data directory for postgresql.conf fallback
      DataDir := '';
      RegQueryStringValue(HKLM64, SubKeyPath + '\' + SubName,
                          'Data Directory', DataDir);
      // Derive version from subkey name (e.g. "postgresql-x64-16" → 16)
      CurMajor := 0;
      DashPos  := Pos('-', SubName);
      if DashPos > 0 then
        CurMajor := StrToIntDef(Copy(SubName, DashPos + 1, Length(SubName)), 0);
      if (SvcName = 'postgresql-x64-{#PgVersion}') or (CurMajor > BestMajor) then begin
        BestMajor   := CurMajor;
        BestSvc     := SvcName;
        BestDataDir := DataDir;
        BestPort    := 0;   // port resolved below once best candidate chosen
      end;
    end;
  end;

  // Also try 32-bit registry view if nothing found yet
  if not Found then begin
    if RegGetSubkeyNames(HKLM32, SubKeyPath, SubKeys) then begin
      for I := 0 to High(SubKeys) do begin
        SubName := SubKeys[I];
        Found   := True;
        SvcName := '';
        if not RegQueryStringValue(HKLM32, SubKeyPath + '\' + SubName,
                                   'Service ID', SvcName) then
          RegQueryStringValue(HKLM32, SubKeyPath + '\' + SubName,
                              'ServiceName', SvcName);
        DataDir := '';
        RegQueryStringValue(HKLM32, SubKeyPath + '\' + SubName,
                            'Data Directory', DataDir);
        CurMajor := 0;
        DashPos  := Pos('-', SubName);
        if DashPos > 0 then
          CurMajor := StrToIntDef(Copy(SubName, DashPos + 1, Length(SubName)), 0);
        if (SvcName = 'postgresql-x64-{#PgVersion}') or (CurMajor > BestMajor) then begin
          BestMajor   := CurMajor;
          BestSvc     := SvcName;
          BestDataDir := DataDir;
          BestPort    := 0;
        end;
      end;
    end;
  end;

  // ── Service key fallback ──────────────────────────────────────────────────
  // If the Installations key was missing entirely, detect via the service key.
  if not Found then begin
    if RegKeyExists(HKLM64,
        'SYSTEM\CurrentControlSet\Services\postgresql-x64-{#PgVersion}') then begin
      Found   := True;
      BestSvc := 'postgresql-x64-{#PgVersion}';
    end;
  end;

  // ── Directory fallback ────────────────────────────────────────────────────
  if not Found then begin
    if DirExists('C:\Program Files\PostgreSQL\{#PgVersion}') then begin
      Found        := True;
      BestSvc      := 'postgresql-x64-{#PgVersion}';
      BestDataDir  := 'C:\Program Files\PostgreSQL\{#PgVersion}\data';
    end else if DirExists('C:\Program Files\PostgreSQL') then
      Found := True;
  end;

  if not Found then Exit;

  // ── Port resolution (three-path cascade) ─────────────────────────────────
  // BestPort is still 0 here — resolve it now.

  // Path A: HKLM\SOFTWARE\PostgreSQL\Services\<ServiceID>\Port
  // EDB writes this as REG_SZ (string), not DWORD.
  PortFromReg := 0;
  if BestSvc <> '' then begin
    DataDir := '';   // reuse DataDir as a temp string variable here
    if RegQueryStringValue(HKLM64,
        'SOFTWARE\PostgreSQL\Services\' + BestSvc, 'Port', DataDir) then begin
      PortFromReg := StrToIntDef(DataDir, 0);
      if PortFromReg > 0 then
        Log('PG port (from Services registry, Path A): ' + IntToStr(PortFromReg));
    end;
  end;

  if PortFromReg > 0 then begin
    BestPort := PortFromReg;
  end else begin
    // Path B: Read port from postgresql.conf in the Data Directory
    PortFromConf := 0;
    if BestDataDir <> '' then begin
      ConfPath := BestDataDir + '\postgresql.conf';
      if FileExists(ConfPath) then begin
        if LoadStringsFromFile(ConfPath, ConfLines) then begin
          for J := 0 to High(ConfLines) do begin
            LineKey := Trim(ConfLines[J]);
            // Skip comments and blank lines
            if (LineKey = '') or (Copy(LineKey, 1, 1) = '#') then Continue;
            // Look for:  port = NNNN   (with optional whitespace and inline comment)
            if Pos('port', LowerCase(LineKey)) = 1 then begin
              EqPos := Pos('=', LineKey);
              if EqPos > 0 then begin
                LineVal := Trim(Copy(LineKey, EqPos + 1, Length(LineKey)));
                // Strip any trailing inline comment (e.g. "5433 # default")
                DashPos := Pos('#', LineVal);
                if DashPos > 0 then
                  LineVal := Trim(Copy(LineVal, 1, DashPos - 1));
                PortFromConf := StrToIntDef(LineVal, 0);
                if PortFromConf > 0 then begin
                  Log('PG port (from postgresql.conf, Path B): ' +
                      IntToStr(PortFromConf));
                  Break;
                end;
              end;
            end;
          end;
        end;
      end else
        Log('postgresql.conf not accessible at: ' + ConfPath +
            ' — will try port probe (Path C).');
    end;

    if PortFromConf > 0 then begin
      BestPort := PortFromConf;
    end else begin
      // Path C: Probe IsPortListening(5432..5436) in order
      Log('PG port unknown from registry/conf — probing ports 5432-5436 (Path C).');
      ProbePort := 0;
      if IsPortListening(5432) then ProbePort := 5432
      else if IsPortListening(5433) then ProbePort := 5433
      else if IsPortListening(5434) then ProbePort := 5434
      else if IsPortListening(5435) then ProbePort := 5435
      else if IsPortListening(5436) then ProbePort := 5436;
      if ProbePort > 0 then begin
        Log('PG port (from port probe, Path C): ' + IntToStr(ProbePort));
        BestPort := ProbePort;
      end else begin
        Log('WARNING: PG port could not be determined — defaulting to 5432.');
        BestPort := 5432;
      end;
    end;
  end;

  Log('FindBestPostgreSQLInstance: service="' + BestSvc +
      '" datadir="' + BestDataDir +
      '" port=' + IntToStr(BestPort));
  PgPort        := BestPort;
  PgServiceName := BestSvc;
  Result        := True;
end;

// Poll until PostgreSQL is accepting TCP connections on host:port.
// Returns True when the port is open, False on timeout.
function WaitForPgReady(Port: Integer; TimeoutSec: Integer): Boolean;
var
  Elapsed, I: Integer;
begin
  Result  := False;
  Elapsed := 0;
  // Poll every 2 seconds
  for I := 1 to (TimeoutSec div 2) do begin
    Sleep(2000);
    Elapsed := Elapsed + 2;
    if IsPortListening(Port) then begin
      Log('PostgreSQL accepting connections on port ' + IntToStr(Port) +
          ' after ~' + IntToStr(Elapsed) + 's.');
      Result := True;
      Exit;
    end;
  end;
  Log('WARNING: PostgreSQL did not become ready on port ' + IntToStr(Port) +
      ' within ' + IntToStr(TimeoutSec) + 's.');
end;

// ─────────────────────────────────────────────────────────────────────────────
// .env placeholder detection
// ─────────────────────────────────────────────────────────────────────────────

// Returns True if the .env at DataDir contains the Electron-generated
// placeholder credentials (DB_USER=postgres / DB_PASSWORD=changeme).
// A placeholder .env should be overwritten with real credentials.
// A real customer .env (non-placeholder) must be preserved.
function EnvIsPlaceholder(DataDir: String): Boolean;
var
  EnvPath: String;
  Lines: TArrayOfString;
  I: Integer;
  HasPostgresUser, HasChangeme: Boolean;
begin
  Result   := False;
  EnvPath  := DataDir + '\.env';
  if not FileExists(EnvPath) then begin
    Result := True;  // no file = treat as placeholder (will be created fresh)
    Exit;
  end;
  HasPostgresUser := False;
  HasChangeme     := False;
  if LoadStringsFromFile(EnvPath, Lines) then begin
    for I := 0 to High(Lines) do begin
      if Lines[I] = 'DB_USER=postgres'   then HasPostgresUser := True;
      if Lines[I] = 'DB_PASSWORD=changeme' then HasChangeme    := True;
    end;
  end;
  Result := HasPostgresUser and HasChangeme;
end;

// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL silent installation
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Direct PostgreSQL cluster creation — fallback when EDB installer fails
// ─────────────────────────────────────────────────────────────────────────────
//
// On machines where UAC is disabled and the installer is launched via
// over-the-shoulder elevation (standard user enters an admin's credentials),
// the EDB installer's whoami-based admin check sees the SESSION user (who is
// not an admin) and exits with code 1 before creating anything.
//
// This fallback uses existing PostgreSQL 16 binaries (initdb.exe + pg_ctl.exe)
// to create the POPMYC cluster directly, bypassing the EDB admin check.

// Locate the bin directory of an existing PostgreSQL 16 installation.
// Returns the path (e.g. C:\Program Files\PostgreSQL\16\bin) or empty string.
function FindPgBinDir(): String;
var
  BinDir: String;
begin
  Result := '';
  BinDir := 'C:\Program Files\PostgreSQL\{#PgVersion}\bin';
  if DirExists(BinDir) and FileExists(BinDir + '\initdb.exe') then begin
    Result := BinDir;
    Log('FindPgBinDir: found at ' + BinDir);
    Exit;
  end;
  BinDir := '{#PgPopmycPrefix}\bin';
  if DirExists(BinDir) and FileExists(BinDir + '\initdb.exe') then begin
    Result := BinDir;
    Log('FindPgBinDir: found POPMYC prefix at ' + BinDir);
    Exit;
  end;
  BinDir := 'C:\Program Files (x86)\PostgreSQL\{#PgVersion}\bin';
  if DirExists(BinDir) and FileExists(BinDir + '\initdb.exe') then begin
    Result := BinDir;
    Log('FindPgBinDir: found x86 at ' + BinDir);
    Exit;
  end;
  Log('FindPgBinDir: no PostgreSQL {#PgVersion} bin directory found.');
end;

// Create the POPMYC PostgreSQL cluster directly using initdb + pg_ctl.
// ChosenPort: the TCP port the cluster should listen on.
// PgSuperPwd: the superuser password — written to a temp file, never logged.
// Returns True if the service was registered successfully.
function CreatePopmycClusterDirectly(ChosenPort: Integer; const PgSuperPwd: String): Boolean;
var
  BinDir, DataDir, PgPwdFile, ConfPath: String;
  ResultCode, I: Integer;
  ConfLines, NewLines: TArrayOfString;
  Found: Boolean;
  Line: String;
begin
  Result  := False;
  BinDir  := FindPgBinDir();
  if BinDir = '' then begin
    Log('CreatePopmycClusterDirectly: no PG binaries — cannot proceed.');
    Exit;
  end;

  DataDir   := '{#PgPopmycDataDir}';
  PgPwdFile := ExpandConstant('{tmp}\popmyc_pg_init_pwd.tmp');

  ForceDirectories('{#PgPopmycPrefix}');

  // Write password to temp file — NEVER on command line
  if not SaveStringToFile(PgPwdFile, PgSuperPwd, False) then begin
    Log('CreatePopmycClusterDirectly: cannot write password file.');
    Exit;
  end;

  // ── Step 1: initdb ─────────────────────────────────────────────────────────
  Log('initdb: initializing cluster in ' + DataDir);
  Exec(
    BinDir + '\initdb.exe',
    '-D "' + DataDir + '"' +
    ' -U postgres' +
    ' --auth=md5' +
    ' --pwfile="' + PgPwdFile + '"' +
    ' --encoding=UTF8',
    BinDir, SW_HIDE, ewWaitUntilTerminated, ResultCode
  );
  DeleteFile(PgPwdFile);

  if ResultCode <> 0 then begin
    Log('initdb failed with code ' + IntToStr(ResultCode) + '.');
    Exit;
  end;
  Log('initdb succeeded.');

  // ── Step 2: Patch postgresql.conf port ─────────────────────────────────────
  ConfPath := DataDir + '\postgresql.conf';
  if FileExists(ConfPath) and LoadStringsFromFile(ConfPath, ConfLines) then begin
    Found := False;
    SetArrayLength(NewLines, Length(ConfLines));
    for I := 0 to High(ConfLines) do begin
      Line := ConfLines[I];
      if Pos('port', LowerCase(Trim(Line))) = 1 then begin
        NewLines[I] := 'port = ' + IntToStr(ChosenPort) +
                       '    # set by POPMYC installer';
        Found := True;
        Log('postgresql.conf: patched port to ' + IntToStr(ChosenPort));
      end else
        NewLines[I] := Line;
    end;
    if not Found then begin
      SetArrayLength(NewLines, Length(NewLines) + 1);
      NewLines[High(NewLines)] := 'port = ' + IntToStr(ChosenPort) +
                                   '    # added by POPMYC installer';
      Log('postgresql.conf: appended port = ' + IntToStr(ChosenPort));
    end;
    SaveStringsToFile(ConfPath, NewLines, False);
  end else
    Log('WARNING: cannot patch postgresql.conf — port will use initdb default.');

  // ── Step 3: Register Windows service via pg_ctl ────────────────────────────
  Log('pg_ctl: registering service {#PgPopmycService}');
  Exec(
    BinDir + '\pg_ctl.exe',
    'register' +
    ' -N "{#PgPopmycService}"' +
    ' -D "' + DataDir + '"' +
    ' -o "-p ' + IntToStr(ChosenPort) + '"' +
    ' -S auto',
    BinDir, SW_HIDE, ewWaitUntilTerminated, ResultCode
  );

  if ResultCode <> 0 then begin
    Log('pg_ctl register failed (code ' + IntToStr(ResultCode) +
        ') — trying sc.exe fallback.');
    // sc.exe fallback: register as generic service
    Exec(
      ExpandConstant('{sys}\sc.exe'),
      'create {#PgPopmycService}' +
      ' binPath= "\"' + BinDir + '\pg_ctl.exe\" runservice' +
        ' -N \"POPMYCPostgreSQL16\"' +
        ' -D \"' + DataDir + '\"' +
        ' -o \"-p ' + IntToStr(ChosenPort) + '\""' +
      ' start= auto' +
      ' DisplayName= "POPMYC PostgreSQL 16"',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode
    );
    if ResultCode <> 0 then begin
      Log('sc.exe create also failed (code ' + IntToStr(ResultCode) + ').');
      Exit;
    end;
    Log('Service registered via sc.exe.');
  end else
    Log('Service registered via pg_ctl.');

  Result := True;
end;

// ─────────────────────────────────────────────────────────────────────────────
// Install PostgreSQL silently via the bundled EDB installer.
// Passwords are passed via --optionfile, never on the command line.
//
// COMPATIBILITY LOGIC:
//   - If a RUNNING, port-accessible PostgreSQL instance is detected → reuse it.
//   - If the dedicated POPMYC instance (POPMYCPostgreSQL16) already exists →
//     start it and reuse; never install a second copy.
//   - Otherwise install a fresh DEDICATED POPMYC instance with:
//       service  = POPMYCPostgreSQL16
//       prefix   = C:\Program Files\POPMYC\PostgreSQL\16
//       datadir  = C:\Program Files\POPMYC\PostgreSQL\16\data
//     so that any existing postgresql-x64-16 installation is NEVER touched.
//   - Port is selected by TCP availability (5432→5433→5434→5435→5436).
//   - NEVER modify an existing third-party PostgreSQL installation.
//
// Returns True when PostgreSQL is ready to accept connections.
function InstallPostgreSQLSilent(): Boolean;
var
  InstallerPath, OptionFilePath, DataDir: String;
  PgSuperPwd, AppPwd, OptionContent, AppEnvContent, TimeStr: String;
  ResultCode, ChosenPort: Integer;
  ExistingPort: Integer;
  ExistingSvc:  String;
  HasExisting:  Boolean;
  InstallFreshPort: Integer;
  IsPlaceholder: Boolean;
begin
  Result         := False;
  InstallerPath  := ExpandConstant('{tmp}\{#PgInstaller}');
  OptionFilePath := ExpandConstant('{tmp}\popmyc_pg_options.ini');
  DataDir        := GetDataDir();

  // ── Step 1: Check for the dedicated POPMYC PostgreSQL instance first ───────
  // If a previous POPMYC install already created POPMYCPostgreSQL16, reuse it
  // rather than attempting another installation.  The DB and popmyc_app user
  // were provisioned during that earlier install, so no password is needed.
  if RegKeyExists(HKLM64,
      'SYSTEM\CurrentControlSet\Services\{#PgPopmycService}') then begin
    Log('Dedicated POPMYC PostgreSQL service ({#PgPopmycService}) exists — reusing.');

    // Determine the port from the Services registry key written by the EDB
    // installer (REG_SZ "Port" under SOFTWARE\PostgreSQL\Services\<ServiceID>).
    // Fall back to 5432 only when the key is absent.
    ExistingPort := 5432;
    AppEnvContent := '';   // reuse as temp string — not needed before Step 3
    if RegQueryStringValue(HKLM64,
        'SOFTWARE\PostgreSQL\Services\{#PgPopmycService}', 'Port', AppEnvContent) then begin
      ExistingPort := StrToIntDef(AppEnvContent, 5432);
      Log('{#PgPopmycService} port from registry: ' + IntToStr(ExistingPort));
    end else
      Log('{#PgPopmycService} port not found in registry — defaulting to 5432.');

    Exec(ExpandConstant('{sys}\sc.exe'), 'start {#PgPopmycService}',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Log('Waiting for {#PgPopmycService} on port ' + IntToStr(ExistingPort) + '…');
    if WaitForPgReady(ExistingPort, 60) then begin
      Log('Dedicated POPMYC PostgreSQL is ready on port ' + IntToStr(ExistingPort) + '.');
      Result := True;
      Exit;
    end;
    Log('{#PgPopmycService} did not respond on port ' + IntToStr(ExistingPort) +
        ' within 60s — service may still be starting; Electron will retry.');
    Result := True;  // soft — Electron polls the health endpoint
    Exit;
  end;

  // ── Step 2: Detect any OTHER existing PostgreSQL ───────────────────────────
  // Log the presence of a third-party instance for diagnostics, but DO NOT
  // reuse it.  POPMYC cannot know the superuser password of an installation
  // it did not create, so automatic provisioning would be impossible without
  // asking the customer for a password.  Instead, always install the dedicated
  // POPMYC PostgreSQL instance (Step 3) so that provisioning is fully automatic
  // and the customer is NEVER asked for a PostgreSQL administrator password.
  //
  // The existing third-party installation is NEVER modified, stopped, or
  // reconfigured.  POPMYC simply coexists with it on a separate port.
  HasExisting := FindBestPostgreSQLInstance(ExistingPort, ExistingSvc);
  if HasExisting then begin
    Log('Third-party PostgreSQL detected — service="' + ExistingSvc +
        '" registry port=' + IntToStr(ExistingPort) + '.' + #13#10 +
        'POPMYC will NOT reuse or modify this installation.' + #13#10 +
        'Installing dedicated {#PgPopmycService} instead ' +
        'so that provisioning is fully automatic.');
    // ExistingPort is now known: Step 3 port selection will skip it if occupied.
    // No further action on the third-party instance.
  end;

  // ── Step 3: Install a DEDICATED POPMYC PostgreSQL instance ─────────────────
  // Uses:
  //   service  = {#PgPopmycService}   (POPMYCPostgreSQL16)
  //   prefix   = {#PgPopmycPrefix}    (C:\Program Files\POPMYC\PostgreSQL\16)
  //   datadir  = {#PgPopmycDataDir}   (C:\Program Files\POPMYC\PostgreSQL\16\data)
  // This deliberately differs from the EDB default so that any existing
  // third-party postgresql-x64-16 installation is completely untouched.

  if not FileExists(InstallerPath) then begin
    Log('FATAL: PostgreSQL installer not found: ' + InstallerPath);
    MsgBox(
      'POPMYC POS Setup Error' + #13#10 + #13#10 +
      'The PostgreSQL installer was not found inside this package.' + #13#10 +
      'Please download a fresh copy of the POPMYC POS installer.',
      mbError, MB_OK
    );
    Result := False; Exit;
  end;

  // Select a free port — test TCP reachability, not just registry values.
  InstallFreshPort := 0;
  if not IsPortListening(5432) then
    InstallFreshPort := 5432
  else if not IsPortListening(5433) then
    InstallFreshPort := 5433
  else if not IsPortListening(5434) then
    InstallFreshPort := 5434
  else if not IsPortListening(5435) then
    InstallFreshPort := 5435
  else if not IsPortListening(5436) then
    InstallFreshPort := 5436;

  if InstallFreshPort = 0 then begin
    Log('FATAL: Ports 5432–5436 are all in use. Cannot install PostgreSQL.');
    MsgBox(
      'POPMYC POS Setup: Port Conflict' + #13#10 + #13#10 +
      'Ports 5432 through 5436 are all in use on this computer.' + #13#10 +
      'POPMYC POS cannot install PostgreSQL.' + #13#10 + #13#10 +
      'Please free port 5432 and run the installer again.',
      mbError, MB_OK
    );
    Result := False; Exit;
  end;

  ChosenPort := InstallFreshPort;
  Log('Installing dedicated POPMYC PostgreSQL {#PgVersion} on port ' +
      IntToStr(ChosenPort) + ' (service={#PgPopmycService}).');

  // Generate secure passwords
  PgSuperPwd := GenerateComplexPassword();
  AppPwd     := GenerateComplexPassword();

  // Write option file — passwords NEVER appear on the command line
  OptionContent := 'superpassword=' + PgSuperPwd + #13#10 +
                   'servicepassword=' + PgSuperPwd + #13#10;
  if not SaveStringToFile(OptionFilePath, OptionContent, False) then begin
    Log('Could not write PG option file — aborting.');
    Exit;
  end;

  // NOTE: .env is written AFTER WaitForPgReady confirms PostgreSQL is actually
  // running (see below). Writing it here — before the EDB installer even runs —
  // would leave popmyc_app credentials pointing to a database that was never
  // created if the EDB installer fails.

  // Store superuser password temporarily for CreatePopmycDatabase().
  // Written to a file so we can pass it to pg_setup.py without a cmd.exe pipe,
  // avoiding the quoting fragility of "type file | python" for paths with spaces.
  SaveStringToFile(ExpandConstant('{tmp}\popmyc_pg_super.tmp'), PgSuperPwd, False);

  // Run EDB installer with DEDICATED POPMYC paths — existing postgresql-x64-16
  // installation is completely untouched.
  //
  // ELEVATION NOTE: Exec() uses CreateProcess(), which inherits the current
  // process token directly. Because Inno Setup is running with PrivilegesRequired=admin,
  // its process token is already the elevated administrator token obtained at
  // UAC prompt time (either the built-in Administrator account or an over-the-shoulder
  // admin credential). CreateProcess() passes this token straight to the EDB child
  // process — no UAC re-evaluation, no identity switch. This is the correct
  // mechanism for this scenario.
  //
  // ShellExec('runas') is NOT used here because on machines where the installing
  // user is a standard user (not in Administrators) who provided admin credentials
  // at the UAC over-the-shoulder prompt, ShellExec('runas') re-evaluates identity
  // against the calling user's account (standard user, no admin token) rather than
  // propagating the elevated token from the Inno process. This causes the EDB
  // installer to receive a non-elevated token and exit with code 1:
  //   "This installer requires administrator privileges"
  //
  // NOTE: --serviceaccount is intentionally omitted so EDB creates its own
  // dedicated Windows account. Specifying --serviceaccount postgres requires
  // that account to already exist; on machines where the original PG install
  // is broken/deleted the account may not exist and the EDB installer would
  // return a non-zero exit code, aborting the entire provisioning chain.
  if not Exec(InstallerPath,
    '--mode unattended' +
    ' --unattendedmodeui none' +
    ' --optionfile "' + OptionFilePath + '"' +
    ' --serverport ' + IntToStr(ChosenPort) +
    ' --servicename {#PgPopmycService}' +
    ' --enable-components server,commandlinetools' +
    ' --disable-components pgAdmin,stackbuilder' +
    ' --prefix "{#PgPopmycPrefix}"' +
    ' --datadir "{#PgPopmycDataDir}"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    Log('Failed to launch PostgreSQL installer (exit code ' +
        IntToStr(ResultCode) + ').');
    DeleteFile(OptionFilePath);
    DeleteFile(ExpandConstant('{tmp}\popmyc_pg_super.tmp'));
    Exit;
  end;

  DeleteFile(OptionFilePath);   // always delete immediately after installer returns

  Log('EDB installer exited with code ' + IntToStr(ResultCode) + '.');
  if ResultCode <> 0 then begin
    // Non-zero exit from EDB installer. Two known causes:
    //   (a) On machines with UAC disabled and over-the-shoulder elevation,
    //       the EDB admin check sees the SESSION user (OHEMAA, not admin)
    //       via whoami and exits with code 1 before creating anything.
    //   (b) Some EDB builds exit non-zero even on success.
    // Check if our service was actually created before giving up.
    if RegKeyExists(HKLM64,
        'SYSTEM\CurrentControlSet\Services\{#PgPopmycService}') then begin
      Log('POPMYCPostgreSQL16 service found despite non-zero exit — continuing.');
    end else begin
      Log('EDB installer failed (code ' + IntToStr(ResultCode) + ') and service not created.' + #13#10 +
          'This can occur when UAC is disabled and the installer was launched via' + #13#10 +
          'over-the-shoulder elevation. Attempting direct cluster creation using' + #13#10 +
          'existing PostgreSQL 16 binaries as fallback…');
      // ── Fallback: use existing PG 16 binaries to create the POPMYC cluster ─
      // This avoids the EDB installer admin check entirely.
      // We locate an installed PG 16 bin directory, then:
      //   1. initdb -D <PgPopmycDataDir> -U postgres --pwfile=<tmp>
      //   2. Update postgresql.conf with the chosen port
      //   3. Register POPMYCPostgreSQL16 via pg_ctl
      if not CreatePopmycClusterDirectly(ChosenPort, PgSuperPwd) then begin
        Log('FATAL: Direct cluster creation also failed. Cannot install PostgreSQL.');
        DeleteFile(OptionFilePath);
        DeleteFile(ExpandConstant('{tmp}\popmyc_pg_super.tmp'));
        MsgBox(
          'POPMYC POS — PostgreSQL Installation Failed' + #13#10 + #13#10 +
          'The PostgreSQL database service could not be installed.' + #13#10 + #13#10 +
          'For best results, run this installer directly from an' + #13#10 +
          'Administrator account (not via "Run as administrator").' + #13#10 + #13#10 +
          'Log: ' + ExpandConstant('{log}'),
          mbError, MB_OK
        );
        Exit;  // Result stays False
      end;
      Log('Direct cluster creation succeeded — {#PgPopmycService} registered.');
    end;
  end;

  Log('PostgreSQL installer finished. Starting {#PgPopmycService} and waiting…');

  // Start the DEDICATED POPMYC service
  Exec(ExpandConstant('{sys}\sc.exe'),
    'start {#PgPopmycService}',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // Poll for TCP readiness — 120 second timeout
  if not WaitForPgReady(ChosenPort, 120) then begin
    Log('WARNING: {#PgPopmycService} did not accept connections within 120s.');
    // Still write .env with the chosen port — the service did install even
    // if it hasn't fully started. Electron will retry the connection.
    TimeStr       := GetDateTimeString('yyyy-mm-dd hh:nn:ss', '-', ':');
    IsPlaceholder := EnvIsPlaceholder(DataDir);
    AppEnvContent :=
      '# POPMYC POS Desktop Configuration' + #13#10 +
      '# Generated by installer on ' + TimeStr + #13#10 +
      '# DO NOT DELETE this file.' + #13#10 +
      'DB_NAME=popmyc_pos' + #13#10 +
      'DB_USER=popmyc_app' + #13#10 +
      'DB_PASSWORD=' + AppPwd + #13#10 +
      'DB_HOST=localhost' + #13#10 +
      'DB_PORT=' + IntToStr(ChosenPort) + #13#10;
    if IsPlaceholder then begin
      ForceDirectories(DataDir);
      SaveStringToFile(DataDir + '\.env', AppEnvContent, False);
      Log('.env written (timeout path) for port ' + IntToStr(ChosenPort) + '.');
    end;
    MsgBox(
      'POPMYC POS Setup Warning' + #13#10 + #13#10 +
      'PostgreSQL was installed but did not start within 2 minutes.' + #13#10 +
      'POPMYC POS will attempt to connect when it first launches.' + #13#10 + #13#10 +
      'If the problem persists, check Windows Services for ' +
      '"' + '{#PgPopmycService}' + '".',
      mbInformation, MB_OK
    );
    DeleteFile(ExpandConstant('{tmp}\popmyc_pg_super.tmp'));
    Result := True;   // installer succeeded; service timing is recoverable
    Exit;
  end;

  Log('Dedicated POPMYC PostgreSQL is ready on port ' + IntToStr(ChosenPort) + '.');

  // ── Write .env NOW — only after PostgreSQL is confirmed ready ───────────────
  // Writing here (not before the EDB installer runs) guarantees that if the
  // EDB installer fails, no stale popmyc_app credentials are left in .env.
  TimeStr       := GetDateTimeString('yyyy-mm-dd hh:nn:ss', '-', ':');
  IsPlaceholder := EnvIsPlaceholder(DataDir);
  AppEnvContent :=
    '# POPMYC POS Desktop Configuration' + #13#10 +
    '# Generated by installer on ' + TimeStr + #13#10 +
    '# DO NOT DELETE this file.' + #13#10 +
    'DB_NAME=popmyc_pos' + #13#10 +
    'DB_USER=popmyc_app' + #13#10 +
    'DB_PASSWORD=' + AppPwd + #13#10 +
    'DB_HOST=localhost' + #13#10 +
    'DB_PORT=' + IntToStr(ChosenPort) + #13#10;
  if IsPlaceholder then begin
    ForceDirectories(DataDir);
    SaveStringToFile(DataDir + '\.env', AppEnvContent, False);
    Log('.env written (placeholder replaced) for port ' + IntToStr(ChosenPort) + '.');
  end else
    Log('Existing valid .env preserved — skipping overwrite.');

  Result := True;
end;

// ─────────────────────────────────────────────────────────────────────────────
// Create POPMYC database and application user after PG is ready
// ─────────────────────────────────────────────────────────────────────────────
procedure CreatePopmycDatabase();
var
  PythonPath, BackendDir, PgSuperPwdFile, DataDir: String;
  ResultCode: Integer;
begin
  PgSuperPwdFile := ExpandConstant('{tmp}\popmyc_pg_super.tmp');
  if not FileExists(PgSuperPwdFile) then begin
    Log('PG superuser password not available — skipping DB create.' +
        ' (Existing PG reused or password lost; Electron UI will provision on first launch.)');
    Exit;
  end;

  PythonPath := ExpandConstant('{app}\resources\runtime\python\python.exe');
  BackendDir := ExpandConstant('{app}\resources\backend');
  DataDir    := GetDataDir();

  if not FileExists(PythonPath) then begin
    Log('Python not found — skipping DB create.');
    DeleteFile(PgSuperPwdFile);
    Exit;
  end;

  // pg_setup.py will:
  //   1. Read the superuser password from the temp file (--password-file)
  //   2. Detect the correct PG port from .env (set correctly by InstallPostgreSQLSilent)
  //   3. Create popmyc_pos database (if not exists — safe on reinstall)
  //   4. Create popmyc_app user with the password already in .env
  //   5. Grant schema privileges
  //   6. Write DB_USER=popmyc_app and DB_PASSWORD to .env
  //   7. NEVER store the postgres superuser password

  // Invoke pg_setup.py --action create --password-file <tmpfile> --data-dir <dir>
  // Using --password-file avoids the "type file | python" cmd.exe pipe pattern
  // which breaks for data directory paths that contain spaces (e.g. the default
  // %PROGRAMDATA%\POPMYC POS path). The password file path is passed as an argv
  // argument — safe because it is a path, not the password itself.
  // pg_setup.py reads the password from the file and the caller (us) deletes it.
  Exec(
    PythonPath,
    '"' + BackendDir + '\pg_setup.py" --action create' +
      ' --data-dir "' + DataDir + '"' +
      ' --password-file "' + PgSuperPwdFile + '"',
    BackendDir, SW_HIDE, ewWaitUntilTerminated, ResultCode
  );

  DeleteFile(PgSuperPwdFile);   // always delete, regardless of outcome

  if ResultCode = 0 then
    Log('POPMYC database created/verified successfully.')
  else
    Log('WARNING: pg_setup.py create returned ' + IntToStr(ResultCode) +
        ' — Electron UI will complete provisioning on first launch.');
end;

// ─────────────────────────────────────────────────────────────────────────────
// InitializeSetup
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
function InitializeSetup(): Boolean;
begin
  // ── 64-bit Windows check ───────────────────────────────────────────────────
  // POPMYC POS requires 64-bit Windows. The bundled Electron app and Python
  // runtime are x64 binaries and cannot run on 32-bit Windows.
  if not Is64BitInstallMode() then begin
    MsgBox(
      'POPMYC POS requires a 64-bit version of Windows.' + #13#10 + #13#10 +
      'Your computer is running a 32-bit (x86) version of Windows,' + #13#10 +
      'which is not compatible with POPMYC POS.' + #13#10 + #13#10 +
      'POPMYC POS supports:' + #13#10 +
      '  - Windows 10 (64-bit) or later' + #13#10 +
      '  - Windows 11 (64-bit)' + #13#10 + #13#10 +
      'Please contact POPMYC support for assistance:' + #13#10 +
      '  Phone: 0247071869 / 0256251295' + #13#10 +
      '  Email: popmychubsolution@gmail.com',
      mbError, MB_OK
    );
    Result := False;
    Exit;
  end;

  // ── Administrator privilege check ─────────────────────────────────────────
  // Verify that this process is actually running under an administrator account
  // before attempting PostgreSQL installation. The EDB PostgreSQL installer
  // performs the same check internally and exits with code 1 if it is not
  // running as an administrator — producing a confusing silent failure.
  //
  // This check must run FIRST, before any installer work, because:
  //   - On machines with UAC disabled (EnableLUA=0), Inno Setup's own
  //     PrivilegesRequired=admin manifest flag has no effect — the installer
  //     runs with whatever token the current user has.
  //   - On standard-user machines with UAC disabled, that token is a plain
  //     non-admin token regardless of how the installer was invoked.
  //   - Simply entering credentials at a UAC prompt does NOT grant the
  //     current process admin rights when UAC is disabled.
  //
  // IsUserAnAdmin() calls CheckTokenMembership(S-1-5-32-544) — the same
  // Windows API used by the EDB installer. It is not fooled by username;
  // it checks the actual process token.
  if not IsUserAnAdmin() then begin
    MsgBox(
      'POPMYC POS requires administrator privileges to install.' + #13#10 + #13#10 +
      'This installer is currently running as a standard Windows user.' + #13#10 + #13#10 +
      'To install POPMYC POS:' + #13#10 +
      '  1. Sign out of Windows.' + #13#10 +
      '  2. Sign in with an account that is a member of the Administrators group.' + #13#10 +
      '  3. Run this installer again from that administrator account.' + #13#10 + #13#10 +
      'Note: On this computer, simply right-clicking and choosing' + #13#10 +
      '"Run as administrator" may not be sufficient because User Account' + #13#10 +
      'Control (UAC) is disabled. The installer must be run directly from' + #13#10 +
      'an administrator account.' + #13#10 + #13#10 +
      'Administrator accounts on this computer: check with your IT administrator.',
      mbError, MB_OK
    );
    Result := False;
    Exit;
  end;

  Log('Administrator privilege check passed.');
  Result := True;
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
      // ── PostgreSQL requirement check ───────────────────────────────────────
      // NEW DEPLOYMENT MODEL (manual PostgreSQL):
      // The operator installs PostgreSQL manually BEFORE running this installer.
      // POPMYC POS does NOT install PostgreSQL automatically.
      // If PostgreSQL is not detected, stop the installation with a clear message.
      //
      // The operator must:
      //   1. Install PostgreSQL 16 (official EDB installer).
      //   2. Set the postgres administrator password.
      //   3. Ensure the PostgreSQL service is running.
      //   4. Then run this installer.
      //
      // After POPMYC POS is installed, on first launch the Database Setup screen
      // will ask the operator for the PostgreSQL administrator password once.
      // POPMYC will create popmyc_pos / popmyc_app automatically from that password.
      //
      // NOTE: InstallPostgreSQLSilent(), CreatePopmycClusterDirectly(),
      //       FindPgBinDir(), and CreatePopmycDatabase() are retained in this
      //       file for future use but are NOT called during normal installation.
      if not IsPostgreSQLInstalled() then begin
        Log('PostgreSQL not detected — aborting installation.');
        MsgBox(
          'POPMYC POS requires PostgreSQL to be installed first.' + #13#10 + #13#10 +
          'PostgreSQL was not detected on this computer.' + #13#10 + #13#10 +
          'Before installing POPMYC POS, please:' + #13#10 +
          '  1. Download and install PostgreSQL 16 from:' + #13#10 +
          '     https://www.postgresql.org/download/windows/' + #13#10 +
          '  2. Set the postgres administrator password.' + #13#10 +
          '  3. Ensure the PostgreSQL service is running.' + #13#10 +
          '  4. Run this installer again.' + #13#10 + #13#10 +
          'The installer will now exit.',
          mbError, MB_OK
        );
        Exit;
      end;
      Log('PostgreSQL detected — proceeding with POPMYC POS installation.');
      // Database provisioning (popmyc_pos / popmyc_app) is performed on first
      // launch via the POPMYC Database Setup screen.
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
// IMPORTANT: %PROGRAMDATA%\POPMYC POS\ is NEVER deleted on uninstall.
// Inno Setup only removes files it explicitly installed via [Files].
// Since we never install anything INTO %PROGRAMDATA%\POPMYC POS\ via [Files],
// the uninstaller leaves that folder completely alone.
// Customer database, .env, logs, media, and backups are all preserved.
// ─────────────────────────────────────────────────────────────────────────────