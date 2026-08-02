"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var factory = require("../server/core/central-connection-config.js");

var root = fs.mkdtempSync(path.join(os.tmpdir(), "sirk-central-config-"));
try {
    var store = factory.create({ dataRoot: root });
    assert.strictEqual(store.read(), null);
    var result = store.write({
        centralUrl: "https://central.sirkportal.com",
        portalId: "portal-test",
        portalName: "Portal Test",
        portalToken: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
        publicUrl: "https://portal.example.test"
    });
    assert.strictEqual(result.configured, true);
    assert.strictEqual(result.centralUrl, "https://central.sirkportal.com");
    assert.strictEqual(result.tunnelUrl, "wss://central.sirkportal.com/tunnel");
    assert.strictEqual(result.portalId, "portal-test");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(result, "portalToken"), false);

    var raw = JSON.parse(fs.readFileSync(store.filePath, "utf8"));
    assert.strictEqual(raw.portalToken, "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG");
    assert.strictEqual(raw.tunnelUrl, "wss://central.sirkportal.com/tunnel");
    assert.strictEqual(store.status().configured, true);

    assert.throws(function () {
        store.write({
            centralUrl: "http://central.example.test",
            portalId: "portal-test",
            portalName: "Portal Test",
            portalToken: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"
        });
    }, /HTTPS origin/);
    assert.throws(function () {
        store.write({
            centralUrl: "https://central.example.test",
            tunnelUrl: "wss://evil.example.test/tunnel",
            portalId: "portal-test",
            portalName: "Portal Test",
            portalToken: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"
        });
    }, /Central origin/);
    assert.throws(function () {
        store.write({
            centralUrl: "https://central.example.test",
            portalId: "Bad ID",
            portalName: "Portal Test",
            portalToken: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"
        });
    }, /Portal ID/);

    var runtimeText = fs.readFileSync(path.join(__dirname, "..", "server", "core", "runtime-portal.js"), "utf8");
    assert.ok(runtimeText.indexOf('moduleName === "_central"') >= 0);
    assert.ok(runtimeText.indexOf('asset === "bootstrap"') >= 0);
    assert.ok(runtimeText.indexOf("shared.isSiteAdmin(user)") >= 0);
    assert.ok(runtimeText.indexOf("restartRequired: true") >= 0);
    assert.ok(runtimeText.indexOf("centralConnection.write") >= 0);

    var httpsText = fs.readFileSync(path.join(__dirname, "..", "server", "standalone-https.js"), "utf8");
    assert.ok(httpsText.indexOf("applyCentralConnection(dataRoot)") >= 0);
    assert.ok(httpsText.indexOf("SIRK_CENTRAL_TOKEN") >= 0);

    var navigationText = fs.readFileSync(path.join(__dirname, "..", "public", "portal", "standalone", "scripts", "navigation.js"), "utf8");
    assert.ok(navigationText.indexOf("/api/modules/_central/bootstrap") >= 0);
    assert.ok(navigationText.indexOf("Import bootstrap JSON") >= 0);
    assert.ok(navigationText.indexOf("data-central-bootstrap-file") >= 0);
    assert.ok(navigationText.indexOf("restartPortal(result.restartService)") >= 0);
    assert.ok(navigationText.indexOf("localStorage.setItem") < 0 || navigationText.indexOf("portalToken") < 0);

    var configureText = fs.readFileSync(path.join(__dirname, "..", "tools", "Configure-SirkCentral.ps1"), "utf8");
    assert.ok(configureText.indexOf("central-connection.json") >= 0);
    assert.ok(configureText.indexOf("CurrentControlSet\\Services") < 0);
    assert.ok(configureText.indexOf("icacls.exe") >= 0);
    console.log("central-connection-config test passed");
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
