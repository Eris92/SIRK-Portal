"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");
var helper = fs.readFileSync(path.join(root, "server", "update-helper.js"), "utf8");
var watchdog = fs.readFileSync(path.join(root, "tools", "watchdog", "portal-watchdog.js"), "utf8");

test("updater does not persistently disable the Portal service", function () {
    assert.doesNotMatch(helper, /start=\s*["']?,?\s*["']disabled/i);
    assert.match(helper, /start=\", \"auto/);
});

test("updater owns a maintenance lock and removes it in finally", function () {
    assert.match(helper, /maintenance\.lock/);
    assert.match(helper, /fs\.writeFileSync\(maintenanceFile/);
    assert.match(helper, /finally\s*\{/);
    assert.match(helper, /removeFile\(maintenanceFile\)/);
});

test("success is committed only after service start and health verification", function () {
    var startIndex = helper.indexOf("startWindowsService(serviceName)", helper.indexOf("function main()"));
    var healthIndex = helper.indexOf("requestHealthy(healthUrl", startIndex);
    var completeIndex = helper.indexOf("complete(stateFile, manifest.history", healthIndex);
    assert.ok(startIndex >= 0);
    assert.ok(healthIndex > startIndex);
    assert.ok(completeIndex > healthIndex);
});

test("rollback restarts and verifies the previous version", function () {
    assert.match(helper, /replaceApplication\(target, rollback, preserve\)/);
    assert.match(helper, /rollbackHealthy = true/);
});

test("watchdog suspends checks and recovery during maintenance", function () {
    assert.match(watchdog, /maintenance\.lock/);
    assert.match(watchdog, /Maintenance mode active/);
    assert.match(watchdog, /if \(recovering \|\| fs\.existsSync\(maintenanceFile\)\) return false/);
});
