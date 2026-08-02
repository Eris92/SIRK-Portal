"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var statusFactory = require("../server/core/system-status.js");

var root = fs.mkdtempSync(path.join(os.tmpdir(), "sirk-system-status-"));
try {
    var portalData = path.join(root, "Portal");
    var updaterData = path.join(root, "Updater");
    fs.mkdirSync(path.join(portalData, "TLS"), { recursive: true });
    fs.mkdirSync(path.join(updaterData, "applications"), { recursive: true });
    fs.mkdirSync(path.join(updaterData, "operations", "sirk-portal", "op-1"), { recursive: true });
    fs.writeFileSync(path.join(portalData, "TLS", "portal.pfx"), "test");
    fs.writeFileSync(path.join(portalData, "TLS", "portal-pfx-password.txt"), "secret-password");
    fs.writeFileSync(path.join(portalData, "central-connection.json"), JSON.stringify({
        centralUrl: "https://central.sirkportal.com",
        tunnelUrl: "wss://central.sirkportal.com/tunnel",
        portalId: "portal-test",
        portalToken: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
        updatedAtUtc: "2026-08-02T08:00:00Z"
    }));
    fs.writeFileSync(path.join(portalData, "agent-registry.json"), JSON.stringify({ devices: {
        one: { lastSeenUtc: new Date().toISOString() },
        two: { lastSeenUtc: "2020-01-01T00:00:00Z" }
    } }));
    fs.writeFileSync(path.join(updaterData, "applications", "sirk-portal.json"), JSON.stringify({
        applicationId: "sirk-portal", channel: "dev"
    }));
    fs.writeFileSync(path.join(updaterData, "operations", "sirk-portal", "op-1", "state.json"), JSON.stringify({
        phase: "completed", targetVersion: "2.0.0-dev.33", updatedAtUtc: "2026-08-02T08:05:00Z"
    }));

    var value = statusFactory.create({ dataRoot: portalData, updaterRoot: updaterData, version: "2.0.0-dev.33" }).collect();
    assert.strictEqual(value.portal.version, "2.0.0-dev.33");
    assert.strictEqual(value.central.configured, true);
    assert.strictEqual(value.central.portalId, "portal-test");
    assert.strictEqual(value.agents.total, 2);
    assert.strictEqual(value.agents.online, 1);
    assert.strictEqual(value.certificate.configured, true);
    assert.strictEqual(value.updater.registered, true);
    assert.strictEqual(value.updater.lastOperation.targetVersion, "2.0.0-dev.33");
    assert.strictEqual(JSON.stringify(value).indexOf("portalToken"), -1);
    assert.strictEqual(JSON.stringify(value).indexOf("secret-password"), -1);

    var gateway = fs.readFileSync(path.join(__dirname, "..", "server", "standalone-https.js"), "utf8");
    assert.ok(gateway.indexOf('url.pathname === "/api/system/status"') >= 0);
    assert.ok(gateway.indexOf('value.status === "critical" ? 503 : 200') >= 0);
    assert.ok(gateway.indexOf("statusCollector.collect()") >= 0);
    console.log("system-status contract test passed");
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
