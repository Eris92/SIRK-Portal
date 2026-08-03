(function () {
    "use strict";

    function storageKey(options) {
        if (options.layoutStorageKey) return String(options.layoutStorageKey);
        return "sirkPortal.layout." + String(options.preset || "standard").toLowerCase() + ".collapsed";
    }

    window.SharedPage = {
        mount: function (options) {
            options = options || {};
            var host = typeof options.container === "string" ? document.querySelector(options.container) : options.container;
            if (!host) throw new Error("View container not found.");
            host.innerHTML = "";
            host.className = "sirk-view-shell";
            host.setAttribute("data-sirk-view-shell", String(options.view || options.preset || "standard"));
            host.setAttribute("data-frontend", "sirkportal");

            var tabsHost = document.createElement("div");
            tabsHost.className = "sirk-tabs-host";
            var toolbarHost = document.createElement("div");
            toolbarHost.className = "sirk-toolbar-host";
            var layoutHost = document.createElement("div");
            layoutHost.className = "sirk-layout-host";
            host.appendChild(tabsHost);
            host.appendChild(toolbarHost);
            host.appendChild(layoutHost);

            var layout = window.SharedLayout.mount({ container: layoutHost, storageKey: storageKey(options) });
            var toolbar = window.SharedToolbar.mount({
                container: toolbarHost,
                preset: options.preset || "standard",
                buttons: options.buttons || {},
                handlers: options.handlers || {},
                customButtons: options.customButtons || []
            });
            var tabs = window.SharedTabs.mount({
                container: tabsHost,
                tabs: options.tabs || [],
                active: options.activeTab,
                onSelect: options.onTab
            });
            return {
                root: host,
                tabs: tabs,
                toolbar: toolbar,
                layout: layout,
                primary: layout.primary,
                secondary: layout.secondary,
                details: layout.details,
                frontend: "sirkportal"
            };
        }
    };
}());
