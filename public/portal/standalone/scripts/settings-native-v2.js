(function () {
    "use strict";

    var state = {
        tab: "portal",
        section: "general",
        settings: null,
        identity: null,
        runtime: null,
        maintenance: null,
        central: null,
        computerGroups: null,
        issuedEnrollment: null,
        issuedAccessCode: null,
        csrf: "",
        host: null,
        page: null,
        mountGeneration: 0
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
        return fetch(portalApiPath("auth/csrf"), { credentials: "same-origin", cache: "no-store" })
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

    function portalApiPath(path) {
        var base = String(window.__SIRK_PLATFORM_API_BASE__ || "/api/v1").replace(/\/+$/, "");
        return base + "/" + String(path || "").replace(/^\/+/, "");
    }

    function installerFileName(response, fallback) {
        var disposition = response.headers.get("Content-Disposition") || "";
        var match = /filename\*?=(?:UTF-8''|\")?([^\";]+)/i.exec(disposition);
        return match
            ? decodeURIComponent(match[1].replace(/^\"|\"$/g, ""))
            : fallback;
    }

    function downloadAgentInstaller(groupId, channel, validMinutes, status, control) {
        control.disabled = true;
        status.textContent = "Generowanie jednorazowego instalatora EXE…";
        issueCsrf().then(function (token) {
            return fetch(
                portalApiPath("admin/agent-groups/" + encodeURIComponent(groupId) + "/installer"),
                {
                    method: "POST",
                    credentials: "same-origin",
                    cache: "no-store",
                    headers: {
                        Accept: "application/vnd.microsoft.portable-executable, application/json",
                        "Content-Type": "application/json; charset=UTF-8",
                        "X-SIRK-CSRF": token
                    },
                    body: JSON.stringify({ channel: channel, validMinutes: validMinutes })
                });
        }).then(function (response) {
            if (!response.ok) {
                return response.text().then(function (text) {
                    var payload = {};
                    try { payload = text ? JSON.parse(text) : {}; } catch (_) {}
                    throw new Error(payload.error || payload.title || ("HTTP " + response.status));
                });
            }
            var expires = response.headers.get("X-SIRK-Installer-Expires-At");
            var name = installerFileName(response, "SIRK-Agent-" + groupId + "-Installer.exe");
            return response.blob().then(function (blob) {
                if (blob.size < 4096) throw new Error("Wygenerowany instalator jest nieprawidłowo mały.");
                return { blob: blob, name: name, expires: expires };
            });
        }).then(function (download) {
            var url = URL.createObjectURL(download.blob);
            var link = el("a");
            link.href = url;
            link.download = download.name;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            status.textContent = "Pobrano " + download.name + ". Bilet jest jednorazowy" +
                (download.expires ? " i ważny do " + new Date(download.expires).toLocaleString() : "") + ".";
        }).catch(function (error) {
            status.textContent = error && error.message || "Nie udało się wygenerować instalatora.";
            status.classList.add("sirk-error");
        }).then(function () {
            control.disabled = false;
        });
    }

    function renderAgentInstaller(host) {
        var snapshot = state.computerGroups || { groups: [] };
        var groups = (snapshot.groups || []).filter(function (item) { return item.enabled !== false; });
        var cardNode = el("section", "sirk-card sirk-agent-installer-panel");
        cardNode.setAttribute("data-sirk-agent-installer-panel", "1");
        cardNode.appendChild(el("h2", "", "Instalator SIRK Agent EXE"));
        cardNode.appendChild(el(
            "p",
            "sirk-muted",
            "Pobierz gotowy instalator przypisany do grupy. EXE zawiera krótkotrwały, jednorazowy bilet zamiast stałego tokenu grupy."));

        if (!groups.length) {
            cardNode.appendChild(el("p", "sirk-muted", "Najpierw utwórz aktywną grupę komputerów."));
            host.appendChild(cardNode);
            return;
        }

        var group = field("Grupa komputerów", groups[0].id, "select", groups.map(function (item) {
            return [item.id, item.name + " (" + item.id + ")"];
        }));
        var channel = field("Kanał Agenta", "dev", "select", [["stable", "Stable"], ["dev", "Dev"]]);
        var lifetime = field("Ważność przed pierwszym użyciem", "1440", "select", [
            ["60", "1 godzina"], ["480", "8 godzin"], ["1440", "24 godziny"], ["10080", "7 dni"]
        ]);
        cardNode.appendChild(group.wrapper);
        cardNode.appendChild(channel.wrapper);
        cardNode.appendChild(lifetime.wrapper);

        var actions = actionRow();
        var status = el("span", "sirk-muted", "Każdy wygenerowany plik rejestruje tylko jedno urządzenie.");
        var download = button("Pobierz instalator EXE", function () {
            status.classList.remove("sirk-error");
            downloadAgentInstaller(
                group.input.value,
                channel.input.value,
                Number(lifetime.input.value),
                status,
                download);
        });
        actions.appendChild(download);
        actions.appendChild(status);
        cardNode.appendChild(actions);
        host.appendChild(cardNode);
    }

    function load() {
        return Promise.all([
            api("/api/v1/admin/settings"),
            api("/api/v1/admin/identity/"),
            api("/api/v1/admin/runtime"),
            api("/api/v1/admin/maintenance/status"),
            api("/api/v1/admin/central"),
            api("/api/v1/admin/computer-groups")
        ]).then(function (values) {
            state.settings = values[0].value;
            state.identity = values[1].value;
            state.runtime = values[2];
            state.maintenance = values[3].value;
            state.central = values[4].value;
            state.computerGroups = values[5].value;
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
            { key: "views", label: "Widoczność zakładek" },
            { key: "central", label: "Połączenie z Central" }
        ];
        if (state.tab === "modules") return Object.keys((state.settings && state.settings.modules) || {}).sort().map(function (key) {
            return { key: key, label: key };
        });
        if (state.tab === "identity") return [
            { key: "break-glass", label: "Break-Glass" },
            { key: "users", label: "Użytkownicy lokalni" },
            { key: "groups", label: "Grupy dostępu" },
            { key: "computer-groups", label: "Grupy komputerów" }
        ];
        return [
            { key: "runtime", label: "Usługa i runtime" },
            { key: "updates", label: "Aktualizacje" },
            { key: "history", label: "Historia aktualizacji" },
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
        state.page.toolbar.querySelectorAll("[data-settings-toolbar-tab]").forEach(function (node) {
            node.classList.toggle("is-active", node.getAttribute("data-settings-toolbar-tab") === state.tab);
        });
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


    function renderBreakGlass(host) {
        var account = (state.identity.users || []).find(function (user) { return user.role === "Break-Glass"; });
        var node = card("Break-Glass", "Awaryjne logowanie lokalne jest dostępne wyłącznie przez prawidłowy Access URL. Kod nie jest przechowywany w postaci możliwej do odczytania.");
        var status = el("div", "sirk-status-grid");
        status.appendChild(el("span", "", "Konto: " + (account ? (account.userName + " · " + (account.enabled ? "aktywne" : "wyłączone")) : "brak")));
        status.appendChild(el("span", "", "Ścieżka logowania: /login#access=..."));
        status.appendChild(el("span", "", "Rotacja Access Code natychmiast unieważnia poprzedni adres."));
        node.appendChild(status);

        if (state.issuedAccessCode) {
            var issued = el("section", "sirk-card sirk-one-time-token");
            issued.appendChild(el("strong", "", "Nowy Access Code — wyświetlany tylko teraz"));
            issued.appendChild(el("code", "", state.issuedAccessCode));
            var accessUrl = location.origin + "/login#access=" + state.issuedAccessCode;
            issued.appendChild(el("code", "", accessUrl));
            var issuedActions = actionRow();
            issuedActions.appendChild(button("Kopiuj Access URL", function () { copyText(accessUrl); }));
            issuedActions.appendChild(button("Ukryj", function () { state.issuedAccessCode = null; renderAll(); }));
            issued.appendChild(issuedActions);
            node.appendChild(issued);
        }

        var passwordCard = el("section", "sirk-card");
        passwordCard.appendChild(el("h3", "", "Zmień hasło Break-Glass"));
        passwordCard.appendChild(el("p", "sirk-muted", "Po zmianie hasła bieżąca sesja zostanie zakończona."));
        var current = field("Aktualne hasło", "", "password");
        var next = field("Nowe hasło", "", "password");
        var confirm = field("Powtórz nowe hasło", "", "password");
        [current, next, confirm].forEach(function (item) { passwordCard.appendChild(item.wrapper); });
        var passwordActions = actionRow();
        passwordActions.appendChild(button("Zmień hasło", function () {
            if (next.input.value.length < 14) { showError(new Error("Nowe hasło musi mieć minimum 14 znaków.")); return; }
            if (next.input.value !== confirm.input.value) { showError(new Error("Nowe hasła nie są identyczne.")); return; }
            api("/api/v1/auth/password", "POST", {
                currentPassword: current.input.value,
                newPassword: next.input.value
            }).then(function () {
                window.alert("Hasło zostało zmienione. Zaloguj się ponownie.");
                location.replace("/login");
            }).catch(showError);
        }));
        passwordCard.appendChild(passwordActions);
        node.appendChild(passwordCard);

        var rotateCard = el("section", "sirk-card");
        rotateCard.appendChild(el("h3", "", "Rotuj Access Code"));
        rotateCard.appendChild(el("p", "sirk-muted", "Nowy kod zostanie pokazany tylko raz. Zapisz pełny Access URL w bezpiecznym miejscu."));
        var rotatePassword = field("Aktualne hasło", "", "password");
        rotateCard.appendChild(rotatePassword.wrapper);
        var rotateActions = actionRow();
        rotateActions.appendChild(button("Wygeneruj nowy Access Code", function () {
            if (!window.confirm("Unieważnić obecny Access Code i wygenerować nowy?")) return;
            api("/api/v1/auth/break-glass/access-code/rotate", "POST", {
                currentPassword: rotatePassword.input.value
            }).then(function (result) {
                state.issuedAccessCode = String(result.accessCode || "");
                if (!state.issuedAccessCode) throw new Error("Portal nie zwrócił nowego Access Code.");
                renderAll();
            }).catch(showError);
        }, true));
        rotateCard.appendChild(rotateActions);
        node.appendChild(rotateCard);
        host.appendChild(node);
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

    function slug(value) {
        var result = String(value || "").trim().toLowerCase()
            .replace(/[^a-z0-9._-]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .replace(/-+/g, "-");
        return result.length >= 3 ? result.slice(0, 96) : "group-" + Date.now().toString(36);
    }

    function copyText(value) {
        value = String(value || "");
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(value).catch(function () {});
        } else {
            window.prompt("Skopiuj wartość:", value);
        }
    }

    function renderCentral(host) {
        var value = state.central || {};
        var live = value.state || {};
        var configuration = value.configuration || {};
        var node = card("Połączenie z SIRK Central", "Importuj plik bootstrap wygenerowany w Central. Token jest przechowywany w chronionym pliku i nigdy nie jest zwracany w całości.");
        var status = el("div", "sirk-status-grid");
        status.appendChild(el("strong", "", value.configured ? (live.connected ? "Połączony" : "Skonfigurowany") : "Niepołączony"));
        status.appendChild(el("span", "", "Stan: " + (live.status || "disabled")));
        status.appendChild(el("span", "", "Central: " + (configuration.centralUrl || live.centralUrl || "—")));
        status.appendChild(el("span", "", "Portal ID: " + (configuration.portalId || live.portalId || "—")));
        status.appendChild(el("span", "", "Tunnel: " + (configuration.tunnelUrl || "—")));
        status.appendChild(el("span", "", "Ostatnie połączenie: " + (live.lastSuccessAtUtc ? new Date(live.lastSuccessAtUtc).toLocaleString() : "—")));
        if (live.lastError || value.error) status.appendChild(el("span", "sirk-error", live.lastError || value.error));
        node.appendChild(status);

        var importCard = el("section", "sirk-card");
        importCard.appendChild(el("h3", "", "Import bootstrap JSON"));
        importCard.appendChild(el("p", "sirk-muted", "Wybierz plik pobrany z SIRK Central. Po zapisaniu Portal uruchomi ponownie usługę."));
        var input = el("input");
        input.type = "file";
        input.accept = "application/json,.json";
        importCard.appendChild(input);
        var payload = null;
        var message = el("span", "sirk-muted", "");
        var actions = actionRow();
        var save = button("Zapisz i uruchom ponownie", function () {
            if (!payload) return;
            save.disabled = true;
            message.textContent = "Zapisywanie…";
            api("/api/v1/admin/central", "PUT", payload).then(function (result) {
                state.central = result.value;
                message.textContent = "Konfiguracja zapisana. Restartowanie Portalu…";
                maintenance("restart", {}, true);
            }).catch(function (error) {
                save.disabled = false;
                message.textContent = error.message || String(error);
            });
        });
        save.disabled = true;
        input.onchange = function () {
            payload = null;
            save.disabled = true;
            message.textContent = "";
            var file = input.files && input.files[0];
            if (!file) return;
            if (file.size > 32768) {
                message.textContent = "Plik jest zbyt duży.";
                return;
            }
            file.text().then(function (text) {
                var parsed = JSON.parse(text);
                payload = parsed && parsed.bootstrap ? parsed.bootstrap : parsed;
                if (!payload || typeof payload !== "object") throw new Error("Nieprawidłowy plik bootstrap.");
                save.disabled = false;
                message.textContent = "Plik gotowy do importu.";
            }).catch(function (error) {
                message.textContent = error.message || String(error);
            });
        };
        actions.appendChild(save);
        if (value.configured) {
            actions.appendChild(button("Odłącz od Central", function () {
                if (!window.confirm("Usunąć konfigurację Central i uruchomić Portal ponownie?")) return;
                api("/api/v1/admin/central", "DELETE").then(function (result) {
                    state.central = result.value;
                    maintenance("restart", {}, true);
                }).catch(showError);
            }, true));
        }
        actions.appendChild(message);
        importCard.appendChild(actions);
        node.appendChild(importCard);
        host.appendChild(node);
    }

    function acceptComputerGroupResult(result) {
        state.computerGroups = result.value || { groups: [], devices: [] };
        if (result.enrollmentToken) {
            state.issuedEnrollment = { groupId: result.groupId, token: result.enrollmentToken };
        }
        renderAll();
    }

    function renderComputerGroups(host) {
        var snapshot = state.computerGroups || { groups: [], devices: [] };
        var node = card("Grupy komputerów", "Grupy urządzeń SIRK Agent. Token rejestracyjny jest wyświetlany tylko po utworzeniu grupy lub jego rotacji.");
        renderAgentInstaller(node);
        if (state.issuedEnrollment) {
            var tokenCard = el("section", "sirk-card sirk-one-time-token");
            tokenCard.appendChild(el("strong", "", "Token jednorazowy dla grupy " + state.issuedEnrollment.groupId));
            tokenCard.appendChild(el("code", "", state.issuedEnrollment.token));
            var tokenActions = actionRow();
            tokenActions.appendChild(button("Kopiuj token", function () { copyText(state.issuedEnrollment.token); }));
            tokenActions.appendChild(button("Ukryj", function () { state.issuedEnrollment = null; renderAll(); }));
            tokenCard.appendChild(tokenActions);
            node.appendChild(tokenCard);
        }

        (snapshot.groups || []).forEach(function (group) {
            var details = el("details", "sirk-card");
            details.appendChild(el("summary", "", group.name + " · " + (group.deviceCount || 0) + " urządzeń"));
            var name = field("Nazwa", group.name || "");
            var description = field("Opis", group.description || "");
            var enabled = field("Aktywna", group.enabled !== false, "checkbox");
            details.appendChild(name.wrapper);
            details.appendChild(description.wrapper);
            details.appendChild(enabled.wrapper);
            details.appendChild(el("p", "sirk-muted", "ID: " + group.id));
            var actions = actionRow();
            actions.appendChild(button("Zapisz", function () {
                api("/api/v1/admin/computer-groups/" + encodeURIComponent(group.id), "PUT", {
                    name: name.input.value,
                    description: description.input.value,
                    enabled: enabled.input.checked
                }).then(acceptComputerGroupResult).catch(showError);
            }));
            actions.appendChild(button("Rotuj token", function () {
                if (!window.confirm("Wygenerować nowy token? Poprzedni przestanie działać.")) return;
                api("/api/v1/admin/computer-groups/" + encodeURIComponent(group.id) + "/rotate-token", "POST", {})
                    .then(acceptComputerGroupResult).catch(showError);
            }));
            var remove = button("Usuń", function () {
                if (!window.confirm("Usunąć grupę " + group.name + "?")) return;
                api("/api/v1/admin/computer-groups/" + encodeURIComponent(group.id), "DELETE")
                    .then(acceptComputerGroupResult).catch(showError);
            }, true);
            remove.disabled = Number(group.deviceCount || 0) > 0;
            actions.appendChild(remove);
            details.appendChild(actions);
            node.appendChild(details);
        });

        var create = el("details", "sirk-card");
        create.appendChild(el("summary", "", "Dodaj grupę komputerów"));
        var newName = field("Nazwa", "");
        var newId = field("Identyfikator", "");
        var newDescription = field("Opis", "");
        create.appendChild(newName.wrapper);
        create.appendChild(newId.wrapper);
        create.appendChild(newDescription.wrapper);
        var createActions = actionRow();
        createActions.appendChild(button("Utwórz grupę", function () {
            var id = newId.input.value.trim() || slug(newName.input.value);
            api("/api/v1/admin/computer-groups", "POST", {
                id: id,
                name: newName.input.value,
                description: newDescription.input.value
            }).then(acceptComputerGroupResult).catch(showError);
        }));
        create.appendChild(createActions);
        node.appendChild(create);
        host.appendChild(node);
    }

    function renderUpdateHistory(host) {
        var node = card("Historia aktualizacji");
        var rows = (state.maintenance && state.maintenance.history) || [];
        if (!rows.length) node.appendChild(el("p", "sirk-muted", "Brak historii operacji aktualizacyjnych."));
        rows.forEach(function (entry) {
            var row = el("div", "sirk-history-row");
            row.appendChild(el("strong", "", entry.type || "operacja"));
            row.appendChild(el("span", "", entry.at ? new Date(entry.at).toLocaleString() : "—"));
            row.appendChild(el("span", "", entry.message || ""));
            if (entry.error) row.appendChild(el("span", "sirk-error", entry.error));
            node.appendChild(row);
        });
        host.appendChild(node);
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
        var remote = state.maintenance.remote || {};
        var capabilities = state.maintenance.capabilities || {};
        var updates = card("Aktualizacje", "Wersja: " + (current.version || "—") + " · dostępna: " + (remote.availableVersion || "—"));
        var channel = field("Kanał", current.channel || "dev", "select", [["stable", "Stable"], ["beta", "Beta"], ["dev", "Dev"]]);
        updates.appendChild(channel.wrapper);
        var actions = actionRow();
        actions.appendChild(button("Zapisz kanał", function () { maintenance("channel", { channel: channel.input.value }, false); }));
        actions.appendChild(button("Sprawdź aktualizacje", function () { maintenance("check", {}, false); }));
        var updateNow = button("Aktualizuj teraz", function () { maintenance("update", {}, true); });
        updateNow.disabled = !(capabilities.update && remote.updateAvailable);
        updateNow.title = updateNow.disabled ? "Brak nowszego zweryfikowanego pakietu aktualizacji." : "Zainstaluj zweryfikowaną aktualizację przez SIRK Updater.";
        actions.appendChild(updateNow);
        updates.appendChild(actions);
        updates.appendChild(el("p", "", remote.updateAvailable ? "Dostępna jest aktualizacja." : "System jest aktualny dla skonfigurowanego kanału."));
        if (!capabilities.update) updates.appendChild(el("p", "sirk-muted", "Przycisk uaktywni się, gdy kanał udostępni zweryfikowany pakiet obsługiwany przez SIRK Updater."));
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
            else if (state.section === "central") renderCentral(state.page.details);
            else renderPortalGeneral(state.page.details);
        } else if (state.tab === "modules") {
            renderModule(state.page.details, state.section);
        } else if (state.tab === "identity") {
            if (state.section === "break-glass") renderBreakGlass(state.page.details);
            else if (state.section === "groups") renderGroups(state.page.details);
            else if (state.section === "computer-groups") renderComputerGroups(state.page.details);
            else renderUsers(state.page.details);
        } else if (state.section === "updates") {
            renderUpdates(state.page.details);
        } else if (state.section === "history") {
            renderUpdateHistory(state.page.details);
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

    function unmount() {
        state.mountGeneration += 1;
        if (state.host) clear(state.host);
        state.host = null;
        state.page = null;
        state.settings = null;
        state.identity = null;
        state.runtime = null;
        state.maintenance = null;
        state.central = null;
        state.computerGroups = null;
        state.issuedEnrollment = null;
        state.issuedAccessCode = null;
        state.csrf = "";
    }

    function mount(host) {
        unmount();
        var generation = ++state.mountGeneration;
        clear(host);
        var root = el("section", "sirk-view-shell");
        root.setAttribute("data-sirk-view-shell", "settings");
        root.setAttribute("data-portal-settings-native", "3");
        var toolbar = el("div", "sirk-toolbar-host");
        var left = el("div", "sirk-group sirk-left");
        left.appendChild(el("strong", "", "Ustawienia"));
        tabDefinitions().forEach(function (item) {
            var tab = button(item.label, function () { state.tab = item.key; state.section = ""; renderAll(); });
            tab.classList.add("sirk-settings-toolbar-tab");
            tab.setAttribute("data-settings-toolbar-tab", item.key);
            left.appendChild(tab);
        });
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
        load().then(function () {
            if (generation !== state.mountGeneration || state.host !== host || !host.isConnected) return;
            renderAll();
        }).catch(function (error) {
            if (generation !== state.mountGeneration || state.host !== host || !host.isConnected) return;
            clear(details);
            details.appendChild(card("Błąd", error.message));
        });
    }

    window.SirkPortalSettings = { mount: mount, unmount: unmount };
}());
