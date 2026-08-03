"use strict";
var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var factory = require("../server/core/agent-group-service.js");
var root = fs.mkdtempSync(path.join(os.tmpdir(), "sirk-agent-groups-"));
try {
    var service = factory.create({ dataRoot: root });
    var group = service.create({ name: "Biuro Warszawa", description: "Komputery biurowe" });
    assert.strictEqual(group.id, "biuro-warszawa");
    assert.strictEqual(service.list().length, 1);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(service.list()[0], "enrollmentTokenHash"), false);

    var script = service.bootstrapScript(group.id, "silent", "https://portal.example");
    assert.ok(script.indexOf("SIRK-Agent-Setup.exe") >= 0);
    assert.ok(script.indexOf("SIRK-Agent-Setup.exe.sha256") >= 0);
    assert.ok(script.indexOf("runtime-manifest.json") >= 0);
    assert.ok(script.indexOf("Get-FileHash -LiteralPath $exe -Algorithm SHA256") >= 0);
    assert.ok(script.indexOf("--portal-url \"https://portal.example\"") >= 0);
    assert.strictEqual(script.indexOf("Install-SirkAgent.ps1"), -1);

    var stored = JSON.parse(fs.readFileSync(path.join(root, "device-groups.json"), "utf8"));
    assert.match(stored.groups[0].enrollmentTokenHash, /^[a-f0-9]{64}$/);
    assert.strictEqual(script.indexOf(stored.groups[0].enrollmentTokenHash), -1);

    var tokenMatch = script.match(/--enrollment-token ("[A-Za-z0-9_-]+") --channel stable/);
    assert.ok(tokenMatch);
    var token = JSON.parse(tokenMatch[1]);
    assert.deepStrictEqual(service.resolveEnrollment(token), { groupId: group.id });
    assert.strictEqual(service.resolveEnrollment("wrong"), null);

    service.assign("device-1", group.id);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, "device-groups.json"), "utf8")).assignments["device-1"], group.id);
    assert.throws(function () {
        service.bootstrapScript(group.id, "run", "https://portal.example");
    }, /Run-only Agent mode was removed/);

    service.remove(group.id);
    assert.deepStrictEqual(service.list(), []);
    console.log("SIRK Agent host groups: OK");
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
