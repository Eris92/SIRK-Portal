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
    '            ".sirk-connection-sidebar-toggle svg{display:block;flex:0 0 17px;width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .18s ease}",',
    '''            ".sirk-connection-sidebar-toggle svg{display:block;flex:0 0 17px;width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .18s ease}",
            ".sirk-connection-header-toggle{position:fixed!important;left:50%;top:0;z-index:2147483500;display:none!important;align-items:flex-end;justify-content:center;width:34px;height:12px;padding:0 0 5px;overflow:hidden;border:1px solid rgba(148,163,184,.72);border-top:0;border-radius:0 0 8px 8px;background:rgba(13,23,40,.9);color:#edf4ff;box-shadow:0 7px 18px rgba(15,23,42,.24);cursor:pointer;transform:translateX(-50%);transition:top .18s ease,height .16s ease,padding .16s ease,background .18s ease,border-color .18s ease}",
            ".sirk-connection-header-toggle:hover,.sirk-connection-header-toggle:focus-visible{height:34px;padding-bottom:8px;border-color:#60a5fa;background:#17263d;color:#fff;outline:none}",
            ".sirk-connection-header-toggle svg{display:block;flex:0 0 17px;width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .18s ease}",
            "html.sirk-device-connection-mode .sirk-connection-header-toggle{display:flex!important}",
            "html.sirk-device-connection-mode.sirk-device-connection-header-open .sirk-connection-header-toggle{top:69px;height:34px;padding-bottom:8px}",
            "html.sirk-device-connection-mode.sirk-device-connection-header-open .sirk-connection-header-toggle svg{transform:rotate(180deg)}",
            "html.sirk-device-connection-mode:not(.sirk-device-connection-header-open) .sirk-standalone-header{display:none!important}",
            "html.sirk-device-connection-mode.sirk-device-connection-header-open .sirk-standalone-header{position:fixed!important;inset:0 0 auto 0!important;z-index:2147483450!important;display:flex!important;width:100%!important;height:69px!important;min-height:69px!important;box-shadow:0 12px 28px rgba(15,23,42,.28)}",'''
)

replace_once(
    view_mode,
    '            "html.sirk-device-connection-mode .sirk-standalone-root{grid-template-columns:minmax(0,1fr)!important}",',
    '''            "html.sirk-device-connection-mode .sirk-standalone-root{grid-template-columns:minmax(0,1fr)!important}",
            "html.sirk-device-connection-mode .sirk-standalone-main{grid-template-rows:minmax(0,1fr)!important}",'''
)

replace_once(
    view_mode,
    '''    function suspendExpandedModes() {
        var changed = expandedModeActive() ||
            document.documentElement.classList.contains("sirk-device-connection-sidebar-open");
        document.documentElement.classList.remove("sirk-device-focus-mode");
        document.documentElement.classList.remove("sirk-device-connection-mode");
        document.documentElement.classList.remove("sirk-device-connection-sidebar-open");
        updateConnectionSidebarToggle();
        scheduleDesktopPresentation();
        if (changed) {
            window.dispatchEvent(new Event("resize"));
            window.dispatchEvent(new CustomEvent("sirkportal:deviceviewmodechange", {
                detail: { focus: false, connection: false }
            }));
        }
    }''',
    '''    function suspendExpandedModes() {
        var changed = expandedModeActive() ||
            document.documentElement.classList.contains("sirk-device-connection-sidebar-open") ||
            document.documentElement.classList.contains("sirk-device-connection-header-open");
        document.documentElement.classList.remove("sirk-device-focus-mode");
        document.documentElement.classList.remove("sirk-device-connection-mode");
        document.documentElement.classList.remove("sirk-device-connection-sidebar-open");
        document.documentElement.classList.remove("sirk-device-connection-header-open");
        exitPortalFullscreen();
        updateConnectionSidebarToggle();
        updateConnectionHeaderToggle();
        scheduleDesktopPresentation();
        if (changed) {
            window.dispatchEvent(new Event("resize"));
            window.dispatchEvent(new CustomEvent("sirkportal:deviceviewmodechange", {
                detail: { focus: false, connection: false }
            }));
        }
    }'''
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
    '''        document.documentElement.classList.toggle("sirk-device-focus-mode", enabled);
        if (enabled) {
            document.documentElement.classList.remove("sirk-device-connection-mode");
            document.documentElement.classList.remove("sirk-device-connection-sidebar-open");
        }''',
    '''        document.documentElement.classList.toggle("sirk-device-focus-mode", enabled);
        document.documentElement.classList.remove("sirk-device-connection-header-open");
        if (enabled) {
            document.documentElement.classList.remove("sirk-device-connection-mode");
            document.documentElement.classList.remove("sirk-device-connection-sidebar-open");
        }'''
)

replace_once(
    view_mode,
    '''        document.documentElement.classList.toggle("sirk-device-connection-mode", enabled);
        if (enabled) document.documentElement.classList.remove("sirk-device-focus-mode");
        else document.documentElement.classList.remove("sirk-device-connection-sidebar-open");
        updateConnectionSidebarToggle();''',
    '''        document.documentElement.classList.toggle("sirk-device-connection-mode", enabled);
        document.documentElement.classList.remove("sirk-device-connection-header-open");
        if (enabled) document.documentElement.classList.remove("sirk-device-focus-mode");
        else document.documentElement.classList.remove("sirk-device-connection-sidebar-open");
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
        if (!document.fullscreenElement || typeof document.exitFullscreen !== "function")
            return Promise.resolve();
        return document.exitFullscreen().catch(function () {});
    }'''
)

replace_once(
    view_mode,
    '''    function mountViewModeButton() {
        var header = document.querySelector(".sirk-standalone-header");''',
    '''    function mountConnectionHeaderToggle() {
        var header = document.querySelector(".sirk-standalone-header");
        if (!header) return false;
        if (!header.id) header.id = "sirkStandaloneHeader";

        var button = document.getElementById("sirkConnectionHeaderToggle");
        if (!button) {
            button = document.createElement("button");
            button.type = "button";
            button.id = "sirkConnectionHeaderToggle";
            button.className = "sirk-connection-header-toggle";
            button.setAttribute("aria-controls", header.id);
            button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9l7 7 7-7"/></svg>';

            button.addEventListener("click", function (event) {
                event.preventDefault();
                event.stopPropagation();
                setConnectionHeaderOpen(!document.documentElement.classList.contains("sirk-device-connection-header-open"));
            });

            document.addEventListener("pointerdown", function (event) {
                if (!document.documentElement.classList.contains("sirk-device-connection-header-open")) return;
                if (button.contains(event.target) || header.contains(event.target)) return;
                setConnectionHeaderOpen(false);
            }, true);

            document.addEventListener("keydown", function (event) {
                if (event.key === "Escape") setConnectionHeaderOpen(false);
            });

            document.body.appendChild(button);
        } else {
            button.setAttribute("aria-controls", header.id);
        }

        updateConnectionHeaderToggle();
        return true;
    }

    function mountViewModeButton() {
        var header = document.querySelector(".sirk-standalone-header");'''
)

replace_once(
    view_mode,
    '''            toggle.classList.toggle("is-active", focusActive || connectionActive);
            updateConnectionSidebarToggle();
            scheduleDesktopPresentation();''',
    '''            toggle.classList.toggle("is-active", focusActive || connectionActive);
            updateConnectionSidebarToggle();
            updateConnectionHeaderToggle();
            scheduleDesktopPresentation();'''
)

replace_once(
    view_mode,
    '''        toggle.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            hideMenu();
            setFocusMode(!document.documentElement.classList.contains("sirk-device-focus-mode"));
            refresh();
        });''',
    '''        toggle.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            hideMenu();
            if (expandedModeActive()) exitExpandedModes();
            else setFocusMode(true);
            refresh();
        });'''
)

replace_once(
    view_mode,
    '''        focus.addEventListener("click", function (event) {
            event.stopPropagation();
            setConnectionMode(false);
            setFocusMode(true);
            hideMenu();
            refresh();
        });

        focusFullscreen.addEventListener("click", function (event) {
            event.stopPropagation();
            setConnectionMode(false);
            setFocusMode(true);
            hideMenu();
            requestPortalFullscreen().then(refresh);
        });

        connection.addEventListener("click", function (event) {
            event.stopPropagation();
            setFocusMode(false);
            setConnectionMode(true);
            hideMenu();
            refresh();
        });

        connectionFullscreen.addEventListener("click", function (event) {
            event.stopPropagation();
            setFocusMode(false);
            setConnectionMode(true);
            hideMenu();
            requestPortalFullscreen().then(refresh);
        });''',
    '''        focus.addEventListener("click", function (event) {
            event.stopPropagation();
            var alreadyActive = document.documentElement.classList.contains("sirk-device-focus-mode") && !document.fullscreenElement;
            hideMenu();
            if (alreadyActive) {
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
            var alreadyActive = document.documentElement.classList.contains("sirk-device-focus-mode") && !!document.fullscreenElement;
            hideMenu();
            if (alreadyActive) {
                exitExpandedModes();
                refresh();
                return;
            }
            setConnectionMode(false);
            setFocusMode(true);
            requestPortalFullscreen().then(refresh);
        });

        connection.addEventListener("click", function (event) {
            event.stopPropagation();
            var alreadyActive = document.documentElement.classList.contains("sirk-device-connection-mode") && !document.fullscreenElement;
            hideMenu();
            if (alreadyActive) {
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
            var alreadyActive = document.documentElement.classList.contains("sirk-device-connection-mode") && !!document.fullscreenElement;
            hideMenu();
            if (alreadyActive) {
                exitExpandedModes();
                refresh();
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
    if (!viewModeMounted || !sidebarToggleMounted) {
        var mountAttempts = 0;
        var mountTimer = window.setInterval(function () {
            mountAttempts += 1;
            viewModeMounted = mountViewModeButton() || viewModeMounted;
            sidebarToggleMounted = mountConnectionSidebarToggle() || sidebarToggleMounted;
            if ((viewModeMounted && sidebarToggleMounted) || mountAttempts >= 200) window.clearInterval(mountTimer);
        }, 100);
    }''',
    '''    var viewModeMounted = mountViewModeButton();
    var sidebarToggleMounted = mountConnectionSidebarToggle();
    var headerToggleMounted = mountConnectionHeaderToggle();
    if (!viewModeMounted || !sidebarToggleMounted || !headerToggleMounted) {
        var mountAttempts = 0;
        var mountTimer = window.setInterval(function () {
            mountAttempts += 1;
            viewModeMounted = mountViewModeButton() || viewModeMounted;
            sidebarToggleMounted = mountConnectionSidebarToggle() || sidebarToggleMounted;
            headerToggleMounted = mountConnectionHeaderToggle() || headerToggleMounted;
            if ((viewModeMounted && sidebarToggleMounted && headerToggleMounted) || mountAttempts >= 200)
                window.clearInterval(mountTimer);
        }, 100);
    }'''
)

replace_once(
    view_mode,
    '''        mountViewModeButton();
        mountConnectionSidebarToggle();
        if (!isDevicesView() && expandedModeActive()) suspendExpandedModes();
        else if (isDevicesView() && !expandedModeActive()) restorePreferredExpandedMode();
        updateConnectionSidebarToggle();
        scheduleDesktopPresentation();''',
    '''        mountViewModeButton();
        mountConnectionSidebarToggle();
        mountConnectionHeaderToggle();
        if (!isDevicesView() && expandedModeActive()) suspendExpandedModes();
        else if (isDevicesView() && !expandedModeActive()) restorePreferredExpandedMode();
        updateConnectionSidebarToggle();
        updateConnectionHeaderToggle();
        scheduleDesktopPresentation();'''
)

replace_once(
    contract,
    '''        Require(viewMode.Contains("if (button.contains(event.target) || sidebar.contains(event.target)) return;", StringComparison.Ordinal) &&
                viewMode.Contains("setConnectionSidebarOpen(false);", StringComparison.Ordinal),
            "Clicking the expanded workspace outside the menu must hide the overlay.");
        Require(commandsCss.Contains(".sirk-quick-commands-panel", StringComparison.Ordinal),''',
    '''        Require(viewMode.Contains("if (button.contains(event.target) || sidebar.contains(event.target)) return;", StringComparison.Ordinal) &&
                viewMode.Contains("setConnectionSidebarOpen(false);", StringComparison.Ordinal),
            "Clicking the expanded workspace outside the menu must hide the overlay.");
        Require(viewMode.Contains(".sirk-connection-header-toggle", StringComparison.Ordinal) &&
                viewMode.Contains("sirk-device-connection-header-open .sirk-standalone-header", StringComparison.Ordinal) &&
                viewMode.Contains("grid-template-rows:minmax(0,1fr)", StringComparison.Ordinal) &&
                viewMode.Contains("function mountConnectionHeaderToggle()", StringComparison.Ordinal),
            "Connection full view must hide the top header and expose it through a compact overlay handle.");
        Require(viewMode.Contains("if (button.contains(event.target) || header.contains(event.target)) return;", StringComparison.Ordinal) &&
                viewMode.Contains("setConnectionHeaderOpen(false);", StringComparison.Ordinal),
            "Clicking outside the connection header overlay must hide it.");
        Require(viewMode.Contains("function exitPortalFullscreen()", StringComparison.Ordinal) &&
                viewMode.Contains("document.exitFullscreen()", StringComparison.Ordinal) &&
                viewMode.Contains("if (expandedModeActive()) exitExpandedModes();", StringComparison.Ordinal) &&
                viewMode.Contains("var alreadyActive = document.documentElement.classList.contains(\"sirk-device-connection-mode\") && !!document.fullscreenElement", StringComparison.Ordinal),
            "Expanded options must toggle off and always leave the browser fullscreen state.");
        Require(commandsCss.Contains(".sirk-quick-commands-panel", StringComparison.Ordinal),'''
)

print("Connection header overlay and fullscreen exit behavior applied.")
