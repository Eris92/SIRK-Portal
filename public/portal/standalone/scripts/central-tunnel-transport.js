(function () {
    "use strict";

    var match = String(window.location.pathname || "")
        .match(/^\/connect\/[^/]+(?=\/|$)/);
    if (!match) return;

    var core = window.SirkPlatformCore;
    if (!core || typeof core.portalUrl !== "function" ||
        core.__sirkCentralTunnelTransportWrapped === true) return;

    var prefix = match[0];
    var originalPortalUrl = core.portalUrl.bind(core);

    core.portalUrl = function (value) {
        var text = String(value == null ? "" : value);
        if (/^\/connect\/[^/]+(?:\/|$)/.test(text)) return text;
        if (text.charAt(0) === "/") return prefix + text;
        return originalPortalUrl(value);
    };

    core.__sirkCentralTunnelTransportWrapped = true;
    window.__SIRK_PLATFORM_TUNNEL_PREFIX__ = prefix;
}());
