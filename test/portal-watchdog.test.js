"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var watchdogFactory = require("../tools/watchdog/portal-watchdog.js");

function writeTree(root, valid) {
    var files = [
        "config.json",
        "package.json",
        "server/standalone.js",
        "server/standalone-https.js",
        "server/core/runtime.js",
        "server/core/identity-store.js",
        "server/http/api-router.js",
        "public/portal/standalone/index.html",
        "public/portal/standalone/login.html",
        "public/portal/settings.js",
        "portal-independence.json"
    ];
    files.forEach(function (relative) {
        var target = path.join(root, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, relative === "config.json" ? JSON.stringify({ applicationId: valid ? "sirk-portal" : "invalid" }) : "x");
    });
}

async function run() {
    var temp = fs.mkdtempSync(path.join(os.tmpdir(), "sirk-watchdog-"));
    var portalRoot = path.join(temp, "Portal");
    var dataRoot = path.join(temp, "Data");
    var backupRoot = path.join(dataRoot, "updates", "backups", "backup-one", "app");
    writeTree(backupRoot, true);
    fs.mkdirSync(portalRoot, { recursive: true });
    fs.writeFileSync(path.join(portalRoot, "package.json"), "{}");

    var copied = false;
    var commands = [];
    var watchdog = watchdogFactory.create({
        portalRoot: portalRoot,
        dataRoot: dataRoot,
        threshold: 2,
        requestHealth: function () { return false; },
        serviceRunning: function () { return false; },
        run: function (file, args) { commands.push([file].concat(args)); return { status: 0, stdout: "" }; },
        copyTree: function (source, target) {
            copied = true;
            fs.rmSync(target, { recursive: true, force: true });
            fs.cpSync(source, target, { recursive: true });
        }
    });

    assert.strictEqual(watchdog.validateRoot(portalRoot).ok, false);
    var first = await watchdog.check();
    assert.strictEqual(first.recovered, false);
    var second = await watchdog.check();
    assert.strictEqual(second.recovered, true);
    assert.strictEqual(copied, true);
    assert.strictEqual(watchdog.validateRoot(portalRoot).ok, true);
    assert.ok(commands.some(function (entry) { return entry[0] === "sc.exe" && entry[1] === "start"; }));
    assert.ok(fs.existsSync(path.join(dataRoot, "watchdog", "state.json")));

    fs.rmSync(temp, { recursive: true, force: true });
    console.log("portal-watchdog test passed");
}

run().catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
