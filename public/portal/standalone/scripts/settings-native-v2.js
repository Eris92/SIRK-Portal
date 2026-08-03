(function () {
    "use strict";

    var state = { tab: "portal", settings: null, identity: null, runtime: null, maintenance: null, csrf: "" };
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

    function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
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
        if (description) node.appendChild(el("p", "", description));
        return node;
    }

    function field(label, value, type, choices) {
        var wrapper = el("label", "sirk-card");
        wrapper.appendChild(el("strong", "", label));
        var input;
        if (type === "checkbox") {
            input = el("input"); input.type = "checkbox"; input.checked = value === true;
        } else if (type === "textarea") {
            input = el("textarea"); input.rows = 9; input.value = value == null ? "" : String(value);
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

    function showError(error) { window.alert(error && error.message || String(error || "Operacja nie powiodła się.")); }

    function saveSettings(payload, host) {
        host.querySelectorAll("button").forEach(function (node) { node.disabled = true; });
        api("/api/v1/admin/settings", "PUT", payload).then(function (result) {
            state.settings = result.value;
            render(host);
        }).catch(showError).then(function () {
            host.querySelectorAll("button").forEach(function (node) { node.disabled = false; });
        });
    }

    function renderPortal(host) {
        var portal = clone(state.settings.portal || {});
        var general = card("Portal", "Natywna konfiguracja SIRK Portal .NET 10.");
        var siteName = field("Nazwa Portalu", portal.siteName || "SIRK Portal");
        var defaultView = field("Widok startowy", portal.defaultView || "overview", "select", [
            ["overview", "Overview"], ["devices", "Urządzenia"], ["approvals", "Akceptacje"],
            ["automation", "Automatyzacja"], ["monitoring", "Monitoring"], ["assets", "Zasoby"],
            ["management", "Zarządzanie"], ["reports", "Raporty"], ["security", "Bezpieczeństwo"]
        ]);
        var reset = field("Pokaż reset hasła", portal.showPasswordReset !== false, "checkbox");
        var resetUrl = field("Adres resetu hasła", portal.passwordResetUrl || "");
        [siteName, defaultView, reset, resetUrl].forEach(function (item) { general.appendChild(item.wrapper); });
        general.appendChild(button("Zapisz", function () {
            portal.siteName = siteName.input.value.trim() || "SIRK Portal";
            portal.defaultView = defaultView.input.value;
            portal.showPasswordReset = reset.input.checked;
            portal.passwordResetUrl = resetUrl.input.value.trim();
            saveSettings({ portal: portal }, host);
        }));
        host.appendChild(general);

        var views = card("Widoczność zakładek");
        portal.views = portal.views || {};
        Object.keys(portal.views).sort().forEach(function (key) {
            var item = field(key, portal.views[key].enabled !== false, "checkbox");
            item.input.onchange = function () {
                portal.views[key] = Object.assign({}, portal.views[key] || {}, { enabled: item.input.checked });
            };
            views.appendChild(item.wrapper);
        });
        views.appendChild(button("Zapisz widoczność", function () { saveSettings({ portal: portal }, host); }));
        host.appendChild(views);
    }

    function selected(select) {
        return Array.prototype.filter.call(select.options, function (option) { return option.selected; })
            .map(function (option) { return option.value; });
    }

    function groupSelect(values) {
        var select = el("select"); select.multiple = true; select.size = 5;
        (state.identity.groups || []).forEach(function (group) {
            var option = el("option", "", group.name); option.value = group.id;
            option.selected = (values || []).indexOf(group.id) >= 0;
            select.appendChild(option);
        });
        return select;
    }

    function renderModules(host) {
        var modules = state.settings.modules || {};
        Object.keys(modules).sort().forEach(function (key) {
            var module = clone(modules[key]);
            var node = card(key);
            var enabled = field("Włączony", module.enabled === true, "checkbox");
            var groups = groupSelect(module.accessGroupIds || []);
            var groupWrapper = el("label", "sirk-card");
            groupWrapper.appendChild(el("strong", "", "Grupy dostępu")); groupWrapper.appendChild(groups);
            var options = field("Opcje JSON", JSON.stringify(module.options || {}, null, 2), "textarea");
            node.appendChild(enabled.wrapper); node.appendChild(groupWrapper); node.appendChild(options.wrapper);
            node.appendChild(button("Zapisz moduł", function () {
                var parsed;
                try { parsed = JSON.parse(options.input.value || "{}"); }
                catch (error) { showError(error); return; }
                var update = {};
                update[key] = { enabled: enabled.input.checked, accessGroupIds: selected(groups), options: parsed };
                saveSettings({ modules: update }, host);
            }));
            host.appendChild(node);
        });
    }

    function mutateIdentity(action, payload, host) {
        api("/api/v1/admin/identity/", "POST", Object.assign({ action: action }, payload || {}))
            .then(function (result) { state.identity = result.value; render(host); })
            .catch(showError);
    }

    function roleSelect(value) {
        var select = el("select");
        roleOptions.forEach(function (role) {
            var option = el("option", "", role[1]); option.value = role[0]; option.selected = role[0] === value;
            select.appendChild(option);
        });
        return select;
    }

    function renderIdentity(host) {
        var users = card("Użytkownicy lokalni");
        var table = el("table", "sirk-settings-table");
        table.innerHTML = "<thead><tr><th>Użytkownik</th><th>Rola</th><th>Aktywny</th><th>Akcje</th></tr></thead>";
        var body = el("tbody");
        (state.identity.users || []).forEach(function (user) {
            var row = el("tr");
            row.appendChild(el("td", "", (user.displayName || user.userName) + " (" + user.userName + ")"));
            var role = roleSelect(user.role); var roleCell = el("td"); roleCell.appendChild(role); row.appendChild(roleCell);
            var enabled = el("input"); enabled.type = "checkbox"; enabled.checked = user.enabled !== false;
            var enabledCell = el("td"); enabledCell.appendChild(enabled); row.appendChild(enabledCell);
            var actions = el("td");
            actions.appendChild(button("Zapisz", function () {
                var displayName = window.prompt("Nazwa wyświetlana:", user.displayName || user.userName);
                if (displayName == null) return;
                mutateIdentity("update-user", { id: user.id, displayName: displayName, role: role.value, enabled: enabled.checked }, host);
            }));
            var remove = button("Usuń", function () {
                if (window.confirm("Usunąć konto " + user.userName + "?")) mutateIdentity("delete-user", { id: user.id }, host);
            }, true);
            if (user.role === "Break-Glass") remove.disabled = true;
            actions.appendChild(remove); row.appendChild(actions); body.appendChild(row);
        });
        table.appendChild(body); users.appendChild(table);
        var add = el("details", "sirk-card"); add.appendChild(el("summary", "", "Dodaj użytkownika"));
        var login = field("Login", ""); var name = field("Nazwa", ""); var password = field("Hasło", "", "password");
        var newRole = roleSelect("Operator L1");
        [login, name, password].forEach(function (item) { add.appendChild(item.wrapper); });
        var roleWrap = el("label", "sirk-card"); roleWrap.appendChild(el("strong", "", "Rola")); roleWrap.appendChild(newRole); add.appendChild(roleWrap);
        add.appendChild(button("Utwórz konto", function () {
            mutateIdentity("create-user", { userName: login.input.value, displayName: name.input.value, password: password.input.value, role: newRole.value }, host);
        }));
        users.appendChild(add); host.appendChild(users);

        var groups = card("Grupy dostępu");
        (state.identity.groups || []).forEach(function (group) {
            var details = el("details", "sirk-card"); details.appendChild(el("summary", "", group.name));
            var nameField = field("Nazwa", group.name); var description = field("Opis", group.description || "");
            var members = el("select"); members.multiple = true; members.size = 6;
            (state.identity.users || []).forEach(function (user) {
                var option = el("option", "", user.displayName + " (" + user.userName + ")"); option.value = user.id;
                option.selected = (group.memberIds || []).indexOf(user.id) >= 0; members.appendChild(option);
            });
            var memberWrap = el("label", "sirk-card"); memberWrap.appendChild(el("strong", "", "Członkowie")); memberWrap.appendChild(members);
            details.appendChild(nameField.wrapper); details.appendChild(description.wrapper); details.appendChild(memberWrap);
            details.appendChild(button("Zapisz grupę", function () {
                mutateIdentity("save-group", { id: group.id, name: nameField.input.value, description: description.input.value, memberIds: selected(members) }, host);
            }));
            details.appendChild(button("Usuń grupę", function () {
                if (window.confirm("Usunąć grupę " + group.name + "?")) mutateIdentity("delete-group", { id: group.id }, host);
            }, true));
            groups.appendChild(details);
        });
        var createGroup = el("details", "sirk-card"); createGroup.appendChild(el("summary", "", "Dodaj grupę"));
        var id = field("Identyfikator", ""); var groupName = field("Nazwa", ""); var groupDescription = field("Opis", "");
        [id, groupName, groupDescription].forEach(function (item) { createGroup.appendChild(item.wrapper); });
        createGroup.appendChild(button("Utwórz grupę", function () {
            mutateIdentity("save-group", { id: id.input.value, name: groupName.input.value, description: groupDescription.input.value, memberIds: [] }, host);
        }));
        groups.appendChild(createGroup); host.appendChild(groups);
    }

    function maintenance(action, body, host, restart) {
        api("/api/v1/admin/maintenance/" + action, "POST", body || {}).then(function (result) {
            if (restart) {
                clear(host); host.appendChild(card("Oczekiwanie na usługę", "Operacja została zaplanowana."));
                setTimeout(function poll() {
                    fetch("/readyz", { cache: "no-store" }).then(function (response) {
                        if (!response.ok) throw new Error("starting"); location.reload();
                    }).catch(function () { setTimeout(poll, 1500); });
                }, 4000);
                return;
            }
            state.maintenance = result.value; render(host);
        }).catch(showError);
    }

    function renderSystem(host) {
        var runtime = state.runtime || {}; var service = runtime.service || {}; var current = state.maintenance.current || {};
        var status = card("SIRK Portal .NET 10", "Stan: " + (service.ready ? "Gotowy" : "Uruchamianie") + " · PID: " + (service.processId || "—") + " · Wersja: " + (service.version || "—"));
        status.appendChild(el("p", "", "Data root: " + ((runtime.storage || {}).dataRoot || "—")));
        var restart = button("Restartuj usługę", function () {
            if (window.confirm("Zrestartować usługę SIRK Portal?")) maintenance("restart", {}, host, true);
        });
        restart.disabled = !(state.maintenance.capabilities || {}).restart; status.appendChild(restart); host.appendChild(status);

        var updates = card("Kanał aktualizacji", "Wersja: " + (current.version || "—"));
        var channel = field("Kanał", current.channel || "dev", "select", [["stable", "Stable"], ["beta", "Beta"], ["dev", "Dev"]]);
        updates.appendChild(channel.wrapper);
        updates.appendChild(button("Zapisz kanał", function () { maintenance("channel", { channel: channel.input.value }, host, false); }));
        updates.appendChild(button("Sprawdź aktualizacje", function () { maintenance("check", {}, host, false); }));
        updates.appendChild(el("p", "", (state.maintenance.remote || {}).updateAvailable ? "Dostępna jest aktualizacja." : "System jest aktualny dla skonfigurowanego kanału."));
        host.appendChild(updates);

        var backups = card("Backup danych Portalu");
        backups.appendChild(button("Utwórz backup", function () { maintenance("backup", { reason: "manual-ui" }, host, false); }));
        (state.maintenance.backups || []).forEach(function (backup) {
            var row = el("div", "sirk-toolbar"); row.appendChild(el("strong", "", backup.id));
            row.appendChild(el("span", "", new Date(backup.createdAt).toLocaleString() + " · " + Math.round((backup.sizeBytes || 0) / 1024) + " KiB"));
            var restore = button("Przywróć", function () {
                if (window.confirm("Przywrócić backup? Usługa zostanie zrestartowana.")) maintenance("restore", { id: backup.id }, host, true);
            });
            restore.disabled = !(state.maintenance.capabilities || {}).restore; row.appendChild(restore);
            row.appendChild(button("Usuń", function () {
                if (window.confirm("Usunąć backup?")) maintenance("delete-backup", { id: backup.id }, host, false);
            }, true)); backups.appendChild(row);
        });
        if (!(state.maintenance.backups || []).length) backups.appendChild(el("p", "", "Brak backupów."));
        host.appendChild(backups);
    }

    function render(host) {
        clear(host);
        if (state.tab === "modules") renderModules(host);
        else if (state.tab === "identity") renderIdentity(host);
        else if (state.tab === "system") renderSystem(host);
        else renderPortal(host);
    }

    function mount(host) {
        clear(host);
        var root = el("section", "sirk-standalone-view-scroll"); root.setAttribute("data-portal-settings-native", "2");
        var toolbar = el("div", "sirk-toolbar"); var nav = el("div", "sirk-toolbar-group sirk-toolbar-left"); var content = el("div");
        [["portal", "Portal"], ["modules", "Moduły"], ["identity", "Użytkownicy i grupy"], ["system", "System"]].forEach(function (item) {
            var node = button(item[1], function () {
                state.tab = item[0]; Array.prototype.forEach.call(nav.children, function (child) { child.classList.toggle("active", child === node); }); render(content);
            });
            if (state.tab === item[0]) node.classList.add("active"); nav.appendChild(node);
        });
        nav.appendChild(button("Odśwież", function () {
            clear(content); content.appendChild(card("Odświeżanie…")); load().then(function () { render(content); }).catch(showError);
        }));
        toolbar.appendChild(nav); root.appendChild(toolbar); root.appendChild(content); host.appendChild(root);
        content.appendChild(card("Ładowanie ustawień…"));
        load().then(function () { render(content); }).catch(function (error) { clear(content); content.appendChild(card("Błąd", error.message)); });
    }

    window.SirkPortalSettings = { mount: mount };
}());
