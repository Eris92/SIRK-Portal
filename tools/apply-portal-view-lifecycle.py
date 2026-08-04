from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    value = file.read_text(encoding="utf-8")
    count = value.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}")
    file.write_text(value.replace(old, new, 1), encoding="utf-8", newline="\n")


# Dispose the currently mounted view before switching to another one.
replace_once(
    "public/portal/standalone/scripts/app.js",
    '''    function render(view) {
        view = VIEW_KEYS.indexOf(view) >= 0 && viewEnabled(view) ? view : firstEnabledView();
''',
    '''    function disposeView(view) {
        var module;
        if (view === "management") {
            if (window.SirkPlatformPortalManagement && typeof window.SirkPlatformPortalManagement.unmount === "function") {
                window.SirkPlatformPortalManagement.unmount();
            }
            return;
        }
        if (view === "settings") {
            if (window.SirkPortalSettings && typeof window.SirkPortalSettings.unmount === "function") {
                window.SirkPortalSettings.unmount();
            }
            return;
        }
        if (view === "approvals") {
            module = window.SirkPlatformModules && window.SirkPlatformModules.approvals;
            if (module && typeof module.unmount === "function") module.unmount("sirk-standalone-approval");
            return;
        }
        if (moduleViews[view]) {
            module = window.SirkPlatformModules && window.SirkPlatformModules[moduleViews[view]];
            if (module && typeof module.unmount === "function") module.unmount("sirk-standalone-" + view);
        }
    }

    function render(view) {
        disposeView(activeView);
        view = VIEW_KEYS.indexOf(view) >= 0 && viewEnabled(view) ? view : firstEnabledView();
''')

# Add explicit page disposal to the shared module shell.
replace_once(
    "public/shared/module-shell.js",
    '''            function mountPage(host, mode) {
                host.innerHTML = "";
''',
    '''            function disposePage(mode) {
                var page = state.pages[mode];
                if (!page) return;
                if (page.root) {
                    page.root.replaceChildren();
                    page.root.removeAttribute("data-sirk-view-shell");
                    page.root.removeAttribute("data-frontend");
                }
                delete state.pages[mode];
                if (state.page === page) state.page = null;
            }

            function mountPage(host, mode) {
                disposePage(mode);
                host.innerHTML = "";
''')
replace_once(
    "public/shared/module-shell.js",
    '''                mount: function (host, mode) { return mountPage(host, mode || "embedded"); },
                render: api.render,
''',
    '''                mount: function (host, mode) { return mountPage(host, mode || "embedded"); },
                unmount: function (mode) { disposePage(mode || "embedded"); },
                render: api.render,
''')

# Settings: invalidate asynchronous work and clear all retained snapshots/DOM.
replace_once(
    "public/portal/standalone/scripts/settings-native-v2.js",
    '''        csrf: "",
        host: null,
        page: null
''',
    '''        csrf: "",
        host: null,
        page: null,
        mountGeneration: 0
''')
replace_once(
    "public/portal/standalone/scripts/settings-native-v2.js",
    '''    function mount(host) {
        clear(host);
''',
    '''    function unmount() {
        state.mountGeneration += 1;
        if (state.host) clear(state.host);
        state.host = null;
        state.page = null;
        state.settings = null;
        state.identity = null;
        state.runtime = null;
        state.maintenance = null;
        state.central = null;
        state.computerGroups = null;
        state.issuedEnrollment = null;
        state.issuedAccessCode = null;
        state.csrf = "";
    }

    function mount(host) {
        unmount();
        var generation = ++state.mountGeneration;
        clear(host);
''')
replace_once(
    "public/portal/standalone/scripts/settings-native-v2.js",
    '''        load().then(renderAll).catch(function (error) {
            clear(details);
            details.appendChild(card("Błąd", error.message));
        });
    }

    window.SirkPortalSettings = { mount: mount };
''',
    '''        load().then(function () {
            if (generation !== state.mountGeneration || state.host !== host || !host.isConnected) return;
            renderAll();
        }).catch(function (error) {
            if (generation !== state.mountGeneration || state.host !== host || !host.isConnected) return;
            clear(details);
            details.appendChild(card("Błąd", error.message));
        });
    }

    window.SirkPortalSettings = { mount: mount, unmount: unmount };
''')

# Management: clear retained tree/results/host and ignore stale API completion.
replace_once(
    "public/portal/management.js",
    '''        editMode: false,
        host: null,
        output: Object.create(null)
''',
    '''        editMode: false,
        host: null,
        output: Object.create(null),
        mountGeneration: 0
''')
replace_once(
    "public/portal/management.js",
    '''    function mount(host) {
        state.host = host;
        return api("tree").then(function (response) {
            state.tree = response.tree;
''',
    '''    function unmount() {
        state.mountGeneration += 1;
        if (state.host) state.host.replaceChildren();
        state.host = null;
        state.tree = null;
        state.root = "";
        state.script = "";
        state.search = "";
        state.results = false;
        state.status = "";
        state.output = Object.create(null);
    }

    function mount(host) {
        unmount();
        var generation = ++state.mountGeneration;
        state.host = host;
        return api("tree").then(function (response) {
            if (generation !== state.mountGeneration || state.host !== host || !host.isConnected) return;
            state.tree = response.tree;
''')
replace_once(
    "public/portal/management.js",
    '''        }).catch(function (error) {
            host.innerHTML = "";
            host.appendChild(el("div", "sirk-card sirk-error", error.message || String(error)));
        });
    }

    window.SirkPlatformPortalManagement = {
        mount: mount,
''',
    '''        }).catch(function (error) {
            if (generation !== state.mountGeneration || state.host !== host || !host.isConnected) return;
            host.innerHTML = "";
            host.appendChild(el("div", "sirk-card sirk-error", error.message || String(error)));
        });
    }

    window.SirkPlatformPortalManagement = {
        mount: mount,
        unmount: unmount,
''')

# The Agent installer only needs child-list changes inside the Portal content.
replace_once(
    "public/portal/standalone/scripts/agent-installer-ui.js",
    '''    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
''',
    '''    var observerRoot = document.getElementById("sirkStandaloneContent") || document.body;
    if (observerRoot) observer.observe(observerRoot, { childList: true, subtree: true });
''')

print("Portal view lifecycle cleanup applied.")
