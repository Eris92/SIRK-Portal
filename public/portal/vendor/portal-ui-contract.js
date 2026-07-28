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
}());
