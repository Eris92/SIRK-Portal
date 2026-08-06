(function () {
    "use strict";

    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    if (typeof window.detailItem !== "function") {
        window.detailItem = function (label, value) {
            var safeLabel = escapeHtml(label);
            var safeValue = escapeHtml(value == null || value === "" ? "—" : value);
            return '<div class="sirk-device-detail-item">' +
                '<span>' + safeLabel + '</span>' +
                '<strong title="' + safeValue + '">' + safeValue + '</strong>' +
                '</div>';
        };
    }

    var core = window.SirkPlatformCore;
    if (!core || typeof core.portalUrl !== "function" ||
        core.__sirkDesktopTransportWrapped === true) return;

    var pathname = String(window.location.pathname || "");
    var tunnelMatch = pathname.match(/^\/connect\/[^/]+(?=\/|$)/);
    var hostname = String(window.location.hostname || "").toLowerCase();
    var localHttpFallback = !tunnelMatch &&
        (hostname === "localhost" || hostname === "127.0.0.1" ||
         hostname === "::1" || /(?:^|\.)[^.]+\.local$/.test(hostname));

    var originalPortalUrl = core.portalUrl.bind(core);
    var tunnelPrefix = tunnelMatch ? tunnelMatch[0] : "";

    core.portalUrl = function (value) {
        var text = String(value == null ? "" : value);

        if (tunnelPrefix) {
            if (/^\/connect\/[^/]+(?:\/|$)/.test(text)) return text;
            if (text.charAt(0) === "/") return tunnelPrefix + text;
            return originalPortalUrl(value);
        }

        // The local .local/localhost environment may not support the viewer
        // WebSocket endpoint yet. Return a synthetic tunnel-shaped path only
        // for transport detection; frame and input requests still use their
        // normal local HTTP endpoints. This prevents an infinite reconnect loop
        // while preserving the complete desktop data path for local testing.
        if (localHttpFallback && text === "/api/v1/desktop/stream")
            return "/connect/__local-http-desktop__/api/v1/desktop/stream";

        return originalPortalUrl(value);
    };

    core.__sirkDesktopTransportWrapped = true;
    core.__sirkCentralTunnelTransportWrapped = Boolean(tunnelPrefix);
    core.__sirkLocalHttpDesktopFallback = localHttpFallback;

    if (tunnelPrefix)
        window.__SIRK_PLATFORM_TUNNEL_PREFIX__ = tunnelPrefix;
    if (localHttpFallback)
        window.__SIRK_PLATFORM_LOCAL_HTTP_DESKTOP__ = true;
}());
