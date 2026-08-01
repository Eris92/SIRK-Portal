"use strict";

var crypto = require("crypto");
var fs = require("fs");
var http = require("http");
var https = require("https");
var os = require("os");
var path = require("path");
var WebSocket = require("ws");

function base64Url(value) {
    return Buffer.from(value).toString("base64")
        .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function create(options) {
    options = options || {};
    var centralUrl = String(options.centralUrl || process.env.SIRK_CENTRAL_URL || "").trim();
    var centralApiUrl = String(options.centralApiUrl || process.env.SIRK_CENTRAL_API_URL || "").trim();
    var portalId = String(options.portalId || process.env.SIRK_CENTRAL_PORTAL_ID || "").trim();
    var portalName = String(options.portalName || process.env.SIRK_CENTRAL_PORTAL_NAME || portalId).trim();
    var portalToken = String(options.portalToken || process.env.SIRK_CENTRAL_TOKEN || "").trim();
    var localPort = Number(options.localPort);
    var portalVersion = String(options.portalVersion || "");
    var dataRoot = path.resolve(options.dataRoot || process.env.SIRK_DATA_ROOT ||
        path.join(path.dirname(path.resolve(__dirname, "../..")), "sirk-platform-data"));
    var heartbeatIntervalMilliseconds = Math.max(15000, Math.min(300000,
        Number(options.heartbeatIntervalMilliseconds || process.env.SIRK_CENTRAL_HEARTBEAT_INTERVAL_MS) || 60000));
    var socket = null;
    var reconnectTimer = null;
    var heartbeatTimer = null;
    var stopped = false;
    var retryMilliseconds = 1000;

    function centralOrigin() {
        var value = centralApiUrl || centralUrl;
        try {
            var parsed = new URL(value);
            if (parsed.protocol === "wss:") parsed.protocol = "https:";
            else if (parsed.protocol === "ws:") parsed.protocol = "http:";
            if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
            parsed.pathname = "/";
            parsed.search = "";
            parsed.hash = "";
            return parsed.toString().replace(/\/$/, "");
        } catch (error) { return ""; }
    }

    function configured() {
        var secureCentral = /^wss:\/\/[^/]+(?:\/.*)?$/i.test(centralUrl);
        var loopbackTestCentral = /^ws:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/.*)?$/i.test(centralUrl);
        return (secureCentral || loopbackTestCentral) &&
            /^[a-z0-9][a-z0-9-]{2,62}$/.test(portalId) &&
            portalToken.length >= 32 &&
            Number.isInteger(localPort) && localPort > 0 && localPort < 65536;
    }

    function agentSummary() {
        var registryPath = path.join(dataRoot, "agent-registry.json");
        try {
            var parsed = JSON.parse(fs.readFileSync(registryPath, "utf8"));
            var devices = parsed && parsed.devices && typeof parsed.devices === "object" ? parsed.devices : {};
            var now = Date.now();
            var values = Object.keys(devices).map(function (key) { return devices[key] || {}; });
            return {
                agentCount: values.length,
                onlineAgents: values.filter(function (device) {
                    var seen = Date.parse(device.lastSeenUtc || "");
                    return Number.isFinite(seen) && now - seen <= 180000;
                }).length
            };
        } catch (error) {
            return { agentCount: 0, onlineAgents: 0 };
        }
    }

    function heartbeatBody() {
        var agents = agentSummary();
        return {
            protocolVersion: 1,
            portalVersion: portalVersion,
            buildCommit: String(process.env.SIRK_BUILD_COMMIT || "").slice(0, 80),
            platform: process.platform + "/" + process.arch,
            hostname: os.hostname(),
            publicUrl: String(process.env.SIRK_PUBLIC_URL || ""),
            health: socket && socket.readyState === WebSocket.OPEN ? "ok" : "warning",
            agentCount: agents.agentCount,
            onlineAgents: agents.onlineAgents,
            capabilities: ["agent-enrollment", "agent-checkin", "agent-commands", "agent-policies", "desktop-relay"]
        };
    }

    function publishHeartbeat() {
        var origin = centralOrigin();
        if (!origin || stopped || !portalToken) return Promise.resolve(false);
        var target = new URL("/api/portal/v1/heartbeat", origin);
        var rawBody = JSON.stringify(heartbeatBody());
        var timestamp = Date.now();
        var nonce = base64Url(crypto.randomBytes(18));
        var signature = crypto.createHmac("sha256", portalToken)
            .update(String(timestamp) + "\n" + nonce + "\n" + rawBody, "utf8")
            .digest("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
        var transport = target.protocol === "https:" ? https : http;
        return new Promise(function (resolve) {
            var request = transport.request(target, {
                method: "POST",
                timeout: 10000,
                headers: {
                    "Authorization": "SIRK-Portal " + base64Url(portalId + ":" + portalToken),
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(rawBody),
                    "X-SIRK-Timestamp": String(timestamp),
                    "X-SIRK-Nonce": nonce,
                    "X-SIRK-Signature": signature
                }
            }, function (response) {
                response.resume();
                response.on("end", function () { resolve(response.statusCode >= 200 && response.statusCode < 300); });
            });
            request.on("timeout", function () { request.destroy(); });
            request.on("error", function () { resolve(false); });
            request.end(rawBody);
        });
    }

    function startHeartbeat() {
        if (heartbeatTimer || stopped) return;
        publishHeartbeat();
        heartbeatTimer = setInterval(publishHeartbeat, heartbeatIntervalMilliseconds);
        if (heartbeatTimer.unref) heartbeatTimer.unref();
    }

    function stopHeartbeat() {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }

    function scheduleReconnect() {
        if (stopped || reconnectTimer) return;
        reconnectTimer = setTimeout(function () {
            reconnectTimer = null;
            connect();
        }, retryMilliseconds);
        retryMilliseconds = Math.min(30000, retryMilliseconds * 2);
        if (reconnectTimer.unref) reconnectTimer.unref();
    }

    function portalInfo(requestId) {
        socket.send(JSON.stringify({
            type: "response",
            requestId: requestId,
            portal: {
                id: portalId,
                name: portalName,
                hostname: os.hostname(),
                platform: process.platform,
                architecture: process.arch,
                nodeVersion: process.version,
                portalVersion: portalVersion,
                connectedAtUtc: new Date().toISOString()
            }
        }));
    }

    function proxyRequest(message) {
        var method = String(message.method || "GET").toUpperCase();
        var allowedMethods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];
        if (allowedMethods.indexOf(method) < 0 || typeof message.path !== "string" ||
            message.path[0] !== "/" || message.path.indexOf("\r") >= 0 || message.path.indexOf("\n") >= 0) {
            socket.send(JSON.stringify({
                type: "response", requestId: message.requestId, statusCode: 400,
                contentType: "application/json", bodyBase64: Buffer.from('{"ok":false,"error":"Invalid tunneled request."}').toString("base64")
            }));
            return;
        }
        var headers = {};
        ["accept", "content-type", "cookie", "origin", "accept-language", "x-sirk-csrf"].forEach(function (name) {
            if (message.headers && typeof message.headers[name] === "string" && message.headers[name].length < 16384) {
                headers[name] = message.headers[name];
            }
        });
        headers.host = "127.0.0.1:" + localPort;
        headers["x-forwarded-proto"] = "https";
        headers["x-forwarded-host"] = message.headers && message.headers.host || "central-tunnel";
        var request = http.request({
            hostname: "127.0.0.1",
            port: localPort,
            method: method,
            path: message.path,
            headers: headers,
            timeout: 25000
        }, function (response) {
            var chunks = [];
            var size = 0;
            response.on("data", function (chunk) {
                size += chunk.length;
                if (size > 8 * 1024 * 1024) {
                    request.destroy(new Error("Local Portal response is too large."));
                    return;
                }
                chunks.push(chunk);
            });
            response.on("end", function () {
                if (!socket || socket.readyState !== WebSocket.OPEN) return;
                socket.send(JSON.stringify({
                    type: "response",
                    requestId: message.requestId,
                    statusCode: response.statusCode,
                    contentType: response.headers["content-type"] || "application/octet-stream",
                    setCookie: response.headers["set-cookie"] || [],
                    location: response.headers.location || "",
                    bodyBase64: Buffer.concat(chunks).toString("base64")
                }));
            });
        });
        request.on("timeout", function () { request.destroy(new Error("Local Portal request timed out.")); });
        request.on("error", function () {
            if (!socket || socket.readyState !== WebSocket.OPEN) return;
            socket.send(JSON.stringify({
                type: "response", requestId: message.requestId, statusCode: 502,
                contentType: "application/json",
                bodyBase64: Buffer.from('{"ok":false,"error":"Local Portal request failed."}').toString("base64")
            }));
        });
        var body = Buffer.from(String(message.bodyBase64 || ""), "base64");
        if (body.length) request.write(body);
        request.end();
    }

    function connect() {
        if (!configured() || stopped || socket) return;
        socket = new WebSocket(centralUrl, {
            headers: {
                "Authorization": "SIRK-Portal " + base64Url(portalId + ":" + portalToken)
            },
            handshakeTimeout: 10000,
            maxPayload: 8 * 1024 * 1024
        });
        socket.on("open", function () {
            retryMilliseconds = 1000;
            startHeartbeat();
        });
        socket.on("message", function (raw) {
            var message;
            try { message = JSON.parse(String(raw)); } catch (_) { return; }
            if (message.type !== "request" || typeof message.requestId !== "string") return;
            if (message.kind === "portal-info") portalInfo(message.requestId);
            else proxyRequest(message);
        });
        socket.on("error", function () {});
        socket.on("close", function () {
            socket = null;
            stopHeartbeat();
            scheduleReconnect();
        });
    }

    function stop() {
        stopped = true;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = null;
        stopHeartbeat();
        if (socket) socket.close(1000, "Portal stopping.");
        socket = null;
    }

    return {
        configured: configured,
        connect: connect,
        stop: stop,
        publishHeartbeat: publishHeartbeat,
        heartbeatBody: heartbeatBody,
        agentSummary: agentSummary,
        centralOrigin: centralOrigin
    };
}

module.exports = { create: create };
