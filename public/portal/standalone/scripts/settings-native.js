(function () {
    "use strict";

    var state = {
        active: "general",
        settings: null,
        identity: null,
        runtime: null,
        maintenance: null,
        csrf: "",
        busy: false
    };

    var roles = [
        ["BreakGlass", "Break-Glass"],
        ["SecAdmin", "Security Administrator"],
        ["Admin", "Administrator"],
        ["EngineerL3", "Engineer L3"],
        ["SupportL2", "Support L2"],
        ["OperatorL1", "Operator L1"],
        ["Auditor", "Auditor"]
    ];

    function element(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function clear(node) {
        while (node.firstChild) node.removeChild(node.firstChild);
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value == null ? {} : value));
    }

    function message(host, text, error) {
        var node = element("div", "sirk-card", text);
        node.setAttribute("data-error", error ? "1" : "0");
        host.appendChild(node);
        return node;
    }

    function parse(response) {
        return response.text().then(function (text) {
            var payload = {};
            try { payload = text ? JSON.parse(text) : {}; }
            catch (error) { throw new Error("HTTP " + response.status + ": invalid JSON response"); }
            if (response.status === 401) {
                window.location.replace("/login");
                throw new Error("Authentication required.");
            }
            if (!response.ok || payload.ok === false) {
                throw new Error(payload.error || payload.title || ("HTTP " + response.status));
            }
            return payload;
        });
    }

    function csrf() {
        if (state.csrf) return Promise.resolve(state.csrf);
        return fetch("/api/v1/auth/csrf", {
            credentials: "same-origin",
            cache: "no-store",
            headers: { Accept: "application/json" }
        }).then(parse).then(function (payload) {
            state.csrf = String(payload.requestToken || "");
            if (!state.csrf) throw new Error("CSRF token could not be issued.");
            return state.csrf;
        });
    }

    function request(path, options) {
        options = options || {};
        var method = String(options.method || "GET").toUpperCase();
        function send() {
            var headers = new Headers(options.headers || {});
            headers.set("Accept", "application/json");
            if (!/^(GET|HEAD|OPTIONS)$/.test(method)) {
                headers.set("Content-Type", "application/json; charset=UTF-8");
                headers.set("X-SIRK-CSRF", state.csrf);
            }
            return fetch(path, {
                method: method,
                credentials: "same-origin",
                cache: "no-store",
                headers: headers,
                body: options.body == null ? undefined : JSON.stringify(options.body)
            }).then(parse);
        }
        return /^(GET|HEAD|OPTIONS)$/.test(method) ? send() : csrf().then(send);
    }

    function load() {
        return Promise.all([
            request("/api/v1/admin/settings"),
            request("/api/v1/admin/identity/"),
            request("/api/v1/admin/runtime"),
            request("/api/v1/admin/maintenance/status")
        ]).then(function (values) {
            state.settings = values[0].value;
            state.identity = values[1].value;
            state.runtime = values[2];
            state.maintenance = values[3].value;
        });
    }

    function inputField(label, value, options) {
        options = options || {};
        var wrapper = element("label", "sirk-card");
        wrapper.appendChild(element("strong", "", label));
        if (options.description) wrapper.appendChild(element("small", "", options.description));
        var input;
        if (options.type === "boolean") {
            input = element("input");
            input.type = "checkbox";
            input.checked = value === true;
        } else if (options.choices) {
            input = element("select");
            options.choices.forEach(function (choice) {
                var option = element("option", "", choice[1]);
                option.value = choice[0];
                option.selected = String(value == null ? "" : value) === String(choice[0]);
                input.appendChild(option);
            });
        } else if (options.multiline) {
            input = element("textarea");
            input.value = value == null ? "" : String(value);
            input.rows = options.rows || 8;
        } else {
            input = element("input");
            input.type = options.type || "text";
            input.value = value == null ? "" : String(value);
            if (options.placeholder) input.placeholder = options.placeholder;
        }
        wrapper.appendChild(input);
        return { wrapper: wrapper, input: input };
    }

    function button(label, action, className) {
        var node = element("button", className || "sirk-button", label);
        node.type = "button";
        node.onclick = action;
        return node;
    }

    function setBusy(value) {
        state.busy = value;
        document.querySelectorAll("[data-portal-settings-native] button").forEach(function (node) {
            node.disabled = value || node.getAttribute("data-force-disabled") === "1";
        });
    }

    function saveSettings(payload, host, success) {
        setBusy(true);
        request("/api/v1/admin/settings", { method: "PUT", body: payload })
            .then(function (result) {
                state.settings = result.value;
                clear(host);
                message(host, success || "Ustawienia zostały zapisane.", false);
                renderActive(host);
            })
            .catch(function (error) { window.alert(error.message); })
            .then(function () { setBusy(false); });
    }

    function renderGeneral(host) {
        var portal = clone(state.settings && state.settings.portal || {});
        var card = element("section", "sirk-card");
        card.appendChild(element("h2", "", "Portal"));
        card.appendChild(element("p", "", "Podstawowe ustawienia natywnego SIRK Portal .NET 10."));

        var siteName = inputField("Nazwa Portalu", portal.siteName || "SIRK Portal");
        var defaultView = inputField("Widok startowy", portal.defaultView || "overview", {
            choices: [
                ["overview", "Overview"], ["devices", "Urządzenia"],
                ["approvals", "Akceptacje"], ["automation", "Automatyzacja"],
                ["monitoring", "Monitoring"], ["assets", "Zasoby"],
                ["management", "Zarządzanie"], ["reports", "Raporty"],
                ["security", "Bezpieczeństwo"]
            ]
        });
        var resetEnabled = inputField("Pokaż reset hasła", portal.showPasswordReset !== false, { type: "boolean" });
        var resetUrl = inputField("Adres resetu hasła", portal.passwordResetUrl || "");
        var bannerPortal = inputField("Banner w Portalu", !!(portal.banner && portal.banner.showOnPortal), { type: "boolean" });
        var bannerLogin = inputField("Banner na logowaniu", !!(portal.banner && portal.banner.showOnLogin), { type: "boolean" });
        [siteName, defaultView, resetEnabled, resetUrl, bannerPortal, bannerLogin].forEach(function (field) {
            card.appendChild(field.wrapper);
        });
        card.appendChild(button("Zapisz ustawienia Portalu", function () {
            portal.siteName = siteName.input.value.trim() || "SIRK Portal";
            portal.defaultView = defaultView.input.value;
            portal.showPasswordReset = resetEnabled.input.checked;
            portal.passwordResetUrl = resetUrl.input.value.trim();
            portal.banner = portal.banner || {};
            portal.banner.showOnPortal = bannerPortal.input.checked;
            portal.banner.showOnLogin = bannerLogin.input.checked;
            saveSettings({ portal: portal }, host, "Ustawienia Portalu zostały zapisane.");
        }));
        host.appendChild(card);

        var views = element("section", "sirk-card");
        views.appendChild(element("h2", "", "Widoczność zakładek"));
        var viewState = portal.views || {};
        Object.keys(viewState).sort().forEach(function (key) {
            var field = inputField(key, viewState[key] && viewState[key].enabled !== false, { type: "boolean" });
            field.input.onchange = function () {
                viewState[key] = Object.assign({}, viewState[key] || {}, { enabled: field.input.checked });
            };
            views.appendChild(field.wrapper);
        });
        views.appendChild(button("Zapisz widoczność", function () {
            portal.views = viewState;
            saveSettings({ portal: portal }, host, "Widoczność zakładek została zapisana.");
        }));
        host.appendChild(views);
    }

    function groupChoices(selected) {
        var select = element("select");
        select.multiple = true;
        select.size = Math.max(4, Math.min(10, (state.identity.groups || []).length || 4));
        (state.identity.groups || []).forEach(function (group) {
            var option = element("option", "", group.name);
            option.value = group.id;
            option.selected = (selected || []).indexOf(group.id) >= 0;
            select.appendChild(option);
        });
        return select;
    }

    function selectedValues(select) {
        return Array.prototype.filter.call(select.options, function (item) { return item.selected; })
            .map(function (item) { return item.value; });
    }

    function renderModules(host) {
        var modules = clone(state.settings && state.settings.modules || {});
        Object.keys(modules).sort().forEach(function (key) {
            var value = modules[key];
            var card = element("section", "sirk-card");
            card.appendChild(element("h2", "", key));
            var enabled = inputField("Włączony", value.enabled === true, { type: "boolean" });
            var groups = groupChoices(value.accessGroupIds || []);
            var groupWrapper = element("label", "sirk-card");
            groupWrapper.appendChild(element("strong", "", "Grupy dostępu"));
            groupWrapper.appendChild(element("small", "", "Brak zaznaczenia oznacza dostęp zgodny z rolą."));
            groupWrapper.appendChild(groups);
            var options = inputField("Opcje JSON", JSON.stringify(value.options || {}, null, 2), { multiline: true, rows: 10 });
            card.appendChild(enabled.wrapper);
            card.appendChild(groupWrapper);
            card.appendChild(options.wrapper);
            card.appendChild(button("Zapisz moduł", function () {
                var parsed;
                try { parsed = JSON.parse(options.input.value || "{}"); }
                catch (error) { window.alert("Nieprawidłowy JSON: " + error.message); return; }
                var update = {};
                update[key] = {
                    enabled: enabled.input.checked,
                    accessGroupIds: selectedValues(groups),
                    options: parsed
                };
                saveSettings({ modules: update }, host, "Moduł " + key + " został zapisany.");
            }));
            host.appendChild(card);
        });
    }

    function mutateIdentity(action, payload, host) {
        setBusy(true);
        request("/api/v1/admin/identity/", {
            method: "POST",
            body: Object.assign({ action: action }, payload || {})
        }).then(function (result) {
            state.identity = result.value;
            renderIdentity(host);
        }).catch(function (error) {
            window.alert(error.message);
        }).then(function () { setBusy(false); });
    }

    function roleSelect(value) {
        var field = inputField("Rola", value, { choices: roles });
        return field.input;
    }

    function renderIdentity(host) {
        clear(host);
        var usersCard = element("section", "sirk-card");
        usersCard.appendChild(element("h2", "", "Użytkownicy lokalni"));
        var table = element("table", "sirk-settings-table");
        table.innerHTML = "<thead><tr><th>Użytkownik</th><th>Rola</th><th>Stan</th><th>Akcje</th></tr></thead>";
        var body = element("tbody");
        (state.identity.users || []).forEach(function (user) {
            var row = element("tr");
            var name = element("td");
            name.appendChild(element("strong", "", user.displayName || user.userName));
            name.appendChild(element("small", "", " " + user.userName));
            row.appendChild(name);
            var role = roleSelect(user.role);
            var roleCell = element("td"); roleCell.appendChild(role); row.appendChild(roleCell);
            var enabled = element("input"); enabled.type = "checkbox"; enabled.checked = user.enabled !== false;
            var enabledCell = element("td"); enabledCell.appendChild(enabled); row.appendChild(enabledCell);
            var actions = element("td");
            actions.appendChild(button("Zapisz", function () {
                var displayName = window.prompt("Nazwa wyświetlana:", user.displayName || user.userName);
                if (displayName == null) return;
                mutateIdentity("update-user", {
                    id: user.id,
                    displayName: displayName,
                    role: role.value,
                    enabled: enabled.checked
                }, host);
            }));
            var remove = button("Usuń", function () {
                if (window.confirm("Usunąć konto " + user.userName + "?")) {
                    mutateIdentity("delete-user", { id: user.id }, host);
                }
            }, "sirk-button sirk-button-danger");
            if (user.role === "BreakGlass") {
                remove.disabled = true;
                remove.setAttribute("data-force-disabled", "1");
            }
            actions.appendChild(remove);
            row.appendChild(actions);
            body.appendChild(row);
        });
        table.appendChild(body);
        usersCard.appendChild(table);

        var create = element("details", "sirk-card");
        create.appendChild(element("summary", "", "Dodaj użytkownika"));
        var username = inputField("Login", "");
        var displayName = inputField("Nazwa", "");
        var password = inputField("Hasło", "", { type: "password" });
        var role = roleSelect("OperatorL1");
        create.appendChild(username.wrapper);
        create.appendChild(displayName.wrapper);
        create.appendChild(password.wrapper);
        var roleWrapper = element("label", "sirk-card");
        roleWrapper.appendChild(element("strong", "", "Rola"));
        roleWrapper.appendChild(role);
        create.appendChild(roleWrapper);
        create.appendChild(button("Utwórz konto", function () {
            mutateIdentity("create-user", {
                userName: username.input.value,
                displayName: displayName.input.value,
                password: password.input.value,
                role: role.value
            }, host);
        }));
        usersCard.appendChild(create);
        host.appendChild(usersCard);

        var groupsCard = element("section", "sirk-card");
        groupsCard.appendChild(element("h2", "", "Grupy dostępu"));
        (state.identity.groups || []).forEach(function (group) {
            var details = element("details", "sirk-card");
            details.appendChild(element("summary", "", group.name));
            var name = inputField("Nazwa", group.name);
            var description = inputField("Opis", group.description || "");
            var members = element("select");
            members.multiple = true;
            members.size = Math.max(4, Math.min(12, (state.identity.users || []).length || 4));
            (state.identity.users || []).forEach(function (user) {
                var option = element("option", "", user.displayName + " (" + user.userName + ")");
                option.value = user.id;
                option.selected = (group.memberIds || []).indexOf(user.id) >= 0;
                members.appendChild(option);
            });
            var memberWrapper = element("label", "sirk-card");
            memberWrapper.appendChild(element("strong", "", "Członkowie"));
            memberWrapper.appendChild(members);
            details.appendChild(name.wrapper);
            details.appendChild(description.wrapper);
            details.appendChild(memberWrapper);
            details.appendChild(button("Zapisz grupę", function () {
                mutateIdentity("save-group", {
                    id: group.id,
                    name: name.input.value,
                    description: description.input.value,
                    memberIds: selectedValues(members)
                }, host);
            }));
            details.appendChild(button("Usuń grupę", function () {
                if (window.confirm("Usunąć grupę " + group.name + "?")) {
                    mutateIdentity("delete-group", { id: group.id }, host);
                }
            }, "sirk-button sirk-button-danger"));
            groupsCard.appendChild(details);
        });
        var newGroup = element("details", "sirk-card");
        newGroup.appendChild(element("summary", "", "Dodaj grupę"));
        var groupId = inputField("Identyfikator", "", { placeholder: "np. it-support" });
        var groupName = inputField("Nazwa", "");
        var groupDescription = inputField("Opis", "");
        newGroup.appendChild(groupId.wrapper);
        newGroup.appendChild(groupName.wrapper);
        newGroup.appendChild(groupDescription.wrapper);
        newGroup.appendChild(button("Utwórz grupę", function () {
            mutateIdentity("save-group", {
                id: groupId.input.value,
                name: groupName.input.value,
                description: groupDescription.input.value,
                memberIds: []
            }, host);
        }));
        groupsCard.appendChild(newGroup);
        host.appendChild(groupsCard);
    }

    function maintenanceAction(action, body, host, success, waitForRestart) {
        setBusy(true);
        request("/api/v1/admin/maintenance/" + action, { method: "POST", body: body || {} })
            .then(function (result) {
                if (waitForRestart) {
                    clear(host);
                    message(host, success || "Operacja została zaplanowana. Oczekiwanie na usługę…", false);
                    window.setTimeout(function poll() {
                        fetch("/readyz", { cache: "no-store" }).then(function (response) {
                            if (!response.ok) throw new Error("starting");
                            window.location.reload();
                        }).catch(function () { window.setTimeout(poll, 1500); });
                    }, 4000);
                    return;
                }
                state.maintenance = result.value;
                renderSystem(host);
                if (success) window.alert(success);
            }).catch(function (error) {
                window.alert(error.message);
            }).then(function () { setBusy(false); });
    }

    function renderSystem(host) {
        clear(host);
        var runtime = state.runtime || {};
        var service = runtime.service || {};
        var card = element("section", "sirk-card");
        card.appendChild(element("h2", "", "SIRK Portal .NET 10"));
        card.appendChild(element("p", "", "Stan: " + (service.ready ? "Gotowy" : "Uruchamianie") + " · PID: " + (service.processId || "—") + " · Wersja: " + (service.version || "—")));
        card.appendChild(element("p", "", "Data root: " + ((runtime.storage || {}).dataRoot || "—")));
        var restart = button("Restartuj usługę", function () {
            if (window.confirm("Zrestartować usługę SIRK Portal?")) {
                maintenanceAction("restart", {}, host, "Restart usługi został zaplanowany.", true);
            }
        });
        if (!(state.maintenance.capabilities || {}).restart) {
            restart.disabled = true;
            restart.setAttribute("data-force-disabled", "1");
        }
        card.appendChild(restart);
        host.appendChild(card);

        var updates = element("section", "sirk-card");
        updates.appendChild(element("h2", "", "Aktualizacje i kanał"));
        var current = state.maintenance.current || {};
        updates.appendChild(element("p", "", "Wersja: " + (current.version || "—") + " · Kanał: " + (current.channel || "—")));
        var channel = inputField("Kanał", current.channel || "dev", {
            choices: [["stable", "Stable"], ["beta", "Beta"], ["dev", "Dev"]]
        });
        updates.appendChild(channel.wrapper);
        updates.appendChild(button("Zapisz kanał", function () {
            maintenanceAction("channel", { channel: channel.input.value }, host, "Kanał został zapisany.");
        }));
        updates.appendChild(button("Sprawdź aktualizacje", function () {
            maintenanceAction("check", {}, host, "Sprawdzanie zakończone.");
        }));
        var remote = state.maintenance.remote || {};
        updates.appendChild(element("p", "", remote.updateAvailable
            ? "Dostępna wersja: " + remote.availableVersion
            : "Brak nowszej wersji w skonfigurowanym kanale."));
        host.appendChild(updates);

        var backups = element("section", "sirk-card");
        backups.appendChild(element("h2", "", "Backup danych Portalu"));
        backups.appendChild(button("Utwórz backup", function () {
            maintenanceAction("backup", { reason: "manual-ui" }, host, "Backup został utworzony.");
        }));
        (state.maintenance.backups || []).forEach(function (backup) {
            var row = element("div", "sirk-toolbar");
            row.appendChild(element("strong", "", backup.id));
            row.appendChild(element("span", "", new Date(backup.createdAt).toLocaleString() + " · " + Math.round((backup.sizeBytes || 0) / 1024) + " KiB"));
            var restore = button("Przywróć", function () {
                if (window.confirm("Przywrócić backup " + backup.id + "? Usługa zostanie zrestartowana.")) {
                    maintenanceAction("restore", { id: backup.id }, host, "Przywracanie zostało zaplanowane.", true);
                }
            });
            if (!(state.maintenance.capabilities || {}).restore) {
                restore.disabled = true;
                restore.setAttribute("data-force-disabled", "1");
            }
            row.appendChild(restore);
            row.appendChild(button("Usuń", function () {
                if (window.confirm("Usunąć backup " + backup.id + "?")) {
                    maintenanceAction("delete-backup", { id: backup.id }, host, "Backup został usunięty.");
                }
            }, "sirk-button sirk-button-danger"));
            backups.appendChild(row);
        });
        if (!(state.maintenance.backups || []).length) {
            backups.appendChild(element("p", "", "Brak backupów."));
        }
        host.appendChild(backups);

        var history = element("section", "sirk-card");
        history.appendChild(element("h2", "", "Historia maintenance"));
        var pre = element("pre", "sirk-card", JSON.stringify((state.maintenance.history || []).slice(0, 100), null, 2));
        history.appendChild(pre);
        host.appendChild(history);
    }

    function renderActive(host) {
        clear(host);
        if (state.active === "modules") renderModules(host);
        else if (state.active === "identity") renderIdentity(host);
        else if (state.active === "system") renderSystem(host);
        else renderGeneral(host);
    }

    function mount(host) {
        clear(host);
        var root = element("section", "sirk-standalone-view-scroll");
        root.setAttribute("data-portal-settings-native", "1");
        var toolbar = element("div", "sirk-toolbar");
        var nav = element("div", "sirk-toolbar-group sirk-toolbar-left");
        var content = element("div", "sirk-settings-native-content");
        [
            ["general", "Portal"],
            ["modules", "Moduły"],
            ["identity", "Użytkownicy i grupy"],
            ["system", "System"]
        ].forEach(function (item) {
            var node = button(item[1], function () {
                state.active = item[0];
                Array.prototype.forEach.call(nav.children, function (child) {
                    child.classList.toggle("active", child === node);
                });
                renderActive(content);
            }, "sirk-button" + (state.active === item[0] ? " active" : ""));
            nav.appendChild(node);
        });
        nav.appendChild(button("Odśwież", function () {
            setBusy(true);
            clear(content);
            message(content, "Odświeżanie…", false);
            load().then(function () { renderActive(content); })
                .catch(function (error) { clear(content); message(content, error.message, true); })
                .then(function () { setBusy(false); });
        }));
        toolbar.appendChild(nav);
        root.appendChild(toolbar);
        root.appendChild(content);
        host.appendChild(root);
        message(content, "Ładowanie ustawień natywnych…", false);
        load().then(function () { renderActive(content); })
            .catch(function (error) { clear(content); message(content, error.message, true); });
    }

    window.SirkPortalSettings = { mount: mount };
}());
