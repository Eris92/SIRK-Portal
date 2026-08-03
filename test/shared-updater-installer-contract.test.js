"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const installer = fs.readFileSync(path.join(root, "install-v3.ps1"), "utf8");
const integration = fs.readFileSync(path.join(root, "tools", "installer", "Ensure-SirkUpdater.ps1"), "utf8");

assert.match(installer, /Ensure-SirkUpdater\.ps1/);
assert.match(installer, /SirkPortalWatchdog/);
assert.match(installer, /Channel dev/);
assert.doesNotMatch(installer, /AllowSourceFallback/);
assert.doesNotMatch(installer, /install-release\.ps1/);

assert.match(integration, /Get-Service -Name 'SirkUpdater'/);
assert.match(integration, /SIRK-Updater\/main\/install-release-v2\.ps1/);
assert.doesNotMatch(integration, /AllowSourceFallback/);
assert.doesNotMatch(integration, /SIRK-Updater\/main\/install-release\.ps1/);
assert.doesNotMatch(integration, /SIRK-Updater\/main\/install\.ps1/);
assert.match(integration, /applicationId\s*=\s*'sirk-portal'/);
assert.match(integration, /serviceName\s*=\s*\$portalService\.Name/);
assert.match(integration, /watchdogServiceName\s*=\s*if\s*\(\$watchdog\)/);
assert.match(integration, /healthUrl\s*=\s*'https:\/\/127\.0\.0\.1\/login'/);
assert.match(integration, /channel\s*=\s*\$Channel/);
assert.match(integration, /&\s*\$updaterCli\s+register\s+\$manifestPath/);
assert.match(integration, /&\s*\$updaterCli\s+show\s+sirk-portal/);
assert.match(integration, /SIRK_PORTAL_SHARED_UPDATER_READY/);

console.log("shared-updater-installer-contract: OK");
