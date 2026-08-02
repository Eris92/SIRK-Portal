"use strict";

var childProcess = require("child_process");
var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

function safeId(value) {
    value = String(value || "");
    return /^cmd-[a-z0-9_-]{3,100}$/.test(value) ? value : "";
}
function atomicWrite(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    var temporary = file + ".tmp-" + process.pid + "-" + crypto.randomBytes(4).toString("hex");
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
}
function packageUrl(value) {
    var parsed;
    try { parsed = new URL(String(value || "")); } catch (_) { throw new Error("Package URL is invalid."); }
    var allowed = ["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"];
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || allowed.indexOf(parsed.hostname.toLowerCase()) < 0)
        throw new Error("Package URL must use HTTPS and an approved GitHub release host.");
    return parsed.toString();
}
function psQuote(value) { return "'" + String(value).replace(/'/g, "''") + "'"; }

function create(options) {
    options = options || {};
    var dataRoot = path.resolve(options.dataRoot);
    var updaterCli = path.resolve(options.updaterCli || "C:\\Program Files\\SIRK\\Updater\\SirkUpdater.exe");
    var serviceName = String(options.serviceName || process.env.SIRK_SERVICE_NAME || "SirkPortal");
    var jobsRoot = path.join(dataRoot, "central-portal-operations");

    function paths(commandId) {
        var id = safeId(commandId);
        if (!id) throw new Error("Command ID is invalid.");
        var root = path.join(jobsRoot, id);
        return { root: root, script: path.join(root, "run.ps1"), result: path.join(root, "result.json") };
    }
    function validate(command) {
        if (!command || !safeId(command.id)) throw new Error("Portal operation command is invalid.");
        if (command.type === "restart") return { type: "restart" };
        if (command.type !== "update") throw new Error("Unsupported Portal operation.");
        var payload = command.payload && typeof command.payload === "object" ? command.payload : {};
        if (String(payload.applicationId || "sirk-portal") !== "sirk-portal") throw new Error("Only sirk-portal may be updated by this runner.");
        var sha256 = String(payload.sha256 || "").toUpperCase();
        if (!/^[A-F0-9]{64}$/.test(sha256)) throw new Error("Update SHA256 is invalid.");
        var targetVersion = String(payload.targetVersion || "").trim();
        if (!/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,79}$/.test(targetVersion)) throw new Error("Target version is invalid.");
        return { type: "update", packageUrl: packageUrl(payload.packageUrl), sha256: sha256, targetVersion: targetVersion };
    }
    function scriptFor(command, resultPath) {
        var operation = validate(command);
        var common = [
            "$ErrorActionPreference='Stop'",
            "$resultPath=" + psQuote(resultPath),
            "function Save-Result([string]$state,[string]$message,[object]$detail){",
            "  $tmp=$resultPath+'.tmp-'+[guid]::NewGuid().ToString('N')",
            "  @{state=$state;message=$message;detail=$detail;finishedAtUtc=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $tmp -Encoding UTF8",
            "  Move-Item -LiteralPath $tmp -Destination $resultPath -Force",
            "}"
        ];
        if (operation.type === "restart") {
            return common.concat([
                "try {",
                "  Start-Sleep -Seconds 2",
                "  Restart-Service -Name " + psQuote(serviceName) + " -Force",
                "  (Get-Service -Name " + psQuote(serviceName) + ").WaitForStatus('Running',[TimeSpan]::FromSeconds(60))",
                "  Save-Result 'completed' 'SIRK Portal restarted.' @{service=" + psQuote(serviceName) + "}",
                "} catch { Save-Result 'failed' $_.Exception.Message @{exception=$_.Exception.ToString()} ; exit 1 }"
            ]).join("\r\n");
        }
        return common.concat([
            "$package=Join-Path $env:TEMP ('sirk-portal-update-'+[guid]::NewGuid().ToString('N')+'.zip')",
            "try {",
            "  Invoke-WebRequest -UseBasicParsing -Uri " + psQuote(operation.packageUrl) + " -OutFile $package",
            "  $actual=(Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToUpperInvariant()",
            "  if($actual -ne " + psQuote(operation.sha256) + "){throw 'Downloaded package SHA256 mismatch.'}",
            "  & " + psQuote(updaterCli) + " update sirk-portal $package " + psQuote(operation.sha256) + " " + psQuote(operation.targetVersion) + " 2>&1 | Out-String | Set-Variable output",
            "  if($LASTEXITCODE -ne 0){throw ('SIRK Updater failed with ExitCode='+$LASTEXITCODE+'. '+$output)}",
            "  Save-Result 'completed' 'SIRK Portal update completed.' @{targetVersion=" + psQuote(operation.targetVersion) + ";output=$output}",
            "} catch { Save-Result 'failed' $_.Exception.Message @{exception=$_.Exception.ToString()} ; exit 1 }",
            "finally { Remove-Item -LiteralPath $package -Force -ErrorAction SilentlyContinue }"
        ]).join("\r\n");
    }
    function queue(command) {
        if (process.platform !== "win32") throw new Error("Portal operations require Windows.");
        if (command.type === "update" && !fs.existsSync(updaterCli)) throw new Error("SIRK Updater CLI is not installed.");
        var job = paths(command.id);
        fs.mkdirSync(job.root, { recursive: true, mode: 0o700 });
        if (fs.existsSync(job.result)) return status(command.id);
        fs.writeFileSync(job.script, scriptFor(command, job.result), { encoding: "utf8", mode: 0o600 });
        var child = childProcess.spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", job.script], {
            detached: true, windowsHide: true, stdio: "ignore"
        });
        child.unref();
        atomicWrite(path.join(job.root, "queued.json"), { commandId: command.id, type: command.type, queuedAtUtc: new Date().toISOString() });
        return { state: "running", message: command.type === "update" ? "SIRK Portal update started." : "SIRK Portal restart scheduled." };
    }
    function status(commandId) {
        var job = paths(commandId);
        try {
            var value = JSON.parse(fs.readFileSync(job.result, "utf8").replace(/^\uFEFF/, ""));
            return { state: value.state === "completed" ? "completed" : "failed", message: String(value.message || ""), result: value.detail || {} };
        } catch (error) {
            if (error.code === "ENOENT") return { state: "running", message: "Portal operation is still running." };
            return { state: "failed", message: error.message, result: { code: "PORTAL_OPERATION_RESULT_INVALID" } };
        }
    }
    return { queue: queue, status: status, validate: validate, jobsRoot: jobsRoot };
}

module.exports = { create: create, packageUrl: packageUrl, safeId: safeId };
