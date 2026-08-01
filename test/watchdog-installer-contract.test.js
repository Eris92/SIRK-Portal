"use strict";

var assert = require("assert");
var fs = require("fs");

var watchdog = fs.readFileSync("tools/watchdog/portal-watchdog.js", "utf8");
var installer = fs.readFileSync("tools/watchdog/Install-SirkPortalWatchdog.ps1", "utf8");
var migration = fs.readFileSync("tools/watchdog/Migrate-SirkPortalServices.ps1", "utf8");

assert.match(watchdog, /SirkPortal/);
assert.match(watchdog, /https:\/\/127\.0\.0\.1\/login/);
assert.doesNotMatch(watchdog, /9443\/health/);

assert.match(installer, /node-windows@1\.0\.0-beta\.8/);
assert.match(installer, /SirkPortalWatchdog/);
assert.match(installer, /LegacyPortalServiceName = 'SirkPortalStandalone'/);
assert.match(installer, /SIRK_PORTAL_HEALTH_URL', value: 'https:\/\/127\.0\.0\.1\/login'/);
assert.doesNotMatch(installer, /sc\.exe create/);

assert.match(migration, /ServiceName = 'SirkPortal'/);
assert.match(migration, /LegacyServiceName = 'SirkPortalStandalone'/);
assert.match(migration, /sc\.exe delete \$LegacyServiceName/);
assert.match(migration, /SIRK_PORTAL_SERVICE_MIGRATION_OK/);

console.log("watchdog-installer-contract: OK");
