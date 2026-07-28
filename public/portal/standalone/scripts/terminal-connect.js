(function () {
    "use strict";

    if (window.__sirkPlatformPortalTerminalConnectLoaded) return;
    window.__sirkPlatformPortalTerminalConnectLoaded = true;

    var pendingOptions = null;
    var closeHandlerInstalled = false;
    var permissionSaving = false;
    var PERMISSION_TARGETS = {
        "Urządzenia": { view: "devices" },
        "Commands": { module: "mycommands" },
        "Akceptacje": { module: "approvalcenter", view: "approvals" },
        "Przenoszenie urządzeń": { module: "moverequests" },
        "Automatyzacja": { module: "myscripts", view: "automation" },
        "Monitoring": { view: "monitoring" },
        "Zasoby": { module: "myjira", view: "assets" },
        "Zarządzanie": { view: "management" },
        "Raporty": { view: "reports" },
        "Bezpieczeństwo": { module: "defendertools", view: "security" }
    };

    function language() {
        try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
        catch (error) { return document.documentElement.lang === "en" ? "en" : "pl"; }
    }

    function text(pl, en) { return language() === "en" ? en : pl; }

    function installMenuStyle() {
        if (document.getElementById("sirkConnectDropdownFixStyle")) return;
        var style = document.createElement("style");
        style.id = "sirkConnectDropdownFixStyle";
        style.textContent = [
            ".sirk-connect-menu.sirk-connect-menu-portal,.sirk-terminal-connect-menu.sirk-connect-menu-portal{position:fixed!important;z-index:2147483647!important;display:grid!important;min-width:220px!important;max-height:calc(100vh - 16px)!important;overflow:auto!important;margin:0!important}",
            ".sirk-connect-menu.sirk-connect-menu-portal[hidden],.sirk-terminal-connect-menu.sirk-connect-menu-portal[hidden]{display:none!important}"
        ].join("");
        (document.head || document.documentElement).appendChild(style);
    }

    function terminalOptions() {
        return [
            { label: text("Powłoka Admina", "Admin Shell"), options: { protocol: 1 } },
            { label: text("PowerShell jako Admin", "PowerShell as Admin"), options: { protocol: 2 } },
            { label: text("Powłoka Użytkownika", "User Shell"), options: { protocol: 4 } },
            { label: text("Użyj PowerShell", "Use PowerShell"), options: { protocol: 5 } },
            { label: text("Terminal z Zapytaniem Administratora", "Terminal with Administrator Prompt"), options: { protocol: 1, requireLogin: true } },
            { label: text("PowerShell z Zapytaniem Administratora", "PowerShell with Administrator Prompt"), options: { protocol: 2, requireLogin: true } },
            { label: text("Terminal z Zapytaniem Użytkownika", "Terminal with User Prompt"), options: { protocol: 4, requireLogin: true } },
            { label: text("PowerShell z Zapytaniem Użytkownika", "PowerShell with User Prompt"), options: { protocol: 5, requireLogin: true } }
        ];
    }

    function isTerminalToolbar() {
        var body = document.getElementById("sirkDeviceTabBody");
        return !!(body && body.closest(".sirk-device-workspace") && document.querySelector('[data-device-tab="terminal"].is-active'));
    }

    function patchNativeFrame() {
        var frame = document.getElementById("sirkNativeBridgeFrame");
        if (!frame) return;
        try {
            var win = frame.contentWindow;
            if (!win || typeof win.connectTerminal !== "function" || win.connectTerminal.__sirkTerminalWrapped) return;
            var original = win.connectTerminal;
            var wrapped = function (event, protocol, options) {
                if (pendingOptions) {
                    options = pendingOptions;
                    pendingOptions = null;
                }
                return original.call(this, event, protocol, options);
            };
            wrapped.__sirkTerminalWrapped = true;
            win.connectTerminal = wrapped;
        } catch (error) {}
    }

    function positionPortalMenu(menu, toggle) {
        if (!menu || !toggle || menu.hidden) return;
        var rect = toggle.getBoundingClientRect();
        var width = Math.max(menu.offsetWidth || 220, 220);
        var height = menu.offsetHeight || 180;
        var left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left));
        var top = rect.bottom + 5;
        if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 5);
        menu.style.left = left + "px";
        menu.style.top = top + "px";
    }

    function portalMenu(menu, toggle) {
        if (!menu || !toggle) return;
        if (!menu.classList.contains("sirk-connect-menu-portal")) {
            menu.classList.add("sirk-connect-menu-portal");
            document.body.appendChild(menu);
            menu.addEventListener("pointerdown", function (event) { event.stopPropagation(); });
            menu.addEventListener("click", function (event) { event.stopPropagation(); });
        }
        menu.__sirkToggle = toggle;
        if (!menu.hidden) positionPortalMenu(menu, toggle);
    }

    function setMenuOpen(menu, toggle, open) {
        if (!menu || !toggle) return;
        document.querySelectorAll(".sirk-connect-menu-portal").forEach(function (other) {
            if (other !== menu) {
                other.hidden = true;
                if (other.__sirkToggle) other.__sirkToggle.setAttribute("aria-expanded", "false");
            }
        });
        menu.hidden = !open;
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        if (open) {
            portalMenu(menu, toggle);
            window.requestAnimationFrame(function () { positionPortalMenu(menu, toggle); });
        }
    }

    function fixDesktopDropdown() {
        var toggle = document.querySelector(".sirk-connect-arrow");
        var menu = document.querySelector(".sirk-connect-menu");
        if (!toggle || !menu) return;
        portalMenu(menu, toggle);
        if (toggle.getAttribute("data-sirk-dropdown-fixed") === "1") return;
        toggle.setAttribute("data-sirk-dropdown-fixed", "1");
        toggle.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
            setMenuOpen(menu, toggle, menu.hidden);
        }, true);
    }

    function enhanceTerminal() {
        if (!isTerminalToolbar()) return;
        var connect = document.getElementById("sirkNativeConnect");
        if (!connect) return;

        var existingGroup = connect.closest(".sirk-terminal-connect-group");
        if (existingGroup) {
            var existingToggle = existingGroup.querySelector(".sirk-terminal-connect-toggle");
            var existingMenu = document.getElementById("sirkNativeTerminalConnectMenu");
            if (existingToggle && existingMenu) portalMenu(existingMenu, existingToggle);
            return;
        }

        var parent = connect.parentNode;
        if (!parent) return;

        var group = document.createElement("div");
        group.className = "sirk-native-bridge-button-group sirk-terminal-connect-group";
        parent.insertBefore(group, connect);
        group.appendChild(connect);
        connect.classList.add("sirk-native-bridge-split-main");

        var toggle = document.createElement("button");
        toggle.id = "sirkNativeTerminalConnectDropdown";
        toggle.type = "button";
        toggle.className = "sirk-native-bridge-button sirk-native-bridge-split-toggle sirk-terminal-connect-toggle";
        toggle.setAttribute("aria-haspopup", "menu");
        toggle.setAttribute("aria-expanded", "false");
        toggle.title = text("Opcje połączenia Terminala", "Terminal connection options");
        toggle.textContent = "▼";
        group.appendChild(toggle);

        var menu = document.createElement("div");
        menu.id = "sirkNativeTerminalConnectMenu";
        menu.className = "sirk-native-bridge-menu sirk-terminal-connect-menu";
        menu.setAttribute("role", "menu");
        menu.hidden = true;

        terminalOptions().forEach(function (entry) {
            var item = document.createElement("button");
            item.type = "button";
            item.className = "sirk-native-bridge-menu-item";
            item.setAttribute("role", "menuitem");
            item.textContent = entry.label;
            item.addEventListener("click", function (event) {
                event.preventDefault();
                event.stopPropagation();
                pendingOptions = entry.options;
                setMenuOpen(menu, toggle, false);
                connect.click();
            });
            menu.appendChild(item);
        });

        document.body.appendChild(menu);
        portalMenu(menu, toggle);

        connect.addEventListener("click", function () {
            if (!pendingOptions) pendingOptions = { protocol: 1 };
        }, true);

        toggle.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
            setMenuOpen(menu, toggle, menu.hidden);
        }, true);
    }

    function closeAllMenus(event) {
        document.querySelectorAll(".sirk-connect-menu-portal").forEach(function (menu) {
            var toggle = menu.__sirkToggle;
            if (event && (menu.contains(event.target) || (toggle && toggle.contains(event.target)))) return;
            menu.hidden = true;
            if (toggle) toggle.setAttribute("aria-expanded", "false");
        });
    }

    function settingsWorkspace() {
        var content = document.getElementById("sirkStandaloneContent");
        return content && content.querySelector("[data-portal-settings] .sirk-layout");
    }

    function permissionTarget(workspace) {
        var active = workspace && workspace.querySelector(".sirk-column-secondary .sirk-settings-nav-leaf.active,.sirk-column-secondary .sirk-settings-nav-leaf.is-active");
        if (!active || String(active.textContent || "").trim() !== "Permissions") return null;
        var group = active.closest("details.sirk-settings-nav-group");
        var summary = group && group.querySelector(":scope > summary");
        var label = String(summary && summary.textContent || "").replace(/^\s*[▸▼]?\s*/, "").trim();
        var target = PERMISSION_TARGETS[label];
        return target ? { label: label, module: target.module, view: target.view } : null;
    }

    function settingsApiUrl(action) {
        return new URL(action === "snapshot" ? "/api/admin/settings" : "/api", window.location.href).href;
    }

    function parseSettingsResponse(response) {
        return response.text().then(function (body) {
            var value;
            try { value = JSON.parse(body || "{}"); }
            catch (error) {
                throw new Error("Endpoint ustawień zwrócił odpowiedź inną niż JSON (HTTP " + response.status + ").");
            }
            if (!response.ok || value.ok === false) throw new Error(value.error || ("HTTP " + response.status));
            return value.value || value.snapshot || value;
        });
    }

    function selectedPermissionGroups(workspace) {
        var card = workspace.querySelector("[data-group-permissions]");
        if (!card) return null;
        return Array.prototype.filter.call(card.querySelectorAll('input[type="checkbox"]'), function (input) {
            return input.checked;
        }).map(function (input) { return String(input.value); });
    }

    function savePermissions(workspace, target, groupIds, button) {
        if (permissionSaving) return;
        permissionSaving = true;
        button.disabled = true;
        fetch(settingsApiUrl("snapshot"), {
            credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" }
        }).then(parseSettingsResponse).then(function (snapshot) {
            var moduleOptions = JSON.parse(JSON.stringify(snapshot.moduleSettings || {}));
            var modules = {};
            (snapshot.modules || []).forEach(function (module) { modules[module.key] = module.enabled === true; });
            if (target.module) {
                moduleOptions[target.module] = moduleOptions[target.module] || {};
                moduleOptions[target.module].accessGroupIds = groupIds;
            }
            if (target.view) {
                moduleOptions.portal = moduleOptions.portal || {};
                moduleOptions.portal.views = moduleOptions.portal.views || {};
                moduleOptions.portal.views[target.view] = moduleOptions.portal.views[target.view] || {};
                moduleOptions.portal.views[target.view].accessGroupIds = groupIds;
            }
            var form = new URLSearchParams();
            form.set("payload", JSON.stringify({
                modules: modules,
                moduleOptions: moduleOptions,
                portal: moduleOptions.portal || {},
                integrations: snapshot.integrations && snapshot.integrations.values || {},
                secrets: {}
            }));
            return fetch("/api/admin/settings", {
                method: "POST", credentials: "same-origin",
                headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: "application/json" },
                body: form.toString()
            }).then(parseSettingsResponse);
        }).then(function () {
            var refreshButton = workspace.querySelector("[data-settings-refresh]");
            if (refreshButton) refreshButton.click();
        }).catch(function (error) {
            button.disabled = false;
            window.alert("Nie udało się zapisać uprawnień: " + error.message);
        }).then(function () { permissionSaving = false; });
    }

    function bindPermissionSave() {
        if (document.documentElement.getAttribute("data-permission-save-fixed") === "1") return;
        document.documentElement.setAttribute("data-permission-save-fixed", "1");
        document.addEventListener("click", function (event) {
            var button = event.target && event.target.closest("button");
            if (!button || String(button.textContent || "").trim() !== "Zapisz") return;
            var workspace = settingsWorkspace();
            var target = permissionTarget(workspace);
            var groupIds = selectedPermissionGroups(workspace);
            if (!workspace || !target || groupIds === null) return;
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
            savePermissions(workspace, target, groupIds, button);
        }, true);
    }

    function removeEmptySettingsNotices() {
        var workspace = settingsWorkspace();
        if (!workspace) return;
        Array.prototype.forEach.call(workspace.querySelectorAll(".sirk-card"), function (node) {
            var value = String(node.textContent || "").trim();
            if (value === "Ten moduł nie ma osobnej konfiguracji Permissions." || value === "Brak ustawień w tej sekcji.") node.remove();
        });
    }

    function refresh() {
        installMenuStyle();
        enhanceTerminal();
        fixDesktopDropdown();
        patchNativeFrame();
        bindPermissionSave();
        removeEmptySettingsNotices();
    }

    if (!closeHandlerInstalled) {
        document.addEventListener("pointerdown", closeAllMenus, true);
        window.addEventListener("resize", function () {
            document.querySelectorAll(".sirk-connect-menu-portal:not([hidden])").forEach(function (menu) {
                positionPortalMenu(menu, menu.__sirkToggle);
            });
        });
        closeHandlerInstalled = true;
    }

    var observer = new MutationObserver(function () { window.setTimeout(refresh, 0); });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });
    window.setInterval(refresh, 250);
    refresh();
}());
