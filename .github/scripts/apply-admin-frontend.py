#!/usr/bin/env python3
from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    Path(path).write_text(content, encoding="utf-8", newline="\n")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one occurrence, found {count}: {old[:100]!r}")
    write(path, content.replace(old, new, 1))


settings = "public/portal/standalone/scripts/settings-native-v2.js"
replace_once(
    settings,
    '        maintenance: null,\n        csrf: "",\n',
    '        maintenance: null,\n        central: null,\n        computerGroups: null,\n        issuedEnrollment: null,\n        csrf: "",\n',
)
replace_once(
    settings,
    '''            api("/api/v1/admin/runtime"),
            api("/api/v1/admin/maintenance/status")
        ]).then(function (values) {
            state.settings = values[0].value;
            state.identity = values[1].value;
            state.runtime = values[2];
            state.maintenance = values[3].value;
''',
    '''            api("/api/v1/admin/runtime"),
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
''',
)
replace_once(
    settings,
    '''        if (state.tab === "portal") return [
            { key: "general", label: "Ogólne" },
            { key: "views", label: "Widoczność zakładek" }
        ];
''',
    '''        if (state.tab === "portal") return [
            { key: "general", label: "Ogólne" },
            { key: "views", label: "Widoczność zakładek" },
            { key: "central", label: "Połączenie z Central" }
        ];
''',
)
replace_once(
    settings,
    '''        if (state.tab === "identity") return [
            { key: "users", label: "Użytkownicy lokalni" },
            { key: "groups", label: "Grupy dostępu" }
        ];
        return [
            { key: "runtime", label: "Usługa i runtime" },
            { key: "updates", label: "Aktualizacje" },
            { key: "backups", label: "Backupy" }
        ];
''',
    '''        if (state.tab === "identity") return [
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
''',
)

extra_functions = r'''    function slug(value) {
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

'''
replace_once(settings, "    function renderRuntime(host) {\n", extra_functions + "    function renderRuntime(host) {\n")

old_updates = '''    function renderUpdates(host) {
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
'''
new_updates = '''    function renderUpdates(host) {
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
'''
replace_once(settings, old_updates, new_updates)

replace_once(
    settings,
    '''        if (state.tab === "portal") {
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
''',
    '''        if (state.tab === "portal") {
            if (state.section === "views") renderPortalViews(state.page.details);
            else if (state.section === "central") renderCentral(state.page.details);
            else renderPortalGeneral(state.page.details);
        } else if (state.tab === "modules") {
            renderModule(state.page.details, state.section);
        } else if (state.tab === "identity") {
            if (state.section === "groups") renderGroups(state.page.details);
            else if (state.section === "computer-groups") renderComputerGroups(state.page.details);
            else renderUsers(state.page.details);
        } else if (state.section === "updates") {
            renderUpdates(state.page.details);
        } else if (state.section === "history") {
            renderUpdateHistory(state.page.details);
        } else if (state.section === "backups") {
''',
)

icon_registry = "public/shared/icon-registry.js"
replace_once(
    icon_registry,
    '''    function base() {
        var assetBase = String(window.__SIRK_PLATFORM_ASSET_BASE__ || "").replace(/\/$/, "");
        return assetBase ? assetBase + "/icons/sirk-ui.svg" : "";
    }
''',
    '''    function base() {
        var assetBase = String(window.__SIRK_PLATFORM_ASSET_BASE__ || "").replace(/\/$/, "");
        var version = encodeURIComponent(String(window.__SIRK_PLATFORM_PORTAL_VERSION__ || ""));
        return assetBase ? assetBase + "/icons/sirk-ui.svg" + (version ? "?v=" + version : "") : "";
    }
''',
)

sprite = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-labelledby="title desc">
  <title id="title">SIRK Portal</title>
  <desc id="desc">SIRK Management Platform identity mark and UI icon sprite</desc>
  <defs>
    <linearGradient id="sirkGradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5f86ff"/><stop offset="1" stop-color="#54d6c4"/></linearGradient>
    <symbol id="home" viewBox="0 0 24 24"><path d="M3 11 12 3l9 8v10H3V11Z"/><path d="M9 21v-7h6v7"/></symbol>
    <symbol id="devices" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></symbol>
    <symbol id="approval" viewBox="0 0 24 24"><path d="m4 12 5 5L20 6"/></symbol>
    <symbol id="automation" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></symbol>
    <symbol id="monitoring" viewBox="0 0 24 24"><path d="M3 12h4l2-5 4 10 2-5h6"/></symbol>
    <symbol id="assets" viewBox="0 0 24 24"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></symbol>
    <symbol id="management" viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M8 4v6M8 14v6M16 14v6M16 4v6"/></symbol>
    <symbol id="reports" viewBox="0 0 24 24"><path d="M5 20V10M12 20V4M19 20v-7M3 20h18"/></symbol>
    <symbol id="security" viewBox="0 0 24 24"><path d="M12 3 20 6v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z"/><path d="M12 8v5M12 17h.01"/></symbol>
    <symbol id="settings" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></symbol>
    <symbol id="chevron-left" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></symbol>
    <symbol id="chevron-right" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></symbol>
    <symbol id="external-link" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6H5V6h6"/></symbol>
  </defs>
  <rect width="64" height="64" rx="18" fill="url(#sirkGradient)"/>
  <path fill="#fff" d="M42.2 19.4c-2.9-1.9-6.1-2.8-9.8-2.8-6.4 0-10.9 3.4-10.9 8.6 0 5.6 4.4 7.2 9.3 8.5 3.8 1 5.5 1.7 5.5 3.7 0 2.2-1.9 3.3-5 3.3-3.4 0-6.7-1.2-9.6-3.5l-3.6 5.2c3.6 3.1 8 4.7 13.1 4.7 7.3 0 12-3.8 12-9.6 0-5.3-3.6-7.2-9.3-8.8-3.8-1.1-5.5-1.6-5.5-3.4 0-1.7 1.5-2.7 4.2-2.7 2.8 0 5.4.8 7.8 2.4l1.8-5.6Z"/>
</svg>
'''
write("public/assets/icons/sirk-ui.svg", sprite)

css_path = "public/portal/standalone/styles/module-shell.css"
css = read(css_path)
css += '''

/* Canonical icon and toolbar rendering. This stylesheet is loaded last. */
#sirkPortalRoot .sirk-standalone-nav button[data-view] > span > svg use,
#sirkPortalRoot .sirk-standalone-controls [data-action="sidebar"] svg use{
    fill:none!important;stroke:currentColor!important;stroke-width:1.8!important;
    stroke-linecap:round!important;stroke-linejoin:round!important;opacity:1!important;
}
#sirkPortalRoot .sirk-toolbar-host{
    display:flex!important;align-items:center!important;min-height:50px!important;padding:7px 10px!important;
    margin:0!important;border-bottom:1px solid var(--sirk-border,#dce3ec)!important;
    background:var(--sirk-panel,#fff)!important;box-sizing:border-box!important;
}
#sirkPortalRoot .sirk-toolbar-button{
    appearance:none!important;display:inline-grid!important;place-items:center!important;
    width:36px!important;min-width:36px!important;height:36px!important;min-height:36px!important;
    padding:0!important;border:1px solid var(--sirk-border,#dce3ec)!important;border-radius:8px!important;
    background:var(--sirk-panel,#fff)!important;color:var(--sirk-text,#172033)!important;
    box-shadow:none!important;font-size:0!important;line-height:1!important;
}
#sirkPortalRoot .sirk-toolbar-button:hover,
#sirkPortalRoot .sirk-toolbar-button.is-active{
    border-color:#75a7ff!important;background:#edf3ff!important;color:#214fbd!important;
}
#sirkPortalRoot .sirk-toolbar-icon{
    display:inline-grid!important;place-items:center!important;width:20px!important;height:20px!important;
    color:inherit!important;font-size:0!important;overflow:visible!important;
}
#sirkPortalRoot .sirk-toolbar-icon > svg{
    display:block!important;width:20px!important;height:20px!important;overflow:visible!important;
    fill:none!important;stroke:currentColor!important;stroke-width:1.8!important;
    stroke-linecap:round!important;stroke-linejoin:round!important;opacity:1!important;
}
#sirkPortalRoot .sirk-toolbar-icon > svg :is(path,rect,circle,line,polyline,polygon,ellipse,use){
    fill:none!important;stroke:currentColor!important;stroke-width:1.8!important;
    stroke-linecap:round!important;stroke-linejoin:round!important;opacity:1!important;
}
#sirkPortalRoot .sirk-one-time-token code{
    display:block;margin:10px 0;padding:10px;border:1px solid #f0c36d;border-radius:6px;
    background:#fff8e7;overflow-wrap:anywhere;font-family:Consolas,monospace;
}
#sirkPortalRoot .sirk-status-grid{display:grid;gap:6px;margin:10px 0 14px}
#sirkPortalRoot .sirk-history-row{display:grid;grid-template-columns:150px 190px minmax(220px,1fr);gap:10px;padding:9px 0;border-bottom:1px solid var(--sirk-border,#dce3ec)}
#sirkPortalRoot .sirk-error{color:#b42318}
@media(max-width:900px){#sirkPortalRoot .sirk-history-row{grid-template-columns:1fr}}
'''
write(css_path, css)

replace_once(
    "src/Sirk.Portal/Ui/PortalUiEndpoints.cs",
    'private const string AssetRevision = "canonical-modules-shell-20260803-1";',
    'private const string AssetRevision = "admin-settings-central-groups-icons-20260803-1";',
)
