"use strict";

var shared = require("../../core/shared.js");
var http = require("../../core/http-client.js");

module.exports.createModule = function (context) {
    var tokenCache = { token: "", expiresAt: 0 };

    function settings() { return context.integrations.get("defender"); }
    function tabAllowed(user, tab) {
        if (shared.isSiteAdmin(user)) return true;
        var permissions = settings().permissions || {};
        return shared.isUserInAnyGroup(user, permissions[tab] || []);
    }
    function token() {
        if (tokenCache.token && tokenCache.expiresAt > Date.now() + 60000) return Promise.resolve(tokenCache.token);
        var value = settings();
        if (!value.tenantId || !value.clientId || !value.clientSecret) throw new Error("Defender integration is not configured.");
        return http.requestJson({ method: "POST", url: "https://login.microsoftonline.com/" + encodeURIComponent(value.tenantId) + "/oauth2/v2.0/token", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "client_id=" + encodeURIComponent(value.clientId) + "&client_secret=" + encodeURIComponent(value.clientSecret) + "&scope=" + encodeURIComponent("https://graph.microsoft.com/.default") + "&grant_type=client_credentials", errorPrefix: "Microsoft identity" }).then(function (result) {
            tokenCache.token = result.access_token;
            tokenCache.expiresAt = Date.now() + Math.max(300, Number(result.expires_in) || 3600) * 1000;
            return tokenCache.token;
        });
    }
    function graph(method, endpoint, body) {
        return token().then(function (accessToken) {
            return http.requestJson({ method: method, url: "https://graph.microsoft.com/v1.0" + endpoint, headers: { Authorization: "Bearer " + accessToken }, json: body, errorPrefix: "Microsoft Graph" });
        });
    }
    function readJson(file, fallback) {
        try { return JSON.parse(context.fs.readFileSync(context.path.join(context.dataRoot, file), "utf8")); }
        catch (error) { return fallback; }
    }
    function agentDevices() {
        var registry = readJson("agent-registry.json", { devices: {} });
        return Object.keys(registry.devices || {}).map(function (key) {
            var device = registry.devices[key] || {};
            var lastSeen = Date.parse(device.lastSeenUtc || 0);
            return {
                tenantId: device.tenantId || "",
                deviceId: device.deviceId || "",
                machineName: device.machineName || device.deviceId || key,
                agentVersion: device.agentVersion || "",
                enrolledAtUtc: device.enrolledAtUtc || null,
                lastSeenUtc: device.lastSeenUtc || null,
                online: Number.isFinite(lastSeen) && Date.now() - lastSeen < 120000,
                keyRotatedAtUtc: device.keyRotatedAtUtc || null,
                deviceProofConfigured: !!device.publicKeySpki,
                heartbeat: device.heartbeat || null,
                management: device.management || null,
                runtimeHealth: device.runtimeHealth || null,
                evidenceBatchChain: !!device.lastBatchHash
            };
        });
    }
    function capabilityCatalog() {
        return [
            { key: "overview", title: "Przegląd", description: "Stan floty SIRK Agent, wersje, check-in i dostępność.", fields: ["machineName", "agentVersion", "lastSeenUtc", "online", "enrolledAtUtc"] },
            { key: "identity", title: "Tożsamość i rejestracja", description: "Trwały Device ID, Tenant ID, rejestracja bootstrap, DPAPI LocalMachine i ECDSA P-256.", settings: ["tenantId", "deviceId", "portal endpoint", "bootstrap token file", "key rotation"], security: ["token urządzenia nigdy nie jest zwracany do UI", "prywatny klucz pozostaje na urządzeniu", "Portal przechowuje wyłącznie hash tokenu i klucz publiczny"] },
            { key: "service", title: "Usługa Windows", description: "Windows Service SirkAgent, Automatic Start, SCM Recovery i broker aktywnej sesji.", settings: ["Automatic Start", "SCM recovery", "LocalSystem", "Session broker"], sources: ["Windows Service Control Manager", "heartbeat-latest.json"] },
            { key: "policy", title: "Polityki", description: "Podpisane ES256 polityki przypisane do tenant/device z anti-replay i anti-rollback.", settings: ["policyId", "epoch", "version", "nonce", "validFrom/validTo", "acknowledgedPolicyIds"], sources: ["active-policy.json", "policy-state.bin", "Archive/Accepted", "Archive/Rejected"] },
            { key: "management", title: "Management Plane", description: "Workgroup/AD/Entra/Hybrid, RSoP, secure channel, Conditional Access i baseline zabezpieczeń.", fields: ["management"], settings: ["AD secure channel", "Entra join", "RSoP", "Defender", "Firewall", "BitLocker", "Secure Boot", "TPM"] },
            { key: "runtime", title: "Runtime Health", description: "PID, uptime, CPU, pamięć, wątki, uchwyty, heartbeat i rozmiar logów.", fields: ["runtimeHealth", "heartbeat"], sources: ["runtime-health.json", "heartbeat-latest.json"] },
            { key: "endurance", title: "Endurance", description: "Próbki stabilności do 48 godzin, trendy RAM, restarty, przerwy i niezdrowe próbki.", settings: ["sample interval", "maximum samples", "RAM trend/hour", "leak suspicion"], sources: ["endurance-samples.jsonl", "endurance-summary.json", "endurance-report.html"] },
            { key: "telemetry", title: "Telemetria", description: "Szyfrowana kolejka offline z retry, backoff, retencją i throttlingiem.", settings: ["50 MB", "5000 plików", "14 dni retencji", "około 1 zwykły wpis / 5 min"], sources: ["TelemetryQueue", "agent-telemetry.jsonl", "agent-event-batches.jsonl"] },
            { key: "evidence", title: "Evidence Chain", description: "Łańcuch dowodowy z hashami, walidacją integralności i łańcuchem podpisanych batchy.", fields: ["evidenceBatchChain"], sources: ["evidence-events.jsonl", "evidence-state.bin", "agent-event-batches.jsonl"] },
            { key: "quarantine", title: "Kwarantanna i tamper", description: "Fail-closed, trwała kwarantanna DPAPI i wyjście wyłącznie przez podpisaną Recovery Policy.", settings: ["integrity verification", "quarantine state", "Recovery Policy"], sources: ["security-state.json", "quarantine-state.bin", "quarantine-status.json"] },
            { key: "activity", title: "Kolektory aktywności", description: "Procesy, aktywne okno, idle, metadane schowka, USB, druk, timing myszy/klawiatury, UI Automation i pliki.", settings: ["enabled", "processes", "interactiveContext", "clipboardMetadata", "usb", "printing", "mouseTiming", "keyboardTiming", "uiAutomation", "fileRoots", "intervalSeconds"], constraints: ["domyślnie wyłączone", "bez znaków klawiatury", "bez treści schowka", "pliki tylko z jawnych korzeni polityki"] },
            { key: "browser", title: "Browser Bridge", description: "Edge/Chrome, allowlista domen, aktywna sesja, karty, download, upload i drag-and-drop.", settings: ["allowed domains", "session SID", "tab telemetry", "downloads", "uploads", "drag-and-drop"], constraints: ["wymaga podpisanej polityki", "zakres ograniczony allowlistą"] },
            { key: "investigation", title: "Investigation", description: "Czasowe, formalnie zatwierdzone zbieranie rozszerzonej telemetrii dla konkretnej sprawy.", settings: ["caseId", "reasonCode", "approvedBy", "targetUserSid", "targetSessionId", "retentionDays", "collector scope"], constraints: ["minimum dwóch zatwierdzających", "ważna polityka", "retencja 1–3650 dni"] },
            { key: "risk", title: "Insider Risk", description: "Korelacja masowych pobrań, archiwizacji, uploadu, USB, druku i usuwania śladów.", settings: ["triggerSource HR/Security", "riskAnalytics", "screenshotOnRisk", "screenshotThreshold"], sources: ["risk-report.json", "risk-report.html", "risk-report-manifest.json"] },
            { key: "remote", title: "Zdalne operacje", description: "Uwierzytelniony Pulpit, Terminal, Pliki i broker poleceń bez Mesh Agenta.", settings: ["desktop snapshot", "mouse input", "terminal command", "file list/download/upload", "command results"], constraints: ["per-device ECDSA", "kolejka maks. 5 poleceń/check-in", "jawne błędy capture"] },
            { key: "updates", title: "Aktualizacje", description: "Podpisany manifest ES256, SHA-256 plików, staging, backup, health gate i rollback.", settings: ["verify-update", "stage-update", "update-manifest.json", "integrity-manifest.json", "automatic rollback"], constraints: ["nie usuwa katalogu danych", "zachowuje Device ID i polityki"] },
            { key: "diagnostics", title: "Diagnostyka", description: "CLI sirkctl, raport HTML/JSON, logi rotowane i kontrolowany Named Pipe.", settings: ["status", "sync", "process", "flush", "queue-status", "verify-integrity"], sources: ["agent-events.jsonl", "diagnostic report HTML/JSON", "SIRK-Agent-Control"] },
            { key: "data", title: "Pliki i źródła danych", description: "Pełny katalog lokalnych artefaktów Agenta, które mogą zasilać przyszłe widoki urządzenia.", sources: ["device-identity.bin", "portal-credential.bin", "active-policy.json", "management-state.json", "heartbeat-latest.json", "security-state.json", "runtime-health.json", "quarantine-status.json", "activity-latest.json", "evidence-events.jsonl", "TelemetryQueue", "endurance-summary.json", "risk-report.json"] }
        ];
    }

    return {
        key: "defendertools",
        clientConfig: function () {
            return { key: "defendertools", name: "Security", menuTitle: "Bezpieczeństwo", script: "defendertools.js", tabs: ["agent", "incidents", "email", "trusted", "hunting"], toolbar: { refresh: true, clear: true, favorites: false, search: true, manage: false, settings: true } };
        },
        getAccess: function (user) { return { allowed: !!user && (shared.isSiteAdmin(user) || ["incidents", "email", "trusted", "hunting"].some(function (tab) { return tabAllowed(user, tab); })), siteAdmin: shared.isSiteAdmin(user) }; },
        initialize: function () { return Promise.resolve(); },
        apiGet: function (asset, req, user) {
            if (asset === "agent-overview") {
                if (!shared.isSiteAdmin(user)) throw new Error("Permission denied.");
                var devices = agentDevices();
                return { ok: true, generatedAtUtc: new Date().toISOString(), summary: { total: devices.length, online: devices.filter(function (item) { return item.online; }).length, offline: devices.filter(function (item) { return !item.online; }).length, versions: Array.from(new Set(devices.map(function (item) { return item.agentVersion; }).filter(Boolean))).sort() }, devices: devices, categories: capabilityCatalog() };
            }
            if (asset === "status") return { ok: true, configured: context.integrations.configured().defender, tabs: { agent: shared.isSiteAdmin(user), incidents: tabAllowed(user, "incidents"), email: tabAllowed(user, "email"), trusted: tabAllowed(user, "trusted"), hunting: tabAllowed(user, "hunting") } };
            if (asset === "incidents") {
                if (!tabAllowed(user, "incidents")) throw new Error("Permission denied.");
                var filter = settings().incidentMode === "active" ? "?$filter=status ne 'resolved'&$top=100" : "?$top=100";
                return graph("GET", "/security/incidents" + filter).then(function (value) { return { ok: true, incidents: value.value || [] }; });
            }
            if (asset === "settings") {
                if (!shared.isSiteAdmin(user)) throw new Error("Permission denied.");
                return { ok: true, integration: context.integrations.publicSettings(user) };
            }
            if (["email", "trusted", "hunting"].indexOf(asset) >= 0) {
                if (!tabAllowed(user, asset)) throw new Error("Permission denied.");
                return { ok: true, rows: [], message: asset + " workflow is available through the embedded Defender scripts." };
            }
            throw new Error("Unknown Security action.");
        },
        apiPost: function (asset, req, user) {
            var value = req && req.body || {};
            if (asset === "hunt") {
                if (!tabAllowed(user, "hunting")) throw new Error("Permission denied.");
                return token().then(function (accessToken) {
                    return http.requestJson({ method: "POST", url: "https://api.security.microsoft.com/api/advancedhunting/run", headers: { Authorization: "Bearer " + accessToken }, json: { Query: String(value.query || "") }, errorPrefix: "Advanced Hunting" });
                }).then(function (result) { return { ok: true, result: result }; });
            }
            throw new Error("Unknown Security action.");
        }
    };
};