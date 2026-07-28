(function () {
    "use strict";

    if (window.__sirkPlatformStandaloneNavigationLoaded) return;
    window.__sirkPlatformStandaloneNavigationLoaded = true;

    function asset(name) {
        var base = String(window.__SIRK_PLATFORM_ASSET_BASE__ || "").replace(/\/$/, "");
        var version = encodeURIComponent(String(window.__SIRK_PLATFORM_PORTAL_VERSION__ || ""));
        return base ? base + "/" + name + "?v=" + version : "";
    }

    function loadStyle(id, name) {
        var source = asset(name);
        if (!source || document.getElementById(id)) return;
        var link = document.createElement("link");
        link.id = id;
        link.rel = "stylesheet";
        link.href = source;
        (document.head || document.documentElement).appendChild(link);
    }

    function loadScript(id, name, onload) {
        var existing = document.getElementById(id);
        if (existing) {
            if (typeof onload === "function") onload();
            return;
        }
        var source = asset(name);
        if (!source) return;
        var script = document.createElement("script");
        script.id = id;
        script.src = source;
        script.async = false;
        if (typeof onload === "function") script.onload = onload;
        (document.head || document.documentElement).appendChild(script);
    }

    function loadUiContract() {
        loadStyle("sirk-platform-portal-ui-contract-style", "vendor/sirk-portal/portal-ui-contract.css");
        loadStyle("sirk-platform-portal-cleanup-style", "portal-cleanup.css");
        loadScript("sirk-platform-portal-ui-contract-script", "vendor/sirk-portal/portal-ui-contract.js");
        loadScript("sirk-platform-portal-cleanup-script", "portal-cleanup.js");
    }

    function replacePortalIcons() {
        if (!window.SirkIcons) return;
        var map = {
            overview: "home", devices: "devices", approvals: "approval",
            automation: "automation", monitoring: "monitoring", assets: "assets",
            management: "management", reports: "reports", security: "security", settings: "settings"
        };
        Object.keys(map).forEach(function (view) {
            var button = document.querySelector('.sirk-standalone-nav [data-view="' + view + '"]');
            var host = button && button.querySelector(":scope > span");
            if (host) host.innerHTML = window.SirkIcons.svg(map[view], "sirk-nav-svg");
        });
        var sidebar = document.querySelector('.sirk-standalone-controls [data-action="sidebar"]');
        if (sidebar) sidebar.innerHTML = window.SirkIcons.svg("chevron-left", "sirk-control-svg");
        var nativeLink = document.querySelector(".sirk-standalone-native > span");
        if (nativeLink) nativeLink.innerHTML = window.SirkIcons.svg("external-link", "sirk-nav-svg");
    }

    function commandsEnabled() {
        var runtime = window.SirkPlatformRuntime;
        var modules = runtime && runtime.state && runtime.state.bootstrap && runtime.state.bootstrap.modules;
        return !!(modules && modules.mycommands && modules.mycommands.enabled === true);
    }

    function normalizeDeviceWorkspace() {
        var content = document.getElementById("sirkStandaloneContent");
        var workspace = content && content.querySelector(":scope > .sirk-device-workspace");
        if (!workspace) return;
        var header = workspace.querySelector(":scope > .sirk-device-compact-header");
        var tabs = workspace.querySelector(":scope > .sirk-device-tabs,:scope > .sirk-device-compact-tabs");
        if (!header || !tabs) return;

        var commandsTab = tabs.querySelector('[data-device-tab="commands"]');
        if (commandsTab && !commandsEnabled()) {
            var wasActive = commandsTab.classList.contains("is-active") || commandsTab.getAttribute("aria-selected") === "true";
            commandsTab.remove();
            if (wasActive) {
                var overviewTab = tabs.querySelector('[data-device-tab="general"]');
                if (overviewTab) overviewTab.click();
            }
        }

        [".sirk-device-compact-back", ".sirk-device-compact-icon", ".sirk-device-compact-main"].forEach(function (selector) {
            var element = header.querySelector(selector);
            if (element) element.remove();
        });
        tabs.className = "sirk-device-compact-tabs";
        tabs.removeAttribute("role");
        if (tabs.parentNode !== header) header.insertBefore(tabs, header.firstChild);
        header.setAttribute("data-compact-tabs-mounted", "1");
    }

    function normalizeServerNavigation(primary, secondary) {
        var activePrimary = primary && primary.querySelector(":scope > .sirk-nav-item.active,:scope > .sirk-nav-item.is-active");
        if (!activePrimary || String(activePrimary.textContent || "").trim() !== "Server") return;
        if (secondary.querySelector(":scope > .sirk-settings-nav-group")) return;

        var buttons = {};
        Array.prototype.forEach.call(secondary.querySelectorAll(":scope > .sirk-nav-item"), function (button) {
            buttons[String(button.textContent || "").trim()] = button;
        });
        var labels = { "Debug · Config": "Config", "Debug · Logi": "Logi", "Debug · Błędy": "Błędy", "System · Backupy": "Backupy" };
        Object.keys(labels).forEach(function (source) { if (buttons[source]) buttons[source].textContent = labels[source]; });

        var updateButton = buttons["System · Aktualizacje"];
        var historyButton = buttons["System · Historia"];
        var channelButton = buttons["System · Kanał aktualizacji"];
        if (!updateButton || !historyButton || !channelButton) return;
        var group = document.createElement("details");
        group.className = "sirk-settings-nav-group";
        group.open = updateButton.classList.contains("active") || historyButton.classList.contains("active") || channelButton.classList.contains("active");
        var summary = document.createElement("summary");
        summary.textContent = "Aktualizacje";
        summary.style.cssText = "padding:9px 11px;cursor:pointer;font-weight:600";
        group.appendChild(summary);
        updateButton.textContent = "Sprawdź";
        historyButton.textContent = "Historia";
        channelButton.textContent = "Kanał";
        secondary.insertBefore(group, updateButton);
        group.appendChild(updateButton);
        group.appendChild(historyButton);
        group.appendChild(channelButton);
    }

    function removeModuleCardWrappers(workspace) {
        var primary = workspace.querySelector(":scope > .sirk-column-primary");
        var activePrimary = primary && primary.querySelector(":scope > .sirk-nav-item.active,:scope > .sirk-nav-item.is-active");
        if (!activePrimary || String(activePrimary.textContent || "").trim() !== "Settings") return;
        Array.prototype.forEach.call(workspace.querySelectorAll("[data-settings-form] [data-settings-section].sirk-card"), function (section) {
            section.classList.remove("sirk-card");
            section.classList.add("sirk-settings-section-plain");
        });
    }

    function normalizeUnifiedModuleToggle(workspace) {
        var form = workspace.querySelector("[data-settings-form]");
        if (!form) return;
        var fields = Array.prototype.slice.call(form.querySelectorAll("[data-settings-field]"));
        var visibility = null;
        var enabled = [];
        var technical = [];

        fields.forEach(function (field) {
            var label = field.querySelector("[data-settings-field-copy] strong");
            var text = String(label && label.textContent || "").trim();
            if (text === "Widoczność zakładki") visibility = field;
            else if (text === "Enabled") enabled.push(field);
            else if (["Show In Menu", "Show On Device", "Host Button Enabled", "Menu Enabled"].indexOf(text) >= 0) technical.push(field);
        });

        var primary = visibility || enabled[0];
        if (!primary) {
            technical.forEach(function (field) { field.hidden = true; });
            return;
        }

        var label = primary.querySelector("[data-settings-field-copy] strong");
        var description = primary.querySelector("[data-settings-field-copy] small");
        var primaryInput = primary.querySelector('input[type="checkbox"]');
        var linked = [];

        if (label) label.textContent = "Włącz i pokaż";
        if (description) description.textContent = "Jednocześnie włącza funkcję modułu i pokazuje jego zakładkę w Portalu.";
        primary.setAttribute("data-unified-module-toggle", "1");

        enabled.forEach(function (field) {
            if (field === primary) return;
            var input = field.querySelector('input[type="checkbox"]');
            if (input) linked.push(input);
            field.hidden = true;
        });
        if (visibility && visibility !== primary) {
            var visibilityInput = visibility.querySelector('input[type="checkbox"]');
            if (visibilityInput) linked.push(visibilityInput);
            visibility.hidden = true;
        }
        technical.forEach(function (field) { field.hidden = true; });

        if (!primaryInput || primaryInput.getAttribute("data-unified-toggle-bound") === "1") return;
        primaryInput.setAttribute("data-unified-toggle-bound", "1");
        if (linked.length) {
            primaryInput.checked = [primaryInput].concat(linked).every(function (input) { return input.checked; });
        }
        primaryInput.addEventListener("change", function () {
            linked.forEach(function (input) {
                if (input.checked === primaryInput.checked) return;
                input.checked = primaryInput.checked;
                input.dispatchEvent(new Event("change", { bubbles: true }));
            });
        });
    }

    function normalizeSettingsNavigation() {
        var content = document.getElementById("sirkStandaloneContent");
        var workspace = content && (content.querySelector("[data-portal-settings] .sirk-layout") || content.querySelector(".sirk-settings-module-workspace"));
        if (!workspace) return;
        var primary = workspace.querySelector(":scope > .sirk-column-primary");
        var activateSettings = false;
        var settingsPrimaryButton = null;
        if (primary) {
            Array.prototype.forEach.call(primary.querySelectorAll(":scope > .sirk-nav-item"), function (button) {
                var label = String(button.textContent || "").trim();
                if (label === "Settings") settingsPrimaryButton = button;
                if (label !== "Settings" && label !== "Server") {
                    if (button.classList.contains("active") || button.classList.contains("is-active")) activateSettings = true;
                    button.remove();
                }
            });
            if (activateSettings && settingsPrimaryButton && !settingsPrimaryButton.classList.contains("active") && !settingsPrimaryButton.classList.contains("is-active")) {
                settingsPrimaryButton.click();
                return;
            }
        }
        var secondary = workspace.querySelector(":scope > .sirk-column-secondary");
        if (!secondary) return;
        normalizeServerNavigation(primary, secondary);
        removeModuleCardWrappers(workspace);
        normalizeUnifiedModuleToggle(workspace);
    }

    function observeDeviceWorkspace() {
        var content = document.getElementById("sirkStandaloneContent");
        if (!content) return;
        var scheduled = false;
        var observer = new MutationObserver(function () {
            if (scheduled) return;
            scheduled = true;
            window.requestAnimationFrame(function () {
                scheduled = false;
                normalizeDeviceWorkspace();
            });
        });
        observer.observe(content, { childList: true, subtree: true });
        normalizeDeviceWorkspace();
    }

    function navigate(view) {
        view = String(view || "overview");
        var next = "#" + view;
        if (window.location.hash === next) window.dispatchEvent(new HashChangeEvent("hashchange"));
        else window.location.hash = next;
    }

    function bind() {
        var root = document.getElementById("sirkStandaloneRoot");
        if (!root) return false;
        Array.prototype.forEach.call(root.querySelectorAll(".sirk-standalone-nav [data-view]"), function (button) {
            if (button.getAttribute("data-standalone-nav-bound") === "1") return;
            button.setAttribute("data-standalone-nav-bound", "1");
            button.addEventListener("click", function (event) {
                event.preventDefault();
                event.stopPropagation();
                navigate(button.getAttribute("data-view"));
            });
        });
        return true;
    }

    loadUiContract();
    loadStyle("sirk-platform-system-updates-style", "system-updates.css");
    loadStyle("sirk-platform-settings-style", "settings.css");
    loadScript("sirk-platform-system-updates-script", "system-updates.js");
    loadScript("sirk-platform-settings-script", "settings.js");
    loadScript("sirk-platform-icon-registry", "shared/icon-registry.js", replacePortalIcons);
    observeDeviceWorkspace();
    loadScript("sirk-platform-portal-terminal-connect", "portal-terminal-connect.js");

    if (!bind()) {
        var attempts = 0;
        var timer = window.setInterval(function () {
            attempts += 1;
            if (bind() || attempts > 100) window.clearInterval(timer);
        }, 50);
    }
}());
