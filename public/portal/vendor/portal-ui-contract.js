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

    if (!window.__sirkHiddenRendererGuard) {
        window.__sirkHiddenRendererGuard = true;
        document.addEventListener("click", function (event) {
            var button = event.target && event.target.closest && event.target.closest(".sirk-latest-hide.sirk-nav-item");
            if (!button || event.isTrusted || (!button.classList.contains("active") && !button.classList.contains("is-active"))) return;
            event.preventDefault();
            event.stopImmediatePropagation();
        }, true);
    }

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
