(function () {
    "use strict";

    if (window.SirkIcons) return;

    function base() {
        var assetBase = String(window.__SIRK_PLATFORM_ASSET_BASE__ || "").replace(/\/$/, "");
        var version = encodeURIComponent(String(window.__SIRK_PLATFORM_PORTAL_VERSION__ || ""));
        return assetBase ? assetBase + "/icons/sirk-ui.svg" + (version ? "?v=" + version : "") : "";
    }

    function href(name) {
        return base() + "#" + encodeURIComponent(String(name || ""));
    }

    function svg(name, className, title) {
        var safeClass = String(className || "").replace(/[^a-z0-9_-]/gi, " ").trim();
        var safeTitle = String(title || "").replace(/[&<>\"]/g, function (value) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[value];
        });
        return '<svg class="' + safeClass + '" viewBox="0 0 24 24" aria-hidden="' + (safeTitle ? "false" : "true") + '">' +
            (safeTitle ? "<title>" + safeTitle + "</title>" : "") +
            '<use href="' + href(name) + '"></use></svg>';
    }

    function element(name, className, title) {
        var wrapper = document.createElement("span");
        wrapper.innerHTML = svg(name, className, title);
        return wrapper.firstElementChild;
    }

    window.SirkIcons = {
        href: href,
        svg: svg,
        element: element
    };
}());