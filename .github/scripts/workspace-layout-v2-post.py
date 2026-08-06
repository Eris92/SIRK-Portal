from pathlib import Path


contract_path = Path("tests/Sirk.Portal.ProtocolTests/DeviceHostTabSplitContract.cs")
contract = contract_path.read_text(encoding="utf-8")
old = '''                connectionScript.Contains(".sirk-device-host-tab.is-offline", StringComparison.Ordinal) &&
                connectionScript.Contains("border-color:#16a34a", StringComparison.Ordinal) &&
                connectionScript.Contains("border-color:#dc2626", StringComparison.Ordinal),
            "Host tabs must hide per-tab connection actions and use green online or red offline status styling.");'''
new = '''                connectionScript.Contains(".sirk-device-host-tab.is-offline", StringComparison.Ordinal) &&
                connectionScript.Contains("background:var(--sirk-sidebar-active,#2b3b55)", StringComparison.Ordinal) &&
                connectionScript.Contains("inset 3px 0 0 #16a34a", StringComparison.Ordinal) &&
                connectionScript.Contains("inset 3px 0 0 #dc2626", StringComparison.Ordinal),
            "Host tabs must hide per-tab connection actions and reuse the sidebar active style with online/offline accents.");'''
if contract.count(old) != 1:
    raise SystemExit("Legacy host-tab status contract was not found exactly once.")
contract_path.write_text(contract.replace(old, new, 1), encoding="utf-8")

workspace_path = Path("public/portal/standalone/scripts/device-workspace.js")
workspace = workspace_path.read_text(encoding="utf-8")
old_admin = '<button type="button" data-agent-admin-start disabled>Uruchom w sesji użytkownika</button></div><div class="sirk-agent-operation sirk-agent-terminal">'
new_admin = '<button type="button" data-agent-admin-start disabled>Uruchom w sesji użytkownika</button><small data-agent-admin-status>Gotowy.</small></div><div class="sirk-agent-operation sirk-agent-terminal">'
if workspace.count(old_admin) != 1:
    raise SystemExit("Terminal admin block was not found exactly once.")
workspace = workspace.replace(old_admin, new_admin, 1)

old_query = '        var adminStart = workspaceRoot.querySelector("[data-agent-admin-start]");\n'
new_query = old_query + '        var adminStatus = workspaceRoot.querySelector("[data-agent-admin-status]") || status;\n'
if workspace.count(old_query) != 1:
    raise SystemExit("Admin start query was not found exactly once.")
workspace = workspace.replace(old_query, new_query, 1)

old_handler = '''        adminStart.addEventListener("click", function () {
            adminStart.disabled = true;
            runAgentOperation(node, "desktop.admin.start", {
                sessionId: Number(session.value),
                tool: adminTool.value
            }, status).then(function () {
                status.textContent = "Narzędzie administracyjne działa jako SYSTEM na pulpicie użytkownika.";
            }).catch(function (error) {
                status.textContent = error.message || String(error);
                status.classList.add("is-error");
            }).then(function () { adminStart.disabled = !connected; });
        });'''
new_handler = '''        adminStart.addEventListener("click", function () {
            adminStart.disabled = true;
            runAgentOperation(node, "desktop.admin.start", {
                sessionId: Number(session.value),
                tool: adminTool.value
            }, adminStatus).then(function () {
                adminStatus.textContent = "Narzędzie administracyjne działa jako SYSTEM na pulpicie użytkownika.";
                adminStatus.classList.remove("is-error");
            }).catch(function (error) {
                adminStatus.textContent = error.message || String(error);
                adminStatus.classList.add("is-error");
            }).then(function () { adminStart.disabled = !connected; });
        });'''
if workspace.count(old_handler) != 1:
    raise SystemExit("Desktop admin handler was not found exactly once.")
workspace_path.write_text(workspace.replace(old_handler, new_handler, 1), encoding="utf-8")

css_path = Path("public/portal/standalone/styles/device-workspace.css")
css = css_path.read_text(encoding="utf-8")
css += "\n.sirk-agent-desktop-admin [data-agent-admin-status]{flex:1 1 100%;color:var(--sirk-muted,#94a3b8);font-size:12px}\n.sirk-agent-desktop-admin [data-agent-admin-status].is-error{color:#fca5a5}\n"
css_path.write_text(css, encoding="utf-8")
