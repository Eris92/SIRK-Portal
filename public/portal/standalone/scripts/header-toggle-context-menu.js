(function () {
    "use strict";

    if (window.__sirkHeaderToggleContextMenuLoaded) return;
    window.__sirkHeaderToggleContextMenuLoaded = true;

    var menu = null;
    var openedFor = null;
    var LINK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 15l6-6M7 17l-1 1a3 3 0 104 4l3-3a3 3 0 000-4M17 7l1-1a3 3 0 10-4-4l-3 3a3 3 0 000 4"/></svg>';
    var UNLINK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 16l-2 2a3 3 0 104 4l3-3M16 8l2-2a3 3 0 10-4-4l-3 3M5 5l14 14"/></svg>';

    function root() { return document.getElementById("sirkPortalRoot"); }
    function workspace() {
        var content = document.getElementById("sirkStandaloneContent");
        return content && content.querySelector(":scope > .sirk-device-workspace");
    }
    function connectionMode() {
        return document.documentElement.classList.contains("sirk-device-connection-mode");
    }
    function language() {
        try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
        catch (_) { return document.documentElement.lang === "en" ? "en" : "pl"; }
    }
    function text(pl, en) { return language() === "en" ? en : pl; }
    function sections() {
        return language() === "en"
            ? [
                { key: "general", label: "Overview" },
                { key: "desktop", label: "Connection" },
                { key: "terminal", label: "Terminal" },
                { key: "commands", label: "Commands" },
                { key: "files", label: "Files" },
                { key: "settings", label: "Settings" }
            ]
            : [
                { key: "general", label: "Ogólne" },
                { key: "desktop", label: "Połączenie" },
                { key: "terminal", label: "Terminal" },
                { key: "commands", label: "Polecenia" },
                { key: "files", label: "Pliki" },
                { key: "settings", label: "Ustawienia" }
            ];
    }
    function connectionToggle(ws) {
        return ws && ws.querySelector("[data-sirk-workspace-connection-toggle]");
    }
    function connected(ws) {
        var toggle = connectionToggle(ws);
        return !!(toggle && toggle.getAttribute("aria-pressed") === "true");
    }
    function activeSection(ws) {
        var button = ws && ws.querySelector(":scope > .sirk-device-tabs [data-device-tab].is-active");
        return button && button.getAttribute("data-device-tab") || "general";
    }
    function pointerDown(element) {
        if (!element) return;
        try {
            element.dispatchEvent(new PointerEvent("pointerdown", {
                bubbles: true,
                cancelable: true,
                pointerType: "mouse"
            }));
        } catch (_) {
            try { element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true })); }
            catch (_) {}
        }
    }
    function activateSection(ws, section) {
        var button = ws && ws.querySelector(':scope > .sirk-device-tabs [data-device-tab="' + section + '"]');
        if (!button || button.disabled) return;
        pointerDown(button);
        try { button.click(); } catch (_) {}
    }
    function ensureMenu() {
        if (menu && menu.isConnected) return menu;
        menu = document.createElement("div");
        menu.id = "sirkConnectionHeaderContextMenu";
        menu.className = "sirk-header-toggle-context-menu";
        menu.hidden = true;
        menu.setAttribute("role", "menu");
        (root() || document.body).appendChild(menu);
        return menu;
    }
    function hideMenu() {
        if (menu) menu.hidden = true;
        openedFor = null;
    }
    function positionMenu(x, y) {
        if (!menu || menu.hidden) return;
        var width = Math.max(menu.offsetWidth || 196, 196);
        var height = Math.max(menu.offsetHeight || 260, 160);
        var left = Math.min(window.innerWidth - width - 8, Math.max(8, x));
        var top = Math.min(window.innerHeight - height - 8, Math.max(8, y));
        menu.style.left = left + "px";
        menu.style.top = top + "px";
    }
    function renderMenu(ws) {
        var current = activeSection(ws);
        var isConnected = connected(ws);
        var toggle = connectionToggle(ws);
        var connectionDisabled = !toggle || toggle.disabled;
        var connection = '<button type="button" role="menuitem" data-header-context-connection="1" class="sirk-header-context-connection ' +
            (isConnected ? "is-disconnect" : "is-connect") + '"' + (connectionDisabled ? " disabled" : "") + '>' +
            (isConnected ? UNLINK_ICON : LINK_ICON) + '<span>' +
            (isConnected ? text("Rozłącz", "Disconnect") : text("Połącz", "Connect")) + '</span></button>';
        var items = sections().map(function (item) {
            var button = ws.querySelector(':scope > .sirk-device-tabs [data-device-tab="' + item.key + '"]');
            var disabled = !button || button.disabled;
            return '<button type="button" role="menuitem" data-header-context-section="' + item.key + '" class="' +
                (item.key === current ? "is-active" : "") + '"' + (disabled ? " disabled" : "") + '>' +
                item.label + '</button>';
        }).join("");
        ensureMenu().innerHTML = connection + items;
    }
    function showMenu(event) {
        var ws = workspace();
        if (!connectionMode() || !ws) {
            hideMenu();
            return;
        }
        renderMenu(ws);
        openedFor = ws;
        menu.hidden = false;
        positionMenu(event.clientX, event.clientY);
    }

    document.addEventListener("contextmenu", function (event) {
        var button = event.target && event.target.closest && event.target.closest("#sirkConnectionHeaderToggle");
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
        showMenu(event);
    }, true);

    document.addEventListener("click", function (event) {
        if (!menu || menu.hidden) return;
        var connection = event.target && event.target.closest && event.target.closest("[data-header-context-connection]");
        if (connection && menu.contains(connection)) {
            event.preventDefault();
            event.stopPropagation();
            var ws = openedFor && openedFor.isConnected ? openedFor : workspace();
            var toggle = connectionToggle(ws);
            hideMenu();
            if (toggle && !toggle.disabled) {
                try { toggle.click(); } catch (_) {}
            }
            return;
        }
        var section = event.target && event.target.closest && event.target.closest("[data-header-context-section]");
        if (section && menu.contains(section)) {
            event.preventDefault();
            event.stopPropagation();
            var currentWorkspace = openedFor && openedFor.isConnected ? openedFor : workspace();
            var key = section.getAttribute("data-header-context-section") || "general";
            hideMenu();
            activateSection(currentWorkspace, key);
            return;
        }
        if (!menu.contains(event.target)) hideMenu();
    }, true);

    document.addEventListener("pointerdown", function (event) {
        if (!menu || menu.hidden) return;
        var headerToggle = event.target && event.target.closest && event.target.closest("#sirkConnectionHeaderToggle");
        if (!menu.contains(event.target) && !headerToggle) hideMenu();
    }, true);

    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") hideMenu();
    });
    window.addEventListener("resize", hideMenu);
    window.addEventListener("scroll", hideMenu, true);
    window.addEventListener("sirkportal:deviceviewmodechange", hideMenu);
    window.addEventListener("sirkportal:languagechange", hideMenu);

    var style = document.createElement("style");
    style.id = "sirk-header-toggle-context-menu-style";
    style.textContent = [
        ".sirk-header-toggle-context-menu{position:fixed!important;z-index:2147483647!important;display:grid;min-width:196px;padding:5px;border:1px solid var(--sirk-border,#dce3ec);border-radius:10px;background:var(--sirk-panel,#fff);color:var(--sirk-text,#172033);box-shadow:0 14px 35px rgba(15,23,42,.28)}",
        ".sirk-header-toggle-context-menu[hidden]{display:none!important}",
        ".sirk-header-toggle-context-menu button{display:flex;align-items:center;gap:8px;min-height:36px;padding:8px 11px;border:0;border-radius:7px;background:transparent;color:inherit;text-align:left;font:600 13px Segoe UI,Arial,sans-serif;cursor:pointer}",
        ".sirk-header-toggle-context-menu button:hover:not(:disabled),.sirk-header-toggle-context-menu button:focus-visible{background:var(--sirk-hover,#eef3f9);outline:none}",
        ".sirk-header-toggle-context-menu button.is-active{background:rgba(59,130,246,.13);color:#2563eb}",
        ".sirk-header-toggle-context-menu button:disabled{opacity:.4;cursor:not-allowed}",
        ".sirk-header-toggle-context-menu .sirk-header-context-connection{margin-bottom:4px;border-bottom:1px solid var(--sirk-border,#dce3ec);border-radius:7px 7px 3px 3px;font-weight:700}",
        ".sirk-header-toggle-context-menu .sirk-header-context-connection svg{flex:0 0 15px;width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}",
        ".sirk-header-toggle-context-menu .sirk-header-context-connection.is-connect{color:#15803d}",
        ".sirk-header-toggle-context-menu .sirk-header-context-connection.is-disconnect{color:#dc2626}",
        "#sirkPortalRoot.sirk-theme-dark .sirk-header-toggle-context-menu{--sirk-hover:#1d293b;--sirk-text:#e7edf7;--sirk-border:#2a374a;background:#111827;color:#e7edf7;border-color:#2a374a}",
        "#sirkPortalRoot.sirk-theme-dark .sirk-header-toggle-context-menu .sirk-header-context-connection.is-connect{color:#86efac}",
        "#sirkPortalRoot.sirk-theme-dark .sirk-header-toggle-context-menu .sirk-header-context-connection.is-disconnect{color:#fca5a5}"
    ].join("");
    (document.head || document.documentElement).appendChild(style);
}());