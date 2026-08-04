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
        return !!(modules && modules.commands && modules.commands.enabled === true);
    }

    function csrfToken() {
        var runtime = window.SirkPlatformRuntime;
        return String(runtime && runtime.state && runtime.state.bootstrap && runtime.state.bootstrap.csrfToken || "");
    }

    function centralApi(method, body) {
        var headers = { Accept: "application/json", "Cache-Control": "no-store" };
        if (method !== "GET") {
            headers["Content-Type"] = "application/json";
            headers["X-SIRK-CSRF"] = csrfToken();
        }
        return fetch("/api/modules/_central/bootstrap", {
            method: method,
            credentials: "same-origin",
            cache: "no-store",
            headers: headers,
            body: body ? JSON.stringify(body) : undefined
        }).then(function (response) {
            return response.json().catch(function () { throw new Error("Central API returned an invalid response."); })
                .then(function (value) {
                    if (!response.ok || value.ok === false) throw new Error(value.error || ("HTTP " + response.status));
                    return value;
                });
        });
    }

    function restartPortal(serviceName) {
        return fetch("/api/admin/runtime?action=server-restart", {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "Content-Type": "application/json", "X-SIRK-CSRF": csrfToken() },
            body: JSON.stringify({ serviceName: serviceName || "SirkPortal" })
        }).then(function (response) {
            return response.json().catch(function () { throw new Error("Restart API returned an invalid response."); })
                .then(function (value) {
                    if (!response.ok || value.ok === false) throw new Error(value.error || ("HTTP " + response.status));
                    return value;
                });
        });
    }

    function centralStatusMarkup(value) {
        value = value || {};
        if (!value.configured) return '<div class="sirk-card"><strong>Portal nie jest połączony z Central</strong><small>Utwórz Portal w Central i zaimportuj pobrany plik bootstrap JSON.</small></div>';
        return '<div class="sirk-card"><strong>Połączenie z Central skonfigurowane</strong>' +
            '<small>Portal ID: ' + String(value.portalId || "—") + '</small>' +
            '<small>Central: ' + String(value.centralUrl || "—") + '</small>' +
            '<small>Tunnel: ' + String(value.tunnelUrl || "—") + '</small>' +
            '<small>Aktualizacja: ' + String(value.updatedAtUtc || "—") + '</small></div>';
    }

    function showCentralSettings(workspace) {
        var details = workspace && workspace.querySelector(":scope > .sirk-column-details");
        if (!details) return;
        details.setAttribute("data-custom-settings-key", "central-connection");
        details.innerHTML = '<div data-central-status><div class="sirk-card"><strong>Ładowanie konfiguracji Central…</strong></div></div>' +
            '<div class="sirk-card"><strong>Import bootstrap JSON</strong><small>Plik jest generowany w SIRK Central. Token zostanie zapisany w chronionym pliku danych Portalu i nie będzie ponownie wyświetlany.</small>' +
            '<input type="file" accept="application/json,.json" data-central-bootstrap-file>' +
            '<div class="sirk-toolbar-group sirk-toolbar-left"><button type="button" class="sirk-button" data-central-bootstrap-save disabled>Zapisz i połącz</button><span data-central-message></span></div></div>';
        var fileInput = details.querySelector("[data-central-bootstrap-file]");
        var saveButton = details.querySelector("[data-central-bootstrap-save]");
        var message = details.querySelector("[data-central-message]");
        var payload = null;
        fileInput.onchange = function () {
            payload = null;
            saveButton.disabled = true;
            message.textContent = "";
            var file = fileInput.files && fileInput.files[0];
            if (!file) return;
            if (file.size > 65536) { message.textContent = "Plik bootstrap jest zbyt duży."; return; }
            file.text().then(function (text) {
                var parsed = JSON.parse(text);
                payload = parsed && parsed.bootstrap || parsed;
                if (!payload || typeof payload !== "object") throw new Error("Nieprawidłowy plik bootstrap.");
                saveButton.disabled = false;
                message.textContent = "Plik gotowy do importu.";
            }).catch(function (error) { message.textContent = error.message || String(error); });
        };
        saveButton.onclick = function () {
            if (!payload) return;
            saveButton.disabled = true;
            message.textContent = "Zapisywanie konfiguracji…";
            centralApi("POST", payload).then(function (result) {
                payload = null;
                fileInput.value = "";
                details.querySelector("[data-central-status]").innerHTML = centralStatusMarkup(result.value);
                message.textContent = "Konfiguracja zapisana. Restartowanie SIRK Portal…";
                return restartPortal(result.restartService);
            }).then(function () {
                window.setTimeout(function () { window.location.replace("/login"); }, 3000);
            }).catch(function (error) {
                message.textContent = error.message || String(error);
                saveButton.disabled = false;
            });
        };
        centralApi("GET").then(function (result) {
            var host = details.querySelector("[data-central-status]");
            if (host) host.innerHTML = centralStatusMarkup(result.value);
        }).catch(function (error) {
            var host = details.querySelector("[data-central-status]");
            if (host) host.innerHTML = '<div class="sirk-card" data-error="1">' + String(error.message || error) + '</div>';
        });
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

    function normalizeServerNavigation(primary, secondary, workspace) {
        var activePrimary = primary && primary.querySelector(":scope > .sirk-nav-item.active,:scope > .sirk-nav-item.is-active");
        if (!activePrimary || String(activePrimary.textContent || "").trim() !== "Server") return;
        var existingCentral = secondary.querySelector("[data-central-settings-button]");
        if (!existingCentral) {
            var central = document.createElement("button");
            central.type = "button";
            central.className = "sirk-nav-item sirk-settings-nav-leaf";
            central.textContent = "Central";
            central.setAttribute("data-central-settings-button", "1");
            central.onclick = function () {
                Array.prototype.forEach.call(secondary.querySelectorAll(".sirk-nav-item.active,.sirk-nav-item.is-active"), function (item) {
                    item.classList.remove("active", "is-active");
                });
                central.classList.add("active");
                showCentralSettings(workspace);
            };
            secondary.appendChild(central);
        }
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
        var workspace = content && (content.querySelector("[data-portal-settings] .sirk-layout-host") || content.querySelector(".sirk-settings-module-workspace"));
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
        normalizeServerNavigation(primary, secondary, workspace);
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
                normalizeSettingsNavigation();
            });
        });
        observer.observe(content, { childList: true, subtree: true });
        normalizeDeviceWorkspace();
        normalizeSettingsNavigation();
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
    replacePortalIcons();
    observeDeviceWorkspace();

    if (!bind()) {
        var attempts = 0;
        var timer = window.setInterval(function () {
            attempts += 1;
            if (bind() || attempts > 100) window.clearInterval(timer);
        }, 50);
    }
}());
