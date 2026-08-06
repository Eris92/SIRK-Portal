from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, value: str) -> None:
    (ROOT / path).write_text(value, encoding="utf-8")


def replace_once(value: str, old: str, new: str, label: str) -> str:
    count = value.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, got {count}")
    return value.replace(old, new, 1)


def replace_regex(value: str, pattern: str, replacement: str, label: str) -> str:
    result, count = re.subn(pattern, lambda _match: replacement, value, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, got {count}")
    return result


# ---------------------------------------------------------------------------
# Device host tabs and wide-mode dropdown.
# ---------------------------------------------------------------------------
tabs_path = "public/portal/standalone/scripts/device-tabs.js"
tabs = read(tabs_path)
tabs = tabs.replace("__sirkPlatformDeviceTabsV16Loaded", "__sirkPlatformDeviceTabsV17Loaded")

tabs = replace_once(
    tabs,
    '        document.body.appendChild(state.menu);\n        return state.menu;',
    '        var owner = document.getElementById("sirkPortalRoot") || document.body;\n'
    '        owner.appendChild(state.menu);\n'
    '        return state.menu;',
    "mount dropdown inside themed root")

new_show_menu = '''    function showMenu(key, toggle) {
        if (!wideMode() || !state.panes[key]) {
            hideMenu();
            return;
        }
        var menu = ensureMenu();
        var pane = state.panes[key];
        state.menuKey = key;
        var activeSection = "";
        if (state.active === key && state.content) {
            var current = state.content.querySelector("[data-device-tab].is-active");
            activeSection = current && current.getAttribute("data-device-tab") || "";
        }
        var connectLabel = pane.connected
            ? (language() === "en" ? "Disconnect" : "Rozłącz")
            : (language() === "en" ? "Connect" : "Połącz");
        var connectIcon = pane.connected ? TAB_ICONS.disconnect : TAB_ICONS.connect;
        var connectDisabled = !pane.connected && !pane.online;
        var connectionButton = '<button type="button" role="menuitem" class="sirk-device-tab-menu-connection ' +
            (pane.connected ? "is-disconnect" : "is-connect") + '" data-device-tab-workspace-toggle="' + key +
            '" data-device-tab-workspace-connect="' + (pane.connected ? "0" : "1") + '"' +
            (connectDisabled ? ' disabled' : '') + '>' + connectIcon + '<span>' + connectLabel + '</span></button>';
        menu.innerHTML = connectionButton + sectionLabels().map(function (item) {
            return '<button type="button" role="menuitem" data-device-tab-section="' + item.key + '" class="' +
                (item.key === activeSection ? "is-active" : "") + '">' + item.label + '</button>';
        }).join("");
        menu.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
        positionMenu(toggle);
    }
'''
tabs = replace_regex(
    tabs,
    r"    function showMenu\(key, toggle\) \{.*?\n    \}\n\n    function renderTabs",
    new_show_menu + "\n    function renderTabs",
    "replace dropdown renderer")

tabs = replace_once(
    tabs,
    '                { key: "desktop", label: "Connection" },',
    '                { key: "desktop", label: "Desktop" },',
    "English desktop menu label")
tabs = replace_once(
    tabs,
    '                { key: "desktop", label: "Połączenie" },',
    '                { key: "desktop", label: "Pulpit" },',
    "Polish desktop menu label")

tabs = replace_once(
    tabs,
    '            shell.className = "sirk-device-tab sirk-device-host-tab" +\n                (state.active === key ? " is-active" : "") + (pane.online ? " is-online" : " is-offline") + (pane.connected ? " is-desktop-connected" : "");',
    '            shell.className = "sirk-device-tab sirk-device-host-tab" +\n'
    '                (state.active === key ? " is-active" : "") + (pane.online ? " is-online" : " is-offline") +\n'
    '                (pane.connected ? " is-desktop-connected" : "") + (wideMode() ? " has-section-menu" : "");',
    "wide menu host class")

tabs = replace_once(
    tabs,
    '            actions.appendChild(close);\n            actions.appendChild(menuToggle);',
    '            actions.appendChild(close);\n            if (wideMode()) actions.appendChild(menuToggle);',
    "only mount menu button in wide mode")

workspace_request = '''
    function requestWorkspaceConnection(key, shouldConnect) {
        var pane = state.panes[key];
        if (!pane || (shouldConnect && !pane.online)) return;
        hideMenu();
        activatePane(key, wideMode() ? "desktop" : "general");
        var attempts = 0;
        function invoke() {
            attempts += 1;
            if (!state.panes[key]) return;
            var currentId = clean(state.content && state.content.getAttribute("data-sirk-active-device-id"));
            var button = state.content && state.content.querySelector("[data-sirk-workspace-connection-toggle]");
            if (contentIsWorkspace() && currentId === pane.nodeId && button) {
                var connected = button.getAttribute("aria-pressed") === "true";
                if (connected !== shouldConnect && !button.disabled) {
                    try { button.click(); } catch (error) {}
                }
                return;
            }
            if (attempts < 180) window.setTimeout(invoke, 50);
        }
        window.setTimeout(invoke, 0);
    }

'''
tabs = replace_once(
    tabs,
    '    function requestDesktopAction(key, shouldConnect) {\n',
    workspace_request + '    function requestDesktopAction(key, shouldConnect) {\n',
    "insert workspace connection request")

tabs = replace_once(
    tabs,
    '        var connectAction = event.target && event.target.closest && event.target.closest("[data-device-tab-connect]");',
    '        var workspaceAction = event.target && event.target.closest && event.target.closest("[data-device-tab-workspace-toggle]");\n'
    '        if (workspaceAction && state.menu && state.menu.contains(workspaceAction)) {\n'
    '            event.preventDefault();\n'
    '            event.stopPropagation();\n'
    '            if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();\n'
    '            requestWorkspaceConnection(\n'
    '                workspaceAction.getAttribute("data-device-tab-workspace-toggle"),\n'
    '                workspaceAction.getAttribute("data-device-tab-workspace-connect") === "1");\n'
    '            return;\n'
    '        }\n\n'
    '        var connectAction = event.target && event.target.closest && event.target.closest("[data-device-tab-connect]");',
    "handle workspace connection menu action")

tabs = replace_once(
    tabs,
    '        if (menuToggle && state.bar.contains(menuToggle)) {\n            event.preventDefault();',
    '        if (menuToggle && state.bar.contains(menuToggle)) {\n'
    '            event.preventDefault();\n'
    '            if (!wideMode()) { hideMenu(); return; }',
    "block dropdown outside wide mode")

old_desktop_listener = '''        window.addEventListener("sirkportal:desktopconnectionstate", function (event) {
            var detail = event && event.detail || {};
            var nodeId = clean(detail.nodeId);
            if (!nodeId) return;
            Object.keys(state.panes).some(function (key) {
                var pane = state.panes[key];
                if (clean(pane.nodeId) !== nodeId) return false;
                pane.connected = detail.connected === true;
                if (detail.connected !== true && state.pendingDesktopAction[key] === "disconnect-close") {
                    delete state.pendingDesktopAction[key];
                    window.setTimeout(function () { closeTab(key); }, 0);
                    return true;
                }
                renderTabs();
                return true;
            });
        });'''
new_desktop_listener = '''        window.addEventListener("sirkportal:workspaceconnectionstate", function (event) {
            var detail = event && event.detail || {};
            var nodeId = clean(detail.nodeId);
            if (!nodeId) return;
            Object.keys(state.panes).some(function (key) {
                var pane = state.panes[key];
                if (clean(pane.nodeId) !== nodeId) return false;
                pane.connected = detail.connected === true;
                renderTabs();
                persist();
                if (state.menuKey === key && state.menu && !state.menu.hidden) {
                    var toggle = state.bar.querySelector('[data-device-tab-menu-toggle="' + key + '"]');
                    showMenu(key, toggle);
                }
                return true;
            });
        });
        window.addEventListener("sirkportal:desktopconnectionstate", function (event) {
            var detail = event && event.detail || {};
            var nodeId = clean(detail.nodeId);
            if (!nodeId) return;
            Object.keys(state.panes).some(function (key) {
                var pane = state.panes[key];
                if (clean(pane.nodeId) !== nodeId) return false;
                pane.streamConnected = detail.connected === true;
                if (detail.connected !== true && state.pendingDesktopAction[key] === "disconnect-close") {
                    delete state.pendingDesktopAction[key];
                    window.setTimeout(function () { closeTab(key); }, 0);
                    return true;
                }
                renderTabs();
                return true;
            });
        });'''
tabs = replace_once(tabs, old_desktop_listener, new_desktop_listener, "separate workspace and stream state")
write(tabs_path, tabs)


# ---------------------------------------------------------------------------
# Persist logical connection and selected section across F5.
# ---------------------------------------------------------------------------
connection_path = "public/portal/standalone/scripts/workspace-connection.js"
connection = read(connection_path)
connection = connection.replace("__sirkWorkspaceConnectionV1Loaded", "__sirkWorkspaceConnectionV2Loaded")
connection = replace_once(
    connection,
    '    var sessions = Object.create(null), current = null, queued = false;\n',
    '    var sessions = Object.create(null), current = null, queued = false;\n'
    '    var SESSION_KEY = "sirkPortal.workspaceConnections";\n',
    "workspace session key")

old_state = '''    function state(ws) {
        var key = keyOf(ws);
        if (!sessions[key]) sessions[key] = { connected: false, explicit: "general" };
        return sessions[key];
    }'''
new_state = '''    function readSaved() {
        try {
            var value = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "{}");
            return value && typeof value === "object" ? value : {};
        } catch (_) { return {}; }
    }
    function saveState(ws, value) {
        var key = keyOf(ws), saved = readSaved();
        if (value.connected) saved[key] = { connected: true, explicit: value.explicit || "general" };
        else delete saved[key];
        try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(saved)); } catch (_) {}
    }
    function state(ws) {
        var key = keyOf(ws);
        if (!sessions[key]) {
            var saved = readSaved()[key] || {};
            var explicit = ["general", "desktop", "terminal", "commands", "files", "settings"].indexOf(saved.explicit) >= 0
                ? saved.explicit : "general";
            sessions[key] = { connected: saved.connected === true, explicit: explicit };
        }
        return sessions[key];
    }
    function nodeIdOf(ws) {
        var root = ws.closest("#sirkStandaloneContent");
        return String(root && root.getAttribute("data-sirk-active-device-id") || "");
    }
    function publishWorkspaceState(ws, value, isOnline) {
        var detail = { nodeId: nodeIdOf(ws), connected: value.connected === true && isOnline === true,
            section: value.explicit || "general" };
        if (!detail.nodeId) return;
        try { window.dispatchEvent(new CustomEvent("sirkportal:workspaceconnectionstate", { detail: detail })); } catch (_) {}
        try {
            if (window.top && window.top !== window)
                window.top.dispatchEvent(new window.top.CustomEvent("sirkportal:workspaceconnectionstate", { detail: detail }));
        } catch (_) {}
    }'''
connection = replace_once(connection, old_state, new_state, "persistent workspace state")

connection = replace_once(
    connection,
    '        if (button) { s.explicit = "general"; try { button.click(); } catch (_) {} }',
    '        if (button) { s.explicit = "general"; saveState(ws, s); try { button.click(); } catch (_) {} }',
    "persist general section")

connection = replace_once(
    connection,
    '                if (s.connected) { desktopStop(ws); s.connected = false; s.explicit = "general"; general(ws, s); }\n                else { s.connected = true; s.explicit = "general"; }\n                syncWorkspace(ws);',
    '                if (s.connected) { desktopStop(ws); s.connected = false; s.explicit = "general"; general(ws, s); }\n'
    '                else { s.connected = true; s.explicit = "general"; }\n'
    '                saveState(ws, s);\n'
    '                syncWorkspace(ws);',
    "persist toggle state")

old_sync = '''    function syncWorkspace(ws) {
        if (!ws || !ws.isConnected || !nav(ws)) return;
        var s = state(ws), isOnline = online(ws);
        if (!isOnline && s.connected) { desktopStop(ws); s.connected = false; s.explicit = "general"; }
        paintToggle(toggle(ws, s), s.connected, isOnline);
        gate(ws, s, isOnline);
        if (active(ws) !== "general" && (!s.connected || s.explicit !== active(ws))) general(ws, s);
        desktopStart(ws, s);
    }'''
new_sync = '''    function syncWorkspace(ws) {
        if (!ws || !ws.isConnected || !nav(ws)) return;
        var s = state(ws), isOnline = online(ws);
        if (!isOnline && s.connected) {
            desktopStop(ws);
            s.connected = false;
            s.explicit = "general";
            saveState(ws, s);
        }
        paintToggle(toggle(ws, s), s.connected, isOnline);
        gate(ws, s, isOnline);
        publishWorkspaceState(ws, s, isOnline);
        if (s.connected && s.explicit !== active(ws)) {
            var requested = nav(ws).querySelector('[data-device-tab="' + s.explicit + '"]');
            if (requested && !requested.disabled) {
                try { requested.click(); } catch (_) {}
                return;
            }
        }
        if (active(ws) !== "general" && !s.connected) general(ws, s);
        desktopStart(ws, s);
    }'''
connection = replace_once(connection, old_sync, new_sync, "restore section and connection")

connection = replace_once(
    connection,
    '        if (ws !== current) { current = ws; state(ws).explicit = "general"; }',
    '        if (ws !== current) current = ws;',
    "do not reset restored section")

connection = replace_once(
    connection,
    '        if (type && (type === "general" || state(ws).connected)) state(ws).explicit = type;',
    '        if (type && (type === "general" || state(ws).connected)) {\n'
    '            var value = state(ws);\n'
    '            value.explicit = type;\n'
    '            saveState(ws, value);\n'
    '        }',
    "persist explicit section")

connection = replace_once(
    connection,
    '        if (close && current) { var key = keyOf(current), s2 = state(current); desktopStop(current); s2.connected = false; s2.explicit = "general"; if (close.matches("[data-device-tab-close]")) delete sessions[key]; }',
    '        if (close && current) {\n'
    '            var key = keyOf(current), s2 = state(current);\n'
    '            desktopStop(current);\n'
    '            s2.connected = false;\n'
    '            s2.explicit = "general";\n'
    '            saveState(current, s2);\n'
    '            publishWorkspaceState(current, s2, online(current));\n'
    '            if (close.matches("[data-device-tab-close]")) delete sessions[key];\n'
    '        }',
    "clear persisted state on explicit close")

connection = replace_once(
    connection,
    '        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-host-tab.is-online{border-color:transparent!important;background:var(--sirk-sidebar-active,#2b3b55)!important;color:#edf4ff!important;box-shadow:inset 3px 0 0 #16a34a,inset 0 0 0 1px rgba(255,255,255,.06)!important}",\n'
    '        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-host-tab.is-offline{border-color:transparent!important;background:var(--sirk-sidebar-active,#2b3b55)!important;color:#edf4ff!important;box-shadow:inset 3px 0 0 #dc2626,inset 0 0 0 1px rgba(255,255,255,.06)!important}",\n'
    '        "#sirkPortalRoot.sirk-theme-dark .sirk-device-tabs-standalone .sirk-device-host-tab.is-online{background:var(--sirk-sidebar-active,#2b3b55)!important;color:#edf4ff!important}",\n'
    '        "#sirkPortalRoot.sirk-theme-dark .sirk-device-tabs-standalone .sirk-device-host-tab.is-offline{background:var(--sirk-sidebar-active,#2b3b55)!important;color:#edf4ff!important}",',
    '        "#sirkPortalRoot:not(.sirk-theme-dark) .sirk-device-tabs-standalone .sirk-device-host-tab.is-online{border-color:transparent!important;background:var(--sirk-hover,#eef3f9)!important;color:var(--sirk-text,#172033)!important;box-shadow:inset 3px 0 0 #16a34a,inset 0 0 0 1px var(--sirk-border,#dce3ec)!important}",\n'
    '        "#sirkPortalRoot:not(.sirk-theme-dark) .sirk-device-tabs-standalone .sirk-device-host-tab.is-offline{border-color:transparent!important;background:var(--sirk-hover,#eef3f9)!important;color:var(--sirk-text,#172033)!important;box-shadow:inset 3px 0 0 #dc2626,inset 0 0 0 1px var(--sirk-border,#dce3ec)!important}",\n'
    '        "#sirkPortalRoot.sirk-theme-dark .sirk-device-tabs-standalone .sirk-device-host-tab.is-online{border-color:transparent!important;background:var(--sirk-sidebar-active,#2b3b55)!important;color:#edf4ff!important;box-shadow:inset 3px 0 0 #16a34a,inset 0 0 0 1px rgba(255,255,255,.06)!important}",\n'
    '        "#sirkPortalRoot.sirk-theme-dark .sirk-device-tabs-standalone .sirk-device-host-tab.is-offline{border-color:transparent!important;background:var(--sirk-sidebar-active,#2b3b55)!important;color:#edf4ff!important;box-shadow:inset 3px 0 0 #dc2626,inset 0 0 0 1px rgba(255,255,255,.06)!important}",',
    "theme-aware host card")
write(connection_path, connection)


# ---------------------------------------------------------------------------
# Make every workspace pane deterministic and never silently blank.
# ---------------------------------------------------------------------------
workspace_path = "public/portal/standalone/scripts/device-workspace.js"
workspace = read(workspace_path)
workspace = workspace.replace("__sirkPlatformPortalDeviceWorkspaceLoaded", "__sirkPlatformPortalDeviceWorkspaceV2Loaded")

old_initialize = '''    function initializeWorkspacePanes(node) {
        var general = workspacePane("general");
        var terminal = workspacePane("terminal");
        var files = workspacePane("files");
        var settings = workspacePane("settings");
        var desktop = workspacePane("desktop");
        if (!general || !terminal || !files || !settings || !desktop) return;
        renderGeneral(general, node);
        renderAgentTerminal(terminal, node);
        renderAgentFiles(files, node);
        renderAgentSettings(settings);
        renderAgentDesktop(desktop, node);
        [general, terminal, files, settings, desktop].forEach(function (pane) {
            pane.setAttribute("data-device-pane-ready", "1");
        });
    }'''
new_initialize = '''    function renderWorkspacePane(pane, node, type) {
        if (!pane || pane.getAttribute("data-device-pane-ready") === "1") return;
        try {
            if (type === "general") renderGeneral(pane, node);
            else if (type === "terminal") renderAgentTerminal(pane, node);
            else if (type === "files") renderAgentFiles(pane, node);
            else if (type === "settings") renderAgentSettings(pane);
            else if (type === "desktop") renderAgentDesktop(pane, node);
            pane.setAttribute("data-device-pane-ready", "1");
        } catch (error) {
            pane.setAttribute("data-device-pane-ready", "error");
            pane.innerHTML = '<div class="sirk-device-command-error"><strong>' + esc(t(type)) +
                '</strong><br>' + esc(error && error.message || String(error)) + '</div>';
            try { console.error("SIRK workspace pane failed:", type, error); } catch (_) {}
        }
    }

    function initializeWorkspacePanes(node) {
        ["general", "terminal", "files", "settings", "desktop"].forEach(function (type) {
            renderWorkspacePane(workspacePane(type), node, type);
        });
    }'''
workspace = replace_once(workspace, old_initialize, new_initialize, "safe pane initialization")

workspace = replace_once(
    workspace,
    '        Array.prototype.forEach.call(body.querySelectorAll("[data-device-pane]"), function (pane) {\n            pane.hidden = pane.getAttribute("data-device-pane") !== activeTab;\n        });\n        var pane = workspacePane(activeTab);',
    '        Array.prototype.forEach.call(body.querySelectorAll("[data-device-pane]"), function (pane) {\n'
    '            var selected = pane.getAttribute("data-device-pane") === activeTab;\n'
    '            pane.hidden = !selected;\n'
    '            pane.classList.toggle("is-active", selected);\n'
    '            pane.setAttribute("aria-hidden", selected ? "false" : "true");\n'
    '        });\n'
    '        var pane = workspacePane(activeTab);\n'
    '        if (pane && activeTab !== "commands" && (!pane.firstElementChild || pane.getAttribute("data-device-pane-ready") === "error")) {\n'
    '            pane.removeAttribute("data-device-pane-ready");\n'
    '            renderWorkspacePane(pane, node, activeTab);\n'
    '        }',
    "explicit active pane state")

workspace = replace_once(
    workspace,
    '                return \'<section class="sirk-device-tab-pane" data-device-pane="\' + type + \'"\' +\n                    (type === activeTab ? "" : " hidden") + \'>\</section>\';',
    '                return \'<section class="sirk-device-tab-pane\' + (type === activeTab ? " is-active" : "") +\n'
    '                    \'" data-device-pane="\' + type + \'" aria-hidden="\' + (type === activeTab ? "false" : "true") + \'"\' +\n'
    '                    (type === activeTab ? "" : " hidden") + \'>\</section>\';',
    "initial active pane class")
write(workspace_path, workspace)


# ---------------------------------------------------------------------------
# Presentation fixes: smaller red X, themed menu/card, active pane display.
# ---------------------------------------------------------------------------
tabs_css_path = "public/portal/standalone/styles/device-tabs.css"
tabs_css = read(tabs_css_path)
tabs_css += r'''

/* SIRK_DEVICE_TABS_LIFECYCLE_V3 */
#sirkPortalRoot .sirk-device-host-tab:not(.has-section-menu) .sirk-device-tab-actions{
    grid-template-rows:1fr!important;
}
#sirkPortalRoot .sirk-device-host-tab:not(.has-section-menu) .sirk-device-tab-close{
    grid-row:1 / span 2!important;
    border-bottom:0!important;
}
#sirkPortalRoot .sirk-device-host-tab:not(.has-section-menu) .sirk-device-tab-menu-toggle{
    display:none!important;
}
#sirkPortalRoot .sirk-device-tab-close{
    background:transparent!important;
    color:rgba(239,68,68,.72)!important;
    opacity:1!important;
}
#sirkPortalRoot .sirk-device-tab-close:hover,
#sirkPortalRoot .sirk-device-tab-close:focus-visible{
    background:transparent!important;
    color:#ef4444!important;
}
#sirkPortalRoot .sirk-device-tab-close svg{
    width:12px!important;
    height:12px!important;
    stroke-width:2!important;
}
#sirkPortalRoot .sirk-device-tab-menu{
    min-width:196px;
    border-color:var(--sirk-border,#dce3ec);
    background:var(--sirk-panel,#fff);
    color:var(--sirk-text,#172033);
}
#sirkPortalRoot.sirk-theme-dark .sirk-device-tab-menu{
    --sirk-panel:#111827;
    --sirk-hover:#1d293b;
    --sirk-text:#e7edf7;
    --sirk-border:#2a374a;
    background:#111827;
    color:#e7edf7;
}
#sirkPortalRoot .sirk-device-tab-menu-connection{
    gap:8px;
    margin-bottom:4px;
    border-bottom:1px solid var(--sirk-border,#dce3ec);
    border-radius:7px 7px 3px 3px;
    font-weight:700;
}
#sirkPortalRoot .sirk-device-tab-menu-connection svg{
    flex:0 0 15px;
    width:15px;
    height:15px;
    fill:none;
    stroke:currentColor;
    stroke-width:2;
    stroke-linecap:round;
    stroke-linejoin:round;
}
#sirkPortalRoot .sirk-device-tab-menu-connection.is-connect{color:#15803d}
#sirkPortalRoot .sirk-device-tab-menu-connection.is-disconnect{color:#dc2626}
#sirkPortalRoot.sirk-theme-dark .sirk-device-tab-menu-connection.is-connect{color:#86efac}
#sirkPortalRoot.sirk-theme-dark .sirk-device-tab-menu-connection.is-disconnect{color:#fca5a5}
#sirkPortalRoot .sirk-device-tab-menu-connection:disabled{opacity:.42;cursor:not-allowed}
'''
write(tabs_css_path, tabs_css)

workspace_css_path = "public/portal/standalone/styles/device-workspace.css"
workspace_css = read(workspace_css_path)
workspace_css += r'''

/* SIRK_DEVICE_WORKSPACE_PANES_V3 */
.sirk-device-tab-body{display:block!important;position:relative!important}
.sirk-device-tab-pane{display:none!important;width:100%;height:100%;min-height:0;overflow:auto}
.sirk-device-tab-pane.is-active{display:block!important}
.sirk-device-tab-pane[data-device-pane="desktop"].is-active{display:block!important;overflow:hidden}
.sirk-device-tab-pane[data-device-pane="terminal"].is-active{display:flex!important;flex-direction:column}
.sirk-device-tab-pane[data-device-pane="settings"].is-active{display:block!important}
'''
write(workspace_css_path, workspace_css)


# ---------------------------------------------------------------------------
# Contracts.
# ---------------------------------------------------------------------------
contract_path = "tests/Sirk.Portal.ProtocolTests/DeviceHostTabSplitContract.cs"
contract = read(contract_path)
contract = replace_once(
    contract,
    '                connectionScript.Contains("background:var(--sirk-sidebar-active,#2b3b55)", StringComparison.Ordinal) &&\n'
    '                connectionScript.Contains("inset 3px 0 0 #16a34a", StringComparison.Ordinal) &&\n'
    '                connectionScript.Contains("inset 3px 0 0 #dc2626", StringComparison.Ordinal),\n'
    '            "Host tabs must hide per-tab connection actions and reuse the sidebar active style with online/offline accents.");',
    '                connectionScript.Contains("#sirkPortalRoot:not(.sirk-theme-dark)", StringComparison.Ordinal) &&\n'
    '                connectionScript.Contains("#sirkPortalRoot.sirk-theme-dark", StringComparison.Ordinal) &&\n'
    '                connectionScript.Contains("inset 3px 0 0 #16a34a", StringComparison.Ordinal) &&\n'
    '                connectionScript.Contains("inset 3px 0 0 #dc2626", StringComparison.Ordinal),\n'
    '            "Host tabs must hide duplicate connection actions and switch their active color with the Portal theme.");',
    "theme contract")
contract = replace_once(
    contract,
    '        Require(connectionScript.Contains("[data-agent-desktop-connect]", StringComparison.Ordinal) &&',
    '        Require(tabsScript.Contains("data-device-tab-workspace-toggle", StringComparison.Ordinal) &&\n'
    '                tabsScript.Contains("if (!wideMode()", StringComparison.Ordinal) &&\n'
    '                connectionScript.Contains("sessionStorage", StringComparison.Ordinal) &&\n'
    '                connectionScript.Contains("sirkportal:workspaceconnectionstate", StringComparison.Ordinal),\n'
    '            "The dropdown must be wide-mode only, start with Connect/Disconnect and restore logical connection state after refresh.");\n\n'
    '        Require(connectionScript.Contains("[data-agent-desktop-connect]", StringComparison.Ordinal) &&',
    "lifecycle contract")
write(contract_path, contract)

connection_contract_path = "tests/Sirk.Portal.ProtocolTests/DeviceConnectionWorkspaceContract.cs"
connection_contract = read(connection_contract_path)
connection_contract = replace_once(
    connection_contract,
    '        Require(workspace.Contains("ensureCompactCommands(host)", StringComparison.Ordinal),\n            "Normal Desktop must retain standard Quick Commands.");',
    '        Require(workspace.Contains("ensureCompactCommands(host)", StringComparison.Ordinal),\n'
    '            "Normal Desktop must retain standard Quick Commands.");\n'
    '        Require(workspace.Contains("pane.classList.toggle(\\\"is-active\\\"", StringComparison.Ordinal) &&\n'
    '                workspace.Contains("renderWorkspacePane", StringComparison.Ordinal),\n'
    '            "Workspace sections must use explicit active panes and surface renderer failures instead of showing a blank view.");',
    "workspace pane contract")
write(connection_contract_path, connection_contract)

# The workflow commits only product/test changes.
for relative in [
    ".github/scripts/device-tabs-lifecycle-v3.py",
    ".github/workflows/one-shot-device-tabs-lifecycle-v3.yml",
]:
    path = ROOT / relative
    if path.exists():
        path.unlink()
