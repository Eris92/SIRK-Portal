(function () {
    "use strict";

    var state = {
        snapshot: null,
        active: "settings",
        settingsKey: "module:devices:general",
        serverKey: "service",
        debugKey: "config",
        pluginView: "installed",
        plugins: [],
        marketplace: [],
        identity: null,
        csrfToken: "",
        search: "",
        resumeMessage: ""
    };
    var SERVICE_RESTART_KEY = "sirkPortal.serviceRestartState";

    var MODULES = [
        { key: "devices", label: "Urządzenia", view: "devices" },
        { key: "commands", label: "Commands", modules: ["mycommands"] },
        { key: "approvals", label: "Akceptacje", view: "approvals", modules: ["approvalcenter", "moverequests"] },
        { key: "automation", label: "Automatyzacja", view: "automation", modules: ["myscripts"] },
        { key: "monitoring", label: "Monitoring", view: "monitoring", integrations: true },
        { key: "assets", label: "Zasoby", view: "assets", modules: ["myjira"] },
        { key: "management", label: "Zarządzanie", view: "management" },
        { key: "reports", label: "Raporty", view: "reports" },
        { key: "security", label: "Bezpieczeństwo", view: "security", modules: ["defendertools"] }
    ];

    var DEFAULT_VIEW_CHOICES = [
        ["overview", "Overview"], ["devices", "Urządzenia"], ["approvals", "Akceptacje"],
        ["automation", "Automatyzacja"], ["monitoring", "Monitoring"], ["assets", "Zasoby"],
        ["management", "Zarządzanie"], ["reports", "Raporty"], ["security", "Bezpieczeństwo"]
    ];

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
    function clone(value) { return JSON.parse(JSON.stringify(value == null ? {} : value)); }
    function csrfToken() {
        var runtime = window.SirkPlatformRuntime && window.SirkPlatformRuntime.state;
        return state.csrfToken || runtime && runtime.bootstrap && runtime.bootstrap.csrfToken || "";
    }

    function serviceRestartState() {
        try {
            var value = JSON.parse(sessionStorage.getItem(SERVICE_RESTART_KEY) || "null");
            return value && typeof value === "object" ? value : null;
        } catch (error) { return null; }
    }

    function saveServiceRestartState(value) {
        try { sessionStorage.setItem(SERVICE_RESTART_KEY, JSON.stringify(value)); } catch (error) {}
    }

    function clearServiceRestartState() {
        try { sessionStorage.removeItem(SERVICE_RESTART_KEY); } catch (error) {}
    }

    function restartScreen(host) {
        host.innerHTML = '<div class="sirk-restart-screen" role="status" aria-live="polite"><div class="sirk-restart-spinner" aria-hidden="true"></div><h2>Ładowanie usługi…</h2><p>Portal czeka na powrót usługi.</p></div>';
    }

    function waitForService(host, marker) {
        restartScreen(host);
        var started = Date.now();
        function poll() {
            if (Date.now() - started < 4500) { window.setTimeout(poll, 800); return; }
            get("server-state").then(function () {
                saveServiceRestartState({ completed: true, active: "server" });
                window.location.reload();
            }).catch(function () {
                if (Date.now() - started > 120000) {
                    host.innerHTML = '<div class="sirk-card" data-error="1">Nie udało się potwierdzić powrotu usługi. Odśwież stronę, aby spróbować ponownie.</div>';
                    return;
                }
                window.setTimeout(poll, 1200);
            });
        }
        poll();
    }

    function apiUrl(action, extra) {
        var url = new URL(action === "portal-admin-snapshot" ? "/api/admin/settings" : "/api/admin/runtime", window.location.href);
        if (action) url.searchParams.set("action", action);
        Object.keys(extra || {}).forEach(function (key) { url.searchParams.set(key, extra[key]); });
        return url.href;
    }

    function parse(response) {
        return response.text().then(function (text) {
            var value;
            try { value = JSON.parse(text || "{}"); }
            catch (error) { throw new Error(text || ("HTTP " + response.status)); }
            if (!response.ok || value.ok === false) throw new Error(value.error || ("HTTP " + response.status));
            return value;
        });
    }

    function get(action, extra) {
        return fetch(apiUrl(action, extra), {
            credentials: "same-origin",
            cache: "no-store",
            headers: { Accept: "application/json" }
        }).then(parse).then(function (value) {
            return action === "portal-admin-snapshot" && value.value ? { snapshot: value.value } : value;
        });
    }

    function identityRequest(action, payload) {
        if (!action) {
            return fetch(new URL("/api/admin/identity", window.location.href).href, {
                credentials: "same-origin",
                cache: "no-store",
                headers: { "Accept": "application/json" }
            }).then(parse);
        }
        function send() {
            return fetch(new URL("/api/admin/identity", window.location.href).href, {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "Content-Type": "application/json; charset=UTF-8",
                    "Accept": "application/json",
                    "X-SIRK-CSRF": state.csrfToken
                },
                body: JSON.stringify(Object.assign({ action: action }, payload || {}))
            }).then(parse);
        }
        if (state.csrfToken) return send();
        return fetch(new URL("/api/bootstrap", window.location.href).href, {
            credentials: "same-origin",
            cache: "no-store",
            headers: { "Accept": "application/json" }
        }).then(parse).then(function (value) {
            state.csrfToken = String(value.csrfToken || "");
            return send();
        });
    }

    function post(action, payload) {
        var body = new URLSearchParams();
        body.set("payload", JSON.stringify(payload || {}));
        return fetch(apiUrl(action), {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-SIRK-CSRF": csrfToken() },
            body: body.toString()
        }).then(parse);
    }

    function postSettings(payload) {
        var body = new URLSearchParams();
        var standalonePayload = clone(payload || {});
        standalonePayload.modules = clone(payload && payload.modules || {});
        standalonePayload.moduleOptions = clone(payload && payload.moduleOptions || {});
        standalonePayload.portal = clone(standalonePayload.moduleOptions.portal || {});
        body.set("payload", JSON.stringify(standalonePayload));
        return fetch(new URL("/api/admin/settings", window.location.href).href, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-SIRK-CSRF": csrfToken() },
            body: body.toString()
        }).then(parse).then(function (value) { return { snapshot: value.value || value.snapshot || value }; });
    }

    function status(host, text, error) {
        host.textContent = text || "";
        host.setAttribute("data-error", error ? "1" : "0");
    }

    function applySearch(details) {
        var query = String(state.search || "").trim().toLowerCase();
        Array.prototype.forEach.call(details.querySelectorAll("[data-search-item]"), function (item) {
            item.hidden = !!query && String(item.textContent || "").toLowerCase().indexOf(query) < 0;
        });
    }

    function draftPayload() {
        var snapshot = state.snapshot || {};
        var payload = {
            modules: {},
            moduleOptions: clone(snapshot.moduleSettings || {}),
            integrations: clone(snapshot.integrations && snapshot.integrations.values || {}),
            secrets: {}
        };
        (snapshot.modules || []).forEach(function (module) { payload.modules[module.key] = module.enabled === true; });
        return payload;
    }

    function field(host, label, value, onChange, options) {
        options = options || {};
        var wrapper = el("label", "sirk-card");
        wrapper.setAttribute("data-search-item", "1");
        wrapper.setAttribute("data-settings-field", options.type === "boolean" ? "boolean" : "value");
        var copy = el("span");
        copy.setAttribute("data-settings-field-copy", "1");
        copy.appendChild(el("strong", "", label));
        if (options.description) copy.appendChild(el("small", "", options.description));
        wrapper.appendChild(copy);
        var input;
        if (options.type === "boolean") {
            input = el("input");
            input.type = "checkbox";
            input.checked = value === true;
            input.onchange = function () { onChange(input.checked); };
        } else if (options.choices) {
            input = el("select");
            options.choices.forEach(function (choice) {
                var option = el("option", "", choice[1]);
                option.value = choice[0];
                option.selected = String(value == null ? "" : value) === String(choice[0]);
                input.appendChild(option);
            });
            input.onchange = function () { onChange(input.value); };
        } else {
            input = el(options.multiline ? "textarea" : "input");
            if (!options.multiline) input.type = options.type || (typeof value === "number" ? "number" : "text");
            input.value = value == null ? "" : value;
            input.oninput = function () { onChange(input.type === "number" ? Number(input.value) : input.value); };
        }
        input.setAttribute("data-settings-input", "1");
        wrapper.appendChild(input);
        host.appendChild(wrapper);
        return input;
    }

    function objectForm(host, object, depth) {
        object = object && typeof object === "object" && !Array.isArray(object) ? object : {};
        Object.keys(object).sort().forEach(function (key) {
            var value = object[key];
            var title = key.replace(/([A-Z])/g, " $1").replace(/^./, function (c) { return c.toUpperCase(); });
            if (value && typeof value === "object" && !Array.isArray(value)) {
                var section = el("details", "sirk-card");
                section.setAttribute("data-settings-section", "1");
                section.setAttribute("data-search-item", "1");
                section.appendChild(el("summary", "", title));
                var body = el("div");
                body.setAttribute("data-settings-section-body", "1");
                objectForm(body, value, depth + 1);
                section.appendChild(body);
                host.appendChild(section);
            } else if (Array.isArray(value)) {
                field(host, title, value.join(", "), function (next) {
                    object[key] = String(next || "").split(",").map(function (item) { return item.trim(); }).filter(Boolean);
                }, { description: "Wartości rozdzielone przecinkami." });
            } else {
                field(host, title, value, function (next) { object[key] = next; }, { type: typeof value === "boolean" ? "boolean" : undefined });
            }
        });
        if (!Object.keys(object).length && depth === 0) host.appendChild(el("div", "sirk-card", "Brak ustawień w tej sekcji."));
    }

    function navButton(host, key, label, activeKey, onSelect, className) {
        var button = el("button", (className || "sirk-nav-item") + (key === activeKey ? " active" : ""), label);
        button.type = "button";
        button.onclick = function () { onSelect(key); };
        host.appendChild(button);
        return button;
    }

    function navGroup(host, label, open) {
        var group = el("details", "sirk-settings-nav-group");
        group.open = open === true;
        group.appendChild(el("summary", "", label));
        var body = el("div", "sirk-settings-nav-group-body");
        group.appendChild(body);
        host.appendChild(group);
        return body;
    }

    function findModule(key) {
        return MODULES.find(function (item) { return item.key === key; }) || MODULES[0];
    }

    function selectedSettingsParts() {
        var parts = String(state.settingsKey || "module:devices:general").split(":");
        return { kind: parts[0], key: parts[1] || "devices", section: parts[2] || "general" };
    }

    function renderSettingsNavigation(layout, secondary, details) {
        var selected = selectedSettingsParts();
        var modulesBody = navGroup(secondary, "Moduły", selected.kind === "module");
        MODULES.forEach(function (definition) {
            var moduleOpen = selected.kind === "module" && selected.key === definition.key;
            var moduleBody = navGroup(modulesBody, definition.label, moduleOpen);
            navButton(moduleBody, "module:" + definition.key + ":general", "Ogólne", state.settingsKey, function (key) {
                state.settingsKey = key;
                renderActive(layout, secondary, details);
            }, "sirk-nav-item sirk-settings-nav-leaf");
            navButton(moduleBody, "module:" + definition.key + ":permissions", "Permissions", state.settingsKey, function (key) {
                state.settingsKey = key;
                renderActive(layout, secondary, details);
            }, "sirk-nav-item sirk-settings-nav-leaf");
        });
        var portalBody = navGroup(secondary, "Portal", selected.kind === "portal");
        navButton(portalBody, "portal:visibility", "Widoczność", state.settingsKey, function (key) {
            state.settingsKey = key;
            renderActive(layout, secondary, details);
        }, "sirk-nav-item sirk-settings-nav-leaf");
    }

    function moduleCard(host, payload, moduleKey, title) {
        var section = el("details", "sirk-card");
        section.open = true;
        section.setAttribute("data-settings-section", "1");
        section.setAttribute("data-search-item", "1");
        section.appendChild(el("summary", "", title || moduleKey));
        var body = el("div");
        body.setAttribute("data-settings-section-body", "1");
        var value = clone(payload.moduleOptions[moduleKey] || {});
        var permissions = value.folderPermissions;
        var enabled = payload.modules[moduleKey] === true;
        field(body, "Enabled", enabled, function (next) { payload.modules[moduleKey] = next; }, { type: "boolean" });
        delete value.enabled;
        delete value.folderPermissions;
        payload.moduleOptions[moduleKey] = value;
        objectForm(body, value, 0);
        if (permissions !== undefined) value.folderPermissions = permissions;
        section.appendChild(body);
        host.appendChild(section);
    }

    function renderModuleGeneral(host, payload, definition) {
        var portal = payload.moduleOptions.portal = clone(payload.moduleOptions.portal || {});
        portal.views = portal.views || {};
        if (definition.view) {
            var view = portal.views[definition.view] || {};
            field(host, "Widoczność zakładki", view.enabled !== false, function (next) {
                portal.views[definition.view] = Object.assign({}, view, { enabled: next });
            }, { type: "boolean", description: "Pokazuje lub ukrywa zakładkę " + definition.label + " w Portalu." });
        }
        (definition.modules || []).forEach(function (moduleKey) {
            moduleCard(host, payload, moduleKey, moduleKey);
        });
        if (definition.integrations) {
            var integrationSection = el("details", "sirk-card");
            integrationSection.open = true;
            integrationSection.setAttribute("data-settings-section", "1");
            integrationSection.setAttribute("data-search-item", "1");
            integrationSection.appendChild(el("summary", "", "Integracje"));
            var integrationBody = el("div");
            integrationBody.setAttribute("data-settings-section-body", "1");
            objectForm(integrationBody, payload.integrations, 0);
            integrationSection.appendChild(integrationBody);
            host.appendChild(integrationSection);
        }
        if (!(definition.modules || []).length && !definition.integrations && !definition.view) {
            host.appendChild(el("div", "sirk-card", "Brak ustawień ogólnych dla tego modułu."));
        }
    }

    function renderModulePermissions(host, payload, definition) {
        var rendered = false;
        (definition.modules || []).forEach(function (moduleKey) {
            var value = payload.moduleOptions[moduleKey] = clone(payload.moduleOptions[moduleKey] || {});
            if (!value.folderPermissions || typeof value.folderPermissions !== "object") value.folderPermissions = {};
            var section = el("details", "sirk-card");
            section.open = true;
            section.setAttribute("data-settings-section", "1");
            section.setAttribute("data-search-item", "1");
            section.appendChild(el("summary", "", moduleKey + " — Permissions"));
            var body = el("div");
            body.setAttribute("data-settings-section-body", "1");
            objectForm(body, value.folderPermissions, 0);
            section.appendChild(body);
            host.appendChild(section);
            rendered = true;
        });
        if (!rendered) host.appendChild(el("div", "sirk-card", "Ten moduł nie ma osobnej konfiguracji Permissions."));
    }

    function renderPortalVisibility(host, payload) {
        var portal = payload.moduleOptions.portal = clone(payload.moduleOptions.portal || {});
        field(host, "Widok domyślny", portal.defaultView || "overview", function (next) { portal.defaultView = next; }, { choices: DEFAULT_VIEW_CHOICES });
        ["showLauncher", "showNativeLink", "forceNewLogin", "forcePortalInterface", "keepSessionsAfterRestart"].forEach(function (key) {
            var checked = key === "showNativeLink" ? portal[key] !== false : portal[key] === true;
            field(host, key, checked, function (next) { portal[key] = next; }, { type: "boolean" });
        });
    }

    function renderSettings(layout, host, secondary) {
        renderSettingsNavigation(layout, secondary, host);
        var payload = draftPayload();
        var selected = selectedSettingsParts();
        var form = el("div");
        form.setAttribute("data-settings-form", "1");
        if (selected.kind === "portal") {
            renderPortalVisibility(form, payload);
        } else {
            var definition = findModule(selected.key);
            if (selected.section === "permissions") renderModulePermissions(form, payload, definition);
            else renderModuleGeneral(form, payload, definition);
        }
        var actions = el("div", "sirk-toolbar-group sirk-toolbar-left");
        var save = el("button", "sirk-button", "Zapisz");
        var message = el("span");
        save.type = "button";
        save.onclick = function () {
            save.disabled = true;
            status(message, "Zapisywanie…", false);
            postSettings(payload).then(function (result) {
                state.snapshot = result.snapshot;
                status(message, "Zapisano.", false);
                renderActive(layout, secondary, host);
            }).catch(function (error) {
                status(message, error.message, true);
                save.disabled = false;
            });
        };
        actions.appendChild(save);
        actions.appendChild(message);
        host.appendChild(form);
        host.appendChild(actions);
        applySearch(host);
    }

    function pluginStatus(plugin) {
        if (plugin.updateStatus === "available") return "Dostępna " + (plugin.availableVersion || "");
        if (plugin.updateStatus === "current") return "Aktualna";
        if (plugin.updateStatus === "incompatible") return "Niezgodna";
        if (plugin.updateStatus === "error") return "Błąd: " + (plugin.updateError || "");
        return "Brak danych";
    }

    function renderInstalledPlugins(host, message) {
        clear(host);
        var table = el("table");
        table.setAttribute("data-settings-table", "1");
        var head = el("thead");
        var row = el("tr");
        ["Wtyczka", "Wersja", "Dostępna", "Stan", "Aktualizacja", "Akcje"].forEach(function (title) { row.appendChild(el("th", "", title)); });
        head.appendChild(row);
        table.appendChild(head);
        var body = el("tbody");
        state.plugins.forEach(function (plugin) {
            var tr = el("tr");
            tr.setAttribute("data-search-item", "1");
            var name = el("td");
            name.appendChild(el("strong", "", plugin.name || plugin.shortName));
            name.appendChild(el("small", "", plugin.shortName || ""));
            tr.appendChild(name);
            tr.appendChild(el("td", "", plugin.version || "—"));
            tr.appendChild(el("td", "", plugin.availableVersion || "—"));
            tr.appendChild(el("td", "", plugin.status === 1 ? "Włączona" : "Wyłączona"));
            tr.appendChild(el("td", "", pluginStatus(plugin)));
            var actions = el("td");
            var actionList = [];
            if (plugin.updateAvailable && plugin.updateCompatible) actionList.push(["update", "Aktualizuj"]);
            actionList.push(plugin.status === 1 ? ["disable", "Wyłącz"] : ["enable", "Włącz"]);
            actionList.push(["remove", "Usuń"]);
            actionList.forEach(function (action) {
                var button = el("button", "sirk-button", action[1]);
                button.type = "button";
                button.disabled = plugin.protected === true;
                button.onclick = function () {
                    var question = action[0] === "update" ? "Zaktualizować " + (plugin.name || plugin.shortName) + "?" : action[1] + " wtyczkę " + (plugin.name || plugin.shortName) + "?";
                    if (!window.confirm(question)) return;
                    button.disabled = true;
                    status(message, "Wykonywanie operacji…", false);
                    post("plugin-operation", { operation: action[0], id: plugin.id }).then(function (result) {
                        state.plugins = result.plugins || [];
                        renderInstalledPlugins(host, message);
                        status(message, "Operacja zakończona.", false);
                    }).catch(function (error) {
                        status(message, error.message, true);
                        button.disabled = false;
                    });
                };
                actions.appendChild(button);
            });
            tr.appendChild(actions);
            body.appendChild(tr);
        });
        table.appendChild(body);
        host.appendChild(table);
        applySearch(host);
    }

    function renderMarketplace(host, message) {
        clear(host);
        var grid = el("div");
        grid.setAttribute("data-card-grid", "1");
        var installedNames = state.plugins.map(function (plugin) { return String(plugin.shortName || "").toLowerCase(); });
        state.marketplace.forEach(function (item) {
            var card = el("article", "sirk-card");
            card.setAttribute("data-search-item", "1");
            card.appendChild(el("h3", "", item.name));
            card.appendChild(el("small", "", "v" + item.version + " · " + item.author + " · " + item.category));
            card.appendChild(el("p", "", item.description || ""));
            var installed = installedNames.indexOf(String(item.shortName || "").toLowerCase()) >= 0;
            var install = el("button", "sirk-button", installed ? "Zainstalowana" : "Instaluj");
            install.type = "button";
            install.disabled = installed;
            install.onclick = function () {
                if (!window.confirm("Zainstalować " + item.name + "?")) return;
                install.disabled = true;
                status(message, "Dodawanie…", false);
                post("plugin-operation", { operation: "add", configUrl: item.configUrl }).then(function (result) {
                    state.plugins = result.plugins || [];
                    var added = state.plugins.find(function (plugin) { return String(plugin.shortName || "").toLowerCase() === String(item.shortName || "").toLowerCase(); });
                    if (!added || added.status === 1) return result;
                    return post("plugin-operation", { operation: "enable", id: added.id });
                }).then(function (result) {
                    state.plugins = result.plugins || state.plugins;
                    status(message, "Wtyczka została zainstalowana i włączona.", false);
                    renderMarketplace(host, message);
                }).catch(function (error) {
                    status(message, error.message, true);
                    install.disabled = false;
                });
            };
            card.appendChild(install);
            grid.appendChild(card);
        });
        host.appendChild(grid);
        applySearch(host);
    }

    function renderPlugins(host) {
        var controls = el("div", "sirk-toolbar");
        var left = el("div", "sirk-toolbar-group sirk-toolbar-left");
        var installed = el("button", state.pluginView === "installed" ? "sirk-button active" : "sirk-button", "Zainstalowane");
        var available = el("button", state.pluginView === "available" ? "sirk-button active" : "sirk-button", "Dostępne");
        var add = el("button", "sirk-button", "Dodaj z URL");
        var check = el("button", "sirk-button", "Sprawdź aktualizacje");
        var message = el("span");
        [installed, available, add, check].forEach(function (button) { button.type = "button"; left.appendChild(button); });
        left.appendChild(message);
        controls.appendChild(left);
        host.appendChild(controls);
        var content = el("div");
        host.appendChild(content);
        function draw() {
            installed.classList.toggle("active", state.pluginView === "installed");
            available.classList.toggle("active", state.pluginView === "available");
            if (state.pluginView === "installed") renderInstalledPlugins(content, message);
            else renderMarketplace(content, message);
        }
        installed.onclick = function () { state.pluginView = "installed"; draw(); };
        available.onclick = function () { state.pluginView = "available"; draw(); };
        add.onclick = function () {
            var url = window.prompt("URL pliku config.json wtyczki:");
            if (!url) return;
            status(message, "Dodawanie…", false);
            post("plugin-operation", { operation: "add", configUrl: url.trim() }).then(function (result) {
                state.plugins = result.plugins || [];
                status(message, "Wtyczka została dodana.", false);
                draw();
            }).catch(function (error) { status(message, error.message, true); });
        };
        check.onclick = function () {
            check.disabled = true;
            status(message, "Sprawdzanie aktualizacji…", false);
            get("plugin-state").then(function (result) {
                state.plugins = result.plugins || [];
                draw();
                status(message, "Sprawdzanie zakończone.", false);
            }).catch(function (error) { status(message, error.message, true); }).then(function () { check.disabled = false; });
        };
        Promise.all([get("plugin-state"), get("", { asset: "marketplace.json" })]).then(function (values) {
            state.plugins = values[0].plugins || [];
            state.marketplace = values[1].plugins || [];
            draw();
            status(message, "", false);
        }).catch(function (error) { status(message, error.message, true); });
    }

    function renderServer(host) {
        var message = el("div", "sirk-card", "Ładowanie stanu usług…");
        host.appendChild(message);
        get("server-state").then(function (result) {
            clear(host);
            if (state.resumeMessage) {
                host.appendChild(el("div", "sirk-card sirk-update-success", state.resumeMessage));
                state.resumeMessage = "";
            }
            if (!(result.services || []).length) {
                host.appendChild(el("div", "sirk-card", "Nie znaleziono usługi przypisanej do instalacji."));
                return;
            }
            (result.services || []).forEach(function (service) {
                var card = el("article", "sirk-card");
                card.setAttribute("data-search-item", "1");
                card.appendChild(el("h3", "", service.displayName || service.name));
                card.appendChild(el("p", "", "Stan: " + service.state + " · Start: " + service.startMode + " · PID: " + (service.processId || "—")));
                var restart = el("button", "sirk-button", "Restartuj usługę");
                restart.type = "button";
                restart.onclick = function () {
                    if (!window.confirm("Zrestartować usługę " + (service.displayName || service.name) + "?")) return;
                    restart.disabled = true;
                    var marker = { pending: true, active: "server", startedAt: Date.now() };
                    saveServiceRestartState(marker);
                    post("server-restart", { serviceName: service.name }).then(function () { waitForService(host, marker); }).catch(function (error) {
                        clearServiceRestartState();
                        card.appendChild(el("div", "sirk-card", error.message));
                        restart.disabled = false;
                    });
                };
                card.appendChild(restart);
                host.appendChild(card);
            });
            applySearch(host);
        }).catch(function (error) {
            message.textContent = error.message;
            message.setAttribute("data-error", "1");
        });
    }

    function renderDebug(host) {
        var snapshot = state.snapshot || {};
        var value = state.debugKey === "logs" ? snapshot.diagnostics && snapshot.diagnostics.logs || "Brak logów."
            : state.debugKey === "errors" ? snapshot.diagnostics && snapshot.diagnostics.errors || snapshot.moduleLoadErrors || "Brak błędów."
                : { plugin: snapshot.plugin, modules: snapshot.modules, moduleSettings: snapshot.moduleSettings, integrations: snapshot.integrations, migration: snapshot.migration, generatedAt: snapshot.generatedAt };
        var pre = el("pre", "sirk-card", typeof value === "string" ? value : JSON.stringify(value, null, 2));
        pre.setAttribute("data-debug-output", "1");
        host.appendChild(pre);
    }

    function renderServerSections(layout, secondary, details) {
        navButton(secondary, "service", "Usługa", state.serverKey, function (key) { state.serverKey = key; renderActive(layout, secondary, details); });
        var debugBody = navGroup(secondary, "Debug", state.serverKey.indexOf("debug:") === 0);
        [["debug:config", "Config"], ["debug:logs", "Logi"], ["debug:errors", "Błędy"]].forEach(function (item) {
            navButton(debugBody, item[0], item[1], state.serverKey, function (key) { state.serverKey = key; renderActive(layout, secondary, details); }, "sirk-nav-item sirk-settings-nav-leaf");
        });
        var updatesBody = navGroup(secondary, "Aktualizacje", state.serverKey.indexOf("system:") === 0 && state.serverKey !== "system:backups");
        [["system:updates", "Sprawdź"], ["system:history", "Historia"], ["system:channel", "Kanał"]].forEach(function (item) {
            navButton(updatesBody, item[0], item[1], state.serverKey, function (key) { state.serverKey = key; renderActive(layout, secondary, details); }, "sirk-nav-item sirk-settings-nav-leaf");
        });
        navButton(secondary, "system:backups", "Backupy", state.serverKey, function (key) { state.serverKey = key; renderActive(layout, secondary, details); });
        navButton(secondary, "plugins", "Wtyczki", state.serverKey, function (key) { state.serverKey = key; renderActive(layout, secondary, details); });
        secondary.hidden = false;
        if (state.serverKey === "service") renderServer(details);
        else if (state.serverKey.indexOf("debug:") === 0) {
            state.debugKey = state.serverKey.slice(6);
            renderDebug(details);
        } else if (state.serverKey === "plugins") renderPlugins(details);
        else if (window.SirkSystemUpdates) window.SirkSystemUpdates.mount(details, state.serverKey.slice(7));
    }

    function selectedValues(select) {
        return Array.prototype.filter.call(select.options, function (option) { return option.selected; })
            .map(function (option) { return option.value; });
    }

    function identitySelect(values, options) {
        var select = el("select");
        select.multiple = true;
        select.size = Math.max(3, Math.min(8, options.length || 3));
        options.forEach(function (item) {
            var option = el("option", "", item.label);
            option.value = item.value;
            option.selected = values.indexOf(item.value) >= 0;
            select.appendChild(option);
        });
        return select;
    }

    function identityAction(host, action, payload, message) {
        host.querySelectorAll("button").forEach(function (button) { button.disabled = true; });
        identityRequest(action, payload).then(function (result) {
            state.identity = result.value;
            renderIdentity(host);
        }).catch(function (error) {
            host.querySelectorAll("button").forEach(function (button) { button.disabled = false; });
            window.alert(error.message || message || "Operacja nie powiodła się.");
        });
    }

    function renderIdentity(host) {
        clear(host);
        if (!state.identity) {
            host.appendChild(el("div", "sirk-card", "Ładowanie użytkowników i grup…"));
            identityRequest().then(function (result) {
                state.identity = result.value;
                renderIdentity(host);
            }).catch(function (error) {
                clear(host);
                host.appendChild(el("div", "sirk-card", error.message));
            });
            return;
        }
        var snapshot = state.identity;
        var groupOptions = (snapshot.groups || []).map(function (group) { return { value: group.id, label: group.name }; });

        var userCard = el("section", "sirk-card");
        userCard.appendChild(el("h2", "", "Użytkownicy"));
        userCard.appendChild(el("p", "", "Konta, role oraz członkostwo w grupach SIRK Portal."));
        var userTable = el("table", "sirk-settings-table");
        userTable.innerHTML = "<thead><tr><th>Użytkownik</th><th>Role</th><th>Grupy</th><th>Stan</th><th>Akcje</th></tr></thead>";
        var userBody = el("tbody");
        (snapshot.users || []).forEach(function (user) {
            var row = el("tr");
            var identity = el("td");
            identity.appendChild(el("strong", "", user.displayName || user.username));
            identity.appendChild(el("small", "", " " + user.username));
            row.appendChild(identity);
            row.appendChild(el("td", "", (user.roles || []).join(", ")));
            row.appendChild(el("td", "", (user.groups || []).map(function (id) {
                var group = (snapshot.groups || []).find(function (item) { return item.id === id; });
                return group ? group.name : id;
            }).join(", ") || "—"));
            row.appendChild(el("td", "", user.enabled === false ? "Wyłączony" : "Aktywny"));
            var actions = el("td");
            var edit = el("button", "sirk-button", "Edytuj");
            edit.type = "button";
            edit.onclick = function () {
                var displayName = window.prompt("Nazwa wyświetlana:", user.displayName || user.username);
                if (displayName == null) return;
                var roles = identitySelect(user.roles || [], [
                    { value: "admin", label: "Administrator" },
                    { value: "operator", label: "Operator" },
                    { value: "viewer", label: "Odczyt" }
                ]);
                var groups = identitySelect(user.groups || [], groupOptions);
                var editor = el("div", "sirk-card");
                editor.appendChild(el("h3", "", "Role i grupy: " + user.username));
                editor.appendChild(el("label", "", "Role"));
                editor.appendChild(roles);
                editor.appendChild(el("label", "", "Grupy"));
                editor.appendChild(groups);
                var password = el("input");
                password.type = "password";
                password.placeholder = "Nowe hasło (opcjonalnie, min. 10 znaków)";
                editor.appendChild(password);
                var enabled = el("label");
                var enabledInput = el("input");
                enabledInput.type = "checkbox";
                enabledInput.checked = user.enabled !== false;
                enabled.appendChild(enabledInput);
                enabled.appendChild(document.createTextNode(" Konto aktywne"));
                editor.appendChild(enabled);
                var save = el("button", "sirk-button", "Zapisz użytkownika");
                save.type = "button";
                save.onclick = function () {
                    identityAction(host, "update-user", {
                        id: user.id,
                        value: {
                            displayName: displayName,
                            roles: selectedValues(roles),
                            groups: selectedValues(groups),
                            enabled: enabledInput.checked,
                            password: password.value
                        }
                    });
                };
                editor.appendChild(save);
                host.insertBefore(editor, host.firstChild);
                editor.scrollIntoView({ behavior: "smooth", block: "start" });
            };
            var remove = el("button", "sirk-button sirk-button-danger", "Usuń");
            remove.type = "button";
            remove.onclick = function () {
                if (window.confirm("Usunąć konto " + user.username + "?")) identityAction(host, "delete-user", { id: user.id });
            };
            actions.appendChild(edit);
            actions.appendChild(remove);
            row.appendChild(actions);
            userBody.appendChild(row);
        });
        userTable.appendChild(userBody);
        userCard.appendChild(userTable);

        var newUser = el("details", "sirk-card");
        newUser.appendChild(el("summary", "", "Dodaj użytkownika"));
        var username = el("input"); username.placeholder = "Nazwa użytkownika";
        var displayName = el("input"); displayName.placeholder = "Nazwa wyświetlana";
        var password = el("input"); password.type = "password"; password.placeholder = "Hasło (min. 10 znaków)";
        var roles = identitySelect(["viewer"], [
            { value: "admin", label: "Administrator" },
            { value: "operator", label: "Operator" },
            { value: "viewer", label: "Odczyt" }
        ]);
        var groups = identitySelect([], groupOptions);
        [username, displayName, password, roles, groups].forEach(function (node) { newUser.appendChild(node); });
        var addUser = el("button", "sirk-button", "Utwórz użytkownika");
        addUser.type = "button";
        addUser.onclick = function () {
            identityAction(host, "create-user", { value: {
                username: username.value,
                displayName: displayName.value,
                password: password.value,
                roles: selectedValues(roles),
                groups: selectedValues(groups),
                enabled: true
            } });
        };
        newUser.appendChild(addUser);

        var groupCard = el("section", "sirk-card");
        groupCard.appendChild(el("h2", "", "Grupy"));
        (snapshot.groups || []).forEach(function (group) {
            var row = el("div", "sirk-toolbar");
            row.appendChild(el("strong", "", group.name));
            row.appendChild(el("span", "", group.description || ""));
            var edit = el("button", "sirk-button", "Edytuj");
            edit.type = "button";
            edit.onclick = function () {
                var name = window.prompt("Nazwa grupy:", group.name);
                if (name == null) return;
                var description = window.prompt("Opis grupy:", group.description || "");
                if (description == null) return;
                identityAction(host, "update-group", { id: group.id, value: { name: name, description: description } });
            };
            var remove = el("button", "sirk-button sirk-button-danger", "Usuń");
            remove.type = "button";
            remove.onclick = function () {
                if (window.confirm("Usunąć grupę " + group.name + "?")) identityAction(host, "delete-group", { id: group.id });
            };
            row.appendChild(edit);
            row.appendChild(remove);
            groupCard.appendChild(row);
        });
        var groupName = el("input"); groupName.placeholder = "Nazwa nowej grupy";
        var groupDescription = el("input"); groupDescription.placeholder = "Opis";
        var addGroup = el("button", "sirk-button", "Dodaj grupę");
        addGroup.type = "button";
        addGroup.onclick = function () {
            identityAction(host, "create-group", { value: { name: groupName.value, description: groupDescription.value } });
        };
        groupCard.appendChild(groupName);
        groupCard.appendChild(groupDescription);
        groupCard.appendChild(addGroup);
        host.appendChild(userCard);
        host.appendChild(newUser);
        host.appendChild(groupCard);
    }

    function renderActive(layout, secondary, details) {
        clear(secondary);
        clear(details);
        secondary.hidden = false;
        layout.classList.remove("sirk-settings-overview");
        if (state.active === "server") renderServerSections(layout, secondary, details);
        else if (state.active === "identity") {
            secondary.hidden = true;
            renderIdentity(details);
        }
        else renderSettings(layout, details, secondary);
        applySearch(details);
    }

    function mount(host) {
        var marker = serviceRestartState();
        if (marker && marker.active) state.active = marker.active;
        if (marker && marker.completed) {
            clearServiceRestartState();
            state.resumeMessage = "Usługa została ponownie uruchomiona. Strona jest aktualna.";
        }
        clear(host);
        host.innerHTML = '<section class="sirk-standalone-view-scroll" data-portal-settings>' +
            '<div class="sirk-toolbar"><div class="sirk-toolbar-group sirk-toolbar-left">' +
            '<button type="button" class="sirk-button" data-settings-collapse aria-label="Zwiń menu">☰</button>' +
            '<button type="button" class="sirk-button" data-settings-refresh>Odśwież</button>' +
            '<input type="search" data-settings-search placeholder="Szukaj…" aria-label="Szukaj"></div></div>' +
            '<div class="sirk-layout-host"><div class="sirk-layout">' +
            '<aside class="sirk-column-primary" data-settings-primary></aside>' +
            '<aside class="sirk-column-secondary" data-settings-secondary></aside>' +
            '<div class="sirk-column-details" data-settings-details></div>' +
            '</div></div></section>';

        var layout = host.querySelector(".sirk-layout");
        var primary = host.querySelector("[data-settings-primary]");
        var secondary = host.querySelector("[data-settings-secondary]");
        var details = host.querySelector("[data-settings-details]");
        var search = host.querySelector("[data-settings-search]");
        search.value = state.search;
        search.oninput = function () { state.search = search.value; applySearch(details); };
        host.querySelector("[data-settings-collapse]").onclick = function () { layout.classList.toggle("is-collapsed"); };
        host.querySelector("[data-settings-refresh]").onclick = function () {
            details.innerHTML = '<div class="sirk-card">Odświeżanie…</div>';
            get("portal-admin-snapshot").then(function (result) {
                state.snapshot = result.snapshot;
                renderActive(layout, secondary, details);
            }).catch(function (error) {
                details.innerHTML = "";
                details.appendChild(el("div", "sirk-card", error.message));
            });
        };

        [["settings", "Settings"], ["identity", "Użytkownicy i grupy"], ["server", "Server"]].forEach(function (item) {
            var button = el("button", item[0] === state.active ? "sirk-nav-item active" : "sirk-nav-item", item[1]);
            button.type = "button";
            button.onclick = function () {
                state.active = item[0];
                Array.prototype.forEach.call(primary.children, function (node) { node.classList.toggle("active", node === button); });
                renderActive(layout, secondary, details);
            };
            primary.appendChild(button);
        });

        get("portal-admin-snapshot").then(function (result) {
            state.snapshot = result.snapshot;
            renderActive(layout, secondary, details);
        }).catch(function (error) {
            details.appendChild(el("div", "sirk-card", error.message));
        });
    }

    window.SirkPortalSettings = { mount: mount };
}());
