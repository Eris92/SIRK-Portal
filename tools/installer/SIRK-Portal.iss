#define AppVersion GetEnv("SIRK_PORTAL_VERSION")
#define StageDir GetEnv("SIRK_PORTAL_STAGE")
[Setup]
AppId={{A44C1187-4A5B-4A12-90E8-7AE66C6916E3}
AppName=SIRK Portal
AppVersion={#AppVersion}
DefaultDirName={autopf}\SIRK\Portal
DefaultGroupName=SIRK Portal
OutputBaseFilename=SIRK-Portal-{#AppVersion}-Windows-x64-Setup
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\runtime\node.exe

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs restartreplace

[Run]
Filename: "powershell.exe"; Parameters: "-NoLogo -NoProfile -ExecutionPolicy Bypass -File ""{app}\tools\installer\Install-SIRK-Portal-Service.ps1"" -InstallPath ""{app}"""; Flags: runhidden waituntilterminated

[UninstallRun]
Filename: "{app}\server\daemon\sirkportal.exe"; Parameters: "stop"; Flags: runhidden; RunOnceId: "StopPortal"
Filename: "{app}\server\daemon\sirkportal.exe"; Parameters: "uninstall"; Flags: runhidden; RunOnceId: "RemovePortalService"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Wrapper: String;
  ExitCode: Integer;
begin
  Result := '';
  Wrapper := ExpandConstant('{app}\server\daemon\sirkportal.exe');
  if FileExists(Wrapper) then
  begin
    Exec(Wrapper, 'stop', '', SW_HIDE, ewWaitUntilTerminated, ExitCode);
    Exec(Wrapper, 'uninstall', '', SW_HIDE, ewWaitUntilTerminated, ExitCode);
  end;
end;
