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
    var enrollmentResolver = typeof options.enrollmentResolver === "function" ? options.enrollmentResolver : null;
    var enrollmentAssigned = typeof options.enrollmentAssigned === "function" ? options.enrollmentAssigned : null;
    var policyService = options.policyService && typeof options.policyService.enroll === "function" ?
        options.policyService : null;
    var registryPath = path.join(dataRoot, "agent-registry.json");
    var telemetryPath = path.join(dataRoot, "agent-telemetry.jsonl");
    var batchPath = path.join(dataRoot, "agent-event-batches.jsonl");
    var policyRoot = path.join(dataRoot, "agent-policy-outbox");
    var commandBroker = options.commandBroker || commandBrokerFactory.create({ dataRoot: dataRoot });
    var desktopRelay = options.desktopRelay || null;
    fs.mkdirSync(dataRoot, { recursive: true });
    if (!enrollmentToken && options.autoCreateEnrollmentToken === true) {
        var enrollmentTokenPath = path.join(dataRoot, "agent-enrollment-token.txt");
        try { enrollmentToken = fs.readFileSync(enrollmentTokenPath, "utf8").trim(); }
        catch (error) {
            enrollmentToken = crypto.randomBytes(32).toString("base64url");
            fs.writeFileSync(enrollmentTokenPath, enrollmentToken + "\n", { encoding: "utf8", mode: 0o600 });
        }
    }

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
        if (url.pathname !== "/api/agent/v1/checkin" && url.pathname !== "/api/agent/v1/desktop/frame" &&
            url.pathname !== "/api/agent/v1/desktop/control" &&
            url.pathname !== "/api/agent/v1/enroll" &&
            url.pathname !== "/api/agent/v1/rotate-key") return false;
        if (req.method !== "POST") {
            sendJson(res, 405, { ok: false, error: "Method not allowed." });
            return true;
        }
        var chunks = [], size = 0, ended = false;
        req.on("data", function (chunk) {
            if (ended) return;
            size += chunk.length;
            if (size > (url.pathname === "/api/agent/v1/desktop/frame" ? 4 * 1024 * 1024 : 1024 * 1024)) {
                ended = true;
                sendJson(res, 413, { ok: false, error: "Agent check-in body is too large." });
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", async function () {
            if (ended) return;
            try {
                var bodyBytes = Buffer.concat(chunks);
                if (url.pathname === "/api/agent/v1/desktop/control") {
                    var controlBody = JSON.parse(bodyBytes.toString("utf8"));
                    var controlTenantId = safeId(req.headers["x-sirk-tenant"] || controlBody.tenantId);
                    var controlDeviceId = safeId(req.headers["x-sirk-device"] || controlBody.deviceId);
                    var controlRegistry = readRegistry();
                    var controlDevice = controlRegistry.devices[controlTenantId + "/" + controlDeviceId];
                    if (!controlTenantId || !controlDeviceId || !controlDevice ||
                        !authorizedHash(req, controlDevice.credentialHash) ||
                        !validDeviceSignature(req, bodyBytes, controlDevice)) {
                        sendJson(res, 401, { ok: false, error: "Desktop control authentication failed." });
                        return;
                    }
                    if (!desktopRelay) {
                        sendJson(res, 503, { ok: false, error: "Desktop relay unavailable." });
                        return;
                    }
                    var control = await desktopRelay.control(controlTenantId, controlDeviceId,
                        Math.max(0, Math.min(25000, Number(controlBody.waitMilliseconds) || 0)));
                    sendJson(res, 200, { ok: true, viewerActive: control.viewerActive, inputs: control.inputs });
                    return;
                }
                if (url.pathname === "/api/agent/v1/desktop/frame") {
                    var frameTenantId = safeId(req.headers["x-sirk-tenant"]);
                    var frameDeviceId = safeId(req.headers["x-sirk-device"]);
                    var frameRegistry = readRegistry();
                    var frameDevice = frameRegistry.devices[frameTenantId + "/" + frameDeviceId];
                    if (!frameTenantId || !frameDeviceId || !frameDevice ||
                        !authorizedHash(req, frameDevice.credentialHash) ||
                        !validDeviceSignature(req, bodyBytes, frameDevice)) {
                        sendJson(res, 401, { ok: false, error: "Desktop frame authentication failed." });
                        return;
                    }
                    if (!desktopRelay || bodyBytes.length < 4) {
                        sendJson(res, 503, { ok: false, error: "Desktop relay unavailable." });
                        return;
                    }
                    var published = desktopRelay.publish(frameTenantId, frameDeviceId, bodyBytes, {
                        width: Number(req.headers["x-sirk-width"]) || 0,
                        height: Number(req.headers["x-sirk-height"]) || 0,
                        captureMilliseconds: Number(req.headers["x-sirk-capture-ms"]) || 0,
                        encodeMilliseconds: Number(req.headers["x-sirk-encode-ms"]) || 0,
                        captureBackend: String(req.headers["x-sirk-capture-backend"] || "").slice(0, 64),
                        fullFrame: String(req.headers["x-sirk-full-frame"] || "") === "1",
                        patches: (function () {
                            try {
                                var encoded = String(req.headers["x-sirk-patches"] || "");
                                if (encoded.length > 16384) return [];
                                var parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
                                return Array.isArray(parsed) ? parsed.slice(0, 64) : [];
                            } catch (error) { return []; }
                        }()),
                        moves: (function () {
                            try {
                                var encoded = String(req.headers["x-sirk-moves"] || "");
                                if (encoded.length > 16384) return [];
                                var parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
                                return Array.isArray(parsed) ? parsed.slice(0, 64) : [];
                            } catch (error) { return []; }
                        }()),
                        cursorX: Number(req.headers["x-sirk-cursor-x"]) || 0,
                        cursorY: Number(req.headers["x-sirk-cursor-y"]) || 0,
                        capturedAtUnixMilliseconds: Number(req.headers["x-sirk-captured-at"]) || 0,
                        encodedBytes: bodyBytes.length,
                        encoding: "JPEG"
                    });
                    sendJson(res, 202, {
                        ok: true, sequence: published.sequence, viewers: published.viewers,
                        inputs: published.inputs
                    });
                    return;
                }
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
                    var enrollment = enrollmentResolver ? enrollmentResolver(suppliedToken(req)) : null;
                    if (!authorizedToken(req, enrollmentToken) && !enrollment) {
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
                    var policyEnrollment = policyService ?
                        policyService.enroll(tenantId, deviceId, enrollment && enrollment.groupId || null) : null;
                    registry.devices[registryKey] = Object.assign({}, existing, {
                        tenantId: tenantId,
                        deviceId: deviceId,
                        machineName: String(body.machineName || deviceId).slice(0, 255),
                        groupId: enrollment && enrollment.groupId || existing.groupId || null,
                        enrolledAtUtc: now,
                        credentialHash: tokenHash(deviceToken),
                        publicKeySpki: String(body.publicKeySpki)
                    });
                    registry.updatedAtUtc = now;
                    writeJsonAtomic(registryPath, registry);
                    if (enrollmentAssigned && enrollment && enrollment.groupId)
                        enrollmentAssigned(deviceId, enrollment.groupId);
                    sendJson(res, 201, {
                        ok: true,
                        protocolVersion: 1,
                        tenantId: tenantId,
                        deviceId: deviceId,
                        deviceToken: deviceToken,
                        trustedPolicyKeys: policyEnrollment ? policyEnrollment.trustedPolicyKeys : [],
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
                if (url.pathname === "/api/agent/v1/rotate-key") {
                    if (!existing.credentialHash || !validPublicKey(body.publicKeySpki)) {
                        sendJson(res, 400, { ok: false, error: "A valid replacement P-256 public key is required." });
                        return;
                    }
                    registry.devices[registryKey] = Object.assign({}, existing, {
                        publicKeySpki: String(body.publicKeySpki),
                        publicKeyHistory: (existing.publicKeyHistory || []).concat({
                            publicKeySpki: existing.publicKeySpki,
                            validUntilUtc: now
                        }).filter(function (item) { return item.publicKeySpki; }).slice(-20),
                        authNonces: authNonces,
                        keyRotatedAtUtc: now
                    });
                    registry.updatedAtUtc = now;
                    writeJsonAtomic(registryPath, registry);
                    sendJson(res, 200, { ok: true, tenantId: tenantId, deviceId: deviceId,
                        keyRotatedAtUtc: now });
                    return;
                }
                var batchHash = null;
                var batchId = null;
                var events = (Array.isArray(body.events) ? body.events : []).slice(0, 100);
                if (existing.credentialHash && events.length) {
                    batchId = crypto.randomUUID();
                    var previousBatchHash = existing.lastBatchHash || null;
                    batchHash = crypto.createHash("sha256")
                        .update(String(previousBatchHash || "") + "\n")
                        .update(bodyBytes)
                        .update(String(req.headers["x-sirk-signature"] || ""))
                        .digest("hex");
                    fs.appendFileSync(batchPath, JSON.stringify({
                        batchId: batchId,
                        receivedAtUtc: now,
                        tenantId: tenantId,
                        deviceId: deviceId,
                        eventCount: events.length,
                        previousBatchHash: previousBatchHash,
                        batchHash: batchHash,
                        deviceProof: {
                            timestamp: String(req.headers["x-sirk-timestamp"] || ""),
                            nonce: String(req.headers["x-sirk-nonce"] || ""),
                            signature: String(req.headers["x-sirk-signature"] || "")
                        }
                    }) + "\n", "utf8");
                }
                registry.devices[registryKey] = {
                    enrolledAtUtc: existing.enrolledAtUtc || null,
                    credentialHash: existing.credentialHash || null,
                    publicKeySpki: existing.publicKeySpki || null,
                    publicKeyHistory: existing.publicKeyHistory || [],
                    authNonces: existing.credentialHash ? authNonces : [],
                    lastBatchHash: batchHash || existing.lastBatchHash || null,
                    tenantId: tenantId,
                    deviceId: deviceId,
                    machineName: String(body.machineName || deviceId).slice(0, 255),
                    agentVersion: String(body.agentVersion || "").slice(0, 64),
                    transportWaitMilliseconds: Math.max(0, Math.min(25000,
                        Number(body.waitMilliseconds) || 0)),
                    lastSeenUtc: now,
                    heartbeat: body.heartbeat && typeof body.heartbeat === "object" ? body.heartbeat : existing.heartbeat || null,
                    management: body.management && typeof body.management === "object" ? body.management : existing.management || null,
                    runtimeHealth: body.runtimeHealth && typeof body.runtimeHealth === "object" ? body.runtimeHealth : existing.runtimeHealth || null,
                    watchdog: body.watchdog && typeof body.watchdog === "object" ? body.watchdog : existing.watchdog || null,
                    network: body.network && typeof body.network === "object" ? body.network : existing.network || null,
                    remoteAddress: String(req.headers["x-forwarded-for"] ||
                        req.socket && req.socket.remoteAddress || "").split(",")[0].trim().slice(0, 128),
                    security: body.security && typeof body.security === "object" ? body.security : existing.security || null,
                    quarantine: body.quarantine && typeof body.quarantine === "object" ? body.quarantine : existing.quarantine || null,
                    endurance: body.endurance && typeof body.endurance === "object" ? body.endurance : existing.endurance || null,
                    activity: body.activity && typeof body.activity === "object" ? body.activity : existing.activity || null,
                    browserActivity: body.browserActivity && typeof body.browserActivity === "object" ? body.browserActivity : existing.browserActivity || null,
                    risk: body.risk && typeof body.risk === "object" ? body.risk : existing.risk || null,
                    tamper: body.tamper && typeof body.tamper === "object" ? body.tamper : existing.tamper || null,
                    portalStatus: body.portalStatus && typeof body.portalStatus === "object" ? body.portalStatus : existing.portalStatus || null,
                    telemetryQueue: body.telemetryQueue && typeof body.telemetryQueue === "object" ? body.telemetryQueue : existing.telemetryQueue || null
                };
                registry.updatedAtUtc = now;
                writeJsonAtomic(registryPath, registry);
                if (commandBroker) commandBroker.acceptResults(tenantId, deviceId, body.commandResults);
                events.forEach(function (event) {
                    fs.appendFileSync(telemetryPath, JSON.stringify({
                        receivedAtUtc: now,
                        tenantId: tenantId,
                        deviceId: deviceId,
                        batchId: batchId,
                        batchHash: batchHash,
                        event: event
                    }) + "\n", "utf8");
                });
                var waitMilliseconds = Math.max(0, Math.min(25000, Number(body.waitMilliseconds) || 0));
                if (commandBroker && typeof commandBroker.waitForPending === "function")
                    await commandBroker.waitForPending(tenantId, deviceId, 5, waitMilliseconds);
                var commands = commandBroker && typeof commandBroker.claimPending === "function"
                    ? commandBroker.claimPending(tenantId, deviceId, 5)
                    : commandBroker ? commandBroker.pending(tenantId, deviceId, 5) : [];
                sendJson(res, 200, {
                    ok: true,
                    serverTimeUtc: now,
                    acceptedEvents: Math.min(100, Array.isArray(body.events) ? body.events.length : 0),
                    policies: pendingPolicies(tenantId, deviceId, body.acknowledgedPolicyIds),
                    commands: commands
                });
            } catch (error) {
                sendJson(res, 400, { ok: false, error: "Invalid agent check-in payload." });
            }
        });
        return true;
    }

    return { handle: handler, readRegistry: readRegistry };
};
