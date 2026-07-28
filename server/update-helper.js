"use strict";

var childProcess = require("child_process");
var fs = require("fs");
var path = require("path");

function sleep(milliseconds) {
    if (typeof SharedArrayBuffer === "function" && typeof Atomics === "object" && typeof Atomics.wait === "function") {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
        return;
    }
    var end = Date.now() + milliseconds;
    while (Date.now() < end) {}
}

function processExists(pid) {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; }
    catch (error) { return error && error.code === "EPERM"; }
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function run(command, args, options) {
    var result = childProcess.spawnSync(command, args || [], Object.assign({ encoding: "utf8", windowsHide: true }, options || {}));
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(command + " failed with exit code " + result.status + ": " + String(result.stderr || result.stdout || "").trim());
    return result;
}

function sc(args) {
    var result = childProcess.spawnSync("sc.exe", args, { encoding: "utf8", windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error("sc.exe " + args.join(" ") + " failed with exit code " + result.status + ": " + String(result.stderr || result.stdout || "").trim());
    return result;
}

function waitForFile(file, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    while (!fs.existsSync(file)) {
        if (Date.now() >= deadline) throw new Error("Timed out waiting for the restart signal.");
        sleep(500);
    }
}

function waitForProcessExit(pid, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    while (processExists(pid)) {
        if (Date.now() >= deadline) throw new Error("The running SIRK Portal process did not stop in time.");
        sleep(500);
    }
}

function waitForServiceState(serviceName, desiredState, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        var result = childProcess.spawnSync("sc.exe", ["query", serviceName], { encoding: "utf8", windowsHide: true });
        var output = String(result.stdout || "") + String(result.stderr || "");
        if (desiredState === "STOPPED" && (/STATE\s*:\s*1\s+STOPPED/i.test(output) || /1060/.test(output))) return;
        if (desiredState === "RUNNING" && /STATE\s*:\s*4\s+RUNNING/i.test(output)) return;
        sleep(500);
    }
    throw new Error("Service " + serviceName + " did not reach state " + desiredState + ".");
}

function stopWindowsService(serviceName, parentPid) {
    sc(["config", serviceName, "start=", "disabled"]);
    var result = childProcess.spawnSync("sc.exe", ["stop", serviceName], { encoding: "utf8", windowsHide: true });
    var output = String(result.stdout || "") + String(result.stderr || "");
    if (result.status !== 0 && !/1062|SERVICE_NOT_ACTIVE/i.test(output)) throw new Error("Unable to stop service " + serviceName + ": " + output.trim());
    waitForProcessExit(parentPid, 120000);
    waitForServiceState(serviceName, "STOPPED", 120000);
}

function startWindowsService(serviceName) {
    sc(["config", serviceName, "start=", "auto"]);
    var result = childProcess.spawnSync("sc.exe", ["start", serviceName], { encoding: "utf8", windowsHide: true });
    var output = String(result.stdout || "") + String(result.stderr || "");
    if (result.status !== 0 && !/1056|INSTANCE_OF_SERVICE_ALREADY_RUNNING/i.test(output)) throw new Error("Unable to start service " + serviceName + ": " + output.trim());
    waitForServiceState(serviceName, "RUNNING", 120000);
}

function copyTree(source, destination) {
    fs.cpSync(source, destination, { recursive: true, force: true, errorOnExist: false });
}

function replaceApplication(target, staged, preserveNames) {
    preserveNames = new Set((preserveNames || []).map(function (name) { return String(name).toLowerCase(); }));
    fs.mkdirSync(target, { recursive: true });
    fs.readdirSync(target, { withFileTypes: true }).forEach(function (entry) {
        if (preserveNames.has(entry.name.toLowerCase())) return;
        fs.rmSync(path.join(target, entry.name), { recursive: true, force: true });
    });
    fs.readdirSync(staged, { withFileTypes: true }).forEach(function (entry) {
        if (preserveNames.has(entry.name.toLowerCase())) return;
        var source = path.join(staged, entry.name);
        var destination = path.join(target, entry.name);
        fs.rmSync(destination, { recursive: true, force: true });
        copyTree(source, destination);
    });
}

function installDependencies(target) {
    var packageFile = path.join(target, "package.json");
    if (!fs.existsSync(packageFile)) return;
    var packageJson = readJson(packageFile);
    if (!Object.keys(packageJson.dependencies || {}).length) return;
    var npm = process.platform === "win32" ? path.join(path.dirname(process.execPath), "npm.cmd") : "npm";
    var args = fs.existsSync(path.join(target, "package-lock.json")) ? ["ci", "--omit=dev"] : ["install", "--omit=dev"];
    run(npm, args, { cwd: target, stdio: "pipe" });
}

function updateState(stateFile, callback) {
    var state;
    try { state = readJson(stateFile); }
    catch (error) { state = { channel: "dev", history: [], jobs: {}, pending: null }; }
    callback(state);
    writeJson(stateFile, state);
}

function complete(stateFile, operation) {
    updateState(stateFile, function (state) {
        state.history = Array.isArray(state.history) ? state.history : [];
        state.history.unshift(operation);
        if (operation.channel) state.channel = operation.channel;
        state.pending = null;
    });
}

function fail(stateFile, manifest, error) {
    updateState(stateFile, function (state) {
        state.history = Array.isArray(state.history) ? state.history : [];
        state.history.unshift({ type: String(manifest.history && manifest.history.type || "update") + "-failed", at: new Date().toISOString(), version: manifest.history && (manifest.history.to || manifest.history.version) || "", error: String(error && error.message || error), channel: manifest.history && manifest.history.channel || state.channel || "dev" });
        state.pending = null;
    });
}

function main() {
    var manifestFile = process.argv[2];
    if (!manifestFile) throw new Error("Pending update manifest is required.");
    var manifest = readJson(manifestFile);
    var target = path.resolve(manifest.target);
    var staged = path.resolve(manifest.staged);
    var rollback = manifest.rollback ? path.resolve(manifest.rollback) : "";
    var serviceName = String(manifest.serviceName || "SirkPortalStandalone");
    var signalFile = path.resolve(manifest.signalFile || path.join(path.dirname(manifestFile), "restart.signal"));
    var preserve = manifest.preserve || ["Service", "node_modules"];
    var stoppedService = false;

    waitForFile(signalFile, 30 * 60 * 1000);

    try {
        if (process.platform === "win32") {
            stopWindowsService(serviceName, Number(manifest.parentPid) || 0);
            stoppedService = true;
        } else {
            waitForProcessExit(Number(manifest.parentPid) || 0, 120000);
        }
        replaceApplication(target, staged, preserve);
        installDependencies(target);
        complete(path.resolve(manifest.stateFile), manifest.history || { type: "update", at: new Date().toISOString() });
        try { fs.rmSync(path.dirname(manifestFile), { recursive: true, force: true }); } catch (ignored) {}
        if (process.platform === "win32") startWindowsService(serviceName);
    } catch (error) {
        try {
            if (rollback && fs.existsSync(rollback)) {
                replaceApplication(target, rollback, preserve);
                installDependencies(target);
            }
        } catch (rollbackError) {
            error = new Error(String(error.message || error) + " Rollback failed: " + String(rollbackError.message || rollbackError));
        }
        fail(path.resolve(manifest.stateFile), manifest, error);
        try { fs.writeFileSync(path.join(path.dirname(manifestFile), "failure.txt"), String(error && error.stack || error)); } catch (ignored2) {}
        if (process.platform === "win32" && stoppedService) {
            try { startWindowsService(serviceName); } catch (startError) {}
        }
        throw error;
    }
}

try { main(); }
catch (error) {
    try {
        var fallback = process.argv[2] ? path.join(path.dirname(process.argv[2]), "failure.txt") : path.join(process.cwd(), "sirk-update-failure.txt");
        fs.writeFileSync(fallback, String(error && error.stack || error));
    } catch (ignored) {}
    process.exitCode = 1;
}
