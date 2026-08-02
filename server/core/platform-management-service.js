"use strict";

var fs = require("fs");
var http = require("http");
var https = require("https");
var path = require("path");
var enrollmentFactory = require("./central-enrollment-client.js");
var connectionFactory = require("./central-connection-config.js");

function jsonRequest(method, target, headers, body, options) {
    options = options || {};
    var url = new URL(target);
    if (url.protocol !== "https:" && !(options.allowLoopbackHttp &&
            (url.hostname === "127.0.0.1" || url.hostname === "localhost"))) {
        return Promise.reject(new Error("HTTPS is required."));
    }
    var raw = body == null ? "" : JSON.stringify(body);
    var transport = url.protocol === "https:" ? https : http;
    return new Promise(function (resolve, reject) {
        var request = transport.request(url, {
            method: method,
            timeout: Number(options.timeoutMilliseconds || 20000),
            rejectUnauthorized: options.rejectUnauthorized !== false,
            headers: Object.assign({
                "Accept": "application/json",
                "User-Agent": "SIRK-Portal-Platform/1"
            }, headers || {}, raw ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(raw)
            } : {})
        }, function (response) {
            var chunks = [], size = 0;
            response.on("data", function (chunk) {
                size += chunk.length;
                if (size > 2 * 1024 * 1024) {
                    request.destroy(new Error("Remote response is too large."));
                    return;
                }
                chunks.push(chunk);
            });
            response.on("end", function () {
                var parsed;
                try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
                catch (_) { return reject(new Error("Remote endpoint returned invalid JSON.")); }
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    var error = new Error(parsed.error || "Remote request failed with HTTP " + response.statusCode + ".");
                    error.statusCode = response.statusCode;
                    error.code = parsed.code || "REMOTE_REQUEST_REJECTED";
                    return reject(error);
                }
                resolve(parsed);
            });
        });
        request.on("timeout", function () { request.destroy(new Error("Remote request timed out.")); });
        request.on("error", reject);
        request.end(raw);
    });
}

function releaseCatalog(options) {
    if (typeof options.releaseCatalog === "function") return Promise.resolve().then(options.releaseCatalog);
    return jsonRequest("GET", "https://api.github.com/repos/Eris92/SIRK-Agent/releases?per_page=30", {}, null, options);
}

function publicAsset(asset, checksum) {
    return asset ? {
        name: String(asset.name || ""),
        size: Number(asset.size || 0),
        downloadUrl: String(asset.browser_download_url || ""),
        contentType: String(asset.content_type || "application/octet-stream"),
        checksumUrl: checksum ? String(checksum.browser_download_url || "") : ""
    } : null;
}

function completeAgentRelease(releases) {
    releases = Array.isArray(releases) ? releases : [];
    for (var index = 0; index < releases.length; index++) {
        var release = releases[index] || {};
        if (release.draft === true) continue;
        var assets = Array.isArray(release.assets) ? release.assets : [];
        var exe = assets.find(function (item) { return item.name === "SIRK-Agent-Setup.exe"; });
        var msi = assets.find(function (item) { return /^SIRK-Agent-.+-win-x64\.msi$/i.test(String(item.name || "")); });
        var zip = assets.find(function (item) { return /win-x64-framework-dependent.*\.zip$/i.test(String(item.name || "")); });
        var manifest = assets.find(function (item) { return item.name === "installer-manifest.json"; });
        if (!exe || !msi || !zip || !manifest) continue;
        var exeHash = assets.find(function (item) { return item.name === exe.name + ".sha256"; });
        var msiHash = assets.find(function (item) { return item.name === msi.name + ".sha256"; });
        var zipHash = assets.find(function (item) { return item.name === zip.name + ".sha256"; });
        if (!exeHash || !msiHash || !zipHash) continue;
        return {
            version: String(release.tag_name || release.name || ""),
            prerelease: release.prerelease === true,
            publishedAtUtc: release.published_at || null,
            installers: {
                exe: publicAsset(exe, exeHash),
                msi: publicAsset(msi, msiHash),
                zip: publicAsset(zip, zipHash),
                manifest: publicAsset(manifest, null)
            }
        };
    }
    throw Object.assign(new Error("No complete SIRK Agent .NET 10 EXE/MSI release is available."), {
        code: "AGENT_RELEASE_INCOMPLETE",
        statusCode: 503
    });
}

function quotePowerShell(value) {
    return "'" + String(value || "").replace(/'/g, "''") + "'";
}

function quoteMsi(value) {
    return '"' + String(value || "").replace(/"/g, '""') + '"';
}

function create(options) {
    options = options || {};
    var dataRoot = path.resolve(options.dataRoot);
    var groups = options.agentGroups;
    var connection = connectionFactory.create({ dataRoot: dataRoot });
    var enrollment = enrollmentFactory.create({
        dataRoot: dataRoot,
        rejectUnauthorized: options.rejectUnauthorized,
        timeoutMilliseconds: options.timeoutMilliseconds
    });
    var requestRemote = options.requestJson || jsonRequest;

    function status() {
        var enrollmentStatus = enrollment.status();
        return {
            connection: connection.status(),
            enrollment: enrollmentStatus.enrollment,
            agentGroups: groups && typeof groups.list === "function" ? groups.list() : []
        };
    }

    function requireConnection() {
        var value = connection.read();
        if (!value) throw Object.assign(new Error("Portal is not connected to SIRK Central."), {
            code: "CENTRAL_NOT_CONFIGURED",
            statusCode: 409
        });
        return value;
    }

    function centralHeaders(value) {
        return {
            "Authorization": "Bearer " + value.portalToken,
            "X-SIRK-Portal-ID": value.portalId
        };
    }

    function centralCall(method, route, body) {
        var current = requireConnection();
        return Promise.resolve(requestRemote(method, current.centralUrl + route, centralHeaders(current), body, options))
            .then(function (response) { return { current: current, response: response }; });
    }

    function removeLocalConnection() {
        [connection.filePath, enrollment.statePath, enrollment.privateKeyPath, enrollment.publicKeyPath]
            .forEach(function (file) {
                try { fs.rmSync(file, { force: true }); } catch (_) {}
            });
    }

    async function installers() {
        return completeAgentRelease(await releaseCatalog(options));
    }

    async function deployment(body) {
        if (!groups || typeof groups.issue !== "function") throw new Error("Agent group service is unavailable.");
        var groupId = String(body.groupId || "").trim();
        var origin = String(body.portalOrigin || process.env.SIRK_PUBLIC_URL || "").trim().replace(/\/+$/, "");
        if (!/^https:\/\/[^/]+(?::\d+)?$/i.test(origin)) throw new Error("Public Portal HTTPS origin is required.");
        var channel = body.channel === "dev" ? "dev" : "stable";
        var release = await installers();
        var issued = groups.issue(groupId);
        var exeName = release.installers.exe.name;
        var msiName = release.installers.msi.name;
        var exeCommand = "& .\\" + exeName + " --portal-url " + quotePowerShell(origin) +
            " --enrollment-token " + quotePowerShell(issued.token) + " --channel " + channel;
        var msiCommand = "msiexec.exe /i " + quoteMsi(msiName) + " /qn /norestart PORTAL_URL=" +
            quoteMsi(origin) + " ENROLLMENT_TOKEN=" + quoteMsi(issued.token) +
            " SIRK_CHANNEL=" + quoteMsi(channel);
        return {
            group: issued.group,
            enrollmentToken: issued.token,
            expiresAtUtc: issued.expiresAtUtc,
            portalOrigin: origin,
            channel: channel,
            release: release,
            silentInstall: {
                exe: exeCommand,
                msi: msiCommand
            }
        };
    }

    async function request(action, input) {
        input = input || {};
        var body = input.body && typeof input.body === "object" ? input.body : {};
        if (action === "status") return status();
        if (action === "central-begin") return { enrollment: await enrollment.begin(body) };
        if (action === "central-poll") {
            var polled = await enrollment.poll();
            return { result: polled, restartRequired: polled.status === "configured" };
        }
        if (action === "central-refresh") {
            var refreshed = await centralCall("GET", "/api/portal/v1/connection", null);
            return { local: connection.status(), central: refreshed.response.portal };
        }
        if (action === "central-update") {
            var updated = await centralCall("PATCH", "/api/portal/v1/connection", { name: body.portalName });
            var savedUpdate = connection.write(Object.assign({}, updated.current, {
                portalName: updated.response.portal.name
            }));
            return { connection: savedUpdate, central: updated.response.portal, restartRequired: true };
        }
        if (action === "central-rotate") {
            var rotated = await centralCall("POST", "/api/portal/v1/connection/rotate", {});
            if (!rotated.response.bootstrap || !rotated.response.bootstrap.portalToken)
                throw new Error("Central returned an incomplete rotated bootstrap.");
            var savedRotation = connection.write(Object.assign({}, rotated.response.bootstrap, {
                publicUrl: rotated.current.publicUrl
            }));
            return { connection: savedRotation, restartRequired: true };
        }
        if (action === "central-disconnect") {
            await centralCall("DELETE", "/api/portal/v1/connection", {});
            removeLocalConnection();
            return { disconnected: true, restartRequired: true };
        }
        if (action === "agent-installers") return await installers();
        if (action === "agent-deployment") return await deployment(body);
        if (action === "agent-bootstrap") {
            if (!groups) throw new Error("Agent group service is unavailable.");
            var mode = body.mode === "run" ? "run" : "silent";
            var bootstrapOrigin = String(body.portalOrigin || process.env.SIRK_PUBLIC_URL || "").replace(/\/+$/, "");
            if (!/^https:\/\/[^/]+(?::\d+)?$/i.test(bootstrapOrigin)) throw new Error("Public Portal HTTPS origin is required.");
            var script = groups.bootstrapScript(String(body.groupId || ""), mode, bootstrapOrigin);
            return {
                groupId: String(body.groupId || ""),
                mode: mode,
                fileName: "Install-SIRK-Agent-" + String(body.groupId || "") + ".ps1",
                scriptBase64: Buffer.from(script, "utf8").toString("base64")
            };
        }
        throw Object.assign(new Error("Platform action was not found."), { statusCode: 404 });
    }

    return {
        request: request,
        status: status,
        installers: installers,
        deployment: deployment,
        completeAgentRelease: completeAgentRelease
    };
}

module.exports = {
    create: create,
    jsonRequest: jsonRequest,
    completeAgentRelease: completeAgentRelease,
    publicAsset: publicAsset
};
