"use strict";
var assert = require("assert");
var crypto = require("crypto");
var fs = require("fs");
var os = require("os");
var path = require("path");
var factory = require("../server/core/agent-policy-service.js");
var root = fs.mkdtempSync(path.join(os.tmpdir(), "sirk-agent-policy-"));
try {
    var service = factory.create({ dataRoot: root });
    var enrollment = service.enroll("tenant", "device", "warsaw");
    assert.strictEqual(enrollment.trustedPolicyKeys.length, 1);
    assert.strictEqual(enrollment.policy.settings.remoteDesktopEnabled, true);
    assert.strictEqual(enrollment.policy.settings.remoteAdministrativeDesktopEnabled, true);
    assert.strictEqual(enrollment.policy.settings.remoteTerminalEnabled, true);
    assert.strictEqual(enrollment.policy.settings.remoteFilesEnabled, true);
    assert.strictEqual(enrollment.policy.settings.hostGroupId, "warsaw");
    var signature = Buffer.from(enrollment.policy.signature.value, "base64url");
    assert.strictEqual(signature.length, 64);
    assert.ok(service.canonical(enrollment.policy, true).indexOf("\\u002B00:00") >= 0);
    assert.strictEqual(crypto.verify("sha256",
        Buffer.from(service.canonical(enrollment.policy, true), "utf8"),
        { key: enrollment.trustedPolicyKeys[0].publicKeyPem, dsaEncoding: "ieee-p1363" }, signature), true);
    assert.strictEqual(fs.existsSync(path.join(root, "agent-policy-outbox", "tenant", "device",
        enrollment.policy.policyId + ".policy.json")), true);
    assert.strictEqual(service.trustedKeys()[0].keyId, enrollment.trustedPolicyKeys[0].keyId);
    console.log("SIRK Agent production policy enrollment: OK");
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
