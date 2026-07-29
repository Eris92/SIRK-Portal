(function () {
    "use strict";

    var STORAGE_LANGUAGE = "sirkPortal.language";
    var core = window.SirkPlatformCore;
    var root = document.getElementById("sirkStandaloneRoot");
    var portalRoot = document.getElementById("sirkPortalRoot");
    var content = document.getElementById("sirkStandaloneContent");
    var title = document.getElementById("sirkStandaloneTitle");
    var bootstrap = null;
    var initialized = Object.create(null);
    var renderSequence = 0;
    var activeView = "overview";
    var deviceInventory = null;
    var selectedDeviceId = "";
    var deviceSearch = "";
    var deviceFilter = "all";

    var TEXT = {
        pl: {
            overview: "Przegląd", devices: "Urządzenia", approvals: "Akceptacje",
            automation: "Automatyzacja", monitoring: "Monitoring", assets: "Zasoby",
            management: "Zarządzanie", reports: "Raporty", security: "Bezpieczeństwo",
            settings: "Ustawienia", logout: "Wyloguj się",
            collapse: "Zwiń menu", expand: "Rozwiń menu", theme: "Zmień motyw",
            switchToDark: "Włącz ciemny motyw", switchToLight: "Włącz jasny motyw",
            languageTitle: "Switch to English", loading: "Ładowanie…",
            loadingModules: "Ładowanie modułów SirkPlatform…", loadingDevices: "Ładowanie urządzeń…",
            unknownError: "Nieznany błąd Portalu.", moduleDisabled: "moduł jest wyłączony albo użytkownik nie ma dostępu.",
            loadFailed: "nie udało się załadować danych.",
            overviewDevicesTitle: "Urządzenia", overviewDevicesSuffix: "urządzeń połączonych z SIRK Portal.",
            overviewDevicesLoading: "Pobieranie listy urządzeń…",
            overviewApprovalsTitle: "Akceptacje",
            overviewApprovalsDescription: "Move Requests, Commands i Scripts wymagające zatwierdzenia.",
            overviewApprovalsLoading: "Sprawdzanie otwartych wniosków…", overviewApprovalsSuffix: "wniosków oczekuje na akceptację.",
            overviewIntegrationsTitle: "Integracje",
            overviewIntegrationsDescription: "Jira, Zabbix, Defender XDR, Entra i automatyzacja.",
            healthOk: "OK", healthWarning: "Ostrzeżenie", healthCritical: "Krytyczny", healthUnknown: "Nieznany",
            healthAllOk: "Wszystkie integracje działają prawidłowo.", healthHasIssues: "Stan integracji wymaga uwagi.", healthLoading: "Sprawdzanie stanu integracji…",
            total: "Wszystkie", online: "Online", offline: "Offline",
            searchDevices: "Szukaj hosta, grupy lub systemu…", refresh: "Odśwież",
            waitingDevices: "Oczekiwanie na dane urządzeń…", noDevices: "Brak urządzeń dostępnych dla tego konta.",
            noFilteredDevices: "Brak urządzeń zgodnych z aktualnym filtrem.",
            devicesCount: "urządzeń", open: "Otwórz", unknownHost: "Nieznany host", noGroup: "Bez grupy",
            noOs: "Brak danych o systemie", noIp: "Brak IP", deviceDetails: "Szczegóły urządzenia",
            backToDevices: "Wróć do urządzeń",
            name: "Nazwa", status: "Status", group: "Grupa", system: "System",
            ipAddress: "Adres IP", lastSeen: "Ostatnio widziany", agentVersion: "Wersja agenta", nodeId: "Node ID",
            settingsAdminOnly: "Ustawienia są dostępne tylko dla Site Admin.",
            monitoringPlaceholder: "Moduł Zabbix/Monitoring zostanie podłączony do wspólnego API SirkPlatform.",
            reportsPlaceholder: "Raporty będą korzystać ze wspólnego rejestru wyników SirkPlatform.",
            genericPlaceholder: "Moduł będzie podłączony do niezależnego API SirkPlatform.",
            managementLoading: "Ładowanie Zarządzania…", approvalsLoading: "Ładowanie Akceptacji…"
        },
        en: {
            overview: "Overview", devices: "Devices", approvals: "Approval",
            automation: "Automation", monitoring: "Monitoring", assets: "Assets",
            management: "Management", reports: "Reports", security: "Security",
            settings: "Settings", logout: "Sign out",
            collapse: "Collapse menu", expand: "Expand menu", theme: "Change theme",
            switchToDark: "Switch to dark theme", switchToLight: "Switch to light theme",
            languageTitle: "Przełącz na polski", loading: "Loading…",
            loadingModules: "Loading SirkPlatform modules…", loadingDevices: "Loading devices…",
            unknownError: "Unknown Portal error.", moduleDisabled: "module is disabled or the user does not have access.",
            loadFailed: "failed to load data.",
            overviewDevicesTitle: "Devices", overviewDevicesSuffix: "devices connected to SIRK Portal.",
            overviewDevicesLoading: "Loading the device list…",
            overviewApprovalsTitle: "Approval",
            overviewApprovalsDescription: "Move Requests, Commands and Scripts awaiting approval.",
            overviewApprovalsLoading: "Checking open requests…", overviewApprovalsSuffix: "requests are awaiting approval.",
            overviewIntegrationsTitle: "Integrations",
            overviewIntegrationsDescription: "Jira, Zabbix, Defender XDR, Entra and automation.",
            healthOk: "OK", healthWarning: "Warning", healthCritical: "Critical", healthUnknown: "Unknown",
            healthAllOk: "All integrations are healthy.", healthHasIssues: "Integration health requires attention.", healthLoading: "Checking integration health…",
            total: "All", online: "Online", offline: "Offline",
            searchDevices: "Search host, group or operating system…", refresh: "Refresh",
            waitingDevices: "Waiting for device data…", noDevices: "No devices are available for this account.",
            noFilteredDevices: "No devices match the current filter.",
            devicesCount: "devices", open: "Open", unknownHost: "Unknown host", noGroup: "No group",
            noOs: "No operating system data", noIp: "No IP", deviceDetails: "Device details",
            backToDevices: "Back to devices",
            name: "Name", status: "Status", group: "Group", system: "Operating system",
            ipAddress: "IP address", lastSeen: "Last seen", agentVersion: "Agent version", nodeId: "Node ID",
            settingsAdminOnly: "Settings are available only to Site Admin.",
            monitoringPlaceholder: "The Zabbix/Monitoring module will use the shared SirkPlatform API.",
            reportsPlaceholder: "Reports will use the shared SirkPlatform results registry.",
            genericPlaceholder: "This module will use the independent SirkPlatform API.",
            managementLoading: "Loading Management…", approvalsLoading: "Loading Approval…"
        }
    };

    var moduleViews = { assets: "myjira", security: "defendertools" };
    var VIEW_KEYS = ["overview", "devices", "approvals", "automation", "monitoring", "assets", "management", "reports", "security", "settings"];
    var THEME_ICONS = {
        moon: '<svg class="sirk-theme-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.7 15.1A8.5 8.5 0 0 1 8.9 3.4a8.7 8.7 0 1 0 11.8 11.7Z"/><path class="sirk-theme-star" d="m17.5 3 .55 1.45L19.5 5l-1.45.55L17.5 7l-.55-1.45L15.5 5l1.45-.55Z"/></svg>',
        sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/></svg>'
    };
    var DEVICE_ICON = '<svg class="sirk-device-computer-svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M6.5 7.5h11v6h-11z" class="sirk-device-computer-screen"/></svg>';

    function language() {
        try { return window.localStorage.getItem(STORAGE_LANGUAGE) === "en" ? "en" : "pl"; }
        catch (error) { return document.documentElement.lang === "en" ? "en" : "pl"; }
    }

    function t(key) { return TEXT[language()][key] || key; }

    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function portalConfig() {
        var state = moduleState("portal");
        return state && state.config || {};
    }

    function viewConfig(view) {
        var views = portalConfig().views;
        return views && views[view] && typeof views[view] === "object" ? views[view] : {};
    }

    var VIEW_MODULE_KEYS = { assets: "myjira", security: "defendertools" };
    function viewEnabled(view) {
        if (viewConfig(view).enabled === false) return false;
        var moduleKey = VIEW_MODULE_KEYS[view];
        if (!moduleKey) return true;
        var module = moduleState(moduleKey);
        return !module || module.enabled !== false;
    }

    function firstEnabledView() {
        return VIEW_KEYS.find(function (key) { return viewEnabled(key); }) || "overview";
    }

    function viewName(view) {
        var config = viewConfig(view);
        return config.personalized === true && String(config.label || "").trim()
            ? String(config.label).trim()
            : t(view);
    }

    function viewAccent(view) {
        var config = viewConfig(view);
        return config.personalized === true && /^#[0-9a-f]{6}$/i.test(String(config.accent || ""))
            ? String(config.accent)
            : "#4d6bd8";
    }

    function applyViewPreferences() {
        Array.prototype.forEach.call(root.querySelectorAll(".sirk-standalone-nav [data-view]"), function (button) {
            var view = button.getAttribute("data-view");
            var config = viewConfig(view);
            button.hidden = !viewEnabled(view);
            button.setAttribute("aria-hidden", button.hidden ? "true" : "false");
            button.style.setProperty("--sirk-view-accent", viewAccent(view));
            button.classList.toggle("is-personalized", config.personalized === true);
        });
    }

    function applyViewSurface(view) {
        var unified = view !== "devices";
        content.classList.toggle("sirk-unified-content", unified);
        content.classList.toggle("sirk-device-content", !unified);
        content.setAttribute("data-active-view", view);
        root.style.setProperty("--sirk-active-accent", viewAccent(view));
    }

    function clearLoadingOverlay() {
        var overlay = content.querySelector(".sirk-standalone-loading-overlay");
        if (overlay) overlay.remove();
        content.classList.remove("is-refreshing");
    }

    function prepareModuleHost(view) {
        clearLoadingOverlay();
        content.innerHTML = "";
        content.removeAttribute("style");
        content.setAttribute("data-module-view", view);
        var host = document.createElement("div");
        host.className = "sirk-portal-view-host sirk-portal-view-" + view;
        content.appendChild(host);
        return host;
    }

    function syncThemeButton(dark) {
        var button = root.querySelector('[data-action="theme"]');
        if (!button) return;
        button.innerHTML = dark ? THEME_ICONS.sun : THEME_ICONS.moon;
        button.title = dark ? t("switchToLight") : t("switchToDark");
        button.setAttribute("aria-label", button.title);
        button.setAttribute("data-theme-icon", dark ? "sun" : "moon");
    }

    function applyShellLanguage() {
        document.documentElement.lang = language();
        applyViewPreferences();
        Array.prototype.forEach.call(root.querySelectorAll(".sirk-standalone-nav [data-view]"), function (button) {
            var key = button.getAttribute("data-view");
            var label = button.querySelector("b");
            if (label) label.textContent = viewName(key);
            button.title = viewName(key);
        });
        var logoutButton = root.querySelector('[data-action="logout"]');
        if (logoutButton) logoutButton.textContent = t("logout");
        var languageButton = root.querySelector('[data-action="language"]');
        if (languageButton) {
            languageButton.textContent = language() === "pl" ? "PL" : "EN";
            languageButton.title = t("languageTitle");
            languageButton.setAttribute("aria-label", languageButton.title);
        }
        var sidebarButton = root.querySelector('[data-action="sidebar"]');
        if (sidebarButton) {
            sidebarButton.title = root.classList.contains("is-collapsed") ? t("expand") : t("collapse");
            sidebarButton.setAttribute("aria-label", sidebarButton.title);
        }
        var themeButton = root.querySelector('[data-action="theme"]');
        if (themeButton) {
            syncThemeButton(portalRoot.classList.contains("sirk-theme-dark"));
        }
        title.textContent = viewName(activeView);
    }

    function applyUserProfile() {
        var profile = bootstrap && bootstrap.user || {};
        var menu = document.getElementById("sirkUserMenu");
        var name = document.getElementById("sirkUserName");
        var image = document.getElementById("sirkUserImage");
        if (!menu || !name || !image || !String(profile.name || "").trim()) return;
        name.textContent = String(profile.name).trim();
        var fallback = String(window.__SIRK_PLATFORM_DEFAULT_USER_IMAGE_URL__ || "");
        image.onerror = function () {
            image.onerror = null;
            image.src = fallback;
        };
        image.src = profile.hasImage === true
            ? String(window.__SIRK_PLATFORM_USER_IMAGE_URL__ || "") + "?rnd=" + encodeURIComponent(profile.imageRnd || Date.now())
            : fallback;
        image.alt = String(profile.name).trim();
        menu.hidden = false;
    }

    function setLanguage(value) {
        var next = value === "en" ? "en" : "pl";
        try { window.localStorage.setItem(STORAGE_LANGUAGE, next); } catch (error) {}
        document.documentElement.lang = next;
        applyShellLanguage();
        window.dispatchEvent(new CustomEvent("sirkportal:languagechange", { detail: { language: next } }));
        render(activeView);
    }

    function asset(name) {
        var base = String(window.__SIRK_PLATFORM_ASSET_BASE__ || "").replace(/\/$/, "");
        return base + "/" + name + "?v=" + encodeURIComponent(window.__SIRK_PLATFORM_PORTAL_VERSION__ || "1");
    }

    function load(id, name) { return core.loadScript(id, asset(name)); }
    function moduleState(key) { return bootstrap && bootstrap.modules && bootstrap.modules[key] || null; }
    function accessAllowed(state) {
        if (!state || state.enabled !== true || state.ready === false) return false;
        if (!state.access) return true;
        return state.access.allowed !== false || state.access.siteAdmin === true;
    }
    function moduleAllowed(key) { return accessAllowed(moduleState(key)); }
    function isCurrent(sequence) { return sequence === renderSequence; }

    function loading(message) {
        if (content.getAttribute("data-module-view") && content.firstElementChild) {
            var overlay = content.querySelector(".sirk-standalone-loading-overlay");
            if (!overlay) {
                overlay = document.createElement("div");
                overlay.className = "sirk-standalone-loading-overlay";
                overlay.setAttribute("role", "status");
                content.appendChild(overlay);
            }
            overlay.innerHTML = '<span></span><p>' + escapeHtml(message || t("loading")) + '</p>';
            content.classList.add("is-refreshing");
            return;
        }
        content.innerHTML = '<div class="sirk-standalone-loading"><span></span><p>' + escapeHtml(message || t("loading")) + '</p></div>';
    }

    function showError(message, detail) {
        content.innerHTML = "";
        var box = document.createElement("div");
        box.className = "sirk-standalone-error";
        var strong = document.createElement("strong");
        strong.textContent = String(message || t("unknownError"));
        box.appendChild(strong);
        if (detail) {
            var pre = document.createElement("pre");
            pre.textContent = String(detail);
            box.appendChild(pre);
        }
        content.appendChild(box);
    }

    function loadDevices(force) {
        if (deviceInventory && force !== true) return Promise.resolve(deviceInventory);
        var apiBase = new URL(String(window.__SIRK_PLATFORM_API_BASE__ || ""), window.location.href);
        var request = apiBase.pathname.replace(/\/+$/, "") === "/api"
            ? fetch("/api/devices", { credentials: "same-origin", cache: "no-store" }).then(function (response) { return response.json().then(function (value) { if (!response.ok || value.ok === false) throw new Error(value.error || "Device inventory unavailable."); return value.value || value; }); })
            : core.api("portal", "devices");
        return request.then(function (value) {
            deviceInventory = {
                nodes: Array.isArray(value.nodes) ? value.nodes : [],
                groups: Array.isArray(value.groups) ? value.groups : []
            };
            return deviceInventory;
        });
    }

    function groupMap(inventory) {
        var result = Object.create(null);
        (inventory.groups || []).forEach(function (group) { result[String(group.id || "")] = group; });
        return result;
    }

    function nodeOnline(node) { return Number(node && node.conn || 0) > 0; }
    function nodeGroup(node, map) {
        var group = map[String(node && node.groupId || "")];
        return String(group && group.name || t("noGroup"));
    }

    function formatLastSeen(value) {
        if (value == null || value === "") return "—";
        var number = Number(value);
        var date = Number.isFinite(number) ? new Date(number < 100000000000 ? number * 1000 : number) : new Date(value);
        return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(language() === "pl" ? "pl-PL" : "en-US");
    }

    function loadUpdateOverview(sequence) {
        var path = String(window.location.pathname || "/");
        var portal = path.match(/^(.*?\/sirkportal)(?:\/.*)?$/i);
        var endpoint = (portal ? portal[1] : "") + "/api/system/updates/status";
        fetch(endpoint, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } })
            .then(function (response) { return response.json().then(function (value) { if (!response.ok || value.ok === false) throw new Error(value.error || "Update status unavailable."); return value.value || value; }); })
            .then(function (snapshot) {
                if (!isCurrent(sequence) || activeView !== "overview") return;
                var current = snapshot.current || {}, remote = snapshot.remote || {};
                var badge = document.getElementById("sirkOverviewSystemStatus");
                var version = document.getElementById("sirkOverviewSystemVersion");
                var available = document.getElementById("sirkOverviewSystemAvailable");
                if (version) version.textContent = current.version || "—";
                if (available) available.textContent = remote.availableVersion || remote.error || "—";
                if (badge) { badge.textContent = remote.updateAvailable ? "Dostępna aktualizacja" : remote.error ? "Nie udało się sprawdzić" : "Aktualny"; badge.className = "sirk-health-badge is-" + (remote.updateAvailable ? "warning" : remote.error ? "critical" : "ok"); }
            }).catch(function () { var badge = document.getElementById("sirkOverviewSystemStatus"); if (badge) { badge.textContent = "Nie udało się sprawdzić"; badge.className = "sirk-health-badge is-critical"; } });
    }

    function overview(sequence) {
        var cards = [];
        if (viewEnabled("devices")) cards.push('<button type="button" class="sirk-standalone-card sirk-overview-link" data-open-view="devices"><h2>' + escapeHtml(viewName("devices")) + '</h2><p><strong id="sirkOverviewDeviceCount">…</strong> <span id="sirkOverviewDeviceSuffix">' + escapeHtml(t("overviewDevicesLoading")) + '</span></p></button>');
        if (viewEnabled("approvals")) cards.push('<button type="button" class="sirk-standalone-card sirk-overview-link" data-open-view="approvals"><h2>' + escapeHtml(viewName("approvals")) + '</h2><p><strong id="sirkOverviewApprovalCount">…</strong> <span id="sirkOverviewApprovalSuffix">' + escapeHtml(t("overviewApprovalsLoading")) + '</span></p></button>');
        cards.push('<section class="sirk-standalone-card sirk-overview-system"><h2>Stan systemu</h2><p><span id="sirkOverviewSystemStatus" class="sirk-health-badge is-unknown">Sprawdzanie…</span></p><p>Aktualna wersja: <strong id="sirkOverviewSystemVersion">—</strong></p><p>Dostępna wersja: <strong id="sirkOverviewSystemAvailable">—</strong></p></section>');
        cards.push('<section class="sirk-standalone-card sirk-overview-health"><h2>' + escapeHtml(t("overviewIntegrationsTitle")) + '</h2><p><span id="sirkOverviewHealthBadge" class="sirk-health-badge is-unknown">' + escapeHtml(t("healthUnknown")) + '</span> <span id="sirkOverviewHealthText">' + escapeHtml(t("healthLoading")) + '</span></p><ul id="sirkOverviewHealthIssues" hidden></ul></section>');
        content.innerHTML = '<div class="sirk-standalone-view-scroll"><div class="sirk-standalone-grid">' + cards.join("") + '</div></div>';
        loadUpdateOverview(sequence);

        if (viewEnabled("devices")) loadDevices(false).then(function (inventory) {
            if (!isCurrent(sequence) || activeView !== "overview") return;
            var count = document.getElementById("sirkOverviewDeviceCount");
            var suffix = document.getElementById("sirkOverviewDeviceSuffix");
            if (count) count.textContent = String(inventory.nodes.length);
            if (suffix) suffix.textContent = t("overviewDevicesSuffix");
        }).catch(function () {
            if (!isCurrent(sequence) || activeView !== "overview") return;
            var count = document.getElementById("sirkOverviewDeviceCount");
            var suffix = document.getElementById("sirkOverviewDeviceSuffix");
            if (count) count.textContent = "0";
            if (suffix) suffix.textContent = t("overviewDevicesSuffix");
        });

        core.api("portal", "overview").then(function (value) {
            if (!isCurrent(sequence) || activeView !== "overview") return;
            var approvalCount = document.getElementById("sirkOverviewApprovalCount");
            var approvalSuffix = document.getElementById("sirkOverviewApprovalSuffix");
            if (approvalCount) approvalCount.textContent = String(Number(value.pendingApprovals) || 0);
            if (approvalSuffix) approvalSuffix.textContent = t("overviewApprovalsSuffix");
            var health = value.integrations || {};
            var status = ["ok", "warning", "critical"].indexOf(health.status) >= 0 ? health.status : "unknown";
            var badge = document.getElementById("sirkOverviewHealthBadge");
            var healthText = document.getElementById("sirkOverviewHealthText");
            var issues = document.getElementById("sirkOverviewHealthIssues");
            var labels = { ad: "Active Directory", entra: "Entra ID", jira: "Jira", defender: "Defender XDR", zabbix: "Zabbix" };
            if (badge) {
                badge.className = "sirk-health-badge is-" + status;
                badge.textContent = t(status === "ok" ? "healthOk" : status === "warning" ? "healthWarning" : status === "critical" ? "healthCritical" : "healthUnknown");
            }
            if (healthText) healthText.textContent = status === "ok" ? t("healthAllOk") : t("healthHasIssues");
            var healthItems = Array.isArray(health.items) ? health.items : [];
            if (issues) {
                issues.innerHTML = healthItems.map(function (item) {
                    var message = language() === "pl" ? item.messagePl : item.messageEn;
                    if (!message) message = language() === "pl" ? item.messageEn : item.messagePl;
                    var itemStatus = ["ok", "warning", "critical"].indexOf(item.status) >= 0 ? item.status : "unknown";
                    var statusText = t(itemStatus === "ok" ? "healthOk" : itemStatus === "critical" ? "healthCritical" : itemStatus === "warning" ? "healthWarning" : "healthUnknown");
                    return '<li><strong>' + escapeHtml(labels[item.key] || item.key) + '</strong><span class="sirk-health-badge is-' + itemStatus + '">' + escapeHtml(statusText) + '</span>' + (message && itemStatus !== "ok" ? '<small>' + escapeHtml(message) + '</small>' : '') + '</li>';
                }).join("");
                issues.hidden = healthItems.length === 0;
            }
        }).catch(function () {
            if (!isCurrent(sequence) || activeView !== "overview") return;
            var approvalCount = document.getElementById("sirkOverviewApprovalCount");
            var approvalSuffix = document.getElementById("sirkOverviewApprovalSuffix");
            if (approvalCount) approvalCount.textContent = "—";
            if (approvalSuffix) approvalSuffix.textContent = t("loadFailed");
            var badge = document.getElementById("sirkOverviewHealthBadge");
            var healthText = document.getElementById("sirkOverviewHealthText");
            if (badge) badge.textContent = t("healthUnknown");
            if (healthText) healthText.textContent = t("loadFailed");
        });
    }

    function initializeModule(key) {
        if (initialized[key]) return initialized[key];
        var module = window.SirkPlatformModules && window.SirkPlatformModules[key];
        if (!module) return Promise.reject(new Error("Module " + key + " was not loaded."));
        initialized[key] = Promise.resolve(typeof module.initialize === "function" ? module.initialize(moduleState(key) || {}) : null);
        return initialized[key];
    }

    function mountModule(view, key, sequence) {
        var state = moduleState(key);
        if (!moduleAllowed(key)) {
            showError(viewName(view) + ": " + t("moduleDisabled"));
            return;
        }
        loading(t("loading") + " " + viewName(view));
        initializeModule(key).then(function () {
            if (!isCurrent(sequence)) return;
            var module = window.SirkPlatformModules[key];
            if (!module || typeof module.mount !== "function") throw new Error("Module " + key + " does not expose a Portal view.");
            var host = prepareModuleHost(view);
            return Promise.resolve(module.mount(host, "sirk-standalone-" + view));
        }).catch(function (reason) {
            if (isCurrent(sequence)) showError(viewName(view) + ": " + t("loadFailed"), reason && (reason.stack || reason.message) || reason);
        });
    }

    function management(sequence) {
        var state = moduleState("myscripts");
        if (!moduleAllowed("myscripts")) {
            showError(viewName("management") + ": " + t("moduleDisabled"));
            return;
        }
        loading(t("managementLoading"));
        if (!window.SirkPlatformPortalManagement || typeof window.SirkPlatformPortalManagement.mount !== "function") {
            showError("MyScripts renderer is unavailable.");
            return;
        }
        var outerHost = prepareModuleHost("management");
        var host = document.createElement("div");
        host.className = "";
        outerHost.appendChild(host);
        var timer = window.setTimeout(function () {
            if (isCurrent(sequence) && !host.querySelector(".sirk-standalone-view-scroll,.sirk-error,.sirk-card")) {
                showError("Automation did not finish initialization.", "/api/modules/myscripts/scripts");
            }
        }, 12000);
        Promise.resolve(window.SirkPlatformPortalManagement.mount(host)).then(function () {
            window.clearTimeout(timer);
            if (!isCurrent(sequence)) return;
            if (!host.querySelector(".sirk-standalone-view-scroll,.sirk-error,.sirk-card")) throw new Error("MyScripts renderer did not create a view.");
        }).catch(function (reason) {
            window.clearTimeout(timer);
            if (isCurrent(sequence)) showError(viewName("management") + ": " + t("loadFailed"), reason && (reason.stack || reason.message) || reason);
        });
    }

    function approvals(sequence) {
        if (!moduleAllowed("approvalcenter")) {
            showError(viewName("approvals") + ": " + t("moduleDisabled"));
            return;
        }
        loading(t("approvalsLoading"));
        initializeModule("approvalcenter").then(function () {
            if (!isCurrent(sequence)) return;
            var module = window.SirkPlatformModules.approvalcenter;
            if (!module || typeof module.mount !== "function") throw new Error("Approval Center does not expose a Portal view.");
            var host = prepareModuleHost("approvals");
            return Promise.resolve(module.mount(host, "sirk-standalone-approval"));
        }).catch(function (reason) {
            if (isCurrent(sequence)) showError(viewName("approvals") + ": " + t("loadFailed"), reason && (reason.stack || reason.message) || reason);
        });
    }

    function settings() {
        var portal = moduleState("portal") || {};
        var access = portal.access || bootstrap && bootstrap.access || {};
        if (access.siteAdmin !== true) { showError(t("settingsAdminOnly")); return; }
        var host = prepareModuleHost("settings");
        if (window.SirkPortalSettings && typeof window.SirkPortalSettings.mount === "function") { window.SirkPortalSettings.mount(host); return; }
        var shell = document.createElement("section");
        shell.className = "sirk-standalone-view-scroll sirk-settings-module-shell";
        var toolbar = document.createElement("header");
        toolbar.className = "sirk-toolbar sirk-toolbar-host sirk-settings-module-toolbar";
        toolbar.innerHTML = '<strong>' + escapeHtml(viewName("settings")) + '</strong>';
        var workspace = document.createElement("div");
        workspace.className = "sirk-layout sirk-settings-module-workspace";
        var primary = document.createElement("aside"); primary.className = "sirk-column-primary";
        var secondary = document.createElement("aside"); secondary.className = "sirk-column-secondary";
        var details = document.createElement("div"); details.className = "sirk-column-details";
        workspace.appendChild(primary); workspace.appendChild(secondary); workspace.appendChild(details);
        function renderSecondary(items, selected, onSelect) { secondary.innerHTML = ""; items.forEach(function (name, index) { var button = document.createElement("button"); button.type = "button"; button.className = "sirk-nav-item" + (name === selected || (!selected && index === 0) ? " active" : ""); button.textContent = name; button.onclick = function () { Array.prototype.forEach.call(secondary.children, function (node) { node.classList.remove("active"); }); button.classList.add("active"); onSelect(name); }; secondary.appendChild(button); }); }
        var systemUpdatesHost = null, agentGroupsHost = null;
        function selectSettingsPane(name) { title.textContent = name; status.textContent = ""; output.hidden = true; form.hidden = false; if (systemUpdatesHost) systemUpdatesHost.hidden = true; Array.prototype.forEach.call(form.children, function (node) { node.hidden = node.getAttribute("data-settings-pane") !== name && node !== save; }); details.querySelectorAll(".sirk-settings-section").forEach(function (node) { node.hidden = node.getAttribute("data-settings-pane") !== name; }); }
        function renderAdminPane(name, sub) {
            title.textContent = name + " / " + sub;
            form.hidden = true;
            details.querySelectorAll(".sirk-settings-section").forEach(function (node) { node.hidden = true; });
            if (name === "System" && window.SirkSystemUpdates) {
                output.hidden = true;
                if (!systemUpdatesHost) { systemUpdatesHost = document.createElement("div"); systemUpdatesHost.className = "sirk-settings-system-updates"; details.appendChild(systemUpdatesHost); }
                systemUpdatesHost.hidden = false;
                window.SirkSystemUpdates.mount(systemUpdatesHost, { "Aktualizacje": "updates", "Backupy": "backups", "Historia": "history", "Kanał": "channel" }[sub] || "updates");
                status.textContent = "";
                return;
            }
            output.hidden = false;
            var source = settingsSnapshot || {};
            if (name === "Overview") source = { plugin: source.plugin, modules: source.modules, generatedAt: source.generatedAt };
            else if (name === "Debug") source = sub === "Błędy" ? (source.diagnostics && source.diagnostics.errors || source.moduleLoadErrors || {}) : sub === "Logi" ? (source.diagnostics && source.diagnostics.logs || "Brak logów.") : source;
            else if (name === "System") source = { version: window.__SIRK_PLATFORM_PORTAL_VERSION__, diagnostics: source.diagnostics || {}, generatedAt: source.generatedAt };
            else if (name === "Server") source = { standalone: true, meshDatabase: "local", devices: deviceInventory && deviceInventory.nodes.length || 0 };
            output.textContent = typeof source === "string" ? source : JSON.stringify(source, null, 2);
            status.textContent = "";
        }
        function renderAgentGroups() {
            title.textContent = "Grupy hostów SIRK Agent"; form.hidden = true; output.hidden = true;
            if (systemUpdatesHost) systemUpdatesHost.hidden = true;
            details.querySelectorAll(".sirk-settings-section").forEach(function (node) { node.hidden = true; });
            if (!agentGroupsHost) { agentGroupsHost = document.createElement("div"); details.appendChild(agentGroupsHost); }
            agentGroupsHost.hidden = false; agentGroupsHost.innerHTML = "<p>Ładowanie grup…</p>";
            fetch("/api/admin/agent-groups", { credentials: "same-origin", cache: "no-store" })
                .then(function (response) { return response.json().then(function (value) { if (!response.ok) throw new Error(value.error || "Nie można pobrać grup."); return value.value || []; }); })
                .then(function (groups) {
                    agentGroupsHost.innerHTML = "";
                    var create = document.createElement("form"); create.className = "sirk-card sirk-agent-group-create";
                    create.innerHTML = '<h3>Nowa grupa hostów</h3><label>Nazwa<input name="name" required maxlength="100"></label><label>Opis<input name="description" maxlength="500"></label><button type="submit" class="sirk-admin-primary">Dodaj grupę</button>';
                    create.onsubmit = function (event) {
                        event.preventDefault();
                        var payload = { name: create.elements.name.value, description: create.elements.description.value };
                        fetch("/api/admin/agent-groups", { method: "POST", credentials: "same-origin",
                            headers: { "Content-Type": "application/json", "X-SIRK-CSRF": bootstrap.csrfToken || "" },
                            body: JSON.stringify(payload) }).then(function (response) { return response.json().then(function (value) { if (!response.ok) throw new Error(value.error || "Nie dodano grupy."); }); })
                            .then(renderAgentGroups).catch(function (error) { status.textContent = error.message || String(error); });
                    };
                    agentGroupsHost.appendChild(create);
                    groups.forEach(function (group) {
                        var card = document.createElement("section"); card.className = "sirk-card sirk-agent-group-card";
                        var heading = document.createElement("h3"); heading.textContent = group.name; card.appendChild(heading);
                        var copy = document.createElement("p"); copy.textContent = group.description || "Bez opisu"; card.appendChild(copy);
                        var actions = document.createElement("div"); actions.className = "sirk-agent-group-actions";
                        [["silent", "Pobierz instalację cichą"], ["run", "Pobierz tryb uruchomienia"]].forEach(function (item) {
                            var link = document.createElement("a"); link.className = "sirk-button"; link.textContent = item[1];
                            link.href = "/api/admin/agent-groups?groupId=" + encodeURIComponent(group.id) + "&download=" + item[0];
                            actions.appendChild(link);
                        });
                        var remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Usuń grupę";
                        remove.onclick = function () {
                            if (!window.confirm("Usunąć grupę " + group.name + "?")) return;
                            fetch("/api/admin/agent-groups", { method: "DELETE", credentials: "same-origin",
                                headers: { "Content-Type": "application/json", "X-SIRK-CSRF": bootstrap.csrfToken || "" },
                                body: JSON.stringify({ id: group.id }) }).then(function (response) { if (!response.ok) return response.json().then(function (value) { throw new Error(value.error || "Nie usunięto grupy."); }); })
                                .then(renderAgentGroups).catch(function (error) { status.textContent = error.message || String(error); });
                        };
                        actions.appendChild(remove); card.appendChild(actions); agentGroupsHost.appendChild(card);
                    });
                    status.textContent = groups.length ? "Grupy hostów: " + groups.length : "Nie utworzono jeszcze grup hostów.";
                }).catch(function (error) { agentGroupsHost.innerHTML = ""; status.textContent = error.message || String(error); });
        }
        ["Overview", "Settings", "Grupy hostów", "Plugins", "Server", "Debug", "System"].forEach(function (name, index) { var button = document.createElement("button"); button.type = "button"; button.className = "sirk-nav-item" + (name === "Settings" ? " active" : ""); button.textContent = name; button.onclick = function () { Array.prototype.forEach.call(primary.children, function (node) { node.classList.remove("active"); }); button.classList.add("active"); if (agentGroupsHost) agentGroupsHost.hidden = true; if (name === "Settings") { renderSecondary(["Overview", "Portal", "Moduły", "Integracje", "Uprawnienia", "Diagnostyka", "Aktualizacje"], "Overview", selectSettingsPane); selectSettingsPane("Overview"); return; } if (name === "Grupy hostów") { renderSecondary(["Grupy i instalatory"], "Grupy i instalatory", renderAgentGroups); renderAgentGroups(); return; } var subcategories = name === "Debug" ? ["Config", "Logi", "Błędy"] : name === "System" ? ["Aktualizacje", "Backupy", "Historia", "Kanał"] : name === "Plugins" ? ["Zainstalowane", "Dostępne", "Historia"] : ["Przegląd", "Status", "Historia"]; renderSecondary(subcategories, subcategories[0], function (sub) { renderAdminPane(name, sub); }); renderAdminPane(name, subcategories[0]); }; primary.appendChild(button); });
        renderSecondary(["Overview", "Portal", "Moduły", "Integracje", "Uprawnienia", "Diagnostyka", "Aktualizacje"], "Overview", selectSettingsPane);
        var panel = document.createElement("section"); panel.className = "sirk-card";
        var title = document.createElement("h2"); title.textContent = "Portal settings"; panel.appendChild(title);
        var tabs = document.createElement("nav"); tabs.className = "sirk-settings-tabs"; tabs.hidden = true;
        ["Overview", "Settings", "Server", "Debug", "System"].forEach(function (name, index) { var tab = document.createElement("button"); tab.type = "button"; tab.className = "sirk-admin-secondary" + (index === 1 ? " is-active" : ""); tab.textContent = name; tabs.appendChild(tab); });
        panel.appendChild(tabs);
        var status = document.createElement("p"); status.className = "sirk-shared-muted"; status.textContent = "Loading…"; panel.appendChild(status);
        var output = document.createElement("pre"); output.className = "sirk-settings-output"; output.hidden = true; panel.appendChild(output);
        var settingsSnapshot = null;
        var form = document.createElement("form"); form.className = "sirk-shared-settings-form"; form.hidden = true;
        var overviewControls = document.createElement("div"); overviewControls.className = "sirk-admin-grid"; overviewControls.setAttribute("data-settings-pane", "Overview"); form.appendChild(overviewControls);
        var portalControls = document.createElement("div"); portalControls.className = "sirk-admin-grid"; portalControls.setAttribute("data-settings-pane", "Portal");
        var modules = document.createElement("div"); modules.className = "sirk-admin-grid";
        modules.setAttribute("data-settings-pane", "Moduły");
        var save = document.createElement("button"); save.type = "submit"; save.className = "sirk-admin-primary"; save.textContent = "Save settings";
        form.appendChild(portalControls); form.appendChild(modules); form.appendChild(save); panel.appendChild(form); details.appendChild(panel);
        var restartResume = null;
        try { restartResume = JSON.parse(sessionStorage.getItem("sirkPortal.restartState") || "null"); } catch (error) {}
        if (restartResume && restartResume.section) primary.children[6].click();
        var base = "/api";
        fetch(base + "/admin/settings", { credentials: "same-origin", cache: "no-store" }).then(function (response) { return response.json().then(function (value) { if (!response.ok) throw new Error(value.error || "Settings unavailable."); return value.value; }); }).then(function (snapshot) {
            settingsSnapshot = snapshot;
            var portalSettings = snapshot.moduleSettings && snapshot.moduleSettings.portal || {};
            var configuredViews = portalSettings.views || {};
            var viewLabels = { overview: "Overview", devices: "Devices", approvals: "Approval", automation: "Automation", monitoring: "Monitoring", assets: "Assets", management: "Management", reports: "Reports", security: "Security", settings: "Settings" };
            VIEW_KEYS.forEach(function (key) { var row = document.createElement("label"); row.className = "sirk-card"; var input = document.createElement("input"); input.type = "checkbox"; input.name = "view." + key; input.checked = !configuredViews[key] || configuredViews[key].enabled !== false; row.appendChild(input); row.appendChild(document.createTextNode(" " + viewLabels[key])); overviewControls.appendChild(row); });
            var portalFields = document.createElement("div"); portalFields.className = "sirk-admin-grid";
            portalFields.setAttribute("data-settings-pane", "Portal");
            [["defaultView", "Domyślny widok", portalSettings.defaultView || "overview"], ["siteName", "Nazwa portalu", portalSettings.siteName || "SirK Portal"], ["passwordResetUrl", "Adres resetu hasła", portalSettings.passwordResetUrl || ""]].forEach(function (item) { var label = document.createElement("label"); label.className = "sirk-card"; label.textContent = item[1]; var input = document.createElement("input"); input.type = "text"; input.name = "portal." + item[0]; input.value = item[2]; label.appendChild(input); portalFields.appendChild(label); });
            form.appendChild(portalFields);
            ["forceNewLogin"].forEach(function (key) { var row = document.createElement("label"); row.className = "sirk-card"; var input = document.createElement("input"); input.type = "checkbox"; input.name = "portal." + key; input.checked = portalSettings[key] === true; row.appendChild(input); row.appendChild(document.createTextNode(" " + key)); portalControls.appendChild(row); });
            Object.keys(snapshot.moduleSettings || {}).forEach(function (key) { if (key === "portal") return; var row = document.createElement("label"); row.className = "sirk-card"; var input = document.createElement("input"); input.type = "checkbox"; input.name = "module." + key; input.checked = snapshot.moduleSettings[key] && snapshot.moduleSettings[key].enabled === true; row.appendChild(input); row.appendChild(document.createTextNode(" " + key)); modules.appendChild(row); });
            var sections = document.createElement("div"); sections.className = "sirk-admin-settings-sections";
            [["Portal", "Ustawienia samodzielnego Portalu i sesji."], ["Moduły", "Włączanie niezależnych modułów Portalu."], ["Integracje", "Stan połączeń z usługami zewnętrznymi (bez ujawniania sekretów)."], ["Uprawnienia", "Konfiguracja dostępu i uprawnień folderów."], ["Diagnostyka", "Ostatni stan diagnostyki i błędów API."], ["Aktualizacje", "Wersja portalu i stan wdrożenia."]].forEach(function (item) { var section = document.createElement("section"); section.className = "sirk-card sirk-settings-section"; section.setAttribute("data-settings-pane", item[0]); section.hidden = item[0] !== "Portal"; var heading = document.createElement("h3"); heading.textContent = item[0]; section.appendChild(heading); var description = document.createElement("p"); description.className = "sirk-shared-muted"; description.textContent = item[1]; section.appendChild(description); sections.appendChild(section); });
            var integrations = snapshot.integrations || {}; var integrationSection = sections.children[2]; Object.keys(integrations).forEach(function (key) { var value = integrations[key]; var line = document.createElement("div"); line.textContent = key + ": " + (value && typeof value === "object" ? (value.enabled ? "włączona" : "wyłączona") : "—"); integrationSection.appendChild(line); });
            var permissions = snapshot.folderPermissions || {}; var permissionSection = sections.children[3]; var permissionText = document.createElement("pre"); permissionText.textContent = JSON.stringify(permissions, null, 2); permissionSection.appendChild(permissionText);
            var diagnostics = snapshot.diagnostics || {}; var diagnosticSection = sections.children[4]; var diagnosticText = document.createElement("pre"); diagnosticText.textContent = JSON.stringify(diagnostics, null, 2); diagnosticSection.appendChild(diagnosticText);
            var updateSection = sections.children[5]; var version = document.createElement("p"); version.textContent = "Wersja: " + String(window.__SIRK_PLATFORM_PORTAL_VERSION__ || "—"); updateSection.appendChild(version);
            panel.appendChild(sections);
            status.textContent = "Settings loaded."; form.hidden = false;
            if (!restartResume || !restartResume.section) selectSettingsPane("Overview");
        }).catch(function (error) { status.textContent = error.message || String(error); status.classList.add("sirk-error"); });
        form.addEventListener("submit", function (event) { event.preventDefault(); save.disabled = true; var values = {}, portal = {}, views = {}; Array.prototype.forEach.call(form.querySelectorAll("input[name]"), function (input) { var parts = input.name.split("."); if (parts[0] === "portal") portal[parts[1]] = input.type === "checkbox" ? input.checked : input.value; else if (parts[0] === "view") views[parts[1]] = { enabled: input.checked }; else values[parts[1]] = input.checked; }); portal.views = views; fetch(base + "/admin/settings", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }, body: "payload=" + encodeURIComponent(JSON.stringify({ modules: values, portal: portal })) }).then(function (response) { return response.json().then(function (value) { if (!response.ok) throw new Error(value.error || "Save failed."); return value; }); }).then(function () { status.textContent = "Settings saved."; }).catch(function (error) { status.textContent = error.message || String(error); }).finally(function () { save.disabled = false; }); });
        shell.appendChild(toolbar);
        shell.appendChild(workspace);
        host.appendChild(shell);
    }

    function detailItem(label, value) {
        return '<div class="sirk-device-detail-item"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value == null || value === "" ? "—" : value) + '</strong></div>';
    }

    function renderDeviceDetails(node) {
        var map = groupMap(deviceInventory || { groups: [] });
        var online = nodeOnline(node);
        content.innerHTML = '<div class="sirk-standalone-view-scroll" data-sirk-device-detail>' +
            '<div class="sirk-device-detail-head"><button type="button" class="sirk-device-back" data-device-back="1">← ' + escapeHtml(t("backToDevices")) + '</button></div>' +
            '<section class="sirk-device-hero"><span class="sirk-device-hero-icon">' + DEVICE_ICON + '</span><div><h2>' + escapeHtml(node.name || t("unknownHost")) + '</h2><p>' + escapeHtml(nodeGroup(node, map)) + ' · ' + escapeHtml(node.os || t("noOs")) + '</p></div><span class="sirk-device-connection ' + (online ?"is-online" : "is-offline") + '"><i></i>' + escapeHtml(online ? t("online") : t("offline")) + '</span></section>' +
            '<div class="sirk-device-detail-grid">' +
            detailItem(t("name"), node.name) + detailItem(t("status"), online ? t("online") : t("offline")) +
            detailItem(t("group"), nodeGroup(node, map)) + detailItem(t("system"), node.os || t("noOs")) +
            detailItem(t("ipAddress"), node.ip || t("noIp")) + detailItem(t("lastSeen"), formatLastSeen(node.lastSeen)) +
            detailItem(t("agentVersion"), node.agentVersion || "—") + detailItem(t("nodeId"), node.id) +
            '</div></div>';
    }

    function renderDeviceGroups(inventory) {
        var host = document.getElementById("sirkDevicesHost");
        var total = document.getElementById("sirkDeviceTotal");
        var onlineElement = document.getElementById("sirkDeviceOnline");
        var offlineElement = document.getElementById("sirkDeviceOffline");
        if (!host) return;
        var map = groupMap(inventory);
        var allNodes = inventory.nodes || [];
        var onlineCount = allNodes.filter(nodeOnline).length;
        if (total) total.textContent = String(allNodes.length);
        if (onlineElement) onlineElement.textContent = String(onlineCount);
        if (offlineElement) offlineElement.textContent = String(allNodes.length - onlineCount);

        var search = deviceSearch.trim().toLowerCase();
        var nodes = allNodes.filter(function (node) {
            var online = nodeOnline(node);
            if (deviceFilter === "online" && !online) return false;
            if (deviceFilter === "offline" && online) return false;
            if (!search) return true;
            return [node.name, node.os, node.ip, nodeGroup(node, map)].join(" ").toLowerCase().indexOf(search) >= 0;
        });

        if (!allNodes.length) {
            host.innerHTML = '<div class="sirk-device-status">' + escapeHtml(t("noDevices")) + '</div>';
            return;
        }
        if (!nodes.length) {
            host.innerHTML = '<div class="sirk-device-status">' + escapeHtml(t("noFilteredDevices")) + '</div>';
            return;
        }

        var groups = Object.create(null);
        nodes.forEach(function (node) {
            var group = nodeGroup(node, map);
            if (!groups[group]) groups[group] = [];
            groups[group].push(node);
        });

        host.innerHTML = Object.keys(groups).sort(function (a, b) { return a.localeCompare(b, language()); }).map(function (group) {
            var rows = groups[group].sort(function (a, b) { return String(a.name).localeCompare(String(b.name), language()); });
            return '<section class="sirk-device-group"><header class="sirk-device-group-header"><div><strong>' + escapeHtml(group) + '</strong><small>' + rows.length + ' ' + escapeHtml(t("devicesCount")) + '</small></div><span>' + rows.filter(nodeOnline).length + ' ' + escapeHtml(t("online").toLowerCase()) + '</span></header><div class="sirk-device-list">' +
                rows.map(function (node) {
                    var online = nodeOnline(node);
                    return '<button type="button" class="sirk-device-row" data-device-id="' + escapeHtml(node.id) + '"><span class="sirk-device-icon">' + DEVICE_ICON + '</span><span class="sirk-device-primary"><strong>' + escapeHtml(node.name || t("unknownHost")) + '</strong><small>' + escapeHtml(group) + '</small></span><span class="sirk-device-os">' + escapeHtml(node.os || t("noOs")) + '</span><span class="sirk-device-network">' + escapeHtml(node.ip || "—") + '</span><span class="sirk-device-seen">' + escapeHtml(formatLastSeen(node.lastSeen)) + '</span><span class="sirk-device-connection ' + (online ?"is-online" : "is-offline") + '"><i></i>' + escapeHtml(online ? t("online") : t("offline")) + '</span><span class="sirk-device-open">' + escapeHtml(t("open")) + '</span></button>';
                }).join("") + '</div></section>';
        }).join("");
    }

    function renderDevices(inventory) {
        content.innerHTML = '<div class="sirk-standalone-view-scroll"><div class="sirk-device-toolbar"><div class="sirk-device-summary"><span><strong id="sirkDeviceTotal">0</strong>' + escapeHtml(t("total")) + '</span><span><strong id="sirkDeviceOnline">0</strong>' + escapeHtml(t("online")) + '</span><span><strong id="sirkDeviceOffline">0</strong>' + escapeHtml(t("offline")) + '</span></div><div class="sirk-device-controls"><input id="sirkDeviceSearch" class="sirk-device-input" type="search" value="' + escapeHtml(deviceSearch) + '" placeholder="' + escapeHtml(t("searchDevices")) + '" autocomplete="off"><select id="sirkDeviceFilter" class="sirk-device-select"><option value="all">' + escapeHtml(t("total")) + '</option><option value="online">' + escapeHtml(t("online")) + '</option><option value="offline">' + escapeHtml(t("offline")) + '</option></select><button id="sirkRefreshDevices" type="button" class="sirk-device-refresh">' + escapeHtml(t("refresh")) + '</button></div></div><div id="sirkDevicesHost" class="sirk-device-groups"><div class="sirk-device-status">' + escapeHtml(t("waitingDevices")) + '</div></div></div>';
        var search = document.getElementById("sirkDeviceSearch");
        var filter = document.getElementById("sirkDeviceFilter");
        var refresh = document.getElementById("sirkRefreshDevices");
        if (filter) filter.value = deviceFilter;
        if (search) search.addEventListener("input", function () { deviceSearch = search.value || ""; renderDeviceGroups(inventory); });
        if (filter) filter.addEventListener("change", function () { deviceFilter = filter.value || "all"; renderDeviceGroups(inventory); });
        if (refresh) refresh.addEventListener("click", function () { devices(renderSequence, true); });
        renderDeviceGroups(inventory);
    }

    function devices(sequence, force) {
        if (selectedDeviceId && deviceInventory) {
            var selected = deviceInventory.nodes.find(function (node) { return String(node.id) === String(selectedDeviceId); });
            if (selected) { renderDeviceDetails(selected); return; }
            selectedDeviceId = "";
        }
        loading(t("loadingDevices"));
        loadDevices(force).then(function (inventory) {
            if (!isCurrent(sequence) || activeView !== "devices") return;
            renderDevices(inventory);
        }).catch(function (reason) {
            if (isCurrent(sequence)) showError(viewName("devices") + ": " + t("loadFailed"), reason && (reason.stack || reason.message) || reason);
        });
    }

    function placeholder(view, description) {
        content.innerHTML = '<section class="sirk-standalone-view-scroll"><div class="sirk-content"><h2>' + escapeHtml(viewName(view)) + '</h2><p class="sirk-muted">' + escapeHtml(description) + '</p></div></section>';
    }

    function automation(sequence) {
        if (!isCurrent(sequence)) return;
        content.innerHTML = '<section class="sirk-standalone-view-scroll"><div class="sirk-content"><h2>' + escapeHtml(viewName("automation")) + '</h2><div class="sirk-card"><h3>Harmonogram serwera</h3><p class="sirk-muted">Automatyzacje będą zarządzać zadaniami serwera w katalogu harmonogramu <strong>SIRK</strong>. Polecenia urządzeń są dostępne wyłącznie w widoku Urządzenia.</p><p class="sirk-muted">Katalogi automatyzacji i zadania zostaną utworzone przez Portal po udostępnieniu usługi harmonogramu.</p></div></div></section>';
    }

    function render(view) {
        view = VIEW_KEYS.indexOf(view) >= 0 && viewEnabled(view) ? view : firstEnabledView();
        activeView = view;
        var sequence = ++renderSequence;
        applyViewSurface(view);
        applyShellLanguage();
        title.textContent = viewName(view);
        Array.prototype.forEach.call(document.querySelectorAll(".sirk-standalone-nav [data-view]"), function (button) {
            var active = button.getAttribute("data-view") === view;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-current", active ? "page" : "false");
        });
        if (view === "overview") overview(sequence);
        else if (view === "management") management(sequence);
        else if (view === "approvals") approvals(sequence);
        else if (view === "settings") settings();
        else if (view === "devices") devices(sequence, false);
        else if (view === "automation") automation(sequence);
        else if (moduleViews[view]) mountModule(view, moduleViews[view], sequence);
        else if (view === "monitoring") placeholder(view, t("monitoringPlaceholder"));
        else if (view === "reports") placeholder(view, t("reportsPlaceholder"));
        else placeholder(view, t("genericPlaceholder"));
        if (window.location.hash !== "#" + view) history.replaceState(null, "", "#" + view);
    }

    function setTheme(dark) {
        portalRoot.classList.toggle("sirk-theme-dark", dark);
        portalRoot.classList.toggle("sirk-theme-light", !dark);
        document.documentElement.style.colorScheme = dark ? "dark" : "light";
        syncThemeButton(dark);
        try { localStorage.setItem("sirkPortal.theme", dark ? "dark" : "light"); } catch (ignored) {}
    }

    function bind() {
        root.addEventListener("click", function (event) {
            var openView = event.target.closest("[data-open-view]");
            if (openView && root.contains(openView)) {
                event.preventDefault();
                selectedDeviceId = "";
                render(openView.getAttribute("data-open-view"));
                return;
            }
            var deviceRow = event.target.closest("[data-device-id]");
            if (deviceRow && root.contains(deviceRow)) {
                event.preventDefault();
                selectedDeviceId = deviceRow.getAttribute("data-device-id") || "";
                devices(renderSequence, false);
                return;
            }
            var deviceBack = event.target.closest("[data-device-back]");
            if (deviceBack && root.contains(deviceBack)) {
                event.preventDefault();
                selectedDeviceId = "";
                devices(renderSequence, false);
                return;
            }
            var nav = event.target.closest("[data-view]");
            if (nav && root.contains(nav)) {
                event.preventDefault();
                selectedDeviceId = "";
                render(nav.getAttribute("data-view"));
                return;
            }
            var action = event.target.closest("[data-action]");
            if (!action) return;
            event.preventDefault();
            var name = action.getAttribute("data-action");
            if (name === "sidebar") {
                var value = !root.classList.contains("is-collapsed");
                root.classList.toggle("is-collapsed", value);
                try { localStorage.setItem("sirkPortal.standaloneCollapsed", value ? "1" : "0"); } catch (ignored) {}
                applyShellLanguage();
            } else if (name === "theme") {
                setTheme(!portalRoot.classList.contains("sirk-theme-dark"));
            } else if (name === "language") {
                setLanguage(language() === "pl" ? "en" : "pl");
            } else if (name === "user-menu") {
                var userMenu = document.getElementById("sirkUserMenu");
                var open = userMenu && !userMenu.classList.contains("is-open");
                if (userMenu) userMenu.classList.toggle("is-open", open);
                action.setAttribute("aria-expanded", open ? "true" : "false");
            } else if (name === "logout") {
                window.location.assign(String(window.__SIRK_PLATFORM_LOGOUT_URL__ || "/logout"));
            }
        });
        document.addEventListener("click", function (event) {
            var userMenu = document.getElementById("sirkUserMenu");
            if (!userMenu || userMenu.contains(event.target)) return;
            userMenu.classList.remove("is-open");
            var tile = document.getElementById("sirkUserTile");
            if (tile) tile.setAttribute("aria-expanded", "false");
        });
        document.addEventListener("keydown", function (event) {
            if (event.key !== "Escape") return;
            var userMenu = document.getElementById("sirkUserMenu");
            if (userMenu) userMenu.classList.remove("is-open");
            var tile = document.getElementById("sirkUserTile");
            if (tile) tile.setAttribute("aria-expanded", "false");
        });
        try {
            if (localStorage.getItem("sirkPortal.standaloneCollapsed") === "1") root.classList.add("is-collapsed");
            setTheme(localStorage.getItem("sirkPortal.theme") === "dark");
        } catch (ignored) { setTheme(false); }
        applyShellLanguage();
        window.addEventListener("hashchange", function () {
            selectedDeviceId = "";
            render(location.hash.slice(1));
        });
    }

    function loadDependencies() {
        var files = [
            ["sirk-shared-toolbar-config", "shared-ui/toolbar-config.js"], ["sirk-shared-toolbar-api", "shared-ui/toolbar-api.js"],
            ["sirk-shared-toolbar", "shared-ui/toolbar.js"], ["sirk-shared-tabs", "shared-ui/tabs.js"],
            ["sirk-shared-layout", "shared-ui/layout.js"], ["sirk-shared-settings", "shared-ui/settings.js"],
            ["sirk-shared-status-nav", "shared-ui/status-nav.js"], ["sirk-shared-page", "shared-ui/page.js"],
            ["sirk-shared-tree", "shared-ui/tree.js"], ["sirk-shared-catalog", "shared-ui/catalog.js"], ["sirk-shared-results", "shared-ui/results.js"],
            ["sirk-shared-result-layout", "shared-ui/result-layout.js"], ["sirk-shared-script-tools", "shared-ui/script-tools.js"],
            ["sirk-shared-script-definition", "shared-ui/script-definition-form.js"], ["sirk-shared-confirm", "shared-ui/confirm-execution-form.js"],
            ["sirk-shared-edit-actions", "shared-ui/script-edit-actions.js"], ["sirk-shared-system-credentials", "shared-ui/system-credentials-form.js"],
            ["sirk-module-shell", "module-shell.js"], ["sirk-icon-data", "portal-icon-data.js"],
            ["sirk-approval-module", "approvalcenter.js"], ["sirk-move-module", "moverequests.js"],
            ["sirk-commands-module", "mycommands.js"], ["sirk-jira-module", "myjira.js"],
            ["sirk-defender-module", "defendertools.js"], ["sirk-management-renderer", "portal-management.js"],
            ["sirk-subfolder-icons", "portal-subfolder-icons.js"], ["sirk-folder-collapse", "portal-folder-collapse.js"]
        ];
        var chain = Promise.resolve();
        files.forEach(function (entry) { chain = chain.then(function () { return load(entry[0], entry[1]); }); });
        return chain;
    }

    function start() {
        bind();
        loading(t("loadingModules"));
        core.api("", "bootstrap").then(function (value) {
            bootstrap = value || {};
            window.SirkPlatformRuntime = window.SirkPlatformRuntime || { state: {} };
            window.SirkPlatformRuntime.state = window.SirkPlatformRuntime.state || {};
            window.SirkPlatformRuntime.state.bootstrap = bootstrap;
            bootstrap.access = bootstrap.access || (bootstrap.modules && bootstrap.modules.portal && bootstrap.modules.portal.access) || {};
            applyUserProfile();
            applyShellLanguage();
            return loadDependencies();
        }).then(function () {
            var requested = location.hash.slice(1);
            render(requested || portalConfig().defaultView || "overview");
        }).catch(function (reason) {
            showError("SirK Portal: " + t("loadFailed"), reason && (reason.stack || reason.message) || reason);
        });
    }

    start();
}());
