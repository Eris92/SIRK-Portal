from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8-sig")


def write(path: str, value: str) -> None:
    (ROOT / path).write_text(value, encoding="utf-8", newline="\n")


def replace_once(value: str, old: str, new: str, label: str) -> str:
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return value.replace(old, new, 1)


def replace_regex(value: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, value, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one regex match, found {count}")
    return updated


workspace_path = "public/portal/standalone/scripts/device-workspace.js"
workspace = read(workspace_path)

workspace = replace_regex(
    workspace,
    r"        host\.innerHTML = '<div class=\\\"sirk-agent-operation sirk-agent-desktop\\\">.*?';\n        ensureCompactCommands\(host\);",
    """        host.innerHTML = '<div class=\\\"sirk-agent-desktop\\\"><div class=\\\"sirk-agent-desktop-stage\\\"><canvas data-agent-desktop-image aria-label=\\\"Zdalny pulpit\\\" tabindex=\\\"0\\\"></canvas><span data-agent-desktop-cursor style=\\\"display:none\\\"></span></div></div>';
        ensureCompactCommands(host);
        setCompactCommandsConnected(host, false);""",
    "replace desktop markup",
)

workspace = replace_regex(
    workspace,
    r"        var localCursor = host\.querySelector\(\"\[data-agent-desktop-cursor\]\"\);\n.*?        var policyEnable = host\.querySelector\(\"\[data-agent-policy-enable\]\"\);\n",
    """        var localCursor = host.querySelector(\"[data-agent-desktop-cursor]\");
        var status = document.createElement(\"span\");
        var selectedSessionId = 0;
        var selectedMonitorIndex = -1;
""",
    "remove desktop control references",
)

workspace = replace_once(
    workspace,
    '        var activeAutoProfile = "smooth", lastAutoChangeAt = 0, lastStatsPaintAt = 0, lastFrameAt = 0;',
    '        var activeAutoProfile = "smooth", lastAutoChangeAt = 0, lastFrameAt = 0;',
    "remove stats paint state",
)

workspace = replace_regex(
    workspace,
    r"        function effectiveProfile\(\) \{.*?        function streamProfileParameters\(settings\) \{",
    """        function effectiveProfile() {
            var base = profiles[activeAutoProfile];
            var requestedCodec = base.codec;
            return Object.assign({}, base, {
                codec: requestedCodec,
                imageEncoding: requestedCodec === \"h264\" ? \"webp\" : requestedCodec,
                frameMode: requestedCodec === \"h264\" ? \"h264\" : \"tiles\",
                quality: requestedCodec === \"png\" ? 100 : base.quality
            });
        }
        function updateCodecControls() {}
        function streamProfileParameters(settings) {""",
    "make desktop profile automatic",
)

workspace = replace_once(
    workspace,
    '            if (profile.value === "auto" && connected && now - lastAutoChangeAt > 2000) {',
    '            if (connected && now - lastAutoChangeAt > 2000) {',
    "remove profile selector dependency",
)

workspace = replace_regex(
    workspace,
    r"            if \(now - lastStatsPaintAt < 250\) return;.*?            host\.querySelector\(\"\[data-stat-backend\]\"\)\.textContent = \(data\.captureBackend \|\| \"—\"\) \+ \" · \" \+ \(data\.encoding \|\| \"—\"\);\n        \}",
    "        }",
    "remove visible desktop stats updates",
)

workspace = replace_regex(
    workspace,
    r"        var statsTimer = setInterval\(function \(\) \{.*?        \}, 250\);\n",
    "",
    "remove desktop stats timer",
)

workspace = replace_once(
    workspace,
    '            return { sessionId: Number(session.value), monitorIndex: Number(monitor.value) };',
    '            return { sessionId: selectedSessionId, monitorIndex: selectedMonitorIndex };',
    "use internal session selection",
)

workspace = replace_regex(
    workspace,
    r"        function loadMonitors\(\) \{.*?        function restartStream\(\) \{",
    """        function loadMonitors() {
            return runAgentOperation(node, \"desktop.monitors\", { sessionId: selectedSessionId }, status)
                .then(function (value) {
                    var data = desktopData(value);
                    var monitors = data.monitors || [];
                    var selectedMonitor = monitors.find(function (item) { return item.primary === true; }) ||
                        monitors[0] || null;
                    selectedMonitorIndex = selectedMonitor ? Number(selectedMonitor.index) : -1;
                });
        }
        function loadSessions() {
            return runAgentOperation(node, \"desktop.sessions\", {}, status).then(function (value) {
                var result = value.result || {};
                if (value.status === \"failed\") {
                    throw new Error(String(result.output || result.code ||
                        \"Agent odrzucił pobranie sesji.\"));
                }
                var sessions = result.data || [];
                if (!sessions.length) throw new Error(\"Agent nie zgłosił aktywnej sesji użytkownika.\");
                var selectedSession = sessions.find(function (item) { return item.active === true; }) || sessions[0];
                selectedSessionId = Number(selectedSession.sessionId);
                return loadMonitors();
            });
        }
        function restartStream() {""",
    "replace visible session and policy controls",
)

workspace = workspace.replace(
    '                    setStreamStatus("Połączono · tunel Central HTTP · " + frameDescription +\n                        " · profil " + profile.options[profile.selectedIndex].text);',
    '                    setStreamStatus("Połączono · tunel Central HTTP · " + frameDescription +\n                        " · profil auto/" + activeAutoProfile);',
)

workspace = replace_regex(
    workspace,
    r"        host\.querySelector\(\"\[data-agent-desktop-send\]\"\)\.addEventListener.*?        var observer = new MutationObserver",
    """        var reconnectTimer = 0;
        function scheduleReconnect() {
            clearTimeout(reconnectTimer);
            if (stopped || !host.isConnected || connected) return;
            reconnectTimer = setTimeout(connectDesktop, 3000);
        }
        function connectDesktop() {
            if (stopped || !host.isConnected || connected) return;
            clearTimeout(reconnectTimer);
            status.textContent = \"Nawiązywanie połączenia live…\";
            status.classList.remove(\"is-error\");
            loadSessions().then(function () {
                if (stopped || !host.isConnected) return;
                frameTimes = []; inputTimes = []; byteSamples = []; frameRenderTimes = [];
                activeAutoProfile = \"smooth\"; lastAutoChangeAt = 0; lastFrameAt = 0;
                lastTargetFps = effectiveProfile().targetFps;
                connected = true;
                setCompactCommandsConnected(host, true);
                restartStream();
            }).catch(function (error) {
                connected = false;
                setCompactCommandsConnected(host, false);
                status.textContent = error.message || String(error);
                status.classList.add(\"is-error\");
                scheduleReconnect();
            });
        }
        connectDesktop();
        var observer = new MutationObserver""",
    "replace visible desktop actions with automatic connection",
)

workspace = replace_once(
    workspace,
    "                clearInterval(statsTimer);",
    """                clearTimeout(reconnectTimer);
                if (connected) input({ action: \"streamStop\" }).catch(function () {});
                connected = false;
                setCompactCommandsConnected(host, false);""",
    "clean automatic desktop connection",
)

workspace = replace_regex(
    workspace,
    r"    function ensureCompactCommands\(host\) \{.*?    function flattenCommandScripts\(node, prefix, output\) \{",
    """    function setCompactCommandsConnected(host, connected) {
        var dock = host.querySelector(\".sirk-quick-commands-dock\");
        if (!dock) return;
        dock.hidden = !connected;
        if (connected) return;
        var panel = dock.querySelector(\"#sirkQuickCommandsPanel\");
        var toggle = dock.querySelector(\"#sirkQuickCommandsToggle\");
        if (panel) panel.hidden = true;
        if (toggle) toggle.setAttribute(\"aria-expanded\", \"false\");
    }

    function ensureCompactCommands(host) {
        var operation = host.querySelector(\".sirk-agent-desktop\") || host;
        var desktopStage = operation.querySelector(\".sirk-agent-desktop-stage\");
        if (!desktopStage || desktopStage.querySelector(\"#sirkQuickCommandsPanel\")) return;
        var dock = document.createElement(\"div\");
        dock.className = \"sirk-quick-commands-dock\";
        dock.hidden = true;
        var toggle = document.createElement(\"button\");
        toggle.type = \"button\";
        toggle.id = \"sirkQuickCommandsToggle\";
        toggle.className = \"sirk-quick-commands-toggle sirk-command-icon-button\";
        toggle.setAttribute(\"aria-expanded\", \"false\");
        toggle.title = t(\"quickCommands\");
        toggle.innerHTML = quickIcon(\"bolt\") + '<span>' + esc(t(\"quickCommands\")) + '</span>';
        var panel = document.createElement(\"aside\");
        panel.id = \"sirkQuickCommandsPanel\";
        panel.className = \"sirk-quick-commands-panel\";
        panel.hidden = true;
        dock.appendChild(toggle);
        dock.appendChild(panel);
        desktopStage.appendChild(dock);
        toggle.addEventListener(\"click\", function (event) {
            event.preventDefault();
            event.stopPropagation();
            var opening = panel.hidden;
            panel.hidden = !opening;
            toggle.setAttribute(\"aria-expanded\", opening ? \"true\" : \"false\");
            if (!opening) return;
            loadCompactCommands(false).then(renderCompactCommands).catch(function (error) {
                panel.innerHTML = '<div class=\"sirk-command-message is-error\">' +
                    esc(error.message || String(error)) + '</div>';
            });
        });
    }

    function flattenCommandScripts(node, prefix, output) {""",
    "pin quick commands inside desktop stage",
)

workspace = workspace.replace("sirk-command-error", "sirk-command-message is-error")

for removed in (
    "sirk-agent-desktop-controls",
    "sirk-agent-desktop-stats",
    "sirk-agent-desktop-admin",
    "sirk-agent-desktop-input",
    "sirk-agent-desktop-clipboard",
    "sirk-agent-policy-action",
    "sirk-agent-operation sirk-agent-desktop",
    "sirk-command-error",
):
    if removed in workspace:
        raise RuntimeError(f"Removed desktop marker still present in workspace: {removed}")

write(workspace_path, workspace)


tabs_path = "public/portal/standalone/scripts/device-tabs.js"
tabs = read(tabs_path)
tabs = replace_regex(
    tabs,
    r"    function syncQuickCommandsToggle\(\) \{.*?    function positionMenu\(toggle\) \{",
    """    function syncQuickCommandsToggle() {
        if (!state.content) return;
        var stage = state.content.querySelector(\".sirk-agent-desktop-stage\");
        var dock = stage && stage.querySelector(\".sirk-quick-commands-dock\");
        var toggle = state.content.querySelector(\"#sirkQuickCommandsToggle\");
        var panel = state.content.querySelector(\"#sirkQuickCommandsPanel\");
        if (!dock || !toggle || !panel) return;
        if (toggle.parentNode !== dock) dock.insertBefore(toggle, panel);
    }

    function positionMenu(toggle) {""",
    "keep quick commands in desktop stage",
)
if "is-header-mounted" in tabs or "state.header.insertBefore(toggle" in tabs:
    raise RuntimeError("Legacy Quick Commands header mounting remains in device-tabs.js")
write(tabs_path, tabs)


view_path = "public/portal/standalone/scripts/view-mode.js"
view = read(view_path)
view = view.replace(".sirk-agent-operation.sirk-agent-desktop", ".sirk-agent-desktop")
view = replace_regex(
    view,
    r'\n            "html\.sirk-device-connection-mode \.sirk-agent-desktop>header.*?display:none!important\}",',
    "",
    "remove obsolete hidden desktop controls rule",
)
view = replace_once(
    view,
    '            "html.sirk-device-connection-mode .sirk-quick-commands-toggle.is-header-mounted,html.sirk-device-focus-mode .sirk-quick-commands-toggle.is-header-mounted{z-index:60!important}",\n            "html.sirk-device-connection-mode .sirk-quick-commands-panel{z-index:59!important;top:8px!important;right:8px!important;bottom:8px!important}",',
    '            "html.sirk-device-connection-mode .sirk-quick-commands-dock,html.sirk-device-focus-mode .sirk-quick-commands-dock{z-index:60!important}",',
    "update expanded Quick Commands positioning",
)
if "sirk-agent-desktop-controls" in view or "is-header-mounted" in view:
    raise RuntimeError("Obsolete desktop control or header-mounted Quick Commands styles remain")
write(view_path, view)


device_css_path = "public/portal/standalone/styles/device-workspace.css"
device_css = read(device_css_path)
device_css = replace_regex(
    device_css,
    r"\.sirk-agent-desktop-pending\{.*?\.sirk-agent-desktop-clipboard\{ display:none !important; \}\n",
    """.sirk-agent-desktop{
    display:flex;
    width:100%;
    height:100%;
    min-width:0;
    min-height:0;
    overflow:hidden;
    background:#0b1020;
}
.sirk-agent-desktop-stage{
    position:relative;
    display:flex;
    flex:1 1 auto;
    width:100%;
    height:100%;
    min-width:0;
    min-height:0;
    align-items:center;
    justify-content:center;
    overflow:hidden;
    border-radius:0;
    background:#0b1020;
}
.sirk-agent-desktop-stage canvas{
    display:block;
    max-width:100%;
    max-height:100%;
    width:auto;
    height:auto;
    margin:auto;
    cursor:default;
    user-select:none;
    touch-action:none;
}
.sirk-agent-desktop-stage canvas.is-file-drop{ outline:3px solid #38bdf8; filter:brightness(.8); }
.sirk-agent-desktop-stage [data-agent-desktop-cursor]{
    position:absolute;
    width:12px;
    height:12px;
    border:2px solid #fff;
    border-radius:50%;
    background:#111;
    box-shadow:0 0 0 1px #111;
    pointer-events:none;
    transform:translate(-2px,-2px);
}
""",
    "replace desktop workspace styles",
)
for removed in (
    "sirk-agent-desktop-controls",
    "sirk-agent-desktop-stats",
    "sirk-agent-desktop-admin",
    "sirk-agent-desktop-input",
    "sirk-agent-desktop-clipboard",
    "sirk-agent-policy-action",
):
    if removed in device_css:
        raise RuntimeError(f"Removed desktop selector still present in device CSS: {removed}")
write(device_css_path, device_css)


commands_css_path = "public/shared/ui/commands.css"
commands_css = read(commands_css_path)
commands_css = replace_regex(
    commands_css,
    r"#sirkPortalRoot \.sirk-quick-commands-toggle\{.*?#sirkPortalRoot \.sirk-quick-commands-panel:has\(\.sirk-quick-command-browser\.is-collapsed\.is-details-collapsed\)\{width:.*?\}\n",
    """#sirkPortalRoot .sirk-agent-desktop{position:relative}
#sirkPortalRoot .sirk-quick-commands-dock{
    position:absolute;
    z-index:45;
    top:8px;
    right:8px;
    bottom:8px;
    display:flex;
    flex-direction:row-reverse;
    align-items:flex-start;
    gap:6px;
    max-width:calc(100% - 16px);
    pointer-events:none;
}
#sirkPortalRoot .sirk-quick-commands-dock[hidden]{display:none!important}
#sirkPortalRoot .sirk-quick-commands-toggle{
    position:relative;
    z-index:2;
    display:grid;
    place-items:center;
    flex:0 0 34px;
    width:34px;
    min-width:34px;
    height:34px;
    min-height:34px;
    padding:0;
    border-radius:9px;
    background:rgba(15,23,42,.9);
    color:#fff;
    box-shadow:0 6px 18px rgba(0,0,0,.28);
    pointer-events:auto;
}
#sirkPortalRoot .sirk-quick-commands-toggle span{display:none}
#sirkPortalRoot .sirk-quick-commands-toggle svg{width:17px;height:17px}
#sirkPortalRoot .sirk-quick-commands-panel{
    --sirk-command-primary:135px;
    --sirk-command-secondary:210px;
    --sirk-command-details:190px;
    --sirk-command-collapsed:48px;
    position:relative;
    z-index:1;
    display:grid;
    grid-template-rows:auto minmax(0,1fr);
    width:min(560px,calc(100vw - 92px));
    height:min(480px,100%);
    min-width:0;
    min-height:240px;
    overflow:hidden;
    border:1px solid var(--sirk-command-border);
    border-radius:9px;
    background:var(--sirk-command-panel);
    box-shadow:0 14px 34px rgba(15,23,42,.26);
    pointer-events:auto;
}
#sirkPortalRoot .sirk-quick-commands-panel[hidden]{display:none}
#sirkPortalRoot .sirk-quick-command-browser{
    grid-template-columns:minmax(110px,var(--sirk-command-primary)) minmax(170px,var(--sirk-command-secondary)) minmax(170px,1fr);
    font-size:12px;
}
#sirkPortalRoot .sirk-quick-command-browser.is-collapsed{
    grid-template-columns:var(--sirk-command-collapsed) minmax(180px,var(--sirk-command-secondary)) minmax(170px,1fr);
}
#sirkPortalRoot .sirk-quick-command-browser.is-details-collapsed{
    grid-template-columns:minmax(110px,var(--sirk-command-primary)) minmax(200px,1fr) 0;
}
#sirkPortalRoot .sirk-quick-command-browser.is-collapsed.is-details-collapsed{
    grid-template-columns:var(--sirk-command-collapsed) minmax(200px,1fr) 0;
}
""",
    "make Quick Commands a compact pinned dock",
)

commands_css = replace_once(
    commands_css,
    "#sirkPortalRoot .sirk-command-loading,\n#sirkPortalRoot .sirk-command-error{padding:20px;text-align:center;color:var(--sirk-command-muted)}\n#sirkPortalRoot .sirk-command-error{color:#b42318}",
    "#sirkPortalRoot .sirk-command-loading,\n#sirkPortalRoot .sirk-command-message{padding:20px;text-align:center;color:var(--sirk-command-muted)}\n#sirkPortalRoot .sirk-command-message.is-error{color:#b42318}",
    "remove sirk-command-error class",
)

commands_css = replace_regex(
    commands_css,
    r"@media\(max-width:1100px\)\{\n    #sirkPortalRoot \.sirk-device-commands-host \.sirk-layout-host,\n    #sirkPortalRoot \.sirk-quick-command-browser\{.*?\n\}",
    """@media(max-width:1100px){
    #sirkPortalRoot .sirk-device-commands-host .sirk-layout-host{
        grid-template-columns:minmax(145px,185px) minmax(250px,320px) minmax(220px,1fr);
    }
}""",
    "keep compact Quick Commands below 1100px",
)

commands_css = replace_once(
    commands_css,
    "    #sirkPortalRoot .sirk-quick-commands-panel{top:48px;left:6px;right:6px;bottom:6px;width:auto!important}",
    "    #sirkPortalRoot .sirk-quick-commands-dock{top:6px;right:6px;bottom:6px;max-width:calc(100% - 12px)}\n    #sirkPortalRoot .sirk-quick-commands-panel{width:min(520px,calc(100vw - 58px));height:100%;min-height:0}",
    "make compact dock responsive",
)

if "sirk-command-error" in commands_css or "is-header-mounted" in commands_css:
    raise RuntimeError("Legacy command error or header-mounted Quick Commands CSS remains")
write(commands_css_path, commands_css)


canvas_contract_path = "tests/Sirk.Portal.ProtocolTests/DesktopCanvasContract.cs"
canvas_contract = read(canvas_contract_path)
canvas_contract = replace_once(
    canvas_contract,
    '        var workspace = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone",\n            "scripts", "device-workspace.js"));',
    '        var workspace = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone",\n            "scripts", "device-workspace.js"));\n        var workspaceCss = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone",\n            "styles", "device-workspace.css"));',
    "load desktop CSS contract",
)
canvas_contract = replace_once(
    canvas_contract,
    '        Require(workspace.Contains("max-height:calc(100vh - 360px)", StringComparison.Ordinal),\n            "The desktop canvas must be fitted to the available viewport.");',
    '        Require(workspaceCss.Contains(".sirk-agent-desktop-stage canvas", StringComparison.Ordinal) &&\n                workspaceCss.Contains("max-height:100%", StringComparison.Ordinal),\n            "The screen-only desktop canvas must fill the available stage without extra controls.");',
    "update canvas sizing contract",
)
write(canvas_contract_path, canvas_contract)


connection_contract_path = "tests/Sirk.Portal.ProtocolTests/DeviceConnectionWorkspaceContract.cs"
connection_contract = read(connection_contract_path)
old_connection_checks = '''        Require(workspace.Contains("(desktopStage || operation).appendChild(toggle)", StringComparison.Ordinal),
            "The Quick Commands toggle must be mounted on the remote desktop stage.");
        Require(!workspace.Contains("operation.appendChild(toggle);", StringComparison.Ordinal),
            "The Quick Commands toggle must not remain outside the visible connected stage.");
        Require(commandsCss.Contains("z-index:40", StringComparison.Ordinal) &&
                commandsCss.Contains("z-index:39", StringComparison.Ordinal),
            "Quick Commands controls must have a stable overlay stacking order.");'''
new_connection_checks = '''        foreach (var removed in new[]
                 {
                     "sirk-agent-desktop-controls", "sirk-agent-desktop-stats",
                     "sirk-agent-desktop-admin", "sirk-agent-desktop-input",
                     "sirk-agent-desktop-clipboard", "sirk-agent-policy-action",
                     "sirk-agent-operation sirk-agent-desktop", "sirk-command-error"
                 })
            Require(!workspace.Contains(removed, StringComparison.Ordinal),
                "The screen-only desktop must not contain: " + removed);
        Require(workspace.Contains("desktopStage.appendChild(dock)", StringComparison.Ordinal) &&
                workspace.Contains("setCompactCommandsConnected(host, true)", StringComparison.Ordinal) &&
                workspace.Contains("connectDesktop();", StringComparison.Ordinal),
            "Quick Commands must stay inside the desktop stage and appear only after automatic connection.");
        Require(commandsCss.Contains(".sirk-quick-commands-dock", StringComparison.Ordinal) &&
                commandsCss.Contains("right:8px", StringComparison.Ordinal) &&
                commandsCss.Contains("width:min(560px", StringComparison.Ordinal),
            "Quick Commands must be a smaller pinned right-side desktop dock.");'''
connection_contract = replace_once(
    connection_contract,
    old_connection_checks,
    new_connection_checks,
    "update desktop connection contract",
)
write(connection_contract_path, connection_contract)


host_contract_path = "tests/Sirk.Portal.ProtocolTests/DeviceHostTabSplitContract.cs"
host_contract = read(host_contract_path)
host_contract = replace_once(
    host_contract,
    '        Require(tabsScript.Contains("syncQuickCommandsToggle", StringComparison.Ordinal) &&\n                tabsScript.Contains("is-header-mounted", StringComparison.Ordinal) &&\n                File.ReadAllText(Path.Combine(root, "public", "shared", "ui", "commands.css")).Contains(".sirk-quick-commands-toggle.is-header-mounted", StringComparison.Ordinal),\n            "Quick Commands must mount in the expanded header instead of being clipped by the desktop stage.");',
    '        Require(tabsScript.Contains("syncQuickCommandsToggle", StringComparison.Ordinal) &&\n                tabsScript.Contains("sirk-quick-commands-dock", StringComparison.Ordinal) &&\n                !tabsScript.Contains("state.header.insertBefore(toggle", StringComparison.Ordinal) &&\n                File.ReadAllText(Path.Combine(root, "public", "shared", "ui", "commands.css")).Contains(".sirk-quick-commands-dock", StringComparison.Ordinal),\n            "Quick Commands must remain pinned inside the connected desktop stage.");',
    "update host Quick Commands contract",
)
write(host_contract_path, host_contract)


style_contract_path = "tests/Sirk.Portal.ProtocolTests/CommandWorkspaceStyleContract.cs"
style_contract = read(style_contract_path)
style_contract = replace_once(
    style_contract,
    '                     "minmax(240px,1fr)", "is-details-collapsed",\n                     "width:min(845px,calc(100% - 16px))"',
    '                     "minmax(240px,1fr)", "is-details-collapsed",\n                     ".sirk-quick-commands-dock", "width:min(560px"',
    "update compact Quick Commands style markers",
)
style_contract = replace_once(
    style_contract,
    '        Require(!deviceCss.Contains(".sirk-quick-command", StringComparison.Ordinal) &&\n                !deviceCss.Contains(".sirk-quick-commands", StringComparison.Ordinal),\n            "Quick Commands must not retain a second style implementation in device-workspace.css.");',
    '        Require(!deviceCss.Contains(".sirk-quick-command", StringComparison.Ordinal) &&\n                !deviceCss.Contains(".sirk-quick-commands", StringComparison.Ordinal),\n            "Quick Commands must not retain a second style implementation in device-workspace.css.");\n        Require(!commandsCss.Contains("sirk-command-error", StringComparison.Ordinal) &&\n                commandsCss.Contains(".sirk-command-message.is-error", StringComparison.Ordinal),\n            "Quick Commands errors must use the compact message state instead of sirk-command-error.");',
    "add command error class contract",
)
write(style_contract_path, style_contract)

print("Desktop screen-only layout migration applied successfully.")
