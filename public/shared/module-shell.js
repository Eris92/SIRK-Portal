(function () {
    "use strict";
    var core = window.SirkPlatformCore;
    var VIEW_MODES = {
        management: 101,
        commands: 102,
        jira: 103,
        security: 104,
        approvals: 105,
        "move-requests": 106
    };

    function buttonRow(host, items, selected, onSelect) {
        host.innerHTML = "";
        (items || []).forEach(function (item) {
            var button = document.createElement("button");
            button.type = "button";
            button.className = "sirk-nav-item";
            button.classList.toggle("active", String(item.key) === String(selected));
            button.textContent = (item.icon ? item.icon + " " : "") + (item.title || item.name || item.key) + (item.badge == null ? "" : " (" + item.badge + ")");
            button.onclick = function () { onSelect(item); };
            host.appendChild(button);
        });
    }

    function renderError(host, error) {
        host.innerHTML = "";
        var card = core.card("Error", error && error.message || String(error));
        card.classList.add("sirk-error");
        host.appendChild(card);
    }

    function renderJson(host, value) {
        host.innerHTML = "";
        var pre = document.createElement("pre");
        pre.className = "sirk-output";
        pre.textContent = JSON.stringify(value, null, 2);
        host.appendChild(pre);
    }

    function registerMenu(definition, open) {
        core.ensureMenu({
            mainId: "MainMenuSirkPlatform-" + definition.key,
            leftId: "LeftMenuSirkPlatform-" + definition.key,
            title: definition.menuTitle || definition.title,
            order: definition.order || 200,
            viewMode: definition.viewMode,
            icon: definition.menuIcon || "",
            open: open
        });
    }

    function createDeviceIntegration(definition, state, api, mountPage) {
        var options = definition.deviceTab || null;
        if (!options) return null;
        var pageId = options.pageId || ("sirk-platform-" + definition.key + "-device-page");
        var topTabId = options.topTabId || ("MainDevSirkPlatform-" + definition.key);
        var title = options.title || definition.title;

        function enabled() {
            if (options.enabled === false) return false;
            if (typeof options.enabled === "function" && options.enabled(state.bootstrap, api) === false) return false;
            return !(state.bootstrap && state.bootstrap.config && state.bootstrap.config.showOnDevice === false);
        }
        function registerPage() {
            if (!enabled()) return false;
            if (!window.pluginHandler || typeof window.pluginHandler.registerPluginTab !== "function") return false;
            window.pluginHandler.registerPluginTab({ tabId: pageId, tabTitle: title });
            return true;
        }
        function ensureTopTab() {
            if (!enabled() || !document.getElementById(pageId)) return false;
            var anchor = document.getElementById("MainDevTerminal") || document.getElementById("MainDevPlugins");
            if (!anchor || !anchor.parentNode) return false;
            var tab = document.getElementById(topTabId);
            if (!tab) {
                tab = document.createElement("td");
                tab.id = topTabId;
                tab.tabIndex = 0;
                tab.className = "topbar_td style3x";
                tab.textContent = title;
                tab.onmouseup = open;
                tab.onkeypress = function (event) { if (event && event.key === "Enter") return open(event); };
                anchor.parentNode.insertBefore(tab, anchor.nextSibling);
            }
            tab.style.display = "";
            return true;
        }
        function remove() {
            [topTabId, "p19ph-" + pageId, pageId].forEach(function (id) {
                var element = document.getElementById(id);
                if (element && element.parentNode) element.parentNode.removeChild(element);
            });
        }
        function mountDevicePage() {
            var host = document.getElementById(pageId);
            if (!host) return false;
            mountPage(host, "device");
            return true;
        }
        function open(event) {
            if (event && ((event.which === 3) || (event.button === 2))) return false;
            registerPage();
            if (typeof window.putstore === "function") window.putstore("_curPluginPage", pageId);
            if (typeof window.go === "function") window.go(19, event);
            window.setTimeout(function () {
                var header = document.getElementById("p19ph-" + pageId);
                if (header && window.pluginHandler && typeof window.pluginHandler.callPluginPage === "function") window.pluginHandler.callPluginPage(pageId, header);
                ensureTopTab();
                mountDevicePage();
                update(19);
            }, 0);
            if (event && event.preventDefault) event.preventDefault();
            return false;
        }
        function update(view) {
            var tab = document.getElementById(topTabId);
            if (!tab) return;
            if (view == null && typeof window.xxcurrentView !== "undefined") view = window.xxcurrentView;
            var activeHeader = document.querySelector("#p19headers span.on");
            var moduleHeader = document.getElementById("p19ph-" + pageId);
            var active = Number(view) === 19 && activeHeader === moduleHeader;
            tab.classList.remove("style3x", "style3sel");
            tab.classList.add(active ? "style3sel" : "style3x");
            var pluginTab = document.getElementById("MainDevPlugins");
            if (pluginTab && active) { pluginTab.classList.remove("style3sel"); pluginTab.classList.add("style3x"); }
            var headers = document.getElementById("p19headers");
            if (headers) headers.style.display = active ? "none" : "";
        }
        function sync() {
            if (!enabled()) { remove(); return false; }
            if (!registerPage()) return false;
            ensureTopTab();
            return true;
        }
        return {
            open: open,
            sync: sync,
            update: update,
            onDeviceRefreshEnd: function (nodeId) { state.nodeId = String(nodeId || ""); sync(); },
            onNativePageEnd: function (view) { sync(); update(view); }
        };
    }

    window.SirkPlatformModuleShell = {
        create: function (definition) {
            definition.viewMode = Number(definition.viewMode || VIEW_MODES[definition.key] || 960);
            var state = { page: null, pages: {}, tab: definition.defaultTab || "main", search: "", nodeId: "", bootstrap: null };

            function syncCollapseControl(page) {
                if (!page || !page.toolbar || !page.layout || !page.toolbar.buttons.collapse) return;
                var collapsed = page.layout.isCollapsed();
                var control = window.SharedToolbarConfig && window.SharedToolbarConfig.definitions.collapse || {};
                page.toolbar.setIcon("collapse", collapsed ? control.expandIcon : control.icon);
                page.toolbar.setTitle("collapse", collapsed ? "Expand" : "Collapse");
            }

            function mountPage(host, mode) {
                host.innerHTML = "";
                var page = window.SharedPage.mount({
                    container: host,
                    preset: definition.preset || definition.key,
                    buttons: definition.buttons || {},
                    customButtons: definition.customButtons || [],
                    tabs: definition.tabs || [{ key: "main", title: definition.title }],
                    activeTab: state.tab,
                    handlers: {
                        onCollapse: function () { page.layout.toggleCollapsed(); syncCollapseControl(page); },
                        onRefresh: function () { state.page = page; if (definition.onRefresh) definition.onRefresh(api); else api.render(); },
                        onClear: function () { state.page = page; state.search = ""; page.toolbar.clearSearch(false); if (definition.onClear) definition.onClear(api); else api.render(); },
                        onSearch: function (value) { state.page = page; state.search = value || ""; if (definition.onSearch) definition.onSearch(state.search, api); else api.render(); },
                        onManage: function () { state.page = page; if (definition.onManage) definition.onManage(api); },
                        onSettings: function () { state.page = page; state.tab = "settings"; page.tabs.select("settings", true); },
                        onLink: function () { try { navigator.clipboard.writeText(window.location.href); } catch (error) {} },
                        onFavorites: function () { state.page = page; if (definition.onFavorites) definition.onFavorites(api); }
                    },
                    onTab: function (key) { state.page = page; state.tab = key; api.render(); }
                });
                state.pages[mode] = page;
                state.page = page;
                syncCollapseControl(page);
                api.render();
                return page;
            }

            function updateUrl() {
                try {
                    var url = new URL(window.location.href);
                    url.searchParams.set("viewmode", String(definition.viewMode));
                    window.history.replaceState(null, "", url.href);
                } catch (error) {}
            }

            function open(event) {
                if (event && ((event.which === 3) || (event.button === 2))) return false;
                updateUrl();
                return core.showWorkspace(definition.title, definition.viewMode, function (host) { mountPage(host, "standalone"); });
            }

            function menuEnabled() {
                if (definition.showInMenu === false) return false;
                return !(state.bootstrap && state.bootstrap.config && state.bootstrap.config.showInMenu === false);
            }

            var api = {
                definition: definition,
                state: state,
                open: open,
                mount: function (host, mode) { return mountPage(host, mode || "embedded"); },
                render: function () {
                    if (!state.page) return;
                    state.page.layout.clear();
                    Promise.resolve(definition.render(api)).catch(function (error) { renderError(state.page.details, error); });
                },
                api: function (asset, parameters) { return core.api(definition.key, asset, null, parameters); },
                post: function (asset, values) { return core.post(definition.key, asset, values); },
                nav: function (host, items, selected, onSelect) { buttonRow(host, items, selected, onSelect); },
                json: renderJson,
                error: renderError,
                card: core.card,
                element: core.element
            };

            var device = createDeviceIntegration(definition, state, api, mountPage);
            return {
                initialize: function (bootstrapState) {
                    state.bootstrap = bootstrapState || null;
                    if (state.bootstrap && state.bootstrap.config) {
                        definition.menuIcon = state.bootstrap.config.leftMenuIconUrl || state.bootstrap.config.menuIcon || definition.menuIcon;
                    }
                    if (menuEnabled()) registerMenu(definition, open);
                    if (device) device.sync();
                    try {
                        var requested = Number(new URL(window.location.href).searchParams.get("viewmode"));
                        if (requested === definition.viewMode) window.setTimeout(function () { open(); }, 0);
                    } catch (error) {}
                    return Promise.resolve();
                },
                open: open,
                mount: function (host, mode) { return mountPage(host, mode || "embedded"); },
                render: api.render,
                api: api,
                onDeviceRefreshEnd: function (nodeId) { state.nodeId = String(nodeId || ""); if (device) device.onDeviceRefreshEnd(nodeId); },
                onNativePageStart: function () {},
                onNativePageEnd: function (view) { if (menuEnabled()) registerMenu(definition, open); if (device) device.onNativePageEnd(view); }
            };
        }
    };
}());
