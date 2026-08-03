"use strict";

var assert = require("assert");
var fs = require("fs");

var installer = fs.readFileSync("install-v3.ps1", "utf8");
var cleaner = fs.readFileSync("clean-install.ps1", "utf8");

assert.match(installer, /function Remove-ServiceIfPresent/);
assert.match(installer, /Get-Service -Name \$Name/);
assert.match(installer, /Install-WinSwService -ServiceName 'SirkPortal'/);
assert.match(installer, /Install-WinSwService -ServiceName 'SirkPortalWatchdog'/);
assert.match(installer, /SIRK_SERVICE_NAME = 'SirkPortal'/);
assert.match(installer, /SIRK_PORTAL_SERVICE_NAME = 'SirkPortal'/);
assert.match(installer, /SIRK_PORTAL_WATCHDOG_SERVICE_NAME|PortalWatchdogServiceName SirkPortalWatchdog/);
assert.match(installer, /'SirkPortalStandalone'/);
assert.match(installer, /'sirkportal\.exe'/);
assert.match(installer, /'sirkportalwatchdog\.exe'/);

assert.match(cleaner, /function Remove-SirkService/);
assert.match(cleaner, /Wait-ServiceDeletion/);
assert.match(cleaner, /'SirkPortal'/);
assert.match(cleaner, /'SirkPortalWatchdog'/);
assert.match(cleaner, /'SirkPortalStandalone'/);
assert.match(cleaner, /sc\.exe delete \$Name/);
assert.doesNotMatch(cleaner, /install\.ps1\?nocache/);

console.log("installer-service-detection-contract: OK");
