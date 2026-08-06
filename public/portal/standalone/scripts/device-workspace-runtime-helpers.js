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
}());
