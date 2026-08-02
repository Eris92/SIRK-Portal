"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var script = fs.readFileSync(path.join(__dirname, "..", "tools", "test", "Test-SirkPortal-Rc.ps1"), "utf8");
assert.ok(script.indexOf("#requires -RunAsAdministrator") >= 0);
assert.ok(script.indexOf("/api/system/status") >= 0);
assert.ok(script.indexOf("SirkPortal") >= 0);
assert.ok(script.indexOf("SirkUpdater") >= 0);
assert.ok(script.indexOf("Restart-Service -Name $PortalService") >= 0);
assert.ok(script.indexOf("Restart-Service -Name $UpdaterService") >= 0);
assert.ok(script.indexOf("central.portalId") >= 0);
assert.ok(script.indexOf("SIRK_PORTAL_RC_TEST_OK") >= 0);
console.log("rc-readiness-script contract test passed");
