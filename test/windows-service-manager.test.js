"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var managerFactory = require("../server/windows-service-manager.js");

var root = fs.mkdtempSync(path.join(os.tmpdir(), "sirk-service-manager-"));
var spawned = null;
var manager = managerFactory.create({
    dataRoot: root,
    serviceName: "SirkPortalStandalone",
    executePowerShell: function () {
        return JSON.stringify({
            name: "SirkPortalStandalone",
            displayName: "SIRK Portal Standalone",
            state: "Running",
            startMode: "Auto",
            processId: 8916,
            pathName: "C:\\Program Files\\SIRK\\Portal\\Service\\SirKPortal.exe"
        });
    },
    spawn: function (command, args, options) {
        spawned = { command: command, args: args, options: options };
        return { unref: function () {} };
    }
});

var services = manager.services();
assert.strictEqual(services.length, 1);
assert.strictEqual(services[0].name, "SirkPortalStandalone");
assert.strictEqual(services[0].state, "Running");
assert.strictEqual(services[0].startMode, "Automatic");
assert.strictEqual(services[0].processId, 8916);
assert.strictEqual(services[0].canRestart, true);
assert.throws(function () { manager.scheduleRestart("OtherService"); }, /not managed/);
var result = manager.scheduleRestart("SirkPortalStandalone");
assert.strictEqual(result.scheduled, true);
assert.ok(spawned && spawned.options.detached);
assert.ok(fs.existsSync(spawned.args[spawned.args.length - 1]));
fs.rmSync(root, { recursive: true, force: true });

console.log("windows-service-manager: OK");
