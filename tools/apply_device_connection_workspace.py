from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one occurrence in {path}: {old!r}; found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")


def update_device_tabs_css() -> None:
    path = ROOT / "public/portal/standalone/styles/device-tabs.css"
    replace_once(
        path,
        "#sirkPortalRoot .sirk-standalone-header{flex:0 0 69px!important;gap:8px!important;border-bottom:1px solid var(--sirk-border,#dce3ec)!important}",
        "#sirkPortalRoot .sirk-standalone-header{flex:0 0 69px!important;gap:8px!important;padding:0 12px!important;border-bottom:1px solid var(--sirk-border,#dce3ec)!important}",
    )
    replace_once(
        path,
        "#sirkPortalRoot .sirk-device-tabs-standalone{flex:1 1 auto;width:auto;min-width:0;height:46px;min-height:46px;margin:0;padding:4px 0;border-bottom:0;background:transparent;z-index:30}",
        "#sirkPortalRoot .sirk-device-tabs-standalone{flex:1 1 auto;width:auto;min-width:0;height:46px;min-height:46px;margin:0;padding:4px 0;border:0!important;background:transparent;z-index:30}",
    )


def update_view_mode() -> None:
    path = ROOT / "public/portal/standalone/scripts/view-mode.js"
    replace_once(
        path,
        '            "html.sirk-device-focus-mode .sirk-standalone-main>header,html.sirk-device-focus-mode .sirk-standalone-topbar{display:none!important}",',
        '            "html.sirk-device-focus-mode .sirk-standalone-topbar{display:none!important}",',
    )
    replace_once(
        path,
        '            "html.sirk-device-connection-mode .sirk-standalone-sidebar,html.sirk-device-connection-mode .sirk-standalone-main>header,html.sirk-device-connection-mode .sirk-standalone-topbar,html.sirk-device-connection-mode .sirk-device-tabs-standalone{display:none!important}",',
        '            "html.sirk-device-connection-mode .sirk-standalone-sidebar,html.sirk-device-connection-mode .sirk-standalone-topbar{display:none!important}",',
    )
    replace_once(
        path,
        '            "html.sirk-device-connection-mode #sirkStandaloneContent{padding:0!important;margin:0!important}",\n            "html.sirk-device-connection-mode .sirk-device-session-layer{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:2147482000!important}",\n            "html.sirk-device-connection-mode .sirk-device-session-pane.is-active,html.sirk-device-connection-mode .sirk-device-session-pane.is-active iframe{width:100%!important;height:100%!important}",',
        '            "html.sirk-device-connection-mode #sirkStandaloneContent{padding:0!important;margin:0!important;overflow:hidden!important}",\n            "html.sirk-device-connection-mode .sirk-device-workspace{grid-template-rows:minmax(0,1fr)!important;width:100%!important;height:100%!important;min-height:0!important}",\n            "html.sirk-device-connection-mode .sirk-device-workspace>.sirk-device-compact-header,html.sirk-device-connection-mode .sirk-device-workspace>.sirk-device-tabs{display:none!important}",\n            "html.sirk-device-connection-mode .sirk-device-tab-body{width:100%!important;height:100%!important;min-height:0!important;border:0!important;border-radius:0!important}",\n            "html.sirk-device-connection-mode .sirk-agent-operation.sirk-agent-desktop{width:100%!important;height:100%!important;min-height:0!important;padding:0!important;gap:0!important;overflow:hidden!important}",\n            "html.sirk-device-connection-mode .sirk-agent-desktop>header,html.sirk-device-connection-mode .sirk-agent-desktop-controls,html.sirk-device-connection-mode .sirk-agent-desktop-stats,html.sirk-device-connection-mode .sirk-agent-desktop-admin,html.sirk-device-connection-mode .sirk-agent-desktop-input,html.sirk-device-connection-mode .sirk-agent-desktop-clipboard,html.sirk-device-connection-mode .sirk-agent-policy-action,html.sirk-device-connection-mode .sirk-agent-desktop>pre{display:none!important}",\n            "html.sirk-device-connection-mode .sirk-agent-desktop-stage{position:relative!important;display:flex!important;flex:1 1 auto!important;width:100%!important;height:100%!important;min-height:0!important;border-radius:0!important;overflow:hidden!important}",\n            "html.sirk-device-connection-mode .sirk-agent-desktop-stage canvas{display:block!important;max-width:100%!important;max-height:100%!important;width:auto!important;height:auto!important;margin:auto!important}",\n            "html.sirk-device-connection-mode .sirk-quick-commands-toggle{z-index:60!important}",\n            "html.sirk-device-connection-mode .sirk-quick-commands-panel{z-index:59!important;top:8px!important;right:8px!important;bottom:8px!important}",',
    )


def update_quick_commands_mount() -> None:
    path = ROOT / "public/portal/standalone/scripts/device-workspace.js"
    replace_once(
        path,
        '        operation.appendChild(toggle);\n        operation.appendChild(panel);',
        '        var desktopStage = operation.querySelector(".sirk-agent-desktop-stage");\n        (desktopStage || operation).appendChild(toggle);\n        operation.appendChild(panel);',
    )


def update_commands_css() -> None:
    path = ROOT / "public/shared/ui/commands.css"
    replace_once(path, "    z-index:24;\n", "    z-index:40;\n")
    replace_once(path, "    z-index:23;\n", "    z-index:39;\n")


def add_contract() -> None:
    contract = ROOT / "tests/Sirk.Portal.ProtocolTests/DeviceConnectionWorkspaceContract.cs"
    contract.write_text(
        '''namespace Sirk.Portal.ProtocolTests;

internal static class DeviceConnectionWorkspaceContract
{
    public static void Run()
    {
        var root = FindRepositoryRoot();
        var tabsCss = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "styles", "device-tabs.css"));
        var viewMode = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "view-mode.js"));
        var workspace = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "device-workspace.js"));
        var commandsCss = File.ReadAllText(Path.Combine(root, "public", "shared", "ui", "commands.css"));

        Require(tabsCss.Contains("padding:0 12px!important", StringComparison.Ordinal),
            "The Devices header must keep a 12px outer inset.");
        Require(tabsCss.Contains(".sirk-device-tabs-standalone{flex:1 1 auto", StringComparison.Ordinal) &&
                tabsCss.Contains("border:0!important", StringComparison.Ordinal),
            "The top device tab strip must not render vertical separators.");

        Require(!viewMode.Contains("sirk-device-focus-mode .sirk-standalone-main>header", StringComparison.Ordinal),
            "Wide view must keep the device tabs header visible.");
        Require(!viewMode.Contains("sirk-device-connection-mode .sirk-standalone-main>header", StringComparison.Ordinal),
            "Connection view must keep the device tabs header visible.");
        Require(!viewMode.Contains("sirk-device-connection-mode .sirk-device-tabs-standalone{display:none", StringComparison.Ordinal),
            "Connection view must keep All and host tabs visible.");
        Require(viewMode.Contains(".sirk-device-workspace>.sirk-device-compact-header", StringComparison.Ordinal) &&
                viewMode.Contains(".sirk-agent-desktop-stage canvas", StringComparison.Ordinal),
            "Connection view must dedicate the complete area below host tabs to the remote desktop.");
        Require(viewMode.Contains(".sirk-quick-commands-panel{z-index:59", StringComparison.Ordinal),
            "Quick Commands must remain above the connected desktop.");

        Require(workspace.Contains("(desktopStage || operation).appendChild(toggle)", StringComparison.Ordinal),
            "The Quick Commands toggle must be mounted on the remote desktop stage.");
        Require(!workspace.Contains("operation.appendChild(toggle);", StringComparison.Ordinal),
            "The Quick Commands toggle must not remain outside the visible connected stage.");
        Require(commandsCss.Contains("z-index:40", StringComparison.Ordinal) &&
                commandsCss.Contains("z-index:39", StringComparison.Ordinal),
            "Quick Commands controls must have a stable overlay stacking order.");
    }

    private static string FindRepositoryRoot()
    {
        var current = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "src", "Sirk.Portal", "Sirk.Portal.csproj")))
                return current.FullName;
            current = current.Parent;
        }
        throw new DirectoryNotFoundException("SIRK Portal repository root was not found.");
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}
''',
        encoding="utf-8",
        newline="\n",
    )

    program = ROOT / "tests/Sirk.Portal.ProtocolTests/Program.cs"
    text = program.read_text(encoding="utf-8")
    marker = "DeviceHeaderLayoutContract.Run();\n"
    if text.count(marker) != 1:
        raise RuntimeError("DeviceHeaderLayoutContract marker was not found exactly once.")
    program.write_text(
        text.replace(marker, marker + "DeviceConnectionWorkspaceContract.Run();\n", 1),
        encoding="utf-8",
        newline="\n",
    )


def main() -> None:
    update_device_tabs_css()
    update_view_mode()
    update_quick_commands_mount()
    update_commands_css()
    add_contract()


if __name__ == "__main__":
    main()
