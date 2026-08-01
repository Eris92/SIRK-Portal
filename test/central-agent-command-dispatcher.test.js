"use strict";

var assert = require("assert");
var fs = require("fs");
var http = require("http");
var os = require("os");
var path = require("path");
var brokerFactory = require("../server/core/agent-command-broker.js");
var dispatcherFactory = require("../server/core/central-agent-command-dispatcher.js");

async function run() {
    var root = fs.mkdtempSync(path.join(os.tmpdir(), "sirk-central-agent-command-"));
    var token = "12345678901234567890123456789012";
    var command = {
        id: "cmd-central-test",
        type: "sync",
        state: "delivered",
        payload: {
            kind: "agent-command",
            tenantId: "tenant-one",
            deviceId: "device-one",
            operation: "terminal.execute",
            parameters: { command: "whoami" }
        }
    };
    var acknowledgements = [];
    var central = http.createServer(function (req, res) {
        assert.strictEqual(req.headers.authorization,
            "SIRK-Portal " + Buffer.from("portal-test:" + token).toString("base64url"));
        res.setHeader("Content-Type", "application/json");
        if (req.method === "GET" && req.url === "/api/portal/v1/commands?limit=20") {
            res.end(JSON.stringify({ ok: true, commands: [command] }));
            return;
        }
        var chunks = [];
        req.on("data", function (chunk) { chunks.push(chunk); });
        req.on("end", function () {
            acknowledgements.push({ path: req.url, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
            res.end(JSON.stringify({ ok: true }));
        });
    });
    await new Promise(function (resolve) { central.listen(0, "127.0.0.1", resolve); });

    var broker = brokerFactory.create({ dataRoot: root });
    var dispatcher = dispatcherFactory.create({
        centralOrigin: "http://127.0.0.1:" + central.address().port,
        portalId: "portal-test",
        portalToken: token,
        dataRoot: root,
        commandBroker: broker,
        pollIntervalMilliseconds: 1000
    });

    try {
        assert.strictEqual(dispatcher.configured(), true);
        assert.strictEqual(await dispatcher.pollOnce(), true);
        assert.strictEqual(acknowledgements.length, 1);
        assert.strictEqual(acknowledgements[0].body.state, "running");

        var pending = broker.claimPending("tenant-one", "device-one", 5);
        assert.strictEqual(pending.length, 1);
        assert.strictEqual(pending[0].type, "terminal.execute");
        assert.deepStrictEqual(pending[0].parameters, { command: "whoami" });

        broker.acceptResults("tenant-one", "device-one", [{
            commandId: pending[0].commandId,
            ok: true,
            code: "OK",
            output: "domain\\user"
        }]);
        await dispatcher.reportResults();
        assert.strictEqual(acknowledgements.length, 2);
        assert.strictEqual(acknowledgements[1].body.state, "completed");
        assert.strictEqual(acknowledgements[1].body.result.output, "domain\\user");

        await dispatcher.pollOnce();
        assert.strictEqual(broker.pending("tenant-one", "device-one", 5).length, 0,
            "redelivery must not duplicate the local Agent command");
        assert.strictEqual(fs.existsSync(dispatcher.statePath), true);
        console.log("central-agent-command-dispatcher test passed");
    } finally {
        dispatcher.stop();
        await new Promise(function (resolve) { central.close(resolve); });
        fs.rmSync(root, { recursive: true, force: true });
    }
}

run().catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
