"use strict";

var agentCommandBrokerFactory = require("../core/agent-command-broker.js");
var serviceManagerFactory = require("../windows-service-manager.js");

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
    var serviceManager = serviceManagerFactory.create({
        dataRoot: host.dataRoot,
        serviceName: process.env.SIRK_SERVICE_NAME || "SirkPortalStandalone"
    });
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
            if (req.method === "GET" && url.pathname === "/api/agent-desktop/frame") {
                if (!user.isAdmin || !host.agentDesktopRelay) {
                    sendJson(res, 403, { ok: false, error: "Permission denied." }); return;
                }
                var frameTenant = String(url.searchParams.get("tenantId") || "");
                var frameDevice = String(url.searchParams.get("deviceId") || "");
                var after = Math.max(0, Number(url.searchParams.get("after")) || 0);
                var wait = Math.max(0, Math.min(25000, Number(url.searchParams.get("waitMilliseconds")) || 0));
                host.agentDesktopRelay.wait(frameTenant, frameDevice, after, wait).then(function (value) {
                    if (!value) { res.statusCode = 204; res.end(); return; }
                    res.statusCode = 200;
                    res.setHeader("Content-Type", String(value.metadata && value.metadata.contentType || "image/jpeg"));
                    res.setHeader("Cache-Control", "no-store");
                    res.setHeader("X-SIRK-Sequence", String(value.sequence));
                    res.setHeader("X-SIRK-Metadata", Buffer.from(JSON.stringify(value.metadata)).toString("base64"));
                    res.end(value.frame);
                });
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/agent-desktop/input") {
                if (!user.isAdmin || !host.agentDesktopRelay) {
                    sendJson(res, 403, { ok: false, error: "Permission denied." }); return;
                }
                var inputTenant = String(state.body.tenantId || "");
                var inputDevice = String(state.body.deviceId || "");
                var input = state.body.input && typeof state.body.input === "object" ? state.body.input : {};
                var allowed = ["move", "leftDown", "leftUp", "rightClick", "middleClick", "wheel",
                    "key", "text", "clipboardGet", "clipboardSet", "clipboardFileSet", "streamProfile",
                    "requestKeyframe", "streamStop"];
                if (allowed.indexOf(String(input.action || "")) < 0) {
                    sendJson(res, 400, { ok: false, error: "Unsupported desktop input." }); return;
                }
                var queued = host.agentDesktopRelay.input(inputTenant, inputDevice, input);
                sendJson(res, 202, { ok: true, value: queued });
                return;
            }
            if (url.pathname === "/api/admin/agent-groups") {
                if (!user.isAdmin || !host.agentGroups) {
                    sendJson(res, 403, { ok: false, error: "Permission denied." }); return;
                }
                try {
                    if (req.method === "GET" && url.searchParams.get("download")) {
                        var requestHost = String(req.headers.host || "");
                        if (!/^[a-zA-Z0-9.-]+(?::[0-9]{1,5})?$/.test(requestHost))
                            throw new Error("Invalid Portal host.");
                        var scheme = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
                        if (scheme !== "https" && scheme !== "http") scheme = "https";
                        var origin = String(process.env.SIRK_PUBLIC_URL || scheme + "://" + requestHost);
                        var groupId = String(url.searchParams.get("groupId") || "");
                        var mode = url.searchParams.get("download") === "run" ? "run" : "silent";
                        var script = host.agentGroups.bootstrapScript(groupId, mode, origin);
                        res.statusCode = 200;
                        res.setHeader("Content-Type", "text/plain; charset=utf-8");
                        res.setHeader("Content-Disposition", "attachment; filename=\"SIRK-Agent-" +
                            groupId.replace(/[^a-zA-Z0-9._-]/g, "") + "-" + mode + ".ps1\"");
                        res.end(script);
                        return;
                    }
                    if (req.method === "GET") {
                        sendJson(res, 200, { ok: true, value: host.agentGroups.list() }); return;
                    }
                    if (req.method === "POST") {
                        sendJson(res, 201, { ok: true, value: host.agentGroups.create(state.body) }); return;
                    }
                    if (req.method === "DELETE") {
                        host.agentGroups.remove(state.body.id);
                        sendJson(res, 200, { ok: true }); return;
                    }
                    sendJson(res, 405, { ok: false, error: "Method not allowed." }); return;
                } catch (error) {
                    sendJson(res, 400, { ok: false, error: String(error && error.message || error) }); return;
                }
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
                        var commandId = String(url.searchParams.get("commandId") || "");
                        var waitMilliseconds = Math.max(0, Math.min(25000,
                            Number(url.searchParams.get("waitMilliseconds")) || 0));
                        Promise.resolve(agentCommands.waitForResult(tenantId, deviceId, commandId, waitMilliseconds))
                            .then(function (value) {
                                sendJson(res, value ? 200 : 404, value
                                    ? { ok: true, value: value }
                                    : { ok: false, error: "Operation not found." });
                            }).catch(function (error) {
                                sendJson(res, 400, { ok: false, error: String(error && error.message || error) });
                            });
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
            if (url.pathname === "/api/admin/runtime") {
                if (!user.isAdmin) { sendJson(res, 403, { ok: false, error: "Permission denied." }); return; }
                var action = String(url.searchParams.get("action") || "");
                if (req.method === "GET" && action === "server-state") {
                    try {
                        sendJson(res, 200, {
                            ok: true,
                            services: serviceManager.services(),
                            generatedAt: new Date().toISOString()
                        });
                    } catch (error) {
                        sendJson(res, 503, { ok: false, error: String(error && error.message || error) });
                    }
                    return;
                }
                if (req.method === "POST" && action === "server-restart") {
                    try {
                        var scheduled = serviceManager.scheduleRestart(state.body.serviceName);
                        sendJson(res, 202, Object.assign({ ok: true }, scheduled));
                    } catch (error) {
                        sendJson(res, 400, { ok: false, error: String(error && error.message || error) });
                    }
                    return;
                }
                sendJson(res, req.method === "GET" || req.method === "POST" ? 404 : 405, {
                    ok: false,
                    error: req.method === "GET" || req.method === "POST" ? "Runtime action not found." : "Method not allowed."
                });
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
                    var identityAction = String(state.body.action || "");
                    var identityValue = state.body.value || {};
                    if (identityAction === "create-user") host.identity.createUser(identityValue);
                    else if (identityAction === "update-user") host.identity.updateUser(state.body.id, identityValue, user.id);
                    else if (identityAction === "delete-user") host.identity.deleteUser(state.body.id, user.id);
                    else if (identityAction === "create-group") host.identity.createGroup(identityValue);
                    else if (identityAction === "update-group") host.identity.updateGroup(state.body.id, identityValue);
                    else if (identityAction === "delete-group") host.identity.deleteGroup(state.body.id);
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
