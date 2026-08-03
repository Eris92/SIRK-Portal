(function () {
    "use strict";

    if (window.__sirkPlatformPortalIconDataLoaded) return;
    window.__sirkPlatformPortalIconDataLoaded = true;

    var core = window.SirkPlatformCore;
    if (!core || typeof core.api !== "function" || typeof core.post !== "function") return;

    function safeIconSource(value) {
        value = String(value || "").trim();
        if (!value) return "";
        if (/^data:image\/(?:svg\+xml|png|gif|jpeg|webp);/i.test(value)) return value;
        if (/^(?:https?:\/\/|\/|\.\/|\.\.\/|pluginadmin\.ashx)/i.test(value)) return value;
        return "";
    }

    function escapeAttribute(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    function normalizeNode(node) {
        if (!node || typeof node !== "object") return node;

        var source = safeIconSource(node.iconData);
        if (source) {
            node.icon = '<img class="sirk-management-folder-image" alt="" src="' + escapeAttribute(source) + '">';
        } else if (/\.svg(?:\?.*)?$/i.test(String(node.icon || "")) || /[\\/]/.test(String(node.icon || ""))) {
            node.icon = "";
        }

        (node.children || []).forEach(normalizeNode);
        return node;
    }

    function normalizeResponse(value) {
        if (!value || typeof value !== "object") return value;
        if (value.tree) normalizeNode(value.tree);
        if (value.script) normalizeNode(value.script);
        return value;
    }

    var originalApi = core.api;
    core.api = function (moduleName, assetName, options, parameters) {
        return originalApi.call(core, moduleName, assetName, options, parameters).then(function (response) {
            if (moduleName === "management") normalizeResponse(response);
            return response;
        });
    };

    var originalPost = core.post;
    core.post = function (moduleName, assetName, values) {
        return originalPost.call(core, moduleName, assetName, values).then(function (response) {
            if (moduleName === "management") normalizeResponse(response);
            return response;
        });
    };
}());