"use strict";

var assert = require("assert");
var crypto = require("crypto");
var fs = require("fs");
var http = require("http");
var os = require("os");
var path = require("path");
var tunnelFactory = require("../server/core/central-tunnel-client.js");

function expectedSignature(token, timestamp, nonce, body) {
    return crypto.createHmac("sha256", token)
        .update(String(timestamp) + "\n" + nonce + "\n" + body, "utf8")
        .digest("base64url");
}

async function main() {
    var root = fs.mkdtempSync(path.join(os.tmpdir(), "sirk-central-control-"));
    var token = "T".repeat(48);
    var requests = [];
    var server = http.createServer(function (req, res) {
        var chunks = [];
        req.on("data", function (chunk) { chunks.push(chunk); });
        req.on("end", function () {
            var body = Buffer.concat(chunks).toString("utf8");
            requests.push({ headers: req.headers, body: body, url: req.url });
            res.statusCode = 202;
            res.end('{"ok":true}');
        });
    });
    await new Promise(function (resolve) { server.listen(0, "127.0.0.1", resolve); });
    try {
        var now = Date.now();
        fs.writeFileSync(path.join(root, "agent-registry.json"), JSON.stringify({
            devices: {
                "tenant/device-online": { lastSeenUtc: new Date(now - 30000).toISOString() },
                "tenant/device-offline": { lastSeenUtc: new Date(now - 600000).toISOString() }
            }
        }));
        var port = server.address().port;
        var client = tunnelFactory.create({
            centralUrl: "ws://127.0.0.1:" + port + "/api/portal/v1/tunnel",
            centralApiUrl: "http://127.0.0.1:" + port,
            portalId: "portal-test",
            portalName: "Portal Test",
            portalToken: token,
            portalVersion: "1.0.15-test",
            localPort: 9443,
            dataRoot: root
        });
        assert.deepStrictEqual(client.agentSummary(), { agentCount: 2, onlineAgents: 1 });
        assert.strictEqual(client.centralOrigin(), "http://127.0.0.1:" + port);
        assert.strictEqual(await client.publishHeartbeat(), true);
        assert.strictEqual(requests.length, 1);
        assert.strictEqual(requests[0].url, "/api/portal/v1/heartbeat");
        var heartbeat = JSON.parse(requests[0].body);
        assert.strictEqual(heartbeat.agentCount, 2);
        assert.strictEqual(heartbeat.onlineAgents, 1);
        assert.strictEqual(heartbeat.portalVersion, "1.0.15-test");
        assert.ok(heartbeat.capabilities.indexOf("agent-enrollment") >= 0);
        assert.ok(/^SIRK-Portal /.test(requests[0].headers.authorization));
        assert.strictEqual(
            requests[0].headers["x-sirk-signature"],
            expectedSignature(token, requests[0].headers["x-sirk-timestamp"],
                requests[0].headers["x-sirk-nonce"], requests[0].body)
        );
        console.log("Portal to Central Agent control-plane heartbeat: OK");
    } finally {
        await new Promise(function (resolve) { server.close(resolve); });
        fs.rmSync(root, { recursive: true, force: true });
    }
}

main().catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
