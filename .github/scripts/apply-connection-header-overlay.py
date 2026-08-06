from pathlib import Path
import re


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path}: {count}\n--- old ---\n{old}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def regex_once(path: Path, pattern: str, replacement: str) -> None:
    text = path.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"Expected exactly one regex match in {path}: {count}\n--- pattern ---\n{pattern}")
    path.write_text(updated, encoding="utf-8")


root = Path(__file__).resolve().parents[2]
view_mode = root / "public/portal/standalone/scripts/view-mode.js"
contract = root / "tests/Sirk.Portal.ProtocolTests/DeviceConnectionWorkspaceContract.cs"

replace_once(
    view_mode,
    '''            ".sirk-connection-sidebar-toggle:hover,.sirk-connection-sidebar-toggle:focus-visible{width:34px;padding-right:8px;border-color:#60a5fa;background:#17263d;color:#fff;outline:none}",
            ".sirk-connection-sidebar-toggle svg{display:block;flex:0 0 17px;width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .18s ease}",
            "html.sirk-device-focus-mode .sirk-connection-sidebar-toggle,html.sirk-device-connection-mode .sirk-connection-sidebar-toggle{display:flex!important}",''',
    '''            ".sirk-connection-sidebar-toggle:hover,.sirk-connection-sidebar-toggle:focus-visible{width:34px;padding-right:8px;border-color:#60a5fa;background:#17263d;color:#fff;outline:none}",
            ".sirk-connection-sidebar-toggle svg{display:block;flex:0 0 17px;width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .18s ease}",
            ".sirk-connection-header-toggle{position:fixed!important;left:14px;top:54px;z-index:2147483560;display:none!important;align-items:center;justify-content:flex-end;width:12px;height:34px;padding:0 5px 0 0;overflow:hidden;border:1px solid rgba(148,163,184,.72);border-radius:8px;background:rgba(13,23,40,.9);color:#edf4ff;box-shadow:0 7px 18px rgba(15,23,42,.24);cursor:pointer;transition:left .18s ease,width .16s ease,padding .16s ease,background .18s ease,border-color .18s ease}",
            ".sirk-connection-header-toggle:hover,.sirk-connection-header-toggle:focus-visible{width:34px;padding-right:8px;border-color:#60a5fa;background:#17263d;color:#fff;outline:none}",
            ".sirk-connection-header-toggle svg{display:block;flex:0 0 17px;width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .18s ease}",
            ".sirk-connection-sidebar-toggle:hover+.sirk-connection-header-toggle,.sirk-connection-sidebar-toggle:focus-visible+.sirk-connection-header-toggle{left:36px}",
            "html.sirk-device-focus-mode .sirk-connection-sidebar-toggle,html.sirk-device-connection-mode .sirk-connection-sidebar-toggle{display:flex!important}",
            "html.sirk-device-connection-mode .sirk-connection-header-toggle{display:flex!important}",
            "html.sirk-device-connection-mode.sirk-device-connection-header-open .sirk-connection-header-toggle svg{transform:rotate(180deg)}",'''
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
    '''            "html.sirk-device-connection-mode .sirk-standalone-sidebar,html.sirk-device-connection-mode .sirk-standalone-topbar{display:none!important}",
            "html.sirk-device-connection-mode .sirk-standalone-root{grid-template-columns:minmax(0,1fr)!important}",''',
    '''            "html.sirk-device-connection-mode .sirk-standalone-sidebar,html.sirk-device-connection-mode .sirk-standalone-topbar{display:none!important}",
            "html.sirk-device-connection-mode .sirk-standalone-header{display:none!important;position:fixed!important;inset:0 0 auto 0!important;z-index:2147483450!important;width:100%!important;height:50px!important;min-height:50px!important;padding:2px 22px!important;background:var(--sirk-panel,#fff)!important;box-shadow:0 8px 22px rgba(15,23,42,.22)!important}",
            "html.sirk-device-connection-mode.sirk-device-connection-header-open .sirk-standalone-header{display:flex!important}",
            "html.sirk-device-connection-mode .sirk-standalone-root{grid-template-columns:minmax(0,1fr)!important}",'''
)

replace_once(
    view_mode,
    '''    function setConnectionSidebarOpen(enabled) {
        var active = expandedModeActive();
        document.documentElement.classList.toggle("sirk-device-connection-sidebar-open", active && enabled);
        updateConnectionSidebarToggle();
        window.dispatchEvent(new Event("resize"));
    }

    function setFocusMode(enabled, remember) {''',
    '''    function setConnectionSidebarOpen(enabled) {
        var active = expandedModeActive();
        document.documentElement.classList.toggle("sirk-device-connection-sidebar-open", active && enabled);
        updateConnectionSidebarToggle();
        window.dispatchEvent(new Event("resize"));
    }

    function updateConnectionHeaderToggle() {
        var button = document.getElementById("sirkConnectionHeaderToggle");
        if (!button) return;
        var active = document.documentElement.classList.contains("sirk-device-connection-mode");
        var open = active && document.documentElement.classList.contains("sirk-device-connection-header-open");
        if (!active) document.documentElement.classList.remove("sirk-device-connection-header-open");
        button.setAttribute("aria-expanded", open ? "true" : "false");
        button.setAttribute("aria-label", text(open ? "Ukryj górny pasek" : "Pokaż górny pasek", open ? "Hide top bar" : "Show top bar"));
        button.title = text(open ? "Ukryj górny pasek" : "Pokaż górny pasek", open ? "Hide top bar" : "Show top bar");
    }

    function setConnectionHeaderOpen(enabled) {
        var active = document.documentElement.classList.contains("sirk-device-connection-mode");
        document.documentElement.classList.toggle("sirk-device-connection-header-open", active && enabled);
        updateConnectionHeaderToggle();
        window.dispatchEvent(new Event("resize"));
    }

    function setFocusMode(enabled, remember) {'''
)

replace_once(
    view_mode,
    '''        document.documentElement.classList.remove("sirk-device-connection-sidebar-open");
        updateConnectionSidebarToggle();
        scheduleDesktopPresentation();''',
    '''        document.documentElement.classList.remove("sirk-device-connection-sidebar-open");
        document.documentElement.classList.remove("sirk-device-connection-header-open");
        updateConnectionSidebarToggle();
        updateConnectionHeaderToggle();
        exitPortalFullscreen();
        scheduleDesktopPresentation();'''
)

replace_once(
    view_mode,
    '''            document.documentElement.classList.remove("sirk-device-connection-mode");
            document.documentElement.classList.remove("sirk-device-connection-sidebar-open");
        }''',
    '''            document.documentElement.classList.remove("sirk-device-connection-mode");
            document.documentElement.classList.remove("sirk-device-connection-sidebar-open");
            document.documentElement.classList.remove("sirk-device-connection-header-open");
        }'''
)

replace_once(
    view_mode,
    '''        if (enabled) document.documentElement.classList.remove("sirk-device-focus-mode");
        else document.documentElement.classList.remove("sirk-device-connection-sidebar-open");
        updateConnectionSidebarToggle();''',
    '''        if (enabled) {
            document.documentElement.classList.remove("sirk-device-focus-mode");
            document.documentElement.classList.remove("sirk-device-connection-header-open");
        }
        else {
            document.documentElement.classList.remove("sirk-device-connection-sidebar-open");
            document.documentElement.classList.remove("sirk-device-connection-header-open");
        }
        updateConnectionSidebarToggle();
        updateConnectionHeaderToggle();'''
)

replace_once(
    view_mode,
    '''    function requestPortalFullscreen() {
        var target = document.getElementById("sirkPortalRoot") || document.documentElement;
        if (document.fullscreenElement) return Promise.resolve();
        if (target && typeof target.requestFullscreen === "function") {
            return target.requestFullscreen().catch(function () {});
        }
        return Promise.resolve();
    }''',
    '''    function requestPortalFullscreen() {
        var target = document.getElementById("sirkPortalRoot") || document.documentElement;
        if (document.fullscreenElement) return Promise.resolve();
        if (target && typeof target.requestFullscreen === "function") {
            return target.requestFullscreen().catch(function () {});
        }
        return Promise.resolve();
    }

    function exitPortalFullscreen() {
        if (document.fullscreenElement && typeof document.exitFullscreen === "function") {
            return document.exitFullscreen().catch(function () {});
        }
        return Promise.resolve();
    }'''
)

replace_once(
    view_mode,
    '''        updateConnectionSidebarToggle();
        return true;
    }

    function mountViewModeButton() {''',
    '''        updateConnectionSidebarToggle();
        return true;
    }

    function mountConnectionHeaderToggle() {
        var header = document.querySelector(".sirk-standalone-header");
        var sidebarButton = document.getElementById("sirkConnectionSidebarToggle");
        if (!header || !sidebarButton) return false;

        var button = document.getElementById("sirkConnectionHeaderToggle");
        if (!button) {
            button = document.createElement("button");
            button.type = "button";
            button.id = "sirkConnectionHeaderToggle";
            button.className = "sirk-connection-header-toggle";
            button.setAttribute("aria-controls", header.id || "sirkStandaloneHeader");
            if (!header.id) header.id = "sirkStandaloneHeader";
            button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 15l7-7 7 7"/></svg>';
            button.addEventListener("click", function (event) {
                event.preventDefault();
                event.stopPropagation();
                setConnectionHeaderOpen(!document.documentElement.classList.contains("sirk-device-connection-header-open"));
            });
            sidebarButton.insertAdjacentElement("afterend", button);

            document.addEventListener("pointerdown", function (event) {
                if (!document.documentElement.classList.contains("sirk-device-connection-header-open")) return;
                if (button.contains(event.target) || header.contains(event.target)) return;
                setConnectionHeaderOpen(false);
            }, true);

            document.addEventListener("keydown", function (event) {
                if (event.key === "Escape") setConnectionHeaderOpen(false);
            });
        }
        else if (button.previousElementSibling !== sidebarButton) {
            sidebarButton.insertAdjacentElement("afterend", button);
        }

        updateConnectionHeaderToggle();
        return true;
    }

    function mountViewModeButton() {'''
)

regex_once(
    view_mode,
    r'''        toggle\.addEventListener\("click", function \(event\) \{.*?        \}\);\n\n        toggle\.addEventListener\("contextmenu"''',
    '''        toggle.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            hideMenu();
            var active = document.documentElement.classList.contains("sirk-device-focus-mode");
            if (active) exitExpandedModes();
            else exitPortalFullscreen().then(function () { setFocusMode(true); refresh(); });
            refresh();
        });

        toggle.addEventListener("contextmenu"'''
)

regex_once(
    view_mode,
    r'''        focus\.addEventListener\("click", function \(event\) \{.*?        connectionFullscreen\.addEventListener\("click", function \(event\) \{.*?        \}\);''',
    '''        focus.addEventListener("click", function (event) {
            event.stopPropagation();
            var active = document.documentElement.classList.contains("sirk-device-focus-mode") && !document.fullscreenElement;
            hideMenu();
            if (active) {
                exitExpandedModes();
                refresh();
                return;
            }
            exitPortalFullscreen().then(function () {
                setConnectionMode(false);
                setFocusMode(true);
                refresh();
            });
        });

        focusFullscreen.addEventListener("click", function (event) {
            event.stopPropagation();
            var active = document.documentElement.classList.contains("sirk-device-focus-mode") && !!document.fullscreenElement;
            hideMenu();
            if (active) {
                exitExpandedModes();
                exitPortalFullscreen().then(refresh);
                return;
            }
            setConnectionMode(false);
            setFocusMode(true);
            requestPortalFullscreen().then(refresh);
        });

        connection.addEventListener("click", function (event) {
            event.stopPropagation();
            var active = document.documentElement.classList.contains("sirk-device-connection-mode") && !document.fullscreenElement;
            hideMenu();
            if (active) {
                exitExpandedModes();
                refresh();
                return;
            }
            exitPortalFullscreen().then(function () {
                setFocusMode(false);
                setConnectionMode(true);
                refresh();
            });
        });

        connectionFullscreen.addEventListener("click", function (event) {
            event.stopPropagation();
            var active = document.documentElement.classList.contains("sirk-device-connection-mode") && !!document.fullscreenElement;
            hideMenu();
            if (active) {
                exitExpandedModes();
                exitPortalFullscreen().then(refresh);
                return;
            }
            setFocusMode(false);
            setConnectionMode(true);
            requestPortalFullscreen().then(refresh);
        });'''
)

replace_once(
    view_mode,
    '''    var viewModeMounted = mountViewModeButton();
    var sidebarToggleMounted = mountConnectionSidebarToggle();
    if (!viewModeMounted || !sidebarToggleMounted) {''',
    '''    var viewModeMounted = mountViewModeButton();
    var sidebarToggleMounted = mountConnectionSidebarToggle();
    var headerToggleMounted = mountConnectionHeaderToggle();
    if (!viewModeMounted || !sidebarToggleMounted || !headerToggleMounted) {'''
)
replace_once(
    view_mode,
    '''            viewModeMounted = mountViewModeButton() || viewModeMounted;
            sidebarToggleMounted = mountConnectionSidebarToggle() || sidebarToggleMounted;
            if ((viewModeMounted && sidebarToggleMounted) || mountAttempts >= 200) window.clearInterval(mountTimer);''',
    '''            viewModeMounted = mountViewModeButton() || viewModeMounted;
            sidebarToggleMounted = mountConnectionSidebarToggle() || sidebarToggleMounted;
            headerToggleMounted = mountConnectionHeaderToggle() || headerToggleMounted;
            if ((viewModeMounted && sidebarToggleMounted && headerToggleMounted) || mountAttempts >= 200) window.clearInterval(mountTimer);'''
)
replace_once(
    view_mode,
    '''        mountViewModeButton();
        mountConnectionSidebarToggle();''',
    '''        mountViewModeButton();
        mountConnectionSidebarToggle();
        mountConnectionHeaderToggle();'''
)
replace_once(
    view_mode,
    '''        updateConnectionSidebarToggle();
        scheduleDesktopPresentation();''',
    '''        updateConnectionSidebarToggle();
        updateConnectionHeaderToggle();
        scheduleDesktopPresentation();'''
)

replace_once(
    contract,
    '''        Require(viewMode.Contains("if (button.contains(event.target) || sidebar.contains(event.target)) return;", StringComparison.Ordinal) &&
                viewMode.Contains("setConnectionSidebarOpen(false);", StringComparison.Ordinal),
            "Clicking the expanded workspace outside the menu must hide the overlay.");''',
    '''        Require(viewMode.Contains("if (button.contains(event.target) || sidebar.contains(event.target)) return;", StringComparison.Ordinal) &&
                viewMode.Contains("setConnectionSidebarOpen(false);", StringComparison.Ordinal),
            "Clicking the expanded workspace outside the menu must hide the overlay.");
        Require(viewMode.Contains("sirk-connection-header-toggle", StringComparison.Ordinal) &&
                viewMode.Contains("sirk-device-connection-header-open .sirk-standalone-header", StringComparison.Ordinal) &&
                viewMode.Contains("sidebarButton.insertAdjacentElement(\"afterend\", button)", StringComparison.Ordinal),
            "Connection view must expose a top-bar handle directly beside the sidebar handle and keep it above the overlay.");
        Require(viewMode.Contains("if (button.contains(event.target) || header.contains(event.target)) return;", StringComparison.Ordinal) &&
                viewMode.Contains("setConnectionHeaderOpen(false);", StringComparison.Ordinal),
            "Clicking the connection workspace outside the top bar must hide the header overlay.");
        Require(viewMode.Contains("function exitPortalFullscreen()", StringComparison.Ordinal) &&
                viewMode.Contains("document.exitFullscreen()", StringComparison.Ordinal) &&
                viewMode.Contains("if (active) {\n                exitExpandedModes();", StringComparison.Ordinal),
            "Active fullscreen menu actions and expanded-mode exit must leave browser fullscreen.");'''
)

print("Connection header overlay and fullscreen exit applied.")
