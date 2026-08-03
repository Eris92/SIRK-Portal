(function () {
    "use strict";

    if (window.__sirkPlatformPortalFixLoaded) return;
    window.__sirkPlatformPortalFixLoaded = true;

    var managementActive = false;
    var collapsedKey = "sirkPortal.sidebarCollapsed";

    function root() {
        return document.getElementById("sirkPortalRoot");
    }

    function normalizedText(node) {
        return String(node && node.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    }

    function managementButton(portalRoot) {
        var direct = portalRoot.querySelector('[data-sirk-platform-management-nav="1"],[data-sirk-view="management"]');
        if (direct) return direct;
        var buttons = portalRoot.querySelectorAll("button,[role=button]");
        for (var index = 0; index < buttons.length; index++) {
            var text = normalizedText(buttons[index]);
            if (text === "zarządzanie" || text === "management") return buttons[index];
        }
        return null;
    }

    function isManagementTarget(target, portalRoot) {
        var button = target && target.closest && target.closest("button,[role=button]");
        if (!button || !portalRoot.contains(button)) return false;
        if (button.getAttribute("data-sirk-view") === "management") return true;
        if (button.getAttribute("data-sirk-platform-management-nav") === "1") return true;
        var text = normalizedText(button);
        return text === "zarządzanie" || text === "management";
    }

    function mainHost(portalRoot) {
        var main = portalRoot.querySelector(".sirk-main,.sirk-content,.sirk-portal-main,[data-sirk-main]");
        if (main) return main;
        var view = portalRoot.querySelector("[data-view],.sirk-view");
        return view && view.parentElement;
    }

    function managementHost(portalRoot) {
        var main = mainHost(portalRoot);
        if (!main) return null;
        var host = main.querySelector('[data-="1"]');
        if (!host) {
            host = document.createElement("section");
            host.className = "sirk-view";
            host.setAttribute("data-view", "sirk-platform-management");
            host.setAttribute("data-", "1");
            main.appendChild(host);
        }
        return host;
    }

    function hideLegacySubmenu(portalRoot) {
        var button = managementButton(portalRoot);
        if (!button) return;
        button.setAttribute("data-sirk-view", "management");
        button.setAttribute("data-sirk-platform-management-nav", "1");
        var nav = button.closest("nav,.sirk-nav,.sirk-sidebar,[role=navigation]") || button.parentElement;
        if (!nav) return;
        var candidates = nav.querySelectorAll("ul,ol,.sirk-submenu,.sirk-nav-submenu,[data-sirk-parent],[data-parent-view]");
        Array.prototype.forEach.call(candidates, function (candidate) {
            if (candidate.contains(button)) return;
            if (/defender|jira|entra|zabbix|inne/.test(normalizedText(candidate))) {
                candidate.hidden = true;
                candidate.style.display = "none";
                candidate.setAttribute("aria-hidden", "true");
                candidate.setAttribute("data-sirk-platform-hidden-management-submenu", "1");
            }
        });
        var next = button.nextElementSibling;
        if (next && /defender|jira|entra|zabbix|inne/.test(normalizedText(next))) {
            next.hidden = true;
            next.style.display = "none";
            next.setAttribute("data-sirk-platform-hidden-management-submenu", "1");
        }
    }

    function setActiveButton(portalRoot) {
        var selected = managementButton(portalRoot);
        var buttons = portalRoot.querySelectorAll("[data-sirk-view]");
        Array.prototype.forEach.call(buttons, function (button) {
            var active = button === selected;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-current", active ? "page" : "false");
        });
    }

    function showOnlyManagement(portalRoot, host) {
        var main = mainHost(portalRoot);
        if (!main || !host) return;
        var views = main.querySelectorAll("[data-view],.sirk-view");
        Array.prototype.forEach.call(views, function (view) {
            var visible = view === host || view.contains(host);
            view.hidden = !visible;
            view.style.display = visible ? "" : "none";
            view.classList.toggle("is-active", visible);
        });
        host.hidden = false;
        host.style.display = "";
        host.classList.add("is-active");
    }

    function mountManagement(force) {
        var portalRoot = root();
        if (!portalRoot || !managementActive) return;
        hideLegacySubmenu(portalRoot);
        var host = managementHost(portalRoot);
        if (!host) return;
        showOnlyManagement(portalRoot, host);
        setActiveButton(portalRoot);
        if (!window.SirkPlatformPortalManagement || typeof window.SirkPlatformPortalManagement.mount !== "function") {
            host.innerHTML = '<div class="sirk-card"><h3>Zarządzanie</h3><p>Renderer Management nie został załadowany.</p></div>';
            return;
        }
        if (force || !host.querySelector(".sirk-view-shell")) {
            host.innerHTML = "";
            window.SirkPlatformPortalManagement.mount(host);
        }
    }

    function activateManagement() {
        managementActive = true;
        mountManagement(true);
        window.setTimeout(function () { mountManagement(false); }, 0);
        window.setTimeout(function () { mountManagement(false); }, 75);
        window.setTimeout(function () { mountManagement(false); }, 250);
    }

    function collapsedValue() {
        try { return window.localStorage.getItem(collapsedKey) === "1"; }
        catch (error) { return false; }
    }

    function applyCollapsed(value) {
        var portalRoot = root();
        if (!portalRoot) return;
        var sidebar = portalRoot.querySelector(".sirk-sidebar,.sirk-nav,.sirk-portal-sidebar,[data-sirk-sidebar]");
        portalRoot.classList.toggle("sirk-platform-sidebar-collapsed", value);
        portalRoot.classList.toggle("is-sidebar-collapsed", value);
        portalRoot.setAttribute("data-sidebar-collapsed", value ? "1" : "0");
        if (sidebar) {
            sidebar.classList.toggle("is-collapsed", value);
            sidebar.classList.toggle("sirk-sidebar-collapsed", value);
            sidebar.setAttribute("data-collapsed", value ? "1" : "0");
        }
        try { window.localStorage.setItem(collapsedKey, value ? "1" : "0"); }
        catch (error) {}
    }

    function collapseButton(target, portalRoot) {
        var button = target && target.closest && target.closest("button,[role=button]");
        if (!button || !portalRoot.contains(button)) return null;
        if (button.matches('[data-sirk-action="collapse"],[data-action="collapse"],[data-sidebar-toggle],.sirk-sidebar-toggle,.sirk-collapse-toggle')) return button;
        var title = String(button.title || button.getAttribute("aria-label") || "").toLowerCase();
        if (/collapse|expand|zwiń|rozwiń/.test(title)) return button;
        var text = normalizedText(button);
        if (text === "<" || text === ">" || text === "‹" || text === "›" || text === "«" || text === "»") return button;
        return null;
    }

    window.addEventListener("click", function (event) {
        var portalRoot = root();
        if (!portalRoot || !portalRoot.contains(event.target)) return;
        if (isManagementTarget(event.target, portalRoot)) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
            activateManagement();
            return;
        }

        // The native Management renderer owns every click inside its shell.
        // Do not treat its Collapse button as the global SirK Portal sidebar toggle.
        if (event.target.closest && event.target.closest(".sirk-view-shell")) return;

        var toggle = collapseButton(event.target, portalRoot);
        if (toggle) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
            applyCollapsed(!collapsedValue());
            return;
        }
        var navigation = event.target.closest && event.target.closest("[data-sirk-view]");
        if (navigation && navigation.getAttribute("data-sirk-view") !== "management") managementActive = false;
    }, true);

    function bind() {
        var portalRoot = root();
        if (!portalRoot) return false;
        applyCollapsed(collapsedValue());
        hideLegacySubmenu(portalRoot);
        if (!portalRoot.__sirkPlatformFinalObserver) {
            portalRoot.__sirkPlatformFinalObserver = new MutationObserver(function () {
                hideLegacySubmenu(portalRoot);
                applyCollapsed(collapsedValue());
                if (managementActive) mountManagement(false);
            });
            portalRoot.__sirkPlatformFinalObserver.observe(portalRoot, { childList: true, subtree: true });
        }
        return true;
    }

    var attempts = 0;
    var timer = window.setInterval(function () {
        attempts++;
        if (bind() || attempts > 120) window.clearInterval(timer);
    }, 100);
}());