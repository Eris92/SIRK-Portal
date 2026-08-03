(function () {
    "use strict";

    if (window.__sirkPlatformPortalCollapseIsolationLoaded) return;
    window.__sirkPlatformPortalCollapseIsolationLoaded = true;

    function bindShell(shell) {
        if (!shell || shell.__sirkPlatformCollapseIsolationBound) return;
        shell.__sirkPlatformCollapseIsolationBound = true;

        // The Management renderer already handles toolbar actions on this element.
        // This listener is registered afterwards, so it only stops the handled event
        // from bubbling into SirK Portal's global sidebar controls.
        shell.addEventListener("click", function (event) {
            var tool = event.target && event.target.closest && event.target.closest("[data-portal-management-tool]");
            if (!tool || !shell.contains(tool)) return;
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
        });
    }

    function bindExisting(root) {
        (root || document).querySelectorAll(".sirk-view-shell").forEach(bindShell);
    }

    function start() {
        var portal = document.getElementById("sirkPortalRoot");
        if (!portal) return false;
        bindExisting(portal);
        if (!portal.__sirkPlatformCollapseIsolationObserver) {
            portal.__sirkPlatformCollapseIsolationObserver = new MutationObserver(function (records) {
                records.forEach(function (record) {
                    Array.prototype.forEach.call(record.addedNodes || [], function (node) {
                        if (!node || node.nodeType !== 1) return;
                        if (node.matches && node.matches(".sirk-view-shell")) bindShell(node);
                        bindExisting(node);
                    });
                });
            });
            portal.__sirkPlatformCollapseIsolationObserver.observe(portal, { childList: true, subtree: true });
        }
        return true;
    }

    var attempts = 0;
    var timer = window.setInterval(function () {
        attempts++;
        if (start() || attempts > 120) window.clearInterval(timer);
    }, 100);
}());