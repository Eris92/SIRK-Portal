"use strict";

var fs = require("fs");
var http = require("http");
var https = require("https");
var path = require("path");
var commandBrokerFactory = require("./agent-command-broker.js");

function base64Url(value) {
    return Buffer.from(value).toString("base64")
        .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function safePart(value) {
    value = String(value || "");
    return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) ? value : "";
}

function atomicWrite(file, value) {
    var temporary = file + ".tmp-" + process.pid;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, file);
}

function create(options) {
    options = options || {};
    var origin = String(options.centralOrigin || "").replace(/\/$/, "");
    var portalId = String(options.portalId || "");
    var portalToken = String(options.portalToken || "");
    var dataRoot = path.resolve(options.dataRoot);
    var broker = options.commandBroker || commandBrokerFactory.create({ dataRoot: dataRoot });
    var pollIntervalMilliseconds = Math.max(1000, Math.min(60000,
        Number(options.pollIntervalMilliseconds) || 3000));
    var statePath = path.join(dataRoot, "central-agent-command-map.json");
    var timer = null;
    var stopped = false;
    var running = false;
    var state = { schemaVersion: 1, commands: {} };

    try {
        var loaded = JSON.parse(fs.readFileSync(statePath, "utf8"));
        if (loaded && loaded.schemaVersion === 1 && loaded.commands && typeof loaded.commands === "object") state = loaded;
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }

    function configured() {
        try {
            var parsed = new URL(origin);
            var secure = parsed.protocol === "https:";
            var loopback = parsed.protocol === "http:" && /^(127\.0\.0\.1|localhost|\[::1\])$/.test(parsed.hostname);
            return (secure || loopback) && /^[a-z0-9][a-z0-9-]{2,62}$/.test(portalId) && portalToken.length >= 32;
        } catch (error) { return false; }
    }

    function request(method, requestPath, body) {
        if (!configured()) return Promise.reject(new Error("Central command dispatcher is not configured."));
        var target = new URL(requestPath, origin);
        var raw = body === undefined ? "" : JSON.stringify(body);
        var transport = target.protocol === "https:" ? https : http;
        return new Promise(function (resolve, reject) {
            var requestValue = transport.request(target, {
                method: method,
                timeout: 10000,
                headers: {
                    "Authorization": "SIRK-Portal " + base64Url(portalId + ":" + portalToken),
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(raw)
                }
            }, function (response) {
                var chunks = [], size = 0;
                response.on("data", function (chunk) {
                    size += chunk.length;
                    if (size > 1024 * 1024) {
                        requestValue.destroy(new Error("Central response is too large."));
                        return;
                    }
                    chunks.push(chunk);
                });
                response.on("end", function () {
                    var parsed = {};
                    try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
                    catch (error) { reject(new Error("Central returned invalid JSON.")); return; }
                    if (response.statusCode < 200 || response.statusCode >= 300) {
                        var failure = new Error(String(parsed.error || "Central request failed."));
                        failure.statusCode = response.statusCode;
                        reject(failure);
                        return;
                    }
                    resolve(parsed);
                });
            });
            requestValue.on("timeout", function () { requestValue.destroy(new Error("Central request timed out.")); });
            requestValue.on("error", reject);
            requestValue.end(raw);
        });
    }

    function persist() { atomicWrite(statePath, state); }

    function acknowledgement(commandId, value) {
        return request("POST", "/api/portal/v1/commands/" + encodeURIComponent(commandId) + "/ack", value);
    }

    function route(command) {
        if (!command || command.type !== "sync" || !command.payload || command.payload.kind !== "agent-command")
            return Promise.resolve(false);
        var tenantId = safePart(command.payload.tenantId);
        var deviceId = safePart(command.payload.deviceId);
        var operation = String(command.payload.operation || "");
        var allowed = ["terminal.execute", "files.list", "files.read", "files.write", "desktop.sessions",
            "desktop.admin.start", "desktop.monitors", "desktop.snapshot", "desktop.input"];
        if (!tenantId || !deviceId || allowed.indexOf(operation) < 0) {
            return acknowledgement(command.id, {
                state: "failed",
                progress: 100,
                message: "Invalid Agent command target or operation.",
                result: { code: "AGENT_COMMAND_INVALID" }
            }).then(function () { return true; });
        }
        var existing = state.commands[command.id];
        if (!existing) {
            var local = broker.queue(tenantId, deviceId, operation,
                command.payload.parameters && typeof command.payload.parameters === "object" ? command.payload.parameters : {},
                { id: "central:" + command.id });
            existing = state.commands[command.id] = {
                centralCommandId: command.id,
                tenantId: tenantId,
                deviceId: deviceId,
                localCommandId: local.commandId,
                state: "running",
                createdAtUtc: new Date().toISOString()
            };
            persist();
        }
        return acknowledgement(command.id, {
            state: "running",
            progress: 1,
            message: "Command queued for SIRK Agent."
        }).then(function () { return true; });
    }

    function reportResults() {
        var tasks = Object.keys(state.commands).map(function (centralId) {
            var mapping = state.commands[centralId];
            if (!mapping || mapping.state === "completed" || mapping.state === "failed") return Promise.resolve();
            var local = broker.get(mapping.tenantId, mapping.deviceId, mapping.localCommandId);
            if (!local || (local.status !== "completed" && local.status !== "failed")) return Promise.resolve();
            var terminalState = local.status === "completed" ? "completed" : "failed";
            return acknowledgement(centralId, {
                state: terminalState,
                progress: 100,
                message: terminalState === "completed" ? "Agent command completed." : "Agent command failed.",
                result: local.result || {}
            }).then(function () {
                mapping.state = terminalState;
                mapping.finishedAtUtc = new Date().toISOString();
                persist();
            });
        });
        return Promise.all(tasks);
    }

    async function pollOnce() {
        if (!configured() || running || stopped) return false;
        running = true;
        try {
            var response = await request("GET", "/api/portal/v1/commands?limit=20");
            var commands = Array.isArray(response.commands) ? response.commands : [];
            for (var index = 0; index < commands.length; index += 1) await route(commands[index]);
            await reportResults();
            return true;
        } finally { running = false; }
    }

    function start() {
        if (timer || stopped || !configured()) return;
        pollOnce().catch(function () {});
        timer = setInterval(function () { pollOnce().catch(function () {}); }, pollIntervalMilliseconds);
        if (timer.unref) timer.unref();
    }

    function stop() {
        stopped = true;
        if (timer) clearInterval(timer);
        timer = null;
    }

    return { configured: configured, start: start, stop: stop, pollOnce: pollOnce,
        route: route, reportResults: reportResults, statePath: statePath };
}

module.exports = { create: create };
