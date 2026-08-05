(function () {
    "use strict";

    if (window.__sirkPlatformDeviceTabsV12Loaded) return;
    window.__sirkPlatformDeviceTabsV12Loaded = true;

    var STORAGE_KEY = "sirkPortal.deviceTabs";
    var state = {
        main: null,
        content: null,
        bar: null,
        panes: Object.create(null),
        active: "all",
        restoreActive: "all",
        restored: false,
        restoreAttempted: false,
        bound: false,
        observer: null,
        resizeObserver: null,
        syncScheduled: false,
        switching: false
    };

    function clean(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
    function safeKey(value) { return clean(value).replace(/[^a-z0-9._:-]/gi, "_").slice(0, 180); }
    function language() {
        try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
        catch (error) { return document.documentElement.lang === "en" ? "en" : "pl"; }
    }
    function allLabel() { return language() === "en" ? "All" : "Wszystkie"; }

    function currentView() {
        var active = document.querySelector('.sirk-standalone-nav [data-view].is-active');
        return active ? String(active.getAttribute("data-view") || "") : "";
    }
    function devicesActive() { return currentView() === "devices"; }
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
                return { key: pane.key, nodeId: pane.nodeId, name: pane.name };
            });
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ active: state.active, tabs: tabs }));
        } catch (error) {}
    }

    function ensurePane(key, nodeId, name) {
        var pane = state.panes[key];
        if (!pane) {
            pane = { key: key, nodeId: nodeId || "", name: name || nodeId || key };
            state.panes[key] = pane;
        }
        if (nodeId) pane.nodeId = nodeId;
        if (name) pane.name = name;
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
            ensurePane(key, nodeId, name || nodeId);
        });
        state.restoreActive = state.panes[saved.active] ? saved.active : "all";
        state.active = "all";
    }

    function renderTabs() {
        if (!state.bar) return;
        var keys = ["all"].concat(Object.keys(state.panes));
        var signature = keys.map(function (key) {
            return key === "all" ? "all:" + allLabel() : key + ":" + state.panes[key].name;
        }).join("|") + "@" + state.active;
        if (state.bar.getAttribute("data-tabs-signature") === signature) return;
        state.bar.setAttribute("data-tabs-signature", signature);
        state.bar.textContent = "";

        keys.forEach(function (key) {
            var pane = key === "all" ? { name: allLabel() } : state.panes[key];
            var tab = document.createElement("button");
            tab.type = "button";
            tab.className = "sirk-device-tab" + (state.active === key ? " is-active" : "");
            tab.setAttribute("role", "tab");
            tab.setAttribute("aria-selected", state.active === key ? "true" : "false");
            tab.setAttribute("data-device-workspace-key", key);
            tab.title = pane.name;

            var label = document.createElement("span");
            label.className = "sirk-device-tab-label";
            label.textContent = pane.name;
            tab.appendChild(label);

            if (key !== "all") {
                var close = document.createElement("span");
                close.className = "sirk-device-tab-close";
                close.textContent = "×";
                close.setAttribute("role", "button");
                close.setAttribute("data-device-tab-close", key);
                close.setAttribute("aria-label", (language() === "en" ? "Close " : "Zamknij ") + pane.name);
                tab.appendChild(close);
            }
            state.bar.appendChild(tab);
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

    function activateAll() {
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

    function activatePane(key) {
        var pane = state.panes[key];
        if (!pane || state.switching) return;
        markActive(key);

        var currentId = clean(state.content && state.content.getAttribute("data-sirk-active-device-id"));
        if (contentIsWorkspace() && currentId === pane.nodeId) return;

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
                state.content.setAttribute("data-sirk-active-device-id", pane.nodeId);
                state.switching = false;
                try { row.click(); } catch (error) { state.switching = false; }
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
        var wasActive = state.active === key;
        delete state.panes[key];
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
        return { key: "node:" + safeKey(nodeId), nodeId: nodeId, name: name.slice(0, 64) };
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

        var tab = event.target && event.target.closest && event.target.closest(".sirk-device-tab[data-device-workspace-key]");
        if (tab && state.bar.contains(tab)) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
            var key = tab.getAttribute("data-device-workspace-key");
            if (key === "all") activateAll();
            else activatePane(key);
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
            if (navigation.getAttribute("data-view") !== "devices") {
                state.switching = false;
            }
            scheduleSync();
            return;
        }

        var info = hostInfo(event.target);
        if (!info) return;
        ensurePane(info.key, info.nodeId, info.name);
        state.content.setAttribute("data-sirk-active-device-id", info.nodeId);
        markActive(info.key);
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
        state.bar.hidden = !visible;
        state.bar.style.display = visible ? "flex" : "none";
        if (!visible) return;

        if (!contentIsWorkspace() && contentIsDeviceList()) {
            state.content.removeAttribute("data-sirk-active-device-id");
            if (!state.switching && state.active !== "all") markActive("all");
            if (!state.restoreAttempted && state.restoreActive !== "all" && state.panes[state.restoreActive]) {
                state.restoreAttempted = true;
                window.setTimeout(function () { activatePane(state.restoreActive); }, 0);
                return;
            }
        }
        renderTabs();
    }

    function bind() {
        if (state.bound) return;
        state.bound = true;
        window.addEventListener("click", intercept, true);
        window.addEventListener("resize", scheduleSync);
        window.addEventListener("sirkportal:languagechange", renderTabs);
        window.addEventListener("hashchange", scheduleSync);

        state.observer = new MutationObserver(scheduleSync);
        state.observer.observe(state.content, { childList: true });
        if (window.ResizeObserver) {
            state.resizeObserver = new ResizeObserver(scheduleSync);
            state.resizeObserver.observe(state.content);
        }
    }

    function ensureInfrastructure() {
        var content = document.getElementById("sirkStandaloneContent");
        var main = content && content.closest(".sirk-standalone-main");
        if (!content || !main) return false;
        state.content = content;
        state.main = main;

        document.querySelectorAll(".sirk-standalone-sidebar .sirk-device-tabs,.sirk-standalone-nav .sirk-device-tabs,.sirk-device-session-layer").forEach(function (obsolete) {
            obsolete.remove();
        });

        if (!state.bar || !state.bar.isConnected) {
            state.bar = document.createElement("div");
            state.bar.className = "sirk-device-tabs sirk-device-tabs-standalone";
            state.bar.setAttribute("role", "tablist");
            main.insertBefore(state.bar, content);
        }
        restoreMetadata();
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
