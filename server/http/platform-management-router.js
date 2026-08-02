"use strict";

var crypto = require("crypto");
var fs = require("fs");
var https = require("https");
var path = require("path");
var enrollmentFactory = require("../core/central-enrollment-client.js");
var connectionFactory = require("../core/central-connection-config.js");

function json(res, status, value) {
    var body = Buffer.from(JSON.stringify(value));
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Length", String(body.length));
    res.setHeader("Cache-Control", "no-store");
    res.end(body);
}
function readJson(req, maximum) {
    return new Promise(function (resolve, reject) {
        var chunks = [], size = 0;
        req.on("data", function (chunk) {
            size += chunk.length;
            if (size > maximum) { reject(new Error("Request body is too large.")); req.destroy(); return; }
            chunks.push(chunk);
        });
        req.on("end", function () {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
            catch (_) { reject(new Error("Invalid JSON body.")); }
        });
        req.on("error", reject);
    });
}
function githubLatestAgent() {
    return new Promise(function (resolve, reject) {
        var req = https.get("https://api.github.com/repos/Eris92/SIRK-Agent/releases/latest", {
            headers: { "User-Agent": "SIRK-Portal-Agent-Download-Center", "Accept": "application/vnd.github+json" },
            timeout: 15000
        }, function (response) {
            var chunks = [], size = 0;
            response.on("data", function (chunk) { size += chunk.length; if (size <= 2 * 1024 * 1024) chunks.push(chunk); });
            response.on("end", function () {
                if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error("Agent release catalog HTTP " + response.statusCode + "."));
                try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
                catch (_) { reject(new Error("Agent release catalog returned invalid JSON.")); }
            });
        });
        req.on("timeout", function () { req.destroy(new Error("Agent release catalog timed out.")); });
        req.on("error", reject);
    });
}
function publicAsset(asset) {
    return asset ? { name: asset.name, size: asset.size, downloadUrl: asset.browser_download_url, contentType: asset.content_type } : null;
}
function create(options) {
    options = options || {};
    var dataRoot = path.resolve(options.dataRoot);
    var sessionUser = options.sessionUser;
    var sameOrigin = options.sameOrigin;
    var groups = options.agentGroups;
    var connection = connectionFactory.create({ dataRoot: dataRoot });
    var enrollment = enrollmentFactory.create({ dataRoot: dataRoot });
    var tokenFile = path.join(dataRoot, "agent-enrollment-token.txt");

    async function authorize(req, res, write) {
        try {
            var user = await sessionUser(req);
            if (!user || !user.isAdmin) { json(res, 403, { ok: false, error: "Administrator permission required." }); return null; }
            if (write && !sameOrigin(req)) { json(res, 403, { ok: false, error: "Invalid origin." }); return null; }
            if (write && String(req.headers["x-sirk-csrf"] || "") !== String(user.csrfToken || "")) {
                json(res, 403, { ok: false, error: "CSRF validation failed." }); return null;
            }
            return user;
        } catch (_) { json(res, 401, { ok: false, error: "Authentication required." }); return null; }
    }

    async function handle(req, res, url) {
        var route = url.pathname;
        if (route.indexOf("/api/platform/") !== 0) return false;
        var write = req.method !== "GET" && req.method !== "HEAD";
        if (!await authorize(req, res, write)) return true;
        try {
            if (route === "/api/platform/central-connection" && req.method === "GET") {
                return json(res, 200, { ok: true, connection: connection.status(), enrollment: enrollment.status().enrollment });
            }
            if (route === "/api/platform/central-connection" && req.method === "DELETE") {
                await readJson(req, 16384);
                [connection.filePath, enrollment.statePath, enrollment.privateKeyPath, enrollment.publicKeyPath].forEach(function (file) {
                    try { fs.rmSync(file, { force: true }); } catch (_) {}
                });
                return json(res, 200, { ok: true, disconnected: true, restartRequired: true });
            }
            if (route === "/api/platform/central-enrollment" && req.method === "POST") {
                var input = await readJson(req, 32768);
                var started = await enrollment.begin(input);
                return json(res, 202, { ok: true, enrollment: started });
            }
            if (route === "/api/platform/central-enrollment/poll" && req.method === "POST") {
                await readJson(req, 4096);
                var polled = await enrollment.poll();
                return json(res, 200, { ok: true, result: polled, restartRequired: polled.status === "configured" });
            }
            if (route === "/api/platform/agent-installers" && req.method === "GET") {
                var release = await githubLatestAgent();
                var assets = Array.isArray(release.assets) ? release.assets : [];
                var msi = assets.find(function (item) { return /SIRK-Agent.*\.msi$/i.test(item.name); });
                var exe = assets.find(function (item) { return /SIRK-Agent.*Setup.*\.exe$/i.test(item.name); });
                var zip = assets.find(function (item) { return /win-x64.*\.zip$/i.test(item.name); });
                return json(res, 200, { ok: true, version: release.tag_name || release.name, publishedAtUtc: release.published_at,
                    installers: { msi: publicAsset(msi), exe: publicAsset(exe), zip: publicAsset(zip) } });
            }
            if (route === "/api/platform/agent-installers/bootstrap" && req.method === "POST") {
                var body = await readJson(req, 16384);
                var groupId = String(body.groupId || "");
                var mode = body.mode === "run" ? "run" : "silent";
                var origin = String(body.portalOrigin || process.env.SIRK_PUBLIC_URL || "").replace(/\/+$/, "");
                if (!/^https:\/\/[^/]+$/i.test(origin)) throw new Error("Public Portal HTTPS origin is required.");
                var script = groups.bootstrapScript(groupId, mode, origin);
                return json(res, 201, { ok: true, groupId: groupId, mode: mode, scriptBase64: Buffer.from(script, "utf8").toString("base64"),
                    fileName: "Install-SIRK-Agent-" + groupId + ".ps1" });
            }
            if (route === "/api/platform/agent-enrollment-token/rotate" && req.method === "POST") {
                await readJson(req, 4096);
                var token = crypto.randomBytes(32).toString("base64url");
                fs.writeFileSync(tokenFile, token + "\n", { encoding: "utf8", mode: 0o600 });
                return json(res, 201, { ok: true, token: token, restartRequired: true });
            }
            return json(res, 404, { ok: false, error: "Platform management route not found." });
        } catch (error) {
            return json(res, error.statusCode || 400, { ok: false, code: error.code || "PLATFORM_MANAGEMENT_FAILED", error: error.message || "Platform management failed." });
        }
    }
    return { handle: handle };
}
module.exports = { create: create };
