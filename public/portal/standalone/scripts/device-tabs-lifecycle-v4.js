(function () {
    "use strict";

    if (window.__sirkDeviceTabsLifecycleV4Loaded) return;
    window.__sirkDeviceTabsLifecycleV4Loaded = true;

    var STORAGE_KEY = "sirkPortal.deviceWorkspaceLifecycle.v4";
    var restoredWorkspaces = new WeakSet();
    var scheduled = false;
    var lastMenuKey = "";
    var LINK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 15l6-6M7 17l-1 1a3 3 0 104 4l3-3a3 3 0 000-4M17 7l1-1a3 3 0 10-4-4l-3 3a3 3 0 000 4"/></svg>';
    var UNLINK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 16l-2 2a3 3 0 104 4l3-3M16 8l2-2a3 3 0 10-4-4l-3 3M5 5l14 14"/></svg>';

    function portalRoot() { return document.getElementById("sirkPortalRoot"); }
    function contentRoot() { return document.getElementById("sirkStandaloneContent"); }
    function workspace() {
        var host = contentRoot();
        return host && host.querySelector(":scope > .sirk-device-workspace");
    }
    function wideMode() {
        return document.documentElement.classList.contains("sirk-device-focus-mode") ||
            document.documentElement.classList.contains("sirk-device-connection-mode");
    }
    function language() {
        try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
        catch (_) { return document.documentElement.lang === "en" ? "en" : "pl"; }
    }
    function text(pl, en) { return language() === "en" ? en : pl; }
    function safeKey(value) {
        return String(value || "").replace(/\s+/g, " ").trim()
            .replace(/[^a-z0-9._:-]/gi, "_").slice(0, 180);
    }
    function activeHost() { return document.querySelector(".sirk-device-host-tab.is-active"); }
    function workspaceKey(ws) {
        var host = activeHost();
        var key = host && host.getAttribute("data-device-host-tab");
        if (key) return key;
        var holder = ws && ws.closest("#sirkStandaloneContent");
        var nodeId = holder && holder.getAttribute("data-sirk-active-device-id");
        return nodeId ? "node:" + safeKey(nodeId) : "";
    }
    function readAll() {
        try {
            var value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}");
            return value && typeof value === "object" ? value : {};
        } catch (_) { return {}; }
    }
    function readState(key) {
        var all = readAll();
        return key && all[key] || { connected: false, section: "general" };
    }
    function writeState(key, connected, section) {
        if (!key) return;
        var all = readAll();
        if (connected) all[key] = { connected: true, section: section || "general" };
        else delete all[key];
        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(all)); } catch (_) {}
    }
    function connectionToggle(ws) {
        return ws && ws.querySelector("[data-sirk-workspace-connection-toggle]");
    }
    function connected(ws) {
        var toggle = connectionToggle(ws);
        return !!(toggle && toggle.getAttribute("aria-pressed") === "true");
    }
    function nav(ws) { return ws && ws.querySelector(":scope > .sirk-device-tabs"); }
    function sectionButton(ws, section) {
        var bar = nav(ws);
        return bar && bar.querySelector('[data-device-tab="' + section + '"]');
    }
    function activeSection(ws) {
        var bar = nav(ws);
        var button = bar && bar.querySelector("[data-device-tab].is-active");
        return button && button.getAttribute("data-device-tab") || "general";
    }
    function paneDisplay(section) {
        return section === "terminal" ? "flex" : "block";
    }

    function showSection(ws, section, persist) {
        if (!ws) return false;
        var button = sectionButton(ws, section);
        if (!button || button.disabled) return false;
        var bar = nav(ws);
        var body = ws.querySelector("#sirkDeviceTabBody");
        if (!bar || !body) return false;

        Array.prototype.forEach.call(bar.querySelectorAll("[data-device-tab]"), function (item) {
            var selected = item === button;
            item.classList.toggle("is-active", selected);
            item.setAttribute("aria-selected", selected ? "true" : "false");
            item.setAttribute("tabindex", selected ? "0" : "-1");
        });

        Array.prototype.forEach.call(body.children, function (pane) {
            if (!pane.hasAttribute("data-device-pane")) return;
            var paneSection = pane.getAttribute("data-device-pane") || "";
            var selected = paneSection === section;
            pane.hidden = !selected;
            pane.classList.toggle("is-active", selected);
            pane.setAttribute("aria-hidden", selected ? "false" : "true");
            if (selected) pane.style.setProperty("display", paneDisplay(section), "important");
            else pane.style.setProperty("display", "none", "important");
        });
        body.setAttribute("data-active-device-pane", section);

        if (persist !== false && connected(ws))
            writeState(workspaceKey(ws), true, section);
        return true;
    }

    function restoreWorkspace(ws) {
        if (!ws || restoredWorkspaces.has(ws)) return;
        restoredWorkspaces.add(ws);
        var key = workspaceKey(ws);
        var saved = readState(key);
        showSection(ws, activeSection(ws), false);
        if (!key || saved.connected !== true) return;

        var attempts = 0;
        function restoreConnection() {
            attempts += 1;
            if (!ws.isConnected) return;
            var toggle = connectionToggle(ws);
            if (!toggle) {
                if (attempts < 120) window.setTimeout(restoreConnection, 50);
                return;
            }
            if (!connected(ws) && !toggle.disabled) {
                try { toggle.click(); } catch (_) {}
            }
            window.setTimeout(function () {
                var section = saved.section || "general";
                if (!showSection(ws, section, false)) showSection(ws, "general", false);
            }, 80);
        }
        restoreConnection();
    }

    function syncHostMenuAvailability() {
        var wide = wideMode();
        Array.prototype.forEach.call(document.querySelectorAll(".sirk-device-host-tab"), function (host) {
            host.classList.toggle("has-section-menu", wide);
            var toggle = host.querySelector("[data-device-tab-menu-toggle]");
            if (!toggle) return;
            toggle.hidden = !wide;
            toggle.style.setProperty("display", wide ? "grid" : "none", "important");
            if (!wide) toggle.setAttribute("aria-expanded", "false");
        });
        if (!wide) {
            var menu = document.querySelector(".sirk-device-tab-menu");
            if (menu) menu.hidden = true;
        }
    }

    function currentMenuKey() {
        var expanded = document.querySelector('[data-device-tab-menu-toggle][aria-expanded="true"]');
        return expanded && expanded.getAttribute("data-device-tab-menu-toggle") || lastMenuKey;
    }
    function syncHostDropdown() {
        var menu = document.querySelector(".sirk-device-tab-menu");
        var root = portalRoot();
        if (!menu || !root) return;
        if (menu.parentNode !== root) root.appendChild(menu);
        if (!wideMode()) {
            menu.hidden = true;
            return;
        }
        if (menu.hidden) return;

        var key = currentMenuKey();
        if (!key) return;
        lastMenuKey = key;
        var host = document.querySelector('[data-device-host-tab="' + key + '"]');
        var online = !!(host && host.classList.contains("is-online"));
        var ws = workspace();
        var isConnected = ws && workspaceKey(ws) === key ? connected(ws) : readState(key).connected === true;
        var action = menu.querySelector("[data-sirk-lifecycle-connection]");
        if (!action) {
            action = document.createElement("button");
            action.type = "button";
            action.setAttribute("role", "menuitem");
            action.setAttribute("data-sirk-lifecycle-connection", "1");
            menu.insertBefore(action, menu.firstChild);
        }
        action.className = "sirk-device-tab-menu-connection " + (isConnected ? "is-disconnect" : "is-connect");
        action.disabled = !isConnected && !online;
        action.setAttribute("data-device-key", key);
        action.setAttribute("data-connect", isConnected ? "0" : "1");
        action.innerHTML = (isConnected ? UNLINK_ICON : LINK_ICON) + "<span>" +
            (isConnected ? text("Rozłącz", "Disconnect") : text("Połącz", "Connect")) + "</span>";
    }

    function openHost(key, callback) {
        var hostButton = document.querySelector('[data-device-workspace-key="' + key + '"]');
        if (hostButton && !hostButton.closest(".sirk-device-host-tab.is-active")) {
            try { hostButton.click(); } catch (_) {}
        }
        var attempts = 0;
        function wait() {
            attempts += 1;
            var ws = workspace();
            if (ws && workspaceKey(ws) === key) {
                callback(ws);
                return;
            }
            if (attempts < 160) window.setTimeout(wait, 50);
        }
        wait();
    }
    function setConnection(key, shouldConnect) {
        openHost(key, function (ws) {
            var toggle = connectionToggle(ws);
            if (!toggle) return;
            var current = connected(ws);
            if (current !== shouldConnect && !toggle.disabled) {
                try { toggle.click(); } catch (_) {}
            }
            window.setTimeout(function () {
                var actual = connected(ws);
                writeState(key, actual, activeSection(ws));
                syncHostDropdown();
            }, 80);
        });
    }

    function sync() {
        scheduled = false;
        var ws = workspace();
        syncHostMenuAvailability();
        if (ws) {
            restoreWorkspace(ws);
            showSection(ws, activeSection(ws), false);
        }
        syncHostDropdown();
    }
    function schedule() {
        if (scheduled) return;
        scheduled = true;
        window.requestAnimationFrame(sync);
    }

    document.addEventListener("click", function (event) {
        var tab = event.target && event.target.closest && event.target.closest(".sirk-device-workspace [data-device-tab]");
        if (tab && !tab.disabled) {
            var ws = tab.closest(".sirk-device-workspace");
            var section = tab.getAttribute("data-device-tab") || "general";
            window.setTimeout(function () { showSection(ws, section, true); }, 0);
        }

        var connectionAction = event.target && event.target.closest && event.target.closest("[data-sirk-lifecycle-connection]");
        if (connectionAction) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
            var key = connectionAction.getAttribute("data-device-key") || lastMenuKey;
            setConnection(key, connectionAction.getAttribute("data-connect") === "1");
            var menu = connectionAction.closest(".sirk-device-tab-menu");
            if (menu) menu.hidden = true;
            return;
        }

        var connectionButton = event.target && event.target.closest && event.target.closest("[data-sirk-workspace-connection-toggle]");
        if (connectionButton) {
            window.setTimeout(function () {
                var ws = workspace();
                if (!ws) return;
                writeState(workspaceKey(ws), connected(ws), activeSection(ws));
                schedule();
            }, 80);
        }

        var close = event.target && event.target.closest && event.target.closest("[data-device-tab-close]");
        if (close) writeState(close.getAttribute("data-device-tab-close") || "", false, "general");
        window.setTimeout(schedule, 0);
    }, true);

    document.addEventListener("pointerdown", function (event) {
        var menuToggle = event.target && event.target.closest && event.target.closest("[data-device-tab-menu-toggle]");
        if (menuToggle) lastMenuKey = menuToggle.getAttribute("data-device-tab-menu-toggle") || "";
    }, true);

    window.addEventListener("sirkportal:languagechange", schedule);
    window.addEventListener("sirkportal:deviceviewmodechange", schedule);
    window.addEventListener("sirkportal:workspaceconnectionstate", schedule);
    window.addEventListener("sirkportal:desktopconnectionstate", schedule);
    window.addEventListener("hashchange", schedule);

    var style = document.createElement("style");
    style.id = "sirk-device-tabs-lifecycle-v4-style";
    style.textContent = [
        "#sirkPortalRoot .sirk-device-workspace{grid-template-rows:auto minmax(0,1fr)!important}",
        "#sirkPortalRoot .sirk-device-workspace>.sirk-device-tabs{align-items:center!important;min-height:46px!important;height:auto!important;padding:4px 12px!important;border:0!important;border-bottom:1px solid var(--sirk-border,#2a374a)!important;border-radius:0!important;background:var(--sirk-panel,#fff)!important;overflow:visible!important}",
        "#sirkPortalRoot .sirk-device-workspace>.sirk-device-tabs [data-device-tab]{min-height:36px!important;padding:6px 12px!important;border:0!important;border-bottom:2px solid transparent!important;border-radius:0!important;background:transparent!important;color:var(--sirk-muted,#657187)!important;box-shadow:none!important}",
        "#sirkPortalRoot .sirk-device-workspace>.sirk-device-tabs [data-device-tab]:hover:not(:disabled),#sirkPortalRoot .sirk-device-workspace>.sirk-device-tabs [data-device-tab]:focus-visible{background:var(--sirk-hover,#eef3f9)!important;color:var(--sirk-text,#172033)!important}",
        "#sirkPortalRoot .sirk-device-workspace>.sirk-device-tabs [data-device-tab].is-active{border-bottom-color:var(--sirk-active-accent,#4d6bd8)!important;background:transparent!important;color:var(--sirk-active-accent,#4d6bd8)!important}",
        "#sirkPortalRoot .sirk-device-tab-body{display:block!important;position:relative!important;border:0!important;border-radius:0!important;background:var(--sirk-panel,#fff)!important}",
        "#sirkPortalRoot .sirk-device-tab-pane{display:none!important;width:100%!important;height:100%!important;min-height:0!important;overflow:auto!important}",
        "#sirkPortalRoot .sirk-device-tab-pane.is-active{display:block!important}",
        "#sirkPortalRoot .sirk-device-tab-pane[data-device-pane=terminal].is-active{display:flex!important;flex-direction:column!important}",
        "#sirkPortalRoot .sirk-device-tab-pane[data-device-pane=desktop].is-active{display:block!important;overflow:hidden!important}",
        "#sirkPortalRoot .sirk-device-tab-close{background:transparent!important;color:rgba(239,68,68,.72)!important;opacity:1!important}",
        "#sirkPortalRoot .sirk-device-tab-close:hover,#sirkPortalRoot .sirk-device-tab-close:focus-visible{background:transparent!important;color:#ef4444!important}",
        "#sirkPortalRoot .sirk-device-tab-close svg{width:12px!important;height:12px!important;stroke-width:2!important}",
        "#sirkPortalRoot .sirk-device-host-tab:not(.has-section-menu) .sirk-device-tab-actions{grid-template-rows:1fr!important}",
        "#sirkPortalRoot .sirk-device-host-tab:not(.has-section-menu) .sirk-device-tab-close{grid-row:1/span 2!important;border-bottom:0!important}",
        "#sirkPortalRoot .sirk-device-host-tab:not(.has-section-menu) .sirk-device-tab-menu-toggle{display:none!important}",
        "#sirkPortalRoot:not(.sirk-theme-dark) .sirk-device-tabs-standalone .sirk-device-host-tab.is-online{border-color:transparent!important;background:var(--sirk-hover,#eef3f9)!important;color:var(--sirk-text,#172033)!important;box-shadow:inset 3px 0 0 #16a34a,inset 0 0 0 1px var(--sirk-border,#dce3ec)!important}",
        "#sirkPortalRoot:not(.sirk-theme-dark) .sirk-device-tabs-standalone .sirk-device-host-tab.is-offline{border-color:transparent!important;background:var(--sirk-hover,#eef3f9)!important;color:var(--sirk-text,#172033)!important;box-shadow:inset 3px 0 0 #dc2626,inset 0 0 0 1px var(--sirk-border,#dce3ec)!important}",
        "#sirkPortalRoot.sirk-theme-dark .sirk-device-tabs-standalone .sirk-device-host-tab.is-online{border-color:transparent!important;background:var(--sirk-sidebar-active,#2b3b55)!important;color:#edf4ff!important;box-shadow:inset 3px 0 0 #16a34a,inset 0 0 0 1px rgba(255,255,255,.06)!important}",
        "#sirkPortalRoot.sirk-theme-dark .sirk-device-tabs-standalone .sirk-device-host-tab.is-offline{border-color:transparent!important;background:var(--sirk-sidebar-active,#2b3b55)!important;color:#edf4ff!important;box-shadow:inset 3px 0 0 #dc2626,inset 0 0 0 1px rgba(255,255,255,.06)!important}",
        "#sirkPortalRoot .sirk-device-tab-menu{min-width:196px;border-color:var(--sirk-border,#dce3ec)!important;background:var(--sirk-panel,#fff)!important;color:var(--sirk-text,#172033)!important}",
        "#sirkPortalRoot.sirk-theme-dark .sirk-device-tab-menu{--sirk-hover:#1d293b;--sirk-text:#e7edf7;--sirk-border:#2a374a;background:#111827!important;color:#e7edf7!important;border-color:#2a374a!important}",
        "#sirkPortalRoot .sirk-device-tab-menu-connection{gap:8px;margin-bottom:4px;border-bottom:1px solid var(--sirk-border,#dce3ec)!important;border-radius:7px 7px 3px 3px!important;font-weight:700!important}",
        "#sirkPortalRoot .sirk-device-tab-menu-connection svg{flex:0 0 15px;width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}",
        "#sirkPortalRoot .sirk-device-tab-menu-connection.is-connect{color:#15803d!important}",
        "#sirkPortalRoot .sirk-device-tab-menu-connection.is-disconnect{color:#dc2626!important}",
        "#sirkPortalRoot.sirk-theme-dark .sirk-device-tab-menu-connection.is-connect{color:#86efac!important}",
        "#sirkPortalRoot.sirk-theme-dark .sirk-device-tab-menu-connection.is-disconnect{color:#fca5a5!important}",
        "#sirkPortalRoot .sirk-device-tab-menu-connection:disabled{opacity:.42!important;cursor:not-allowed!important}"
    ].join("");
    (document.head || document.documentElement).appendChild(style);

    var observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "hidden", "aria-expanded", "aria-pressed", "data-active-device-pane"]
    });

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", schedule, { once: true });
    else schedule();
}());
