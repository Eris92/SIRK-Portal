"use strict";

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

function canonical(value, topLevel) {
    if (Array.isArray(value)) return "[" + value.map(function (item) { return canonical(item, false); }).join(",") + "]";
    if (value && typeof value === "object") {
        return "{" + Object.keys(value).filter(function (key) { return !topLevel || key !== "signature"; })
            .sort().map(function (key) { return dotnetJsonString(key) + ":" + canonical(value[key], false); }).join(",") + "}";
    }
    return typeof value === "string" ? dotnetJsonString(value) : JSON.stringify(value);
}
function dotnetJsonString(value) {
    var escapes = { "+": "\\u002B", "<": "\\u003C", ">": "\\u003E", "&": "\\u0026", "'": "\\u0027" };
    return JSON.stringify(String(value)).replace(/[+<>&']/g, function (character) { return escapes[character]; });
}
function dotnetUtc(date) { return date.toISOString().replace(/Z$/, "+00:00"); }

module.exports.create = function (options) {
    var dataRoot = path.resolve(options.dataRoot);
    var privatePath = path.join(dataRoot, "agent-policy-signing-private.pem");
    var publicPath = path.join(dataRoot, "agent-policy-signing-public.pem");
    var policyRoot = path.join(dataRoot, "agent-policy-outbox");
    fs.mkdirSync(dataRoot, { recursive: true });
    if (!fs.existsSync(privatePath) || !fs.existsSync(publicPath)) {
        var pair = crypto.generateKeyPairSync("ec", {
            namedCurve: "prime256v1",
            privateKeyEncoding: { type: "pkcs8", format: "pem" },
            publicKeyEncoding: { type: "spki", format: "pem" }
        });
        fs.writeFileSync(privatePath, pair.privateKey, { encoding: "utf8", mode: 0o600 });
        fs.writeFileSync(publicPath, pair.publicKey, { encoding: "utf8", mode: 0o644 });
    }
    var privateKey = crypto.createPrivateKey(fs.readFileSync(privatePath, "utf8"));
    var publicKey = crypto.createPublicKey(fs.readFileSync(publicPath, "utf8"));
    if (privateKey.asymmetricKeyType !== "ec" || publicKey.asymmetricKeyType !== "ec")
        throw new Error("Invalid SIRK Agent policy signing key.");
    var publicPem = publicKey.export({ type: "spki", format: "pem" });
    var publicDer = publicKey.export({ type: "spki", format: "der" });
    var keyId = "portal-" + crypto.createHash("sha256").update(publicDer).digest("hex").slice(0, 24);

    function trustedKeys() { return [{ keyId: keyId, publicKeyPem: publicPem }]; }
    function issue(tenantId, deviceId, groupId) {
        var now = new Date(), policy = {
            tenantId: tenantId,
            deviceId: deviceId,
            policyId: crypto.randomUUID(),
            caseId: null,
            authorization: null,
            version: Date.now(),
            epoch: 1,
            notBeforeUtc: dotnetUtc(new Date(now.getTime() - 5 * 60 * 1000)),
            expiresAtUtc: dotnetUtc(new Date(now.getTime() + 366 * 24 * 60 * 60 * 1000)),
            nonce: crypto.randomBytes(24).toString("hex"),
            mode: "Normal",
            settings: {
                telemetryEnabled: true,
                integrityMonitoring: true,
                remoteTerminalEnabled: true,
                remoteFilesEnabled: true,
                remoteDesktopEnabled: true,
                hostGroupId: groupId || null
            },
            signature: { algorithm: "ES256", keyId: keyId, value: "pending" }
        };
        policy.signature.value = crypto.sign("sha256", Buffer.from(canonical(policy, true), "utf8"),
            { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
        var directory = path.join(policyRoot, tenantId, deviceId);
        fs.mkdirSync(directory, { recursive: true });
        var file = path.join(directory, policy.policyId + ".policy.json");
        fs.writeFileSync(file + ".tmp", JSON.stringify(policy, null, 2) + "\n", "utf8");
        fs.renameSync(file + ".tmp", file);
        return policy;
    }
    function enroll(tenantId, deviceId, groupId) {
        return { trustedPolicyKeys: trustedKeys(), policy: issue(tenantId, deviceId, groupId) };
    }
    return { trustedKeys: trustedKeys, issue: issue, enroll: enroll, canonical: canonical };
};
