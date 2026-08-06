(function () {
    "use strict";

    if (document.getElementById("sirk-device-tab-selection-state-style")) return;

    var style = document.createElement("style");
    style.id = "sirk-device-tab-selection-state-style";
    style.textContent = [
        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-tab-all{border-color:transparent!important;background:transparent!important;color:var(--sirk-muted,#657187)!important;box-shadow:none!important}",
        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-tab-all.is-active{border-color:#60a5fa!important;background:#dbeafe!important;color:#1d4ed8!important;box-shadow:inset 0 -3px 0 #2563eb,0 0 0 1px rgba(37,99,235,.10)!important}",
        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-host-tab.is-active{border-color:#60a5fa!important;background:#dbeafe!important;color:#1e3a8a!important}",
        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-host-tab.is-online.is-active{box-shadow:inset 3px 0 0 #16a34a,inset 0 -3px 0 #2563eb,inset 0 0 0 1px rgba(37,99,235,.12)!important}",
        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-host-tab.is-offline.is-active{box-shadow:inset 3px 0 0 #dc2626,inset 0 -3px 0 #2563eb,inset 0 0 0 1px rgba(37,99,235,.12)!important}",
        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-host-tab.is-active .sirk-device-tab-main{color:inherit!important}",
        "#sirkPortalRoot.sirk-theme-dark .sirk-device-tabs-standalone .sirk-device-tab-all{background:transparent!important;color:#94a3b8!important}",
        "#sirkPortalRoot.sirk-theme-dark .sirk-device-tabs-standalone .sirk-device-tab-all.is-active{border-color:#60a5fa!important;background:#1d3557!important;color:#bfdbfe!important;box-shadow:inset 0 -3px 0 #60a5fa,0 0 0 1px rgba(96,165,250,.14)!important}",
        "#sirkPortalRoot.sirk-theme-dark .sirk-device-tabs-standalone .sirk-device-host-tab.is-active{border-color:#60a5fa!important;background:#1d3557!important;color:#eff6ff!important}",
        "#sirkPortalRoot.sirk-theme-dark .sirk-device-tabs-standalone .sirk-device-host-tab.is-online.is-active{box-shadow:inset 3px 0 0 #22c55e,inset 0 -3px 0 #60a5fa,inset 0 0 0 1px rgba(96,165,250,.14)!important}",
        "#sirkPortalRoot.sirk-theme-dark .sirk-device-tabs-standalone .sirk-device-host-tab.is-offline.is-active{box-shadow:inset 3px 0 0 #ef4444,inset 0 -3px 0 #60a5fa,inset 0 0 0 1px rgba(96,165,250,.14)!important}"
    ].join("");

    (document.head || document.documentElement).appendChild(style);
}());
