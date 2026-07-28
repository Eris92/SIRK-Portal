"use strict";

var agentCommandBrokerFactory = require("../core/agent-command-broker.js");

function sendJson(res, status, value) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(value));
}

function responseAdapter(res) {
    return {
        statusCode: 200,
        status: function (code) { this.statusCode = code; return this; },
        set: function (name, value) { res.setHeader(name, value); },
        setHeader: function (name, value) { res.setHeader(name, value); },
        send: function (body) { res.statusCode = this.statusCode; res.end(body); },
        end: function (body) { res.statusCode = this.statusCode; res.end(body); }
    };
}

module.exports.createHandler = function (runtime, host) {
    var agentCommands = host.agentCommands || null;
    return function (req, res) {
        var url = new URL(req.url, "http://sirk.local");
        function readBody() {
            if (req.method === "GET" || req.method === "HEAD") return Promise.resolve({});
            return new Promise(function (resolve, reject) {
                var chunks = [];
                req.on("data", function (chunk) { chunks.push(chunk); if (Buffer.concat(chunks).length > 1024 * 1024) reject(new Error("Request body is too large.")); });
                req.on("end", function () {
                    var raw = Buffer.concat(chunks).toString("utf8");
                    if (/application\/json/i.test(String(req.headers["content-type"] || ""))) {
                        try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(new Error("Invalid JSON payload.")); }
                        return;
                    }
                    var values = new URLSearchParams(raw);
                    var payload = values.get("payload");
                    if (!payload) return resolve({});
                    try { resolve(JSON.parse(payload)); } catch (error) { reject(new Error("Invalid JSON payload.")); }
                });
                req.on("error", reject);
            });
        }
        readBody().then(function (body) { return host.currentUser(req).then(function (user) { return { body: body, user: user }; }); }).then(function (state) {
            var user = state.user;
            if (req.method !== "GET" && req.method !== "HEAD" &&
                    (!user.csrfToken || String(req.headers["x-sirk-csrf"] || "") !== user.csrfToken)) {
                sendJson(res, 403, { ok: false, error: "Invalid CSRF token." });
                return;
            }
            if (req.method === "GET" && url.pathname === "/api/bootstrap") {
                var bootstrap = runtime.bootstrap(user);
                if (user.csrfToken) bootstrap.csrfToken = user.csrfToken;
                sendJson(res, 200, bootstrap);
                return;
            }
            if (req.method === "GET" && url.pathname === "/api/devices") {
                Promise.resolve(host.devices.list(user)).then(function (value) {
                    sendJson(res, 200, { ok: true, value: value });
                }).catch(function (error) {
                    sendJson(res, 503, { ok: false, error: String(error && error.message || error) });
                });
                return;
            }
            if (url.pathname === "/api/agent-operations") {
                if (!user.isAdmin) { sendJson(res, 403, { ok: false, error: "Permission denied." }); return; }
                if (!agentCommands) agentCommands = agentCommandBrokerFactory.create({ dataRoot: host.dataRoot });
                var tenantId = String(url.searchParams.get("tenantId") || state.body.tenantId || "");
                var deviceId = String(url.searchParams.get("deviceId") || state.body.deviceId || "");
                if (req.method === "POST") {
                    try {
                        var command = agentCommands.queue(tenantId, deviceId,
                            String(state.body.type || ""), state.body.parameters, user);
                        sendJson(res, 202, { ok: true, value: command });
                    } catch (error) {
                        sendJson(res, 400, { ok: false, error: String(error && error.message || error) });
                    }
                    return;
                }
                if (req.method === "GET") {
                    try {
                        var value = agentCommands.get(tenantId, deviceId, String(url.searchParams.get("commandId") || ""));
                        sendJson(res, value ? 200 : 404, value ? { ok: true, value: value } : { ok: false, error: "Operation not found." });
                    } catch (error) {
                        sendJson(res, 400, { ok: false, error: String(error && error.message || error) });
                    }
                    return;
                }
                sendJson(res, 405, { ok: false, error: "Method not allowed." });
                return;
            }
            if (url.pathname === "/api/admin/settings") {
                if (req.method === "GET") {
                    var snapshot = runtime.adminSnapshot(user.raw || user);
                    if (!snapshot) { sendJson(res, 403, { ok: false, error: "Permission denied." }); return; }
                    sendJson(res, 200, { ok: true, value: snapshot });
                    return;
                }
                if (req.method === "POST") {
                    if (typeof runtime.saveAdminSettings !== "function") { sendJson(res, 503, { ok: false, error: "Settings service unavailable." }); return; }
                    Promise.resolve(runtime.saveAdminSettings(user.raw || user, state.body)).then(function (value) {
                        sendJson(res, 200, { ok: true, value: value });
                    }).catch(function (error) { sendJson(res, /permission/i.test(String(error && error.message || error)) ? 403 : 400, { ok: false, error: String(error && error.message || error) }); });
                    return;
                }
                sendJson(res, 405, { ok: false, error: "Method not allowed." });
                return;
            }
            if (url.pathname === "/api/admin/identity") {
                if (!user.isAdmin || !host.identity) { sendJson(res, 403, { ok: false, error: "Permission denied." }); return; }
                if (req.method === "GET") {
                    sendJson(res, 200, { ok: true, value: host.identity.snapshot() });
                    return;
                }
                if (req.method !== "POST") {
                    sendJson(res, 405, { ok: false, error: "Method not allowed." });
                    return;
                }
                try {
                    var action = String(state.body.action || "");
                    var value = state.body.value || {};
                    if (action === "create-user") host.identity.createUser(value);
                    else if (action === "update-user") host.identity.updateUser(state.body.id, value, user.id);
                    else if (action === "delete-user") host.identity.deleteUser(state.body.id, user.id);
                    else if (action === "create-group") host.identity.createGroup(value);
                    else if (action === "update-group") host.identity.updateGroup(state.body.id, value);
                    else if (action === "delete-group") host.identity.deleteGroup(state.body.id);
                    else throw new Error("Unknown identity action.");
                    sendJson(res, 200, { ok: true, value: host.identity.snapshot() });
                } catch (error) {
                    sendJson(res, 400, { ok: false, error: String(error && error.message || error) });
                }
                return;
            }
            var match = url.pathname.match(/^\/api\/modules\/([^/]+)\/([^/]+)$/);
            if (!match) { sendJson(res, 404, { ok: false, error: "Endpoint not found." }); return; }
            Promise.resolve(runtime.request(req.method, decodeURIComponent(match[1]), decodeURIComponent(match[2]), {
                method: req.method,
                headers: req.headers,
                query: Object.fromEntries(url.searchParams.entries()),
                body: state.body
            }, responseAdapter(res), user.raw || user)).catch(function (error) {
                if (!res.writableEnded) sendJson(res, 500, { ok: false, error: String(error && error.message || error) });
            });
        }).catch(function (error) {
            sendJson(res, 401, { ok: false, error: String(error && error.message || error) });
        });
    };
};
