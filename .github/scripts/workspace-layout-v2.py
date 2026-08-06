from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, got {count}")
    return text.replace(old, new, 1)


root = Path(__file__).resolve().parents[2]
workspace_path = root / "public/portal/standalone/scripts/device-workspace.js"
workspace = workspace_path.read_text(encoding="utf-8")

workspace = replace_once(
    workspace,
    '            general: "Ogólne", desktop: "Pulpit", terminal: "Terminal", commands: "Polecenia", files: "Pliki",',
    '            general: "Ogólne", desktop: "Pulpit", terminal: "Terminal", commands: "Polecenia", files: "Pliki", settings: "Ustawienia",',
    "Polish Settings label")
workspace = replace_once(
    workspace,
    '            general: "Overview", desktop: "Desktop", terminal: "Terminal", commands: "Commands", files: "Files",',
    '            general: "Overview", desktop: "Desktop", terminal: "Terminal", commands: "Commands", files: "Files", settings: "Settings",',
    "English Settings label")

lines = workspace.splitlines()
terminal_index = next((i for i, line in enumerate(lines)
    if 'host.innerHTML = \'<div class="sirk-agent-operation"><header><strong>Terminal SIRK Agent' in line), None)
if terminal_index is None:
    raise SystemExit("Terminal renderer line was not found.")
lines[terminal_index] = '''        host.innerHTML = '<div class="sirk-agent-desktop-admin"><strong>Pulpit administracyjny</strong><select data-agent-admin-tool><option value="powershell">PowerShell SYSTEM</option><option value="computer-management">Zarządzanie komputerem</option><option value="services">Usługi</option><option value="registry">Edytor rejestru</option><option value="task-manager">Menedżer zadań</option><option value="event-viewer">Podgląd zdarzeń</option><option value="device-manager">Menedżer urządzeń</option></select><button type="button" data-agent-admin-start disabled>Uruchom w sesji użytkownika</button></div><div class="sirk-agent-operation sirk-agent-terminal"><header><strong>Terminal SIRK Agent</strong><small>PowerShell uruchamiany przez usługę na urządzeniu</small></header><textarea data-agent-terminal-command spellcheck="false" placeholder="Get-ComputerInfo | Select-Object WindowsProductName, OsVersion"></textarea><div class="sirk-agent-operation-actions"><button type="button" data-agent-terminal-run>Uruchom</button></div><pre data-agent-operation-status>Gotowy.</pre></div>';'''

desktop_index = next((i for i, line in enumerate(lines)
    if 'host.innerHTML = \'<div class="sirk-agent-operation sirk-agent-desktop"><header><strong>Pulpit SIRK Agent Live' in line), None)
if desktop_index is None:
    raise SystemExit("Desktop renderer line was not found.")
lines[desktop_index] = '''        host.innerHTML = '<div class="sirk-agent-operation sirk-agent-desktop"><div class="sirk-agent-desktop-stage" style="position:relative;display:flex;justify-content:center;align-items:center;overflow:hidden;min-height:240px"><canvas data-agent-desktop-image aria-label="Zdalny pulpit" tabindex="0" style="display:block;max-width:100%;max-height:calc(100vh - 260px);width:auto;height:auto;margin:0 auto;touch-action:none"></canvas><span data-agent-desktop-cursor style="position:absolute;width:12px;height:12px;border:2px solid #fff;border-radius:50%;background:#111;box-shadow:0 0 0 1px #111;pointer-events:none;transform:translate(-2px,-2px)"></span></div><div class="sirk-agent-desktop-input"><input data-agent-desktop-text placeholder="Tekst do aktywnego okna"><button type="button" data-agent-desktop-send>Wyślij tekst</button><select data-agent-desktop-key><option>Enter</option><option>Tab</option><option>Escape</option><option>Backspace</option><option>Delete</option><option>Up</option><option>Down</option><option>Left</option><option>Right</option><option>Home</option><option>End</option><option>PageUp</option><option>PageDown</option><option>F5</option></select><button type="button" data-agent-desktop-key-send>Klawisz</button></div><div class="sirk-agent-desktop-clipboard"><textarea data-agent-desktop-clipboard placeholder="Schowek wybranej sesji"></textarea><button type="button" data-agent-desktop-clipboard-get>Pobierz schowek</button><button type="button" data-agent-desktop-clipboard-set>Ustaw schowek</button></div><div class="sirk-agent-policy-action" data-agent-policy-action hidden><button type="button" data-agent-policy-enable>Włącz zdalny pulpit dla urządzenia</button></div><pre data-agent-operation-status>Gotowy do natychmiastowego połączenia.</pre></div>';'''
workspace = "\n".join(lines) + ("\n" if workspace.endswith("\n") else "")

settings_renderer = r'''
    function renderAgentSettings(host) {
        host.innerHTML = '<div class="sirk-agent-operation sirk-agent-desktop-settings"><div class="sirk-agent-desktop-controls"><label>Sesja<select data-agent-desktop-session disabled></select></label><label>Monitor<select data-agent-desktop-monitor disabled><option value="-1">Wszystkie monitory</option></select></label><label>Profil<select data-agent-desktop-profile><option value="auto">Auto</option><option value="smooth">Płynny GUI 120 Hz</option><option value="text">Ostry tekst</option><option value="video">Wideo H.264</option><option value="weak">Słabe łącze</option><option value="minimum">Minimalny transfer</option></select></label><label>Kodek<select data-agent-desktop-codec><option value="auto">Auto (profil)</option><option value="webp">WebP</option><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="h264">H.264</option></select></label><label>Jakość<select data-agent-desktop-quality><option value="auto">Auto (profil)</option><option value="40">40%</option><option value="50">50%</option><option value="60">60%</option><option value="70">70%</option><option value="80">80%</option><option value="85">85%</option><option value="90">90%</option><option value="100">100%</option></select></label><button type="button" data-agent-desktop-connect>Połącz</button><button type="button" data-agent-desktop-disconnect disabled>Rozłącz</button></div><div class="sirk-agent-desktop-stats" data-agent-desktop-stats><span>FPS <b data-stat-fps>0</b></span><span>latencja p50/p95 <b data-stat-latency>—</b></span><span>input dispatch <b data-stat-input>—</b></span><span>capture/encode/session/decode/render <b data-stat-pipeline>—</b></span><span>bitrate <b data-stat-bitrate>0</b></span><span>delta <b data-stat-delta>—</b></span><span>łącze <b data-stat-link>pomiar…</b></span><span>backend <b data-stat-backend>—</b></span></div></div>';
    }

'''
workspace = replace_once(
    workspace,
    "    function renderAgentFiles(host, node) {\n",
    settings_renderer + "    function renderAgentFiles(host, node) {\n",
    "Settings renderer insertion")
workspace = replace_once(
    workspace,
    "    function renderAgentDesktop(host, node) {\n        var stopped = false;\n",
    "    function renderAgentDesktop(host, node) {\n        var stopped = false;\n        var workspaceRoot = host.closest(\".sirk-device-workspace\") || host;\n",
    "Desktop workspace root")

for name in [
    "session", "monitor", "profile", "codec", "quality",
    "connectButton", "disconnectButton", "adminTool", "adminStart"
]:
    workspace = replace_once(
        workspace,
        f"        var {name} = host.querySelector(",
        f"        var {name} = workspaceRoot.querySelector(",
        f"{name} query scope")
workspace = workspace.replace('host.querySelector("[data-stat-', 'workspaceRoot.querySelector("[data-stat-')

new_layout = r'''    function workspacePane(type) {
        var body = document.getElementById("sirkDeviceTabBody");
        return body && body.querySelector('[data-device-pane="' + type + '"]');
    }

    function initializeWorkspacePanes(node) {
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
    }

    function renderTab(node, type) {
        var tabs = ["general", "desktop", "terminal", "commands", "files", "settings"];
        activeTab = tabs.indexOf(type) >= 0 ? type : "general";
        var workspace = content && content.querySelector(".sirk-device-workspace");
        var body = document.getElementById("sirkDeviceTabBody");
        var navigation = workspace && workspace.querySelector(":scope > .sirk-device-tabs");
        if (!workspace || !body || !navigation) return;
        Array.prototype.forEach.call(navigation.querySelectorAll("[data-device-tab]"), function (button) {
            var active = button.getAttribute("data-device-tab") === activeTab;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-selected", active ? "true" : "false");
        });
        Array.prototype.forEach.call(body.querySelectorAll("[data-device-pane]"), function (pane) {
            pane.hidden = pane.getAttribute("data-device-pane") !== activeTab;
        });
        var pane = workspacePane(activeTab);
        if (activeTab === "commands" && pane && pane.getAttribute("data-device-pane-ready") !== "1") {
            pane.setAttribute("data-device-pane-ready", "1");
            renderCommandsTab(pane, node);
        }
        body.setAttribute("data-active-device-pane", activeTab);
    }

    function renderWorkspace(node) {
        if (!content || !node) return;
        selectedNode = node;
        var online = nodeOnline(node);
        var tabs = ["general", "desktop", "terminal", "commands", "files", "settings"];
        content.innerHTML = '<div class="sirk-device-workspace"><nav class="sirk-device-tabs" role="tablist">' +
            tabs.map(function (type) {
                return '<button type="button" role="tab" data-device-tab="' + type + '">' + esc(t(type)) + '</button>';
            }).join("") + '<div class="sirk-device-compact-meta"><span class="sirk-device-connection ' +
                (online ? "is-online" : "is-offline") + '"><i></i>' + esc(online ? t("online") : t("offline")) +
                '</span><small>' + esc(node.ip || "—") + '</small></div></nav><section id="sirkDeviceTabBody" class="sirk-device-tab-body">' +
            tabs.map(function (type) {
                return '<section class="sirk-device-tab-pane" data-device-pane="' + type + '"' +
                    (type === activeTab ? "" : " hidden") + '></section>';
            }).join("") + '</section></div>';
        initializeWorkspacePanes(node);
        renderTab(node, activeTab);
    }

'''
pattern = re.compile(
    r"    function renderTab\(node, type\) \{.*?\n    \}\n\n"
    r"    function renderWorkspace\(node\) \{.*?\n    \}\n\n"
    r"(?=    function extractNodeId\(\))",
    re.S)
workspace, count = pattern.subn(new_layout, workspace, count=1)
if count != 1:
    raise SystemExit(f"Workspace render block: expected one match, got {count}")
if "Pulpit SIRK Agent Live" in workspace:
    raise SystemExit("Legacy desktop heading is still present.")
if '<header class="sirk-device-compact-header">' in workspace:
    raise SystemExit("Legacy compact header is still rendered.")
workspace_path.write_text(workspace, encoding="utf-8")

tabs_path = root / "public/portal/standalone/scripts/device-tabs.js"
tabs = tabs_path.read_text(encoding="utf-8")
tabs = replace_once(
    tabs,
    '                { key: "files", label: "Files" }\n',
    '                { key: "files", label: "Files" },\n                { key: "settings", label: "Settings" }\n',
    "English host menu Settings")
tabs = replace_once(
    tabs,
    '                { key: "files", label: "Pliki" }\n',
    '                { key: "files", label: "Pliki" },\n                { key: "settings", label: "Ustawienia" }\n',
    "Polish host menu Settings")
tabs_path.write_text(tabs, encoding="utf-8")

connection_path = root / "public/portal/standalone/scripts/workspace-connection.js"
connection = connection_path.read_text(encoding="utf-8")
connection = replace_once(
    connection,
    '        var name = ws.querySelector(".sirk-device-compact-main strong");\n        return "name:" + String(name && name.textContent || "unknown").trim();',
    '        var name = document.querySelector(".sirk-device-host-tab.is-active .sirk-device-tab-label");\n        return "name:" + String(name && name.textContent || "unknown").trim();',
    "Workspace connection fallback key")
connection = replace_once(
    connection,
    '        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-host-tab.is-online{border-color:#16a34a!important;background:rgba(22,163,74,.16)!important;color:var(--sirk-text,#172033)!important}",',
    '        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-host-tab.is-online{border-color:transparent!important;background:var(--sirk-sidebar-active,#2b3b55)!important;color:#edf4ff!important;box-shadow:inset 3px 0 0 #16a34a,inset 0 0 0 1px rgba(255,255,255,.06)!important}",',
    "Online host highlight")
connection = replace_once(
    connection,
    '        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-host-tab.is-offline{border-color:#dc2626!important;background:rgba(220,38,38,.14)!important;color:var(--sirk-text,#172033)!important}",',
    '        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-host-tab.is-offline{border-color:transparent!important;background:var(--sirk-sidebar-active,#2b3b55)!important;color:#edf4ff!important;box-shadow:inset 3px 0 0 #dc2626,inset 0 0 0 1px rgba(255,255,255,.06)!important}",',
    "Offline host highlight")
connection = replace_once(
    connection,
    '        "#sirkPortalRoot.sirk-theme-dark .sirk-device-tabs-standalone .sirk-device-host-tab.is-online{background:rgba(22,163,74,.25)!important;color:#dcfce7!important}",',
    '        "#sirkPortalRoot.sirk-theme-dark .sirk-device-tabs-standalone .sirk-device-host-tab.is-online{background:var(--sirk-sidebar-active,#2b3b55)!important;color:#edf4ff!important}",',
    "Dark online host highlight")
connection = replace_once(
    connection,
    '        "#sirkPortalRoot.sirk-theme-dark .sirk-device-tabs-standalone .sirk-device-host-tab.is-offline{background:rgba(220,38,38,.24)!important;color:#fee2e2!important}",',
    '        "#sirkPortalRoot.sirk-theme-dark .sirk-device-tabs-standalone .sirk-device-host-tab.is-offline{background:var(--sirk-sidebar-active,#2b3b55)!important;color:#edf4ff!important}",',
    "Dark offline host highlight")
connection_path.write_text(connection, encoding="utf-8")

css_path = root / "public/portal/standalone/styles/device-workspace.css"
css = css_path.read_text(encoding="utf-8")
marker = "/* SIRK_DEVICE_WORKSPACE_LAYOUT_V2 */"
if marker in css:
    raise SystemExit("Workspace layout V2 CSS already exists.")
css += r'''

/* SIRK_DEVICE_WORKSPACE_LAYOUT_V2 */
.sirk-device-workspace{grid-template-rows:auto minmax(0,1fr)}
.sirk-device-workspace>.sirk-device-tabs{align-items:center;min-height:46px;padding:5px 8px;border:1px solid var(--sirk-border,#dce3ec);border-radius:11px 11px 0 0;background:var(--sirk-panel,#fff)}
.sirk-device-workspace>.sirk-device-tabs .sirk-device-compact-meta{display:flex;align-items:center;justify-content:flex-end;gap:10px;min-width:max-content;margin-left:auto;padding:0 7px 0 12px;white-space:nowrap}
.sirk-device-workspace>.sirk-device-tabs .sirk-device-compact-meta small{color:var(--sirk-muted,#657187);font-size:12px}
.sirk-device-tab-body{position:relative;border-top:0}
.sirk-device-tab-pane{width:100%;height:100%;min-width:0;min-height:0;overflow:auto}
.sirk-device-tab-pane[hidden]{display:none!important}
.sirk-device-tab-pane[data-device-pane="desktop"]{overflow:hidden}
.sirk-device-tab-pane[data-device-pane="desktop"]>.sirk-agent-desktop{width:100%;height:100%;min-height:0}
.sirk-device-tab-pane[data-device-pane="terminal"]{display:flex;flex-direction:column;gap:0}
.sirk-device-tab-pane[data-device-pane="terminal"]>.sirk-agent-desktop-admin{margin:18px 18px 0}
.sirk-device-tab-pane[data-device-pane="terminal"]>.sirk-agent-terminal{flex:1 1 auto;min-height:0}
.sirk-agent-desktop-settings{min-height:0}
.sirk-agent-desktop-settings .sirk-agent-desktop-controls,.sirk-agent-desktop-settings .sirk-agent-desktop-stats{width:100%}
@media(max-width:800px){.sirk-device-workspace>.sirk-device-tabs{flex-wrap:wrap;height:auto!important}.sirk-device-workspace>.sirk-device-tabs .sirk-device-compact-meta{margin-left:0}}
'''
css_path.write_text(css, encoding="utf-8")

contract_path = root / "tests/Sirk.Portal.ProtocolTests/DeviceWorkspaceLayoutV2Contract.cs"
contract_path.write_text(r'''namespace Sirk.Portal.ProtocolTests;

internal static class DeviceWorkspaceLayoutV2Contract
{
    public static void Run()
    {
        var root = FindRepositoryRoot();
        var workspace = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "device-workspace.js"));
        var tabs = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "device-tabs.js"));
        var connection = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "workspace-connection.js"));
        var css = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "styles", "device-workspace.css"));

        Require(workspace.Contains("[\"general\", \"desktop\", \"terminal\", \"commands\", \"files\", \"settings\"]", StringComparison.Ordinal), "Device workspace must expose Settings.");
        Require(workspace.Contains("data-device-pane", StringComparison.Ordinal) && workspace.Contains("initializeWorkspacePanes", StringComparison.Ordinal), "Device tabs must preserve their panes.");
        Require(workspace.Contains("function renderAgentSettings", StringComparison.Ordinal) && workspace.Contains("sirk-agent-desktop-settings", StringComparison.Ordinal), "Desktop controls and statistics must be in Settings.");
        Require(!workspace.Contains("Pulpit SIRK Agent Live", StringComparison.Ordinal) && !workspace.Contains("<header class=\"sirk-device-compact-header\">", StringComparison.Ordinal), "Legacy headers must be removed.");
        Require(css.Contains("SIRK_DEVICE_WORKSPACE_LAYOUT_V2", StringComparison.Ordinal) && css.Contains("border-radius:11px 11px 0 0", StringComparison.Ordinal), "The device tab bar must own the rounded header surface.");
        Require(tabs.Contains("{ key: \"settings\", label: \"Ustawienia\" }", StringComparison.Ordinal) && tabs.Contains("{ key: \"settings\", label: \"Settings\" }", StringComparison.Ordinal), "Host menus must expose Settings.");
        Require(connection.Contains("background:var(--sirk-sidebar-active,#2b3b55)", StringComparison.Ordinal) && connection.Contains("inset 3px 0 0 #16a34a", StringComparison.Ordinal) && connection.Contains("inset 3px 0 0 #dc2626", StringComparison.Ordinal), "Host tabs must use sidebar-style status accents.");
    }

    private static string FindRepositoryRoot()
    {
        var current = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "src", "Sirk.Portal", "Sirk.Portal.csproj"))) return current.FullName;
            current = current.Parent;
        }
        throw new DirectoryNotFoundException("SIRK Portal repository root was not found.");
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}
''', encoding="utf-8")

program_path = root / "tests/Sirk.Portal.ProtocolTests/Program.cs"
program = program_path.read_text(encoding="utf-8")
program = replace_once(
    program,
    "DeviceConnectionWorkspaceContract.Run();\nDeviceHostTabSplitContract.Run();",
    "DeviceConnectionWorkspaceContract.Run();\nDeviceWorkspaceLayoutV2Contract.Run();\nDeviceHostTabSplitContract.Run();",
    "Protocol test registration")
program_path.write_text(program, encoding="utf-8")
