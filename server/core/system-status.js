"use strict";

var childProcess = require("child_process");
var fs = require("fs");
var os = require("os");
var path = require("path");

function readJson(filePath) {
    try { return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")); }
    catch (_) { return null; }
}

function iso(value) {
    if (!value) return null;
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function serviceState(name) {
    if (process.platform !== "win32") return { installed: false, running: false, state: "unsupported" };
    try {
        var result = childProcess.spawnSync("sc.exe", ["query", name], {
            encoding: "utf8", windowsHide: true, timeout: 5000
        });
        var output = String(result.stdout || "") + String(result.stderr || "");
        if (result.status !== 0) return { installed: false, running: false, state: "missing" };
        var match = output.match(/STATE\s*:\s*\d+\s+([A-Z_]+)/i);
        var state = match ? match[1].toLowerCase() : "unknown";
        return { installed: true, running: state === "running", state: state };
    } catch (error) {
        return { installed: false, running: false, state: "error", error: error.message };
    }
}

function newestOperation(root, applicationId) {
    var directory = path.join(root, "operations", applicationId);
    try {
        return fs.readdirSync(directory, { withFileTypes: true })
            .filter(function (entry) { return entry.isDirectory(); })
            .map(function (entry) {
                var file = path.join(directory, entry.name, "state.json");
                var value = readJson(file);
                if (!value) return null;
                return { value: value, modified: fs.statSync(file).mtimeMs };
            })
            .filter(Boolean)
            .sort(function (left, right) { return right.modified - left.modified; })[0] || null;
    } catch (_) { return null; }
}

function agentState(dataRoot) {
    var registry = readJson(path.join(dataRoot, "agent-registry.json"));
    var devices = registry && registry.devices && typeof registry.devices === "object" ? registry.devices : {};
    var values = Object.keys(devices).map(function (key) { return devices[key] || {}; });
    var now = Date.now();
    return {
        total: values.length,
        online: values.filter(function (device) {
            var seen = Date.parse(device.lastSeenUtc || "");
            return Number.isFinite(seen) && now - seen <= 180000;
        }).length,
        registryPresent: Boolean(registry)
    };
}

function create(options) {
    options = options || {};
    var dataRoot = path.resolve(options.dataRoot || process.env.SIRK_DATA_ROOT || "C:\\ProgramData\\SIRK\\Portal");
    var updaterRoot = path.resolve(options.updaterRoot || process.env.SIRK_UPDATER_DATA_ROOT || "C:\\ProgramData\\SIRK\\Updater");
    var version = String(options.version || "");

    function collect() {
        var portalService = serviceState(process.env.SIRK_SERVICE_NAME || "SirkPortal");
        var updaterService = serviceState("SirkUpdater");
        var updaterManifest = readJson(path.join(updaterRoot, "applications", "sirk-portal.json"));
        var operation = newestOperation(updaterRoot, "sirk-portal");
        var operationState = operation && operation.value || null;
        var central = readJson(path.join(dataRoot, "central-connection.json"));
        var agents = agentState(dataRoot);
        var pfxPath = process.env.SIRK_TLS_PFX || path.join(dataRoot, "TLS", "portal.pfx");
        var passwordPath = process.env.SIRK_TLS_PFX_PASSWORD_FILE || path.join(dataRoot, "TLS", "portal-pfx-password.txt");
        var tlsReady = fs.existsSync(pfxPath) && fs.existsSync(passwordPath);
        var updaterReady = Boolean(updaterManifest && updaterManifest.applicationId === "sirk-portal" && updaterService.running);
        var centralReady = Boolean(central && central.centralUrl && central.tunnelUrl && central.portalId && central.portalToken);
        var phase = String(operationState && operationState.phase || "").toLowerCase();
        var updateFailed = phase === "failed" || phase === "rollback-failed";
        var status = portalService.running && tlsReady && updaterReady && centralReady && !updateFailed ? "ok" :
            (portalService.running && tlsReady ? "warning" : "critical");

        return {
            ok: status !== "critical",
            status: status,
            generatedAtUtc: new Date().toISOString(),
            portal: {
                version: version,
                hostname: os.hostname(),
                platform: process.platform,
                architecture: process.arch,
                nodeVersion: process.version,
                service: portalService,
                uptimeSeconds: Math.floor(process.uptime()),
                memoryRssBytes: process.memoryUsage().rss
            },
            updater: {
                service: updaterService,
                registered: Boolean(updaterManifest && updaterManifest.applicationId === "sirk-portal"),
                channel: String(updaterManifest && updaterManifest.channel || ""),
                lastOperation: operationState ? {
                    phase: String(operationState.phase || ""),
                    targetVersion: String(operationState.targetVersion || ""),
                    updatedAtUtc: iso(operationState.updatedAtUtc),
                    rollback: /rollback/i.test(String(operationState.phase || ""))
                } : null
            },
            central: {
                configured: centralReady,
                portalId: centralReady ? String(central.portalId || "") : "",
                centralUrl: centralReady ? String(central.centralUrl || "") : "",
                tunnelUrl: centralReady ? String(central.tunnelUrl || "") : "",
                updatedAtUtc: centralReady ? iso(central.updatedAtUtc) : null
            },
            agents: agents,
            certificate: {
                configured: tlsReady,
                pfxPresent: fs.existsSync(pfxPath),
                passwordFilePresent: fs.existsSync(passwordPath)
            },
            checks: {
                portalServiceRunning: portalService.running,
                updaterReady: updaterReady,
                centralConfigured: centralReady,
                tlsReady: tlsReady,
                lastUpdateFailed: updateFailed
            }
        };
    }

    return { collect: collect };
}

module.exports = { create: create, serviceState: serviceState, agentState: agentState };
