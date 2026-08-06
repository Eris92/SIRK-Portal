(function () {
    "use strict";

    var link = document.querySelector(".sirk-standalone-native");

    function apply(config) {
        if (!link) return;
        var visible = !config || config.showNativeLink !== false;
        link.hidden = !visible;
        link.style.display = visible ? "" : "none";
        link.setAttribute("aria-hidden", visible ? "false" : "true");
        if (!visible) link.setAttribute("tabindex", "-1");
        else link.removeAttribute("tabindex");
    }

    function currentConfig() {
        var runtime = window.SirkPlatformRuntime;
        var bootstrap = runtime && runtime.state && runtime.state.bootstrap;
        return bootstrap && bootstrap.modules && bootstrap.modules.portal && bootstrap.modules.portal.config;
    }

    function language() {
        try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
        catch (error) { return document.documentElement.lang === "en" ? "en" : "pl"; }
    }

    function text(pl, en) { return language() === "en" ? en : pl; }

    function installViewModeStyle() {
        if (document.getElementById("sirkDeviceViewModeStyle")) return;
        var style = document.createElement("style");
        style.id = "sirkDeviceViewModeStyle";
        style.textContent = [
            ".sirk-device-view-mode{display:none;place-items:center;flex:0 0 44px;width:44px;height:44px;margin-left:0;z-index:2147483000}",
            ".sirk-standalone-header.is-devices-view .sirk-device-view-mode{display:grid}",
            ".sirk-device-view-mode-toggle{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:44px;height:44px;padding:0!important;line-height:0!important;border:1px solid var(--sirk-border,#dce3ec);border-radius:12px;background:var(--sirk-panel,#fff);color:var(--sirk-muted,#657187);cursor:pointer;box-shadow:0 3px 10px rgba(15,23,42,.08)}",
            ".sirk-device-view-mode-toggle:hover,.sirk-device-view-mode-toggle:focus-visible,.sirk-device-view-mode-toggle.is-active{border-color:#60a5fa;color:#2563eb;outline:none}",
            ".sirk-device-view-mode-toggle svg{display:block!important;flex:0 0 auto;width:20px;height:20px;margin:0!important;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}",
            ".sirk-device-view-mode-menu{position:fixed!important;z-index:2147483647!important;display:grid;min-width:285px;padding:6px;border:1px solid var(--sirk-border,#dce3ec);border-radius:10px;background:var(--sirk-panel,#fff);color:var(--sirk-text,#172033);box-shadow:0 14px 35px rgba(15,23,42,.28)}",
            ".sirk-device-view-mode-menu[hidden]{display:none!important}",
            ".sirk-device-view-mode-menu button{display:flex;align-items:center;gap:9px;min-height:36px;padding:8px 10px;border:0;border-radius:7px;background:transparent;color:inherit;text-align:left;font:600 13px Segoe UI,Arial,sans-serif;cursor:pointer}",
            ".sirk-device-view-mode-menu button:hover,.sirk-device-view-mode-menu button:focus-visible{background:var(--sirk-hover,#eef3f9);outline:none}",
            ".sirk-device-view-mode-menu button.is-active{background:rgba(59,130,246,.12);color:#2563eb}",
            ".sirk-connection-sidebar-toggle{position:fixed!important;left:0;top:50%;z-index:2147483500;display:none!important;align-items:center;justify-content:center;width:34px;height:48px;padding:0;border:1px solid rgba(148,163,184,.72);border-left:0;border-radius:0 10px 10px 0;background:rgba(13,23,40,.9);color:#edf4ff;box-shadow:0 8px 22px rgba(15,23,42,.28);cursor:pointer;transform:translateY(-50%);transition:left .18s ease,background .18s ease,border-color .18s ease}",
            ".sirk-connection-sidebar-toggle:hover,.sirk-connection-sidebar-toggle:focus-visible{border-color:#60a5fa;background:#17263d;color:#fff;outline:none}",
            ".sirk-connection-sidebar-toggle svg{display:block;width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .18s ease}",
            "html.sirk-device-focus-mode .sirk-connection-sidebar-toggle,html.sirk-device-connection-mode .sirk-connection-sidebar-toggle{display:flex!important}",
            "html.sirk-device-focus-mode.sirk-device-connection-sidebar-open .sirk-connection-sidebar-toggle,html.sirk-device-connection-mode.sirk-device-connection-sidebar-open .sirk-connection-sidebar-toggle{left:248px}",
            "html.sirk-device-focus-mode.sirk-device-connection-sidebar-open .sirk-connection-sidebar-toggle svg,html.sirk-device-connection-mode.sirk-device-connection-sidebar-open .sirk-connection-sidebar-toggle svg{transform:rotate(180deg)}",
            "html.sirk-device-focus-mode.sirk-device-connection-sidebar-open .sirk-standalone-sidebar,html.sirk-device-connection-mode.sirk-device-connection-sidebar-open .sirk-standalone-sidebar{position:fixed!important;inset:0 auto 0 0!important;z-index:2147483400!important;display:flex!important;width:248px!important;height:100dvh!important;box-shadow:12px 0 30px rgba(15,23,42,.34)}",
            "html.sirk-device-focus-mode:not(.sirk-device-connection-sidebar-open) .sirk-standalone-sidebar{display:none!important}",
            "html.sirk-device-focus-mode .sirk-standalone-root{grid-template-columns:minmax(0,1fr)!important}",
            "html.sirk-device-focus-mode .sirk-standalone-topbar{display:none!important}",
            "html.sirk-device-focus-mode #sirkPortalRoot,html.sirk-device-focus-mode #sirkStandaloneRoot,html.sirk-device-focus-mode .sirk-standalone-main{width:100%!important;height:100%!important;min-height:100%!important}",
            "html.sirk-device-focus-mode .sirk-standalone-header,html.sirk-device-connection-mode .sirk-standalone-header{padding:2px 22px!important}",
            "html.sirk-device-focus-mode #sirkStandaloneContent{min-height:0!important;padding:0!important;margin:0!important;overflow:hidden!important}",
            "html.sirk-device-focus-mode .sirk-device-workspace{grid-template-rows:minmax(0,1fr)!important;width:100%!important;height:100%!important;min-height:0!important}",
            "html.sirk-device-focus-mode .sirk-device-workspace>.sirk-device-compact-header,html.sirk-device-focus-mode .sirk-device-workspace>.sirk-device-tabs{display:none!important}",
            "html.sirk-device-focus-mode .sirk-device-tab-body{width:100%!important;height:100%!important;min-height:0!important;border:0!important;border-radius:0!important}",
            "html.sirk-device-focus-mode .sirk-agent-desktop{width:100%!important;height:100%!important;min-height:0!important;margin:0!important;padding:0!important;gap:0!important;border-radius:0!important;box-sizing:border-box!important;overflow:hidden!important}",
            "html.sirk-device-focus-mode .sirk-agent-desktop-stage{display:flex!important;flex:1 1 auto!important;width:100%!important;min-height:0!important;overflow:hidden!important}",
            "html.sirk-device-focus-mode .sirk-agent-desktop-stage canvas{max-width:100%!important;max-height:100%!important;width:auto!important;height:auto!important;margin:auto!important}",
            "html.sirk-device-connection-mode .sirk-standalone-sidebar,html.sirk-device-connection-mode .sirk-standalone-topbar{display:none!important}",
            "html.sirk-device-connection-mode .sirk-standalone-root{grid-template-columns:minmax(0,1fr)!important}",
            "html.sirk-device-connection-mode #sirkPortalRoot,html.sirk-device-connection-mode #sirkStandaloneRoot,html.sirk-device-connection-mode .sirk-standalone-main{width:100%!important;height:100%!important;min-height:100%!important}",
            "html.sirk-device-connection-mode #sirkStandaloneContent{padding:0!important;margin:0!important;overflow:hidden!important}",
            "html.sirk-device-connection-mode .sirk-device-workspace{grid-template-rows:minmax(0,1fr)!important;width:100%!important;height:100%!important;min-height:0!important}",
            "html.sirk-device-connection-mode .sirk-device-workspace>.sirk-device-compact-header,html.sirk-device-connection-mode .sirk-device-workspace>.sirk-device-tabs{display:none!important}",
            "html.sirk-device-connection-mode .sirk-device-tab-body{width:100%!important;height:100%!important;min-height:0!important;border:0!important;border-radius:0!important}",
            "html.sirk-device-connection-mode .sirk-agent-desktop{width:100%!important;height:100%!important;min-height:0!important;margin:0!important;padding:0!important;gap:0!important;border-radius:0!important;box-sizing:border-box!important;overflow:hidden!important}",
            "html.sirk-device-connection-mode .sirk-agent-desktop-stage{position:relative!important;display:flex!important;flex:1 1 auto!important;width:100%!important;height:100%!important;min-height:0!important;border-radius:0!important;overflow:hidden!important}",
            "html.sirk-device-connection-mode .sirk-agent-desktop-stage canvas{display:block!important;max-width:100%!important;max-height:100%!important;width:auto!important;height:auto!important;margin:auto!important}",
            "html.sirk-device-focus-mode .sirk-agent-desktop>header,html.sirk-device-focus-mode .sirk-agent-desktop-controls,html.sirk-device-focus-mode .sirk-agent-desktop-stats,html.sirk-device-focus-mode .sirk-agent-desktop-admin,html.sirk-device-focus-mode .sirk-agent-desktop-input,html.sirk-device-focus-mode .sirk-agent-desktop-clipboard,html.sirk-device-focus-mode .sirk-agent-policy-action,html.sirk-device-focus-mode .sirk-agent-desktop>pre,html.sirk-device-connection-mode .sirk-agent-desktop>header,html.sirk-device-connection-mode .sirk-agent-desktop-controls,html.sirk-device-connection-mode .sirk-agent-desktop-stats,html.sirk-device-connection-mode .sirk-agent-desktop-admin,html.sirk-device-connection-mode .sirk-agent-desktop-input,html.sirk-device-connection-mode .sirk-agent-desktop-clipboard,html.sirk-device-connection-mode .sirk-agent-policy-action,html.sirk-device-connection-mode .sirk-agent-desktop>pre{display:none!important}",
            "html.sirk-device-focus-mode .sirk-agent-operation.sirk-agent-desktop,html.sirk-device-connection-mode .sirk-agent-operation.sirk-agent-desktop{display:flex!important;flex-direction:column!important;width:100%!important;height:100%!important;min-height:0!important;margin:0!important;padding:0!important;gap:0!important;border:0!important;border-radius:0!important;box-shadow:none!important;overflow:hidden!important}",
            "html.sirk-device-focus-mode .sirk-expanded-desktop-dock,html.sirk-device-connection-mode .sirk-expanded-desktop-dock{position:absolute;z-index:60;top:8px;right:8px;display:block}",
            "html.sirk-device-focus-mode .sirk-expanded-desktop-dock[hidden],html.sirk-device-connection-mode .sirk-expanded-desktop-dock[hidden]{display:none!important}",
            "html.sirk-device-focus-mode .sirk-expanded-desktop-dock .sirk-quick-commands-toggle,html.sirk-device-connection-mode .sirk-expanded-desktop-dock .sirk-quick-commands-toggle{position:relative!important;inset:auto!important;width:34px!important;min-width:34px!important;height:34px!important;min-height:34px!important;padding:0!important;border-radius:9px!important}",
            "html.sirk-device-focus-mode .sirk-expanded-desktop-dock .sirk-quick-commands-toggle span,html.sirk-device-connection-mode .sirk-expanded-desktop-dock .sirk-quick-commands-toggle span{display:none!important}",
            "html.sirk-device-focus-mode .sirk-expanded-desktop-dock .sirk-quick-commands-panel,html.sirk-device-connection-mode .sirk-expanded-desktop-dock .sirk-quick-commands-panel{position:absolute!important;top:42px!important;right:0!important;width:min(560px,calc(100vw - 32px))!important;max-height:min(480px,calc(100vh - 90px))!important;overflow:auto!important}",
            "html.sirk-device-workspace-child .sirk-device-view-mode{display:none!important}"
        ].join("");
        (document.head || document.documentElement).appendChild(style);
    }

    function isDevicesView() {
        var header = document.querySelector(".sirk-standalone-header");
        return !!(header && header.classList.contains("is-devices-view"));
    }

    function expandedModeActive() {
        return document.documentElement.classList.contains("sirk-device-focus-mode") ||
            document.documentElement.classList.contains("sirk-device-connection-mode");
    }

    var desktopPresentationTimer = 0;

    function scheduleDesktopPresentation() {
        if (desktopPresentationTimer) return;
        desktopPresentationTimer = window.setTimeout(function () {
            desktopPresentationTimer = 0;
            syncDesktopPresentation();
        }, 0);
    }

    function restoreStandardDesktop(operation, stage, toggle, panel, dock) {
        operation.classList.remove("is-expanded-desktop");
        operation.removeAttribute("data-sirk-expanded-auto-connect");
        if (toggle && stage && toggle.parentNode !== stage) stage.appendChild(toggle);
        if (panel && panel.parentNode !== operation) operation.appendChild(panel);
        if (dock) dock.remove();
        if (toggle) toggle.hidden = false;
    }

    function syncDesktopPresentation() {
        if (!isDevicesView() && expandedModeActive()) {
            exitExpandedModes();
            return;
        }

        var operation = document.querySelector("#sirkStandaloneContent .sirk-agent-operation.sirk-agent-desktop");
        if (!operation) return;
        var stage = operation.querySelector(".sirk-agent-desktop-stage");
        var toggle = operation.querySelector("#sirkQuickCommandsToggle") || document.getElementById("sirkQuickCommandsToggle");
        var panel = operation.querySelector("#sirkQuickCommandsPanel") || document.getElementById("sirkQuickCommandsPanel");
        var dock = operation.querySelector(".sirk-expanded-desktop-dock");
        var expanded = isDevicesView() && expandedModeActive();

        if (!expanded || !stage) {
            restoreStandardDesktop(operation, stage, toggle, panel, dock);
            return;
        }

        operation.classList.add("is-expanded-desktop");
        if (!dock) {
            dock = document.createElement("div");
            dock.className = "sirk-expanded-desktop-dock";
            dock.hidden = true;
            stage.appendChild(dock);
        }
        if (toggle && toggle.parentNode !== dock) dock.appendChild(toggle);
        if (panel && panel.parentNode !== dock) dock.appendChild(panel);

        var connect = operation.querySelector("[data-agent-desktop-connect]");
        var disconnect = operation.querySelector("[data-agent-desktop-disconnect]");
        var connected = !!(disconnect && !disconnect.disabled);
        dock.hidden = !connected;
        if (toggle) toggle.hidden = !connected;

        if (!connected && connect && !connect.disabled &&
            operation.getAttribute("data-sirk-expanded-auto-connect") !== "pending") {
            operation.setAttribute("data-sirk-expanded-auto-connect", "pending");
            connect.click();
            window.setTimeout(function () {
                if (!operation.isConnected) return;
                var currentDisconnect = operation.querySelector("[data-agent-desktop-disconnect]");
                if (!currentDisconnect || currentDisconnect.disabled)
                    operation.removeAttribute("data-sirk-expanded-auto-connect");
                scheduleDesktopPresentation();
            }, 3000);
        }
        else if (connected) {
            operation.setAttribute("data-sirk-expanded-auto-connect", "connected");
        }
    }

    function exitExpandedModes() {
        var changed = expandedModeActive() ||
            document.documentElement.classList.contains("sirk-device-connection-sidebar-open");
        document.documentElement.classList.remove("sirk-device-focus-mode");
        document.documentElement.classList.remove("sirk-device-connection-mode");
        document.documentElement.classList.remove("sirk-device-connection-sidebar-open");
        try { localStorage.setItem("sirkPortal.focusMode", "0"); } catch (error) {}
        updateConnectionSidebarToggle();
        scheduleDesktopPresentation();
        if (changed) {
            window.dispatchEvent(new Event("resize"));
            window.dispatchEvent(new CustomEvent("sirkportal:deviceviewmodechange", {
                detail: { focus: false, connection: false }
            }));
        }
    }

    function updateConnectionSidebarToggle() {
        var button = document.getElementById("sirkConnectionSidebarToggle");
        if (!button) return;
        var expanded = expandedModeActive();
        var open = expanded && document.documentElement.classList.contains("sirk-device-connection-sidebar-open");
        if (!expanded) document.documentElement.classList.remove("sirk-device-connection-sidebar-open");
        button.setAttribute("aria-expanded", open ? "true" : "false");
        button.setAttribute("aria-label", text(open ? "Ukryj lewe menu" : "Pokaż lewe menu", open ? "Hide left menu" : "Show left menu"));
        button.title = text(open ? "Ukryj lewe menu" : "Pokaż lewe menu", open ? "Hide left menu" : "Show left menu");
    }

    function setConnectionSidebarOpen(enabled) {
        var active = expandedModeActive();
        document.documentElement.classList.toggle("sirk-device-connection-sidebar-open", active && enabled);
        updateConnectionSidebarToggle();
        window.dispatchEvent(new Event("resize"));
    }

    function setFocusMode(enabled) {
        enabled = enabled === true && isDevicesView();
        document.documentElement.classList.toggle("sirk-device-focus-mode", enabled);
        if (enabled) {
            document.documentElement.classList.remove("sirk-device-connection-mode");
            document.documentElement.classList.remove("sirk-device-connection-sidebar-open");
        }
        try { localStorage.setItem("sirkPortal.focusMode", enabled ? "1" : "0"); }
        catch (error) {}
        updateConnectionSidebarToggle();
        scheduleDesktopPresentation();
        window.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new CustomEvent("sirkportal:deviceviewmodechange", { detail: { focus: enabled, connection: false } }));
    }

    function setConnectionMode(enabled) {
        enabled = enabled === true && isDevicesView();
        document.documentElement.classList.toggle("sirk-device-connection-mode", enabled);
        if (enabled) document.documentElement.classList.remove("sirk-device-focus-mode");
        else document.documentElement.classList.remove("sirk-device-connection-sidebar-open");
        updateConnectionSidebarToggle();
        scheduleDesktopPresentation();
        window.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new CustomEvent("sirkportal:deviceviewmodechange", { detail: { focus: false, connection: enabled } }));
    }

    function requestPortalFullscreen() {
        var target = document.getElementById("sirkPortalRoot") || document.documentElement;
        if (document.fullscreenElement) return Promise.resolve();
        if (target && typeof target.requestFullscreen === "function") {
            return target.requestFullscreen().catch(function () {});
        }
        return Promise.resolve();
    }

    function restoreFocusMode() {
        exitExpandedModes();
    }

    function mountConnectionSidebarToggle() {
        var sidebar = document.querySelector(".sirk-standalone-sidebar");
        if (!sidebar) return false;

        if (!sidebar.id) sidebar.id = "sirkStandaloneSidebar";

        var button = document.getElementById("sirkConnectionSidebarToggle");
        if (!button) {
            button = document.createElement("button");
            button.type = "button";
            button.id = "sirkConnectionSidebarToggle";
            button.className = "sirk-connection-sidebar-toggle";
            button.setAttribute("aria-controls", sidebar.id);
            button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

            button.addEventListener("click", function (event) {
                event.preventDefault();
                event.stopPropagation();
                setConnectionSidebarOpen(!document.documentElement.classList.contains("sirk-device-connection-sidebar-open"));
            });

            document.addEventListener("pointerdown", function (event) {
                if (!document.documentElement.classList.contains("sirk-device-connection-sidebar-open")) return;
                if (button.contains(event.target) || sidebar.contains(event.target)) return;
                setConnectionSidebarOpen(false);
            }, true);

            document.addEventListener("keydown", function (event) {
                if (event.key === "Escape") setConnectionSidebarOpen(false);
            });

            sidebar.addEventListener("click", function (event) {
                var navigation = event.target.closest && event.target.closest(".sirk-standalone-nav [data-view],.sirk-standalone-nav a");
                if (navigation) window.setTimeout(function () { setConnectionSidebarOpen(false); }, 0);
            });

            document.body.appendChild(button);
        } else {
            button.setAttribute("aria-controls", sidebar.id);
        }

        updateConnectionSidebarToggle();
        return true;
    }

    function mountViewModeButton() {
        var header = document.querySelector(".sirk-standalone-header");
        var userMenu = header && header.querySelector("#sirkUserMenu");
        if (!header || header.querySelector(".sirk-device-view-mode")) return false;

        var host = document.createElement("div");
        host.className = "sirk-device-view-mode";

        var toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "sirk-device-view-mode-toggle";
        toggle.setAttribute("aria-haspopup", "menu");
        toggle.setAttribute("aria-expanded", "false");
        toggle.title = text("Lewy klik: widok szeroki. Prawy klik: menu.", "Left click: wide view. Right click: menu.");
        toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>';

        var menu = document.createElement("div");
        menu.className = "sirk-device-view-mode-menu";
        menu.hidden = true;
        menu.setAttribute("role", "menu");

        function createItem(icon, pl, en) {
            var button = document.createElement("button");
            button.type = "button";
            button.setAttribute("role", "menuitem");
            button.innerHTML = "<span>" + icon + "</span><span>" + text(pl, en) + "</span>";
            return button;
        }

        var focus = createItem("▣", "Widok szeroki", "Wide view");
        var focusFullscreen = createItem("⛶", "Widok szeroki + tryb pełnoekranowy", "Wide view + fullscreen mode");
        var connection = createItem("◫", "Pełny ekran połączenia", "Connection full view");
        var connectionFullscreen = createItem("⛶", "Pełny ekran połączenia + tryb pełnoekranowy", "Connection full view + fullscreen mode");
        var openedAt = 0;

        function refresh() {
            var focusActive = document.documentElement.classList.contains("sirk-device-focus-mode");
            var connectionActive = document.documentElement.classList.contains("sirk-device-connection-mode");
            focus.classList.toggle("is-active", focusActive && !document.fullscreenElement);
            focusFullscreen.classList.toggle("is-active", focusActive && !!document.fullscreenElement);
            connection.classList.toggle("is-active", connectionActive && !document.fullscreenElement);
            connectionFullscreen.classList.toggle("is-active", connectionActive && !!document.fullscreenElement);
            toggle.classList.toggle("is-active", focusActive || connectionActive);
            updateConnectionSidebarToggle();
            scheduleDesktopPresentation();
        }

        function hideMenu() {
            menu.hidden = true;
            toggle.setAttribute("aria-expanded", "false");
        }

        function positionMenu() {
            if (menu.hidden) return;
            var rect = toggle.getBoundingClientRect();
            var menuWidth = Math.max(menu.offsetWidth || 285, 285);
            var menuHeight = menu.offsetHeight || 176;
            var left = Math.min(window.innerWidth - menuWidth - 8, Math.max(8, rect.right - menuWidth));
            var top = rect.bottom + 7;
            if (top + menuHeight > window.innerHeight - 8) top = Math.max(8, rect.top - menuHeight - 7);
            menu.style.left = left + "px";
            menu.style.top = top + "px";
        }

        function showMenu() {
            refresh();
            openedAt = Date.now();
            menu.hidden = false;
            toggle.setAttribute("aria-expanded", "true");
            positionMenu();
        }

        toggle.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            hideMenu();
            setFocusMode(!document.documentElement.classList.contains("sirk-device-focus-mode"));
            refresh();
        });

        toggle.addEventListener("contextmenu", function (event) {
            event.preventDefault();
            event.stopPropagation();
            showMenu();
        });

        menu.addEventListener("pointerdown", function (event) { event.stopPropagation(); });
        menu.addEventListener("contextmenu", function (event) {
            event.preventDefault();
            event.stopPropagation();
        });

        focus.addEventListener("click", function (event) {
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
        });

        document.addEventListener("pointerdown", function (event) {
            if (Date.now() - openedAt < 300) return;
            if (!host.contains(event.target) && !menu.contains(event.target)) hideMenu();
        }, true);
        document.addEventListener("contextmenu", function (event) {
            if (toggle.contains(event.target) || menu.contains(event.target)) return;
            hideMenu();
        }, true);
        document.addEventListener("fullscreenchange", refresh);
        window.addEventListener("resize", function () { if (!menu.hidden) positionMenu(); });
        window.addEventListener("scroll", function () { if (!menu.hidden) positionMenu(); }, true);

        menu.appendChild(focus);
        menu.appendChild(focusFullscreen);
        menu.appendChild(connection);
        menu.appendChild(connectionFullscreen);
        host.appendChild(toggle);
        header.insertBefore(host, userMenu || null);
        document.body.appendChild(menu);
        refresh();
        return true;
    }

    installViewModeStyle();
    restoreFocusMode();

    var config = currentConfig();
    if (config) apply(config);
    else {
        var attempts = 0;
        var timer = window.setInterval(function () {
            attempts += 1;
            var value = currentConfig();
            if (value || attempts >= 50) {
                window.clearInterval(timer);
                apply(value || {});
            }
        }, 100);
    }

    var viewModeMounted = mountViewModeButton();
    var sidebarToggleMounted = mountConnectionSidebarToggle();
    if (!viewModeMounted || !sidebarToggleMounted) {
        var mountAttempts = 0;
        var mountTimer = window.setInterval(function () {
            mountAttempts += 1;
            viewModeMounted = mountViewModeButton() || viewModeMounted;
            sidebarToggleMounted = mountConnectionSidebarToggle() || sidebarToggleMounted;
            if ((viewModeMounted && sidebarToggleMounted) || mountAttempts >= 200) window.clearInterval(mountTimer);
        }, 100);
    }

    document.addEventListener("click", function (event) {
        var navigation = event.target && event.target.closest &&
            event.target.closest(".sirk-standalone-nav [data-view]");
        if (!navigation) return;
        if (navigation.getAttribute("data-view") !== "devices") exitExpandedModes();
    }, true);

    var observerRoot = document.getElementById("sirkStandaloneRoot");
    if (observerRoot) new MutationObserver(function () {
        mountViewModeButton();
        mountConnectionSidebarToggle();
        if (!isDevicesView() && expandedModeActive()) exitExpandedModes();
        scheduleDesktopPresentation();
    }).observe(observerRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "disabled", "hidden"]
    });
    scheduleDesktopPresentation();
}());
