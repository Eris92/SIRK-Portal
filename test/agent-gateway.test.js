"use strict";

var assert = require("assert");
var crypto = require("crypto");
var events = require("events");
var fs = require("fs");
var os = require("os");
var path = require("path");
var gatewayFactory = require("../server/core/agent-gateway.js");
var commandBrokerFactory = require("../server/core/agent-command-broker.js");

function request(token, body, url, privateKey) {
    var req = new events.EventEmitter();
    req.method = "POST";
    req.url = url || "/api/agent/v1/checkin";
    req.headers = token ? { authorization: "Bearer " + token } : {};
    var encoded = Buffer.from(JSON.stringify(body || {}), "utf8");
    if (privateKey) {
        var timestamp = String(Math.floor(Date.now() / 1000));
        var nonce = crypto.randomBytes(16).toString("hex");
        req.headers["x-sirk-timestamp"] = timestamp;
        req.headers["x-sirk-nonce"] = nonce;
        req.headers["x-sirk-signature"] = crypto.sign("sha256",
            Buffer.concat([Buffer.from(timestamp + "\n" + nonce + "\n"), encoded]),
            { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64");
    }
    req.destroy = function () {};
    var result = { headers: {} };
    var res = {
        statusCode: 200,
        setHeader: function (name, value) { result.headers[name] = value; },
        end: function (value) {
            result.body = JSON.parse(value);
            result.statusCode = this.statusCode;
            result.resolve(result);
        }
    };
    result.promise = new Promise(function (resolve) { result.resolve = resolve; });
    process.nextTick(function () {
        req.emit("data", encoded);
        req.emit("end");
    });
    return { req: req, res: res, result: result };
}

async function invoke(gateway, token, body, url, privateKey) {
    var value = request(token, body, url, privateKey);
    assert.strictEqual(gateway.handle(value.req, value.res), true);
    return value.result.promise;
}

(async function () {
    var root = fs.mkdtempSync(path.join(os.tmpdir(), "sirk-agent-gateway-"));
    try {
        var commandBroker = commandBrokerFactory.create({ dataRoot: root });
        var wakeStarted = Date.now();
        var pendingWake = commandBroker.waitForPending("investa", "wake-device", 5, 2000);
        setTimeout(function () {
            commandBroker.queue("investa", "wake-device", "desktop.snapshot", {}, { id: "latency-test" });
        }, 20);
        var wokenCommands = await pendingWake;
        assert.strictEqual(wokenCommands.length, 1);
        assert.ok(Date.now() - wakeStarted < 500, "Agent long-poll must wake without an interval delay.");
        var completedWait = commandBroker.waitForResult("investa", "wake-device",
            wokenCommands[0].commandId, 1000);
        commandBroker.acceptResults("investa", "wake-device", [{
            commandId: wokenCommands[0].commandId, ok: true, code: "OK", output: "", data: {}
        }]);
        assert.strictEqual((await completedWait).status, "completed",
            "Command completion must wake the waiting Portal request.");
        var assignedGroup = null;
        var issuedPolicy = null;
        var gateway = gatewayFactory.create({
            dataRoot: root,
            token: "test-agent-token",
            enrollmentToken: "test-enrollment-token",
            commandBroker: commandBroker,
            enrollmentResolver: function (value) { return value === "group-token" ? { groupId: "warsaw" } : null; },
            enrollmentAssigned: function (deviceId, groupId) { assignedGroup = deviceId + "/" + groupId; },
            policyService: { enroll: function (tenantId, deviceId, groupId) {
                issuedPolicy = tenantId + "/" + deviceId + "/" + (groupId || "");
                return { trustedPolicyKeys: [{ keyId: "portal-test", publicKeyPem: "public" }] };
            } }
        });
        var denied = await invoke(gateway, "wrong-token", { tenantId: "investa", deviceId: "device-1" });
        assert.strictEqual(denied.statusCode, 401);

        var invalid = await invoke(gateway, "test-agent-token", { tenantId: "../invalid", deviceId: "device-1" });
        assert.strictEqual(invalid.statusCode, 400);

        var accepted = await invoke(gateway, "test-agent-token", {
            tenantId: "investa",
            deviceId: "device-1",
            machineName: "DELL_K",
            agentVersion: "0.4.0-test",
            heartbeat: { stateStatus: "OK" },
            management: { status: "Healthy" },
            runtimeHealth: { heartbeatFresh: true },
            security: { status: "OK" },
            quarantine: { quarantined: false },
            endurance: { sampleCount: 42 },
            activity: { enabled: true },
            browserActivity: { tabs: 2 },
            risk: { level: "Low" },
            tamper: { detected: false },
            portalStatus: { ok: true },
            telemetryQueue: { files: 3, bytes: 1200 },
            events: [{ eventId: "event-1", category: "Agent" }]
        });
        assert.strictEqual(accepted.statusCode, 200);
        assert.strictEqual(accepted.body.acceptedEvents, 1);
        var registry = gateway.readRegistry();
        assert.strictEqual(registry.devices["investa/device-1"].machineName, "DELL_K");
        assert.strictEqual(registry.devices["investa/device-1"].endurance.sampleCount, 42);
        assert.strictEqual(registry.devices["investa/device-1"].telemetryQueue.files, 3);
        assert.strictEqual(fs.readFileSync(path.join(root, "agent-telemetry.jsonl"), "utf8").trim().split(/\r?\n/).length, 1);

        var deviceKeys = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
        var devicePublicKey = deviceKeys.publicKey.export({ format: "der", type: "spki" }).toString("base64");
        var enrolled = await invoke(gateway, "test-enrollment-token", {
            tenantId: "investa",
            deviceId: "device-2",
            machineName: "LAPTOP-2",
            publicKeySpki: devicePublicKey
        }, "/api/agent/v1/enroll");
        assert.strictEqual(enrolled.statusCode, 201);
        assert.strictEqual(typeof enrolled.body.deviceToken, "string");
        assert.strictEqual(enrolled.body.trustedPolicyKeys[0].keyId, "portal-test");
        assert.ok(enrolled.body.deviceToken.length >= 40);
        var registryText = fs.readFileSync(path.join(root, "agent-registry.json"), "utf8");
        assert.ok(!registryText.includes(enrolled.body.deviceToken), "Raw device token must not be persisted.");
        var duplicateEnrollment = await invoke(gateway, "test-enrollment-token", {
            tenantId: "investa",
            deviceId: "device-2",
            machineName: "LAPTOP-2",
            publicKeySpki: devicePublicKey
        }, "/api/agent/v1/enroll");
        assert.strictEqual(duplicateEnrollment.statusCode, 409);
        var groupEnrollment = await invoke(gateway, "group-token", {
            tenantId: "investa",
            deviceId: "device-group",
            machineName: "GROUP-PC",
            publicKeySpki: devicePublicKey
        }, "/api/agent/v1/enroll");
        assert.strictEqual(groupEnrollment.statusCode, 201);
        assert.strictEqual(gateway.readRegistry().devices["investa/device-group"].groupId, "warsaw");
        assert.strictEqual(assignedGroup, "device-group/warsaw");
        assert.strictEqual(issuedPolicy, "investa/device-group/warsaw");

        var missingProof = await invoke(gateway, enrolled.body.deviceToken, {
            tenantId: "investa",
            deviceId: "device-2",
            agentVersion: "1.0.0"
        });
        assert.strictEqual(missingProof.statusCode, 401);
        var deviceAccepted = await invoke(gateway, enrolled.body.deviceToken, {
            tenantId: "investa",
            deviceId: "device-2",
            machineName: "LAPTOP-2",
            agentVersion: "1.0.0"
        }, undefined, deviceKeys.privateKey);
        assert.strictEqual(deviceAccepted.statusCode, 200);
        var queuedCommand = commandBroker.queue("investa", "device-2", "terminal.execute",
            { command: "hostname" }, { id: "admin/test" });
        assert.strictEqual(commandBroker.queue("investa", "desktop-contract-device", "desktop.sessions", {},
            { id: "admin/test" }).type, "desktop.sessions");
        var commandDelivery = await invoke(gateway, enrolled.body.deviceToken, {
            tenantId: "investa",
            deviceId: "device-2",
            agentVersion: "1.0.0"
        }, undefined, deviceKeys.privateKey);
        assert.strictEqual(commandDelivery.body.commands.length, 1);
        assert.strictEqual(commandDelivery.body.commands[0].commandId, queuedCommand.commandId);
        var commandResult = await invoke(gateway, enrolled.body.deviceToken, {
            tenantId: "investa",
            deviceId: "device-2",
            agentVersion: "1.0.0",
            commandResults: [{
                commandId: queuedCommand.commandId,
                ok: true,
                code: "TERMINAL_OK",
                output: "LAPTOP-2"
            }]
        }, undefined, deviceKeys.privateKey);
        assert.strictEqual(commandResult.body.commands.length, 0);
        assert.strictEqual(commandBroker.get("investa", "device-2", queuedCommand.commandId).status, "completed");
        var replacementKeys = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
        var replacementPublicKey = replacementKeys.publicKey.export({ format: "der", type: "spki" }).toString("base64");
        var rotated = await invoke(gateway, enrolled.body.deviceToken, {
            tenantId: "investa",
            deviceId: "device-2",
            publicKeySpki: replacementPublicKey
        }, "/api/agent/v1/rotate-key", deviceKeys.privateKey);
        assert.strictEqual(rotated.statusCode, 200);
        var oldKeyDenied = await invoke(gateway, enrolled.body.deviceToken, {
            tenantId: "investa",
            deviceId: "device-2",
            agentVersion: "1.0.0"
        }, undefined, deviceKeys.privateKey);
        assert.strictEqual(oldKeyDenied.statusCode, 401);
        var replacementAccepted = await invoke(gateway, enrolled.body.deviceToken, {
            tenantId: "investa",
            deviceId: "device-2",
            agentVersion: "1.0.0",
            events: [{ eventId: "signed-event-1", category: "Evidence" }]
        }, undefined, replacementKeys.privateKey);
        assert.strictEqual(replacementAccepted.statusCode, 200);
        var batch = JSON.parse(fs.readFileSync(path.join(root, "agent-event-batches.jsonl"), "utf8").trim());
        assert.strictEqual(batch.eventCount, 1);
        assert.strictEqual(batch.previousBatchHash, null);
        assert.match(batch.batchHash, /^[a-f0-9]{64}$/);
        assert.ok(batch.deviceProof.signature);
        var signedTelemetry = fs.readFileSync(path.join(root, "agent-telemetry.jsonl"), "utf8")
            .trim().split(/\r?\n/).map(JSON.parse).find(function (item) {
                return item.event && item.event.eventId === "signed-event-1";
            });
        assert.strictEqual(signedTelemetry.batchHash, batch.batchHash);
        assert.strictEqual(gateway.readRegistry().devices["investa/device-2"].publicKeyHistory.length, 1);
        var policyDirectory = path.join(root, "agent-policy-outbox", "investa", "device-2");
        fs.mkdirSync(policyDirectory, { recursive: true });
        fs.writeFileSync(path.join(policyDirectory, "policy-1.policy.json"), JSON.stringify({
            tenantId: "investa",
            deviceId: "device-2",
            policyId: "policy-1",
            signature: { algorithm: "ES256", keyId: "test", value: "signed-value" }
        }));
        var policyDelivery = await invoke(gateway, enrolled.body.deviceToken, {
            tenantId: "investa",
            deviceId: "device-2",
            agentVersion: "1.0.0"
        }, undefined, replacementKeys.privateKey);
        assert.strictEqual(policyDelivery.body.policies.length, 1);
        var policyAck = await invoke(gateway, enrolled.body.deviceToken, {
            tenantId: "investa",
            deviceId: "device-2",
            agentVersion: "1.0.0",
            acknowledgedPolicyIds: ["policy-1"]
        }, undefined, replacementKeys.privateKey);
        assert.strictEqual(policyAck.body.policies.length, 0);
        assert.strictEqual(fs.existsSync(path.join(policyDirectory, "policy-1.policy.json")), false);
        var crossDeviceDenied = await invoke(gateway, enrolled.body.deviceToken, {
            tenantId: "investa",
            deviceId: "device-1"
        }, undefined, replacementKeys.privateKey);
        assert.strictEqual(crossDeviceDenied.statusCode, 401);
        console.log("Authenticated SIRK Agent gateway contract: OK");
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
})().catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
