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
    var pendingWaiters = new Map();
    var resultWaiters = new Map();
    var commandStores = new Map();
    var persistenceChains = new Map();
    fs.mkdirSync(root, { recursive: true });

    function identityKey(tenantId, deviceId) {
        return safePart(tenantId) + "/" + safePart(deviceId);
    }

    function notifyPending(tenantId, deviceId) {
        var key = identityKey(tenantId, deviceId);
        var waiters = pendingWaiters.get(key) || [];
        pendingWaiters.delete(key);
        waiters.forEach(function (waiter) {
            clearTimeout(waiter.timer);
            waiter.resolve();
        });
    }

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

    function commandStore(tenantId, deviceId) {
        var key = identityKey(tenantId, deviceId);
        if (commandStores.has(key)) return commandStores.get(key);
        var base = directory(tenantId, deviceId);
        var store = new Map();
        fs.readdirSync(base).filter(function (name) { return name.endsWith(".json"); }).forEach(function (name) {
            var value = read(path.join(base, name));
            if (value && safePart(value.commandId)) store.set(value.commandId, value);
        });
        commandStores.set(key, store);
        return store;
    }

    function persist(tenantId, deviceId, command) {
        var file = commandFile(tenantId, deviceId, command.commandId);
        var previous = persistenceChains.get(file) || Promise.resolve();
        var next = previous.then(async function () {
            var temporary = file + ".tmp-" + crypto.randomUUID();
            await fs.promises.writeFile(temporary, JSON.stringify(command, null, 2) + "\n", "utf8");
            await fs.promises.rename(temporary, file);
        }).catch(function () {
            // The in-memory live channel remains authoritative; a later state transition retries persistence.
        });
        persistenceChains.set(file, next);
        next.finally(function () {
            if (persistenceChains.get(file) === next) persistenceChains.delete(file);
        });
    }

    function queue(tenantId, deviceId, type, parameters, user) {
        if (["terminal.execute", "files.list", "files.read", "files.write", "desktop.sessions",
            "desktop.admin.start",
            "desktop.monitors", "desktop.snapshot", "desktop.input"].indexOf(type) < 0)
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
        command.waitingAgentConnections = (pendingWaiters.get(identityKey(tenantId, deviceId)) || []).length;
        commandStore(tenantId, deviceId).set(command.commandId, command);
        persist(tenantId, deviceId, command);
        notifyPending(tenantId, deviceId);
        return command;
    }

    function pending(tenantId, deviceId, limit) {
        var now = Date.now();
        return Array.from(commandStore(tenantId, deviceId).values())
            .filter(function (value) { return value && value.status === "queued" && Date.parse(value.expiresAtUtc) > now; })
            .sort(function (a, b) { return String(a.createdAtUtc).localeCompare(String(b.createdAtUtc)); })
            .slice(0, Math.max(1, Math.min(10, Number(limit) || 5)));
    }

    function claimPending(tenantId, deviceId, limit) {
        var claimedAt = new Date();
        return pending(tenantId, deviceId, limit).map(function (command) {
            command.status = "running";
            command.deliveredAtUtc = claimedAt.toISOString();
            command.deliveryLatencyMilliseconds = Math.max(0,
                claimedAt.getTime() - Date.parse(command.createdAtUtc));
            commandStore(tenantId, deviceId).set(command.commandId, command);
            persist(tenantId, deviceId, command);
            return command;
        });
    }

    function waitForPending(tenantId, deviceId, limit, waitMilliseconds) {
        var available = pending(tenantId, deviceId, limit);
        if (available.length || waitMilliseconds <= 0) return Promise.resolve(available);
        var key = identityKey(tenantId, deviceId);
        return new Promise(function (resolve) {
            var waiter = {
                resolve: function () { resolve(pending(tenantId, deviceId, limit)); },
                timer: null
            };
            waiter.timer = setTimeout(function () {
                var values = pendingWaiters.get(key) || [];
                pendingWaiters.set(key, values.filter(function (item) { return item !== waiter; }));
                waiter.resolve();
            }, Math.max(1, Math.min(25000, Number(waitMilliseconds) || 0)));
            var values = pendingWaiters.get(key) || [];
            values.push(waiter);
            pendingWaiters.set(key, values);
            // Close the race between the initial check and waiter registration.
            if (pending(tenantId, deviceId, limit).length) notifyPending(tenantId, deviceId);
        });
    }

    function acceptResults(tenantId, deviceId, results) {
        (Array.isArray(results) ? results : []).slice(0, 10).forEach(function (result) {
            var id = safePart(result && result.commandId);
            if (!id) return;
            var command = commandStore(tenantId, deviceId).get(id);
            if (!command || command.tenantId !== tenantId || command.deviceId !== deviceId ||
                (command.status !== "queued" && command.status !== "running")) return;
            command.status = result.ok === true ? "completed" : "failed";
            command.completedAtUtc = new Date().toISOString();
            command.result = {
                ok: result.ok === true, code: String(result.code || "").slice(0, 64),
                output: String(result.output || "").slice(0, 1024 * 1024),
                data: result.data && typeof result.data === "object" ? result.data : null
            };
            commandStore(tenantId, deviceId).set(command.commandId, command);
            persist(tenantId, deviceId, command);
            var waiterKey = identityKey(tenantId, deviceId) + "/" + command.commandId;
            var waiters = resultWaiters.get(waiterKey) || [];
            resultWaiters.delete(waiterKey);
            waiters.forEach(function (waiter) {
                clearTimeout(waiter.timer);
                waiter.resolve(command);
            });
        });
    }

    function get(tenantId, deviceId, commandId) {
        commandId = safePart(commandId);
        if (!commandId) throw new Error("Invalid command id.");
        var command = commandStore(tenantId, deviceId).get(commandId) || null;
        return command && command.tenantId === tenantId && command.deviceId === deviceId ? command : null;
    }

    function waitForResult(tenantId, deviceId, commandId, waitMilliseconds) {
        var current = get(tenantId, deviceId, commandId);
        if (!current || current.status === "completed" || current.status === "failed" || waitMilliseconds <= 0)
            return Promise.resolve(current);
        var key = identityKey(tenantId, deviceId) + "/" + safePart(commandId);
        return new Promise(function (resolve) {
            var waiter = { resolve: resolve, timer: null };
            waiter.timer = setTimeout(function () {
                var values = resultWaiters.get(key) || [];
                resultWaiters.set(key, values.filter(function (item) { return item !== waiter; }));
                resolve(get(tenantId, deviceId, commandId));
            }, Math.max(1, Math.min(25000, Number(waitMilliseconds) || 0)));
            var values = resultWaiters.get(key) || [];
            values.push(waiter);
            resultWaiters.set(key, values);
            current = get(tenantId, deviceId, commandId);
            if (current && (current.status === "completed" || current.status === "failed")) {
                clearTimeout(waiter.timer);
                resultWaiters.set(key, values.filter(function (item) { return item !== waiter; }));
                resolve(current);
            }
        });
    }

    return { queue: queue, pending: pending, claimPending: claimPending, waitForPending: waitForPending,
        acceptResults: acceptResults, get: get, waitForResult: waitForResult };
};
