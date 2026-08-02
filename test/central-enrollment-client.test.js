"use strict";

var assert = require("assert");
var crypto = require("crypto");
var fs = require("fs");
var http = require("http");
var os = require("os");
var path = require("path");
var clientFactory = require("../server/core/central-enrollment-client.js");

function readBody(req) {
    return new Promise(function (resolve, reject) {
        var chunks = [];
        req.on("data", function (chunk) { chunks.push(chunk); });
        req.on("end", function () {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
            catch (error) { reject(error); }
        });
        req.on("error", reject);
    });
}

function encryptEnvelope(publicKeyPem, value) {
    var contentKey = crypto.randomBytes(32);
    var iv = crypto.randomBytes(12);
    var cipher = crypto.createCipheriv("aes-256-gcm", contentKey, iv);
    cipher.setAAD(Buffer.from("SIRK-Portal-Enrollment-v1", "utf8"));
    var ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value), "utf8")), cipher.final()]);
    var tag = cipher.getAuthTag();
    var encryptedKey = crypto.publicEncrypt({
        key: publicKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256"
    }, contentKey);
    contentKey.fill(0);
    return Buffer.from(JSON.stringify({
        schemaVersion: 1,
        algorithm: "RSA-OAEP-256+A256GCM",
        encryptedKey: encryptedKey.toString("base64"),
        iv: iv.toString("base64"),
        tag: tag.toString("base64"),
        ciphertext: ciphertext.toString("base64")
    }), "utf8").toString("base64");
}

async function run() {
    var dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sirk-central-enrollment-client-"));
    var publicKeyPem = "";
    var pollCount = 0;
    var server = http.createServer(async function (req, res) {
        try {
            res.setHeader("Content-Type", "application/json");
            if (req.method === "POST" && req.url === "/api/portal-enrollment/requests") {
                assert.strictEqual(req.headers.authorization, "Bearer enrollment-token-value-1234567890");
                var body = await readBody(req);
                assert.strictEqual(body.portalId, "portal-test");
                assert.strictEqual(body.portalName, "Portal Test");
                publicKeyPem = body.publicKeyPem;
                res.statusCode = 202;
                return res.end(JSON.stringify({
                    ok: true,
                    enrollment: {
                        requestId: "request_1234567890123456",
                        pollToken: "poll-token-value-12345678901234567890",
                        status: "pending",
                        expiresAtUtc: "2026-08-03T00:00:00.000Z"
                    }
                }));
            }
            if (req.method === "GET" && req.url === "/api/portal-enrollment/requests/request_1234567890123456") {
                assert.strictEqual(req.headers.authorization, "Bearer poll-token-value-12345678901234567890");
                pollCount += 1;
                if (pollCount === 1) {
                    return res.end(JSON.stringify({ ok: true, enrollment: { status: "pending" } }));
                }
                var bundle = {
                    schemaVersion: 1,
                    centralUrl: "https://central.sirkportal.com",
                    tunnelUrl: "wss://central.sirkportal.com/tunnel",
                    configUrl: "https://central.sirkportal.com/api/portal/v1/config",
                    heartbeatUrl: "https://central.sirkportal.com/api/portal/v1/heartbeat",
                    portalId: "portal-test",
                    portalName: "Portal Test",
                    portalToken: "12345678901234567890123456789012",
                    createdAtUtc: "2026-08-02T00:00:00.000Z"
                };
                return res.end(JSON.stringify({
                    ok: true,
                    enrollment: { status: "approved", encryptedBootstrap: encryptEnvelope(publicKeyPem, bundle) }
                }));
            }
            res.statusCode = 404;
            res.end(JSON.stringify({ ok: false, error: "Not found" }));
        } catch (error) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: error.message }));
        }
    });

    await new Promise(function (resolve) { server.listen(0, "127.0.0.1", resolve); });
    var centralUrl = "http://127.0.0.1:" + server.address().port;
    var client = clientFactory.create({ dataRoot: dataRoot, rejectUnauthorized: true });

    try {
        var started = await client.begin({
            centralUrl: centralUrl,
            enrollmentToken: "enrollment-token-value-1234567890",
            portalId: "portal-test",
            portalName: "Portal Test",
            publicUrl: "https://portal.test.local",
            version: "2.0.0-test"
        });
        assert.strictEqual(started.status, "pending");
        assert.ok(fs.existsSync(client.privateKeyPath));

        var pending = await client.poll();
        assert.strictEqual(pending.status, "pending");
        assert.strictEqual(pending.configured, false);

        var configured = await client.poll();
        assert.strictEqual(configured.status, "configured");
        assert.strictEqual(configured.portalId, "portal-test");
        assert.strictEqual(configured.centralUrl, "https://central.sirkportal.com");
        assert.strictEqual(configured.tunnelUrl, "wss://central.sirkportal.com/tunnel");
        assert.strictEqual(configured.publicUrl, "https://portal.test.local");
        assert.strictEqual(fs.existsSync(client.privateKeyPath), false);

        var connection = JSON.parse(fs.readFileSync(path.join(dataRoot, "central-connection.json"), "utf8"));
        assert.strictEqual(connection.portalToken, "12345678901234567890123456789012");
        assert.strictEqual(client.status().enrollment.status, "configured");
        console.log("central-enrollment-client: OK");
    } finally {
        await new Promise(function (resolve) { server.close(resolve); });
        fs.rmSync(dataRoot, { recursive: true, force: true });
    }
}

run().catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
