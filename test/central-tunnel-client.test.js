"use strict";

var assert = require("assert");
var fs = require("fs");
var http = require("http");
var os = require("os");
var path = require("path");
var WebSocket = require("ws");
var WebSocketServer = WebSocket.WebSocketServer;
var clientFactory = require("../server/core/central-tunnel-client.js");

async function run() {
    var updaterRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sirk-updater-telemetry-"));
    fs.mkdirSync(path.join(updaterRoot, "applications"), { recursive: true });
    fs.mkdirSync(path.join(updaterRoot, "operations", "sirk-portal", "operation-one"), { recursive: true });
    fs.writeFileSync(path.join(updaterRoot, "applications", "sirk-portal.json"), JSON.stringify({
        applicationId: "sirk-portal",
        channel: "dev"
    }));
    fs.writeFileSync(path.join(updaterRoot, "operations", "sirk-portal", "operation-one", "state.json"), JSON.stringify({
        phase: "Completed",
        targetVersion: "2.0.0-dev.30",
        updatedAtUtc: "2026-08-02T07:00:00.000Z"
    }));

    var local = http.createServer(function (req, res) {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, path: req.url }));
    });
    await new Promise(function (resolve) { local.listen(0, "127.0.0.1", resolve); });
    var central = http.createServer();
    var wss = new WebSocketServer({ server: central, path: "/tunnel" });
    await new Promise(function (resolve) { central.listen(0, "127.0.0.1", resolve); });

    var tunnel = clientFactory.create({
        centralUrl: "ws://127.0.0.1:" + central.address().port + "/tunnel",
        portalId: "portal-test",
        portalName: "Portal Test",
        portalToken: "12345678901234567890123456789012",
        localPort: local.address().port,
        portalVersion: "test",
        updaterRoot: updaterRoot
    });
    try {
        assert.strictEqual(tunnel.configured(), true);
        var updater = tunnel.updaterSummary();
        assert.strictEqual(updater.installed, true);
        assert.strictEqual(updater.running, true);
        assert.strictEqual(updater.channel, "dev");
        assert.strictEqual(updater.targetVersion, "2.0.0-dev.30");
        assert.strictEqual(updater.phase, "Completed");

        var connected = new Promise(function (resolve) {
            wss.once("connection", function (socket, request) {
                assert.strictEqual(
                    request.headers.authorization,
                    "SIRK-Portal " +
                        Buffer.from("portal-test:12345678901234567890123456789012").toString("base64url")
                );
                resolve(socket);
            });
        });
        tunnel.connect();
        var socket = await connected;
        var heartbeat = tunnel.heartbeatBody();
        assert.strictEqual(heartbeat.health, "ok");
        assert.strictEqual(heartbeat.updateChannel, "dev");
        assert.strictEqual(heartbeat.availableVersion, "2.0.0-dev.30");
        assert.ok(heartbeat.capabilities.includes("shared-updater"));
        assert.ok(heartbeat.capabilities.includes("shared-updater-running"));
        assert.ok(heartbeat.capabilities.includes("shared-updater-phase:completed"));

        var response = new Promise(function (resolve) {
            socket.once("message", function (raw) { resolve(JSON.parse(String(raw))); });
        });
        socket.send(JSON.stringify({
            type: "request",
            requestId: "request-one",
            method: "GET",
            path: "/health",
            headers: {}
        }));
        var message = await response;
        assert.strictEqual(message.statusCode, 200);
        assert.deepStrictEqual(JSON.parse(Buffer.from(message.bodyBase64, "base64").toString()), {
            ok: true,
            path: "/health"
        });
        console.log("central-tunnel-client test passed");
    } finally {
        tunnel.stop();
        await new Promise(function (resolve) { wss.close(resolve); });
        await new Promise(function (resolve) { central.close(resolve); });
        await new Promise(function (resolve) { local.close(resolve); });
        fs.rmSync(updaterRoot, { recursive: true, force: true });
    }
}

run().catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
