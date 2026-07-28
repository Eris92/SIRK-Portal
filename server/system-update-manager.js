"use strict";

var childProcess = require("child_process");
var crypto = require("crypto");
var fs = require("fs");
var https = require("https");
var path = require("path");
var util = require("util");

var execFile = util.promisify(childProcess.execFile);
var CHANNELS = Object.freeze({ stable: "main", beta: "beta", dev: "develop" });
var STALE_PENDING_MS = 35 * 60 * 1000;

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function safeName(value) {
    return String(value || "").replace(/[^a-z0-9._-]/gi, "_");
}

function processExists(pid) {
    if (!pid) return false;
    try { process.kill(Number(pid), 0); return true; }
    catch (error) { return error && error.code === "EPERM"; }
}

function request(url) {
    return new Promise(function (resolve, reject) {
        https.get(url, { headers: { "User-Agent": "SIRK-Portal-Updater", Accept: "application/json, application/zip, application/octet-stream", "Cache-Control": "no-cache, no-store, max-age=0", Pragma: "no-cache" } }, function (res) {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                request(new URL(res.headers.location, url).href).then(resolve, reject);
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error("Remote server returned HTTP " + res.statusCode + "."));
                res.resume();
                return;
            }
            var chunks = [];
            res.on("data", function (chunk) { chunks.push(chunk); });
            res.on("end", function () { resolve(Buffer.concat(chunks)); });
        }).on("error", reject);
    });
}

function create(options) {
    options = options || {};
    var appRoot = path.resolve(options.appRoot || path.join(__dirname, ".."));
    var dataRoot = path.resolve(options.dataRoot || path.join(path.dirname(appRoot), "sirk-platform-data"));
    var updateRoot = path.join(dataRoot, "updates");
    var backupRoot = path.join(updateRoot, "backups");
    var workRoot = path.join(updateRoot, "work");
    var stateFile = path.join(updateRoot, "state.json");
    var serviceName = String(options.serviceName || process.env.SIRK_SERVICE_NAME || "SirkPortalStandalone");
    var activeJobs = Object.create(null);

    function defaultState() {
        return { channel: "stable", history: [], pending: null, jobs: {} };
    }

    function loadState() {
        try { return Object.assign(defaultState(), readJson(stateFile)); }
        catch (error) { return defaultState(); }
    }

    function saveState(value) {
        fs.mkdirSync(updateRoot, { recursive: true });
        fs.writeFileSync(stateFile, JSON.stringify(value, null, 2));
    }

    function pendingPaths(pending) {
        var operationRoot = path.join(workRoot, String(pending && pending.token || ""), "operation");
        return { root: operationRoot, manifest: path.join(operationRoot, "pending.json"), failure: path.join(operationRoot, "failure.txt"), signal: path.join(operationRoot, "restart.signal") };
    }

    function addFailureHistory(state, pending, message) {
        state.history = Array.isArray(state.history) ? state.history : [];
        state.history.unshift({ type: String(pending && pending.type || "update") + "-failed", at: new Date().toISOString(), version: pending && pending.targetVersion || "", error: String(message || "Interrupted update operation."), channel: state.channel || "stable" });
    }

    function recoverInterruptedOperations() {
        var state = loadState();
        var changed = false;
        state.jobs = state.jobs || {};
        Object.keys(state.jobs).forEach(function (id) {
            var job = state.jobs[id];
            if (job && !activeJobs[id] && (job.status === "queued" || job.status === "running")) {
                state.jobs[id] = Object.assign({}, job, { status: "failed", progress: 100, message: "Operation interrupted by service restart.", error: "Operation interrupted by service restart.", updatedAt: new Date().toISOString() });
                changed = true;
            }
        });
        if (state.pending) {
            var files = pendingPaths(state.pending);
            var createdAt = Date.parse(state.pending.createdAt || "") || 0;
            var age = createdAt ? Date.now() - createdAt : STALE_PENDING_MS + 1;
            var helperAlive = processExists(state.pending.helperPid);
            var message = "";
            if (fs.existsSync(files.failure)) {
                try { message = fs.readFileSync(files.failure, "utf8"); }
                catch (error) { message = "Update helper reported a failure."; }
            } else if (!state.pending.token || !fs.existsSync(files.manifest)) {
                message = "Pending update manifest is missing after service restart.";
            } else if (!helperAlive && age > 60 * 1000) {
                message = "Update helper is no longer running.";
            } else if (age > STALE_PENDING_MS) {
                message = "Pending update operation expired.";
            }
            if (message) {
                addFailureHistory(state, state.pending, message);
                state.pending = null;
                changed = true;
            }
        }
        if (changed) saveState(state);
    }

    function branch(channel) {
        channel = String(channel || loadState().channel || "stable").toLowerCase();
        if (!CHANNELS[channel]) throw new Error("Unknown update channel.");
        return CHANNELS[channel];
    }

    function installedVersion() {
        var packageVersion = "";
        var configVersion = "";
        try { packageVersion = String(readJson(path.join(appRoot, "package.json")).version || ""); } catch (error) {}
        try { configVersion = String(readJson(path.join(appRoot, "config.json")).version || ""); } catch (error) {}
        return configVersion || packageVersion || "unknown";
    }

    function current() {
        recoverInterruptedOperations();
        var state = loadState();
        return { version: installedVersion(), channel: state.channel, branch: branch(state.channel), pending: state.pending || null, jobs: state.jobs || {} };
    }

    function health(target) {
        target = path.resolve(target || appRoot);
        var checks = [];
        function check(name, callback) {
            try { callback(); checks.push({ name: name, ok: true }); }
            catch (error) { checks.push({ name: name, ok: false, error: String(error.message || error) }); }
        }
        check("package", function () { if (!readJson(path.join(target, "package.json")).version) throw new Error("version missing"); });
        check("config", function () { if (readJson(path.join(target, "config.json")).applicationId !== "sirk-portal") throw new Error("identity mismatch"); });
        check("standalone", function () { if (!fs.existsSync(path.join(target, "server", "standalone.js"))) throw new Error("standalone server missing"); });
        check("update-helper", function () { if (!fs.existsSync(path.join(target, "server", "update-helper.js"))) throw new Error("update helper missing"); });
        return { ok: checks.every(function (item) { return item.ok; }), checks: checks };
    }

    function listBackups() {
        fs.mkdirSync(backupRoot, { recursive: true });
        return fs.readdirSync(backupRoot, { withFileTypes: true }).filter(function (entry) { return entry.isDirectory(); }).map(function (entry) {
            var manifest = {};
            try { manifest = readJson(path.join(backupRoot, entry.name, "manifest.json")); } catch (error) {}
            return Object.assign({ id: entry.name }, manifest);
        }).sort(function (left, right) { return String(right.createdAt || "").localeCompare(String(left.createdAt || "")); });
    }

    function validateBackupId(backupId) {
        backupId = String(backupId || "");
        if (!/^[a-z0-9._-]+$/i.test(backupId)) throw new Error("Invalid backup identifier.");
        return backupId;
    }

    async function deleteBackup(backupId) {
        backupId = validateBackupId(backupId);
        recoverInterruptedOperations();
        var state = loadState();
        var busy = Object.keys(state.jobs || {}).some(function (id) { return state.jobs[id] && (state.jobs[id].status === "queued" || state.jobs[id].status === "running"); });
        if (busy || state.pending) throw new Error("Backup cannot be deleted while another update operation is running.");
        var directory = path.join(backupRoot, backupId);
        if (!fs.existsSync(directory)) throw new Error("Backup was not found.");
        await fs.promises.rm(directory, { recursive: true, force: false });
        state.history = Array.isArray(state.history) ? state.history : [];
        state.history.unshift({ type: "backup-deleted", at: new Date().toISOString(), backupId: backupId });
        saveState(state);
        return { deleted: true, backupId: backupId };
    }

    function updateJob(jobId, patch) {
        var state = loadState();
        state.jobs = state.jobs || {};
        state.jobs[jobId] = Object.assign({}, state.jobs[jobId] || {}, patch, { updatedAt: new Date().toISOString() });
        saveState(state);
        return state.jobs[jobId];
    }

    function startJob(type, task) {
        recoverInterruptedOperations();
        var state = loadState();
        var busy = Object.keys(state.jobs || {}).some(function (id) { return state.jobs[id] && (state.jobs[id].status === "queued" || state.jobs[id].status === "running"); });
        if (busy || state.pending) throw new Error("Another update, backup or restore operation is already running.");
        var jobId = Date.now() + "-" + type + "-" + crypto.randomBytes(4).toString("hex");
        updateJob(jobId, { id: jobId, type: type, status: "queued", progress: 0, message: "Queued", createdAt: new Date().toISOString() });
        activeJobs[jobId] = true;
        setImmediate(function () {
            updateJob(jobId, { status: "running", progress: 1, message: "Starting" });
            Promise.resolve().then(function () { return task(function (progress, message) { updateJob(jobId, { progress: progress, message: message }); }); }).then(function (result) {
                updateJob(jobId, { status: "completed", progress: 100, message: "Completed", result: result });
                delete activeJobs[jobId];
            }).catch(function (error) {
                updateJob(jobId, { status: "failed", progress: 100, message: String(error.message || error), error: String(error.message || error) });
                delete activeJobs[jobId];
            });
        });
        return { jobId: jobId, status: "queued" };
    }

    async function createBackupNow(reason, progress) {
        var installed = current();
        var id = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 17) + "-" + safeName(installed.version) + "-" + safeName(reason || "manual");
        var directory = path.join(backupRoot, id);
        var payload = path.join(directory, "app");
        await fs.promises.mkdir(directory, { recursive: true });
        if (progress) progress(15, "Copying application files");
        await fs.promises.cp(appRoot, payload, { recursive: true, errorOnExist: true, filter: function (source) { return path.resolve(source).indexOf(path.resolve(updateRoot)) !== 0; } });
        var manifest = { id: id, version: installed.version, channel: installed.channel, branch: installed.branch, reason: reason || "manual", createdAt: new Date().toISOString() };
        await fs.promises.writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
        if (progress) progress(95, "Writing backup manifest");
        return manifest;
    }

    function backup(reason) {
        return startJob("backup", function (progress) { return createBackupNow(reason || "manual", progress); });
    }

    function check(channel) {
        var selectedBranch = branch(channel);
        var base = "https://raw.githubusercontent.com/Eris92/SIRK-Portal/" + selectedBranch + "/";
        var cacheToken = "sirk_refresh=" + Date.now() + "_" + crypto.randomBytes(6).toString("hex");
        return Promise.all([request(base + "package.json?" + cacheToken), request(base + "config.json?" + cacheToken)]).then(function (values) {
            var packageJson = JSON.parse(values[0].toString("utf8"));
            var config = JSON.parse(values[1].toString("utf8"));
            if (config.applicationId !== "sirk-portal") throw new Error("Remote package identity mismatch.");
            var installed = current();
            var remoteVersion = String(config.version || packageJson.version || "");
            return { channel: Object.keys(CHANNELS).find(function (key) { return CHANNELS[key] === selectedBranch; }), branch: selectedBranch, currentVersion: installed.version, availableVersion: remoteVersion, downloadUrl: "https://codeload.github.com/Eris92/SIRK-Portal/zip/refs/heads/" + selectedBranch, updateAvailable: remoteVersion !== String(installed.version) };
        });
    }

    async function extract(zipFile, destination) {
        await fs.promises.mkdir(destination, { recursive: true });
        if (process.platform === "win32") await execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Expand-Archive -LiteralPath '" + zipFile.replace(/'/g, "''") + "' -DestinationPath '" + destination.replace(/'/g, "''") + "' -Force"]);
        else await execFile("unzip", ["-q", zipFile, "-d", destination]);
    }

    async function scheduleSwap(staged, token, history, channel, rollback) {
        var operationRoot = path.join(workRoot, token, "operation");
        var helperCopy = path.join(operationRoot, "update-helper.js");
        var manifestFile = path.join(operationRoot, "pending.json");
        var signalFile = path.join(operationRoot, "restart.signal");
        await fs.promises.mkdir(operationRoot, { recursive: true });
        await fs.promises.copyFile(path.join(appRoot, "server", "update-helper.js"), helperCopy);
        var manifest = { token: token, parentPid: process.pid, target: appRoot, staged: staged, rollback: rollback || "", stateFile: stateFile, history: history, serviceName: serviceName, signalFile: signalFile, preserve: ["Service", "node_modules"] };
        await fs.promises.writeFile(manifestFile, JSON.stringify(manifest, null, 2));
        var child = childProcess.spawn(process.execPath, [helperCopy, manifestFile], { cwd: path.dirname(appRoot), detached: true, stdio: "ignore", windowsHide: true });
        child.unref();
        var state = loadState();
        state.pending = { token: token, type: history.type, targetVersion: history.to || history.version || "", backupId: history.backupId || "", createdAt: new Date().toISOString(), helperPid: child.pid, serviceName: serviceName };
        if (channel) state.channel = channel;
        saveState(state);
        return state.pending;
    }

    function install(channel) {
        return startJob("update", async function (progress) {
            progress(5, "Checking selected channel");
            var remote = await check(channel);
            if (!remote.updateAvailable) return { staged: false, restartRequired: false, version: remote.availableVersion, current: true };
            progress(12, "Creating safety backup");
            var backupManifest = await createBackupNow("before-update", function (value, message) { progress(12 + Math.round(value * 0.28), message); });
            var token = Date.now() + "-" + crypto.randomBytes(4).toString("hex");
            var work = path.join(workRoot, token);
            var zipFile = path.join(work, "source.zip");
            var extracted = path.join(work, "extract");
            await fs.promises.mkdir(work, { recursive: true });
            progress(45, "Downloading update");
            await fs.promises.writeFile(zipFile, await request(remote.downloadUrl));
            progress(62, "Extracting update");
            await extract(zipFile, extracted);
            var directories = (await fs.promises.readdir(extracted, { withFileTypes: true })).filter(function (entry) { return entry.isDirectory(); });
            if (directories.length !== 1) throw new Error("Unexpected update archive layout.");
            var staged = path.join(extracted, directories[0].name);
            progress(78, "Running health checks");
            var stagedHealth = health(staged);
            if (!stagedHealth.ok) throw new Error("Downloaded update failed health checks.");
            var history = { type: "update", at: new Date().toISOString(), from: backupManifest.version, to: remote.availableVersion, backupId: backupManifest.id, channel: remote.channel };
            progress(90, "Scheduling service update");
            var pending = await scheduleSwap(staged, token, history, remote.channel, path.join(backupRoot, backupManifest.id, "app"));
            return { staged: true, restartRequired: true, version: remote.availableVersion, backupId: backupManifest.id, pending: pending, health: stagedHealth };
        });
    }

    function restore(backupId) {
        return startJob("restore", async function (progress) {
            backupId = validateBackupId(backupId);
            var source = path.join(backupRoot, backupId, "app");
            if (!fs.existsSync(source)) throw new Error("Backup was not found.");
            var backupManifest = readJson(path.join(backupRoot, backupId, "manifest.json"));
            progress(10, "Creating safety backup");
            var safety = await createBackupNow("before-restore", function (value, message) { progress(10 + Math.round(value * 0.3), message); });
            var token = Date.now() + "-restore-" + crypto.randomBytes(4).toString("hex");
            var staged = path.join(workRoot, token, "restore");
            await fs.promises.mkdir(path.dirname(staged), { recursive: true });
            progress(48, "Copying selected backup");
            await fs.promises.cp(source, staged, { recursive: true, errorOnExist: true });
            progress(75, "Running health checks");
            var stagedHealth = health(staged);
            if (!stagedHealth.ok) { await fs.promises.rm(staged, { recursive: true, force: true }); throw new Error("Backup failed health checks."); }
            var history = { type: "restore", at: new Date().toISOString(), version: backupManifest.version, backupId: backupId, safetyBackupId: safety.id, channel: backupManifest.channel || loadState().channel };
            progress(90, "Scheduling service restore");
            var pending = await scheduleSwap(staged, token, history, history.channel, path.join(backupRoot, safety.id, "app"));
            return { staged: true, restartRequired: true, backupId: backupId, safetyBackupId: safety.id, pending: pending, health: stagedHealth };
        });
    }

    function setChannel(channel) {
        recoverInterruptedOperations();
        var state = loadState();
        if (state.pending) throw new Error("The update channel cannot be changed while an operation is pending.");
        var selectedBranch = branch(channel);
        state.channel = Object.keys(CHANNELS).find(function (key) { return CHANNELS[key] === selectedBranch; });
        saveState(state);
        return current();
    }

    function restart() {
        recoverInterruptedOperations();
        var state = loadState();
        if (!state.pending) return { scheduled: false, reason: "No update or restore operation is pending." };
        var files = pendingPaths(state.pending);
        if (!fs.existsSync(files.manifest)) {
            addFailureHistory(state, state.pending, "Pending update manifest is missing.");
            state.pending = null;
            saveState(state);
            throw new Error("Pending update manifest is missing.");
        }
        fs.writeFileSync(files.signal, new Date().toISOString());
        if (process.platform !== "win32" && typeof options.restart === "function") {
            return Promise.resolve(options.restart()).then(function (value) { return { scheduled: true, serviceName: serviceName, host: value || null }; });
        }
        return { scheduled: true, serviceName: serviceName };
    }

    function clearInterrupted() {
        var state = loadState();
        if (!state.pending) return { cleared: false };
        if (state.pending.helperPid && processExists(state.pending.helperPid)) throw new Error("The update helper is still running.");
        addFailureHistory(state, state.pending, "Pending operation was cleared by an administrator.");
        state.pending = null;
        saveState(state);
        return { cleared: true };
    }

    recoverInterruptedOperations();

    function job(jobId) {
        return (loadState().jobs || {})[String(jobId || "")] || null;
    }

    return { channels: CHANNELS, current: current, state: function () { recoverInterruptedOperations(); return loadState(); }, setChannel: setChannel, check: check, backup: backup, backups: listBackups, deleteBackup: deleteBackup, install: install, restore: restore, health: health, job: job, restart: restart, clearInterrupted: clearInterrupted };
}

module.exports = { create: create, channels: CHANNELS };
