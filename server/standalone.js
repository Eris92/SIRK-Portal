"use strict";

var crypto = require("crypto");
var fs = require("fs");
var http = require("http");
var path = require("path");
var WebSocket = require("ws");
var adapter = require("./adapters/standalone/index.js");
var agentGatewayFactory = require("./core/agent-gateway.js");
var agentCommandBrokerFactory = require("./core/agent-command-broker.js");
var agentDesktopRelayFactory = require("./core/agent-desktop-relay.js");
var agentGroupFactory = require("./core/agent-group-service.js");
var agentPolicyFactory = require("./core/agent-policy-service.js");
var centralTunnelFactory = require("./core/central-tunnel-client.js");
var apiFactory = require("./http/api-router.js");
var identityFactory = require("./core/identity-store.js");
var maintenance = require("./core/portal-maintenance.js");
var runtimeFactory = require("./standalone-runtime.js");
var updateManagerFactory = require("./system-update-manager.js");
var updateRouterFactory = require("./http/update-router.js");
var VERSION = require("../config.json").version;
var ROOT = path.resolve(__dirname, "..");
var CONFIG_PATH = path.join(ROOT, "config.json");

var ASSETS = {
    "icons/sirk-ui.svg": "assets/icons/sirk-ui.svg",
    "standalone-core.js": "public/portal/standalone/scripts/core.js",
    "portal-standalone.js": "public/portal/standalone/scripts/app.js",
    "portal-standalone-nav.js": "public/portal/standalone/scripts/navigation.js",
    "portal-device-workspace.js": "public/portal/standalone/scripts/device-workspace.js",
    "portal-device-tabs.js": "public/portal/standalone/scripts/device-tabs.js",
    "portal-view-mode.js": "public/portal/standalone/scripts/view-mode.js",
    "portal-cleanup.js": "public/portal/standalone/scripts/cleanup.js",
    "portal-terminal-connect.js": "public/portal/standalone/scripts/terminal-connect.js",
    "portal-branding.js": "public/portal/standalone/scripts/branding.js",
    "portal-branding.json": "public/portal/standalone/branding.json",
    "portal-login.js": "public/portal/standalone/scripts/login.js",
    "portal-login.css": "public/portal/standalone/styles/login.css",
    "portal-standalone.css": "public/portal/standalone/styles/base.css",
    "portal.css": "public/portal/portal.css",
    "settings.css": "public/portal/settings.css",
    "portal-standalone-devices.css": "public/portal/standalone/styles/devices.css",
    "portal-device-workspace.css": "public/portal/standalone/styles/device-workspace.css",
    "portal-device-tabs.css": "public/portal/standalone/styles/device-tabs.css",
    "portal-module-shell.css": "public/portal/standalone/styles/module-shell.css",
    "portal-management-frame.css": "public/portal/standalone/styles/management-frame.css",
    "portal-cleanup.css": "public/portal/standalone/styles/cleanup.css",
    "system-updates.js": "public/portal/system-updates.js",
    "system-updates.css": "public/portal/system-updates.css",
    "settings.js": "public/portal/settings.js",
    "main.css": "public/shared/styles/main.css",
    "shared/icon-registry.js": "public/shared/icon-registry.js",
    "myscripts.css": "public/modules/automation/style.css",
    "shared-ui/shared-ui.css": "public/shared/ui/shared-ui.css",
    "shared-ui/toolbar.css": "public/shared/ui/toolbar.css",
    "module-shell.js": "public/shared/module-shell.js",
    "portal-icon-data.js": "public/portal/icons.js",
    "approvalcenter.js": "public/modules/approvals/index.js",
    "moverequests.js": "public/modules/move-requests/index.js",
    "mycommands.js": "public/modules/commands/index.js",
    "myjira.js": "public/modules/jira/index.js",
    "defendertools.js": "public/modules/security/index.js",
    "portal-management.js": "public/portal/management.js",
    "portal-subfolder-icons.js": "public/portal/subfolder-icons.js",
    "portal-folder-collapse.js": "public/portal/folder-collapse.js",
    "vendor/sirk-portal/sirk-portal.css": "public/portal/vendor/sirk-portal.css",
    "vendor/sirk-portal/portal-ui-contract.css": "public/portal/vendor/portal-ui-contract.css",
    "vendor/sirk-portal/portal-ui-contract.js": "public/portal/vendor/portal-ui-contract.js",
    "vendor/sirk-portal/settings-structure.js": "public/portal/vendor/settings-structure.js"
};

[
    "toolbar-config.js", "toolbar-api.js", "toolbar.js", "tabs.js", "layout.js",
    "settings.js", "status-nav.js", "page.js", "tree.js", "catalog.js",
    "results.js", "result-layout.js", "script-tools.js", "script-definition-form.js",
    "confirm-execution-form.js", "script-edit-actions.js", "system-credentials-form.js"
].forEach(function (name) {
    ASSETS["shared-ui/" + name] = "public/shared/ui/" + name;
});

function noStore(res) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
}

function contentType(name) {
    if (/\.css$/i.test(name)) return "text/css; charset=utf-8";
    if (/\.js$/i.test(name)) return "text/javascript; charset=utf-8";
    if (/\.json$/i.test(name)) return "application/json; charset=utf-8";
    if (/\.svg$/i.test(name)) return "image/svg+xml";
    if (/\.png$/i.test(name)) return "image/png";
    return "application/octet-stream";
}

function version() {
    try { return String(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")).version || VERSION); }
    catch (error) { return VERSION; }
}

function build() {
    var current = version();
    var modified = 0;
    [CONFIG_PATH, path.join(ROOT, "public/portal/standalone/index.html"),
        path.join(ROOT, "public/portal/standalone/login.html")]
        .concat(Object.keys(ASSETS).map(function (name) { return path.resolve(ROOT, ASSETS[name]); }))
        .forEach(function (filePath) {
            try { modified = Math.max(modified, fs.statSync(filePath).mtimeMs || 0); } catch (error) {}
        });
    return { version: current, revision: current + "-" + String(Math.floor(modified)) };
}

function portalHtml() {
    var current = build();
    var html = fs.readFileSync(path.join(ROOT, "public/portal/standalone/index.html"), "utf8")
        .replace(/__API_BASE_JSON__/g, JSON.stringify("/api"))
        .replace(/__ASSET_BASE_JSON__/g, JSON.stringify("/assets"))
        .replace(/__LOGOUT_URL_JSON__/g, JSON.stringify("/auth/logout"))
        .replace(/__USER_IMAGE_URL_JSON__/g, JSON.stringify("/assets/icons/sirk-ui.svg"))
        .replace(/__DEFAULT_USER_IMAGE_URL_JSON__/g, JSON.stringify("/assets/icons/sirk-ui.svg"))
        .replace(/__VERSION_JSON__/g, JSON.stringify(current.version))
        .replace(/__ASSET_BASE__/g, "/assets")
        .replace(/__VERSION__/g, current.revision);
    html = html.replace("</head>",
        '<link rel="stylesheet" href="/assets/portal-management-frame.css?v=' + current.revision + '">' +
        '<link rel="stylesheet" href="/assets/system-updates.css?v=' + current.revision + '"></head>');
    return html.replace("</body>",
        '<script src="/assets/system-updates.js?v=' + current.revision + '"></script></body>');
}

function loginHtml() {
    var current = build();
    return fs.readFileSync(path.join(ROOT, "public/portal/standalone/login.html"), "utf8")
        .replace(/__ASSET_BASE_JSON__/g, JSON.stringify("/assets"))
        .replace(/__PORTAL_URL_JSON__/g, JSON.stringify("/"))
        .replace(/__ASSET_BASE__/g, "/assets")
        .replace(/__VERSION_JSON__/g, JSON.stringify(current.version))
        .replace(/__VERSION__/g, current.revision);
}

function json(res, status, value) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(value));
}

function form(req, maximum) {
    return new Promise(function (resolve, reject) {
        var chunks = [], length = 0;
        req.on("data", function (chunk) {
            length += chunk.length;
            if (length > maximum) {
                reject(new Error("Request body is too large."));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", function () { resolve(new URLSearchParams(Buffer.concat(chunks).toString("utf8"))); });
        req.on("error", reject);
    });
}

function start(options) {
    options = options || {};
    var dataRoot = path.resolve(options.dataRoot || process.env.SIRK_DATA_ROOT ||
        path.join(path.dirname(ROOT), "sirk-platform-data"));
    var identity = identityFactory.create({
        dataRoot: dataRoot,
        initialUsername: options.initialUsername || process.env.SIRK_LOGIN_USER || "admin",
        initialPassword: options.initialPassword || process.env.SIRK_LOGIN_PASSWORD || "",
        initialDisplayName: options.initialDisplayName || process.env.SIRK_LOGIN_DISPLAY_NAME || "Administrator"
    });
    var sessions = new Map();
    var failures = new Map();

    function cookie(req) {
        var match = String(req && req.headers && req.headers.cookie || "").match(/(?:^|;\s*)sirk_session=([^;]+)/);
        return match ? decodeURIComponent(match[1]) : "";
    }

    function sessionUser(req) {
        var token = cookie(req);
        var session = token && sessions.get(token);
        var user = session && identity.resolveSessionUser(session.userId, session.sessionVersion);
        if (!user) {
            if (token) sessions.delete(token);
            return Promise.reject(new Error("Authentication required."));
        }
        user.isAdmin = user.roles.indexOf("admin") >= 0;
        user.siteadmin = user.isAdmin;
        user._id = user.id;
        user.name = user.username;
        user.realname = user.displayName;
        user.csrfToken = session.csrfToken;
        return Promise.resolve(user);
    }

    function requireSameOrigin(req) {
        var origin = String(req.headers.origin || "");
        if (!origin) return true;
        var forwardedHost = String(req.headers["x-forwarded-host"] || req.headers.host || "");
        var protocol = String(req.headers["x-forwarded-proto"] || "http");
        return origin === protocol + "://" + forwardedHost;
    }

    function login(req, res) {
        var address = String(req.socket && req.socket.remoteAddress || "unknown");
        var attempt = failures.get(address) || { count: 0, blockedUntil: 0 };
        if (attempt.blockedUntil > Date.now()) {
            json(res, 429, { ok: false, error: "Zbyt wiele prób. Spróbuj ponownie później." });
            return;
        }
        form(req, 8192).then(function (values) {
            var user = identity.authenticate(values.get("username"), values.get("password"));
            if (!user) {
                attempt.count += 1;
                if (attempt.count >= 5) {
                    attempt.count = 0;
                    attempt.blockedUntil = Date.now() + 60000;
                }
                failures.set(address, attempt);
                json(res, 401, { ok: false, error: "Nieprawidłowa nazwa użytkownika lub hasło." });
                return;
            }
            failures.delete(address);
            var token = crypto.randomBytes(32).toString("hex");
            sessions.set(token, {
                userId: user.id,
                sessionVersion: identity.sessionVersion(user.id),
                csrfToken: crypto.randomBytes(24).toString("hex")
            });
            var secure = String(req.headers["x-forwarded-proto"] || "") === "https" ? "; Secure" : "";
            res.setHeader("Set-Cookie", "sirk_session=" + token + "; Path=/; HttpOnly; SameSite=Strict" + secure);
            json(res, 200, { ok: true });
        }).catch(function (error) { json(res, 400, { ok: false, error: error.message }); });
    }

    options.auth = options.auth || { currentUser: sessionUser };
    var host = adapter.createHost(options);
    host.identity = identity;
    host.agentGroups = agentGroupFactory.create({ dataRoot: host.dataRoot });
    host.agentPolicies = agentPolicyFactory.create({ dataRoot: host.dataRoot });
    host.agentCommands = agentCommandBrokerFactory.create({ dataRoot: host.dataRoot });
    host.agentDesktopRelay = agentDesktopRelayFactory.create();
    var runtime = runtimeFactory.createRuntime(host, ROOT);
    var api = apiFactory.createHandler(runtime, host);
    var manager = updateManagerFactory.create({ appRoot: ROOT, dataRoot: host.dataRoot });
    var updateApi = updateRouterFactory.createHandler(manager);
    var agentGateway = agentGatewayFactory.create({
        dataRoot: host.dataRoot,
        token: options.agentToken,
        enrollmentToken: options.agentEnrollmentToken,
        enrollmentResolver: host.agentGroups.resolveEnrollment,
        enrollmentAssigned: host.agentGroups.assign,
        policyService: host.agentPolicies,
        commandBroker: host.agentCommands
        , desktopRelay: host.agentDesktopRelay
    });

    function portalConfig() {
        try {
            var current = runtime.context.settings.read();
            return current && current.modules && current.modules.portal || {};
        } catch (error) { return {}; }
    }

    return Promise.resolve(runtime.initialize()).then(function () {
        var server = http.createServer(function (req, res) {
            noStore(res);
            var url = new URL(req.url, "http://sirk.local");
            if (url.pathname.indexOf("/api/agent/v1/") === 0 && agentGateway.handle(req, res)) return;
            if (url.pathname === "/maintenance.json") {
                json(res, 200, maintenance.status(portalConfig().maintenance, req));
                return;
            }
            var maintenanceState = maintenance.status(portalConfig().maintenance, req);
            if ((url.pathname === "/" || url.pathname === "/sirkportal/" || url.pathname === "/login") &&
                    maintenanceState.active && !maintenanceState.allowed) {
                res.statusCode = 503;
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.end(maintenance.page(portalConfig().maintenance));
                return;
            }
            if (url.pathname === "/api/auth/login" && req.method === "POST") {
                if (!requireSameOrigin(req)) { json(res, 403, { ok: false, error: "Invalid origin." }); return; }
                login(req, res);
                return;
            }
            if (url.pathname === "/auth/logout") {
                var token = cookie(req);
                if (token) sessions.delete(token);
                res.statusCode = 302;
                res.setHeader("Set-Cookie", "sirk_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict");
                res.setHeader("Location", "/login");
                res.end();
                return;
            }
            if (url.pathname.indexOf("/api/system/updates/") === 0) {
                updateApi(req, res, url);
                return;
            }
            if (url.pathname.indexOf("/api/") === 0) {
                api(req, res);
                return;
            }
            if (url.pathname === "/login") {
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.end(loginHtml());
                return;
            }
            if (url.pathname === "/favicon.ico") {
                res.setHeader("Content-Type", "image/svg+xml");
                fs.createReadStream(path.join(ROOT, "assets/icons/sirk-ui.svg")).pipe(res);
                return;
            }
            if (url.pathname === "/" || url.pathname === "/sirkportal/") {
                sessionUser(req).then(function () {
                    res.setHeader("Content-Type", "text/html; charset=utf-8");
                    res.end(portalHtml());
                }).catch(function () {
                    res.statusCode = 302;
                    res.setHeader("Location", "/login");
                    res.end();
                });
                return;
            }
            if (url.pathname.indexOf("/assets/") === 0) {
                var key = decodeURIComponent(url.pathname.slice(8));
                var relative = ASSETS[key];
                var target = relative && path.resolve(ROOT, relative);
                if (!target || target.indexOf(ROOT + path.sep) !== 0 || !fs.existsSync(target)) {
                    res.statusCode = 404;
                    res.end("Not found");
                    return;
                }
                res.setHeader("Content-Type", contentType(target));
                fs.createReadStream(target).pipe(res);
                return;
            }
            res.statusCode = 404;
            res.end("Not found");
        });
        var desktopSockets = new WebSocket.WebSocketServer({ noServer: true, perMessageDeflate: false });
        var agentDesktopSockets = new WebSocket.WebSocketServer({ noServer: true, perMessageDeflate: false });
        server.on("upgrade", function (req, socket, head) {
            var url;
            try { url = new URL(req.url, "http://sirk.local"); } catch (error) { socket.destroy(); return; }
            if (url.pathname === "/api/agent/v1/desktop/stream") {
                var identity = agentGateway.authorizeDesktopSocket(req);
                if (!identity) { socket.destroy(); return; }
                agentDesktopSockets.handleUpgrade(req, socket, head, function (client) {
                    client.on("message", function (packet, binary) {
                        if (!binary) { client.close(1003); return; }
                        try {
                            agentGateway.publishDesktopSocket(identity, Buffer.from(packet));
                        } catch (error) {
                            client.close(1007, String(error.message || "Invalid desktop frame").slice(0, 120));
                        }
                    });
                });
                return;
            }
            if (url.pathname !== "/api/agent-desktop/stream") { socket.destroy(); return; }
            sessionUser(req).then(function (user) {
                if (!user.isAdmin || !requireSameOrigin(req)) { socket.destroy(); return; }
                desktopSockets.handleUpgrade(req, socket, head, function (client) {
                    var tenantId = String(url.searchParams.get("tenantId") || "");
                    var deviceId = String(url.searchParams.get("deviceId") || "");
                    var sequence = Math.max(0, Number(url.searchParams.get("after")) || 0);
                    var closed = false;
                    host.agentDesktopRelay.touchViewer(tenantId, deviceId);
                    var viewerHeartbeat = setInterval(function () {
                        host.agentDesktopRelay.touchViewer(tenantId, deviceId);
                    }, 10000);
                    client.binaryType = "arraybuffer";
                    client.once("close", function () { closed = true; clearInterval(viewerHeartbeat); });
                    client.once("error", function () { closed = true; clearInterval(viewerHeartbeat); });
                    (async function pump() {
                        while (!closed && client.readyState === WebSocket.OPEN) {
                            var value = await host.agentDesktopRelay.wait(tenantId, deviceId, sequence, 25000);
                            if (!value) continue;
                            sequence = value.sequence;
                            var metadata = Buffer.from(JSON.stringify(value.metadata || {}), "utf8");
                            var prefix = Buffer.allocUnsafe(4);
                            prefix.writeUInt32BE(metadata.length, 0);
                            await new Promise(function (resolve, reject) {
                                client.send(Buffer.concat([prefix, metadata, value.frame]), { binary: true },
                                    function (error) { if (error) reject(error); else resolve(); });
                            });
                        }
                    }()).catch(function () { try { client.close(); } catch (error) {} });
                });
            }).catch(function () { socket.destroy(); });
        });
        return new Promise(function (resolve) {
            var port = options.port == null ? Number(process.env.PORT || 8080) : Number(options.port);
            server.listen(port, options.host || process.env.HOST || "127.0.0.1", function () {
                var address = server.address();
                var storedCentral = runtime.context.secrets.get("central-tunnel");
                var centralTunnel = centralTunnelFactory.create({
                    centralUrl: options.centralUrl || storedCentral.centralUrl,
                    portalId: options.centralPortalId || storedCentral.portalId,
                    portalName: options.centralPortalName || storedCentral.portalName,
                    portalToken: options.centralToken || storedCentral.portalToken,
                    localPort: address && address.port,
                    portalVersion: version()
                });
                if (centralTunnel.configured()) centralTunnel.connect();
                server.on("close", centralTunnel.stop);
                host.centralTunnel = centralTunnel;
                resolve(server);
            });
        });
    });
}

if (require.main === module) {
    start().then(function (server) {
        console.log("SIRK Portal standalone listening on", server.address());
    }).catch(function (error) {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = { start: start, assets: ASSETS };
