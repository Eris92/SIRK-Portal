(function () {
    "use strict";

    if (window.__sirkPlatformDeviceTabsV14Loaded) return;
    window.__sirkPlatformDeviceTabsV14Loaded = true;

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
    function wideMode() {
        return document.documentElement.classList.contains("sirk-device-focus-mode") ||
            document.documentElement.classList.contains("sirk-device-connection-mode");
    }
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

    function syncQuickCommandsToggle() {
        if (!state.header || !state.content) return;
        var panel = state.content.querySelector("#sirkQuickCommandsPanel");
        var toggle = document.getElementById("sirkQuickCommandsToggle");
        if (!panel) {
            if (toggle && toggle.classList.contains("is-header-mounted")) toggle.remove();
            return;
        }
        if (!toggle) return;
        if (!desktopMode()) {
            if (toggle.classList.contains("is-header-mounted")) {
                var operation = panel.parentElement;
                var stage = operation && operation.querySelector(".sirk-agent-desktop-stage");
                toggle.classList.remove("is-header-mounted");
                (stage || operation || state.content).appendChild(toggle);
            }
            return;
        }
        var anchor = state.header.querySelector(".sirk-device-view-mode") || state.header.querySelector("#sirkUserMenu");
        toggle.classList.add("is-header-mounted");
        if (toggle.parentNode !== state.header || toggle.nextElementSibling !== anchor) {
            state.header.insertBefore(toggle, anchor || null);
        }
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
            syncQuickCommandsToggle();
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
        syncQuickCommandsToggle();
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
        window.addEventListener("sirkportal:deviceviewmodechange", function (event) {
            var detail = event && event.detail || {};
            if ((detail.focus === true || detail.connection === true) && state.active !== "all" && state.panes[state.active]) {
                state.pendingSection[state.active] = "desktop";
                applyPendingSection(state.active, 0);
            }
            scheduleSync();
        });
        window.addEventListener("hashchange", scheduleSync);
        document.addEventListener("pointerdown", function (event) {
            if (!state.menu || state.menu.hidden) return;
            var toggle = event.target && event.target.closest && event.target.closest("[data-device-tab-menu-toggle]");
            if (!state.menu.contains(event.target) && !toggle) hideMenu();
        }, true);

        state.observer = new MutationObserver(scheduleSync);
        state.observer.observe(state.content, { childList: true, subtree: true });
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
