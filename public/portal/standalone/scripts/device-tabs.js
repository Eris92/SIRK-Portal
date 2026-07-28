(function () {
    "use strict";

    if (window.__sirkPlatformDeviceTabsV11Loaded) return;
    window.__sirkPlatformDeviceTabsV11Loaded = true;

    var STORAGE_KEY = "sirkPortal.deviceTabs";
    var CHILD_PARAM = "sirkWorkspaceChild";
    var NODE_PARAM = "sirkWorkspaceNode";
    var NAME_PARAM = "sirkWorkspaceName";

    function clean(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
    function safeKey(value) { return clean(value).replace(/[^a-z0-9._:-]/gi, "_").slice(0, 180); }
    function language() {
        try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
        catch (error) { return document.documentElement.lang === "en" ? "en" : "pl"; }
    }
    function allLabel() { return language() === "en" ? "All" : "Wszystkie"; }
    function isChildWorkspace() {
        try { return new URL(window.location.href).searchParams.get(CHILD_PARAM) === "1"; }
        catch (error) { return false; }
    }

    function startChildWorkspace() {
        var url = new URL(window.location.href);
        var nodeId = clean(url.searchParams.get(NODE_PARAM));
        document.documentElement.classList.add("sirk-device-workspace-child");
        if (!nodeId) return;

        var opened = false;
        var attempts = 0;
        function openNode() {
            if (opened) return;
            attempts += 1;
            var devices = document.querySelector('.sirk-standalone-nav [data-view="devices"]');
            if (devices && !devices.classList.contains("is-active")) {
                try { devices.click(); } catch (error) {}
            }
            var rows = document.querySelectorAll("#sirkStandaloneContent [data-device-id]");
            for (var i = 0; i < rows.length; i += 1) {
                if (String(rows[i].getAttribute("data-device-id") || "") === nodeId) {
                    opened = true;
                    try { rows[i].click(); } catch (error) { opened = false; }
                    break;
                }
            }
            if (!opened && attempts < 300) window.setTimeout(openNode, 100);
        }
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", openNode, { once: true });
        else openNode();
    }

    if (isChildWorkspace()) {
        startChildWorkspace();
        return;
    }

    var state = {
        shell: null,
        main: null,
        content: null,
        bar: null,
        layer: null,
        panes: Object.create(null),
        active: "all",
        restored: false,
        restoreActive: "all",
        bound: false,
        observer: null,
        resizeObserver: null
    };

    function currentView() {
        var active = document.querySelector('.sirk-standalone-nav button.is-active[data-view]');
        return active ? String(active.getAttribute("data-view") || "") : "";
    }
    function devicesActive() { return currentView() === "devices"; }

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

    function workspaceUrl(pane) {
        var url = new URL(window.location.href);
        url.searchParams.set(CHILD_PARAM, "1");
        url.searchParams.set(NODE_PARAM, pane.nodeId);
        url.searchParams.set(NAME_PARAM, pane.name);
        url.searchParams.delete("sirkNative");
        url.hash = "devices";
        return url.href;
    }

    function createHostFrame(pane) {
        var wrapper = document.createElement("div");
        wrapper.className = "sirk-device-session-pane";
        wrapper.setAttribute("data-device-isolated-key", pane.key);
        wrapper.setAttribute("aria-hidden", "true");

        var frame = document.createElement("iframe");
        frame.className = "sirk-device-isolated-frame";
        frame.title = pane.name;
        frame.allow = "clipboard-read; clipboard-write; fullscreen";
        frame.src = workspaceUrl(pane);
        wrapper.appendChild(frame);
        return wrapper;
    }

    function ensurePane(key, nodeId, name, createFrame) {
        var pane = state.panes[key];
        if (!pane) {
            pane = { key: key, nodeId: nodeId || "", name: name || nodeId || key, element: null };
            state.panes[key] = pane;
        }
        if (nodeId) pane.nodeId = nodeId;
        if (name) pane.name = name;
        if (createFrame && !pane.element && state.layer) {
            pane.element = createHostFrame(pane);
            state.layer.appendChild(pane.element);
        }
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
            ensurePane(key, nodeId, name || nodeId, false);
        });
        state.restoreActive = state.panes[saved.active] ? saved.active : "all";
        state.active = state.restoreActive;
    }

    function updateLayerBounds() {
        if (!state.main || !state.content || !state.layer) return;
        state.main.style.position = "relative";
        state.layer.style.left = state.content.offsetLeft + "px";
        state.layer.style.top = state.content.offsetTop + "px";
        state.layer.style.width = state.content.offsetWidth + "px";
        state.layer.style.height = state.content.offsetHeight + "px";
    }

    function ensureInfrastructure() {
        var shell = document.getElementById("sirkStandaloneRoot");
        var content = document.getElementById("sirkStandaloneContent");
        var main = content && content.closest(".sirk-standalone-main");
        if (!shell || !content || !main) return false;

        state.shell = shell;
        state.content = content;
        state.main = main;

        document.querySelectorAll(".sirk-standalone-sidebar .sirk-device-tabs,.sirk-standalone-nav .sirk-device-tabs").forEach(function (wrong) { wrong.remove(); });

        if (!state.bar || !state.bar.isConnected) {
            state.bar = document.createElement("div");
            state.bar.className = "sirk-device-tabs sirk-device-tabs-standalone";
            state.bar.setAttribute("role", "tablist");
            main.insertBefore(state.bar, content);
        }
        if (!state.layer || !state.layer.isConnected) {
            state.layer = document.createElement("div");
            state.layer.className = "sirk-device-session-layer";
            state.layer.setAttribute("aria-hidden", "true");
            main.appendChild(state.layer);
        }

        restoreMetadata();
        bind();
        updateLayerBounds();
        sync();
        return true;
    }

    function contentIsDeviceList() {
        return !!(state.content && state.content.querySelector("[data-device-id],#sirkDevicesHost,.sirk-device-groups"));
    }

    function showPane(key) {
        if (!state.content || !state.layer) return false;
        if (key !== "all" && !state.panes[key]) return false;

        state.active = key;
        var hostVisible = devicesActive() && key !== "all";

        Object.keys(state.panes).forEach(function (paneKey) {
            var pane = state.panes[paneKey];
            if (!pane.element) return;
            var active = hostVisible && paneKey === key;
            pane.element.classList.toggle("is-active", active);
            pane.element.setAttribute("aria-hidden", active ? "false" : "true");
        });

        state.layer.classList.toggle("is-active", hostVisible);
        state.layer.setAttribute("aria-hidden", hostVisible ? "false" : "true");
        state.content.style.visibility = hostVisible ? "hidden" : "";
        state.content.style.pointerEvents = hostVisible ? "none" : "";

        renderTabs();
        persist();
        updateLayerBounds();
        window.dispatchEvent(new Event("resize"));
        return true;
    }

    function activate(key) {
        if (key === "all") {
            showPane("all");
            return;
        }
        var pane = state.panes[key];
        if (!pane) return;
        ensurePane(key, pane.nodeId, pane.name, true);
        showPane(key);
    }

    function activateAll() { activate("all"); }

    function closeTab(key) {
        if (!state.panes[key]) return;
        var pane = state.panes[key];
        var wasActive = state.active === key;
        if (pane.element) {
            pane.element.querySelectorAll("iframe").forEach(function (frame) { frame.src = "about:blank"; });
            pane.element.remove();
        }
        delete state.panes[key];
        if (wasActive) showPane("all");
        else {
            renderTabs();
            persist();
        }
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

    function hostInfo(target) {
        if (!devicesActive() || state.active !== "all" || !target || !target.closest || !contentIsDeviceList()) return null;
        var row = target.closest("[data-device-id],.sirk-device-row");
        if (!row || !state.content.contains(row)) return null;
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
            activate(tab.getAttribute("data-device-workspace-key"));
            return;
        }

        var info = hostInfo(event.target);
        if (!info) return;
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
        ensurePane(info.key, info.nodeId, info.name, true);
        showPane(info.key);
    }

    function bind() {
        if (state.bound) return;
        state.bound = true;
        window.addEventListener("click", intercept, true);
        window.addEventListener("resize", updateLayerBounds);
        window.addEventListener("sirkportal:languagechange", function () { renderTabs(); });
        if (window.ResizeObserver) {
            state.resizeObserver = new ResizeObserver(updateLayerBounds);
            if (state.main) state.resizeObserver.observe(state.main);
            if (state.content) state.resizeObserver.observe(state.content);
        }
    }

    function sync() {
        if (!state.bar || !state.layer || !state.content) return;
        var visible = devicesActive();
        state.bar.hidden = !visible;
        state.bar.style.display = visible ? "flex" : "none";

        if (!visible) {
            state.layer.classList.remove("is-active");
            state.layer.setAttribute("aria-hidden", "true");
            state.content.style.visibility = "";
            state.content.style.pointerEvents = "";
            Object.keys(state.panes).forEach(function (key) {
                if (state.panes[key].element) state.panes[key].element.classList.remove("is-active");
            });
            return;
        }

        if (state.active !== "all" && state.panes[state.active]) {
            ensurePane(state.active, state.panes[state.active].nodeId, state.panes[state.active].name, true);
            showPane(state.active);
        } else if (contentIsDeviceList()) {
            showPane("all");
        }
        updateLayerBounds();
    }

    function start() {
        ensureInfrastructure();
        state.observer = new MutationObserver(function () {
            window.setTimeout(function () { ensureInfrastructure(); sync(); }, 0);
        });
        state.observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden", "data-active-view"] });
        window.setInterval(sync, 500);
    }

    window.SirkPlatformDeviceTabs = {
        mount: ensureInfrastructure,
        activateAll: activateAll,
        activate: activate,
        close: closeTab,
        debug: function () {
            var result = { active: state.active, mode: "persistent-session-layer", panes: {} };
            Object.keys(state.panes).forEach(function (key) {
                result.panes[key] = {
                    mounted: !!(state.panes[key].element && state.panes[key].element.isConnected),
                    active: !!(state.panes[key].element && state.panes[key].element.classList.contains("is-active"))
                };
            });
            return result;
        }
    };

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
}());
