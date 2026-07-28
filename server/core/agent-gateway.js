"use strict";

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var commandBrokerFactory = require("./agent-command-broker.js");

function sendJson(res, status, value) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(value));
}

function safeId(value) {
    value = String(value || "");
    return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) ? value : "";
}

function suppliedToken(req) {
    var header = String(req.headers.authorization || "");
    return header.indexOf("Bearer ") === 0 ? header.slice(7) : "";
}

function tokenHash(value) {
    return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function authorizedHash(req, expectedHex) {
    var supplied = suppliedToken(req);
    if (!supplied || !/^[a-f0-9]{64}$/i.test(String(expectedHex || ""))) return false;
    return crypto.timingSafeEqual(Buffer.from(tokenHash(supplied), "hex"), Buffer.from(expectedHex, "hex"));
}

function authorizedToken(req, token) {
    return token ? authorizedHash(req, tokenHash(token)) : false;
}

function validPublicKey(value) {
    try {
        var key = crypto.createPublicKey({
            key: Buffer.from(String(value || ""), "base64"), format: "der", type: "spki"
        });
        return key.asymmetricKeyType === "ec" &&
            (!key.asymmetricKeyDetails || key.asymmetricKeyDetails.namedCurve === "prime256v1") ? key : null;
    } catch (error) {
        return null;
    }
}

function validDeviceSignature(req, bodyBytes, device) {
    var timestamp = String(req.headers["x-sirk-timestamp"] || "");
    var nonce = String(req.headers["x-sirk-nonce"] || "");
    var signatureValue = String(req.headers["x-sirk-signature"] || "");
    var timestampNumber = Number(timestamp);
    if (!Number.isInteger(timestampNumber) || Math.abs(Date.now() / 1000 - timestampNumber) > 300 ||
        !/^[a-f0-9]{32}$/i.test(nonce) || (device.authNonces || []).indexOf(nonce) >= 0)
        return false;
    var key = validPublicKey(device.publicKeySpki);
    if (!key) return false;
    try {
        var signed = Buffer.concat([Buffer.from(timestamp + "\n" + nonce + "\n", "utf8"), bodyBytes]);
        return crypto.verify("sha256", signed, { key: key, dsaEncoding: "ieee-p1363" },
            Buffer.from(signatureValue, "base64"));
    } catch (error) {
        return false;
    }
}

function writeJsonAtomic(file, value) {
    var temporary = file + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
    fs.renameSync(temporary, file);
}

module.exports.create = function (options) {
    options = options || {};
    var dataRoot = path.resolve(options.dataRoot);
    var token = String(options.token || process.env.SIRK_AGENT_TOKEN || "");
    var enrollmentToken = String(options.enrollmentToken || process.env.SIRK_AGENT_ENROLLMENT_TOKEN || "");
    var registryPath = path.join(dataRoot, "agent-registry.json");
    var telemetryPath = path.join(dataRoot, "agent-telemetry.jsonl");
    var policyRoot = path.join(dataRoot, "agent-policy-outbox");
    var commandBroker = options.commandBroker || commandBrokerFactory.create({ dataRoot: dataRoot });
    fs.mkdirSync(dataRoot, { recursive: true });

    function readRegistry() {
        try {
            var parsed = JSON.parse(fs.readFileSync(registryPath, "utf8"));
            return parsed && parsed.devices && typeof parsed.devices === "object" ? parsed : { schemaVersion: 1, devices: {} };
        } catch (error) {
            return { schemaVersion: 1, devices: {} };
        }
    }

    function pendingPolicies(tenantId, deviceId, acknowledged) {
        var directory = path.join(policyRoot, tenantId, deviceId);
        var acknowledgedIds = new Set(Array.isArray(acknowledged)
            ? acknowledged.filter(function (value) { return typeof value === "string"; })
            : []);
        if (!fs.existsSync(directory)) return [];
        var values = [];
        fs.readdirSync(directory).filter(function (name) {
            return name.endsWith(".policy.json");
        }).sort().slice(0, 20).forEach(function (name) {
            var file = path.join(directory, name);
            try {
                if (fs.statSync(file).size > 256 * 1024) return;
                var policy = JSON.parse(fs.readFileSync(file, "utf8"));
                if (!policy || policy.tenantId !== tenantId || policy.deviceId !== deviceId ||
                    typeof policy.policyId !== "string") return;
                if (acknowledgedIds.has(policy.policyId)) {
                    fs.unlinkSync(file);
                    return;
                }
                values.push(policy);
            } catch (error) {
                // Malformed operator-supplied files remain in the outbox for inspection.
            }
        });
        return values;
    }

    function handler(req, res) {
        var url = new URL(req.url, "http://sirk.local");
        if (url.pathname !== "/api/agent/v1/checkin" && url.pathname !== "/api/agent/v1/enroll") return false;
        if (req.method !== "POST") {
            sendJson(res, 405, { ok: false, error: "Method not allowed." });
            return true;
        }
        var chunks = [], size = 0, ended = false;
        req.on("data", function (chunk) {
            if (ended) return;
            size += chunk.length;
            if (size > 1024 * 1024) {
                ended = true;
                sendJson(res, 413, { ok: false, error: "Agent check-in body is too large." });
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", function () {
            if (ended) return;
            try {
                var bodyBytes = Buffer.concat(chunks);
                var body = JSON.parse(bodyBytes.toString("utf8"));
                var tenantId = safeId(body.tenantId);
                var deviceId = safeId(body.deviceId);
                if (!tenantId || !deviceId) {
                    sendJson(res, 400, { ok: false, error: "Valid tenantId and deviceId are required." });
                    return;
                }
                var now = new Date().toISOString();
                var registry = readRegistry();
                var registryKey = tenantId + "/" + deviceId;
                var existing = registry.devices[registryKey] || {};
                if (url.pathname === "/api/agent/v1/enroll") {
                    if (!authorizedToken(req, enrollmentToken)) {
                        sendJson(res, 401, { ok: false, error: "Agent enrollment authentication failed." });
                        return;
                    }
                    if (existing.credentialHash) {
                        sendJson(res, 409, { ok: false, error: "Device is already enrolled." });
                        return;
                    }
                    if (!validPublicKey(body.publicKeySpki)) {
                        sendJson(res, 400, { ok: false, error: "A valid P-256 device public key is required." });
                        return;
                    }
                    var deviceToken = crypto.randomBytes(32).toString("base64url");
                    registry.devices[registryKey] = Object.assign({}, existing, {
                        tenantId: tenantId,
                        deviceId: deviceId,
                        machineName: String(body.machineName || deviceId).slice(0, 255),
                        enrolledAtUtc: now,
                        credentialHash: tokenHash(deviceToken),
                        publicKeySpki: String(body.publicKeySpki)
                    });
                    registry.updatedAtUtc = now;
                    writeJsonAtomic(registryPath, registry);
                    sendJson(res, 201, {
                        ok: true,
                        protocolVersion: 1,
                        tenantId: tenantId,
                        deviceId: deviceId,
                        deviceToken: deviceToken,
                        checkInEndpoint: "/api/agent/v1/checkin",
                        enrolledAtUtc: now
                    });
                    return;
                }
                if (!authorizedHash(req, existing.credentialHash) && !authorizedToken(req, token)) {
                    sendJson(res, 401, { ok: false, error: "Agent authentication failed." });
                    return;
                }
                if (existing.credentialHash && !validDeviceSignature(req, bodyBytes, existing)) {
                    sendJson(res, 401, { ok: false, error: "Agent device proof failed." });
                    return;
                }
                var authNonces = (existing.authNonces || [])
                    .concat(String(req.headers["x-sirk-nonce"] || "")).slice(-100);
                registry.devices[registryKey] = {
                    enrolledAtUtc: existing.enrolledAtUtc || null,
                    credentialHash: existing.credentialHash || null,
                    publicKeySpki: existing.publicKeySpki || null,
                    authNonces: existing.credentialHash ? authNonces : [],
                    tenantId: tenantId,
                    deviceId: deviceId,
                    machineName: String(body.machineName || deviceId).slice(0, 255),
                    agentVersion: String(body.agentVersion || "").slice(0, 64),
                    lastSeenUtc: now,
                    heartbeat: body.heartbeat && typeof body.heartbeat === "object" ? body.heartbeat : null,
                    management: body.management && typeof body.management === "object" ? body.management : null,
                    runtimeHealth: body.runtimeHealth && typeof body.runtimeHealth === "object" ? body.runtimeHealth : null
                };
                registry.updatedAtUtc = now;
                writeJsonAtomic(registryPath, registry);
                if (commandBroker) commandBroker.acceptResults(tenantId, deviceId, body.commandResults);
                (Array.isArray(body.events) ? body.events : []).slice(0, 100).forEach(function (event) {
                    fs.appendFileSync(telemetryPath, JSON.stringify({
                        receivedAtUtc: now,
                        tenantId: tenantId,
                        deviceId: deviceId,
                        event: event
                    }) + "\n", "utf8");
                });
                sendJson(res, 200, {
                    ok: true,
                    serverTimeUtc: now,
                    acceptedEvents: Math.min(100, Array.isArray(body.events) ? body.events.length : 0),
                    policies: pendingPolicies(tenantId, deviceId, body.acknowledgedPolicyIds),
                    commands: commandBroker ? commandBroker.pending(tenantId, deviceId, 5) : []
                });
            } catch (error) {
                sendJson(res, 400, { ok: false, error: "Invalid agent check-in payload." });
            }
        });
        return true;
    }

    return { handle: handler, readRegistry: readRegistry };
};
