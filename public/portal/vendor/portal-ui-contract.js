(function () {
    "use strict";

    window.SirkPortalUiContract = window.SirkPortalUiContract || {};
    window.SirkPortalUiContract.decorate = function (root) {
        if (!root) return;
        root.querySelectorAll(".sirk-standalone-card,.sirk-card").forEach(function (node) {
            node.classList.add("sirk-card");
        });
        root.querySelectorAll("button").forEach(function (node) {
            if (!node.classList.contains("sirk-button")) node.classList.add("sirk-button");
        });
    };

    var THEME_STORAGE = "sirkPortal.theme";
    var themeScheduled = false;

    function injectThemeStyle() {
        if (document.getElementById("sirk-theme-runtime-style")) return;
        var style = document.createElement("style");
        style.id = "sirk-theme-runtime-style";
        style.textContent = [
            "html.sirk-theme-light,body.sirk-theme-light,#sirkPortalRoot.sirk-theme-light,#sirkStandaloneRoot.sirk-theme-light{--sirk-bg:#f3f6fb;--sirk-panel:#ffffff;--sirk-input:#ffffff;--sirk-text:#172033;--sirk-muted:#657187;--sirk-border:#dce3ec;--sirk-active-bg:rgba(77,107,216,.14);--sirk-sidebar:#0d1728;--sirk-sidebar-active:#2b3b55}",
            "html.sirk-theme-dark,body.sirk-theme-dark,#sirkPortalRoot.sirk-theme-dark,#sirkStandaloneRoot.sirk-theme-dark{--sirk-bg:#0b1220;--sirk-panel:#111827;--sirk-input:#0f172a;--sirk-text:#e7edf7;--sirk-muted:#94a3b8;--sirk-border:#2a374a;--sirk-active-bg:rgba(96,165,250,.18);--sirk-sidebar:#08111f;--sirk-sidebar-active:#1c2a40}",
            "html.sirk-theme-light,html.sirk-theme-light body{background:#f3f6fb;color:#172033}",
            "html.sirk-theme-dark,html.sirk-theme-dark body{background:#0b1220;color:#e7edf7}",
            "#sirkPortalRoot .sirk-nav-item.active,#sirkPortalRoot .sirk-nav-item.is-active{background:var(--sirk-active-bg,rgba(77,107,216,.14));box-shadow:inset 3px 0 0 var(--sirk-active-accent,#4d6bd8);font-weight:700}",
            "#sirkPortalRoot .sirk-settings-root-button.sirk-settings-root-active{background:var(--sirk-active-bg,rgba(77,107,216,.14))!important;color:var(--sirk-text,#172033)!important;box-shadow:inset 3px 0 0 var(--sirk-active-accent,#4d6bd8)!important;font-weight:700!important}",
            "#sirkPortalRoot.sirk-theme-dark,#sirkPortalRoot.sirk-theme-dark .sirk-standalone-root{background:var(--sirk-bg);color:var(--sirk-text)}"
        ].join("");
        (document.head || document.documentElement).appendChild(style);
    }

    function readDarkTheme() {
        try { return localStorage.getItem(THEME_STORAGE) === "dark"; }
        catch (error) {
            var portal = document.getElementById("sirkPortalRoot");
            return !!(portal && portal.classList.contains("sirk-theme-dark"));
        }
    }

    function applyTheme(doc, dark) {
        if (!doc) return;
        var nodes = [
            doc.documentElement,
            doc.body,
            doc.getElementById("sirkPortalRoot"),
            doc.getElementById("sirkStandaloneRoot")
        ];
        nodes.forEach(function (node) {
            if (!node) return;
            node.classList.toggle("sirk-theme-dark", dark);
            node.classList.toggle("sirk-theme-light", !dark);
            node.setAttribute("data-sirk-theme", dark ? "dark" : "light");
        });
        doc.documentElement.style.colorScheme = dark ? "dark" : "light";
    }

    function synchronizeTheme(forcedDark) {
        var dark = typeof forcedDark === "boolean" ? forcedDark : readDarkTheme();
        applyTheme(document, dark);
        Array.prototype.forEach.call(document.querySelectorAll('iframe[src*="sirkWorkspaceChild=1"]'), function (frame) {
            try {
                applyTheme(frame.contentDocument, dark);
                frame.contentWindow.dispatchEvent(new CustomEvent("sirkportal:themechange", { detail: { dark: dark } }));
            } catch (error) {}
        });
    }

    function scheduleTheme() {
        if (themeScheduled) return;
        themeScheduled = true;
        requestAnimationFrame(function () {
            themeScheduled = false;
            synchronizeTheme();
        });
    }

    injectThemeStyle();
    synchronizeTheme();

    document.addEventListener("click", function (event) {
        if (!event.target || !event.target.closest || !event.target.closest('[data-action="theme"]')) return;
        window.setTimeout(synchronizeTheme, 0);
    }, true);
    window.addEventListener("storage", function (event) {
        if (event.key === THEME_STORAGE) synchronizeTheme(event.newValue === "dark");
    });
    window.addEventListener("sirkportal:themechange", function (event) {
        var detail = event && event.detail;
        synchronizeTheme(detail && typeof detail.dark === "boolean" ? detail.dark : undefined);
    });

    var content = document.getElementById("sirkStandaloneContent") || document.documentElement;
    if (content) new MutationObserver(scheduleTheme).observe(content, { childList: true, subtree: true });

    if (!document.getElementById("sirk-latest-ui-controller")) {
        var source = String(window.__SIRK_PLATFORM_ASSET_BASE__ || "").replace(/\/$/, "") +
            "/vendor/sirk-portal/settings-structure.js?v=" +
            encodeURIComponent(String(window.__SIRK_PLATFORM_PORTAL_VERSION__ || ""));
        var script = document.createElement("script");
        script.id = "sirk-latest-ui-controller";
        script.src = source;
        script.async = false;
        (document.head || document.documentElement).appendChild(script);
    }
}());
