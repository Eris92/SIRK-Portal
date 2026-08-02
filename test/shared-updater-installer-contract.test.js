"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const installer = fs.readFileSync(path.join(__dirname, "..", "install.ps1"), "utf8");

assert.match(installer, /function\s+Ensure-SirkUpdater\b/);
assert.match(installer, /Get-Service\s+-Name\s+'SirkUpdater'/);
assert.match(installer, /SIRK-Updater\/main\/install\.ps1/);
assert.match(installer, /function\s+Register-PortalWithUpdater\b/);
assert.match(installer, /applicationId\s*=\s*'sirk-portal'/);
assert.match(installer, /serviceName\s*=\s*\$PortalService\.Name/);
assert.match(installer, /watchdogServiceName\s*=\s*\$WatchdogService\.Name/);
assert.match(installer, /healthUrl\s*=\s*'https:\/\/127\.0\.0\.1\/login'/);
assert.match(installer, /&\s*\$UpdaterCli\s+register\s+\$manifestPath/);
assert.match(installer, /&\s*\$UpdaterCli\s+show\s+sirk-portal/);
assert.match(installer, /Shared updater:\s*SIRK Updater/);

console.log("shared-updater-installer-contract: OK");
