(function () {
    "use strict";

    if (window.__sirkDeviceTabsLifecycleV3Loaded) return;
    window.__sirkDeviceTabsLifecycleV3Loaded = true;

    var STORAGE_KEY = "sirkPortal.deviceWorkspaceLifecycle.v3";
    var lastMenuKey = "";
    var scheduled = false;
    var restoring = false;
    var LINK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 15l6-6M7 17l-1 1a3 3 0 104 4l3-3a3 3 0 000-4M17 7l1-1a3 3 0 10-4-4l-3 3a3 3 0 000 4"/></svg>';
    var UNLINK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 16l-2 2a3 3 0 104 4l3-3M16 8l2-2a3 3 0 10-4-4l-3 3M5 5l14 14"/></svg>';

    function root() { return document.getElementById("sirkPortalRoot"); }
    function content() { return document.getElementById("sirkStandaloneContent"); }
    function workspace() {
        var host = content();
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
    function readState() {
        try {
            var value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}");
            return value && typeof value === "object" ? value : {};
        } catch (_) { return {}; }
    }
    function writeState(value) {
        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value || {})); } catch (_) {}
    }
    function activeHost() {
        return document.querySelector(".sirk-device-host-tab.is-active");
    }
    function workspaceKey(ws) {
        var host = activeHost();
        var key = host && host.getAttribute("data-device-host-tab");
        if (key) return key;
        var holder = ws && ws.closest("#sirkStandaloneContent");
        var nodeId = holder && holder.getAttribute("data-sirk-active-device-id");
        return nodeId ? "node:" + safeKey(nodeId) : "";
    }
    function stateFor(key) {
        var state = readState();
        return key && state[key] || { connected: false, section: "general" };
    }
    function save(key, connected, section) {
        if (!key) return;
        var state = readState();
        if (connected) state[key] = { connected: true, section: section || "general" };
        else delete state[key];
        writeState(state);
    }
    function currentSection(ws) {
        var button = ws && ws.querySelector(":scope > .sirk-device-tabs [data-device-tab].is-active");
        return button && button.getAttribute("data-device-tab") || "general";
    }
    function connectionToggle(ws) {
        return ws && ws.querySelector("[data-sirk-workspace-connection-toggle]");
    }
    function connectionState(ws) {
        var toggle = connectionToggle(ws);
        return !!(toggle && toggle.getAttribute("aria-pressed") === "true");
    }
    function pointerDown(element) {
        if (!element) return;
        try {
            element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "mouse" }));
        } catch (_) {
            try { element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true })); } catch (_) {}
        }
    }
    function activateSection(ws, section) {
        if (!ws || !section) return false;
        var button = ws.querySelector(':scope > .sirk-device-tabs [data-device-tab="' + section + '"]');
        if (!button || button.disabled) return false;
        pointerDown(button);
        try { button.click(); } catch (_) { return false; }
        return true;
    }

    function syncPanes(ws) {
        if (!ws) return;
        var body = ws.querySelector("#sirkDeviceTabBody");
        var activeButton = ws.querySelector(":scope > .sirk-device-tabs [data-device-tab].is-active");
        var active = activeButton && activeButton.getAttribute("data-device-tab") ||
            body && body.getAttribute("data-active-device-pane") || "general";
        if (!body) return;
        Array.prototype.forEach.call(body.querySelectorAll(":scope > [data-device-pane]"), function (pane) {
            var selected = pane.getAttribute("data-device-pane") === active;
            pane.hidden = !selected;
            pane.classList.toggle("is-active", selected);
            pane.setAttribute("aria-hidden", selected ? "false" : "true");
            pane.style.setProperty("display", selected
                ? (active === "terminal" ? "flex" : "block")
                : "none", "important");
        });
        body.setAttribute("data-active-device-pane", active);
    }

    function restore(ws) {
        if (!ws || restoring) return;
        var key = workspaceKey(ws);
        var saved = stateFor(key);
        if (!key || saved.connected !== true) return;
        var toggle = connectionToggle(ws);
        if (!toggle) {
            window.setTimeout(function () { schedule(); }, 50);
            return;
        }
        restoring = true;
        if (toggle.getAttribute("aria-pressed") !== "true" && !toggle.disabled) {
            try { toggle.click(); } catch (_) {}
        }
        window.setTimeout(function () {
            activateSection(ws, saved.section || "general");
            syncPanes(ws);
            restoring = false;
        }, 80);
    }

    function findHostButton(key) {
        var buttons = document.querySelectorAll("[data-device-workspace-key]");
        for (var index = 0; index < buttons.length; index += 1) {
            if (buttons[index].getAttribute("data-device-workspace-key") === key) return buttons[index];
        }
        return null;
    }
    function openHost(key, callback) {
        var button = findHostButton(key);
        if (button && !button.closest(".sirk-device-host-tab.is-active")) {
            try { button.click(); } catch (_) {}
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
            var connected = toggle.getAttribute("aria-pressed") === "true";
            if (connected !== shouldConnect && !toggle.disabled) {
                try { toggle.click(); } catch (_) {}
            }
            window.setTimeout(function () {
                var actual = connectionState(ws);
                var section = shouldConnect && wideMode() ? "desktop" : currentSection(ws);
                save(key, actual, section);
                if (actual && shouldConnect && wideMode()) activateSection(ws, "desktop");
                schedule();
            }, 50);
        });
    }

    function expandedMenuKey() {
        var expanded = document.querySelector('[data-device-tab-menu-toggle][aria-expanded="true"]');
        return expanded && expanded.getAttribute("data-device-tab-menu-toggle") || lastMenuKey;
    }
    function syncMenu() {
        var menu = document.querySelector(".sirk-device-tab-menu");
        var portal = root();
        if (!menu || !portal) return;
        if (menu.parentNode !== portal) portal.appendChild(menu);
        if (!wideMode()) {
            menu.hidden = true;
            return;
        }
        if (menu.hidden) return;
        var key = expandedMenuKey();
        if (!key) return;
        lastMenuKey = key;
        var host = document.querySelector('[data-device-host-tab="' + key + '"]');
        var online = !!(host && host.classList.contains("is-online"));
        var ws = workspace();
        var connected = ws && workspaceKey(ws) === key ? connectionState(ws) : stateFor(key).connected === true;
        var button = menu.querySelector("[data-sirk-lifecycle-connection]");
        if (!button) {
            button = document.createElement("button");
            button.type = "button";
            button.setAttribute("role", "menuitem");
            button.setAttribute("data-sirk-lifecycle-connection", "1");
            menu.insertBefore(button, menu.firstChild);
        }
        button.className = "sirk-device-tab-menu-connection " + (connected ? "is-disconnect" : "is-connect");
        button.disabled = !connected && !online;
        button.setAttribute("data-device-key", key);
        button.setAttribute("data-connect", connected ? "0" : "1");
        button.innerHTML = (connected ? UNLINK_ICON : LINK_ICON) + "<span>" +
            (connected ? text("Rozłącz", "Disconnect") : text("Połącz", "Connect")) + "</span>";
    }

    function syncHostButtons() {
        var wide = wideMode();
        Array.prototype.forEach.call(document.querySelectorAll(".sirk-device-host-tab"), function (host) {
            host.classList.toggle("has-section-menu", wide);
            var menu = host.querySelector("[data-device-tab-menu-toggle]");
            if (menu) {
                menu.hidden = !wide;
                menu.style.setProperty("display", wide ? "grid" : "none", "important");
                if (!wide) menu.setAttribute("aria-expanded", "false");
            }
        });
        if (!wide) {
            var dropdown = document.querySelector(".sirk-device-tab-menu");
            if (dropdown) dropdown.hidden = true;
        }
    }

    function sync() {
        scheduled = false;
        var ws = workspace();
        syncHostButtons();
        syncPanes(ws);
        syncMenu();
        restore(ws);
    }
    function schedule() {
        if (scheduled) return;
        scheduled = true;
        window.requestAnimationFrame(sync);
    }

    document.addEventListener("pointerdown", function (event) {
        var menuToggle = event.target && event.target.closest && event.target.closest("[data-device-tab-menu-toggle]");
        if (menuToggle) lastMenuKey = menuToggle.getAttribute("data-device-tab-menu-toggle") || "";

        var tab = event.target && event.target.closest && event.target.closest(".sirk-device-workspace [data-device-tab]");
        if (tab) {
            window.setTimeout(function () {
                var ws = workspace();
                if (!ws) return;
                var key = workspaceKey(ws);
                if (connectionState(ws)) save(key, true, tab.getAttribute("data-device-tab") || "general");
                syncPanes(ws);
            }, 0);
        }

        var close = event.target && event.target.closest && event.target.closest("[data-device-tab-close]");
        if (close) {
            var key = close.getAttribute("data-device-tab-close") || "";
            save(key, false, "general");
        }
    }, true);

    document.addEventListener("click", function (event) {
        var action = event.target && event.target.closest && event.target.closest("[data-sirk-lifecycle-connection]");
        if (action) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
            var key = action.getAttribute("data-device-key") || lastMenuKey;
            setConnection(key, action.getAttribute("data-connect") === "1");
            var menu = action.closest(".sirk-device-tab-menu");
            if (menu) menu.hidden = true;
            return;
        }

        var toggle = event.target && event.target.closest && event.target.closest("[data-sirk-workspace-connection-toggle]");
        if (toggle) {
            window.setTimeout(function () {
                var ws = workspace();
                if (!ws) return;
                save(workspaceKey(ws), connectionState(ws), currentSection(ws));
                schedule();
            }, 0);
        }
        window.setTimeout(schedule, 0);
    }, true);

    window.addEventListener("sirkportal:languagechange", schedule);
    window.addEventListener("sirkportal:deviceviewmodechange", schedule);
    window.addEventListener("sirkportal:workspaceconnectionstate", schedule);
    window.addEventListener("sirkportal:desktopconnectionstate", schedule);
    window.addEventListener("hashchange", schedule);

    var style = document.createElement("style");
    style.id = "sirk-device-tabs-lifecycle-v3-style";
    style.textContent = [
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
        "#sirkPortalRoot .sirk-device-tab-menu-connection:disabled{opacity:.42!important;cursor:not-allowed!important}",
        "#sirkPortalRoot .sirk-device-tab-body{display:block!important;position:relative!important}",
        "#sirkPortalRoot .sirk-device-tab-pane{display:none!important;width:100%!important;height:100%!important;min-height:0!important;overflow:auto!important}",
        "#sirkPortalRoot .sirk-device-tab-pane.is-active{display:block!important}",
        "#sirkPortalRoot .sirk-device-tab-pane[data-device-pane=terminal].is-active{display:flex!important;flex-direction:column!important}",
        "#sirkPortalRoot .sirk-device-tab-pane[data-device-pane=desktop].is-active{display:block!important;overflow:hidden!important}"
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
