"use strict";

var http = require("http");
var os = require("os");
var WebSocket = require("ws");

function create(options) {
    options = options || {};
    var centralUrl = String(options.centralUrl || process.env.SIRK_CENTRAL_URL || "").trim();
    var portalId = String(options.portalId || process.env.SIRK_CENTRAL_PORTAL_ID || "").trim();
    var portalName = String(options.portalName || process.env.SIRK_CENTRAL_PORTAL_NAME || portalId).trim();
    var portalToken = String(options.portalToken || process.env.SIRK_CENTRAL_TOKEN || "").trim();
    var localPort = Number(options.localPort);
    var socket = null;
    var reconnectTimer = null;
    var stopped = false;
    var retryMilliseconds = 1000;

    function configured() {
        var secureCentral = /^wss:\/\/[^/]+(?:\/.*)?$/i.test(centralUrl);
        var loopbackTestCentral = /^ws:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/.*)?$/i.test(centralUrl);
        return (secureCentral || loopbackTestCentral) &&
            /^[a-z0-9][a-z0-9-]{2,62}$/.test(portalId) &&
            portalToken.length >= 32 &&
            Number.isInteger(localPort) && localPort > 0 && localPort < 65536;
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
                portalVersion: String(options.portalVersion || ""),
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
                "Authorization": "SIRK-Portal " +
                    Buffer.from(portalId + ":" + portalToken).toString("base64url")
            },
            handshakeTimeout: 10000,
            maxPayload: 8 * 1024 * 1024
        });
        socket.on("open", function () { retryMilliseconds = 1000; });
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
            scheduleReconnect();
        });
    }

    function stop() {
        stopped = true;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = null;
        if (socket) socket.close(1000, "Portal stopping.");
        socket = null;
    }

    return { configured: configured, connect: connect, stop: stop };
}

module.exports = { create: create };
