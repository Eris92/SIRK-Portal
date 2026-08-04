from pathlib import Path

bundler_path = Path("src/Sirk.Portal/Ui/PortalAssetBundler.cs")
bundler = bundler_path.read_text(encoding="utf-8")
old_devices = '''        new(
            "portal-devices.bundle.js",
            [
                "modules/commands/index.js",
                "portal/standalone/scripts/device-workspace.js",
                "portal/standalone/scripts/device-tabs.js",
                "portal/standalone/scripts/terminal-connect.js"
            ]),'''
new_devices = '''        new(
            "portal-devices.bundle.js",
            [
                "portal/standalone/scripts/device-workspace.js",
                "portal/standalone/scripts/device-tabs.js",
                "portal/standalone/scripts/terminal-connect.js"
            ]),'''
if old_devices not in bundler:
    raise SystemExit("Portal devices bundle definition was not found.")
bundler_path.write_text(bundler.replace(old_devices, new_devices, 1), encoding="utf-8")

app_path = Path("public/portal/standalone/scripts/app.js")
app = app_path.read_text(encoding="utf-8")
old_loader = '''    function loadBundle(name) {
        if (!name) return Promise.resolve();
        if (!bundlePromises[name]) {
            bundlePromises[name] = load(
                "sirk-portal-bundle-" + name,
                "bundles/portal-" + name + ".bundle.js");
        }
        return bundlePromises[name];
    }
    function ensureViewBundle(view) { return loadBundle(VIEW_BUNDLES[view]); }'''
new_loader = '''    function loadBundle(name) {
        if (!name) return Promise.resolve();
        if (!bundlePromises[name]) {
            bundlePromises[name] = load(
                "sirk-portal-bundle-" + name,
                "bundles/portal-" + name + ".bundle.js");
        }
        return bundlePromises[name];
    }
    window.SirkPortalBundles = window.SirkPortalBundles || {};
    window.SirkPortalBundles.load = loadBundle;
    function ensureViewBundle(view) { return loadBundle(VIEW_BUNDLES[view]); }'''
if old_loader not in app:
    raise SystemExit("Portal bundle loader marker was not found.")
app_path.write_text(app.replace(old_loader, new_loader, 1), encoding="utf-8")

workspace_path = Path("public/portal/standalone/scripts/device-workspace.js")
workspace = workspace_path.read_text(encoding="utf-8")
old_commands = '''    function renderCommandsTab(host, node) {
        var module = commandModule();
        if (!module || typeof module.mount !== "function") {
            host.innerHTML = '<div class="sirk-device-command-error">' + esc(t("noCommands")) + '</div>';
            return;
        }
        host.innerHTML = '<div class="sirk-device-commands-host"></div>';
        var moduleHost = host.firstElementChild;
        if (typeof module.mountDeviceCommands === "function") module.mountDeviceCommands(moduleHost, String(node.id || node._id || ""));
        else {
            if (typeof module.onDeviceRefreshEnd === "function") module.onDeviceRefreshEnd(String(node.id || node._id || ""));
            module.mount(moduleHost, "sirk-device-commands");
        }
    }'''
new_commands = '''    function renderCommandsTab(host, node) {
        var module = commandModule();
        if (!module || typeof module.mount !== "function") {
            host.innerHTML = '<div class="sirk-device-command-loading">' + esc(t("loadingCommands")) + '</div>';
            var loader = window.SirkPortalBundles && window.SirkPortalBundles.load;
            if (typeof loader !== "function") {
                host.innerHTML = '<div class="sirk-device-command-error">' + esc(t("noCommands")) + '</div>';
                return;
            }
            Promise.resolve(loader("modules")).then(function () {
                if (!host.isConnected || activeTab !== "commands") return;
                var loaded = commandModule();
                if (!loaded || typeof loaded.mount !== "function") throw new Error(t("noCommands"));
                renderCommandsTab(host, node);
            }).catch(function (error) {
                if (!host.isConnected) return;
                host.innerHTML = '<div class="sirk-device-command-error">' + esc(error && error.message || t("noCommands")) + '</div>';
            });
            return;
        }
        host.innerHTML = '<div class="sirk-device-commands-host"></div>';
        var moduleHost = host.firstElementChild;
        if (typeof module.mountDeviceCommands === "function") module.mountDeviceCommands(moduleHost, String(node.id || node._id || ""));
        else {
            if (typeof module.onDeviceRefreshEnd === "function") module.onDeviceRefreshEnd(String(node.id || node._id || ""));
            module.mount(moduleHost, "sirk-device-commands");
        }
    }'''
if old_commands not in workspace:
    raise SystemExit("Device commands renderer marker was not found.")
workspace = workspace.replace(old_commands, new_commands, 1)

operation_marker = '''    function agentOperationUrl(action, parameters) {
        var endpoint = new URL("/api/agent-operations", window.location.href);
        Object.keys(parameters || {}).forEach(function (key) {
            endpoint.searchParams.set(key, parameters[key]);
        });
        return endpoint.href;
    }
'''
websocket_helper = operation_marker + '''
    function portalWebSocketUrl(pathAndQuery) {
        var rewritten = core && typeof core.portalUrl === "function"
            ? core.portalUrl(pathAndQuery)
            : new URL(pathAndQuery, window.location.href).href;
        var endpoint = new URL(rewritten, window.location.href);
        endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
        return endpoint.href;
    }
'''
if operation_marker not in workspace:
    raise SystemExit("Agent operation URL marker was not found.")
workspace = workspace.replace(operation_marker, websocket_helper, 1)

old_socket = '''            var scheme = location.protocol === "https:" ? "wss:" : "ws:";
            var identityQuery = "tenantId=" + encodeURIComponent(node.tenantId) +
                "&deviceId=" + encodeURIComponent(node.deviceId);
            var url = scheme + "//" + location.host + "/api/agent-desktop/stream?" + identityQuery +
                "&after=" + encodeURIComponent(snapshot.sequence || 0);
            var socket = new WebSocket(url);
            desktopSocket = socket;
            var inputSocket = new WebSocket(scheme + "//" + location.host +
                "/api/agent-desktop/input-stream?" + identityQuery);'''
new_socket = '''            var identityQuery = "tenantId=" + encodeURIComponent(node.tenantId) +
                "&deviceId=" + encodeURIComponent(node.deviceId);
            var url = portalWebSocketUrl("/api/agent-desktop/stream?" + identityQuery +
                "&after=" + encodeURIComponent(snapshot.sequence || 0));
            var socket = new WebSocket(url);
            desktopSocket = socket;
            var inputSocket = new WebSocket(portalWebSocketUrl(
                "/api/agent-desktop/input-stream?" + identityQuery));'''
if old_socket not in workspace:
    raise SystemExit("Desktop WebSocket marker was not found.")
workspace_path.write_text(workspace.replace(old_socket, new_socket, 1), encoding="utf-8")
