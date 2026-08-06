from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path}: {count}\n--- old ---\n{old}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


root = Path(__file__).resolve().parents[2]
view_mode = root / "public/portal/standalone/scripts/view-mode.js"
contract = root / "tests/Sirk.Portal.ProtocolTests/DeviceConnectionWorkspaceContract.cs"

replace_once(
    view_mode,
    '''            ".sirk-connection-header-toggle{position:fixed!important;left:50%;top:0;z-index:2147483500;display:none!important;align-items:flex-end;justify-content:center;width:34px;height:12px;padding:0 0 5px;overflow:hidden;border:1px solid rgba(148,163,184,.72);border-top:0;border-radius:0 0 8px 8px;background:rgba(13,23,40,.9);color:#edf4ff;box-shadow:0 7px 18px rgba(15,23,42,.24);cursor:pointer;transform:translateX(-50%);transition:top .18s ease,height .16s ease,padding .16s ease,background .18s ease,border-color .18s ease}",
            ".sirk-connection-header-toggle:hover,.sirk-connection-header-toggle:focus-visible{height:34px;padding-bottom:8px;border-color:#60a5fa;background:#17263d;color:#fff;outline:none}",
            ".sirk-connection-header-toggle svg{display:block;flex:0 0 17px;width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .18s ease}",
            "html.sirk-device-connection-mode .sirk-connection-header-toggle{display:flex!important}",
            "html.sirk-device-connection-mode.sirk-device-connection-header-open .sirk-connection-header-toggle{top:69px;height:34px;padding-bottom:8px}",''',
    '''            ".sirk-connection-header-toggle{position:fixed!important;left:14px;top:54px;z-index:2147483560;display:none!important;align-items:center;justify-content:flex-end;width:12px;height:34px;padding:0 5px 0 0;overflow:hidden;border:1px solid rgba(148,163,184,.72);border-radius:8px;background:rgba(13,23,40,.9);color:#edf4ff;box-shadow:0 7px 18px rgba(15,23,42,.24);cursor:pointer;transform:none;transition:left .18s ease,width .16s ease,padding .16s ease,background .18s ease,border-color .18s ease}",
            ".sirk-connection-header-toggle:hover,.sirk-connection-header-toggle:focus-visible{width:34px;padding-right:8px;border-color:#60a5fa;background:#17263d;color:#fff;outline:none}",
            ".sirk-connection-header-toggle svg{display:block;flex:0 0 17px;width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .18s ease}",
            ".sirk-connection-sidebar-toggle:hover+.sirk-connection-header-toggle,.sirk-connection-sidebar-toggle:focus-visible+.sirk-connection-header-toggle{left:36px}",
            "html.sirk-device-connection-mode .sirk-connection-header-toggle{display:flex!important}",
            "html.sirk-device-connection-mode.sirk-device-connection-header-open .sirk-connection-header-toggle{left:14px;width:34px;padding-right:8px}",'''
)

replace_once(
    view_mode,
    '''            "html.sirk-device-focus-mode.sirk-device-connection-sidebar-open .sirk-connection-sidebar-toggle,html.sirk-device-connection-mode.sirk-device-connection-sidebar-open .sirk-connection-sidebar-toggle{left:var(--sirk-expanded-sidebar-width,248px);width:34px;padding-right:8px}",
            "html.sirk-device-focus-mode.sirk-device-connection-sidebar-open .sirk-connection-sidebar-toggle svg,html.sirk-device-connection-mode.sirk-device-connection-sidebar-open .sirk-connection-sidebar-toggle svg{transform:rotate(180deg)}",''',
    '''            "html.sirk-device-focus-mode.sirk-device-connection-sidebar-open .sirk-connection-sidebar-toggle,html.sirk-device-connection-mode.sirk-device-connection-sidebar-open .sirk-connection-sidebar-toggle{left:var(--sirk-expanded-sidebar-width,248px);width:34px;padding-right:8px}",
            "html.sirk-device-connection-mode.sirk-device-connection-sidebar-open .sirk-connection-header-toggle{left:calc(var(--sirk-expanded-sidebar-width,248px) + 36px)}",
            "html.sirk-device-focus-mode.sirk-device-connection-sidebar-open .sirk-connection-sidebar-toggle svg,html.sirk-device-connection-mode.sirk-device-connection-sidebar-open .sirk-connection-sidebar-toggle svg{transform:rotate(180deg)}",'''
)

replace_once(
    view_mode,
    '''            document.body.appendChild(button);
        } else {
            button.setAttribute("aria-controls", header.id);
        }

        updateConnectionHeaderToggle();''',
    '''            var sidebarButton = document.getElementById("sirkConnectionSidebarToggle");
            if (sidebarButton) sidebarButton.insertAdjacentElement("afterend", button);
            else document.body.appendChild(button);
        } else {
            button.setAttribute("aria-controls", header.id);
            var currentSidebarButton = document.getElementById("sirkConnectionSidebarToggle");
            if (currentSidebarButton && button.previousElementSibling !== currentSidebarButton)
                currentSidebarButton.insertAdjacentElement("afterend", button);
        }

        updateConnectionHeaderToggle();'''
)

replace_once(
    contract,
    '''        Require(viewMode.Contains(".sirk-connection-header-toggle", StringComparison.Ordinal) &&
                viewMode.Contains("sirk-device-connection-header-open .sirk-standalone-header", StringComparison.Ordinal) &&
                viewMode.Contains("grid-template-rows:minmax(0,1fr)", StringComparison.Ordinal) &&
                viewMode.Contains("function mountConnectionHeaderToggle()", StringComparison.Ordinal),
            "Connection full view must hide the top header and expose it through a compact overlay handle.");''',
    '''        Require(viewMode.Contains(".sirk-connection-header-toggle", StringComparison.Ordinal) &&
                viewMode.Contains("left:14px;top:54px", StringComparison.Ordinal) &&
                viewMode.Contains("z-index:2147483560", StringComparison.Ordinal) &&
                viewMode.Contains("sidebarButton.insertAdjacentElement", StringComparison.Ordinal) &&
                viewMode.Contains("afterend", StringComparison.Ordinal) &&
                viewMode.Contains("sirk-device-connection-header-open .sirk-standalone-header", StringComparison.Ordinal) &&
                viewMode.Contains("grid-template-rows:minmax(0,1fr)", StringComparison.Ordinal) &&
                viewMode.Contains("function mountConnectionHeaderToggle()", StringComparison.Ordinal),
            "Connection full view must place the top-header handle beside the menu handle and keep it above the overlay.");'''
)

print("Left connection header handle applied.")
