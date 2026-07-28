"use strict";

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

function normalizeBase(value) {
    value = String(value || "/");
    if (value.charAt(0) !== "/") value = "/" + value;
    if (value.charAt(value.length - 1) !== "/") value += "/";
    return value.replace(/\/+/g, "/");
}

function settings(plugin) {
    try {
        var store = plugin.runtime && plugin.runtime.context && plugin.runtime.context.settings;
        var current = store && typeof store.read === "function" ? store.read() : {};
        return current && current.modules && current.modules.portal || {};
    } catch (error) { return {}; }
}

function safeEqual(left, right) {
    left = Buffer.from(String(left || ""));
    right = Buffer.from(String(right || ""));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function redirect(res, target) {
    if (typeof res.set === "function") res.set("Cache-Control", "no-store");
    else if (typeof res.setHeader === "function") res.setHeader("Cache-Control", "no-store");
    if (typeof res.redirect === "function") res.redirect(302, target);
    else {
        res.statusCode = 302;
        res.setHeader("Location", target);
        res.end();
    }
}

function sendLogoutBridge(res, nativeLogout, portalLogin) {
    var nativeJson = JSON.stringify(nativeLogout);
    var loginJson = JSON.stringify(portalLogin);
    var body = "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"robots\" content=\"noindex\">" +
        "<title>Wylogowywanie…</title></head><body><p>Wylogowywanie…</p><script>" +
        "fetch(" + nativeJson + ",{credentials:'same-origin',cache:'no-store',redirect:'follow'})" +
        ".catch(function(){})" +
        ".then(function(){location.replace(" + loginJson + ");});" +
        "setTimeout(function(){location.replace(" + loginJson + ");},2500);" +
        "<\/script></body></html>";
    if (typeof res.status === "function") res.status(200); else res.statusCode = 200;
    if (typeof res.set === "function") {
        res.set("Content-Type", "text/html; charset=utf-8");
        res.set("Cache-Control", "no-store");
    } else {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
    }
    if (typeof res.send === "function") res.send(body); else res.end(body);
}

function dataRoot(parent, meshServer) {
    var base = meshServer && meshServer.datapath || parent && parent.parent && parent.parent.datapath;
    if (!base) base = path.dirname(parent && parent.pluginPath || process.cwd());
    return path.join(base, "sirk-platform-data");
}

function emergencyFile(parent, meshServer) {
    return path.join(dataRoot(parent, meshServer), "native-emergency-access.txt");
}

function emergencyUrl(domain, base, token) {
    var relative = base + "meshcentral/?sirkEmergency=" + encodeURIComponent(token);
    var host = domain && domain.dns ? String(domain.dns).trim() : "";
    return host ? "https://" + host + relative : relative;
}

function writeEmergencyFile(parent, meshServer, domains, token) {
    var target = emergencyFile(parent, meshServer);
    var lines = [
        "SIRK Portal - awaryjny dostęp do natywnego MeshCentral",
        "Wygenerowano: " + new Date().toISOString(),
        "Ten adres przestaje działać po ponownym uruchomieniu usługi.",
        "Nie udostępniaj tego pliku użytkownikom.",
        ""
    ];
    Object.keys(domains || { "": { url: "/" } }).forEach(function (key) {
        var domain = domains[key] || {};
        lines.push(emergencyUrl(domain, normalizeBase(domain.url || "/"), token));
    });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, lines.join("\r\n") + "\r\n", { encoding: "utf8", mode: 0o600 });
    try { fs.chmodSync(target, 0o600); } catch (error) {}
    return target;
}

function addAuthBypass(req, requestUrl) {
    requestUrl.searchParams.set("sirkAuth", "1");
    var value = requestUrl.pathname + requestUrl.search;
    req.url = value;
    if (req.originalUrl != null) req.originalUrl = value;
}

function validLoginFrame(req, policy, requestUrl) {
    if (requestUrl.searchParams.get("sirkAuth") !== "1") return false;
    var destination = String(req && req.headers && req.headers["sec-fetch-dest"] || "").toLowerCase();
    var referer = String(req && req.headers && req.headers.referer || "");
    if (destination !== "iframe") return false;
    // MeshCentral sends Referrer-Policy: no-referrer, so a genuine iframe
    // navigation normally has no Referer header. The fetch destination is the
    // reliable browser signal; when a Referer is available, still constrain it
    // to the SIRK login page.
    if (!referer) return true;
    var fromLogin = false;
    try { fromLogin = new URL(referer || "http://invalid.local").pathname === policy.login; }
    catch (error) {}
    return fromLogin;
}

function moveFirst(app, middleware) {
    var router = app && (app._router || app.router);
    var stack = router && router.stack;
    if (!Array.isArray(stack)) return;
    var index = stack.findIndex(function (layer) { return layer && layer.handle === middleware; });
    if (index > 0) stack.unshift(stack.splice(index, 1)[0]);
}

exports.install = function (plugin, parent, webserver, meshServer) {
    if (!webserver || !webserver.app || webserver.__sirkNativeAccessPolicy) return;
    webserver.__sirkNativeAccessPolicy = true;

    var token = crypto.randomBytes(32).toString("base64url");
    var domains = meshServer && meshServer.config && meshServer.config.domains || { "": { url: "/" } };
    try {
        var file = writeEmergencyFile(parent, meshServer, domains, token);
        console.log("SIRK Portal native emergency URL written to " + file);
    } catch (error) {
        console.error("SIRK Portal could not write native emergency URL", error);
    }

    var domainPolicies = Object.keys(domains).map(function (key) {
        var domain = domains[key] || {};
        var base = normalizeBase(domain.url || "/");
        return {
            root: base === "/" ? "/" : base.replace(/\/$/, ""),
            rootSlash: base,
            native: base + "meshcentral",
            nativeSlash: base + "meshcentral/",
            logout: base + "logout",
            portal: base + "sirkportal/",
            login: base + "sirkportal/login"
        };
    });

    var middleware = function (req, res, next) {
        var method = String(req && req.method || "GET").toUpperCase();
        if (method !== "GET" && method !== "HEAD") { next(); return; }
        var requestUrl;
        try { requestUrl = new URL(String(req.originalUrl || req.url || "/"), "http://sirk.local"); }
        catch (error) { next(); return; }
        var pathname = requestUrl.pathname;
        var policy = domainPolicies.find(function (item) {
            return pathname === item.root || pathname === item.rootSlash || pathname === item.native ||
                pathname === item.nativeSlash || pathname === item.logout;
        });
        if (!policy) { next(); return; }

        if (pathname === policy.logout) {
            if (requestUrl.searchParams.get("sirkNativeLogout") === "1") { next(); return; }
            sendLogoutBridge(res, policy.logout + "?sirkNativeLogout=1", policy.login + "?loggedout=1");
            return;
        }

        var portal = settings(plugin);
        var emergency = safeEqual(requestUrl.searchParams.get("sirkEmergency"), token);
        var explicitNative = requestUrl.searchParams.get("sirkNative") === "1";

        if (pathname === policy.native || pathname === policy.nativeSlash) {
            if (!emergency && portal.showNativeLink === false) { redirect(res, policy.portal); return; }
            var target = new URL(policy.rootSlash, "http://sirk.local");
            target.searchParams.set("sirkNative", "1");
            target.searchParams.set("sirkAuth", "1");
            if (emergency) target.searchParams.set("sirkEmergency", token);
            redirect(res, target.pathname + target.search);
            return;
        }

        if (emergency) { addAuthBypass(req, requestUrl); next(); return; }
        if (explicitNative) {
            if (portal.showNativeLink === false) { redirect(res, policy.portal); return; }
            addAuthBypass(req, requestUrl);
            next();
            return;
        }
        if (validLoginFrame(req, policy, requestUrl)) { next(); return; }
        if (requestUrl.searchParams.get("sirkAuth") === "1") { redirect(res, policy.login); return; }
        if (portal.forcePortalInterface === true) { redirect(res, policy.portal); return; }
        if (portal.forceNewLogin === true) { redirect(res, policy.login); return; }
        next();
    };

    webserver.app.use(middleware);
    moveFirst(webserver.app, middleware);
};

exports._test = {
    normalizeBase: normalizeBase,
    safeEqual: safeEqual,
    emergencyUrl: emergencyUrl,
    validLoginFrame: validLoginFrame
};
