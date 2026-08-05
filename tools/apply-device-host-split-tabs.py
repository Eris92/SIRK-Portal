from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8", newline="\n")


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    content = target.read_text(encoding="utf-8")
    if old not in content:
        raise RuntimeError(f"Expected fragment was not found in {path}: {old[:120]!r}")
    target.write_text(content.replace(old, new, 1), encoding="utf-8", newline="\n")


device_tabs_js = r'''(function () {
    "use strict";

    if (window.__sirkPlatformDeviceTabsV13Loaded) return;
    window.__sirkPlatformDeviceTabsV13Loaded = true;

    var STORAGE_KEY = "sirkPortal.deviceTabs";
    var state = {
        main: null,
        header: null,
        content: null,
        bar: null,
        menu: null,
        menuKey: "",
        panes: Object.create(null),
        pendingSection: Object.create(null),
        active: "all",
        restoreActive: "all",
        restored: false,
        restoreAttempted: false,
        bound: false,
        observer: null,
        resizeObserver: null,
        modeObserver: null,
        syncScheduled: false,
        switching: false,
        desktopModeWasActive: false
    };

    function clean(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
    function safeKey(value) { return clean(value).replace(/[^a-z0-9._:-]/gi, "_").slice(0, 180); }
    function language() {
        try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
        catch (error) { return document.documentElement.lang === "en" ? "en" : "pl"; }
    }
    function allLabel() { return language() === "en" ? "All" : "Wszystkie"; }
    function sectionLabels() {
        return language() === "en"
            ? [
                { key: "general", label: "Overview" },
                { key: "desktop", label: "Connection" },
                { key: "terminal", label: "Terminal" },
                { key: "commands", label: "Commands" },
                { key: "files", label: "Files" }
            ]
            : [
                { key: "general", label: "Ogólne" },
                { key: "desktop", label: "Połączenie" },
                { key: "terminal", label: "Terminal" },
                { key: "commands", label: "Polecenia" },
                { key: "files", label: "Pliki" }
            ];
    }

    function currentView() {
        var active = document.querySelector('.sirk-standalone-nav [data-view].is-active');
        return active ? String(active.getAttribute("data-view") || "") : "";
    }
    function devicesActive() { return currentView() === "devices"; }
    function wideMode() { return document.documentElement.classList.contains("sirk-device-focus-mode"); }
    function desktopMode() {
        return wideMode() || document.documentElement.classList.contains("sirk-device-connection-mode");
    }
    function contentIsWorkspace() {
        return !!(state.content && state.content.querySelector(".sirk-device-workspace"));
    }
    function contentIsDeviceList() {
        return !!(state.content && state.content.querySelector("[data-device-id],#sirkDevicesHost,.sirk-device-groups"));
    }

    function readPersisted() {
        try {
            var value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
            return value && typeof value === "object" ? value : {};
        } catch (error) { return {}; }
    }

    function persist() {
        try {
            var tabs = Object.keys(state.panes).map(function (key) {
                var pane = state.panes[key];
                return { key: pane.key, nodeId: pane.nodeId, name: pane.name, online: pane.online === true };
            });
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ active: state.active, tabs: tabs }));
        } catch (error) {}
    }

    function ensurePane(key, nodeId, name, online) {
        var pane = state.panes[key];
        if (!pane) {
            pane = { key: key, nodeId: nodeId || "", name: name || nodeId || key, online: online === true };
            state.panes[key] = pane;
        }
        if (nodeId) pane.nodeId = nodeId;
        if (name) pane.name = name;
        if (typeof online === "boolean") pane.online = online;
        return pane;
    }

    function restoreMetadata() {
        if (state.restored) return;
        state.restored = true;
        var saved = readPersisted();
        (Array.isArray(saved.tabs) ? saved.tabs : []).forEach(function (item) {
            var nodeId = clean(item && item.nodeId);
            var name = clean(item && item.name);
            var key = clean(item && item.key) || (nodeId ? "node:" + safeKey(nodeId) : "");
            if (!key || !nodeId) return;
            ensurePane(key, nodeId, name || nodeId, item && item.online === true);
        });
        state.restoreActive = state.panes[saved.active] ? saved.active : "all";
        state.active = "all";
    }

    function ensureMenu() {
        if (state.menu && state.menu.isConnected) return state.menu;
        state.menu = document.createElement("div");
        state.menu.className = "sirk-device-tab-menu";
        state.menu.hidden = true;
        state.menu.setAttribute("role", "menu");
        document.body.appendChild(state.menu);
        return state.menu;
    }

    function hideMenu() {
        if (state.menu) state.menu.hidden = true;
        state.menuKey = "";
        Array.prototype.forEach.call(document.querySelectorAll("[data-device-tab-menu-toggle]"), function (button) {
            button.setAttribute("aria-expanded", "false");
        });
    }

    function positionMenu(toggle) {
        if (!state.menu || state.menu.hidden || !toggle) return;
        var rect = toggle.getBoundingClientRect();
        var width = Math.max(190, state.menu.offsetWidth || 190);
        var height = state.menu.offsetHeight || 190;
        var left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.right - width));
        var top = rect.bottom + 6;
        if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
        state.menu.style.left = left + "px";
        state.menu.style.top = top + "px";
    }

    function showMenu(key, toggle) {
        if (!wideMode() || !state.panes[key]) return;
        var menu = ensureMenu();
        state.menuKey = key;
        var activeSection = "";
        if (state.active === key && state.content) {
            var current = state.content.querySelector("[data-device-tab].is-active");
            activeSection = current && current.getAttribute("data-device-tab") || "";
        }
        menu.innerHTML = sectionLabels().map(function (item) {
            return '<button type="button" role="menuitem" data-device-tab-section="' + item.key + '" class="' +
                (item.key === activeSection ? "is-active" : "") + '">' + item.label + '</button>';
        }).join("");
        menu.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
        positionMenu(toggle);
    }

    function renderTabs() {
        if (!state.bar) return;
        var keys = ["all"].concat(Object.keys(state.panes));
        var signature = keys.map(function (key) {
            return key === "all" ? "all:" + allLabel() : key + ":" + state.panes[key].name + ":" + (state.panes[key].online ? "1" : "0");
        }).join("|") + "@" + state.active + "@wide=" + (wideMode() ? "1" : "0");
        if (state.bar.getAttribute("data-tabs-signature") === signature) return;
        state.bar.setAttribute("data-tabs-signature", signature);
        state.bar.textContent = "";

        keys.forEach(function (key) {
            if (key === "all") {
                var all = document.createElement("button");
                all.type = "button";
                all.className = "sirk-device-tab sirk-device-tab-all" + (state.active === key ? " is-active" : "");
                all.setAttribute("role", "tab");
                all.setAttribute("aria-selected", state.active === key ? "true" : "false");
                all.setAttribute("data-device-workspace-key", key);
                all.textContent = allLabel();
                state.bar.appendChild(all);
                return;
            }

            var pane = state.panes[key];
            var shell = document.createElement("div");
            shell.className = "sirk-device-tab sirk-device-host-tab" +
                (state.active === key ? " is-active" : "") + (pane.online ? " is-online" : " is-offline");
            shell.setAttribute("role", "group");
            shell.setAttribute("data-device-host-tab", key);

            var main = document.createElement("button");
            main.type = "button";
            main.className = "sirk-device-tab-main";
            main.setAttribute("role", "tab");
            main.setAttribute("aria-selected", state.active === key ? "true" : "false");
            main.setAttribute("data-device-workspace-key", key);
            main.title = pane.name;
            var label = document.createElement("span");
            label.className = "sirk-device-tab-label";
            label.textContent = pane.name;
            main.appendChild(label);

            var actions = document.createElement("span");
            actions.className = "sirk-device-tab-actions";

            var close = document.createElement("button");
            close.type = "button";
            close.className = "sirk-device-tab-close";
            close.textContent = "×";
            close.setAttribute("data-device-tab-close", key);
            close.setAttribute("aria-label", (language() === "en" ? "Close " : "Zamknij ") + pane.name);

            var menuToggle = document.createElement("button");
            menuToggle.type = "button";
            menuToggle.className = "sirk-device-tab-menu-toggle";
            menuToggle.innerHTML = '<span aria-hidden="true">⌄</span>';
            menuToggle.setAttribute("data-device-tab-menu-toggle", key);
            menuToggle.setAttribute("aria-haspopup", "menu");
            menuToggle.setAttribute("aria-expanded", "false");
            menuToggle.setAttribute("aria-label", language() === "en" ? "Host sections" : "Sekcje hosta");
            menuToggle.disabled = !wideMode();

            actions.appendChild(close);
            actions.appendChild(menuToggle);
            shell.appendChild(main);
            shell.appendChild(actions);
            state.bar.appendChild(shell);
        });
    }

    function markActive(key) {
        state.active = key && state.panes[key] ? key : "all";
        renderTabs();
        persist();
    }

    function findRow(nodeId) {
        if (!state.content) return null;
        var rows = state.content.querySelectorAll("[data-device-id]");
        for (var index = 0; index < rows.length; index += 1) {
            if (clean(rows[index].getAttribute("data-device-id")) === clean(nodeId)) return rows[index];
        }
        return null;
    }

    function rowOnline(row) {
        return !!(row && (row.querySelector(".sirk-device-connection.is-online") ||
            row.classList.contains("is-online") || row.getAttribute("data-online") === "true"));
    }

    function applyPendingSection(key, attempt) {
        if (!state.pendingSection[key] || state.active !== key || !state.panes[key]) return;
        var pane = state.panes[key];
        var currentId = clean(state.content && state.content.getAttribute("data-sirk-active-device-id"));
        if (contentIsWorkspace() && currentId === pane.nodeId) {
            var section = state.pendingSection[key];
            var button = state.content.querySelector('[data-device-tab="' + section + '"]');
            if (button) {
                delete state.pendingSection[key];
                try { button.click(); } catch (error) {}
                return;
            }
        }
        if ((attempt || 0) < 120) {
            window.setTimeout(function () { applyPendingSection(key, (attempt || 0) + 1); }, 50);
        }
    }

    function activateAll() {
        hideMenu();
        markActive("all");
        if (state.content) state.content.removeAttribute("data-sirk-active-device-id");
        var back = state.content && state.content.querySelector("[data-device-back]");
        if (back) {
            try { back.click(); } catch (error) {}
            scheduleSync();
            return;
        }
        var devices = document.querySelector('.sirk-standalone-nav [data-view="devices"]');
        if (devices && !contentIsDeviceList()) {
            try { devices.click(); } catch (error) {}
        }
        scheduleSync();
    }

    function activatePane(key, section) {
        var pane = state.panes[key];
        if (!pane || state.switching) return;
        hideMenu();
        if (section) state.pendingSection[key] = section;
        markActive(key);

        var currentId = clean(state.content && state.content.getAttribute("data-sirk-active-device-id"));
        if (contentIsWorkspace() && currentId === pane.nodeId) {
            applyPendingSection(key, 0);
            return;
        }

        state.switching = true;
        var attempts = 0;
        function open() {
            attempts += 1;
            if (!devicesActive()) {
                var devices = document.querySelector('.sirk-standalone-nav [data-view="devices"]');
                if (devices) {
                    try { devices.click(); } catch (error) {}
                }
            }

            if (contentIsWorkspace()) {
                var back = state.content.querySelector("[data-device-back]");
                if (back) {
                    try { back.click(); } catch (error) {}
                }
                if (attempts < 160) window.setTimeout(open, 75);
                else state.switching = false;
                return;
            }

            var row = findRow(pane.nodeId);
            if (row) {
                pane.online = rowOnline(row);
                state.content.setAttribute("data-sirk-active-device-id", pane.nodeId);
                state.switching = false;
                try { row.click(); } catch (error) { state.switching = false; }
                applyPendingSection(key, 0);
                scheduleSync();
                return;
            }

            var nav = document.querySelector('.sirk-standalone-nav [data-view="devices"]');
            if (nav && !contentIsDeviceList()) {
                try { nav.click(); } catch (error) {}
            }
            if (attempts < 160) window.setTimeout(open, 75);
            else {
                state.switching = false;
                markActive("all");
            }
        }
        open();
    }

    function closeTab(key) {
        if (!state.panes[key]) return;
        hideMenu();
        var wasActive = state.active === key;
        delete state.panes[key];
        delete state.pendingSection[key];
        if (wasActive) activateAll();
        else {
            renderTabs();
            persist();
        }
    }

    function hostInfo(target) {
        if (!devicesActive() || !target || !target.closest || !contentIsDeviceList()) return null;
        var row = target.closest("[data-device-id],.sirk-device-row");
        if (!row || !state.content || !state.content.contains(row)) return null;
        var nodeId = clean(row.getAttribute("data-device-id"));
        var nameNode = row.querySelector(".sirk-device-primary strong,[data-device-name],.sirk-device-name,strong");
        var name = clean(nameNode && nameNode.textContent || "");
        if (!nodeId || !name) return null;
        return { key: "node:" + safeKey(nodeId), nodeId: nodeId, name: name.slice(0, 64), online: rowOnline(row) };
    }

    function intercept(event) {
        if (!ensureInfrastructure()) return;

        var close = event.target && event.target.closest && event.target.closest("[data-device-tab-close]");
        if (close && state.bar.contains(close)) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
            closeTab(close.getAttribute("data-device-tab-close"));
            return;
        }

        var menuToggle = event.target && event.target.closest && event.target.closest("[data-device-tab-menu-toggle]");
        if (menuToggle && state.bar.contains(menuToggle)) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
            var menuKey = menuToggle.getAttribute("data-device-tab-menu-toggle");
            if (state.menuKey === menuKey && state.menu && !state.menu.hidden) hideMenu();
            else showMenu(menuKey, menuToggle);
            return;
        }

        var section = event.target && event.target.closest && event.target.closest("[data-device-tab-section]");
        if (section && state.menu && state.menu.contains(section)) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
            activatePane(state.menuKey, section.getAttribute("data-device-tab-section"));
            return;
        }

        var tab = event.target && event.target.closest && event.target.closest("[data-device-workspace-key]");
        if (tab && state.bar.contains(tab)) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
            var key = tab.getAttribute("data-device-workspace-key");
            if (key === "all") activateAll();
            else activatePane(key, desktopMode() ? "desktop" : null);
            return;
        }

        var back = event.target && event.target.closest && event.target.closest("[data-device-back]");
        if (back && state.content && state.content.contains(back)) {
            markActive("all");
            state.content.removeAttribute("data-sirk-active-device-id");
            scheduleSync();
            return;
        }

        var navigation = event.target && event.target.closest && event.target.closest(".sirk-standalone-nav [data-view]");
        if (navigation) {
            if (navigation.getAttribute("data-view") !== "devices") state.switching = false;
            hideMenu();
            scheduleSync();
            return;
        }

        var info = hostInfo(event.target);
        if (!info) return;
        ensurePane(info.key, info.nodeId, info.name, info.online);
        if (desktopMode()) state.pendingSection[info.key] = "desktop";
        state.content.setAttribute("data-sirk-active-device-id", info.nodeId);
        markActive(info.key);
        applyPendingSection(info.key, 0);
        scheduleSync();
        // Deliberately do not stop propagation. The native device workspace opens in this document.
    }

    function scheduleSync() {
        if (state.syncScheduled) return;
        state.syncScheduled = true;
        window.requestAnimationFrame(function () {
            state.syncScheduled = false;
            sync();
        });
    }

    function sync() {
        if (!state.bar || !state.content) return;
        var visible = devicesActive();
        if (state.header) state.header.classList.toggle("is-devices-view", visible);
        state.bar.hidden = !visible;
        state.bar.style.display = visible ? "flex" : "none";
        if (!visible) {
            hideMenu();
            return;
        }

        var statusesChanged = false;
        if (contentIsDeviceList()) {
            Object.keys(state.panes).forEach(function (key) {
                var row = findRow(state.panes[key].nodeId);
                if (!row) return;
                var online = rowOnline(row);
                if (state.panes[key].online !== online) {
                    state.panes[key].online = online;
                    statusesChanged = true;
                }
            });
        }

        if (!contentIsWorkspace() && contentIsDeviceList()) {
            state.content.removeAttribute("data-sirk-active-device-id");
            if (!state.switching && state.active !== "all") markActive("all");
            if (!state.restoreAttempted && state.restoreActive !== "all" && state.panes[state.restoreActive]) {
                state.restoreAttempted = true;
                window.setTimeout(function () { activatePane(state.restoreActive, desktopMode() ? "desktop" : null); }, 0);
                return;
            }
        }

        var nowDesktopMode = desktopMode();
        if (nowDesktopMode && !state.desktopModeWasActive && state.active !== "all" && state.panes[state.active]) {
            state.pendingSection[state.active] = "desktop";
            applyPendingSection(state.active, 0);
        }
        state.desktopModeWasActive = nowDesktopMode;
        if (!wideMode()) hideMenu();
        if (statusesChanged) persist();
        renderTabs();
    }

    function bind() {
        if (state.bound) return;
        state.bound = true;
        window.addEventListener("click", intercept, true);
        window.addEventListener("resize", function () {
            scheduleSync();
            if (state.menu && !state.menu.hidden) {
                var toggle = state.bar.querySelector('[data-device-tab-menu-toggle="' + state.menuKey + '"]');
                positionMenu(toggle);
            }
        });
        window.addEventListener("scroll", function () {
            if (state.menu && !state.menu.hidden) {
                var toggle = state.bar.querySelector('[data-device-tab-menu-toggle="' + state.menuKey + '"]');
                positionMenu(toggle);
            }
        }, true);
        window.addEventListener("sirkportal:languagechange", function () {
            renderTabs();
            if (state.menu && !state.menu.hidden) {
                var toggle = state.bar.querySelector('[data-device-tab-menu-toggle="' + state.menuKey + '"]');
                showMenu(state.menuKey, toggle);
            }
        });
        window.addEventListener("sirkportal:deviceviewmodechange", scheduleSync);
        window.addEventListener("hashchange", scheduleSync);
        document.addEventListener("pointerdown", function (event) {
            if (!state.menu || state.menu.hidden) return;
            var toggle = event.target && event.target.closest && event.target.closest("[data-device-tab-menu-toggle]");
            if (!state.menu.contains(event.target) && !toggle) hideMenu();
        }, true);

        state.observer = new MutationObserver(scheduleSync);
        state.observer.observe(state.content, { childList: true });
        state.modeObserver = new MutationObserver(scheduleSync);
        state.modeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        if (window.ResizeObserver) {
            state.resizeObserver = new ResizeObserver(scheduleSync);
            state.resizeObserver.observe(state.content);
        }
    }

    function ensureInfrastructure() {
        var content = document.getElementById("sirkStandaloneContent");
        var main = content && content.closest(".sirk-standalone-main");
        var header = main && main.querySelector(".sirk-standalone-header");
        if (!content || !main || !header) return false;
        state.content = content;
        state.main = main;
        state.header = header;

        document.querySelectorAll(".sirk-standalone-sidebar .sirk-device-tabs,.sirk-standalone-nav .sirk-device-tabs,.sirk-device-session-layer").forEach(function (obsolete) {
            obsolete.remove();
        });

        if (!state.bar || !state.bar.isConnected) {
            state.bar = document.createElement("div");
            state.bar.className = "sirk-device-tabs sirk-device-tabs-standalone";
            state.bar.setAttribute("role", "tablist");
        }
        var userMenu = header.querySelector("#sirkUserMenu");
        var anchor = header.querySelector(".sirk-device-view-mode") || userMenu;
        if (state.bar.parentNode !== header || state.bar.nextElementSibling !== anchor) {
            header.insertBefore(state.bar, anchor || null);
        }
        restoreMetadata();
        ensureMenu();
        bind();
        renderTabs();
        return true;
    }

    function start() {
        if (!ensureInfrastructure()) {
            window.setTimeout(start, 100);
            return;
        }
        sync();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
}());
'''

write("public/portal/standalone/scripts/device-tabs.js", device_tabs_js)

write("public/portal/standalone/styles/device-tabs.css", r'''#sirkPortalRoot .sirk-standalone-main{display:flex!important;flex-direction:column!important;position:relative!important}
#sirkPortalRoot .sirk-standalone-header{flex:0 0 69px!important;gap:8px!important;padding:0 12px!important;border-bottom:1px solid var(--sirk-border,#dce3ec)!important}
#sirkPortalRoot .sirk-standalone-content{flex:1 1 auto!important;height:auto!important;min-height:0!important}
#sirkPortalRoot .sirk-device-tabs{display:flex;align-items:center;gap:8px;height:46px;min-height:46px;padding:4px 12px;border-bottom:1px solid var(--sirk-border,#dce3ec);background:var(--sirk-panel,#fff);overflow-x:auto;overflow-y:hidden;scrollbar-width:thin;box-sizing:border-box}
#sirkPortalRoot .sirk-device-tabs[hidden]{display:none!important}
#sirkPortalRoot .sirk-device-tabs-standalone{flex:1 1 auto;width:auto;min-width:0;height:46px;min-height:46px;margin:0;padding:4px 0;border:0!important;background:transparent;z-index:30}
#sirkPortalRoot .sirk-device-tab{flex:0 0 auto;max-width:230px;height:38px;min-height:38px;border:1px solid transparent;border-radius:9px;background:transparent;color:var(--sirk-muted,#657187);font:600 12px/1.1 Segoe UI,Arial,sans-serif;box-sizing:border-box;position:relative;transition:background .14s ease,border-color .14s ease,color .14s ease,box-shadow .14s ease}
#sirkPortalRoot button.sirk-device-tab{display:inline-flex;align-items:center;justify-content:center;padding:0 12px;cursor:pointer}
#sirkPortalRoot .sirk-device-host-tab{display:grid;grid-template-columns:minmax(72px,1fr) 25px;min-width:118px;padding:0;overflow:visible}
#sirkPortalRoot .sirk-device-tab-main{display:flex;align-items:center;justify-content:center;min-width:0;height:100%;padding:0 10px;border:0;border-radius:8px 0 0 8px;background:transparent;color:inherit;font:inherit;cursor:pointer}
#sirkPortalRoot .sirk-device-tab-actions{display:grid;grid-template-rows:minmax(0,1fr);height:100%;border-left:1px solid rgba(101,113,135,.28)}
#sirkPortalRoot .sirk-device-tab-close,#sirkPortalRoot .sirk-device-tab-menu-toggle{display:grid;place-items:center;width:24px;min-width:24px;height:100%;padding:0;border:0;background:transparent;color:inherit;font:600 14px/1 Segoe UI,Arial,sans-serif;cursor:pointer;opacity:.78}
#sirkPortalRoot .sirk-device-tab-menu-toggle{display:none;font-size:12px}
html.sirk-device-focus-mode #sirkPortalRoot .sirk-device-tab-actions{grid-template-rows:1fr 1fr}
html.sirk-device-focus-mode #sirkPortalRoot .sirk-device-tab-close{border-bottom:1px solid rgba(101,113,135,.28)}
html.sirk-device-focus-mode #sirkPortalRoot .sirk-device-tab-menu-toggle{display:grid}
#sirkPortalRoot .sirk-device-tab:hover,#sirkPortalRoot .sirk-device-tab:focus-within{border-color:rgba(96,165,250,.36);background:rgba(96,165,250,.10);color:var(--sirk-text,#172033)}
#sirkPortalRoot .sirk-device-tab.is-active{border-color:rgba(59,130,246,.48);background:rgba(59,130,246,.16);color:#2563eb;box-shadow:inset 0 0 0 1px rgba(59,130,246,.08)}
#sirkPortalRoot .sirk-device-host-tab.is-online{border-color:rgba(34,197,94,.9);box-shadow:inset 0 0 0 1px rgba(34,197,94,.14)}
#sirkPortalRoot .sirk-device-host-tab.is-online:hover,#sirkPortalRoot .sirk-device-host-tab.is-online:focus-within{border-color:#16a34a}
#sirkPortalRoot .sirk-device-host-tab.is-online.is-active{border-color:#16a34a;box-shadow:inset 0 0 0 1px rgba(34,197,94,.24),0 0 0 1px rgba(59,130,246,.08)}
#sirkPortalRoot .sirk-device-tab-label{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#sirkPortalRoot .sirk-device-tab-close:hover,#sirkPortalRoot .sirk-device-tab-close:focus-visible{background:rgba(220,38,38,.14);color:#dc2626;opacity:1;outline:none}
#sirkPortalRoot .sirk-device-tab-menu-toggle:hover,#sirkPortalRoot .sirk-device-tab-menu-toggle:focus-visible{background:rgba(59,130,246,.12);color:#2563eb;opacity:1;outline:none}
.sirk-device-tab-menu{position:fixed;z-index:2147483646;display:grid;min-width:190px;padding:5px;border:1px solid var(--sirk-border,#dce3ec);border-radius:10px;background:var(--sirk-panel,#fff);color:var(--sirk-text,#172033);box-shadow:0 14px 35px rgba(15,23,42,.28)}
.sirk-device-tab-menu[hidden]{display:none!important}
.sirk-device-tab-menu button{display:flex;align-items:center;min-height:36px;padding:8px 11px;border:0;border-radius:7px;background:transparent;color:inherit;text-align:left;font:600 13px Segoe UI,Arial,sans-serif;cursor:pointer}
.sirk-device-tab-menu button:hover,.sirk-device-tab-menu button:focus-visible{background:var(--sirk-hover,#eef3f9);outline:none}
.sirk-device-tab-menu button.is-active{background:rgba(59,130,246,.13);color:#2563eb}
#sirkPortalRoot .sirk-standalone-header.is-devices-view #sirkStandaloneTitle{display:none!important}
#sirkPortalRoot .sirk-standalone-header.is-devices-view .sirk-user-menu{flex:0 0 auto;margin-left:0}
#sirkPortalRoot .sirk-standalone-header.is-devices-view .sirk-user-tile{display:grid;place-items:center;width:44px;min-width:44px;height:44px;min-height:44px;padding:4px;gap:0;border-radius:12px}
#sirkPortalRoot .sirk-standalone-header.is-devices-view #sirkUserName{display:none!important}
#sirkPortalRoot .sirk-standalone-header.is-devices-view .sirk-user-tile img{width:34px;height:34px}
#sirkPortalRoot .sirk-native-bridge-label{display:none!important}
#sirkPortalRoot .sirk-device-session-layer{position:absolute;z-index:20;overflow:hidden;visibility:hidden;opacity:0;pointer-events:none;background:transparent}
#sirkPortalRoot .sirk-device-session-layer.is-active{visibility:visible;opacity:1;pointer-events:auto}
#sirkPortalRoot .sirk-device-session-pane{position:absolute;inset:0;display:block;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;visibility:hidden;opacity:0;pointer-events:none;background:transparent}
#sirkPortalRoot .sirk-device-session-pane.is-active{visibility:visible;opacity:1;pointer-events:auto}
#sirkPortalRoot .sirk-device-isolated-frame{display:block;width:100%;height:100%;min-height:0;border:0;background:transparent}
#sirkPortalRoot.sirk-theme-dark .sirk-device-tabs{--sirk-panel:#111827;--sirk-bg:#0b1220;--sirk-text:#e7edf7;--sirk-muted:#94a3b8;--sirk-border:#2a374a}
#sirkPortalRoot.sirk-theme-dark .sirk-device-tab.is-active{background:rgba(59,130,246,.22);color:#93c5fd}
html.sirk-device-workspace-child,
html.sirk-device-workspace-child body{width:100%!important;height:100%!important;margin:0!important;overflow:hidden!important}
html.sirk-device-workspace-child #sirkPortalRoot{width:100%!important;height:100%!important;min-height:100%!important}
html.sirk-device-workspace-child .sirk-standalone-sidebar{display:none!important}
html.sirk-device-workspace-child .sirk-standalone-root{grid-template-columns:minmax(0,1fr)!important}
html.sirk-device-workspace-child .sirk-standalone-main{display:flex!important;flex-direction:column!important;width:100%!important;height:100%!important;min-width:0!important}
html.sirk-device-workspace-child .sirk-standalone-main>header,
html.sirk-device-workspace-child .sirk-standalone-topbar{display:none!important}
html.sirk-device-workspace-child #sirkStandaloneContent{flex:1 1 auto!important;height:100vh!important;min-height:0!important;padding:12px!important;margin:0!important;overflow:hidden!important;box-sizing:border-box!important}
html.sirk-device-workspace-child #sirkStandaloneContent .sirk-device-workspace{height:100%!important;min-height:0!important;margin:0!important}
html.sirk-device-workspace-child #sirkStandaloneContent .sirk-device-compact-header{margin:0!important;border-radius:11px 11px 0 0!important}
html.sirk-device-workspace-child #sirkStandaloneContent .sirk-device-tabs{margin:0!important;padding-left:12px!important;padding-right:12px!important}
html.sirk-device-workspace-child #sirkStandaloneContent canvas{max-height:calc(100vh - 136px)!important}
''')

view_mode = ROOT / "public/portal/standalone/scripts/view-mode.js"
view_text = view_mode.read_text(encoding="utf-8")
replacements = [
    (
        '".sirk-device-view-mode{display:none;flex:0 0 auto;margin-left:8px;z-index:2147483000}",',
        '".sirk-device-view-mode{display:none;place-items:center;flex:0 0 44px;width:44px;height:44px;margin-left:0;z-index:2147483000}",'
    ),
    (
        '".sirk-standalone-header.is-devices-view .sirk-device-view-mode{display:block}",',
        '".sirk-standalone-header.is-devices-view .sirk-device-view-mode{display:grid}",'
    ),
    (
        '".sirk-device-view-mode-toggle{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:32px;height:32px;padding:0!important;line-height:0!important;border:1px solid var(--sirk-border,#dce3ec);border-radius:9px;background:var(--sirk-panel,#fff);color:var(--sirk-muted,#657187);cursor:pointer;box-shadow:0 3px 10px rgba(15,23,42,.08)}",',
        '".sirk-device-view-mode-toggle{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:44px;height:44px;padding:0!important;line-height:0!important;border:1px solid var(--sirk-border,#dce3ec);border-radius:12px;background:var(--sirk-panel,#fff);color:var(--sirk-muted,#657187);cursor:pointer;box-shadow:0 3px 10px rgba(15,23,42,.08)}",'
    ),
    (
        '".sirk-device-view-mode-toggle svg{display:block!important;flex:0 0 auto;width:17px;height:17px;margin:0!important;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}",',
        '".sirk-device-view-mode-toggle svg{display:block!important;flex:0 0 auto;width:20px;height:20px;margin:0!important;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}",'
    ),
    (
        '"html.sirk-device-focus-mode #sirkStandaloneContent{min-height:0!important}",',
        '"html.sirk-device-focus-mode #sirkStandaloneContent{min-height:0!important;padding:0!important;margin:0!important;overflow:hidden!important}",\n'
        '            "html.sirk-device-focus-mode .sirk-device-workspace{grid-template-rows:minmax(0,1fr)!important;width:100%!important;height:100%!important;min-height:0!important}",\n'
        '            "html.sirk-device-focus-mode .sirk-device-workspace>.sirk-device-compact-header,html.sirk-device-focus-mode .sirk-device-workspace>.sirk-device-tabs{display:none!important}",\n'
        '            "html.sirk-device-focus-mode .sirk-device-tab-body{width:100%!important;height:100%!important;min-height:0!important;border:0!important;border-radius:0!important}",\n'
        '            "html.sirk-device-focus-mode .sirk-agent-operation.sirk-agent-desktop{width:100%!important;height:100%!important;min-height:0!important;margin:0!important;box-sizing:border-box!important;overflow:hidden!important}",\n'
        '            "html.sirk-device-focus-mode .sirk-agent-desktop-stage{display:flex!important;flex:1 1 auto!important;width:100%!important;min-height:0!important;overflow:hidden!important}",\n'
        '            "html.sirk-device-focus-mode .sirk-agent-desktop-stage canvas{max-width:100%!important;max-height:100%!important;width:auto!important;height:auto!important;margin:auto!important}",'
    ),
    (
        '        window.dispatchEvent(new Event("resize"));\n    }\n\n    function setConnectionMode(enabled) {',
        '        window.dispatchEvent(new Event("resize"));\n        window.dispatchEvent(new CustomEvent("sirkportal:deviceviewmodechange", { detail: { focus: enabled, connection: false } }));\n    }\n\n    function setConnectionMode(enabled) {'
    ),
    (
        '        window.dispatchEvent(new Event("resize"));\n    }\n\n    function requestPortalFullscreen() {',
        '        window.dispatchEvent(new Event("resize"));\n        window.dispatchEvent(new CustomEvent("sirkportal:deviceviewmodechange", { detail: { focus: false, connection: enabled } }));\n    }\n\n    function requestPortalFullscreen() {'
    )
]
for old, new in replacements:
    if old not in view_text:
        raise RuntimeError(f"Expected view-mode fragment not found: {old[:120]!r}")
    view_text = view_text.replace(old, new, 1)
view_mode.write_text(view_text, encoding="utf-8", newline="\n")

contract = r'''namespace Sirk.Portal.ProtocolTests;

internal static class DeviceHostTabSplitContract
{
    public static void Run()
    {
        var root = FindRepositoryRoot();
        var tabsScript = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "device-tabs.js"));
        var tabsCss = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "styles", "device-tabs.css"));
        var viewMode = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "view-mode.js"));

        Require(tabsScript.Contains("sirk-device-tab-actions", StringComparison.Ordinal) &&
                tabsScript.Contains("data-device-tab-close", StringComparison.Ordinal) &&
                tabsScript.Contains("data-device-tab-menu-toggle", StringComparison.Ordinal),
            "Host tabs must expose a split close/menu control column.");
        Require(tabsScript.Contains("data-device-tab-section", StringComparison.Ordinal) &&
                tabsScript.Contains("Ogólne", StringComparison.Ordinal) &&
                tabsScript.Contains("Połączenie", StringComparison.Ordinal) &&
                tabsScript.Contains("Polecenia", StringComparison.Ordinal),
            "The expanded host menu must expose the device workspace sections.");
        Require(tabsScript.Contains("desktopMode() ? \"desktop\" : null", StringComparison.Ordinal) &&
                tabsScript.Contains("state.pendingSection[info.key] = \"desktop\"", StringComparison.Ordinal),
            "Opening a host in wide or connection mode must default to Desktop.");
        Require(tabsScript.Contains("row.querySelector(\".sirk-device-connection.is-online\")", StringComparison.Ordinal) &&
                tabsScript.Contains("is-online", StringComparison.Ordinal),
            "Host tabs must inherit the live online state from the device list.");

        Require(tabsCss.Contains(".sirk-device-host-tab.is-online", StringComparison.Ordinal) &&
                tabsCss.Contains("border-color:#16a34a", StringComparison.Ordinal),
            "Online host tabs must keep a green outline.");
        Require(tabsCss.Contains("html.sirk-device-focus-mode #sirkPortalRoot .sirk-device-tab-actions", StringComparison.Ordinal) &&
                tabsCss.Contains("html.sirk-device-focus-mode #sirkPortalRoot .sirk-device-tab-menu-toggle{display:grid}", StringComparison.Ordinal),
            "The lower split-menu control must only appear in wide mode.");
        Require(tabsCss.Contains("sirk-device-tab-all", StringComparison.Ordinal) ||
                tabsScript.Contains("sirk-device-tab sirk-device-tab-all", StringComparison.Ordinal),
            "All must remain a plain tab without host split controls.");

        Require(viewMode.Contains("width:44px;height:44px", StringComparison.Ordinal),
            "The view-mode and user controls must use the same 44px footprint.");
        Require(viewMode.Contains("sirk-device-focus-mode .sirk-device-workspace>.sirk-device-compact-header", StringComparison.Ordinal) &&
                viewMode.Contains("sirk-device-focus-mode .sirk-device-tab-body", StringComparison.Ordinal) &&
                viewMode.Contains("sirk-agent-desktop-stage canvas{max-width:100%!important;max-height:100%!important", StringComparison.Ordinal),
            "Wide mode must replace the inner tabs and dedicate the content area to the selected workspace, including Desktop.");
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
'''
write("tests/Sirk.Portal.ProtocolTests/DeviceHostTabSplitContract.cs", contract)
replace_once(
    "tests/Sirk.Portal.ProtocolTests/Program.cs",
    "DeviceConnectionWorkspaceContract.Run();\n",
    "DeviceConnectionWorkspaceContract.Run();\nDeviceHostTabSplitContract.Run();\n"
)
