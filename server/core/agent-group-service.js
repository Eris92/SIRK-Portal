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
            id: group.id,
            name: group.name,
            description: group.description || "",
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
            id: id,
            name: name,
            description: String(value && value.description || "").trim().slice(0, 500),
            createdAtUtc: new Date().toISOString()
        };
        state.groups.push(group);
        write(state);
        return publicGroup(group);
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
        deviceId = safeId(deviceId);
        groupId = safeId(groupId);
        if (!deviceId || !groupId) return;
        var state = read();
        if (!state.groups.some(function (item) { return item.id === groupId; })) return;
        state.assignments[deviceId] = groupId;
        write(state);
    }
    function bootstrapScript(id, mode, portalOrigin) {
        mode = mode === "run" ? "run" : "silent";
        if (mode === "run") throw new Error("Run-only Agent mode was removed. Use the clean silent installation.");
        var enrollment = issue(id);
        var token = enrollment.token;
        var origin = String(portalOrigin || "").replace(/\/+$/, "");
        if (!/^https:\/\/[^/]+(?::\d+)?$/i.test(origin)) throw new Error("Public Portal HTTPS origin is required.");
        return [
            "#requires -Version 5.1",
            "#requires -RunAsAdministrator",
            "$ErrorActionPreference = 'Stop'",
            "$ProgressPreference = 'SilentlyContinue'",
            "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12",
            "$releases = Invoke-RestMethod -Uri 'https://api.github.com/repos/Eris92/SIRK-Agent/releases?per_page=30' -Headers @{ 'User-Agent'='SIRK-Portal' }",
            "$release = @($releases | Where-Object { -not $_.draft -and @($_.assets | Where-Object name -eq 'runtime-manifest.json').Count -eq 1 -and @($_.assets | Where-Object name -eq 'SIRK-Agent-Setup.exe').Count -eq 1 -and @($_.assets | Where-Object name -eq 'SIRK-Agent-Setup.exe.sha256').Count -eq 1 } | Select-Object -First 1)",
            "if ($release.Count -ne 1) { throw 'Brak kompletnego wydania SIRK Agent .NET 10.' }",
            "$exeAsset = @($release[0].assets | Where-Object name -eq 'SIRK-Agent-Setup.exe')",
            "$hashAsset = @($release[0].assets | Where-Object name -eq 'SIRK-Agent-Setup.exe.sha256')",
            "$work = Join-Path $env:TEMP ('SIRK-Agent-Setup-' + [guid]::NewGuid().ToString('N'))",
            "New-Item -ItemType Directory -Path $work -Force | Out-Null",
            "$exe = Join-Path $work 'SIRK-Agent-Setup.exe'",
            "$hashFile = $exe + '.sha256'",
            "try {",
            "  Invoke-WebRequest -UseBasicParsing -Uri $exeAsset[0].browser_download_url -OutFile $exe",
            "  Invoke-WebRequest -UseBasicParsing -Uri $hashAsset[0].browser_download_url -OutFile $hashFile",
            "  $expected = ((Get-Content -LiteralPath $hashFile -Raw).Trim() -split '\\s+')[0]",
            "  $actual = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash",
            "  if ($expected -notmatch '^[A-Fa-f0-9]{64}$' -or $actual -ine $expected) { throw ('SIRK Agent Setup SHA-256 mismatch. Expected=' + $expected + ' Actual=' + $actual) }",
            "  & $exe --portal-url " + JSON.stringify(origin) + " --enrollment-token " + JSON.stringify(token) + " --channel stable",
            "  if ($LASTEXITCODE -ne 0) { throw ('SIRK Agent Setup failed. ExitCode=' + $LASTEXITCODE) }",
            "} finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }",
            "Write-Host 'SIRK Agent został zainstalowany i przypisany do grupy " + id.replace(/'/g, "''") + ".' -ForegroundColor Green"
        ].join("\r\n") + "\r\n";
    }

    return {
        list: list,
        create: create,
        remove: remove,
        issue: issue,
        assign: assign,
        resolveEnrollment: resolveEnrollment,
        bootstrapScript: bootstrapScript
    };
};
