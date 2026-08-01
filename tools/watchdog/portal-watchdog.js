"use strict";

var childProcess = require("child_process");
var fs = require("fs");
var http = require("http");
var https = require("https");
var path = require("path");

function create(options) {
    options = options || {};
    var portalRoot = path.resolve(options.portalRoot || process.env.SIRK_PORTAL_ROOT || "C:\\Program Files\\SIRK\\Portal");
    var dataRoot = path.resolve(options.dataRoot || process.env.SIRK_DATA_ROOT || "C:\\ProgramData\\SIRK\\Portal");
    var serviceName = String(options.serviceName || process.env.SIRK_SERVICE_NAME || "SirkPortal");
    var intervalMs = Math.max(5000, Number(options.intervalMs || process.env.SIRK_WATCHDOG_INTERVAL_MS || 15000));
    var threshold = Math.max(2, Number(options.threshold || process.env.SIRK_WATCHDOG_FAILURE_THRESHOLD || 3));
    var healthUrl = String(options.healthUrl || process.env.SIRK_PORTAL_HEALTH_URL || "https://127.0.0.1/login");
    var maintenanceFile = path.resolve(options.maintenanceFile || process.env.SIRK_MAINTENANCE_FILE || path.join(dataRoot, "maintenance.lock"));
    var stateRoot = path.join(dataRoot, "watchdog");
    var stateFile = path.join(stateRoot, "state.json");
    var logFile = path.join(stateRoot, "watchdog.log");
    var failures = 0;
    var recovering = false;
    var maintenanceLogged = false;
    var run = options.run || function (file, args) {
        return childProcess.spawnSync(file, args, { encoding: "utf8", windowsHide: true, timeout: 120000 });
    };

    function log(message) {
        fs.mkdirSync(stateRoot, { recursive: true });
        fs.appendFileSync(logFile, new Date().toISOString() + " " + message + "\r\n", "utf8");
    }
    function requiredFiles(root) {
        return [
            "config.json",
            "package.json",
            "server/standalone.js",
            "server/standalone-https.js",
            "server/core/runtime.js",
            "server/core/identity-store.js",
            "server/http/api-router.js",
            "public/portal/standalone/index.html",
            "public/portal/standalone/login.html",
            "public/portal/settings.js",
            "portal-independence.json"
        ].map(function (relative) { return path.join.apply(path, [root].concat(relative.split("/"))); });
    }
    function validateRoot(root) {
        var missing = requiredFiles(root).filter(function (file) { return !fs.existsSync(file); });
        if (missing.length) return { ok: false, error: "Missing files: " + missing.join(", ") };
        try {
            var config = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8").replace(/^\uFEFF/, ""));
            if (config.applicationId !== "sirk-portal") return { ok: false, error: "Invalid application identity." };
        } catch (error) { return { ok: false, error: error.message }; }
        return { ok: true };
    }
    function requestHealth() {
        if (typeof options.requestHealth === "function") return Promise.resolve(options.requestHealth());
        return new Promise(function (resolve) {
            var target;
            try { target = new URL(healthUrl); } catch (_) { return resolve(false); }
            var transport = target.protocol === "https:" ? https : http;
            var req = transport.get(target, { timeout: 5000, rejectUnauthorized: false }, function (res) {
                res.resume();
                res.on("end", function () { resolve(res.statusCode >= 200 && res.statusCode < 400); });
            });
            req.on("timeout", function () { req.destroy(); });
            req.on("error", function () { resolve(false); });
        });
    }
    function serviceRunning() {
        if (typeof options.serviceRunning === "function") return Boolean(options.serviceRunning());
        var result = run("sc.exe", ["query", serviceName]);
        return result.status === 0 && /STATE\s*:\s*4\s+RUNNING/i.test(String(result.stdout || ""));
    }
    function restartService() {
        run("sc.exe", ["config", serviceName, "start=", "auto"]);
        run("sc.exe", ["stop", serviceName]);
        run("sc.exe", ["start", serviceName]);
    }
    function latestRollback() {
        var backupRoot = path.join(dataRoot, "updates", "backups");
        if (!fs.existsSync(backupRoot)) return "";
        return fs.readdirSync(backupRoot, { withFileTypes: true })
            .filter(function (entry) { return entry.isDirectory() && fs.existsSync(path.join(backupRoot, entry.name, "app")); })
            .map(function (entry) { return path.join(backupRoot, entry.name, "app"); })
            .filter(function (root) { return validateRoot(root).ok; })
            .sort(function (a, b) { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; })[0] || "";
    }
    function copyTree(source, target) {
        if (typeof options.copyTree === "function") return options.copyTree(source, target);
        var result = run("robocopy.exe", [source, target, "/MIR", "/R:2", "/W:2", "/XJ"]);
        if (result.status >= 8) throw new Error("robocopy failed with code " + result.status);
    }
    function recover(reason) {
        if (recovering || fs.existsSync(maintenanceFile)) return false;
        recovering = true;
        try {
            log("Recovery started: " + reason);
            var current = validateRoot(portalRoot);
            if (!current.ok) {
                var rollback = latestRollback();
                if (!rollback) throw new Error("No valid rollback tree is available. " + current.error);
                run("sc.exe", ["stop", serviceName]);
                copyTree(rollback, portalRoot);
                log("Rollback restored from " + rollback);
            }
            restartService();
            fs.writeFileSync(stateFile, JSON.stringify({ recoveredAtUtc: new Date().toISOString(), reason: reason }, null, 2));
            failures = 0;
            return true;
        } catch (error) {
            log("Recovery failed: " + String(error.stack || error));
            return false;
        } finally { recovering = false; }
    }
    async function check() {
        if (fs.existsSync(maintenanceFile)) {
            failures = 0;
            if (!maintenanceLogged) {
                log("Maintenance mode active; health checks and recovery are suspended.");
                maintenanceLogged = true;
            }
            return { healthy: true, maintenance: true, failures: 0 };
        }
        if (maintenanceLogged) {
            log("Maintenance mode ended; health monitoring resumed.");
            maintenanceLogged = false;
        }
        var files = validateRoot(portalRoot);
        var running = serviceRunning();
        var healthy = files.ok && running && await requestHealth();
        if (healthy) { failures = 0; return { healthy: true, failures: 0 }; }
        failures += 1;
        log("Health failure " + failures + "/" + threshold + ": files=" + files.ok + " service=" + running);
        var recovered = failures >= threshold ? recover(files.ok ? "health-check-failed" : files.error) : false;
        return { healthy: false, failures: failures, recovered: recovered, files: files, serviceRunning: running };
    }
    function start() {
        log("SirkPortalWatchdog started.");
        check();
        return setInterval(check, intervalMs);
    }
    return { start: start, check: check, recover: recover, validateRoot: validateRoot, latestRollback: latestRollback, requiredFiles: requiredFiles };
}

if (require.main === module) create().start();
module.exports = { create: create };
