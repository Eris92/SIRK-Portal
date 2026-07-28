"use strict";

var childProcess = require("child_process");
var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

function safeServiceName(value) {
    value = String(value || "");
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(value)) throw new Error("Invalid Windows service name.");
    return value;
}

function psLiteral(value) {
    return "'" + String(value || "").replace(/'/g, "''") + "'";
}

function powerShellExecutable() {
    var root = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
    var candidate = path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    return fs.existsSync(candidate) ? candidate : "powershell.exe";
}

function executePowerShell(script) {
    var result = childProcess.spawnSync(powerShellExecutable(), [
        "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script
    ], {
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 1024 * 1024
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(String(result.stderr || result.stdout || "Unable to query Windows service state.").trim());
    }
    return String(result.stdout || "").replace(/^\uFEFF/, "").trim();
}

function normalizedStartMode(value) {
    value = String(value || "");
    if (/^auto$/i.test(value)) return "Automatic";
    if (/^manual$/i.test(value)) return "Manual";
    if (/^disabled$/i.test(value)) return "Disabled";
    return value || "Unknown";
}

function normalizedService(value) {
    value = value && typeof value === "object" ? value : {};
    var state = String(value.state || value.State || "Unknown");
    var processId = Number(value.processId != null ? value.processId : value.ProcessId) || 0;
    return {
        name: String(value.name || value.Name || ""),
        displayName: String(value.displayName || value.DisplayName || value.name || value.Name || ""),
        state: state,
        startMode: normalizedStartMode(value.startMode || value.StartMode),
        processId: processId > 0 ? processId : 0,
        pathName: String(value.pathName || value.PathName || ""),
        canRestart: /^running$/i.test(state)
    };
}

module.exports.create = function (options) {
    options = options || {};
    var serviceName = safeServiceName(options.serviceName || process.env.SIRK_SERVICE_NAME || "SirkPortalStandalone");
    var dataRoot = path.resolve(options.dataRoot || process.env.SIRK_DATA_ROOT || process.cwd());
    var queryPowerShell = options.executePowerShell || executePowerShell;
    var spawn = options.spawn || childProcess.spawn;

    function services() {
        if (process.platform !== "win32" && !options.executePowerShell) return [];
        var script = [
            "$ErrorActionPreference='Stop'",
            "$service=Get-CimInstance -ClassName Win32_Service -Filter \"Name='" + serviceName + "'\"",
            "if($null -eq $service){return}",
            "[pscustomobject]@{name=[string]$service.Name;displayName=[string]$service.DisplayName;state=[string]$service.State;startMode=[string]$service.StartMode;processId=[int64]$service.ProcessId;pathName=[string]$service.PathName}|ConvertTo-Json -Compress"
        ].join(";");
        var output = queryPowerShell(script);
        if (!output) return [];
        var parsed;
        try { parsed = JSON.parse(output); }
        catch (error) { throw new Error("Windows service query returned invalid JSON."); }
        var service = normalizedService(parsed);
        return service.name === serviceName ? [service] : [];
    }

    function scheduleRestart(requestedName) {
        requestedName = safeServiceName(requestedName || serviceName);
        if (requestedName !== serviceName) throw new Error("This service is not managed by SIRK Portal.");
        var current = services()[0];
        if (!current) throw new Error("SIRK Portal Windows service was not found.");
        if (!/^running$/i.test(current.state)) throw new Error("SIRK Portal service is not running.");

        var runtimeRoot = path.join(dataRoot, "runtime");
        fs.mkdirSync(runtimeRoot, { recursive: true });
        var token = crypto.randomBytes(12).toString("hex");
        var scriptFile = path.join(runtimeRoot, "restart-service-" + token + ".ps1");
        var script = [
            "$ErrorActionPreference = 'Stop'",
            "$serviceName = " + psLiteral(serviceName),
            "$scriptFile = " + psLiteral(scriptFile),
            "try {",
            "  Start-Sleep -Milliseconds 900",
            "  $service = Get-Service -Name $serviceName -ErrorAction Stop",
            "  if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) {",
            "    Stop-Service -Name $serviceName -Force -ErrorAction Stop",
            "    (Get-Service -Name $serviceName).WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(120))",
            "  }",
            "  Start-Service -Name $serviceName -ErrorAction Stop",
            "  (Get-Service -Name $serviceName).WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(120))",
            "} finally {",
            "  Remove-Item -LiteralPath $scriptFile -Force -ErrorAction SilentlyContinue",
            "}"
        ].join("\r\n") + "\r\n";
        fs.writeFileSync(scriptFile, script, "utf8");
        var processHandle = spawn(powerShellExecutable(), [
            "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptFile
        ], {
            detached: true,
            stdio: "ignore",
            windowsHide: true
        });
        processHandle.unref();
        return { scheduled: true, serviceName: serviceName };
    }

    return {
        serviceName: serviceName,
        services: services,
        scheduleRestart: scheduleRestart
    };
};

module.exports.normalizedService = normalizedService;
