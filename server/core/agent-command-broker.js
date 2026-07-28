"use strict";

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

function safePart(value) {
    value = String(value || "");
    return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) ? value : "";
}

function writeJsonAtomic(file, value) {
    var temporary = file + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
    fs.renameSync(temporary, file);
}

module.exports.create = function (options) {
    var root = path.join(path.resolve(options.dataRoot), "agent-commands");
    fs.mkdirSync(root, { recursive: true });

    function directory(tenantId, deviceId) {
        tenantId = safePart(tenantId);
        deviceId = safePart(deviceId);
        if (!tenantId || !deviceId) throw new Error("Invalid SIRK Agent identity.");
        var value = path.join(root, tenantId, deviceId);
        fs.mkdirSync(value, { recursive: true });
        return value;
    }

    function commandFile(tenantId, deviceId, commandId) {
        commandId = safePart(commandId);
        if (!commandId) throw new Error("Invalid command id.");
        return path.join(directory(tenantId, deviceId), commandId + ".json");
    }

    function read(file) {
        try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return null; }
    }

    function queue(tenantId, deviceId, type, parameters, user) {
        if (["terminal.execute", "files.list", "files.read", "files.write", "desktop.snapshot"].indexOf(type) < 0)
            throw new Error("Unsupported SIRK Agent operation.");
        var now = new Date();
        var command = {
            schemaVersion: 1, commandId: crypto.randomUUID(), tenantId: safePart(tenantId),
            deviceId: safePart(deviceId), type: type,
            parameters: parameters && typeof parameters === "object" ? parameters : {},
            status: "queued", createdAtUtc: now.toISOString(),
            expiresAtUtc: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
            requestedBy: String(user && (user.id || user._id) || "unknown").slice(0, 255)
        };
        writeJsonAtomic(commandFile(tenantId, deviceId, command.commandId), command);
        return command;
    }

    function pending(tenantId, deviceId, limit) {
        var base = directory(tenantId, deviceId), now = Date.now();
        return fs.readdirSync(base).filter(function (name) { return name.endsWith(".json"); })
            .map(function (name) { return read(path.join(base, name)); })
            .filter(function (value) { return value && value.status === "queued" && Date.parse(value.expiresAtUtc) > now; })
            .sort(function (a, b) { return String(a.createdAtUtc).localeCompare(String(b.createdAtUtc)); })
            .slice(0, Math.max(1, Math.min(10, Number(limit) || 5)));
    }

    function acceptResults(tenantId, deviceId, results) {
        (Array.isArray(results) ? results : []).slice(0, 10).forEach(function (result) {
            var id = safePart(result && result.commandId);
            if (!id) return;
            var file = commandFile(tenantId, deviceId, id), command = read(file);
            if (!command || command.tenantId !== tenantId || command.deviceId !== deviceId ||
                (command.status !== "queued" && command.status !== "running")) return;
            command.status = result.ok === true ? "completed" : "failed";
            command.completedAtUtc = new Date().toISOString();
            command.result = {
                ok: result.ok === true, code: String(result.code || "").slice(0, 64),
                output: String(result.output || "").slice(0, 1024 * 1024),
                data: result.data && typeof result.data === "object" ? result.data : null
            };
            writeJsonAtomic(file, command);
        });
    }

    function get(tenantId, deviceId, commandId) {
        var command = read(commandFile(tenantId, deviceId, commandId));
        return command && command.tenantId === tenantId && command.deviceId === deviceId ? command : null;
    }

    return { queue: queue, pending: pending, acceptResults: acceptResults, get: get };
};
