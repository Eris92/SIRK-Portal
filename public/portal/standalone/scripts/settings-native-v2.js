(function () {
    "use strict";

    var state = {
        tab: "portal",
        section: "general",
        settings: null,
        identity: null,
        runtime: null,
        maintenance: null,
        csrf: "",
        host: null,
        page: null
    };
    var roleOptions = [
        ["Break-Glass", "Break-Glass"],
        ["SecAdmin", "Security Administrator"],
        ["Admin", "Administrator"],
        ["Engineer L3", "Engineer L3"],
        ["Support L2", "Support L2"],
        ["Operator L1", "Operator L1"],
        ["Auditor", "Auditor"]
    ];

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
    function clone(value) { return JSON.parse(JSON.stringify(value == null ? {} : value)); }

    function parse(response) {
        return response.text().then(function (text) {
            var payload = {};
            try { payload = text ? JSON.parse(text) : {}; }
            catch (_) { throw new Error("HTTP " + response.status + ": invalid JSON response"); }
            if (response.status === 401) {
                location.replace("/login");
                throw new Error("Authentication required.");
            }
            if (!response.ok || payload.ok === false) throw new Error(payload.error || payload.title || ("HTTP " + response.status));
            return payload;
        });
    }

    function issueCsrf() {
        if (state.csrf) return Promise.resolve(state.csrf);
        return fetch("/api/v1/auth/csrf", { credentials: "same-origin", cache: "no-store" })
            .then(parse).then(function (payload) {
                state.csrf = String(payload.requestToken || "");
                if (!state.csrf) throw new Error("CSRF token could not be issued.");
                return state.csrf;
            });
    }

    function api(path, method, body) {
        method = String(method || "GET").toUpperCase();
        function send() {
            var headers = new Headers({ Accept: "application/json" });
            if (!/^(GET|HEAD|OPTIONS)$/.test(method)) {
                headers.set("Content-Type", "application/json; charset=UTF-8");
                headers.set("X-SIRK-CSRF", state.csrf);
            }
            return fetch(path, {
                method: method,
                credentials: "same-origin",
                cache: "no-store",
                headers: headers,
                body: body == null ? undefined : JSON.stringify(body)
            }).then(parse);
        }
        return /^(GET|HEAD|OPTIONS)$/.test(method) ? send() : issueCsrf().then(send);
    }

    function load() {
        return Promise.all([
            api("/api/v1/admin/settings"),
            api("/api/v1/admin/identity/"),
            api("/api/v1/admin/runtime"),
            api("/api/v1/admin/maintenance/status")
        ]).then(function (values) {
            state.settings = values[0].value;
            state.identity = values[1].value;
            state.runtime = values[2];
            state.maintenance = values[3].value;
        });
    }

    function card(title, description) {
        var node = el("section", "sirk-card");
        if (title) node.appendChild(el("h2", "", title));
        if (description) node.appendChild(el("p", "sirk-muted", description));
        return node;
    }

    function field(label, value, type, choices) {
        var wrapper = el("label", "sirk-field");
        wrapper.appendChild(el("strong", "", label));
        var input;
        if (type === "checkbox") {
            input = el("input"); input.type = "checkbox"; input.checked = value === true;
            wrapper.classList.add("is-checkbox");
        } else if (type === "textarea") {
            input = el("textarea"); input.rows = 12; input.value = value == null ? "" : String(value);
        } else if (choices) {
            input = el("select");
            choices.forEach(function (choice) {
                var option = el("option", "", choice[1]);
                option.value = choice[0];
                option.selected = String(choice[0]) === String(value == null ? "" : value);
                input.appendChild(option);
            });
        } else {
            input = el("input"); input.type = type || "text"; input.value = value == null ? "" : String(value);
        }
        wrapper.appendChild(input);
        return { wrapper: wrapper, input: input };
    }

    function button(label, callback, danger) {
        var node = el("button", danger ? "sirk-button sirk-button-danger" : "sirk-button", label);
        node.type = "button";
        node.onclick = callback;
        return node;
    }

    function navButton(label, active, callback) {
        var node = el("button", "sirk-nav-item" + (active ? " is-active" : ""), label);
        node.type = "button";
        node.onclick = callback;
        return node;
    }

    function actionRow() { return el("div", "sirk-action-row"); }
    function showError(error) { window.alert(error && error.message || String(error || "Operacja nie powiodła się.")); }

    function saveSettings(payload) {
        state.page.root.querySelectorAll("button").forEach(function (node) { node.disabled = true; });
        api("/api/v1/admin/settings", "PUT", payload).then(function (result) {
            state.settings = result.value;
            renderAll();
        }).catch(showError).then(function () {
            state.page.root.querySelectorAll("button").forEach(function (node) { node.disabled = false; });
        });
    }

    function mutateIdentity(action, payload) {
        api("/api/v1/admin/identity/", "POST", Object.assign({ action: action }, payload || {}))
            .then(function (result) { state.identity = result.value; renderAll(); })
            .catch(showError);
    }

    function maintenance(action, body, restart) {
        api("/api/v1/admin/maintenance/" + action, "POST", body || {}).then(function (result) {
            if (restart) {
                clear(state.page.details);
                state.page.details.appendChild(card("Oczekiwanie na usługę", "Operacja została zaplanowana."));
                setTimeout(function poll() {
                    fetch("/readyz", { cache: "no-store" }).then(function (response) {
                        if (!response.ok) throw new Error("starting");
                        location.reload();
                    }).catch(function () { setTimeout(poll, 1500); });
                }, 4000);
                return;
            }
            state.maintenance = result.value;
            renderAll();
        }).catch(showError);
    }

    function tabDefinitions() {
        return [
            { key: "portal", label: "Portal" },
            { key: "modules", label: "Moduły" },
            { key: "identity", label: "Użytkownicy i grupy" },
            { key: "system", label: "System" }
        ];
    }

    function sectionDefinitions() {
        if (state.tab === "portal") return [
            { key: "general", label: "Ogólne" },
            { key: "views", label: "Widoczność zakładek" }
        ];
        if (state.tab === "modules") return Object.keys((state.settings && state.settings.modules) || {}).sort().map(function (key) {
            return { key: key, label: key };
        });
        if (state.tab === "identity") return [
            { key: "users", label: "Użytkownicy lokalni" },
            { key: "groups", label: "Grupy dostępu" }
        ];
        return [
            { key: "runtime", label: "Usługa i runtime" },
            { key: "updates", label: "Aktualizacje" },
            { key: "backups", label: "Backupy" }
        ];
    }

    function ensureSection() {
        var sections = sectionDefinitions();
        if (!sections.some(function (item) { return item.key === state.section; })) {
            state.section = sections.length ? sections[0].key : "";
        }
        return sections;
    }

    function renderNavigation() {
        clear(state.page.primary);
        tabDefinitions().forEach(function (item) {
            state.page.primary.appendChild(navButton(item.label, item.key === state.tab, function () {
                state.tab = item.key;
                state.section = "";
                renderAll();
            }));
        });

        clear(state.page.secondary);
        ensureSection().forEach(function (item) {
            state.page.secondary.appendChild(navButton(item.label, item.key === state.section, function () {
                state.section = item.key;
                renderAll();
            }));
        });
    }

    function renderPortalGeneral(host) {
        var portal = clone(state.settings.portal || {});
        var node = card("Portal", "Natywna konfiguracja SIRK Portal .NET 10.");
        var siteName = field("Nazwa Portalu", portal.siteName || "SIRK Portal");
        var defaultView = field("Widok startowy", portal.defaultView || "overview", "select", [
            ["overview", "Overview"], ["devices", "Urządzenia"], ["approvals", "Akceptacje"],
            ["automation", "Automatyzacja"], ["monitoring", "Monitoring"], ["assets", "Zasoby"],
            ["management", "Zarządzanie"], ["reports", "Raporty"], ["security", "Bezpieczeństwo"]
        ]);
        var reset = field("Pokaż reset hasła", portal.showPasswordReset !== false, "checkbox");
        var resetUrl = field("Adres resetu hasła", portal.passwordResetUrl || "");
        [siteName, defaultView, reset, resetUrl].forEach(function (item) { node.appendChild(item.wrapper); });
        var actions = actionRow();
        actions.appendChild(button("Zapisz", function () {
            portal.siteName = siteName.input.value.trim() || "SIRK Portal";
            portal.defaultView = defaultView.input.value;
            portal.showPasswordReset = reset.input.checked;
            portal.passwordResetUrl = resetUrl.input.value.trim();
            saveSettings({ portal: portal });
        }));
        node.appendChild(actions);
        host.appendChild(node);
    }

    function renderPortalViews(host) {
        var portal = clone(state.settings.portal || {});
        portal.views = portal.views || {};
        var node = card("Widoczność zakładek", "Ta sama konfiguracja steruje menu i dostępnością widoków.");
        var grid = el("div", "sirk-settings-grid");
        Object.keys(portal.views).sort().forEach(function (key) {
            var item = field(key, portal.views[key].enabled !== false, "checkbox");
            item.input.onchange = function () {
                portal.views[key] = Object.assign({}, portal.views[key] || {}, { enabled: item.input.checked });
            };
            grid.appendChild(item.wrapper);
        });
        node.appendChild(grid);

        var overview = portal.views.overview = portal.views.overview || {};
        var overviewCard = card("Kafelki Overview", "Ustawienia zawartości strony głównej.");
        var overviewGrid = el("div", "sirk-settings-grid");
        var showDevices = field("Pokaż Devices", overview.showDevicesCard !== false, "checkbox");
        var showSystem = field("Pokaż stan systemu", overview.showSystemStatusCard !== false, "checkbox");
        var showIntegrations = field("Pokaż Integrations", overview.showIntegrationsCard !== false, "checkbox");
        [showDevices, showSystem, showIntegrations].forEach(function (item) { overviewGrid.appendChild(item.wrapper); });
        overviewCard.appendChild(overviewGrid);
        node.appendChild(overviewCard);

        var actions = actionRow();
        actions.appendChild(button("Zapisz widoczność", function () {
            overview.showDevicesCard = showDevices.input.checked;
            overview.showSystemStatusCard = showSystem.input.checked;
            overview.showIntegrationsCard = showIntegrations.input.checked;
            saveSettings({ portal: portal });
        }));
        node.appendChild(actions);
        host.appendChild(node);
    }

    function selected(select) {
        return Array.prototype.filter.call(select.options, function (option) { return option.selected; })
            .map(function (option) { return option.value; });
    }

    function groupSelect(values) {
        var select = el("select"); select.multiple = true; select.size = 7;
        (state.identity.groups || []).forEach(function (group) {
            var option = el("option", "", group.name); option.value = group.id;
            option.selected = (values || []).indexOf(group.id) >= 0;
            select.appendChild(option);
        });
        return select;
    }

    function renderModule(host, key) {
        var modules = state.settings.modules || {};
        var module = clone(modules[key] || {});
        var node = card(key, "Konfiguracja modułu i jego zakres dostępu.");
        var enabled = field("Włączony", module.enabled === true, "checkbox");
        var groups = groupSelect(module.accessGroupIds || []);
        var groupWrapper = el("label", "sirk-field");
        groupWrapper.appendChild(el("strong", "", "Grupy dostępu"));
        groupWrapper.appendChild(groups);
        var options = field("Opcje JSON", JSON.stringify(module.options || {}, null, 2), "textarea");
        node.appendChild(enabled.wrapper);
        node.appendChild(groupWrapper);
        node.appendChild(options.wrapper);
        var actions = actionRow();
        actions.appendChild(button("Zapisz moduł", function () {
            var parsed;
            try { parsed = JSON.parse(options.input.value || "{}"); }
            catch (error) { showError(error); return; }
            var update = {};
            update[key] = { enabled: enabled.input.checked, accessGroupIds: selected(groups), options: parsed };
            saveSettings({ modules: update });
        }));
        node.appendChild(actions);
        host.appendChild(node);
    }

    function roleSelect(value) {
        var select = el("select");
        roleOptions.forEach(function (role) {
            var option = el("option", "", role[1]);
            option.value = role[0];
            option.selected = role[0] === value;
            select.appendChild(option);
        });
        return select;
    }

    function renderUsers(host) {
        var users = card("Użytkownicy lokalni");
        var tableWrap = el("div", "sirk-table-wrap");
        var table = el("table", "sirk-settings-table");
        table.innerHTML = "<thead><tr><th>Użytkownik</th><th>Rola</th><th>Aktywny</th><th>Akcje</th></tr></thead>";
        var body = el("tbody");
        (state.identity.users || []).forEach(function (user) {
            var row = el("tr");
            row.appendChild(el("td", "", (user.displayName || user.userName) + " (" + user.userName + ")"));
            var role = roleSelect(user.role);
            var roleCell = el("td"); roleCell.appendChild(role); row.appendChild(roleCell);
            var enabled = el("input"); enabled.type = "checkbox"; enabled.checked = user.enabled !== false;
            var enabledCell = el("td"); enabledCell.appendChild(enabled); row.appendChild(enabledCell);
            var actions = el("td", "sirk-action-row");
            actions.appendChild(button("Zapisz", function () {
                var displayName = window.prompt("Nazwa wyświetlana:", user.displayName || user.userName);
                if (displayName == null) return;
                mutateIdentity("update-user", { id: user.id, displayName: displayName, role: role.value, enabled: enabled.checked });
            }));
            var remove = button("Usuń", function () {
                if (window.confirm("Usunąć konto " + user.userName + "?")) mutateIdentity("delete-user", { id: user.id });
            }, true);
            if (user.role === "Break-Glass") remove.disabled = true;
            actions.appendChild(remove);
            row.appendChild(actions);
            body.appendChild(row);
        });
        table.appendChild(body);
        tableWrap.appendChild(table);
        users.appendChild(tableWrap);

        var add = el("details", "sirk-card");
        add.appendChild(el("summary", "", "Dodaj użytkownika"));
        var login = field("Login", "");
        var name = field("Nazwa", "");
        var password = field("Hasło", "", "password");
        var newRole = roleSelect("Operator L1");
        [login, name, password].forEach(function (item) { add.appendChild(item.wrapper); });
        var roleWrap = el("label", "sirk-field");
        roleWrap.appendChild(el("strong", "", "Rola"));
        roleWrap.appendChild(newRole);
        add.appendChild(roleWrap);
        var addActions = actionRow();
        addActions.appendChild(button("Utwórz konto", function () {
            mutateIdentity("create-user", { userName: login.input.value, displayName: name.input.value, password: password.input.value, role: newRole.value });
        }));
        add.appendChild(addActions);
        users.appendChild(add);
        host.appendChild(users);
    }

    function renderGroups(host) {
        var groups = card("Grupy dostępu");
        (state.identity.groups || []).forEach(function (group) {
            var details = el("details", "sirk-card");
            details.appendChild(el("summary", "", group.name));
            var nameField = field("Nazwa", group.name);
            var description = field("Opis", group.description || "");
            var members = el("select"); members.multiple = true; members.size = 8;
            (state.identity.users || []).forEach(function (user) {
                var option = el("option", "", user.displayName + " (" + user.userName + ")");
                option.value = user.id;
                option.selected = (group.memberIds || []).indexOf(user.id) >= 0;
                members.appendChild(option);
            });
            var memberWrap = el("label", "sirk-field");
            memberWrap.appendChild(el("strong", "", "Członkowie"));
            memberWrap.appendChild(members);
            details.appendChild(nameField.wrapper);
            details.appendChild(description.wrapper);
            details.appendChild(memberWrap);
            var actions = actionRow();
            actions.appendChild(button("Zapisz grupę", function () {
                mutateIdentity("save-group", { id: group.id, name: nameField.input.value, description: description.input.value, memberIds: selected(members) });
            }));
            actions.appendChild(button("Usuń grupę", function () {
                if (window.confirm("Usunąć grupę " + group.name + "?")) mutateIdentity("delete-group", { id: group.id });
            }, true));
            details.appendChild(actions);
            groups.appendChild(details);
        });
        var createGroup = el("details", "sirk-card");
        createGroup.appendChild(el("summary", "", "Dodaj grupę"));
        var id = field("Identyfikator", "");
        var groupName = field("Nazwa", "");
        var groupDescription = field("Opis", "");
        [id, groupName, groupDescription].forEach(function (item) { createGroup.appendChild(item.wrapper); });
        var actions = actionRow();
        actions.appendChild(button("Utwórz grupę", function () {
            mutateIdentity("save-group", { id: id.input.value, name: groupName.input.value, description: groupDescription.input.value, memberIds: [] });
        }));
        createGroup.appendChild(actions);
        groups.appendChild(createGroup);
        host.appendChild(groups);
    }

    function renderRuntime(host) {
        var runtime = state.runtime || {};
        var service = runtime.service || {};
        var status = card("SIRK Portal .NET 10", "Stan: " + (service.ready ? "Gotowy" : "Uruchamianie") + " · PID: " + (service.processId || "—") + " · Wersja: " + (service.version || "—"));
        status.appendChild(el("p", "", "Data root: " + ((runtime.storage || {}).dataRoot || "—")));
        status.appendChild(el("p", "", "Files: " + ((runtime.storage || {}).filesDirectory || "C:\\ProgramData\\SIRK\\Portal\\Files")));
        var actions = actionRow();
        var restart = button("Restartuj usługę", function () {
            if (window.confirm("Zrestartować usługę SIRK Portal?")) maintenance("restart", {}, true);
        });
        restart.disabled = !(state.maintenance.capabilities || {}).restart;
        actions.appendChild(restart);
        status.appendChild(actions);
        host.appendChild(status);
    }

    function renderUpdates(host) {
        var current = state.maintenance.current || {};
        var updates = card("Kanał aktualizacji", "Wersja: " + (current.version || "—"));
        var channel = field("Kanał", current.channel || "dev", "select", [["stable", "Stable"], ["beta", "Beta"], ["dev", "Dev"]]);
        updates.appendChild(channel.wrapper);
        var actions = actionRow();
        actions.appendChild(button("Zapisz kanał", function () { maintenance("channel", { channel: channel.input.value }, false); }));
        actions.appendChild(button("Sprawdź aktualizacje", function () { maintenance("check", {}, false); }));
        updates.appendChild(actions);
        updates.appendChild(el("p", "", (state.maintenance.remote || {}).updateAvailable ? "Dostępna jest aktualizacja." : "System jest aktualny dla skonfigurowanego kanału."));
        host.appendChild(updates);
    }

    function renderBackups(host) {
        var backups = card("Backup danych Portalu");
        var createActions = actionRow();
        createActions.appendChild(button("Utwórz backup", function () { maintenance("backup", { reason: "manual-ui" }, false); }));
        backups.appendChild(createActions);
        (state.maintenance.backups || []).forEach(function (backup) {
            var row = el("div", "sirk-backup-row");
            row.appendChild(el("strong", "", backup.id));
            row.appendChild(el("span", "", new Date(backup.createdAt).toLocaleString() + " · " + Math.round((backup.sizeBytes || 0) / 1024) + " KiB"));
            var actions = actionRow();
            var restore = button("Przywróć", function () {
                if (window.confirm("Przywrócić backup? Usługa zostanie zrestartowana.")) maintenance("restore", { id: backup.id }, true);
            });
            restore.disabled = !(state.maintenance.capabilities || {}).restore;
            actions.appendChild(restore);
            actions.appendChild(button("Usuń", function () {
                if (window.confirm("Usunąć backup?")) maintenance("delete-backup", { id: backup.id }, false);
            }, true));
            row.appendChild(actions);
            backups.appendChild(row);
        });
        if (!(state.maintenance.backups || []).length) backups.appendChild(el("p", "", "Brak backupów."));
        host.appendChild(backups);
    }

    function renderDetails() {
        clear(state.page.details);
        if (!state.settings || !state.identity || !state.maintenance) {
            state.page.details.appendChild(card("Ładowanie ustawień…"));
            return;
        }
        if (state.tab === "portal") {
            if (state.section === "views") renderPortalViews(state.page.details);
            else renderPortalGeneral(state.page.details);
        } else if (state.tab === "modules") {
            renderModule(state.page.details, state.section);
        } else if (state.tab === "identity") {
            if (state.section === "groups") renderGroups(state.page.details);
            else renderUsers(state.page.details);
        } else if (state.section === "updates") {
            renderUpdates(state.page.details);
        } else if (state.section === "backups") {
            renderBackups(state.page.details);
        } else {
            renderRuntime(state.page.details);
        }
    }

    function renderAll() {
        if (!state.page) return;
        renderNavigation();
        renderDetails();
    }

    function mount(host) {
        clear(host);
        var root = el("section", "sirk-view-shell");
        root.setAttribute("data-sirk-view-shell", "settings");
        root.setAttribute("data-portal-settings-native", "3");
        var toolbar = el("div", "sirk-toolbar-host");
        var left = el("div", "sirk-group sirk-left");
        left.appendChild(el("strong", "", "Ustawienia"));
        var right = el("div", "sirk-group sirk-right");
        right.appendChild(button("Odśwież", function () {
            state.page.details.innerHTML = "";
            state.page.details.appendChild(card("Odświeżanie…"));
            load().then(renderAll).catch(showError);
        }));
        toolbar.appendChild(left);
        toolbar.appendChild(right);
        var layout = el("div", "sirk-layout-host");
        var primary = el("aside", "sirk-column-primary");
        var secondary = el("aside", "sirk-column-secondary");
        var details = el("div", "sirk-column-details");
        layout.appendChild(primary);
        layout.appendChild(secondary);
        layout.appendChild(details);
        root.appendChild(toolbar);
        root.appendChild(layout);
        host.appendChild(root);
        state.host = host;
        state.page = { root: root, toolbar: toolbar, layout: layout, primary: primary, secondary: secondary, details: details };
        renderAll();
        load().then(renderAll).catch(function (error) {
            clear(details);
            details.appendChild(card("Błąd", error.message));
        });
    }

    window.SirkPortalSettings = { mount: mount };
}());
