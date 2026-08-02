"use strict";

var crypto = require("crypto");
var fs = require("fs");
var https = require("https");
var path = require("path");
var enrollmentFactory = require("./central-enrollment-client.js");
var connectionFactory = require("./central-connection-config.js");

function latestAgentRelease() {
    return new Promise(function (resolve, reject) {
        var request = https.get("https://api.github.com/repos/Eris92/SIRK-Agent/releases/latest", {
            timeout: 15000,
            headers: { "User-Agent": "SIRK-Portal-Agent-Download-Center", "Accept": "application/vnd.github+json" }
        }, function (response) {
            var chunks = [], size = 0;
            response.on("data", function (chunk) {
                size += chunk.length;
                if (size > 2 * 1024 * 1024) { request.destroy(new Error("Agent release response is too large.")); return; }
                chunks.push(chunk);
            });
            response.on("end", function () {
                if (response.statusCode < 200 || response.statusCode >= 300)
                    return reject(new Error("Agent release catalog HTTP " + response.statusCode + "."));
                try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
                catch (_) { reject(new Error("Agent release catalog returned invalid JSON.")); }
            });
        });
        request.on("timeout", function () { request.destroy(new Error("Agent release catalog timed out.")); });
        request.on("error", reject);
    });
}
function publicAsset(asset) {
    return asset ? { name: asset.name, size: asset.size, downloadUrl: asset.browser_download_url, contentType: asset.content_type } : null;
}
function create(options) {
    options = options || {};
    var dataRoot = path.resolve(options.dataRoot);
    var groups = options.agentGroups;
    var connection = connectionFactory.create({ dataRoot: dataRoot });
    var enrollment = enrollmentFactory.create({ dataRoot: dataRoot });
    var tokenFile = path.join(dataRoot, "agent-enrollment-token.txt");

    function status() {
        var enrollmentStatus = enrollment.status();
        return { connection: connection.status(), enrollment: enrollmentStatus.enrollment };
    }
    function disconnect() {
        [connection.filePath, enrollment.statePath, enrollment.privateKeyPath, enrollment.publicKeyPath].forEach(function (file) {
            try { fs.rmSync(file, { force: true }); } catch (_) {}
        });
        return { disconnected: true, restartRequired: true };
    }
    async function installers() {
        var release = await latestAgentRelease();
        var assets = Array.isArray(release.assets) ? release.assets : [];
        return {
            version: release.tag_name || release.name,
            publishedAtUtc: release.published_at,
            installers: {
                msi: publicAsset(assets.find(function (item) { return /SIRK-Agent.*\.msi$/i.test(item.name); })),
                exe: publicAsset(assets.find(function (item) { return /SIRK-Agent-Setup\.exe$/i.test(item.name); })),
                zip: publicAsset(assets.find(function (item) { return /win-x64-framework-dependent.*\.zip$/i.test(item.name); }))
            }
        };
    }
    async function request(action, input) {
        input = input || {};
        var body = input.body && typeof input.body === "object" ? input.body : {};
        if (action === "status") return status();
        if (action === "central-begin") return { enrollment: await enrollment.begin(body) };
        if (action === "central-poll") {
            var value = await enrollment.poll();
            return { result: value, restartRequired: value.status === "configured" };
        }
        if (action === "central-disconnect") return disconnect();
        if (action === "agent-installers") return await installers();
        if (action === "agent-bootstrap") {
            if (!groups) throw new Error("Agent group service is unavailable.");
            var groupId = String(body.groupId || "");
            var mode = body.mode === "run" ? "run" : "silent";
            var origin = String(body.portalOrigin || process.env.SIRK_PUBLIC_URL || "").replace(/\/+$/, "");
            if (!/^https:\/\/[^/]+$/i.test(origin)) throw new Error("Public Portal HTTPS origin is required.");
            var script = groups.bootstrapScript(groupId, mode, origin);
            return { groupId: groupId, mode: mode, fileName: "Install-SIRK-Agent-" + groupId + ".ps1",
                scriptBase64: Buffer.from(script, "utf8").toString("base64") };
        }
        if (action === "agent-token-rotate") {
            var token = crypto.randomBytes(32).toString("base64url");
            fs.writeFileSync(tokenFile, token + "\n", { encoding: "utf8", mode: 0o600 });
            return { token: token, restartRequired: true };
        }
        throw Object.assign(new Error("Platform action was not found."), { statusCode: 404 });
    }
    return { request: request, status: status, disconnect: disconnect, installers: installers };
}
module.exports = { create: create };
