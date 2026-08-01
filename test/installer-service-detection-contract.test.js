"use strict";

var assert = require("assert");
var fs = require("fs");

var installer = fs.readFileSync("install.ps1", "utf8");

assert.match(installer, /function Get-SirkServiceCandidates/);
assert.match(installer, /Wait-RegisteredService -Kind Portal/);
assert.match(installer, /Wait-RegisteredService -Kind Watchdog/);
assert.match(installer, /\.PathName -match '\\\\SIRK\\\\Portal\\\\daemon\\\\'/);
assert.match(installer, /DisplayName -eq 'SIRK Portal'/);
assert.match(installer, /DisplayName -eq 'SIRK Portal Watchdog'/);
assert.match(installer, /SIRK_SERVICE_NAME=\$portalServiceName/);
assert.match(installer, /Set-ServiceIdentity \$portalServiceName 'SIRK Portal'/);
assert.match(installer, /Set-ServiceIdentity \$watchdogServiceName 'SIRK Portal Watchdog'/);
assert.doesNotMatch(installer, /Get-CimInstance Win32_Service -Filter \"Name='SirkPortal'\"/);
assert.doesNotMatch(installer, /HKLM:\\\\SYSTEM\\\\CurrentControlSet\\\\Services\\\\SirkPortal'/);
assert.match(installer, /function New-RandomBase64/);
assert.match(installer, /RandomNumberGenerator\]::Create\(\)/);
assert.doesNotMatch(installer, /RandomNumberGenerator\]::GetBytes\(48\)/);

console.log("installer-service-detection-contract: OK");
