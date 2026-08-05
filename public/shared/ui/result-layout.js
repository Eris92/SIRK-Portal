(function () {
    "use strict";

    if (window.__sirkPlatformResultLayoutInstalled) return;
    window.__sirkPlatformResultLayoutInstalled = true;

    function moveCopyBelowResult(host) {
        host.querySelectorAll(".sirk-results-inline-actions").forEach(function (actions) {
            var content = actions.nextElementSibling;
            if (!content || !content.classList.contains("sirk-results-inline-content")) return;
            var debug = content.querySelector(":scope > .sirk-results-debug");
            if (!debug) return;
            actions.classList.add("sirk-results-copy-after-output");
            actions.style.marginTop = "12px";
            actions.style.marginBottom = "0";
            content.insertBefore(actions, debug);
        });
    }

    function normalize(host) {
        moveCopyBelowResult(host || document);
    }

    var scheduled = false;
    function schedule() {
        if (scheduled) return;
        scheduled = true;
        window.requestAnimationFrame(function () {
            scheduled = false;
            normalize(document);
        });
    }

    new MutationObserver(schedule).observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    normalize(document);
}());
