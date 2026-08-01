"use strict";

var assert = require("assert");
var fs = require("fs");

var installer = fs.readFileSync("install.ps1", "utf8");

assert.match(installer, /Get-CimInstance Win32_Service/);
assert.match(installer, /DisplayName -eq 'SIRK Portal'/);
assert.match(installer, /DisplayName -eq 'SIRK Portal Watchdog'/);
assert.match(installer, /sirkportal\.exe/);
assert.match(installer, /sirkportalwatchdog\.exe/);
assert.match(installer, /HKLM:\\\\SYSTEM\\\\CurrentControlSet\\\\Services/);
assert.match(installer, /Stop-Service -Name \$watchdog\.Name/);
assert.match(installer, /Start-Service -Name \$watchdog\.Name/);
assert.doesNotMatch(installer, /Get-CimInstance Win32_Service -Filter \"Name='SirkPortal'\"/);

console.log("installer-service-detection-contract: OK");
