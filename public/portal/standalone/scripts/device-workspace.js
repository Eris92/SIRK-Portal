
(function () {
    "use strict";

    if (window.__sirkPlatformPortalDeviceWorkspaceLoaded) return;
    window.__sirkPlatformPortalDeviceWorkspaceLoaded = true;

    var content = document.getElementById("sirkStandaloneContent");
    var core = window.SirkPlatformCore;
    var selectedNodeId = "";
    var selectedNode = null;
    var inventory = null;
    var activeTab = "general";
    var transformScheduled = false;
    var quickCommands = { data: null, category: "", selected: null, search: "", favoritesOnly: false, collapsed: quickReadBoolean("sirkPortal.quickCommands.categoriesCollapsed", false), detailsCollapsed: quickReadBoolean("sirkPortal.quickCommands.detailsCollapsed", false), outputAttention: false, output: "", outputError: false, pollToken: 0 };
    var DEVICE_ICON = '<svg class="sirk-device-computer-svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M6.5 7.5h11v6h-11z" class="sirk-device-computer-screen"/></svg>';

    var REMOTE_TABS = ["desktop", "terminal", "files"];

    var TEXT = {
        pl: {
            general: "Ogólne", desktop: "Pulpit", terminal: "Terminal", commands: "Polecenia", files: "Pliki",
            registry: "Rejestr", software: "Oprogramowanie", amt: "Intel AMT",
            back: "Wróć do urządzeń", online: "Online", offline: "Offline",
            name: "Nazwa", status: "Status", group: "Grupa", system: "System",
            ip: "Adres IP", lastSeen: "Ostatnio widziany", agent: "Wersja agenta", nodeId: "Node ID",
            quickCommands: "Szybkie polecenia", close: "Zamknij", loadingCommands: "Ładowanie poleceń…", noCommands: "Brak poleceń.",
            searchCommands: "Szukaj poleceń…", variables: "Parametry", runCommand: "Uruchom", requestCommand: "Wyślij wniosek",
            commandSent: "Polecenie zostało wysłane.", commandPending: "Polecenie oczekuje na akceptację.", commandFailed: "Nie udało się wysłać polecenia.", confirmCommand: "Uruchomić polecenie",
            collapseCategories: "Zwiń kategorie", expandCategories: "Rozwiń kategorie", favorites: "Pokaż ulubione", hideOutput: "Ukryj wyniki", showOutput: "Pokaż wyniki", refresh: "Odśwież", noFavoriteCommands: "Brak ulubionych poleceń.", selectCommand: "Wybierz polecenie, aby zobaczyć parametry i wynik.", submittingCommand: "Wysyłanie polecenia…", waitingOutput: "Oczekiwanie na wynik agenta…", commandCompleted: "Polecenie zakończone.", commandTimeout: "Przekroczono czas oczekiwania na wynik."
        },
        en: {
            general: "Overview", desktop: "Desktop", terminal: "Terminal", commands: "Commands", files: "Files",
            registry: "Registry", software: "Software", amt: "Intel AMT",
            back: "Back to devices", online: "Online", offline: "Offline",
            name: "Name", status: "Status", group: "Group", system: "Operating system",
            ip: "IP address", lastSeen: "Last seen", agent: "Agent version", nodeId: "Node ID",
            quickCommands: "Quick commands", close: "Close", loadingCommands: "Loading commands…", noCommands: "No commands.",
            searchCommands: "Search commands…", variables: "Variables", runCommand: "Run", requestCommand: "Request",
            commandSent: "Command submitted.", commandPending: "Command is waiting for approval.", commandFailed: "Command could not be submitted.", confirmCommand: "Run command",
            collapseCategories: "Collapse categories", expandCategories: "Expand categories", favorites: "Show favorites", hideOutput: "Hide output", showOutput: "Show output", refresh: "Refresh", noFavoriteCommands: "No favorite commands.", selectCommand: "Select a command to view parameters and output.", submittingCommand: "Submitting command…", waitingOutput: "Waiting for agent output…", commandCompleted: "Command completed.", commandTimeout: "Command output timeout reached."
        }
    };

    function language() {
        try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
        catch (error) { return document.documentElement.lang === "en" ? "en" : "pl"; }
    }

    function t(key) { return TEXT[language()][key] || key; }

    function commandModule() {
        return window.SirkPlatformModules && window.SirkPlatformModules.commands || null;
    }

    function localized(item, field) {
        var locale = item && item.locales && item.locales[language()];
        return locale && locale[field] || item && item[field] || "";
    }

    function esc(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
    }

    function shortId(value) {
        var parts = String(value || "").split("/");
        return parts[parts.length - 1] || "";
    }

    function sameNodeId(left, right) {
        left = String(left || "");
        right = String(right || "");
        return left === right || (shortId(left) && shortId(left) === shortId(right));
    }

    function formatLastSeen(value) {
        if (value == null || value === "") return "—";
        var number = Number(value);
        var date = Number.isFinite(number) ? new Date(number < 100000000000 ? number * 1000 : number) : new Date(value);
        return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(language() === "pl" ? "pl-PL" : "en-US");
    }

    function nodeOnline(node) { return Number(node && node.conn || 0) > 0; }

    function groupMap(value) {
        var map = Object.create(null);
        ((value && value.groups) || []).forEach(function (group) {
            map[String(group.id || "")] = group;
        });
        return map;
    }

    function nodeGroup(node) {
        var map = groupMap(inventory);
        var group = map[String(node && node.groupId || "")];
        return String(group && group.name || t("noGroup"));
    }

    function getInventory() {
        var apiBase = new URL(String(window.__SIRK_PLATFORM_API_BASE__ || ""), window.location.href);
        var request = apiBase.pathname.replace(/\/+$/, "") === "/api"
            ? fetch("/api/devices", { credentials: "same-origin", cache: "no-store" }).then(function (response) { return response.json().then(function (value) { if (!response.ok || value.ok === false) throw new Error(value.error || "Device inventory unavailable."); return value.value || value; }); })
            : core.api("portal", "devices");
        return Promise.resolve(request).then(function (value) {
            inventory = {
                nodes: Array.isArray(value && value.nodes) ? value.nodes : [],
                groups: Array.isArray(value && value.groups) ? value.groups : []
            };
            return inventory;
        });
    }

    function findNode(value, id) {
        var nodes = value && value.nodes || [];
        for (var i = 0; i < nodes.length; i += 1) {
            if (sameNodeId(nodes[i].id || nodes[i]._id, id)) return nodes[i];
        }
        return null;
    }


    function agentOperation(node, type, parameters) {
        var body = new URLSearchParams();
        body.set("payload", JSON.stringify({
            tenantId: node.tenantId,
            deviceId: node.deviceId,
            type: type,
            parameters: parameters || {}
        }));
        var endpoint = agentOperationUrl("agent-operation-create");
        var runtime = window.SirkPlatformRuntime && window.SirkPlatformRuntime.state;
        var csrfToken = runtime && runtime.bootstrap && runtime.bootstrap.csrfToken || "";
        return fetch(endpoint, {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-SIRK-CSRF": csrfToken },
            body: body.toString()
        }).then(function (response) {
            return response.json().then(function (value) {
                if (!response.ok || value.ok === false) throw new Error(value.error || "HTTP " + response.status);
                return value.value;
            });
        });
    }

    function portalHttpUrl(pathAndQuery) {
        var rewritten = core && typeof core.portalUrl === "function"
            ? core.portalUrl(pathAndQuery)
            : pathAndQuery;
        return new URL(rewritten, window.location.href).href;
    }

    function agentOperationUrl(action, parameters) {
        var endpoint = new URL(portalHttpUrl("/api/agent-operations"), window.location.href);
        Object.keys(parameters || {}).forEach(function (key) {
            endpoint.searchParams.set(key, parameters[key]);
        });
        return endpoint.href;
    }

    function portalWebSocketUrl(pathAndQuery) {
        var rewritten = core && typeof core.portalUrl === "function"
            ? core.portalUrl(pathAndQuery)
            : new URL(pathAndQuery, window.location.href).href;
        var endpoint = new URL(rewritten, window.location.href);
        endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
        return endpoint.href;
    }

    function usesHttpTunnel() {
        try {
            var rewritten = core && typeof core.portalUrl === "function"
                ? core.portalUrl("/api/v1/desktop/stream")
                : "/api/v1/desktop/stream";
            return /^\/connect\//.test(new URL(rewritten, window.location.href).pathname);
        } catch (error) { return false; }
    }

    function waitForAgentOperation(node, commandId, status) {
        var deadline = Date.now() + 150000;
        return new Promise(function (resolve, reject) {
            function poll() {
                var endpoint = agentOperationUrl("agent-operation-status", {
                    tenantId: node.tenantId,
                    deviceId: node.deviceId,
                    commandId: commandId,
                    waitMilliseconds: 25000
                });
                fetch(endpoint, { credentials: "same-origin", cache: "no-store" }).then(function (response) {
                    return response.json().then(function (value) {
                        if (!response.ok || value.ok === false) throw new Error(value.error || "HTTP " + response.status);
                        if (value.value.status === "completed" || value.value.status === "failed") {
                            resolve(value.value);
                            return;
                        }
                        if (Date.now() >= deadline) throw new Error("Agent nie zwrócił wyniku w wymaganym czasie.");
                        status.textContent = "Oczekiwanie na SIRK Agenta…";
                        setTimeout(poll, 0);
                    });
                }).catch(reject);
            }
            poll();
        });
    }

    function runAgentOperation(node, type, parameters, status) {
        status.textContent = "Wysyłanie do SIRK Agenta…";
        status.classList.remove("is-error");
        return agentOperation(node, type, parameters).then(function (command) {
            return waitForAgentOperation(node, command.commandId, status);
        });
    }

    function renderAgentTerminal(host, node) {
        host.innerHTML = '<div class="sirk-agent-operation"><header><strong>Terminal SIRK Agent</strong><small>PowerShell uruchamiany przez usługę na urządzeniu</small></header><textarea data-agent-terminal-command spellcheck="false" placeholder="Get-ComputerInfo | Select-Object WindowsProductName, OsVersion"></textarea><div class="sirk-agent-operation-actions"><button type="button" data-agent-terminal-run>Uruchom</button></div><pre data-agent-operation-status>Gotowy.</pre></div>';
        var command = host.querySelector("[data-agent-terminal-command]");
        var button = host.querySelector("[data-agent-terminal-run]");
        var status = host.querySelector("[data-agent-operation-status]");
        button.addEventListener("click", function () {
            if (!command.value.trim()) return;
            button.disabled = true;
            runAgentOperation(node, "terminal.execute", { command: command.value, timeoutSeconds: 30 }, status)
                .then(function (value) {
                    status.textContent = value.result && value.result.output || value.result && value.result.code || "Brak wyniku.";
                    status.classList.toggle("is-error", value.status === "failed");
                }).catch(function (error) {
                    status.textContent = error.message || String(error);
                    status.classList.add("is-error");
                }).then(function () { button.disabled = false; });
        });
    }

    function renderAgentFiles(host, node) {
        host.innerHTML = '<div class="sirk-agent-operation"><header><strong>Pliki SIRK Agent</strong><small>Lista jest ograniczona do 1000 pozycji, transfer do 1 MiB</small></header><div class="sirk-agent-path"><input data-agent-files-path value="C:\\\\" spellcheck="false"><button type="button" data-agent-files-list>Otwórz</button><button type="button" data-agent-files-upload>Wyślij plik</button><input data-agent-files-picker type="file" hidden></div><pre data-agent-operation-status>Gotowy.</pre><div class="sirk-agent-file-list" data-agent-file-list></div></div>';
        var input = host.querySelector("[data-agent-files-path]");
        var button = host.querySelector("[data-agent-files-list]");
        var status = host.querySelector("[data-agent-operation-status]");
        var list = host.querySelector("[data-agent-file-list]");
        var upload = host.querySelector("[data-agent-files-upload]");
        var picker = host.querySelector("[data-agent-files-picker]");
        function open(path) {
            button.disabled = true;
            runAgentOperation(node, "files.list", { path: path }, status).then(function (value) {
                var entries = value.result && value.result.data || [];
                status.textContent = value.status === "failed" ? (value.result.output || value.result.code) : entries.length + " pozycji";
                status.classList.toggle("is-error", value.status === "failed");
                list.innerHTML = entries.map(function (entry) {
                    return '<button type="button" data-agent-file-path="' + esc(entry.path) + '" data-agent-directory="' + (entry.isDirectory ? "1" : "0") + '"><span>' + (entry.isDirectory ? "📁" : "📄") + '</span><strong>' + esc(entry.name) + '</strong><small>' + (entry.isDirectory ? "" : esc(String(entry.length) + " B")) + '</small></button>';
                }).join("");
            }).catch(function (error) {
                status.textContent = error.message || String(error);
                status.classList.add("is-error");
            }).then(function () { button.disabled = false; });
        }
        button.addEventListener("click", function () { open(input.value); });
        list.addEventListener("click", function (event) {
            var item = event.target.closest("[data-agent-file-path]");
            if (!item) return;
            if (item.getAttribute("data-agent-directory") === "1") {
                input.value = item.getAttribute("data-agent-file-path");
                open(input.value);
                return;
            }
            status.textContent = "Pobieranie pliku…";
            runAgentOperation(node, "files.read", { path: item.getAttribute("data-agent-file-path") }, status)
                .then(function (value) {
                    var data = value.result && value.result.data;
                    if (value.status === "failed" || !data || !data.contentBase64)
                        throw new Error(value.result && (value.result.output || value.result.code) || "Brak danych pliku.");
                    var binary = atob(data.contentBase64);
                    var bytes = new Uint8Array(binary.length);
                    for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
                    var link = document.createElement("a");
                    link.href = URL.createObjectURL(new Blob([bytes]));
                    link.download = data.name || "download.bin";
                    link.click();
                    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
                    status.textContent = "Pobrano " + link.download;
                }).catch(function (error) {
                    status.textContent = error.message || String(error);
                    status.classList.add("is-error");
                });
        });
        upload.addEventListener("click", function () { picker.click(); });
        picker.addEventListener("change", function () {
            var file = picker.files && picker.files[0];
            if (!file) return;
            if (file.size > 1024 * 1024) { status.textContent = "Plik przekracza limit 1 MiB."; status.classList.add("is-error"); return; }
            file.arrayBuffer().then(function (buffer) {
                var bytes = new Uint8Array(buffer), binary = "";

                for (var index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
                var separator = /[\\/]$/.test(input.value) ? "" : "\\";
                return runAgentOperation(node, "files.write", {
                    path: input.value + separator + file.name,
                    contentBase64: btoa(binary)
                }, status);
            }).then(function (value) {
                if (value.status === "failed") throw new Error(value.result.output || value.result.code);
                status.textContent = "Wysłano " + file.name;
                open(input.value);
            }).catch(function (error) {
                status.textContent = error.message || String(error);
                status.classList.add("is-error");
            }).then(function () { picker.value = ""; });
        });
    }

    function renderAgentDesktop(host, node) {
        var stopped = false;
        host.innerHTML = '<div class=\"sirk-agent-desktop\"><div class=\"sirk-agent-desktop-stage\"><canvas data-agent-desktop-image aria-label=\"Zdalny pulpit\" tabindex=\"0\"></canvas><span data-agent-desktop-cursor style=\"display:none\"></span></div></div>';
        ensureCompactCommands(host);
        setCompactCommandsConnected(host, false);
        var image = host.querySelector("[data-agent-desktop-image]");
        var imageContext = image.getContext("2d", { alpha: false, desynchronized: true });
        var moveCanvas = document.createElement("canvas");
        var moveContext = moveCanvas.getContext("2d", { alpha: false });
        var localCursor = host.querySelector("[data-agent-desktop-cursor]");
        var status = document.createElement("span");
        var selectedSessionId = 0;
        var selectedMonitorIndex = -1;
        var nativeWidth = 0, nativeHeight = 0, sourceWidth = 0, sourceHeight = 0;
        var streamGeneration = 0, connected = false;
        var inputSequence = 0, pendingInput = new Map();
        var hasCompleteFrame = false;
        var frameTimes = [], inputTimes = [], byteSamples = [], frameRenderTimes = [];
        var activeAutoProfile = "smooth", lastAutoChangeAt = 0, lastFrameAt = 0;
        var lastTargetFps = 0;
        var profiles = {
            smooth: { maxWidth: 1920, quality: 85, targetKbps: 2500, targetFps: 120,
                codec: "webp", deltaScalePercent: 100 },
            text: { maxWidth: 1920, quality: 100, targetKbps: 8000, targetFps: 30,
                codec: "png", deltaScalePercent: 100 },
            video: { maxWidth: 1920, quality: 85, targetKbps: 3000, targetFps: 60,
                codec: "h264", deltaScalePercent: 100 },
            weak: { maxWidth: 1600, quality: 60, targetKbps: 800, targetFps: 30,
                codec: "jpeg", deltaScalePercent: 60 },
            minimum: { maxWidth: 1280, quality: 40, targetKbps: 450, targetFps: 15,
                codec: "jpeg", deltaScalePercent: 35 }
        };
        function percentile(values, fraction) {
            if (!values.length) return 0;
            var sorted = values.slice().sort(function (a, b) { return a - b; });
            return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
        }
        function effectiveProfile() {
            var base = profiles[activeAutoProfile];
            var requestedCodec = base.codec;
            return Object.assign({}, base, {
                codec: requestedCodec,
                imageEncoding: requestedCodec === "h264" ? "webp" : requestedCodec,
                frameMode: requestedCodec === "h264" ? "h264" : "tiles",
                quality: requestedCodec === "png" ? 100 : base.quality
            });
        }
        function updateCodecControls() {}
        function streamProfileParameters(settings) {
            return { action: "streamProfile", maxWidth: settings.maxWidth,
                quality: settings.quality, targetKbps: settings.targetKbps,
                targetFps: settings.targetFps, frameMode: settings.frameMode,
                imageEncoding: settings.imageEncoding,
                deltaScalePercent: settings.deltaScalePercent };
        }
        function setStreamStatus(message) {
            if (status.textContent !== message) status.textContent = message;
            if (status.classList.contains("is-error")) status.classList.remove("is-error");
        }
        function positionLocalCursor(x, y, desktopWidth, desktopHeight) {
            if (!desktopWidth || !desktopHeight || !image.parentElement) return;
            var stageBounds = image.parentElement.getBoundingClientRect();
            var imageBounds = image.getBoundingClientRect();
            localCursor.style.display = "";
            localCursor.style.left = (imageBounds.left - stageBounds.left +
                Number(x || 0) / desktopWidth * imageBounds.width) + "px";
            localCursor.style.top = (imageBounds.top - stageBounds.top +
                Number(y || 0) / desktopHeight * imageBounds.height) + "px";
        }
        function updateStats(data, frameMs, decodeMs, renderMs) {
            frameTimes.push(frameMs); if (frameTimes.length > 120) frameTimes.shift();
            var now = performance.now();
            lastFrameAt = now;
            lastTargetFps = Number(data.targetFps || lastTargetFps || effectiveProfile().targetFps || 0);
            frameRenderTimes.push(now);
            frameRenderTimes = frameRenderTimes.filter(function (at) { return now - at <= 2000; });
            byteSamples.push({ at: now, bytes: Number(data.encodedBytes || 0) });
            byteSamples = byteSamples.filter(function (item) { return now - item.at <= 5000; });
            var fpsSeconds = frameRenderTimes.length > 1
                ? Math.max(0.001, (now - frameRenderTimes[0]) / 1000) : 1;
            var fps = frameRenderTimes.length > 1 ? (frameRenderTimes.length - 1) / fpsSeconds : 0;
            var bits = byteSamples.reduce(function (sum, item) { return sum + item.bytes * 8; }, 0);
            var inputP95 = percentile(inputTimes, 0.95);
            if (connected && now - lastAutoChangeAt > 2000) {
                var latencyP95 = percentile(frameTimes, 0.95), nextProfile = activeAutoProfile;
                if (activeAutoProfile === "smooth" && latencyP95 > 180) nextProfile = "weak";
                else if (activeAutoProfile === "weak" && latencyP95 > 340) nextProfile = "minimum";
                else if (activeAutoProfile === "minimum" && latencyP95 < 240) nextProfile = "weak";
                else if (activeAutoProfile === "weak" && latencyP95 < 125) nextProfile = "smooth";
                if (nextProfile !== activeAutoProfile) {
                    activeAutoProfile = nextProfile;
                    lastAutoChangeAt = now;
                    var adaptive = effectiveProfile();
                    updateCodecControls();
                    input(streamProfileParameters(adaptive)).catch(function () {});
                }
            }
        }
        function selected() {
            return { sessionId: selectedSessionId, monitorIndex: selectedMonitorIndex };
        }
        function input(parameters) {
            var target = selected();
            parameters.sessionId = target.sessionId;
            parameters.monitorIndex = target.monitorIndex;
            var started = performance.now();
            var socketActions = ["move", "leftDown", "leftUp", "rightClick", "middleClick", "wheel", "key", "text"];
            var inputChannel = desktopInputSocket && desktopInputSocket.readyState === WebSocket.OPEN
                ? desktopInputSocket : desktopSocket;
            if (inputChannel && inputChannel.readyState === WebSocket.OPEN &&
                socketActions.indexOf(parameters.action) >= 0) {
                inputChannel.send(JSON.stringify({ type: "input", id: ++inputSequence, input: parameters }));
                inputTimes.push(performance.now() - started);
                if (inputTimes.length > 60) inputTimes.shift();
                return Promise.resolve({ ok: true });
            }
            var runtime = window.SirkPlatformRuntime && window.SirkPlatformRuntime.state;
            var csrfToken = runtime && runtime.bootstrap && runtime.bootstrap.csrfToken || "";
            return fetch(portalHttpUrl("/api/v1/desktop/input"), {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json", "X-SIRK-CSRF": csrfToken },
                body: JSON.stringify({
                    tenantId: node.tenantId, deviceId: node.deviceId, input: parameters
                })
            }).then(function (response) {
                return response.json().then(function (value) {
                    if (!response.ok || value.ok === false) throw new Error(value.error || "Input failed.");
                    return value;
                });
            }).then(function (value) {
                if (socketActions.indexOf(parameters.action) >= 0) {
                    inputTimes.push(performance.now() - started);
                    if (inputTimes.length > 60) inputTimes.shift();
                }
                return value;
            });
        }
        function desktopData(value) {
            var response = value.result && value.result.data || {};
            if (response.data && typeof response.data === "object") {
                Object.keys(response.data).forEach(function (key) { response[key] = response.data[key]; });
            }
            return response;
        }
        function loadMonitors() {
            return runAgentOperation(node, "desktop.monitors", { sessionId: selectedSessionId }, status)
                .then(function (value) {
                    var data = desktopData(value);
                    var monitors = data.monitors || [];
                    var selectedMonitor = monitors.find(function (item) { return item.primary === true; }) ||
                        monitors[0] || null;
                    selectedMonitorIndex = selectedMonitor ? Number(selectedMonitor.index) : -1;
                });
        }
        function loadSessions() {
            return runAgentOperation(node, "desktop.sessions", {}, status).then(function (value) {
                var result = value.result || {};
                if (value.status === "failed") {
                    throw new Error(String(result.output || result.code ||
                        "Agent odrzucił pobranie sesji."));
                }
                var sessions = result.data || [];
                if (!sessions.length) throw new Error("Agent nie zgłosił aktywnej sesji użytkownika.");
                var selectedSession = sessions.find(function (item) { return item.active === true; }) || sessions[0];
                selectedSessionId = Number(selectedSession.sessionId);
                return loadMonitors();
            });
        }
        function restartStream() {
            if (!connected) return;
            streamGeneration += 1;
            hasCompleteFrame = false;
            snapshot.sequence = 0;
            var settings = effectiveProfile();
            updateCodecControls();
            var streamProfile = streamProfileParameters(settings);
            if (usesHttpTunnel()) {
                var generation = streamGeneration;
                var configureDeadline = Date.now() + 30000;
                status.textContent = "Uruchamianie kanału SIRK Agenta…";

                // The frame long-poll marks the HTTP viewer as active. The Agent uses
                // that state to establish its authenticated desktop WebSocket. Start
                // polling before sending the first profile to avoid a viewer/Agent
                // startup deadlock through the Central request/response tunnel.
                snapshot(generation);

                function configureStream() {
                    if (stopped || !connected || !host.isConnected || generation !== streamGeneration) return;
                    input(Object.assign({}, streamProfile)).then(function () {
                        if (stopped || !connected || !host.isConnected || generation !== streamGeneration) return;
                        setStreamStatus("Kanał Agenta gotowy · oczekiwanie na pierwszą klatkę…");
                    }).catch(function (error) {
                        if (stopped || !connected || !host.isConnected || generation !== streamGeneration) return;
                        var message = error.message || String(error);
                        if (Date.now() < configureDeadline &&
                            /desktop stream is offline|DESKTOP_STREAM_OFFLINE|HTTP 409/i.test(message)) {
                            status.textContent = "Oczekiwanie na kanał pulpitu SIRK Agenta…";
                            status.classList.remove("is-error");
                            setTimeout(configureStream, 500);
                            return;
                        }
                        status.textContent = message;
                        status.classList.add("is-error");
                    });
                }

                configureStream();
                return;
            }
            startDesktopSocket(streamGeneration, streamProfile);
        }
        var desktopSocket = null;
        var desktopInputSocket = null;
        var desktopTextDecoder = new TextDecoder();
        function handleInputSocketMessage(event) {
            if (typeof event.data !== "string") return;
            var message;
            try { message = JSON.parse(event.data); } catch (error) { return; }
            var id = Number(message.id);
            if (message.type === "inputAck" && pendingInput.has(id)) {
                var pending = pendingInput.get(id);
                pendingInput.delete(id); clearTimeout(pending.timer);
                inputTimes.push(performance.now() - pending.started);
                if (inputTimes.length > 60) inputTimes.shift();
                pending.resolve({ ok: true });
            }
        }
        function rejectPendingInputs(message) {
            pendingInput.forEach(function (pending) {
                clearTimeout(pending.timer); pending.reject(new Error(message));
            });
            pendingInput.clear();
        }
        function renderImageFrame(buffer, data, generation, requestStarted) {
            var desktopWidth = Number(data.sourceWidth || data.width || 0);
            var desktopHeight = Number(data.sourceHeight || data.height || 0);
            if (!desktopWidth || !desktopHeight) return Promise.reject(new Error("Invalid desktop dimensions."));
            var decodeStarted = performance.now();
            var contentType = String(data.contentType || "image/webp");
            return createImageBitmap(new Blob([buffer], { type: contentType })).then(function (decoded) {
                if (generation !== streamGeneration) { decoded.close(); return; }
                sourceWidth = desktopWidth; sourceHeight = desktopHeight;
                nativeWidth = desktopWidth; nativeHeight = desktopHeight;
                if (image.width !== desktopWidth || image.height !== desktopHeight) {
                    image.width = desktopWidth; image.height = desktopHeight;
                    moveCanvas.width = desktopWidth; moveCanvas.height = desktopHeight;
                }
                var renderStarted = performance.now();
                if (hasCompleteFrame && (data.moves || []).length) {
                    moveContext.clearRect(0, 0, moveCanvas.width, moveCanvas.height);
                    moveContext.drawImage(image, 0, 0);
                    (data.moves || []).forEach(function (move) {
                        imageContext.drawImage(moveCanvas,
                            Number(move.sourceX || 0), Number(move.sourceY || 0),
                            Number(move.width || 0), Number(move.height || 0),
                            Number(move.x || 0), Number(move.y || 0),
                            Number(move.width || 0), Number(move.height || 0));
                    });
                }
                (data.patches || []).forEach(function (patch) {
                    imageContext.drawImage(decoded,
                        Number(patch.atlasX || 0), Number(patch.atlasY || 0),
                        Number(patch.atlasWidth || decoded.width), Number(patch.atlasHeight || decoded.height),
                        Number(patch.x || 0), Number(patch.y || 0),
                        Number(patch.width || desktopWidth), Number(patch.height || desktopHeight));
                });
                if (data.fullFrame === true) hasCompleteFrame = true;
                positionLocalCursor(data.cursorX, data.cursorY, desktopWidth, desktopHeight);
                decoded.close();
                var capturedAt = Number(data.capturedAtUnixMilliseconds || 0);
                updateStats(data, capturedAt > 0 ? Math.max(0, Date.now() - capturedAt) :
                    performance.now() - requestStarted, renderStarted - decodeStarted,
                    performance.now() - renderStarted);
                setStreamStatus("Połączono · kafelki dirty-region · " + desktopWidth + " × " + desktopHeight +
                    " · atlas " + Number(data.width || 0) + " × " + Number(data.height || 0) +
                    " · " + String(data.encoding || contentType));
            });
        }
        function startDesktopSocket(generation, streamProfile) {
            if (desktopSocket) { try { desktopSocket.close(); } catch (error) {} }
            desktopInputSocket = null;
            var url = portalWebSocketUrl("/api/v1/desktop/stream?deviceId=" +
                encodeURIComponent(node.deviceId));
            var socket = new WebSocket(url);
            desktopSocket = socket;
            desktopInputSocket = socket;
            socket.binaryType = "arraybuffer";
            socket.onopen = function () {
                if (generation !== streamGeneration || socket !== desktopSocket) return;
                input(streamProfile).catch(function (error) {
                    status.textContent = error.message || String(error);
                    status.classList.add("is-error");
                });
            };
            socket.onmessage = function (event) {
                if (generation !== streamGeneration || socket !== desktopSocket) return;
                if (typeof event.data === "string") {
                    handleInputSocketMessage(event);
                    return;
                }
                var packet = new Uint8Array(event.data);
                if (packet.length < 5) return;
                var metadataLength = new DataView(packet.buffer, packet.byteOffset, 4).getUint32(0, false);
                if (metadataLength < 2 || metadataLength + 4 > packet.length) return;
                var data;
                try { data = JSON.parse(desktopTextDecoder.decode(packet.subarray(4, 4 + metadataLength))); }
                catch (error) { return; }
                var previousSequence = Number(snapshot.sequence || 0);
                snapshot.sequence = Number(data.sequence || previousSequence);
                if (data.cursorOnly === true) {
                    sourceWidth = Number(data.sourceWidth || sourceWidth || data.width || 1);
                    sourceHeight = Number(data.sourceHeight || sourceHeight || data.height || 1);
                    positionLocalCursor(data.cursorX, data.cursorY, sourceWidth, sourceHeight);
                    return;
                }
                if (/^image\/(?:jpeg|png|webp)$/i.test(String(data.contentType || ""))) {
                    if (data.fullFrame !== true && (!hasCompleteFrame ||
                        (previousSequence > 0 && snapshot.sequence !== previousSequence + 1))) {
                        hasCompleteFrame = false;
                        input({ action: "requestKeyframe" }).catch(function () {});
                        return;
                    }
                    renderImageFrame(packet.subarray(4 + metadataLength), data, generation, performance.now())
                        .catch(function () { input({ action: "requestKeyframe" }).catch(function () {}); });
                    return;
                }
                if (data.contentType !== "video/h264") { socket.close(); return; }
                if (videoDecoder && videoDecoder.decodeQueueSize > 1 && !data.keyFrame) return;
                decodeH264Frame({ buffer: packet.subarray(4 + metadataLength), data: data },
                    generation, performance.now(), false).catch(function () {
                        input({ action: "requestKeyframe" }).catch(function () {});
                    });
            };
            socket.onclose = function () {
                if (generation !== streamGeneration || socket !== desktopSocket) return;
                if (!desktopInputSocket || desktopInputSocket.readyState !== WebSocket.OPEN)
                    rejectPendingInputs("Desktop socket closed.");
                desktopSocket = null;
                desktopInputSocket = null;
                if (connected) setTimeout(function () {
                    if (generation === streamGeneration) startDesktopSocket(generation, streamProfile);
                }, 1000);
            };
            socket.onerror = function () { try { socket.close(); } catch (error) {} };
        }
        function snapshot(generation) {
            if (stopped || !connected || !host.isConnected || generation !== streamGeneration) return;
            var requestStarted = performance.now();
            var url = portalHttpUrl("/api/v1/desktop/frame?tenantId=" + encodeURIComponent(node.tenantId) +
                "&deviceId=" + encodeURIComponent(node.deviceId) +
                "&after=" + encodeURIComponent(snapshot.sequence || 0) + "&waitMilliseconds=25000");
            fetch(url, { credentials: "same-origin", cache: "no-store" }).then(function (response) {
                if (response.status === 204) return null;
                if (!response.ok) throw new Error("HTTP " + response.status);
                var previousSequence = snapshot.sequence || 0;
                var receivedSequence = Number(response.headers.get("X-SIRK-Sequence")) || previousSequence;
                snapshot.sequence = receivedSequence;
                var encodedMetadata = response.headers.get("X-SIRK-Metadata") || "";
                var metadata = {};
                try {
                    var binary = atob(encodedMetadata);
                    var bytes = new Uint8Array(binary.length);
                    for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
                    metadata = JSON.parse(new TextDecoder().decode(bytes));
                } catch (error) {}
                return response.arrayBuffer().then(function (buffer) {
                    return { buffer: buffer, contentType: response.headers.get("Content-Type") || "image/jpeg",
                        data: metadata, sequence: receivedSequence, previous: previousSequence };
                });
            }).then(function (value) {
                if (stopped || !connected || !host.isConnected || generation !== streamGeneration) return;
                if (!value) { snapshot(generation); return; }
                var data = value.data || {};
                if (data.fullFrame !== true &&
                    (!hasCompleteFrame || (value.previous > 0 && value.sequence !== value.previous + 1))) {
                    hasCompleteFrame = false;
                    input({ action: "requestKeyframe" }).catch(function () {});
                    snapshot(generation);
                    return;
                }
                var imageFrame = /^image\/(?:jpeg|png|webp)/i.test(value.contentType);
                sourceWidth = Number(data.sourceWidth || data.width || 0);
                sourceHeight = Number(data.sourceHeight || data.height || 0);
                nativeWidth = imageFrame ? sourceWidth : Number(data.width || sourceWidth);
                nativeHeight = imageFrame ? sourceHeight : Number(data.height || sourceHeight);
                var decodeStarted = performance.now();
                if (value.contentType.indexOf("video/h264") === 0 && "VideoDecoder" in window)
                    return decodeH264Frame(value, generation, requestStarted, true);
                return createImageBitmap(new Blob([value.buffer], { type: value.contentType })).then(function (decoded) {
                    if (generation !== streamGeneration) return;
                    if (image.width !== nativeWidth || image.height !== nativeHeight) {
                        image.width = nativeWidth;
                        image.height = nativeHeight;
                        moveCanvas.width = nativeWidth;
                        moveCanvas.height = nativeHeight;
                    }
                    var renderStarted = performance.now();
                    if (hasCompleteFrame && (data.moves || []).length) {
                        moveContext.clearRect(0, 0, moveCanvas.width, moveCanvas.height);
                        moveContext.drawImage(image, 0, 0);
                        (data.moves || []).forEach(function (move) {
                            imageContext.drawImage(moveCanvas,
                                Number(move.sourceX || 0), Number(move.sourceY || 0),
                                Number(move.width || 0), Number(move.height || 0),
                                Number(move.x || 0), Number(move.y || 0),
                                Number(move.width || 0), Number(move.height || 0));
                        });
                    }
                    (data.patches || []).forEach(function (patch) {
                        imageContext.drawImage(decoded,
                            Number(patch.atlasX || 0), Number(patch.atlasY || 0),
                            Number(patch.atlasWidth || decoded.width), Number(patch.atlasHeight || decoded.height),
                            Number(patch.x || 0), Number(patch.y || 0),
                            Number(patch.width || nativeWidth), Number(patch.height || nativeHeight));
                    });
                    if (data.fullFrame === true) hasCompleteFrame = true;
                    positionLocalCursor(data.cursorX, data.cursorY, sourceWidth, sourceHeight);
                    decoded.close();
                    var capturedAt = Number(data.capturedAtUnixMilliseconds || 0);
                    var frameMs = capturedAt > 0 ? Math.max(0, Date.now() - capturedAt) :
                        performance.now() - requestStarted;
                    updateStats(data, frameMs, renderStarted - decodeStarted,
                        performance.now() - renderStarted);
                    var frameDescription = imageFrame
                        ? sourceWidth + " × " + sourceHeight + " · atlas " +
                            Number(data.width || 0) + " × " + Number(data.height || 0) +
                            " · " + String(data.encoding || value.contentType)
                        : sourceWidth + " × " + sourceHeight + " → " +
                            nativeWidth + " × " + nativeHeight;
                    setStreamStatus("Połączono · tunel Central HTTP · " + frameDescription +
                        " · profil auto/" + activeAutoProfile);
                    setTimeout(function () { snapshot(generation); }, 0);
                });
            }).catch(function (error) {
                if (stopped || !connected || !host.isConnected || generation !== streamGeneration) return;
                status.textContent = error.message || String(error);
                status.classList.add("is-error");
                setTimeout(function () { snapshot(generation); }, 3000);
            });
        }
        var videoDecoder = null;
        var videoMetadata = new Map();
        var videoGeneration = 0;
        function decodeH264Frame(value, generation, requestStarted, continuePolling) {
            var data = value.data || {};
            if (!videoDecoder || videoDecoder.state === "closed" || videoGeneration !== generation) {
                if (videoDecoder && videoDecoder.state !== "closed") { try { videoDecoder.close(); } catch (error) {} }
                videoMetadata.clear();
                videoGeneration = generation;
                videoDecoder = new VideoDecoder({
                    output: function (decoded) {
                            var metadata = videoMetadata.get(decoded.timestamp) || {};
                            videoMetadata.delete(decoded.timestamp);
                            var frameData = metadata.data || {};
                            var outputAt = performance.now();
                            if (videoGeneration === streamGeneration) {
                                nativeWidth = Number(frameData.width || decoded.displayWidth);
                                nativeHeight = Number(frameData.height || decoded.displayHeight);
                                sourceWidth = Number(frameData.sourceWidth || nativeWidth);
                                sourceHeight = Number(frameData.sourceHeight || nativeHeight);
                                if (image.width !== nativeWidth || image.height !== nativeHeight) {
                                    image.width = nativeWidth; image.height = nativeHeight;
                                }
                                var renderStarted = performance.now();
                                imageContext.drawImage(decoded, 0, 0, nativeWidth, nativeHeight);
                                var renderMilliseconds = performance.now() - renderStarted;
                                hasCompleteFrame = true;
                                positionLocalCursor(frameData.cursorX, frameData.cursorY,
                                    sourceWidth, sourceHeight);
                                var capturedAt = Number(frameData.capturedAtUnixMilliseconds || 0);
                                var inputAt = Number(metadata.requestStarted || requestStarted);
                                updateStats(frameData, capturedAt ? Math.max(0, Date.now() - capturedAt) :
                                    performance.now() - inputAt, outputAt - inputAt, renderMilliseconds);
                                setStreamStatus("Połączono · H.264 low-latency · " + sourceWidth + " × " + sourceHeight +
                                    " → " + nativeWidth + " × " + nativeHeight);
                            }
                            decoded.close();
                    },
                    error: function () { input({ action: "requestKeyframe" }).catch(function () {}); }
                });
                videoDecoder.configure({ codec: "avc1.42E01F", optimizeForLatency: true, hardwareAcceleration: "prefer-hardware" });
            }
            var timestamp = Number(data.sequence || data.capturedAtUnixMilliseconds || Date.now()) * 1000;
            videoMetadata.set(timestamp, { data: data, requestStarted: requestStarted });
            var encodedBytes = value.buffer instanceof Uint8Array ? value.buffer : new Uint8Array(value.buffer);
            videoDecoder.decode(new EncodedVideoChunk({
                type: data.keyFrame ? "key" : "delta", timestamp: timestamp, data: encodedBytes
            }));
            if (continuePolling) setTimeout(function () { snapshot(generation); }, 0);
            return Promise.resolve().then(function () {
                if (videoMetadata.size > 8) {
                    var oldest = videoMetadata.keys().next().value;
                    videoMetadata.delete(oldest);
                }
            });
        }
        var lastMouseMoveAt = 0;
        function coordinates(event) {
            if (!sourceWidth || !sourceHeight) return;
            var bounds = image.getBoundingClientRect();
            return {
                x: Math.round((event.clientX - bounds.left) / bounds.width * sourceWidth),
                y: Math.round((event.clientY - bounds.top) / bounds.height * sourceHeight)
            };
        }
        image.addEventListener("pointerdown", function (event) {
            var point = coordinates(event); if (!point) return;
            if (event.button === 0) {
                image.setPointerCapture(event.pointerId);
                input({ action: "leftDown", x: point.x, y: point.y }).catch(function (error) { status.textContent = error.message || String(error); });
            } else if (event.button === 1) {
                event.preventDefault();
                input({ action: "middleClick", x: point.x, y: point.y }).catch(function (error) { status.textContent = error.message || String(error); });
            }
        });
        image.addEventListener("pointerup", function (event) {
            var point = coordinates(event); if (!point || event.button !== 0) return;
            input({ action: "leftUp", x: point.x, y: point.y }).catch(function (error) { status.textContent = error.message || String(error); });
        });
        image.addEventListener("pointermove", function (event) {
            var now = Date.now(); if (now - lastMouseMoveAt < 8) return;
            var point = coordinates(event); if (!point) return; lastMouseMoveAt = now;
            positionLocalCursor(point.x, point.y, sourceWidth, sourceHeight);
            input({ action: "move", x: point.x, y: point.y }).catch(function () {});
        });
        image.addEventListener("wheel", function (event) {
            var point = coordinates(event); if (!point) return; event.preventDefault();
            input({ action: "wheel", x: point.x, y: point.y, delta: event.deltaY < 0 ? 120 : -120 }).catch(function (error) { status.textContent = error.message || String(error); });
        });
        image.addEventListener("contextmenu", function (event) {
            event.preventDefault();
            if (!sourceWidth || !sourceHeight) return;
            var bounds = image.getBoundingClientRect();
            input({
                action: "rightClick",
                x: Math.round((event.clientX - bounds.left) / bounds.width * sourceWidth),
                y: Math.round((event.clientY - bounds.top) / bounds.height * sourceHeight)
            }).catch(function (error) { status.textContent = error.message || String(error); status.classList.add("is-error"); });
        });
        function completedInput(parameters) {
            return runAgentOperation(node, "desktop.input", Object.assign(selected(), parameters), status);
        }
        function downloadClipboardFile(data) {
            if (data.tooLarge) throw new Error("Plik w schowku ma " + data.bytes +
                " B; automatyczny schowek obsługuje obecnie do " + data.maximumBytes + " B.");
            var binary = atob(data.fileBase64 || "");
            var bytes = new Uint8Array(binary.length);
            for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
            var link = document.createElement("a");
            link.href = URL.createObjectURL(new Blob([bytes]));
            link.download = data.fileName || "sirk-transfer.bin";
            link.click();
            setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
        }
        function copyFromRemote() {
            return completedInput({ action: "key", key: "C", modifiers: "Control" })
                .then(function () {
                    return completedInput({ action: "clipboardGet" });
                }).then(function (value) {
                    var data = desktopData(value);
                    if (data.kind === "file") {
                        downloadClipboardFile(data);
                        status.textContent = "Pobrano plik ze zdalnego schowka: " + data.fileName;
                        return;
                    }
                    return navigator.clipboard.writeText(data.text || "").then(function () {
                        status.textContent = "Zdalny tekst jest w lokalnym schowku.";
                    });
                });
        }
        function pasteToRemote() {
            return navigator.clipboard.readText().then(function (text) {
                return completedInput({ action: "clipboardSet", text: text });
            }).then(function () {
                return completedInput({ action: "key", key: "V", modifiers: "Control" });
            }).then(function () { status.textContent = "Wklejono lokalny schowek do sesji zdalnej."; });
        }
        image.addEventListener("keydown", function (event) {
            if (!connected) return;
            var key = String(event.key || "").toLowerCase();
            if (event.ctrlKey && !event.altKey && !event.metaKey && (key === "c" || key === "v")) {
                event.preventDefault();
                (key === "c" ? copyFromRemote() : pasteToRemote()).catch(function (error) {
                    status.textContent = error.message || String(error); status.classList.add("is-error");
                });
                return;
            }
            if (event.metaKey || (event.ctrlKey && event.altKey)) return;
            var special = { Enter: "Enter", Tab: "Tab", Escape: "Escape", Backspace: "Backspace",
                Delete: "Delete", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
                Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
                F1: "F1", F2: "F2", F3: "F3", F4: "F4", F5: "F5", F6: "F6",
                F7: "F7", F8: "F8", F9: "F9", F10: "F10", F11: "F11", F12: "F12" };
            var command = null;
            if (special[event.key]) command = { action: "key", key: special[event.key],
                modifiers: [event.ctrlKey ? "Control" : "", event.altKey ? "Alt" : "",
                    event.shiftKey ? "Shift" : ""].filter(Boolean).join(",") };
            else if (event.key && event.key.length === 1 && !event.ctrlKey && !event.altKey)
                command = { action: "text", text: event.key };
            else if (event.key && event.key.length === 1 && (event.ctrlKey || event.altKey))
                command = { action: "key", key: event.key.toUpperCase(),
                    modifiers: [event.ctrlKey ? "Control" : "", event.altKey ? "Alt" : "",
                        event.shiftKey ? "Shift" : ""].filter(Boolean).join(",") };
            if (!command) return;
            event.preventDefault();
            input(command).catch(function (error) {
                status.textContent = error.message || String(error);
                status.classList.add("is-error");
            });
        });
        image.addEventListener("dragover", function (event) {
            if (!connected) return;
            event.preventDefault();
            image.classList.add("is-file-drop");
        });
        image.addEventListener("dragleave", function () { image.classList.remove("is-file-drop"); });
        image.addEventListener("drop", function (event) {
            event.preventDefault();
            image.classList.remove("is-file-drop");
            var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
            if (!file) return;
            if (file.size > 512 * 1024) {
                status.textContent = "Automatyczny transfer schowka obsługuje obecnie pliki do 512 KiB.";
                status.classList.add("is-error");
                return;
            }
            var reader = new FileReader();
            reader.onload = function () {
                var encoded = String(reader.result || "").split(",")[1] || "";
                completedInput({ action: "clipboardFileSet", fileName: file.name, fileBase64: encoded })
                    .then(function () {
                        return completedInput({ action: "key", key: "V", modifiers: "Control" });
                    }).then(function () {
                        status.textContent = "Przeniesiono i wklejono plik: " + file.name;
                    }).catch(function (error) {
                        status.textContent = error.message || String(error);
                        status.classList.add("is-error");
                    });
            };
            reader.readAsDataURL(file);
        });
        var reconnectTimer = 0;
        function scheduleReconnect() {
            clearTimeout(reconnectTimer);
            if (stopped || connected) return;
            reconnectTimer = setTimeout(connectDesktop, 3000);
        }
        function connectDesktop() {
            if (stopped || connected) return;
            if (!host.isConnected) {
                scheduleReconnect();
                return;
            }
            clearTimeout(reconnectTimer);
            status.textContent = "Nawiązywanie połączenia live…";
            status.classList.remove("is-error");
            loadSessions().then(function () {
                if (stopped || !host.isConnected) return;
                frameTimes = []; inputTimes = []; byteSamples = []; frameRenderTimes = [];
                activeAutoProfile = "smooth"; lastAutoChangeAt = 0; lastFrameAt = 0;
                lastTargetFps = effectiveProfile().targetFps;
                connected = true;
                setCompactCommandsConnected(host, true);
                restartStream();
            }).catch(function (error) {
                connected = false;
                setCompactCommandsConnected(host, false);
                status.textContent = error.message || String(error);
                status.classList.add("is-error");
                scheduleReconnect();
            });
        }
        connectDesktop();
        var observer = new MutationObserver(function () {
            if (!host.isConnected) {
                stopped = true;
                clearTimeout(reconnectTimer);
                if (connected) input({ action: "streamStop" }).catch(function () {});
                connected = false;
                setCompactCommandsConnected(host, false);
                if (desktopSocket) { try { desktopSocket.close(); } catch (error) {} desktopSocket = null; }
                if (desktopInputSocket) { try { desktopInputSocket.close(); } catch (error) {} desktopInputSocket = null; }
                rejectPendingInputs("Desktop workspace closed.");
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function renderAgentTab(host, node, type) {
        if (type === "terminal") renderAgentTerminal(host, node);
        else if (type === "files") renderAgentFiles(host, node);
        else renderAgentDesktop(host, node);
    }

    function renderGeneral(host, node) {
        var online = nodeOnline(node);
        host.innerHTML = '<div class="sirk-device-general"><div class="sirk-device-detail-grid">' +
            detailItem(t("name"), node.name) + detailItem(t("status"), online ? t("online") : t("offline")) +
            detailItem(t("group"), nodeGroup(node)) + detailItem(t("system"), node.os || t("noOs")) +
            detailItem(t("ip"), node.ip || "—") + detailItem(t("lastSeen"), formatLastSeen(node.lastSeen)) +
            detailItem(t("agent"), node.agentVersion || "—") + detailItem(t("nodeId"), node.id || node._id) +
            '</div></div>';
    }

    function renderCommandsTab(host, node) {
        var module = commandModule();
        if (!module || typeof module.mount !== "function") {
            host.innerHTML = '<div class="sirk-device-command-loading">' + esc(t("loadingCommands")) + '</div>';
            var loader = window.SirkPortalBundles && window.SirkPortalBundles.load;
            if (typeof loader !== "function") {
                host.innerHTML = '<div class="sirk-device-command-error">' + esc(t("noCommands")) + '</div>';
                return;
            }
            Promise.resolve(loader("modules")).then(function () {
                if (!host.isConnected || activeTab !== "commands") return;
                var loaded = commandModule();
                if (!loaded || typeof loaded.mount !== "function") throw new Error(t("noCommands"));
                renderCommandsTab(host, node);
            }).catch(function (error) {
                if (!host.isConnected) return;
                host.innerHTML = '<div class="sirk-device-command-error">' + esc(error && error.message || t("noCommands")) + '</div>';
            });
            return;
        }
        host.innerHTML = '<div class="sirk-device-commands-host"></div>';
        var moduleHost = host.firstElementChild;
        if (typeof module.mountDeviceCommands === "function") module.mountDeviceCommands(moduleHost, String(node.id || node._id || ""));
        else {
            if (typeof module.onDeviceRefreshEnd === "function") module.onDeviceRefreshEnd(String(node.id || node._id || ""));
            module.mount(moduleHost, "sirk-device-commands");
        }
    }

    function quickReadBoolean(key, fallback) {
        try {
            var value = localStorage.getItem(key);
            return value == null ? fallback : value === "1";
        } catch (error) { return fallback; }
    }

    function quickWriteBoolean(key, value) {
        try { localStorage.setItem(key, value ? "1" : "0"); } catch (error) {}
    }

    function quickItemKey(item) {
        if (!item) return "";
        return String(item.path || (item.kind === "command" ? "@command/" + item.commandId : ""));
    }

    function quickFavoritePaths() {
        try {
            var value = JSON.parse(localStorage.getItem("sirkPlatform.commands.preferences") || "{}");
            return Array.isArray(value.favorites) ? value.favorites.map(String) : [];
        } catch (error) { return []; }
    }

    function quickIsFavorite(item) {
        return quickFavoritePaths().indexOf(quickItemKey(item)) >= 0;
    }

    function quickIcon(name) {
        var icons = {
            bolt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z"/></svg>',
            collapse: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6-6 6 6 6M21 6l-6 6 6 6"/></svg>',
            expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 6 6-6 6M15 6l6 6-6 6"/></svg>',
            star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>',
            details: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16M17 8h2M17 12h2M17 16h2"/></svg>',
            search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg>',
            refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v6h-6M4 18v-6h6"/><path d="M18.5 9A7 7 0 0 0 6 6.5L4 9M5.5 15A7 7 0 0 0 18 17.5l2-2.5"/></svg>',
            close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>'
        };
        return icons[name] || "";
    }

    function quickSetOutput(value, error, completed) {
        quickCommands.output = String(value == null ? "" : value);
        quickCommands.outputError = error === true;
        if (completed && quickCommands.detailsCollapsed) quickCommands.outputAttention = true;
        var status = document.querySelector("#sirkQuickCommandsPanel .sirk-quick-command-status");
        if (status) {
            status.textContent = quickCommands.output;
            status.classList.toggle("is-error", quickCommands.outputError);
        }
        var details = document.querySelector("#sirkQuickCommandsPanel [data-quick-command-details]");
        if (details) details.classList.toggle("has-attention", quickCommands.outputAttention);
    }

    function loadCompactCommands(force) {
        if (quickCommands.data && !force) return Promise.resolve(quickCommands.data);
        var panel = document.getElementById("sirkQuickCommandsPanel");
        if (panel) panel.innerHTML = '<div class="sirk-command-loading">' + esc(t("loadingCommands")) + '</div>';
        return core.api("commands", "scripts").then(function (response) {
            quickCommands.data = { tree: response.tree || { children: [] }, catalog: response.catalog || [] };
            return quickCommands.data;
        });
    }

    function setCompactCommandsConnected(host, connected) {
        var dock = host.querySelector(".sirk-quick-commands-dock");
        if (!dock) return;
        dock.hidden = !connected;
        if (connected) return;
        var panel = dock.querySelector("#sirkQuickCommandsPanel");
        var toggle = dock.querySelector("#sirkQuickCommandsToggle");
        if (panel) panel.hidden = true;
        if (toggle) toggle.setAttribute("aria-expanded", "false");
    }

    function ensureCompactCommands(host) {
        var operation = host.querySelector(".sirk-agent-desktop") || host;
        var desktopStage = operation.querySelector(".sirk-agent-desktop-stage");
        if (!desktopStage || desktopStage.querySelector("#sirkQuickCommandsPanel")) return;
        var dock = document.createElement("div");
        dock.className = "sirk-quick-commands-dock";
        dock.hidden = true;
        var toggle = document.createElement("button");
        toggle.type = "button";
        toggle.id = "sirkQuickCommandsToggle";
        toggle.className = "sirk-quick-commands-toggle sirk-command-icon-button";
        toggle.setAttribute("aria-expanded", "false");
        toggle.title = t("quickCommands");
        toggle.innerHTML = quickIcon("bolt") + '<span>' + esc(t("quickCommands")) + '</span>';
        var panel = document.createElement("aside");
        panel.id = "sirkQuickCommandsPanel";
        panel.className = "sirk-quick-commands-panel";
        panel.hidden = true;
        dock.appendChild(toggle);
        dock.appendChild(panel);
        desktopStage.appendChild(dock);
        toggle.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            var opening = panel.hidden;
            panel.hidden = !opening;
            toggle.setAttribute("aria-expanded", opening ? "true" : "false");
            if (!opening) return;
            loadCompactCommands(false).then(renderCompactCommands).catch(function (error) {
                panel.innerHTML = '<div class="sirk-command-message is-error">' +
                    esc(error.message || String(error)) + '</div>';
            });
        });
    }

    function flattenCommandScripts(node, prefix, output) {
        (node && node.children || []).forEach(function (child) {
            if (child.type === "script") {
                output.push({ kind: "script", path: child.path, label: localized(child, "label") || child.name || child.path, description: localized(child, "description") || "", requiresApproval: child.requiresApproval === true, confirmExecution: child.confirmExecution === true, variables: child.variables || [] });
                return;
            }
            flattenCommandScripts(child, prefix ? prefix + " / " + (localized(child, "label") || child.name) : (localized(child, "label") || child.name), output);
        });
        return output;
    }

    function compactCategories(data) {
        var categories = [];
        (data.tree && data.tree.children || []).forEach(function (root) {
            categories.push({ key: "script:" + root.path, label: localized(root, "label") || root.name || root.path, items: flattenCommandScripts(root, "", []) });
        });
        (data.catalog || []).forEach(function (category) {
            categories.push({
                key: "catalog:" + category.key,
                label: category.title || category.key,
                items: (category.commands || []).map(function (command) {
                    return { kind: "command", commandId: command.id, path: "@command/" + category.key + "/" + command.id, label: command.label || command.id, description: command.description || "", requiresApproval: command.requiresApproval === true, confirmExecution: command.confirmExecution === true, variables: command.variables || [] };
                })
            });
        });
        return categories.filter(function (category) { return category.items.length > 0; });
    }

    function compactVariableForm(host, item) {
        var controls = [];
        if (!(item.variables || []).length) return function () { return {}; };
        host.appendChild((function () { var heading = document.createElement("h4"); heading.textContent = t("variables"); return heading; }()));
        (item.variables || []).forEach(function (variable) {
            var row = document.createElement("label");
            row.className = "sirk-quick-command-field";
            var caption = document.createElement("span");
            var labels = variable.labels || {};
            caption.textContent = (labels[language()] || variable.label || variable.name) + (variable.required ? " *" : "");
            row.appendChild(caption);
            var input;
            if (variable.control === "select") {
                input = document.createElement("select");
                (variable.options || []).forEach(function (choice) {
                    var option = document.createElement("option");
                    option.value = String(choice.value == null ? choice : choice.value);
                    option.textContent = choice.labels && choice.labels[language()] || choice.label || option.value;
                    input.appendChild(option);
                });
            } else {
                input = document.createElement("input");
                input.type = variable.control === "switch" ? "checkbox" : "text";
            }
            if (input.type === "checkbox") input.checked = /^(1|true|yes|tak)$/i.test(String(variable.defaultValue || ""));
            else input.value = String(variable.defaultValue == null ? "" : variable.defaultValue);
            row.appendChild(input);
            host.appendChild(row);
            controls.push({ variable: variable, input: input });
        });
        return function () {
            var values = {};
            controls.forEach(function (entry) { values[entry.variable.name] = entry.input.type === "checkbox" ? entry.input.checked : entry.input.value; });
            return values;
        };
    }

    function pollCompactOutput(item, id, token, attempt) {
        if (token !== quickCommands.pollToken || quickItemKey(item) !== quickItemKey(quickCommands.selected)) return;
        core.api("commands", "output", null, { id: id }).then(function (response) {
            if (token !== quickCommands.pollToken || quickItemKey(item) !== quickItemKey(quickCommands.selected)) return;
            if (response.ready) {
                quickSetOutput(response.output || (response.status ? t("commandCompleted") + " " + response.status : t("commandCompleted")), false, true);
                return;
            }
            if (attempt >= 300) {
                quickSetOutput(t("commandTimeout"), true, true);
                return;
            }
            quickSetOutput(t("waitingOutput"), false, false);
            window.setTimeout(function () { pollCompactOutput(item, id, token, attempt + 1); }, 1000);
        }).catch(function (error) { if (token === quickCommands.pollToken) quickSetOutput(error.message || String(error), true, true); });
    }

    function submitCompactCommand(item, values, button) {
        if (item.confirmExecution === true && !window.confirm(t("confirmCommand") + ' "' + item.label + '"?')) return;
        button.disabled = true;
        quickCommands.pollToken += 1;
        var token = quickCommands.pollToken;
        quickSetOutput(t("submittingCommand"), false, false);
        var payload = { nodeId: String(selectedNode && (selectedNode.id || selectedNode._id) || ""), nodeName: selectedNode && selectedNode.name || "", variableValues: values || {}, confirmedExecution: item.confirmExecution === true, note: "" };
        if (item.kind === "command") payload.commandId = item.commandId;
        else payload.scriptPath = item.path;
        core.post("commands", "execute", payload).then(function (response) {
            var request = response.request || {}, result = request.result || {};
            if (request.status === "pending") {
                quickSetOutput(t("commandPending"), false, true);
                return;
            }
            if (result.id) {
                quickSetOutput(result.output || result.message || t("waitingOutput"), false, false);
                pollCompactOutput(item, result.id, token, 0);
                return;
            }
            quickSetOutput(result.output || result.message || request.status || t("commandSent"), false, true);
        }).catch(function (error) {
            quickSetOutput(t("commandFailed") + " " + (error.message || String(error)), true, true);
        }).then(function () { button.disabled = false; });
    }

    function renderCompactCommands() {
        var panel = document.getElementById("sirkQuickCommandsPanel");
        if (!panel || !quickCommands.data) return;
        var categories = compactCategories(quickCommands.data);
        if (!categories.some(function (category) { return category.key === quickCommands.category; })) quickCommands.category = categories[0] && categories[0].key || "";
        var selectedCategory = categories.find(function (category) { return category.key === quickCommands.category; });
        var query = String(quickCommands.search || "").toLowerCase();
        var items = (selectedCategory && selectedCategory.items || []).filter(function (item) {
            if (quickCommands.favoritesOnly && !quickIsFavorite(item)) return false;
            return !query || (item.label + " " + item.description).toLowerCase().indexOf(query) >= 0;
        });
        var selectedKey = quickItemKey(quickCommands.selected);
        if (selectedKey && !items.some(function (item) { return quickItemKey(item) === selectedKey; })) quickCommands.selected = null;
        var browserClass = "sirk-quick-command-browser sirk-command-layout" + (quickCommands.collapsed ? " is-collapsed" : "") + (quickCommands.detailsCollapsed ? " is-details-collapsed" : "");
        panel.innerHTML = '<header class="sirk-command-toolbar"><div class="sirk-command-toolbar-left">' +
            '<button type="button" class="sirk-command-icon-button" data-quick-command-collapse title="' + esc(quickCommands.collapsed ? t("expandCategories") : t("collapseCategories")) + '">' + quickIcon(quickCommands.collapsed ? "expand" : "collapse") + '</button>' +
            '<button type="button" class="sirk-command-icon-button' + (quickCommands.favoritesOnly ? " is-active" : "") + '" data-quick-command-favorites title="' + esc(t("favorites")) + '">' + quickIcon("star") + '</button>' +
            '<button type="button" class="sirk-command-icon-button' + (quickCommands.detailsCollapsed ? "" : " is-active") + (quickCommands.outputAttention ? " has-attention" : "") + '" data-quick-command-details title="' + esc(quickCommands.detailsCollapsed ? t("showOutput") : t("hideOutput")) + '">' + quickIcon("details") + '</button>' +
            '<label class="sirk-command-search">' + quickIcon("search") + '<input class="sirk-quick-command-search" type="search" placeholder="' + esc(t("searchCommands")) + '" value="' + esc(quickCommands.search) + '"></label></div>' +
            '<div class="sirk-command-toolbar-right"><button type="button" class="sirk-command-icon-button" data-quick-command-refresh title="' + esc(t("refresh")) + '">' + quickIcon("refresh") + '</button>' +
            '<button type="button" class="sirk-command-icon-button" data-quick-command-close title="' + esc(t("close")) + '">' + quickIcon("close") + '</button></div></header>' +
            '<div class="' + browserClass + '"><nav class="sirk-command-primary">' + categories.map(function (category) {
                return '<button type="button" data-quick-command-category="' + esc(category.key) + '" class="' + (category.key === quickCommands.category ? "is-active" : "") + '"><strong>' + esc(category.label) + '</strong></button>';
            }).join("") + '</nav><section class="sirk-command-secondary">' + (items.length ? items.map(function (item, index) {
                return '<button type="button" data-quick-command-item="' + index + '" class="' + (quickItemKey(item) === selectedKey ? "is-active" : "") + '">' + (quickIsFavorite(item) ? '<i class="sirk-command-favorite-mark">★</i>' : '') + '<span><strong>' + esc(item.label) + '</strong>' + (item.description ? '<small>' + esc(item.description) + '</small>' : '') + '</span></button>';
            }).join("") : '<p class="sirk-command-details-empty">' + esc(quickCommands.favoritesOnly ? t("noFavoriteCommands") : t("noCommands")) + '</p>') + '</section>' +
            '<section class="sirk-quick-command-details sirk-command-details"><div class="sirk-quick-command-run"><p class="sirk-command-details-empty">' + esc(t("selectCommand")) + '</p></div><pre class="sirk-quick-command-status" aria-live="polite"></pre></section></div>';
        panel.__items = items;
        if (quickCommands.selected) selectCompactCommand(quickCommands.selected, true);
        else quickSetOutput(quickCommands.output, quickCommands.outputError, false);
    }

    function selectCompactCommand(item, preserveOutput) {
        var panel = document.getElementById("sirkQuickCommandsPanel");
        var runHost = panel && panel.querySelector(".sirk-quick-command-run");
        if (!runHost) return;
        quickCommands.selected = item;
        if (!preserveOutput) {
            quickCommands.output = "";
            quickCommands.outputError = false;
            quickCommands.outputAttention = false;
        }
        Array.prototype.forEach.call(panel.querySelectorAll("[data-quick-command-item]"), function (button) {
            var index = Number(button.getAttribute("data-quick-command-item"));
            button.classList.toggle("is-active", panel.__items && quickItemKey(panel.__items[index]) === quickItemKey(item));
        });
        function show(value) {
            if (quickItemKey(value) !== quickItemKey(quickCommands.selected)) return;
            quickCommands.selected = value;
            runHost.innerHTML = "";
            var heading = document.createElement("h3"); heading.textContent = value.label; runHost.appendChild(heading);
            if (value.description) { var description = document.createElement("p"); description.textContent = value.description; runHost.appendChild(description); }
            var collect = compactVariableForm(runHost, value);
            var run = document.createElement("button"); run.type = "button"; run.className = "sirk-quick-command-submit"; run.textContent = value.requiresApproval ? t("requestCommand") : t("runCommand");
            run.addEventListener("click", function () { submitCompactCommand(value, collect(), run); });
            runHost.appendChild(run);
            quickSetOutput(quickCommands.output, quickCommands.outputError, false);
        }
        if (item.kind !== "script") { show(item); return; }
        core.api("commands", "script", null, { path: item.path }).then(function (response) {
            var script = response.script || item;
            show({ kind: "script", path: script.path, label: localized(script, "label") || script.label || script.name, description: localized(script, "description") || script.description || "", variables: script.variables || [], requiresApproval: script.requiresApproval === true, confirmExecution: script.confirmExecution === true });
        }).catch(function (error) { quickSetOutput(error.message || String(error), true, true); });
    }

    function renderTab(node, type) {
        activeTab = REMOTE_TABS.indexOf(type) >= 0 || type === "commands" ? type : "general";
        var body = document.getElementById("sirkDeviceTabBody");
        if (!body) return;
        Array.prototype.forEach.call(document.querySelectorAll("[data-device-tab]"), function (button) {
            var active = button.getAttribute("data-device-tab") === activeTab;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-selected", active ? "true" : "false");
        });
        if (activeTab === "general") renderGeneral(body, node);
        else if (activeTab === "commands") renderCommandsTab(body, node);
        else if (REMOTE_TABS.indexOf(activeTab) >= 0) renderAgentTab(body, node, activeTab);
    }

    function renderWorkspace(node) {
        if (!content || !node) return;
        selectedNode = node;
        var online = nodeOnline(node);
        content.innerHTML = '<div class="sirk-device-workspace"><header class="sirk-device-compact-header"><button type="button" class="sirk-device-compact-back" data-device-back="1" title="' + esc(t("back")) + '">‹</button><span class="sirk-device-compact-icon" aria-hidden="true">' + DEVICE_ICON + '</span><div class="sirk-device-compact-main"><strong>' + esc(node.name || shortId(node.id)) + '</strong><small>' + esc(nodeGroup(node)) + ' · ' + esc(node.os || t("noOs")) + '</small></div><div class="sirk-device-compact-meta"><span class="sirk-device-connection ' + (online ?"is-online" : "is-offline") + '"><i></i>' + esc(online ? t("online") : t("offline")) + '</span><small>' + esc(node.ip || "—") + '</small></div></header><nav class="sirk-device-tabs" role="tablist">' +
            ["general", "desktop", "terminal", "commands", "files"].map(function (type) {
                return '<button type="button" role="tab" data-device-tab="' + type + '">' + esc(t(type)) + '</button>';
            }).join("") + '</nav><section id="sirkDeviceTabBody" class="sirk-device-tab-body"></section></div>';
        renderTab(node, activeTab);
    }

    function extractNodeId() {
        if (selectedNodeId) return selectedNodeId;
        return "";
    }

    function transformDetail() {
        transformScheduled = false;
        if (!content || content.querySelector(".sirk-device-workspace")) return;
        if (!content.querySelector("[data-sirk-device-detail]")) return;
        var nodeId = extractNodeId();
        if (!nodeId) return;
        getInventory().then(function (value) {
            var node = findNode(value, nodeId);
            if (!node || !content.querySelector("[data-sirk-device-detail]")) return;
            selectedNodeId = String(node.id || node._id || nodeId);
            renderWorkspace(node);
        }).catch(function () {});
    }

    function scheduleTransform() {
        if (transformScheduled) return;
        transformScheduled = true;
        setTimeout(transformDetail, 0);
    }

    document.addEventListener("click", function (event) {
        var row = event.target && event.target.closest && event.target.closest("[data-device-id]");
        if (row) {
            selectedNodeId = row.getAttribute("data-device-id") || "";
            selectedNode = null;
            activeTab = "general";
            scheduleTransform();
            return;
        }
        var tab = event.target && event.target.closest && event.target.closest("[data-device-tab]");
        if (tab && content && content.contains(tab)) {
            event.preventDefault();
            event.stopPropagation();
            renderTab(selectedNode, tab.getAttribute("data-device-tab"));
            return;
        }
        var back = event.target && event.target.closest && event.target.closest("[data-device-back]");
        if (back) {
            selectedNodeId = "";
            selectedNode = null;
            activeTab = "general";
            return;
        }
        var navigation = event.target && event.target.closest && event.target.closest(".sirk-standalone-nav [data-view]");
        if (navigation) {
            selectedNodeId = "";
            selectedNode = null;
            activeTab = "general";
        }
        var quickClose = event.target && event.target.closest && event.target.closest("[data-quick-command-close]");
        if (quickClose) {
            var quickPanel = document.getElementById("sirkQuickCommandsPanel");
            var quickToggle = document.getElementById("sirkQuickCommandsToggle");
            if (quickPanel) quickPanel.hidden = true;
            if (quickToggle) quickToggle.setAttribute("aria-expanded", "false");
            return;
        }
        var quickCollapse = event.target && event.target.closest && event.target.closest("[data-quick-command-collapse]");
        if (quickCollapse) {
            quickCommands.collapsed = !quickCommands.collapsed;
            quickWriteBoolean("sirkPortal.quickCommands.categoriesCollapsed", quickCommands.collapsed);
            renderCompactCommands();
            return;
        }
        var quickFavorites = event.target && event.target.closest && event.target.closest("[data-quick-command-favorites]");
        if (quickFavorites) {
            quickCommands.favoritesOnly = !quickCommands.favoritesOnly;
            quickCommands.selected = null;
            renderCompactCommands();
            return;
        }
        var quickDetails = event.target && event.target.closest && event.target.closest("[data-quick-command-details]");
        if (quickDetails) {
            quickCommands.detailsCollapsed = !quickCommands.detailsCollapsed;
            if (!quickCommands.detailsCollapsed) quickCommands.outputAttention = false;
            quickWriteBoolean("sirkPortal.quickCommands.detailsCollapsed", quickCommands.detailsCollapsed);
            renderCompactCommands();
            return;
        }
        var quickRefresh = event.target && event.target.closest && event.target.closest("[data-quick-command-refresh]");
        if (quickRefresh) {
            quickRefresh.disabled = true;
            loadCompactCommands(true).then(renderCompactCommands).catch(function (error) {
                quickSetOutput(error.message || String(error), true, true);
            }).then(function () { quickRefresh.disabled = false; });
            return;
        }
        var quickCategory = event.target && event.target.closest && event.target.closest("[data-quick-command-category]");
        if (quickCategory) {
            quickCommands.category = quickCategory.getAttribute("data-quick-command-category") || "";
            quickCommands.selected = null;
            quickCommands.output = "";
            quickCommands.outputAttention = false;
            renderCompactCommands();
            return;
        }
        var quickItem = event.target && event.target.closest && event.target.closest("[data-quick-command-item]");
        if (quickItem) {
            var panel = document.getElementById("sirkQuickCommandsPanel");
            var index = Number(quickItem.getAttribute("data-quick-command-item"));
            if (panel && panel.__items && panel.__items[index]) selectCompactCommand(panel.__items[index], false);
        }
    }, true);

    document.addEventListener("input", function (event) {
        if (!event.target || !event.target.classList.contains("sirk-quick-command-search")) return;
        quickCommands.search = event.target.value || "";
        renderCompactCommands();
        var search = document.querySelector("#sirkQuickCommandsPanel .sirk-quick-command-search");
        if (search) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
    }, true);

    window.addEventListener("sirkportal:languagechange", function () {
        if (selectedNode && content && content.querySelector(".sirk-device-workspace")) renderWorkspace(selectedNode);
    });


    if (content) {
        new MutationObserver(scheduleTransform).observe(content, { childList: true, subtree: true });
        scheduleTransform();
    }
}());
