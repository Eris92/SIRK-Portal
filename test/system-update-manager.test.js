"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var managerFactory = require("../server/system-update-manager.js");

function waitForJob(manager, jobId) {
    return new Promise(function (resolve, reject) {
        var attempts = 0;
        var timer = setInterval(function () {
            attempts += 1;
            var job = manager.job(jobId);
            if (job && job.status === "completed") { clearInterval(timer); resolve(job); }
            else if (job && job.status === "failed") { clearInterval(timer); reject(new Error(job.error)); }
            else if (attempts > 200) { clearInterval(timer); reject(new Error("Timed out waiting for update job.")); }
        }, 10);
    });
}

(async function () {
    var root = fs.mkdtempSync(path.join(os.tmpdir(), "sirk-update-manager-app-"));
    var dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sirk-update-manager-data-"));
    fs.mkdirSync(path.join(root, "server"), { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "0.9.0" }));
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ applicationId: "sirk-portal", version: "1.0.0" }));
    fs.writeFileSync(path.join(root, "server", "standalone.js"), "module.exports = {};\n");
    fs.writeFileSync(path.join(root, "server", "update-helper.js"), "module.exports = {};\n");

    var manager = managerFactory.create({ appRoot: root, dataRoot: dataRoot });
    assert.deepStrictEqual(manager.channels, { stable: "main", beta: "beta", dev: "develop" });
    assert.strictEqual(typeof manager.restart, "function");
    assert.strictEqual(typeof manager.deleteBackup, "function");
    assert.strictEqual(manager.current().version, "1.0.0");
    assert.strictEqual(manager.current().channel, "stable");
    assert.strictEqual(manager.current().branch, "main");
    assert.strictEqual(manager.current().pending, null);
    assert.strictEqual(manager.setChannel("beta").branch, "beta");
    assert.strictEqual(manager.setChannel("dev").branch, "develop");
    assert.strictEqual(manager.health().ok, true);

    var queued = manager.backup("manual");
    assert.ok(queued.jobId);
    assert.strictEqual(queued.status, "queued");
    var job = await waitForJob(manager, queued.jobId);
    assert.strictEqual(job.result.version, "1.0.0");
    assert.strictEqual(manager.backups().length, 1);
    var backupDirectory = path.join(dataRoot, "updates", "backups", job.result.id);
    assert.ok(fs.existsSync(path.join(backupDirectory, "manifest.json")));
    assert.ok(fs.existsSync(path.join(backupDirectory, "app", "package.json")));

    await assert.rejects(function () { return manager.deleteBackup("../outside"); }, /Invalid backup identifier/);

    var deleted = await manager.deleteBackup(job.result.id);
    assert.deepStrictEqual(deleted, { deleted: true, backupId: job.result.id });
    assert.strictEqual(manager.backups().length, 0);
    assert.strictEqual(fs.existsSync(backupDirectory), false);
    assert.strictEqual(manager.state().history[0].type, "backup-deleted");
    assert.strictEqual(manager.state().history[0].backupId, job.result.id);
    await assert.rejects(function () { return manager.deleteBackup(job.result.id); }, /Backup was not found/);

    fs.writeFileSync(path.join(dataRoot, "updates", "state.json"), JSON.stringify({
        channel: "dev",
        pending: { token: "missing-operation", targetVersion: "9.9.9" },
        history: [],
        jobs: { interrupted: { id: "interrupted", type: "update", status: "running", progress: 45 } }
    }));
    var recovered = managerFactory.create({ appRoot: root, dataRoot: dataRoot });
    assert.strictEqual(recovered.job("interrupted").status, "failed");
    assert.strictEqual(recovered.current().pending, null);
    console.log("system-update-manager.test.js: OK");
}()).catch(function (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
});
