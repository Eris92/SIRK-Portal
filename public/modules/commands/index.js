(function () {
    "use strict";

    var sourceTree = null;
    var catalog = [];
    var tree = null;
    var mode = "commands";
    var status = "";
    var treeState = { selectedRoot: "", selectedScript: "", expanded: {} };
    var outputs = Object.create(null);
    var pollSequence = 0;
    var tools = window.SharedScriptTools.create({ storageKey: "sirkPlatform.commands.preferences", deepLinkParameter: "command" });
    tools.restoreTreeState(treeState);

    var PL = {
        Results: "Wyniki", Scripts: "Skrypty", Network: "Sieć", System: "System", Other: "Inne",
        "Open PowerShell": "Otwórz PowerShell", "Open CMD": "Otwórz CMD", "Registry Editor": "Edytor rejestru",
        "Local Security Policy": "Lokalne zasady zabezpieczeń", "Windows Firewall": "Zapora Windows",
        MMC: "MMC", Services: "Usługi", "Device Manager": "Menedżer urządzeń", "Event Viewer": "Podgląd zdarzeń",
        "Task Manager": "Menedżer zadań", "Printer Management": "Zarządzanie drukarkami",
        "Certificates (computer)": "Certyfikaty komputera", "Certificates (user)": "Certyfikaty użytkownika",
        "Indexing Options": "Opcje indeksowania", "Disk Cleanup": "Oczyszczanie dysku",
        "Flush DNS": "Wyczyść DNS", "Check DNS": "Sprawdź DNS", "Check port": "Sprawdź port",
        "Open ports": "Otwarte porty", "Filter by port": "Filtruj po porcie"
    };

    var ICONS = {
        powershell: '<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"/><path d="m8 9 3 3-3 3M13 15h4"/></svg>',
        cmd: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m7 10 3 2-3 2M12 15h5"/></svg>',
        regedit: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/></svg>',
        secpol: '<svg viewBox="0 0 24 24"><path d="M12 3 20 6v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z"/><path d="m9 12 2 2 4-5"/></svg>',
        firewall: '<svg viewBox="0 0 24 24"><path d="M3 5h18v14H3zM3 10h18M8 5v5M16 10v4M8 14v5"/></svg>',
        mmc: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h5M7 16h8"/></svg>',
        services: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19 12h2M3 12h2M12 3v2M12 19v2M17 7l1.5-1.5M5.5 18.5 7 17M17 17l1.5 1.5M5.5 5.5 7 7"/></svg>',
        devices: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
        events: '<svg viewBox="0 0 24 24"><path d="M5 3h14v18H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
        taskmgr: '<svg viewBox="0 0 24 24"><path d="M3 12h4l2-5 4 10 2-5h6"/></svg>',
        printers: '<svg viewBox="0 0 24 24"><path d="M6 9V3h12v6M6 18H4V9h16v9h-2M7 14h10v7H7z"/></svg>',
        certlm: '<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="5"/><path d="m9 14-1 7 4-2 4 2-1-7"/></svg>',
        certcu: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M5 21c1-5 3-7 7-7s6 2 7 7"/></svg>',
        indexing: '<svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M10 7v6M7 10h6"/></svg>',
        cleanup: '<svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/></svg>',
        flushdns: '<svg viewBox="0 0 24 24"><path d="M4 6h16v12H4z"/><path d="M8 10h8M8 14h5M18 3v5M15.5 5.5 18 8l2.5-2.5"/></svg>',
        dns: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>',
        port: '<svg viewBox="0 0 24 24"><path d="M4 8h16v8H4zM8 12h.01M12 12h.01M16 12h.01"/></svg>',
        netstat: '<svg viewBox="0 0 24 24"><path d="M4 17V7M9 17v-5M14 17V4M19 17v-8"/></svg>',
        "netstat-port": '<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4zM8 9h8M8 13h5"/><circle cx="17" cy="16" r="2"/></svg>'
    };

    function language() {
        try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
        catch (error) { return "pl"; }
    }
    function tr(value) { value = String(value == null ? "" : value); return language() === "pl" && PL[value] ? PL[value] : value; }
    function msg(pl, en) { return language() === "pl" ? pl : en; }
    function svgData(svg) { return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ')); }
    function node(shell) { return shell.state.nodeId || window.SirkPlatformRuntime.state.nodeId || window.selectedNode || ""; }
    function stringValue(value) { if (value == null) return ""; if (typeof value === "string") return value; try { return JSON.stringify(value, null, 2); } catch (error) { return String(value); } }
    function isAdmin(shell) { return !!(shell.state.bootstrap && shell.state.bootstrap.access && shell.state.bootstrap.access.siteAdmin); }
    function sync(shell) { tools.syncToolbar(shell.state.page && shell.state.page.toolbar, mode, treeState.selectedScript, { canEdit: isAdmin(shell), enableMulti: true }); }
    function note(shell, title, message, error) { var host = shell.state.page.details; host.innerHTML = ""; var card = shell.card(title, message); if (error) card.classList.add("sirk-error"); host.appendChild(card); sync(shell); }
    function empty(shell) { note(shell, msg("Wynik", "Output"), tools.state.favoritesOnly && !tools.state.favorites.length ? msg("Brak ulubionych poleceń.", "No favorite commands.") : msg("Wybierz polecenie lub skrypt, aby je uruchomić.", "Select a command or script to run it.")); }
    function confirmExecution(item) { if (!item || item.confirmExecution !== true) return true; return window.confirm(msg("Uruchomić teraz: ", "Run now: ") + (item.label || item.name || item.path) + "?"); }
    function commandPath(category, command) { return "@command/" + category.key + "/" + command.id; }

    function buildTree() {
        var children = [{ type: "directory", name: msg("Skrypty", "Scripts"), path: "@menu/scripts", icon: "📁", children: sourceTree && Array.isArray(sourceTree.children) ? sourceTree.children : [] }];
        (catalog || []).forEach(function (category) {
            children.push({
                type: "directory", name: tr(category.title), path: "@menu/" + category.key, icon: category.icon || "▣",
                children: (category.commands || []).map(function (command) {
                    return {
                        type: "script", kind: "command", name: tr(command.label), label: tr(command.label),
                        description: tr(command.description || ""), path: commandPath(category, command), commandId: command.id,
                        variables: command.variables || [], approvalLevels: command.approvalLevels || [],
                        requiresApproval: command.requiresApproval === true, runAsUser: command.runAsUser,
                        confirmExecution: command.confirmExecution === true, multiHost: true,
                        iconData: svgData(ICONS[command.id] || ICONS.mmc), icon: ""
                    };
                })
            });
        });
        return { type: "directory", name: msg("Polecenia", "Commands"), path: "", children: children };
    }

    function valueControls(item, card) {
        var variables = Array.isArray(item.variables) ? item.variables : [], controls = [];
        if (!variables.length) return function () { return {}; };
        var section = document.createElement("div"); section.className = "sirk-script-runtime-variables";
        var heading = document.createElement("h3"); heading.textContent = msg("Zmienne", "Variables"); section.appendChild(heading);
        variables.forEach(function (variable) {
            var row = document.createElement("label"); row.className = "sirk-script-form-row";
            var label = document.createElement("span"); label.className = "sirk-script-form-label"; label.textContent = tr(variable.label || variable.name) + (variable.required ? " *" : ""); row.appendChild(label);
            var input;
            if (variable.control === "switch") { input = document.createElement("input"); input.type = "checkbox"; input.checked = /^(1|true|yes|tak|on)$/i.test(String(variable.defaultValue || "")); }
            else if (variable.control === "select") { input = document.createElement("select"); (variable.options || []).forEach(function (entry) { var option = document.createElement("option"); option.value = String(entry.value == null ? entry : entry.value); option.textContent = tr(String(entry.label || entry.value || entry)); input.appendChild(option); }); input.value = String(variable.defaultValue || ""); }
            else { input = document.createElement("input"); input.type = "text"; input.value = String(variable.defaultValue || ""); }
            input.name = variable.name; row.appendChild(input); section.appendChild(row); controls.push({ variable: variable, input: input });
        });
        card.appendChild(section);
        return function () { var values = {}; controls.forEach(function (entry) { values[entry.variable.name] = entry.variable.control === "switch" ? entry.input.checked : entry.input.value; }); return values; };
    }

    function renderOutput(host, value) { host.innerHTML = ""; if (window.SharedResultsView && typeof window.SharedResultsView.mountResult === "function") { window.SharedResultsView.mountResult(host, value || msg("Brak wyniku.", "No output.")); return; } var pre = document.createElement("pre"); pre.className = "sirk-output"; pre.textContent = stringValue(value) || msg("Brak wyniku.", "No output."); host.appendChild(pre); }
    function renderWaiting(host, value) { host.innerHTML = ""; var pre = document.createElement("pre"); pre.className = "sirk-output"; pre.textContent = value; host.appendChild(pre); }
    function pollOutput(shell, item, responseId, outputHost, sequence, attempt) {
        if (sequence !== pollSequence || treeState.selectedScript !== item.path) return;
        shell.api("output", { id: responseId }).then(function (response) {
            if (sequence !== pollSequence || treeState.selectedScript !== item.path) return;
            if (response.ready) { var value = response.output || (response.status ? msg("Polecenie zakończone: ", "Command completed: ") + response.status : msg("Polecenie zakończone bez wyniku.", "Command completed without output.")); outputs[item.path] = value; renderOutput(outputHost, value); return; }
            if (attempt >= 300) { renderWaiting(outputHost, msg("Przekroczono czas oczekiwania na wynik.", "Command output timeout reached.")); return; }
            renderWaiting(outputHost, msg("Oczekiwanie na wynik agenta…", "Waiting for agent output…"));
            window.setTimeout(function () { pollOutput(shell, item, responseId, outputHost, sequence, attempt + 1); }, 1000);
        }).catch(function (error) { if (sequence === pollSequence) renderWaiting(outputHost, error.message || String(error)); });
    }

    function execute(shell, item, button, values, outputHost) {
        if (!confirmExecution(item)) { renderWaiting(outputHost, msg("Anulowano wykonanie.", "Execution cancelled.")); return; }
        if (button) button.disabled = true;
        outputHost.classList.remove("sirk-error"); renderWaiting(outputHost, msg("Wysyłanie polecenia…", "Submitting command…"));
        var payload = { nodeId: node(shell), nodeName: window.currentNode && window.currentNode.name || "", variableValues: values || {}, confirmedExecution: item.confirmExecution === true, note: "" };
        if (item.kind === "command") payload.commandId = item.commandId; else payload.scriptPath = item.path;
        shell.post("execute", payload).then(function (response) {
            var request = response.request || {}, result = request.result || {};
            if (request.status === "pending") { outputs[item.path] = msg("Oczekiwanie na akceptację.", "Waiting for approval."); renderWaiting(outputHost, outputs[item.path]); return; }
            if (result.id) { var immediate = result.output || result.message || msg("Oczekiwanie na wynik agenta…", "Waiting for agent output…"); outputs[item.path] = immediate; renderWaiting(outputHost, immediate); pollSequence++; pollOutput(shell, item, result.id, outputHost, pollSequence, 0); return; }
            var value = result.output || result.message || request.status || msg("Polecenie wysłane.", "Command submitted."); outputs[item.path] = stringValue(value); renderOutput(outputHost, outputs[item.path]);
        }).catch(function (error) { outputs[item.path] = error.message || String(error); renderWaiting(outputHost, outputs[item.path]); outputHost.classList.add("sirk-error"); }).then(function () { if (button) button.disabled = false; });
    }

    function showDefinition(shell, item, autoExecute) {
        var host = shell.state.page.details; host.innerHTML = "";
        var card = shell.card(item.label || item.name, item.description || item.path); var collectValues = valueControls(item, card);
        var button = shell.element("button", "btn btn-primary", item.requiresApproval ? msg("Poproś o akceptację", "Request") : msg("Uruchom", "Run")); button.type = "button"; card.appendChild(button);
        var outputHost = document.createElement("div"); outputHost.className = "sirk-command-inline-result";
        if (outputs[item.path]) renderOutput(outputHost, outputs[item.path]); else renderWaiting(outputHost, autoExecute ? msg("Uruchamianie…", "Starting…") : msg("Wybierz Uruchom, aby zobaczyć wynik.", "Select Run to see the result."));
        card.appendChild(outputHost); button.onclick = function () { execute(shell, item, button, collectValues(), outputHost); }; host.appendChild(card); sync(shell);
        if (autoExecute === true && (!Array.isArray(item.variables) || item.variables.length === 0)) window.setTimeout(function () { button.click(); }, 0);
    }

    function show(shell, item, executeOnSelect) {
        pollSequence++;
        if (item.kind === "command") { showDefinition(shell, item, executeOnSelect === true); return; }
        shell.api("script", { path: item.path }).then(function (response) { var script = response.script; showDefinition(shell, script, executeOnSelect === true && (!Array.isArray(script.variables) || script.variables.length === 0)); }).catch(function (error) { shell.error(shell.state.page.details, error); });
    }

    function multi(shell, item) {
        if (!confirmExecution(item)) return;
        treeState.selectedScript = item.path;
        tools.openMultiExecution(shell, item, node(shell), function (ids) {
            var payload = { nodeIds: ids, label: item.label || item.name, variableValues: {}, confirmedExecution: item.confirmExecution === true, note: "" };
            if (item.kind === "command") payload.commandId = item.commandId; else payload.scriptPath = item.path;
            return shell.post("multi-execute", payload).then(function (response) {
                note(shell, msg("Wynik Multi", "Multi-device result"), JSON.stringify({ total: response.total, submitted: response.submitted, pending: response.pending, failed: response.failed }, null, 2), response.failed > 0);
                return response;
            });
        });
    }

    function actions(shell, item) {
        return tools.scriptActions(item, {
            canEdit: isAdmin(shell) && item.kind !== "command",
            enableMulti: item.kind === "command" || item.multiHost === true,
            onEdit: function (script) { treeState.selectedScript = script.path; tools.openDefinitionEditor(shell, script, function (result) { if (result && result.tree) sourceTree = result.tree; tree = buildTree(); tools.state.editMode = false; shell.render(); }); },
            onCredentials: function (script) { treeState.selectedScript = script.path; tools.openCredentialsEditor(shell, script, function () { note(shell, msg("Dane logowania zapisane", "Credentials saved"), msg("Zaszyfrowane dane zostały zaktualizowane.", "Encrypted credentials were updated.")); }); },
            onMulti: function (script) { multi(shell, script); },
            onFavoriteChanged: function (script) { if (tools.state.favoritesOnly && !tools.isFavorite(script.path)) treeState.selectedScript = ""; shell.render(); },
            onLinkCopied: function () {}
        });
    }

    function filterItem(item) { return tools.filterScript(item); }
    function primary(shell, treeHost) {
        if (!window.SharedCatalogView || typeof window.SharedCatalogView.mount !== "function") throw new Error("Commands catalog dependency is unavailable.");
        window.SharedCatalogView.mount({
            primaryContainer: shell.state.page.primary, treeContainer: treeHost, tree: tree, state: treeState, search: shell.state.search,
            resultsActive: mode === "results", emptyText: tools.state.favoritesOnly ? msg("Brak ulubionych poleceń.", "No favorite commands found.") : msg("Nie znaleziono poleceń.", "No commands found."),
            filterScript: filterItem, scriptActions: function (item) { return actions(shell, item); },
            onResults: function () { mode = "results"; treeState.selectedScript = ""; shell.render(); },
            onRootSelect: function () { mode = "commands"; treeState.selectedScript = ""; tools.saveTreeState(treeState); window.setTimeout(shell.render, 0); },
            onScript: function (item) { mode = "commands"; show(shell, item, true); }
        });
        var resultsLabel = shell.state.page.primary.querySelector(".sirk-catalog-results .sirk-tree-label"); if (resultsLabel) resultsLabel.textContent = msg("Wyniki", "Results");
    }

    function results(shell) {
        primary(shell, document.createElement("div"));
        window.SharedResultsView.mountStatus(shell.state.page.secondary, { selected: status, onSelect: function (value) { status = value; shell.render(); } }); sync(shell);
        return shell.api("results", { status: status, q: shell.state.search, page: 1, perPage: 200 }).then(function (response) { window.SharedResultsView.mountTable(shell.state.page.details, { title: msg("Wyniki poleceń", "Command results"), kind: "commands", rows: response.rows || [], emptyText: msg("Brak wyników dla wybranego statusu.", "No command results match the selected status.") }); sync(shell); });
    }
    function commands(shell) { primary(shell, shell.state.page.secondary); if (!treeState.selectedScript) { empty(shell); return; } var item = window.SharedDirectoryTree.find(tree, treeState.selectedScript); if (item && filterItem(item)) show(shell, item, false); else { treeState.selectedScript = ""; empty(shell); } }
    function refresh(shell) { var toolbar = shell.state.page && shell.state.page.toolbar; if (toolbar) toolbar.setEnabled("refresh", false); shell.post("refresh", {}).then(function (response) { sourceTree = response.tree || sourceTree; catalog = response.catalog || catalog; tree = buildTree(); if (treeState.selectedScript && !window.SharedDirectoryTree.find(tree, treeState.selectedScript)) treeState.selectedScript = ""; shell.render(); }).catch(function (error) { note(shell, msg("Odświeżanie nie powiodło się", "Refresh failed"), error.message || String(error), true); }).then(function () { if (toolbar) toolbar.setEnabled("refresh", true); }); }

    var module = window.SirkPlatformModuleShell.create({
        key: "commands", title: "Commands", menuTitle: "Commands", showInMenu: false, order: 150, preset: "commands",
        deviceTab: { title: "Commands", pageId: "sirk-platform-commands-device-page", topTabId: "MainDevSirkPlatform-Commands" },
        buttons: {
            collapse: { side: "left", order: 10 },
            favorites: { side: "left", order: 20, onClick: function (toolbar) { tools.toggleFavorites(toolbar, function () { treeState.selectedScript = ""; module.api.render(); }); } },
            link: false,
            manage: { title: "Edit", side: "left", order: 40, onClick: function (toolbar) { tools.toggleEdit(toolbar, module.api.render); } },
            refresh: { side: "left", order: 50, onClick: function () { refresh(module.api); } },
            multi: { title: "Multi-device execution", side: "left", order: 60, onClick: function (toolbar) { tools.toggleMulti(toolbar, module.api.render); } },
            search: { side: "left", order: 70 }, clear: false, settings: false
        },
        tabs: [], defaultTab: "commands",
        render: function (shell) { return shell.api("scripts").then(function (response) { sourceTree = response.tree; catalog = response.catalog || []; tree = buildTree(); tools.applyDeepLink(tree, treeState); return mode === "results" ? results(shell) : commands(shell); }); }
    });

    module.mountDeviceCommands = function (host, nodeId) { mode = "commands"; status = ""; if (typeof module.onDeviceRefreshEnd === "function") module.onDeviceRefreshEnd(String(nodeId || "")); return module.mount(host, "sirk-device-commands"); };
    window.addEventListener("storage", function (event) { if (event.key === "sirkPortal.language" && module && module.api) module.api.render(); });
    window.SirkPlatformModules.commands = module;
}());
