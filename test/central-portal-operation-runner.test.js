"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var runnerFactory = require("../server/core/central-portal-operation-runner.js");

var root = fs.mkdtempSync(path.join(os.tmpdir(), "sirk-portal-operation-"));
try {
    var runner = runnerFactory.create({ dataRoot: root, updaterCli: path.join(root, "SirkUpdater.exe") });
    assert.throws(function () {
        runner.validate({ id: "cmd-update-one", type: "update", payload: {
            applicationId: "sirk-agent",
            packageUrl: "https://github.com/Eris92/SIRK-Portal/releases/download/test/portal.zip",
            sha256: "A".repeat(64), targetVersion: "2.0.0-dev.32"
        } });
    }, /Only sirk-portal/);
    assert.throws(function () {
        runner.validate({ id: "cmd-update-one", type: "update", payload: {
            applicationId: "sirk-portal", packageUrl: "https://evil.example/portal.zip",
            sha256: "A".repeat(64), targetVersion: "2.0.0-dev.32"
        } });
    }, /approved GitHub/);
    assert.throws(function () {
        runner.validate({ id: "cmd-update-one", type: "update", payload: {
            applicationId: "sirk-portal", packageUrl: "https://github.com/Eris92/SIRK-Portal/releases/download/test/portal.zip",
            sha256: "invalid", targetVersion: "2.0.0-dev.32"
        } });
    }, /SHA256/);
    var valid = runner.validate({ id: "cmd-update-one", type: "update", payload: {
        applicationId: "sirk-portal", packageUrl: "https://github.com/Eris92/SIRK-Portal/releases/download/test/portal.zip",
        sha256: "A".repeat(64), targetVersion: "2.0.0-dev.32"
    } });
    assert.strictEqual(valid.type, "update");
    assert.strictEqual(valid.targetVersion, "2.0.0-dev.32");

    var job = path.join(root, "central-portal-operations", "cmd-update-one");
    fs.mkdirSync(job, { recursive: true });
    fs.writeFileSync(path.join(job, "result.json"), JSON.stringify({ state: "completed", message: "done", detail: { targetVersion: "2.0.0-dev.32" } }));
    assert.deepStrictEqual(runner.status("cmd-update-one"), {
        state: "completed", message: "done", result: { targetVersion: "2.0.0-dev.32" }
    });
    console.log("central-portal-operation-runner test passed");
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
