
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
    var quickCommands = { data: null, category: "", selected: null, search: "" };
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
            commandSent: "Polecenie zostało wysłane.", commandPending: "Polecenie oczekuje na akceptację.", commandFailed: "Nie udało się wysłać polecenia.", confirmCommand: "Uruchomić polecenie"
        },
        en: {
            general: "Overview", desktop: "Desktop", terminal: "Terminal", commands: "Commands", files: "Files",
            registry: "Registry", software: "Software", amt: "Intel AMT",
            back: "Back to devices", online: "Online", offline: "Offline",
            name: "Name", status: "Status", group: "Group", system: "Operating system",
            ip: "IP address", lastSeen: "Last seen", agent: "Agent version", nodeId: "Node ID",
            quickCommands: "Quick commands", close: "Close", loadingCommands: "Loading commands…", noCommands: "No commands.",
            searchCommands: "Search commands…", variables: "Variables", runCommand: "Run", requestCommand: "Request",
            commandSent: "Command submitted.", commandPending: "Command is waiting for approval.", commandFailed: "Command could not be submitted.", confirmCommand: "Run command"
        }
    };

    function language() {
        try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
        catch (error) { return document.documentElement.lang === "en" ? "en" : "pl"; }
    }

    function t(key) { return TEXT[language()][key] || key; }

    function commandModule() {
        return window.SirkPlatformModules && window.SirkPlatformModules.mycommands || null;
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
        if (inventory) return Promise.resolve(inventory);
        return fetch("/api/devices", { credentials: "same-origin", cache: "no-store" }).then(function (response) { return response.json().then(function (value) { if (!response.ok || value.ok === false) throw new Error(value.error || "Device inventory unavailable."); return value.value || value; }); }).then(function (value) {
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

    function agentOperationUrl(action, parameters) {
        var endpoint = new URL("/api/agent-operations", window.location.href);
        Object.keys(parameters || {}).forEach(function (key) {
            endpoint.searchParams.set(key, parameters[key]);
        });
        return endpoint.href;
    }

    function waitForAgentOperation(node, commandId, status) {
        var deadline = Date.now() + 150000;
        return new Promise(function (resolve, reject) {
            function poll() {
                var endpoint = agentOperationUrl("agent-operation-status", {
                    tenantId: node.tenantId,
                    deviceId: node.deviceId,
                    commandId: commandId
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
                        setTimeout(poll, 1500);
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
        host.innerHTML = '<div class="sirk-agent-operation sirk-agent-desktop"><header><strong>Pulpit SIRK Agent</strong><small>Bezpieczny broker aktywnej sesji użytkownika</small></header><div class="sirk-agent-desktop-stage"><img data-agent-desktop-image alt="Zdalny pulpit"></div><pre data-agent-operation-status>Łączenie z sesją użytkownika…</pre></div>';
        var image = host.querySelector("[data-agent-desktop-image]");
        var status = host.querySelector("[data-agent-operation-status]");
        var nativeWidth = 0, nativeHeight = 0;
        function snapshot() {
            if (stopped || !host.isConnected) return;
            runAgentOperation(node, "desktop.snapshot", {}, status).then(function (value) {
                if (stopped || !host.isConnected) return;
                var data = value.result && value.result.data;
                if (value.status === "failed" || !data || !data.imageBase64) {
                    throw new Error(value.result && (value.result.output || value.result.code) || "Brak obrazu.");
                }
                nativeWidth = Number(data.width || 0);
                nativeHeight = Number(data.height || 0);
                image.src = "data:image/jpeg;base64," + data.imageBase64;
                status.textContent = "Połączono · " + nativeWidth + " × " + nativeHeight;
                status.classList.remove("is-error");
                setTimeout(snapshot, 150);
            }).catch(function (error) {
                if (stopped || !host.isConnected) return;
                status.textContent = error.message || String(error);
                status.classList.add("is-error");
                setTimeout(snapshot, 3000);
            });
        }
        image.addEventListener("click", function (event) {
            if (!nativeWidth || !nativeHeight) return;
            var bounds = image.getBoundingClientRect();
            var x = Math.round((event.clientX - bounds.left) / bounds.width * nativeWidth);
            var y = Math.round((event.clientY - bounds.top) / bounds.height * nativeHeight);
            agentOperation(node, "desktop.input", { action: event.detail > 1 ? "doubleClick" : "click", x: x, y: y })
                .catch(function (error) { status.textContent = error.message || String(error); status.classList.add("is-error"); });
        });
        image.addEventListener("contextmenu", function (event) {
            event.preventDefault();
            if (!nativeWidth || !nativeHeight) return;
            var bounds = image.getBoundingClientRect();
            agentOperation(node, "desktop.input", {
                action: "rightClick",
                x: Math.round((event.clientX - bounds.left) / bounds.width * nativeWidth),
                y: Math.round((event.clientY - bounds.top) / bounds.height * nativeHeight)
            }).catch(function (error) { status.textContent = error.message || String(error); status.classList.add("is-error"); });
        });
        var observer = new MutationObserver(function () {
            if (!host.isConnected) { stopped = true; observer.disconnect(); }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        snapshot();
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
            host.innerHTML = '<div class="sirk-device-command-error">' + esc(t("noCommands")) + '</div>';
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
                    return { kind: "command", commandId: command.id, label: command.label || command.id, description: command.description || "", requiresApproval: command.requiresApproval === true, confirmExecution: command.confirmExecution === true, variables: command.variables || [] };
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

    function submitCompactCommand(item, values, button, status) {
        if (item.confirmExecution === true && !window.confirm(t("confirmCommand") + ' "' + item.label + '"?')) return;
        button.disabled = true;
        status.textContent = t("loadingCommands");
        var payload = { nodeId: String(selectedNode && (selectedNode.id || selectedNode._id) || ""), nodeName: selectedNode && selectedNode.name || "", variableValues: values || {}, confirmedExecution: item.confirmExecution === true, note: "" };
        if (item.kind === "command") payload.commandId = item.commandId;
        else payload.scriptPath = item.path;
        core.post("mycommands", "execute", payload).then(function (response) {
            status.textContent = response.request && response.request.status === "pending" ? t("commandPending") : t("commandSent");
            status.classList.remove("is-error");
        }).catch(function (error) {
            status.textContent = t("commandFailed") + " " + (error.message || String(error));
            status.classList.add("is-error");
        }).then(function () { button.disabled = false; });
    }

    function renderCompactCommands() {
        var panel = document.getElementById("sirkQuickCommandsPanel");
        if (!panel || !quickCommands.data) return;
        var categories = compactCategories(quickCommands.data);
        if (!categories.some(function (category) { return category.key === quickCommands.category; })) quickCommands.category = categories[0] && categories[0].key || "";
        var selectedCategory = categories.find(function (category) { return category.key === quickCommands.category; });
        var query = String(quickCommands.search || "").toLowerCase();
        var items = (selectedCategory && selectedCategory.items || []).filter(function (item) { return !query || (item.label + " " + item.description).toLowerCase().indexOf(query) >= 0; });
        panel.innerHTML = '<header><strong>' + esc(t("quickCommands")) + '</strong><button type="button" data-quick-command-close="1" title="' + esc(t("close")) + '">×</button></header><input class="sirk-quick-command-search" type="search" placeholder="' + esc(t("searchCommands")) + '" value="' + esc(quickCommands.search) + '"><div class="sirk-quick-command-browser"><nav>' + categories.map(function (category) { return '<button type="button" data-quick-command-category="' + esc(category.key) + '" class="' + (category.key === quickCommands.category ?"is-active" : "") + '">' + esc(category.label) + '</button>'; }).join("") + '</nav><section>' + (items.length ? items.map(function (item, index) { return '<button type="button" data-quick-command-item="' + index + '"><strong>' + esc(item.label) + '</strong>' + (item.description ? '<small>' + esc(item.description) + '</small>' : '') + '</button>'; }).join("") : '<p>' + esc(t("noCommands")) + '</p>') + '</section></div><div class="sirk-quick-command-run"></div><div class="sirk-quick-command-status" aria-live="polite"></div>';
        panel.__items = items;
    }

    function selectCompactCommand(item) {
        var runHost = document.querySelector("#sirkQuickCommandsPanel .sirk-quick-command-run");
        var status = document.querySelector("#sirkQuickCommandsPanel .sirk-quick-command-status");
        if (!runHost || !status) return;
        function show(value) {
            runHost.innerHTML = "";
            var heading = document.createElement("h3"); heading.textContent = value.label; runHost.appendChild(heading);
            if (value.description) { var description = document.createElement("p"); description.textContent = value.description; runHost.appendChild(description); }
            var collect = compactVariableForm(runHost, value);
            var run = document.createElement("button"); run.type = "button"; run.className = "sirk-quick-command-submit"; run.textContent = value.requiresApproval ? t("requestCommand") : t("runCommand");
            run.addEventListener("click", function () { submitCompactCommand(value, collect(), run, status); });
            runHost.appendChild(run);
        }
        if (item.kind !== "script") { show(item); return; }
        core.api("mycommands", "script", null, { path: item.path }).then(function (response) {
            var script = response.script || item;
            show({ kind: "script", path: script.path, label: localized(script, "label") || script.label || script.name, description: localized(script, "description") || script.description || "", variables: script.variables || [], requiresApproval: script.requiresApproval === true, confirmExecution: script.confirmExecution === true });
        }).catch(function (error) { status.textContent = error.message || String(error); status.classList.add("is-error"); });
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
        var quickCategory = event.target && event.target.closest && event.target.closest("[data-quick-command-category]");
        if (quickCategory) {
            quickCommands.category = quickCategory.getAttribute("data-quick-command-category") || "";
            renderCompactCommands();
            return;
        }
        var quickItem = event.target && event.target.closest && event.target.closest("[data-quick-command-item]");
        if (quickItem) {
            var panel = document.getElementById("sirkQuickCommandsPanel");
            var index = Number(quickItem.getAttribute("data-quick-command-item"));
            if (panel && panel.__items && panel.__items[index]) selectCompactCommand(panel.__items[index]);
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
