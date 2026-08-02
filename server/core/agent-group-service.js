"use strict";

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

function safeId(value) {
    value = String(value || "");
    return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) ? value : "";
}

function hash(value) {
    return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

module.exports.create = function (options) {
    var dataRoot = path.resolve(options.dataRoot);
    var file = path.join(dataRoot, "device-groups.json");

    function read() {
        try {
            var value = JSON.parse(fs.readFileSync(file, "utf8"));
            return value && Array.isArray(value.groups) ?
                { groups: value.groups, assignments: value.assignments || {} } :
                { groups: [], assignments: {} };
        } catch (error) { return { groups: [], assignments: {} }; }
    }
    function write(value) {
        var temporary = file + ".tmp-" + process.pid;
        fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
        fs.renameSync(temporary, file);
    }
    function publicGroup(group) {
        return {
            id: group.id, name: group.name, description: group.description || "",
            createdAtUtc: group.createdAtUtc || null,
            enrollmentExpiresAtUtc: group.enrollmentExpiresAtUtc || null
        };
    }
    function list() { return read().groups.map(publicGroup); }
    function create(value) {
        var name = String(value && value.name || "").trim().slice(0, 100);
        if (!name) throw new Error("Group name is required.");
        var state = read();
        var id = safeId(value && value.id) ||
            name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
        if (!id) id = "group-" + crypto.randomBytes(5).toString("hex");
        if (state.groups.some(function (item) { return item.id === id; }))
            throw new Error("A host group with this identifier already exists.");
        var group = {
            id: id, name: name, description: String(value && value.description || "").trim().slice(0, 500),
            createdAtUtc: new Date().toISOString()
        };
        state.groups.push(group); write(state); return publicGroup(group);
    }
    function remove(id) {
        id = safeId(id);
        var state = read(), before = state.groups.length;
        state.groups = state.groups.filter(function (item) { return item.id !== id; });
        if (state.groups.length === before) throw new Error("Host group was not found.");
        Object.keys(state.assignments).forEach(function (deviceId) {
            if (state.assignments[deviceId] === id) delete state.assignments[deviceId];
        });
        write(state);
    }
    function issue(id) {
        id = safeId(id);
        var state = read(), group = state.groups.find(function (item) { return item.id === id; });
        if (!group) throw new Error("Host group was not found.");
        var token = crypto.randomBytes(32).toString("base64url");
        group.enrollmentTokenHash = hash(token);
        group.enrollmentExpiresAtUtc = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        write(state);
        return {
            group: publicGroup(group),
            token: token,
            expiresAtUtc: group.enrollmentExpiresAtUtc
        };
    }
    function resolveEnrollment(token) {
        if (!token) return null;
        var supplied = Buffer.from(hash(token), "hex"), now = Date.now();
        var group = read().groups.find(function (item) {
            if (!/^[a-f0-9]{64}$/i.test(String(item.enrollmentTokenHash || "")) ||
                    Date.parse(item.enrollmentExpiresAtUtc || 0) <= now) return false;
            return crypto.timingSafeEqual(supplied, Buffer.from(item.enrollmentTokenHash, "hex"));
        });
        return group ? { groupId: group.id } : null;
    }
    function assign(deviceId, groupId) {
        deviceId = safeId(deviceId); groupId = safeId(groupId);
        if (!deviceId || !groupId) return;
        var state = read();
        if (!state.groups.some(function (item) { return item.id === groupId; })) return;
        state.assignments[deviceId] = groupId;
        write(state);
    }
    function bootstrapScript(id, mode, portalOrigin) {
        mode = mode === "run" ? "run" : "silent";
        var enrollment = issue(id);
        var token = enrollment.token;
        var endpoint = String(portalOrigin || "").replace(/\/+$/, "") + "/api/agent/v1/enroll";
        var installPath = mode === "silent" ? "$env:ProgramFiles\\SIRK\\Agent" : "$env:TEMP\\SIRK-Agent-Run";
        return [
            "#requires -Version 5.1",
            mode === "silent" ? "#requires -RunAsAdministrator" : "",
            "$ErrorActionPreference = 'Stop'",
            "$ProgressPreference = 'SilentlyContinue'",
            "$releases = Invoke-RestMethod -Uri 'https://api.github.com/repos/Eris92/SIRK-Agent/releases?per_page=20' -Headers @{ 'User-Agent'='SIRK-Portal' }",
            "$asset = @($releases | Where-Object { -not $_.draft } | ForEach-Object { $_.assets } | Where-Object { $_.name -match 'win-x64-framework-dependent.*\\.zip$' } | Select-Object -First 1)",
            "if ($asset.Count -ne 1) { throw 'Brak pakietu Windows x64 .NET 10 w ostatnich wydaniach.' }",
            "$packageRoot = Join-Path $env:TEMP ('SIRK-Agent-Package-' + [guid]::NewGuid().ToString('N'))",
            mode === "silent" ? "$agentRoot = " + JSON.stringify(installPath) : "$agentRoot = $packageRoot",
            "New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null",
            "$zip = Join-Path $env:TEMP ('SIRK-Agent-' + [guid]::NewGuid().ToString('N') + '.zip')",
            "Invoke-WebRequest -Uri $asset[0].browser_download_url -OutFile $zip -UseBasicParsing",
            "Expand-Archive -LiteralPath $zip -DestinationPath $packageRoot -Force",
            "$tokenFile = Join-Path $env:TEMP ('sirk-enroll-' + [guid]::NewGuid().ToString('N') + '.txt')",
            "Set-Content -LiteralPath $tokenFile -Value " + JSON.stringify(token) + " -Encoding ASCII",
            mode === "silent" ?
                "& (Join-Path $packageRoot 'Install-SirkAgent.ps1') -InstallPath $agentRoot" :
                "Start-Process -FilePath (Join-Path $agentRoot 'SirkAgent.Service.exe') -WindowStyle Hidden",
            "$heartbeat = Join-Path $env:ProgramData 'SIRK\\Agent\\heartbeat-latest.json'",
            "for ($attempt=0; $attempt -lt 30 -and -not (Test-Path -LiteralPath $heartbeat); $attempt++) { Start-Sleep -Seconds 1 }",
            "if (-not (Test-Path -LiteralPath $heartbeat)) { throw 'Agent nie utworzył heartbeat w wymaganym czasie.' }",
            "& (Join-Path $agentRoot 'sirkctl.exe') enroll --endpoint " + JSON.stringify(endpoint) + " --bootstrap-token-file $tokenFile",
            "& (Join-Path $agentRoot 'sirkctl.exe') sync",
            "Remove-Item -LiteralPath $tokenFile,$zip -Force -ErrorAction SilentlyContinue",
            mode === "silent" ? "Remove-Item -LiteralPath $packageRoot -Recurse -Force -ErrorAction SilentlyContinue" : "",
            "Write-Host 'SIRK Agent został przygotowany dla grupy " + id.replace(/'/g, "''") + ".' -ForegroundColor Green"
        ].filter(Boolean).join("\r\n") + "\r\n";
    }

    return { list: list, create: create, remove: remove, issue: issue, assign: assign,
        resolveEnrollment: resolveEnrollment, bootstrapScript: bootstrapScript };
};