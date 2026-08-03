(function () {
    "use strict";
    window.SirkPlatformRuntime = window.SirkPlatformRuntime || {};
    window.SirkPlatformModules = window.SirkPlatformModules || {};
    var runtime = window.SirkPlatformRuntime;
    var core = window.SirkPlatformCore;
    runtime.state = runtime.state || { bootstrap: null, initializePromise: null, nodeId: "" };
    var files = {
        approvals: "approvals.js",
        "move-requests": "move-requests.js",
        commands: "commands.js",
        jira: "jira.js",
        security: "security.js",
        management: "management.js"
    };
    var order = ["approvals", "move-requests", "commands", "jira", "security", "management"];
    var viewModes = { management: 101, commands: 102, jira: 103, security: 104, approvals: 105, "move-requests": 106 };

    function isCustomView(view) {
        view = Number(view);
        return Object.keys(viewModes).some(function (key) { return viewModes[key] === view; });
    }

    function installCredentialsActions() {
        if (!window.SharedScriptTools || window.__sirkPlatformCredentialsActions) return;
        window.__sirkPlatformCredentialsActions = true;
        var originalCreate = window.SharedScriptTools.create;
        window.SharedScriptTools.create = function (options) {
            var tools = originalCreate.call(window.SharedScriptTools, options);
            var originalActions = tools.scriptActions;
            tools.scriptActions = function (script, config) {
                config = config || {};
                var actions = originalActions.call(tools, script, config) || [];
                var hasCredentials = !!(script && ((Array.isArray(script.secretVariables) && script.secretVariables.length) || (Array.isArray(script.secretDefinitions) && script.secretDefinitions.length)));
                if (hasCredentials && config.canEdit === true && !actions.some(function (action) { return action && action.key === "credentials"; })) {
                    actions.unshift({
                        key: "credentials",
                        icon: "🔑",
                        className: "sirk-tree-credentials-action",
                        title: "Edit script credentials",
                        onClick: function () {
                            if (typeof config.onCredentials === "function") config.onCredentials(script);
                            else if (typeof config.onEdit === "function") config.onEdit(script);
                        }
                    });
                }
                return actions;
            };
            return tools;
        };
    }

    function installCommandsFix(module) {
        if (!module || !module.api || window.__sirkPlatformCommandsUiFix) return;
        window.__sirkPlatformCommandsUiFix = true;

        var commandByLabel = Object.create(null);
        var commandById = Object.create(null);
        var catalogLoaded = false;
        var STORAGE = "sirkPlatform.commands.preferences";
        var TEXT = {
            pl: {
                Results: "Wyniki", Scripts: "Skrypty", Network: "Sieć", System: "System", Other: "Inne",
                "Flush DNS": "Wyczyść DNS", "Check DNS": "Sprawdź DNS", "Check port": "Sprawdź port",
                "Open ports": "Otwarte porty", "Filter by port": "Filtruj po porcie",
                "Open PowerShell": "Otwórz PowerShell", "Open CMD": "Otwórz CMD", "Registry Editor": "Edytor rejestru",
                "Local Security Policy": "Lokalne zasady zabezpieczeń", "Windows Firewall": "Zapora Windows",
                MMC: "MMC", Services: "Usługi", "Device Manager": "Menedżer urządzeń", "Event Viewer": "Podgląd zdarzeń",
                "Task Manager": "Menedżer zadań", "Printer Management": "Zarządzanie drukarkami",
                "Certificates (computer)": "Certyfikaty komputera", "Certificates (user)": "Certyfikaty użytkownika",
                "Indexing Options": "Opcje indeksowania", "Disk Cleanup": "Oczyszczanie dysku"
            },
            en: {}
        };
        var DESCRIPTIONS_PL = {
            flushdns: "Czyści pamięć podręczną klienta DNS.", dns: "Rozwiązuje podaną nazwę DNS.", port: "Testuje port TCP lub UDP.",
            netstat: "Pokazuje porty nasłuchujące i aktywne połączenia.", "netstat-port": "Filtruje wynik netstat według portu.",
            powershell: "Otwiera okno PowerShell dla zalogowanego użytkownika.", cmd: "Otwiera Wiersz polecenia dla zalogowanego użytkownika.",
            regedit: "Otwiera Edytor rejestru.", secpol: "Otwiera lokalne zasady zabezpieczeń.", firewall: "Otwiera zarządzanie Zaporą Windows.",
            mmc: "Otwiera Microsoft Management Console.", services: "Otwiera zarządzanie usługami.", devices: "Otwiera Menedżer urządzeń.",
            events: "Otwiera Podgląd zdarzeń.", taskmgr: "Otwiera Menedżer zadań.", printers: "Otwiera zarządzanie drukarkami.",
            certlm: "Otwiera certyfikaty komputera lokalnego.", certcu: "Otwiera certyfikaty bieżącego użytkownika.",
            indexing: "Otwiera opcje indeksowania.", cleanup: "Otwiera Oczyszczanie dysku."
        };
        var ICONS = {
            flushdns: "<svg viewBox='0 0 24 24'><path d='M4 6h16v12H4z'/><path d='M8 10h8M8 14h5'/><path d='m17 14 2 2 3-4'/></svg>",
            dns: "<svg viewBox='0 0 24 24'><circle cx='12' cy='12' r='9'/><path d='M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18'/></svg>",
            port: "<svg viewBox='0 0 24 24'><path d='M4 5h16v14H4z'/><path d='M8 9h8M8 13h5'/><circle cx='17' cy='15' r='2'/></svg>",
            netstat: "<svg viewBox='0 0 24 24'><path d='M4 18V6M10 18v-8M16 18V4M22 18H2'/></svg>",
            "netstat-port": "<svg viewBox='0 0 24 24'><path d='M4 5h16v14H4z'/><path d='M7 9h10M7 13h6'/><path d='m16 13 3 3'/></svg>",
            powershell: "<svg viewBox='0 0 24 24'><rect x='3' y='4' width='18' height='16' rx='2'/><path d='m7 9 3 3-3 3M12 16h5'/></svg>",
            cmd: "<svg viewBox='0 0 24 24'><rect x='3' y='4' width='18' height='16' rx='2'/><path d='m7 9 3 3-3 3M12 15h4'/></svg>",
            regedit: "<svg viewBox='0 0 24 24'><path d='M5 4h14v16H5z'/><path d='M8 8h8M8 12h8M8 16h5'/></svg>",
            secpol: "<svg viewBox='0 0 24 24'><path d='M12 3 20 6v6c0 5-3 8-8 9-5-1-8-4-8-9V6z'/><path d='m9 12 2 2 4-5'/></svg>",
            firewall: "<svg viewBox='0 0 24 24'><path d='M4 5h16v14H4zM4 10h16M9 5v5M15 10v4M4 14h16M9 14v5'/></svg>",
            mmc: "<svg viewBox='0 0 24 24'><rect x='3' y='4' width='18' height='16' rx='2'/><path d='M7 8h10M7 12h4M7 16h7'/></svg>",
            services: "<svg viewBox='0 0 24 24'><circle cx='12' cy='12' r='3'/><path d='M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2'/></svg>",
            devices: "<svg viewBox='0 0 24 24'><rect x='3' y='4' width='18' height='13' rx='2'/><path d='M8 21h8M12 17v4'/></svg>",
            events: "<svg viewBox='0 0 24 24'><path d='M5 4h14v16H5z'/><path d='M8 8h8M8 12h8M8 16h5'/></svg>",
            taskmgr: "<svg viewBox='0 0 24 24'><path d='M4 18V9M9 18V5M14 18v-7M19 18V3M2 18h20'/></svg>",
            printers: "<svg viewBox='0 0 24 24'><path d='M7 8V3h10v5M7 17H4v-7h16v7h-3'/><path d='M7 14h10v7H7z'/></svg>",
            certlm: "<svg viewBox='0 0 24 24'><path d='M6 3h12v18H6z'/><circle cx='12' cy='10' r='3'/><path d='m10 13-1 4 3-2 3 2-1-4'/></svg>",
            certcu: "<svg viewBox='0 0 24 24'><circle cx='12' cy='8' r='4'/><path d='M4 21c1-5 4-7 8-7s7 2 8 7'/><path d='m16 14 2 2 3-4'/></svg>",
            indexing: "<svg viewBox='0 0 24 24'><circle cx='10' cy='10' r='6'/><path d='m15 15 5 5M8 8h4M8 11h3'/></svg>",
            cleanup: "<svg viewBox='0 0 24 24'><path d='M7 7h10l-1 14H8zM5 7h14M9 7V4h6v3'/><path d='M11 11v6M14 11v6'/></svg>"
        };

        function language() {
            try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
            catch (error) { return "pl"; }
        }
        function tr(value) { return language() === "pl" && TEXT.pl[value] ? TEXT.pl[value] : value; }
        function preferences() {
            try { return JSON.parse(localStorage.getItem(STORAGE) || "{}"); }
            catch (error) { return {}; }
        }
        function savePreferences(value) { try { localStorage.setItem(STORAGE, JSON.stringify(value)); } catch (error) {} }
        function isFavorite(path) { return (preferences().favorites || []).indexOf(path) >= 0; }
        function toggleFavorite(path) {
            var value = preferences(), list = Array.isArray(value.favorites) ? value.favorites.slice() : [], index = list.indexOf(path);
            if (index >= 0) list.splice(index, 1); else list.push(path);
            value.favorites = list; savePreferences(value); return index < 0;
        }
        function buildMaps(response) {
            commandByLabel = Object.create(null); commandById = Object.create(null);
            (response.catalog || []).forEach(function (category) {
                (category.commands || []).forEach(function (command) {
                    var item = Object.assign({}, command, { kind: "command", category: category.key, path: "@command/" + category.key + "/" + command.id });
                    commandByLabel[command.label] = item;
                    commandByLabel[tr(command.label)] = item;
                    commandById[command.id] = item;
                });
            });
            catalogLoaded = true;
        }
        function ensureCatalog() {
            if (catalogLoaded) return Promise.resolve();
            return module.api.api("scripts").then(buildMaps).catch(function () {});
        }
        function currentNode() {
            return module.api.state.nodeId || runtime.state.nodeId || window.selectedNode || "";
        }
        function renderMulti(command) {
            var shell = module.api, host = shell.state.page && shell.state.page.details;
            if (!host) return;
            var devices = window.SharedScriptTools.selectedDevices(currentNode());
            host.innerHTML = "";
            var card = shell.card(language() === "pl" ? "Wykonanie na wielu urządzeniach" : "Multi-device execution", tr(command.label));
            card.classList.add("sirk-multi-editor-card");
            if (!devices.length) {
                card.appendChild(document.createTextNode(language() === "pl" ? "Wybierz urządzenia przed użyciem tej akcji." : "Select devices before using this action."));
                host.appendChild(card); return;
            }
            var variables = [], variableValues = {};
            (command.variables || []).forEach(function (definition) {
                var row = document.createElement("label"), label = document.createElement("span"), input;
                row.className = "sirk-script-form-row"; label.className = "sirk-script-form-label"; label.textContent = definition.label || definition.name; row.appendChild(label);
                if (definition.control === "select") {
                    input = document.createElement("select");
                    (definition.options || []).forEach(function (entry) { var option = document.createElement("option"); option.value = entry.value; option.textContent = entry.label || entry.value; input.appendChild(option); });
                } else if (definition.control === "switch") { input = document.createElement("input"); input.type = "checkbox"; }
                else { input = document.createElement("input"); input.type = "text"; }
                if (definition.control !== "switch") input.value = definition.defaultValue || "";
                row.appendChild(input); card.appendChild(row); variables.push({ definition: definition, input: input });
            });
            var list = document.createElement("div"); list.className = "sirk-multi-device-list";
            devices.forEach(function (device) { var row = document.createElement("label"), box = document.createElement("input"); box.type = "checkbox"; box.checked = true; box.value = device.id; row.appendChild(box); row.appendChild(document.createTextNode(" " + device.name)); list.appendChild(row); });
            card.appendChild(list);
            var run = shell.element("button", "btn btn-primary btn-sm", language() === "pl" ? "Uruchom na wybranych" : "Run on selected devices");
            run.type = "button";
            run.onclick = function () {
                var ids = Array.prototype.map.call(list.querySelectorAll("input:checked"), function (box) { return box.value; });
                if (!ids.length) return;
                variables.forEach(function (item) { variableValues[item.definition.name] = item.definition.control === "switch" ? item.input.checked : item.input.value; });
                run.disabled = true;
                shell.post("multi-execute", { nodeIds: ids, commandId: command.id, label: command.label, variableValues: variableValues, confirmedExecution: true, note: "" })
                    .then(function (response) { card.innerHTML = ""; card.appendChild(document.createTextNode((language() === "pl" ? "Wysłano: " : "Submitted: ") + (response.submitted || 0) + ", " + (language() === "pl" ? "błędy: " : "failed: ") + (response.failed || 0))); })
                    .catch(function (error) { run.disabled = false; shell.error(host, error); });
            };
            card.appendChild(run); host.appendChild(card);
        }
        function actionButton(icon, title, handler, active) {
            var button = document.createElement("button"); button.type = "button"; button.className = "sirk-tree-script-action"; button.textContent = icon; button.title = title; button.setAttribute("aria-label", title); button.classList.toggle("active", active === true);
            button.onclick = function (event) { event.preventDefault(); event.stopPropagation(); handler(button); };
            return button;
        }
        function decorate() {
            var page = document.querySelector('[data-module-preset="commands"]');
            if (!page || !module.api.state.page) return;
            ensureCatalog().then(function () {
                var toolbar = module.api.state.page.toolbar;
                var editMode = !!(toolbar && toolbar.buttons.manage && toolbar.buttons.manage.classList.contains("active"));
                var multiMode = !!(toolbar && toolbar.buttons.multi && toolbar.buttons.multi.classList.contains("active"));
                Array.prototype.forEach.call(page.querySelectorAll(".sirk-tree-root .sirk-tree-label,.sirk-catalog-results .sirk-tree-label"), function (label) { label.textContent = tr(label.textContent); });
                Array.prototype.forEach.call(page.querySelectorAll(".sirk-tree-script-row"), function (row) {
                    var label = row.querySelector(".sirk-tree-script .sirk-tree-label"); if (!label) return;
                    var command = commandById[row.getAttribute("data-command-id")] || commandByLabel[label.textContent];
                    if (!command) return;
                    row.setAttribute("data-command-id", command.id); label.textContent = tr(command.label);
                    var icon = row.querySelector(".sirk-tree-script .sirk-tree-fallback-icon");
                    if (icon && ICONS[command.id]) { icon.innerHTML = ICONS[command.id]; icon.classList.add("sirk-nav-icon"); }
                    var old = row.querySelector(".sirk-command-extra-actions"); if (old) old.remove();
                    if (!editMode && !multiMode) return;
                    var actions = document.createElement("span"); actions.className = "sirk-tree-script-actions sirk-command-extra-actions";
                    if (editMode) actions.appendChild(actionButton("★", isFavorite(command.path) ? (language() === "pl" ? "Usuń z ulubionych" : "Remove from favorites") : (language() === "pl" ? "Dodaj do ulubionych" : "Add to favorites"), function (button) { button.classList.toggle("active", toggleFavorite(command.path)); }, isFavorite(command.path)));
                    if (multiMode) actions.appendChild(actionButton("⟳", language() === "pl" ? "Uruchom na wielu urządzeniach" : "Run on selected devices", function () { renderMulti(command); }));
                    row.appendChild(actions);
                });
                Array.prototype.forEach.call(page.querySelectorAll(".sirk-tree-folder-header .sirk-tree-label"), function (label) { label.textContent = tr(label.textContent); });
                var details = module.api.state.page.details;
                if (details && language() === "pl") {
                    Array.prototype.forEach.call(details.querySelectorAll("h3,.sirk-card>strong"), function (node) { if (node.textContent === "Variables") node.textContent = "Zmienne"; if (node.textContent === "Output") node.textContent = "Wynik"; });
                }
            });
        }
        var observer = new MutationObserver(function () { window.setTimeout(decorate, 0); });
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
        document.addEventListener("click", function (event) { if (event.target && event.target.closest && event.target.closest('[data-action="language"]')) window.setTimeout(decorate, 50); }, true);
        window.setInterval(decorate, 700);
    }

    function notify(method) {
        var args = Array.prototype.slice.call(arguments, 1);
        Object.keys(window.SirkPlatformModules).forEach(function (key) {
            var module = window.SirkPlatformModules[key];
            if (module && typeof module[method] === "function") {
                try { module[method].apply(module, args); }
                catch (error) { if (window.console) console.error("SirkPlatform " + key + " " + method + " failed", error); }
            }
        });
    }

    function configureModule(key, module) {
        if (!module || !module.api || !module.api.definition) return;
        module.api.definition.viewMode = viewModes[key] || module.api.definition.viewMode || 960;
    }

    runtime.initialize = function () {
        if (runtime.state.initializePromise) return runtime.state.initializePromise;
        runtime.state.initializePromise = core.api("", "bootstrap").then(function (bootstrap) {
            runtime.state.bootstrap = bootstrap;
            var chain = core.loadScript("sirk-platform-shared-directory-tree", core.assetUrl("", "shared-ui/tree.js"))
                .then(function () { return core.loadScript("sirk-platform-shared-catalog-view", core.assetUrl("", "shared-ui/catalog.js")); })
                .then(function () { return core.loadScript("sirk-platform-shared-results-view", core.assetUrl("", "shared-ui/results.js")); })
                .then(function () { return core.loadScript("sirk-platform-shared-result-layout", core.assetUrl("", "shared-ui/result-layout.js")); })
                .then(function () { return core.loadScript("sirk-platform-shared-script-tools", core.assetUrl("", "shared-ui/script-tools.js")); })
                .then(function () { return core.loadScript("sirk-platform-shared-script-definition-form", core.assetUrl("", "shared-ui/script-definition-form.js")); })
                .then(function () { return core.loadScript("sirk-platform-shared-confirm-execution-form", core.assetUrl("", "shared-ui/confirm-execution-form.js")); })
                .then(function () { installCredentialsActions(); return core.loadScript("sirk-platform-shared-script-edit-actions", core.assetUrl("", "shared-ui/script-edit-actions.js")); })
                .then(function () { return core.loadScript("sirk-platform-shared-system-credentials-form", core.assetUrl("", "shared-ui/system-credentials-form.js")); });

            order.forEach(function (key) {
                var state = bootstrap.modules[key];
                if (!state || !state.enabled || state.ready === false) return;
                chain = chain.then(function () { return core.loadScript("sirk-platform-module-" + key, core.assetUrl("", files[key])); }).then(function () {
                    var module = window.SirkPlatformModules[key];
                    configureModule(key, module);
                    if (!module || typeof module.initialize !== "function") return null;
                    return Promise.resolve(module.initialize(state)).then(function () {
                        if (key === "commands") installCommandsFix(module);
                        if (runtime.state.nodeId && typeof module.onDeviceRefreshEnd === "function") module.onDeviceRefreshEnd(runtime.state.nodeId);
                    });
                });
            });

            var portal = bootstrap.modules && bootstrap.modules.portal;
            var showLauncher = !!(portal && portal.enabled && portal.ready !== false && portal.config && portal.config.showLauncher === true);
            if (showLauncher) {
                chain = chain.then(function () { return core.loadScript("sirk-platform-native-portal-launcher", core.assetUrl("", "native-portal-launcher.js")); });
            } else {
                var existingLauncher = document.getElementById("sirkPlatformPortalLauncher");
                if (existingLauncher && existingLauncher.parentNode) existingLauncher.parentNode.removeChild(existingLauncher);
            }
            return chain;
        }).catch(function (error) {
            runtime.state.initializePromise = null;
            throw error;
        });
        return runtime.state.initializePromise;
    };

    runtime.onNativePageStart = function (view) {
        if (core.workspaceState && !isCustomView(view)) core.restoreWorkspace();
        notify("onNativePageStart", view);
    };
    runtime.onNativePageEnd = function (view) {
        if (core.workspaceState && !isCustomView(view)) core.restoreWorkspace();
        notify("onNativePageEnd", view);
    };
    runtime.onDeviceRefreshEnd = function (nodeId) { runtime.state.nodeId = String(nodeId || ""); notify("onDeviceRefreshEnd", runtime.state.nodeId); };
    runtime.commandResult = function (message) { notify("commandResult", message); };
}());