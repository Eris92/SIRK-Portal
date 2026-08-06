(function () {
    "use strict";

    if (window.__sirkDeviceTabSelectionStateV3Loaded) return;
    window.__sirkDeviceTabSelectionStateV3Loaded = true;

    var STORAGE_KEY = "sirkPortal.deviceTabs";
    var navigationToken = 0;
    var selectionSyncScheduled = false;

    function contentRoot() {
        return document.getElementById("sirkStandaloneContent");
    }

    function deviceBar() {
        return document.querySelector("#sirkPortalRoot .sirk-device-tabs-standalone");
    }

    function readState() {
        try {
            var value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
            return value && typeof value === "object" ? value : {};
        } catch (_) {
            return {};
        }
    }

    function writeActive(key) {
        try {
            var value = readState();
            value.active = key || "all";
            localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
        } catch (_) {}
    }

    function activeKey() {
        return String(readState().active || "all");
    }

    function paneMetadata(key) {
        var value = readState();
        var tabs = Array.isArray(value.tabs) ? value.tabs : [];
        for (var index = 0; index < tabs.length; index += 1) {
            if (String(tabs[index] && tabs[index].key || "") === key) return tabs[index];
        }
        return null;
    }

    function markSelected(key) {
        var bar = deviceBar();
        if (!bar) return;

        var all = bar.querySelector(".sirk-device-tab-all");
        if (all) {
            var allActive = key === "all";
            all.classList.toggle("is-active", allActive);
            all.setAttribute("aria-selected", allActive ? "true" : "false");
        }

        Array.prototype.forEach.call(bar.querySelectorAll(".sirk-device-host-tab"), function (host) {
            var active = host.getAttribute("data-device-host-tab") === key;
            host.classList.toggle("is-active", active);
            var main = host.querySelector(".sirk-device-tab-main");
            if (main) main.setAttribute("aria-selected", active ? "true" : "false");
        });
    }

    function scheduleSelectionSync() {
        if (selectionSyncScheduled) return;
        selectionSyncScheduled = true;
        window.requestAnimationFrame(function () {
            selectionSyncScheduled = false;
            markSelected(activeKey());
        });
    }

    function devicesNavigation() {
        return document.querySelector('.sirk-standalone-nav [data-view="devices"]');
    }

    function isDeviceList(root) {
        return !!(root && root.querySelector("[data-device-id],#sirkDevicesHost,.sirk-device-groups"));
    }

    function findDeviceRow(root, nodeId, name) {
        if (!root) return null;
        var rows = root.querySelectorAll("[data-device-id]");
        for (var index = 0; index < rows.length; index += 1) {
            if (nodeId && String(rows[index].getAttribute("data-device-id") || "") === String(nodeId))
                return rows[index];
        }
        if (!name) return null;
        for (var second = 0; second < rows.length; second += 1) {
            var label = rows[second].querySelector(".sirk-device-primary strong,[data-device-name],.sirk-device-name,strong");
            if (label && String(label.textContent || "").trim() === String(name).trim()) return rows[second];
        }
        return null;
    }

    function openAll() {
        navigationToken += 1;
        writeActive("all");
        markSelected("all");
        var root = contentRoot();
        if (root) root.removeAttribute("data-sirk-active-device-id");
        if (isDeviceList(root)) {
            scheduleSelectionSync();
            return;
        }
        var navigation = devicesNavigation();
        if (navigation) {
            try { navigation.click(); } catch (_) {}
        }
        window.setTimeout(scheduleSelectionSync, 0);
        window.setTimeout(scheduleSelectionSync, 100);
    }

    function openHost(key) {
        var token = ++navigationToken;
        var metadata = paneMetadata(key) || {};
        var nodeId = String(metadata.nodeId || "");
        var name = String(metadata.name || "");
        var root = contentRoot();
        var currentId = String(root && root.getAttribute("data-sirk-active-device-id") || "");

        writeActive(key);
        markSelected(key);
        if (root && root.querySelector(".sirk-device-workspace") && nodeId && currentId === nodeId) {
            scheduleSelectionSync();
            return;
        }

        if (!isDeviceList(root)) {
            var navigation = devicesNavigation();
            if (navigation) {
                try { navigation.click(); } catch (_) {}
            }
        }

        var attempts = 0;
        function activateRow() {
            if (token !== navigationToken) return;
            attempts += 1;
            var currentRoot = contentRoot();
            var row = findDeviceRow(currentRoot, nodeId, name);
            if (row) {
                var actualNodeId = String(row.getAttribute("data-device-id") || nodeId);
                if (currentRoot && actualNodeId)
                    currentRoot.setAttribute("data-sirk-active-device-id", actualNodeId);
                try { row.click(); } catch (_) {}
                markSelected(key);
                window.setTimeout(scheduleSelectionSync, 0);
                window.setTimeout(scheduleSelectionSync, 100);
                window.setTimeout(scheduleSelectionSync, 300);
                return;
            }
            if (attempts < 160) window.setTimeout(activateRow, 25);
        }
        window.setTimeout(activateRow, 0);
    }

    function restoreAttribute(element, key) {
        window.setTimeout(function () {
            if (element && element.isConnected && !element.hasAttribute("data-device-workspace-key"))
                element.setAttribute("data-device-workspace-key", key);
        }, 500);
    }

    function selectDirectly(element) {
        var key = element && element.getAttribute("data-device-workspace-key");
        if (!key) return false;
        writeActive(key);
        markSelected(key);
        element.removeAttribute("data-device-workspace-key");
        restoreAttribute(element, key);
        if (key === "all") openAll();
        else openHost(key);
        return true;
    }

    document.addEventListener("pointerdown", function (event) {
        if (event.button !== 0) return;
        var element = event.target && event.target.closest &&
            event.target.closest(".sirk-device-tabs-standalone [data-device-workspace-key]");
        if (!element) return;
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
        selectDirectly(element);
    }, true);

    document.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        var element = event.target && event.target.closest &&
            event.target.closest(".sirk-device-tabs-standalone [data-device-workspace-key]");
        if (!element) return;
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
        selectDirectly(element);
    }, true);

    var mutationRoot = document.getElementById("sirkPortalRoot") || document.body;
    if (mutationRoot) {
        new MutationObserver(scheduleSelectionSync).observe(mutationRoot, {
            childList: true,
            subtree: true
        });
    }
    window.addEventListener("hashchange", scheduleSelectionSync);
    window.addEventListener("sirkportal:deviceviewmodechange", scheduleSelectionSync);
    window.addEventListener("sirkportal:languagechange", scheduleSelectionSync);

    var style = document.createElement("style");
    style.id = "sirk-device-tab-selection-state-style";
    style.textContent = [
        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-host-tab{position:relative!important}",
        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-tab-all.is-active,#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-host-tab.is-active{border-color:rgba(255,255,255,.08)!important;background:var(--sirk-sidebar-active,#2b3b55)!important;color:#edf4ff!important}",
        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-tab-all.is-active{box-shadow:inset 3px 0 0 var(--sirk-view-accent,#4d6bd8),inset 0 0 0 1px rgba(255,255,255,.06)!important}",
        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-host-tab.is-online,#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-host-tab.is-offline{border-color:var(--sirk-border,#dce3ec)!important;box-shadow:none!important}",
        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-host-tab.is-active{box-shadow:inset 3px 0 0 var(--sirk-view-accent,#4d6bd8),inset 0 0 0 1px rgba(255,255,255,.06)!important}",
        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-host-tab::after{content:\"\";position:absolute;z-index:5;top:0;right:0;bottom:0;width:3px;pointer-events:none}",
        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-host-tab.is-online::after{background:#16a34a}",
        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-host-tab.is-offline::after{background:#dc2626}",
        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-host-tab.is-active .sirk-device-tab-main,#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-host-tab.is-active .sirk-device-tab-menu-toggle{color:inherit!important}",
        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-tab-all.is-active:hover,#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-host-tab.is-active:hover{background:var(--sirk-sidebar-active,#2b3b55)!important;color:#fff!important}"
    ].join("");
    (document.head || document.documentElement).appendChild(style);

    scheduleSelectionSync();
}());