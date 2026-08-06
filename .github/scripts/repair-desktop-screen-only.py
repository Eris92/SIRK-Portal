from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
WORKSPACE_PATH = "public/portal/standalone/scripts/device-workspace.js"
BASE_COMMIT = "25c1fbca395995200c14285680b8e511924f6e5b"


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


source = subprocess.check_output(
    ["git", "show", f"{BASE_COMMIT}:{WORKSPACE_PATH}"]
).decode("utf-8-sig")

start_marker = "    function renderAgentDesktop(host, node) {"
end_marker = "\n    function ensureCompactCommands(host) {"
start = source.index(start_marker)
end = source.index(end_marker, start)
prefix = source[:start]
desktop = source[start:end]
suffix = source[end:]

desktop = replace_regex(
    desktop,
    r"        host\.innerHTML = .*?;\n        ensureCompactCommands\(host\);",
    """        host.innerHTML = '<div class=\\\"sirk-agent-desktop\\\"><div class=\\\"sirk-agent-desktop-stage\\\"><canvas data-agent-desktop-image aria-label=\\\"Zdalny pulpit\\\" tabindex=\\\"0\\\"></canvas><span data-agent-desktop-cursor style=\\\"display:none\\\"></span></div></div>';
        ensureCompactCommands(host);
        setCompactCommandsConnected(host, false);""",
    "replace only renderAgentDesktop markup",
)

desktop = replace_regex(
    desktop,
    r"        var localCursor = host\.querySelector\(\"\[data-agent-desktop-cursor\]\"\);\n.*?        var policyEnable = host\.querySelector\(\"\[data-agent-policy-enable\]\"\);\n",
    """        var localCursor = host.querySelector(\"[data-agent-desktop-cursor]\");
        var status = document.createElement(\"span\");
        var selectedSessionId = 0;
        var selectedMonitorIndex = -1;
""",
    "remove desktop-only control references",
)

desktop = replace_once(
    desktop,
    '        var activeAutoProfile = "smooth", lastAutoChangeAt = 0, lastStatsPaintAt = 0, lastFrameAt = 0;',
    '        var activeAutoProfile = "smooth", lastAutoChangeAt = 0, lastFrameAt = 0;',
    "remove visible stats paint state",
)

desktop = replace_regex(
    desktop,
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
    "make desktop codec and profile automatic",
)

desktop = replace_once(
    desktop,
    '            if (profile.value === "auto" && connected && now - lastAutoChangeAt > 2000) {',
    '            if (connected && now - lastAutoChangeAt > 2000) {',
    "remove profile selector dependency",
)

desktop = replace_regex(
    desktop,
    r"            if \(now - lastStatsPaintAt < 250\) return;.*?            host\.querySelector\(\"\[data-stat-backend\]\"\)\.textContent = \(data\.captureBackend \|\| \"—\"\) \+ \" · \" \+ \(data\.encoding \|\| \"—\"\);\n        \}",
    "        }",
    "remove visible desktop statistics rendering",
)

desktop = replace_regex(
    desktop,
    r"        var statsTimer = setInterval\(function \(\) \{.*?        \}, 250\);\n",
    "",
    "remove desktop statistics timer",
)

desktop = replace_once(
    desktop,
    '            return { sessionId: Number(session.value), monitorIndex: Number(monitor.value) };',
    '            return { sessionId: selectedSessionId, monitorIndex: selectedMonitorIndex };',
    "use automatically selected session and monitor",
)

desktop = replace_regex(
    desktop,
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

desktop = replace_once(
    desktop,
    '                    setStreamStatus("Połączono · tunel Central HTTP · " + frameDescription +\n                        " · profil " + profile.options[profile.selectedIndex].text);',
    '                    setStreamStatus("Połączono · tunel Central HTTP · " + frameDescription +\n                        " · profil auto/" + activeAutoProfile);',
    "remove profile selector from tunnel status",
)

desktop = replace_regex(
    desktop,
    r"        host\.querySelector\(\"\[data-agent-desktop-send\]\"\)\.addEventListener.*?        var observer = new MutationObserver",
    """        var reconnectTimer = 0;
        function scheduleReconnect() {
            clearTimeout(reconnectTimer);
            if (stopped || connected) return;
            reconnectTimer = setTimeout(connectDesktop, 3000);
        }
        function connectDesktop() {
            if (stopped || connected) return;
            if (!host.isConnected) {
                scheduleReconnect();
                return;
            }
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

desktop = replace_once(
    desktop,
    "                clearInterval(statsTimer);",
    """                clearTimeout(reconnectTimer);
                if (connected) input({ action: \"streamStop\" }).catch(function () {});
                connected = false;
                setCompactCommandsConnected(host, false);""",
    "clean automatic desktop connection",
)

workspace = prefix + desktop + suffix
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
    "pin Quick Commands inside the desktop stage",
)
workspace = workspace.replace("sirk-command-error", "sirk-command-message is-error")

for marker in (
    "function renderAgentTerminal(host, node)",
    "data-agent-terminal-command",
    "function renderAgentFiles(host, node)",
    "data-agent-files-path",
    "function renderAgentDesktop(host, node)",
    "var stopped = false",
    "connectDesktop();",
    "desktopStage.appendChild(dock)",
    "setCompactCommandsConnected(host, true)",
):
    if marker not in workspace:
        raise RuntimeError(f"Required workspace marker is missing: {marker}")

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
        raise RuntimeError(f"Removed desktop marker still remains: {removed}")

(ROOT / WORKSPACE_PATH).write_text(workspace, encoding="utf-8", newline="\n")

contract_path = ROOT / "tests" / "Sirk.Portal.ProtocolTests" / "DeviceConnectionWorkspaceContract.cs"
contract = contract_path.read_text(encoding="utf-8-sig")
needle = '''        var commandsCss = File.ReadAllText(Path.Combine(root, "public", "shared", "ui", "commands.css"));
'''
insert = '''        var commandsCss = File.ReadAllText(Path.Combine(root, "public", "shared", "ui", "commands.css"));

        Require(workspace.Contains("function renderAgentTerminal(host, node)", StringComparison.Ordinal) &&
                workspace.Contains("data-agent-terminal-command", StringComparison.Ordinal) &&
                workspace.Contains("function renderAgentFiles(host, node)", StringComparison.Ordinal) &&
                workspace.Contains("data-agent-files-path", StringComparison.Ordinal) &&
                workspace.Contains("function renderAgentDesktop(host, node)", StringComparison.Ordinal),
            "Desktop simplification must preserve the Terminal and Files workspaces.");
'''
if "Desktop simplification must preserve the Terminal and Files workspaces." not in contract:
    contract = replace_once(contract, needle, insert, "add Terminal and Files preservation contract")
contract_path.write_text(contract, encoding="utf-8", newline="\n")

print("Scoped desktop workspace repair applied successfully.")
