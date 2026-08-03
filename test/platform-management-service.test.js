"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var connectionFactory = require("../server/core/central-connection-config.js");
var platformFactory = require("../server/core/platform-management-service.js");

function asset(name, size) {
    return {
        name: name,
        size: size || 1024,
        browser_download_url: "https://downloads.example/" + encodeURIComponent(name),
        content_type: "application/octet-stream"
    };
}

async function run() {
    var root = fs.mkdtempSync(path.join(os.tmpdir(), "sirk-platform-management-"));
    var oldToken = "12345678901234567890123456789012";
    var newToken = "abcdefghijklmnopqrstuvwxyzABCDEF";
    var remoteCalls = [];
    var issued = 0;
    var groups = {
        list: function () { return [{ id: "default", name: "Default", enrollmentExpiresAtUtc: null }]; },
        issue: function (id) {
            assert.strictEqual(id, "default");
            issued += 1;
            return {
                group: { id: "default", name: "Default" },
                token: "agent-enrollment-token-12345678901234567890",
                expiresAtUtc: "2026-08-03T12:00:00.000Z"
            };
        }
    };
    var releases = [
        { draft: false, prerelease: false, tag_name: "v-incomplete", assets: [asset("SIRK-Agent-Setup.exe")] },
        {
            draft: false,
            prerelease: true,
            tag_name: "v1.0.16-dev.100",
            published_at: "2026-08-02T12:00:00.000Z",
            assets: [
                asset("SIRK-Agent-Setup.exe", 4 * 1024 * 1024),
                asset("SIRK-Agent-Setup.exe.sha256"),
                asset("SIRK-Agent-1.0.16-dev.100-win-x64.msi", 5 * 1024 * 1024),
                asset("SIRK-Agent-1.0.16-dev.100-win-x64.msi.sha256"),
                asset("SIRK-Agent-1.0.16-dev.100-net10-win-x64-framework-dependent.zip", 10 * 1024 * 1024),
                asset("SIRK-Agent-1.0.16-dev.100-net10-win-x64-framework-dependent.zip.sha256"),
                asset("installer-manifest.json"),
                asset("runtime-manifest.json")
            ]
        }
    ];

    connectionFactory.create({ dataRoot: root }).write({
        centralUrl: "https://central.example",
        tunnelUrl: "wss://central.example/tunnel",
        portalId: "portal-test",
        portalName: "Portal Test",
        portalToken: oldToken,
        publicUrl: "https://portal.example"
    });

    var service = platformFactory.create({
        dataRoot: root,
        agentGroups: groups,
        releaseCatalog: function () { return releases; },
        requestJson: function (method, target, headers, body) {
            remoteCalls.push({ method: method, target: target, headers: headers, body: body });
            assert.strictEqual(headers["X-SIRK-Portal-ID"], "portal-test");
            if (method === "GET") {
                assert.strictEqual(headers.Authorization, "Bearer " + oldToken);
                return { ok: true, portal: { id: "portal-test", name: "Portal Test", connected: true } };
            }
            if (method === "PATCH") {
                assert.strictEqual(headers.Authorization, "Bearer " + oldToken);
                assert.strictEqual(body.name, "Portal Renamed");
                return { ok: true, portal: { id: "portal-test", name: "Portal Renamed", connected: true } };
            }
            if (method === "POST") {
                assert.strictEqual(headers.Authorization, "Bearer " + oldToken);
                return {
                    ok: true,
                    bootstrap: {
                        schemaVersion: 1,
                        centralUrl: "https://central.example",
                        tunnelUrl: "wss://central.example/tunnel",
                        configUrl: "https://central.example/api/portal/v1/config",
                        heartbeatUrl: "https://central.example/api/portal/v1/heartbeat",
                        portalId: "portal-test",
                        portalName: "Portal Renamed",
                        portalToken: newToken,
                        createdAtUtc: "2026-08-02T12:00:00.000Z"
                    }
                };
            }
            if (method === "DELETE") {
                assert.strictEqual(headers.Authorization, "Bearer " + newToken);
                return { ok: true, portal: { id: "portal-test", name: "Portal Renamed" } };
            }
            throw new Error("Unexpected request method: " + method);
        }
    });

    try {
        var localStatus = service.status();
        assert.strictEqual(localStatus.connection.configured, true);
        assert.strictEqual(localStatus.agentGroups.length, 1);

        var release = await service.request("agent-installers", { body: {} });
        assert.strictEqual(release.version, "v1.0.16-dev.100");
        assert.strictEqual(release.prerelease, true);
        assert.strictEqual(release.targetFramework, "net10.0-windows");
        assert.ok(release.installers.exe.checksumUrl);
        assert.ok(release.installers.msi.checksumUrl);
        assert.ok(release.installers.zip.checksumUrl);
        assert.ok(release.installers.installerManifest.downloadUrl);
        assert.ok(release.installers.runtimeManifest.downloadUrl);

        var deployment = await service.request("agent-deployment", {
            body: { groupId: "default", portalOrigin: "https://portal.example", channel: "stable" }
        });
        assert.strictEqual(issued, 1);
        assert.strictEqual(deployment.enrollmentToken, "agent-enrollment-token-12345678901234567890");
        assert.match(deployment.silentInstall.exe, /SIRK-Agent-Setup\.exe/);
        assert.match(deployment.silentInstall.exe, /--portal-url 'https:\/\/portal\.example'/);
        assert.match(deployment.silentInstall.msi, /msiexec\.exe \/i/);
        assert.match(deployment.silentInstall.msi, /ENROLLMENT_TOKEN=/);

        var refreshed = await service.request("central-refresh", { body: {} });
        assert.strictEqual(refreshed.central.connected, true);

        var renamed = await service.request("central-update", { body: { portalName: "Portal Renamed" } });
        assert.strictEqual(renamed.connection.portalName, "Portal Renamed");
        var afterRename = connectionFactory.create({ dataRoot: root }).read();
        assert.strictEqual(afterRename.portalName, "Portal Renamed");
        assert.strictEqual(afterRename.portalToken, oldToken);

        var rotated = await service.request("central-rotate", { body: {} });
        assert.strictEqual(rotated.connection.portalName, "Portal Renamed");
        var afterRotate = connectionFactory.create({ dataRoot: root }).read();
        assert.strictEqual(afterRotate.portalToken, newToken);
        assert.strictEqual(afterRotate.publicUrl, "https://portal.example");

        var disconnected = await service.request("central-disconnect", { body: {} });
        assert.strictEqual(disconnected.disconnected, true);
        assert.strictEqual(fs.existsSync(path.join(root, "central-connection.json")), false);
        assert.strictEqual(remoteCalls.length, 4);

        assert.throws(function () {
            platformFactory.completeAgentRelease([{ draft: false, assets: [asset("SIRK-Agent-Setup.exe")] }]);
        }, /No complete SIRK Agent/);

        console.log("platform-management-service: OK");
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

run().catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
