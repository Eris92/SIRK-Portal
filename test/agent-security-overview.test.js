"use strict";
var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var factory = require("../server/modules/security/index.js");
var root = fs.mkdtempSync(path.join(os.tmpdir(), "sirk-agent-security-"));
try {
    fs.writeFileSync(path.join(root, "agent-registry.json"), JSON.stringify({ devices: {
        "tenant/device": {
            tenantId: "tenant", deviceId: "device", machineName: "PC-1", agentVersion: "1.0.0",
            lastSeenUtc: new Date().toISOString(), publicKeySpki: "configured",
            heartbeat: { stateStatus: "OK" }, management: { status: "Healthy" },
            runtimeHealth: { privateMemoryBytes: 123 }, security: { status: "OK" },
            quarantine: { quarantined: false }, endurance: { sampleCount: 12 },
            activity: { enabled: true }, browserActivity: { tabs: 1 },
            risk: { level: "Low" }, tamper: { detected: false },
            portalStatus: { ok: true }, telemetryQueue: { files: 2 }, lastBatchHash: "abc"
        }
    } }), "utf8");
    var module = factory.createModule({
        dataRoot: root, fs: fs, path: path,
        integrations: {
            get: function () { return {}; },
            configured: function () { return { defender: false }; },
            publicSettings: function () { return {}; }
        }
    });
    var result = module.apiGet("agent-overview", {}, { siteadmin: 0xFFFFFFFF });
    assert.strictEqual(result.devices.length, 1);
    ["heartbeat", "management", "runtimeHealth", "security", "quarantine", "endurance",
        "activity", "browserActivity", "risk", "tamper", "portalStatus", "telemetryQueue",
        "evidenceBatchChain"].forEach(function (field) {
        assert.ok(Object.prototype.hasOwnProperty.call(result.devices[0], field), "Missing reading: " + field);
    });
    assert.ok(result.categories.some(function (item) { return item.key === "endurance" && item.fields.indexOf("endurance") >= 0; }));
    assert.ok(result.categories.some(function (item) { return item.key === "quarantine" && item.fields.indexOf("security") >= 0; }));
    console.log("SIRK Agent Security overview readings: OK");
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
